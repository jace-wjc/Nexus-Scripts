import asyncio
import json
import logging
import queue
import shutil
import threading
import time
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import anyio
from starlette.background import BackgroundTask
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..permission_governance import PermissionContext, build_permission_context, expand_permission_aliases, normalize_org_code
from ..recruitment_schemas import (
    CandidateBatchDeleteRequest,
    CandidateBatchStatusUpdateRequest,
    CandidateBatchUpdatePositionRequest,
    CandidateComparisonPreviewRequest,
    CandidateDuplicateCheckRequest,
    CandidateExportRequest,
    CandidateScreenBatchCancelRequest,
    CandidateScreenBatchQueryRequest,
    CandidateScreenBatchStartRequest,
    CandidateScreenVisibleCancelRequest,
    CandidateStatusUpdateRequest,
    CandidateScreenRequest,
    CandidateUpdateRequest,
    DepartmentReviewCreateRequest,
    DepartmentReviewDecisionRequest,
    InterviewAvailabilityReplaceRequest,
    InterviewQuestionGenerateRequest,
    InterviewScheduleCreateRequest,
    InterviewScheduleResultRequest,
    InterviewScheduleUpdateRequest,
    FollowUpCreateRequest,
    JDGenerateRequest,
    OfferCreateRequest,
    OfferUpdateRequest,
    PositionCreateRequest,
    PositionUpdateRequest,
    PublishTaskCreateRequest,
    RecruitmentChatContextUpdateRequest,
    RecruitmentChatRequest,
    RecruitmentLLMConfigUpsertRequest,
    RecruitmentMailAutoPushGlobalConfigRequest,
    RecruitmentMailRecipientUpsertRequest,
    RecruitmentMailSenderUpsertRequest,
    RecruitmentResourceCopyRequest,
    RecruitmentResourceGovernanceUpdateRequest,
    RecruitmentResumeMailSendRequest,
    SaveJDVersionRequest,
    SkillContentGenerateRequest,
    SkillUpsertRequest,
)
from ..script_hub_session import (
    get_script_hub_token_from_request,
    require_script_hub_any_permission,
    require_script_hub_permission,
    verify_script_hub_session,
)
from ..services.recruitment_service import RecruitmentConflictError, RecruitmentService
from ..services.recruitment_task_control import RecruitmentTaskCancelled
from ..services.recruitment_utils import RECRUITMENT_UPLOAD_ROOT
from ..services.script_hub_audit_service import write_audit_log
from ..services.task_event_bus import TaskEventBus
recruitment_router = APIRouter(prefix="/recruitment", tags=["AI 招聘自动化管理"])

UPLOAD_STREAM_CHUNK_SIZE = 1024 * 1024
POSITION_SKILL_BIND_FIELDS = {"jd_skill_ids", "screening_skill_ids", "interview_skill_ids", "skill_pack_ids"}

logger = logging.getLogger(__name__)


def _resume_download_response(payload: Dict[str, Any], range_header: Optional[str] = None) -> Response:
    content = bytes(payload.get("content") or b"")
    file_name = payload.get("file_name") or "resume.bin"
    file_extension = f".{file_name.rsplit('.', 1)[1]}" if "." in file_name and not file_name.endswith(".") else ".bin"
    quoted_name = quote(file_name)
    total = len(content)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f"inline; filename=\"resume{file_extension}\"; filename*=UTF-8''{quoted_name}",
    }

    requested_range = str(range_header or "").strip()
    if not requested_range:
        headers["Content-Length"] = str(total)
        return Response(content=content, media_type=payload["media_type"], headers=headers)

    if not requested_range.lower().startswith("bytes=") or "," in requested_range:
        headers["Content-Range"] = f"bytes */{total}"
        return Response(status_code=416, media_type=payload["media_type"], headers=headers)

    range_spec = requested_range[6:].strip()
    start_text, separator, end_text = range_spec.partition("-")
    if separator != "-" or not total:
        headers["Content-Range"] = f"bytes */{total}"
        return Response(status_code=416, media_type=payload["media_type"], headers=headers)

    try:
        if not start_text:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                raise ValueError
            start = max(total - suffix_length, 0)
            end = total - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else total - 1
            if start < 0 or start >= total or end < start:
                raise ValueError
            end = min(end, total - 1)
    except (TypeError, ValueError):
        headers["Content-Range"] = f"bytes */{total}"
        return Response(status_code=416, media_type=payload["media_type"], headers=headers)

    partial = content[start:end + 1]
    headers.update({
        "Content-Length": str(len(partial)),
        "Content-Range": f"bytes {start}-{end}/{total}",
    })
    return Response(content=partial, status_code=206, media_type=payload["media_type"], headers=headers)

RECRUITMENT_COMMON_VIEW_PERMISSIONS = [
    "recruitment-dashboard-view",
    "recruitment-position-manage",
    "recruitment-candidate-manage",
    "recruitment-process-execute",
    "recruitment-log-view",
    "recruitment-review-view",
    "recruitment-review-act",
    "recruitment-review-manage",
    "recruitment-interview-view",
    "recruitment-interview-act",
    "recruitment-interview-manage",
    "recruitment-talent-pool-view",
    "recruitment-assistant-view",
    "recruitment-skill-view",
    "recruitment-skill-bind",
    "recruitment-skill-manage",
    "recruitment-mail-view",
    "recruitment-mail-send",
    "recruitment-mail-config-manage",
    "recruitment-mail-sender-manage",
    "recruitment-llm-config-view",
    "recruitment-llm-config-manage",
]

RECRUITMENT_INTERVIEW_SCOPED_PERMISSIONS = [
    "recruitment-interview-view",
    "recruitment-interview-act",
    "recruitment-interview-manage",
]

RECRUITMENT_REVIEW_SCOPED_PERMISSIONS = [
    "recruitment-review-view",
    "recruitment-review-act",
]

RECRUITMENT_TASK_EVENT_PERMISSIONS = [
    "recruitment-process-execute",
    "recruitment-log-view",
    *RECRUITMENT_REVIEW_SCOPED_PERMISSIONS,
    *RECRUITMENT_INTERVIEW_SCOPED_PERMISSIONS,
]

RECRUITMENT_CANDIDATE_INTERVIEW_SCHEDULE_PERMISSIONS = [
    "recruitment-dashboard-view",
    *RECRUITMENT_INTERVIEW_SCOPED_PERMISSIONS,
]


def _has_unrestricted_task_event_access(session: Dict[str, Any]) -> bool:
    return (
        _session_has_permission(session, "recruitment-process-execute")
        or _session_has_permission(session, "recruitment-log-view")
    )


def _task_event_for_session(
    raw_event: str,
    session: Dict[str, Any],
    permission_context: Optional[PermissionContext],
) -> Optional[str]:
    try:
        payload = json.loads(raw_event)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None

    task_type = str(payload.get("task_type") or "").strip()
    actor_id = str(session.get("id") or "").strip()
    candidate_snapshot = payload.get("candidate_snapshot")
    snapshot = candidate_snapshot if isinstance(candidate_snapshot, dict) else {}
    event_org_code = str(payload.get("org_code") or snapshot.get("org_code") or "").strip()

    # P0-5：组织可见性过滤对所有会话统一生效（含 process-execute / log-view）。
    # 此前这两类功能权限会直接透传原始事件，导致跨组织实时泄露候选人快照。
    # 仅"涉及候选人"的事件强制要求组织可见（无组织信息一律 fail-closed 丢弃）；
    # batch_summary 等不含候选人数据的控制事件正常放行。
    involves_candidate = bool(
        payload.get("candidate_id")
        or payload.get("related_candidate_id")
        or snapshot
    )
    if involves_candidate and permission_context is not None and permission_context.visible_org_codes is not None:
        visible_org_codes = {normalize_org_code(code) for code in permission_context.visible_org_codes}
        if not event_org_code or normalize_org_code(event_org_code) not in visible_org_codes:
            return None
        # P0-4：顶层 org_code 与快照 org_code 冲突时一律 fail-closed 丢弃，防止伪造 org 绕过。
        if involves_candidate and snapshot:
            snapshot_org_code = str(snapshot.get("org_code") or "").strip()
            if snapshot_org_code and normalize_org_code(snapshot_org_code) not in visible_org_codes:
                return None
        # SELF 数据范围下，候选人流事件（screening/ai_position_match 等）还必须由本人拥有。
        # 面试/部门评审事件按"被指派人"授权，且下游有专门的 self-scope 处理，此处不介入。
        if (
            permission_context.is_self_scope
            and involves_candidate
            and snapshot
            and task_type not in {"department_review", "interview_schedule"}
        ):
            owner_id = str(snapshot.get("created_by") or snapshot.get("uploaded_by") or "").strip()
            if not owner_id or owner_id != permission_context.actor_user_code:
                return None

    if _has_unrestricted_task_event_access(session):
        return raw_event
    if permission_context is None:
        return None

    if task_type == "department_review":
        if not any(_session_has_permission(session, permission) for permission in RECRUITMENT_REVIEW_SCOPED_PERMISSIONS):
            return None
        reviewer_user_codes = {
            str(value or "").strip()
            for value in (payload.get("reviewer_user_codes") or [])
            if str(value or "").strip()
        }
        if actor_id not in reviewer_user_codes:
            return None
        # Department-review events only instruct an assignee to refresh the
        # assignment-scoped endpoint.  Never stream the candidate snapshot.
        payload.pop("candidate_snapshot", None)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    if task_type == "interview_schedule":
        if not any(_session_has_permission(session, permission) for permission in RECRUITMENT_INTERVIEW_SCOPED_PERMISSIONS):
            return None
        can_manage = _session_has_permission(session, "recruitment-interview-manage")
        if not can_manage:
            assigned_user_codes = {
                str(payload.get("interviewer_user_code") or "").strip(),
                str(payload.get("previous_interviewer_user_code") or "").strip(),
            }
            assigned_user_codes.discard("")
            if actor_id not in assigned_user_codes:
                return None
        if can_manage and permission_context.is_self_scope:
            owner_id = str(snapshot.get("created_by") or snapshot.get("uploaded_by") or "").strip()
            if not owner_id or owner_id != permission_context.actor_user_code:
                return None
        if can_manage:
            return raw_event
        # The event only tells the assigned interviewer to refresh their scoped
        # task. Candidate data must continue to flow through the schedule-aware
        # detail endpoint where visible_sections is enforced.
        payload.pop("candidate_snapshot", None)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return None


def _should_deliver_task_event(
    raw_event: str,
    session: Dict[str, Any],
    permission_context: Optional[PermissionContext],
) -> bool:
    return _task_event_for_session(raw_event, session, permission_context) is not None


def _filter_uploaded_resume_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [row for row in rows if not row.get("skipped_duplicate")]


def _load_task_event_context(session: Dict[str, Any]) -> PermissionContext:
    with SessionLocal() as db:
        return build_permission_context(db, session)


def _refresh_task_event_access(request, previous_session, previous_context, refreshed_at):
    session = require_script_hub_any_permission(RECRUITMENT_TASK_EVENT_PERMISSIONS)(request)
    now = time.monotonic()
    if session != previous_session or now - refreshed_at >= 25.0:
        return session, _load_task_event_context(session), now
    return session, previous_context, refreshed_at


@recruitment_router.get("/task-events")
async def stream_task_events(
    request: Request,
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(RECRUITMENT_TASK_EVENT_PERMISSIONS)),
):
    """
    SSE 长连接端点。前端建立一次连接后，后端主动推送任务状态变化。
    代替前端所有轮询行为。
    """
    token = get_script_hub_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # P0-5：所有会话都构建权限上下文——process-execute / log-view 用户的事件
    # 同样需要按组织可见范围过滤，不再无条件透传。
    event_permission_context = await run_in_threadpool(_load_task_event_context, _session)

    subscription_id, q = TaskEventBus.subscribe(token)

    async def event_generator():
        stream_session = _session
        stream_context = event_permission_context
        refreshed_at = time.monotonic()
        try:
            hello_payload = json.dumps({"type": "hello"}, ensure_ascii=False)
            yield f"data: {hello_payload}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                except asyncio.TimeoutError:
                    data = None
                try:
                    stream_session, stream_context, refreshed_at = await run_in_threadpool(
                        _refresh_task_event_access, request, stream_session, stream_context, refreshed_at,
                    )
                except HTTPException:
                    break
                except Exception as exc:
                    logger.warning("Task event authorization unavailable: %s", type(exc).__name__)
                    break
                if data is None:
                    yield ": heartbeat\n\n"
                else:
                    scoped_event = _task_event_for_session(data, stream_session, stream_context)
                    if scoped_event is not None:
                        yield f"data: {scoped_event}\n\n"
        finally:
            TaskEventBus.unsubscribe(token, subscription_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def recover_orphaned_tasks_on_startup():
    """供主 app lifespan 调用。服务启动时仅将不可恢复的中断任务标记为 failed。

    P0-4 恢复语义：
    - queued 任务（初筛持久化队列中排队的任务）一律不动，由
      resume_screening_queue_on_startup 正常派发——此前重启会把整批排队任务
      永久标记 failed，需要人工逐个重筛。
    - screening_flow 根任务（含 running/pending）不在这里处理，由
      resume_screening_queue_on_startup 统一重新入队（带启动恢复次数上限）。
    - 其余 running 任务（chat/JD/面试题等一次性流式任务）不可恢复，标记 failed。

    分批处理（每批 10 个），批次间加随机抖动延迟，避免并发写库死锁。
    """
    import asyncio
    import random
    from ..database import SessionLocal
    from ..recruitment_models import RecruitmentAITaskLog

    BATCH_SIZE = 10
    db = SessionLocal()
    try:
        orphaned = db.query(RecruitmentAITaskLog).filter(
            RecruitmentAITaskLog.status == "running",
            RecruitmentAITaskLog.task_type != "screening_flow",
        ).all()
        if not orphaned:
            return
        logger.warning("Found %d orphaned tasks, scheduling with batch delay...", len(orphaned))
        db.close()

        for batch_start in range(0, len(orphaned), BATCH_SIZE):
            batch = orphaned[batch_start: batch_start + BATCH_SIZE]
            if batch_start > 0:
                delay = random.uniform(2, 4)
                await asyncio.sleep(delay)
            db = SessionLocal()
            try:
                for row_id in [r.id for r in batch]:
                    row = db.query(RecruitmentAITaskLog).filter(RecruitmentAITaskLog.id == row_id).first()
                    if row and row.status == "running" and row.task_type != "screening_flow":
                        row.status = "failed"
                        row.error_message = "服务重启，任务中断。请重新发起该任务。"
                db.commit()
                logger.info("Batch %d-%d: marked %d orphaned tasks as failed",
                            batch_start, batch_start + len(batch), len(batch))
            except Exception as exc:
                logger.error("Batch %d-%d failed: %s", batch_start, batch_start + len(batch), exc)
                db.rollback()
            finally:
                db.close()

        logger.warning(
            "Marked %d orphaned tasks as failed on startup. "
            "Manual re-trigger required. No SSE notifications were emitted during startup recovery.",
            len(orphaned)
        )
    except Exception as exc:
        logger.error("Failed to recover orphaned tasks: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        try:
            db.close()
        except Exception:
            pass


def _session_has_permission(session: Dict[str, Any], permission: str) -> bool:
    return bool(expand_permission_aliases(dict((session or {}).get("permissions") or {})).get(permission))


def _ensure_position_update_allowed(session: Dict[str, Any], patch: Dict[str, Any]) -> None:
    if _session_has_permission(session, "recruitment-position-manage"):
        return
    if _session_has_permission(session, "recruitment-skill-bind") and patch and set(patch).issubset(POSITION_SKILL_BIND_FIELDS):
        return
    raise HTTPException(status_code=403, detail="Forbidden")


def _ensure_resource_copy_allowed(session: Dict[str, Any], resource_kind: str) -> None:
    required_by_kind = {
        "skill": "recruitment-skill-manage",
        "model": "recruitment-llm-config-manage",
        "mail-sender": "recruitment-mail-sender-manage",
        "mail-recipient": "recruitment-mail-config-manage",
    }
    required = required_by_kind.get(resource_kind)
    if not required:
        raise HTTPException(status_code=400, detail="Unsupported resource kind")
    if not _session_has_permission(session, required):
        raise HTTPException(status_code=403, detail="Forbidden")


def get_recruitment_service(request: Request, db: Session = Depends(get_db)) -> RecruitmentService:
    # ensure_recruitment_schema() 已在 prestart.py 中执行，请求路径不再调用
    session = getattr(request.state, "script_hub_session", None)
    if not session:
        token = get_script_hub_token_from_request(request)
        session = verify_script_hub_session(token) if token else None
    service = RecruitmentService(db).set_permission_context(session)
    raw_token = get_script_hub_token_from_request(request)
    service._session_token = raw_token
    return service


def _run_recruitment_service_call(
    method_name: str,
    *args: Any,
    governance_session: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> Any:
    # ensure_recruitment_schema() 已在 prestart.py 中执行，请求路径不再调用
    db = SessionLocal()
    try:
        service = RecruitmentService(db).set_permission_context(governance_session)
        if isinstance(governance_session, dict):
            raw_token = str(governance_session.get("_raw_token") or "").strip()
            if raw_token:
                service._session_token = raw_token
        method = getattr(service, method_name)
        return method(*args, **kwargs)
    finally:
        db.close()


def _with_session_token(request: Request, session: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(session, dict):
        return session
    enriched = dict(session)
    raw_token = get_script_hub_token_from_request(request)
    if raw_token:
        enriched["_raw_token"] = raw_token
    return enriched


async def _dispatch_ai_position_match_background(
    candidate_ids: List[int],
    actor_id: str,
    governance_session: Optional[Dict[str, Any]],
    session_token: Optional[str],
) -> None:
    db = SessionLocal()
    try:
        service = RecruitmentService(db).set_permission_context(governance_session)
        service._session_token = session_token
        result = await service.trigger_ai_position_match(
            candidate_ids,
            actor_id,
        )
        logger.info("AI position match background dispatched: %s", result)
    except Exception:
        logger.error(
            "AI position match background dispatch failed: candidate_ids=%s",
            candidate_ids,
            exc_info=True,
        )
    finally:
        db.close()


def _encode_sse_event(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


ALLOWED_RESUME_EXTENSIONS = {".pdf", ".docx"}


async def _stage_upload_file(item: UploadFile, staging_dir: Path) -> Dict[str, Any]:
    file_name = Path(item.filename or "resume.bin").name or "resume.bin"
    file_ext = Path(file_name).suffix.lower()

    # 源头拦截：只允许 PDF 和 DOCX 格式
    if file_ext not in ALLOWED_RESUME_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式「{file_ext or '无扩展名'}」，简历仅支持 PDF 和 DOCX 格式。"
        )

    staged_name = f"{uuid.uuid4().hex}{file_ext}"
    staged_path = staging_dir / staged_name
    file_size = 0
    await item.seek(0)
    async with await anyio.open_file(staged_path, "wb") as file_obj:
        while True:
            chunk = await item.read(UPLOAD_STREAM_CHUNK_SIZE)
            if not chunk:
                break
            file_size += len(chunk)
            await file_obj.write(chunk)
    await item.close()
    return {
        "file_name": file_name,
        "content_type": item.content_type,
        "staged_path": str(staged_path),
        "file_size": file_size,
    }


@recruitment_router.get("/metadata")
async def get_metadata(_session: Dict[str, Any] = Depends(require_script_hub_any_permission(RECRUITMENT_COMMON_VIEW_PERMISSIONS)), service: RecruitmentService = Depends(get_recruitment_service)):
    return {"success": True, "data": service.get_metadata(), "request_id": str(uuid.uuid4())}


@recruitment_router.get("/organization-scope")
async def get_organization_scope(_session: Dict[str, Any] = Depends(require_script_hub_any_permission(RECRUITMENT_COMMON_VIEW_PERMISSIONS)), service: RecruitmentService = Depends(get_recruitment_service)):
    return {"success": True, "data": service.get_organization_scope(), "request_id": str(uuid.uuid4())}


@recruitment_router.get("/dashboard")
async def get_dashboard(_session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    return {"success": True, "data": service.get_dashboard(), "request_id": str(uuid.uuid4())}


@recruitment_router.get("/positions")
def list_positions(query: Optional[str] = Query(None), status: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.list_positions(query=query, status=status)
    return {"success": True, "data": data, "total": len(data), "request_id": str(uuid.uuid4())}


@recruitment_router.post("/positions")
async def create_position(http_request: Request, payload: PositionCreateRequest, db: Session = Depends(get_db), session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_position(payload.model_dump(), session.get("id") or "unknown")
        write_audit_log(db, actor=session, request=http_request, action="recruitment.position.create", target_type="recruitment-position", target_code=data["position_code"], details={"title": data["title"]})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/positions/{position_id}")
async def get_position_detail(position_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        return {"success": True, "data": service.get_position_detail(position_id), "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.patch("/positions/{position_id}")
async def update_position(http_request: Request, position_id: int, payload: PositionUpdateRequest, db: Session = Depends(get_db), session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-position-manage", "recruitment-skill-bind"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        patch = payload.model_dump(exclude_none=True)
        _ensure_position_update_allowed(session, patch)
        data = service.update_position(position_id, patch, session.get("id") or "unknown")
        write_audit_log(db, actor=session, request=http_request, action="recruitment.position.update", target_type="recruitment-position", target_code=data["position_code"], details={"position_id": position_id})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        status_code = 400 if "当前组织下已存在岗位" in str(exc) or "岗位名称不能为空" in str(exc) else 404
        raise HTTPException(status_code=status_code, detail=str(exc))


@recruitment_router.delete("/positions/{position_id}")
async def delete_position(http_request: Request, position_id: int, db: Session = Depends(get_db), session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_position(position_id, session.get("id") or "unknown")
        try:
            write_audit_log(db, actor=session, request=http_request, action="recruitment.position.delete", target_type="recruitment-position", target_code=str(position_id), details={"position_id": position_id})
        except Exception:
            pass
        return {"success": True, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@recruitment_router.post("/positions/{position_id}/generate-jd")
async def generate_jd(request: Request, position_id: int, payload: JDGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "generate_jd",
            position_id,
            payload.extra_prompt or "",
            _session.get("id") or "unknown",
            governance_session=_with_session_token(request, _session),
            auto_activate=payload.auto_activate,
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except RecruitmentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/positions/{position_id}/generate-jd/start")
async def start_generate_jd(request: Request, position_id: int, payload: JDGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "start_generate_jd",
            position_id,
            payload.extra_prompt or "",
            _session.get("id") or "unknown",
            governance_session=_with_session_token(request, _session),
            auto_activate=payload.auto_activate,
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/positions/{position_id}/generate-jd/stream")
async def stream_generate_jd(position_id: int, payload: JDGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage"))):
    event_queue: "queue.Queue[Optional[str]]" = queue.Queue()

    def push(event_name: str, data: Dict[str, Any]) -> None:
        event_queue.put(_encode_sse_event(event_name, data))

    def worker() -> None:
        db = SessionLocal()
        service = RecruitmentService(db).set_permission_context(_session)
        try:
            def on_delta(delta: str) -> None:
                push("delta", {"delta": delta})
            def on_task_created(task_id: int) -> None:
                push("task_created", {"task_id": task_id})
            result = service.generate_jd_stream(position_id, payload.extra_prompt or "", _session.get("id") or "unknown", on_delta, auto_activate=payload.auto_activate, on_task_created=on_task_created)
            push("completed", result)
        except RecruitmentTaskCancelled:
            push("cancelled", {"message": "已停止生成"})
        except Exception as exc:
            push("error", {"message": str(exc)})
        finally:
            event_queue.put(None)
            db.close()

    threading.Thread(target=worker, name="jd-stream-gen", daemon=True).start()

    async def event_generator():
        while True:
            item = await run_in_threadpool(event_queue.get)
            if item is None:
                break
            yield item

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@recruitment_router.post("/positions/{position_id}/jd-versions")
async def save_jd_version(position_id: int, payload: SaveJDVersionRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.save_jd_version(position_id, payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/positions/{position_id}/jd-versions")
async def list_jd_versions(position_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        detail = service.get_position_detail(position_id)
        return {"success": True, "data": detail["jd_versions"], "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/positions/{position_id}/jd-versions/{version_id}/activate")
async def activate_jd_version(position_id: int, version_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.activate_jd_version(position_id, version_id, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/candidates/stats")
def get_candidate_stats(position_id: Optional[int] = Query(None), org_code: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    stats = service.get_candidate_stats(position_id=position_id, org_code=org_code)
    return {"success": True, "data": stats, "request_id": str(uuid.uuid4())}


@recruitment_router.get("/candidates/funnel")
def get_recruitment_funnel(position_id: Optional[int] = Query(None), org_code: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    funnel = service.get_recruitment_funnel(position_id=position_id, org_code=org_code)
    return {"success": True, "data": funnel, "request_id": str(uuid.uuid4())}


@recruitment_router.get("/candidates/source-stats")
def get_source_stats(position_id: Optional[int] = Query(None), org_code: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    stats = service.get_source_stats(position_id=position_id, org_code=org_code)
    return {"success": True, "data": stats, "request_id": str(uuid.uuid4())}


@recruitment_router.get("/candidates")
def list_candidates(query: Optional[str] = Query(None), status: Optional[str] = Query(None), position_id: Optional[int] = Query(None), tag: Optional[str] = Query(None), limit: int = Query(0), offset: int = Query(0), org_code: Optional[str] = Query(None), compact: bool = Query(False), sort_by: Optional[str] = Query(None), sort_order: Optional[str] = Query(None), source: Optional[str] = Query(None), time_filter: Optional[str] = Query(None), match_min: Optional[float] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    result = service.list_candidates(query=query, status=status, position_id=position_id, tag=tag, limit=limit, offset=offset, org_code=org_code, compact=compact, sort_by=sort_by, sort_order=sort_order, source=source, time_filter=time_filter, match_min=match_min)
    return {"success": True, "data": {"items": result["items"], "total": result["total"]}, "request_id": str(uuid.uuid4())}


@recruitment_router.post("/candidate-comparisons/preview")
def preview_candidate_comparison(
    payload: CandidateComparisonPreviewRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.preview_candidate_comparison(
            payload.candidate_ids,
            payload.expected_position_id,
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.post("/candidates/export")
async def export_candidates(payload: CandidateExportRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        zip_path = await run_in_threadpool(
            service.export_candidates,
            payload.candidate_ids,
            payload.include_resumes,
            payload.fields,
        )
        zip_filename = Path(zip_path).name
        zip_dir = str(Path(zip_path).parent)

        def cleanup():
            try:
                shutil.rmtree(zip_dir, ignore_errors=True)
            except Exception:
                pass

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=zip_filename,
            background=BackgroundTask(cleanup),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/candidates/check-duplicates")
async def check_candidate_duplicates(
    phone: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    exclude_candidate_id: Optional[int] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    duplicates = service.check_candidate_duplicates(phone=phone, email=email, exclude_candidate_id=exclude_candidate_id)
    return {"success": True, "data": duplicates}


@recruitment_router.post("/candidates/check-duplicates")
def check_candidate_duplicates_body(
    payload: CandidateDuplicateCheckRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    duplicates = service.check_candidate_duplicates(**payload.model_dump())
    return {"success": True, "data": duplicates}


@recruitment_router.get("/candidates/pending-match")
async def get_pending_match_candidates(
    org_code: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """获取待归岗的候选人列表"""
    try:
        data = service.get_pending_match_candidates(org_code)
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/candidates/talent-pool")
async def get_talent_pool_candidates(
    org_code: Optional[str] = Query(None),
    paginated: bool = Query(False),
    limit: int = Query(25),
    offset: int = Query(0),
    stat_filter: Optional[str] = Query(None),
    query: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-talent-pool-view")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """获取人才库候选人（无岗位或状态为talent_pool）"""
    try:
        data = service.get_talent_pool_candidates(
            org_code,
            paginated=paginated,
            limit=limit,
            offset=offset,
            stat_filter=stat_filter,
            query=query,
            source=source,
            tag=tag,
            sort_by=sort_by,
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/candidates/talent-pool/{candidate_id}")
async def get_talent_pool_candidate_detail(candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-talent-pool-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.get_candidate_detail(candidate_id)
        candidate = data.get("candidate") if isinstance(data, dict) else None
        candidate_status = str((candidate or {}).get("status") or "").strip().lower()
        if candidate_status not in {"matching", "unmatched", "talent_pool"}:
            raise HTTPException(status_code=404, detail="Talent pool candidate not found")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.get("/candidates/{candidate_id}")
async def get_candidate_detail(candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        return {"success": True, "data": service.get_candidate_detail(candidate_id), "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.patch("/candidates/{candidate_id}")
async def update_candidate(candidate_id: int, payload: CandidateUpdateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        candidate_update_payload = payload.model_dump(exclude_none=True)
        for nullable_score_field in ("manual_override_score", "manual_override_reason"):
            if nullable_score_field in payload.model_fields_set:
                candidate_update_payload[nullable_score_field] = getattr(payload, nullable_score_field)
        data = service.update_candidate(candidate_id, candidate_update_payload, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/candidates/batch-delete")
async def batch_delete_candidates(
    http_request: Request,
    payload: CandidateBatchDeleteRequest,
    db: Session = Depends(get_db),
    session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.batch_delete_candidates(payload.candidate_ids, session.get("id") or "unknown")
        deleted = data.get("deleted", [])
        skipped = data.get("skipped", [])
        deleted_count = len(deleted)
        try:
            write_audit_log(
                db,
                actor=session,
                request=http_request,
                action="recruitment.candidate.batch_delete",
                target_type="recruitment-candidate",
                target_code=",".join(str(item.get("candidate_id", "")) for item in deleted),
                details={
                    "requested_ids": payload.candidate_ids,
                    "deleted_count": deleted_count,
                    "deleted_candidates": deleted,
                    "skipped": skipped,
                },
            )
        except Exception:
            pass
        return {"success": True, "data": {"deleted_count": deleted_count, "skipped": skipped}, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/candidates/batch-update-position")
async def batch_update_candidates_position(
    http_request: Request,
    payload: CandidateBatchUpdatePositionRequest,
    db: Session = Depends(get_db),
    session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.batch_update_candidates_position(
            payload.candidate_ids,
            payload.position_id,
            session.get("id") or "unknown",
        )
        write_audit_log(
            db,
            actor=session,
            request=http_request,
            action="recruitment.candidate.batch_bind_position",
            target_type="recruitment-candidate",
            target_code="batch",
            details={"position_id": payload.position_id, "candidate_ids": payload.candidate_ids},
        )
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/batch-update-status")
async def batch_update_candidates_status(
    http_request: Request,
    payload: CandidateBatchStatusUpdateRequest,
    db: Session = Depends(get_db),
    session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.batch_update_candidates_status(
            payload.candidate_ids,
            payload.status,
            payload.reason or "",
            session.get("id") or "unknown",
        )
        write_audit_log(
            db,
            actor=session,
            request=http_request,
            action="recruitment.candidate.batch_update_status",
            target_type="recruitment-candidate",
            target_code="batch",
            details={"status": payload.status, "candidate_ids": payload.candidate_ids, "reason": payload.reason},
        )
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.delete("/candidates/{candidate_id}")
async def delete_candidate(
    http_request: Request,
    candidate_id: int,
    db: Session = Depends(get_db),
    session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.delete_candidate(candidate_id, session.get("id") or "unknown")
        try:
            write_audit_log(
                db,
                actor=session,
                request=http_request,
                action="recruitment.candidate.delete",
                target_type="recruitment-candidate",
                target_code=str(data.get("candidate_code") or candidate_id),
                details={
                    "candidate_id": data.get("candidate_id"),
                    "candidate_name": data.get("candidate_name"),
                    "position_id": data.get("position_id"),
                    "removed_resume_count": data.get("removed_resume_count"),
                    "removed_parse_result_count": data.get("removed_parse_result_count"),
                },
            )
        except Exception:
            pass
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except RecruitmentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/status")
async def update_candidate_status(candidate_id: int, payload: CandidateStatusUpdateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_candidate_status(candidate_id, payload.status, payload.reason or "", _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/candidates/{candidate_id}/status-history")
async def get_candidate_status_history(candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.get_candidate_status_history(candidate_id)
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/department-reviews")
async def create_department_review(payload: DepartmentReviewCreateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-review-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_department_review(payload.model_dump(exclude_unset=True), _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/department-reviews/reviewers")
async def list_department_reviewers(
    org_code: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(80, ge=1, le=200),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-review-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.list_department_reviewers(org_code=org_code, query=q, limit=limit)
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/candidates/{candidate_id}/department-reviews")
async def list_candidate_department_reviews(candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-dashboard-view", "recruitment-review-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.list_candidate_department_reviews(candidate_id)
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/department-reviews/my-tasks")
async def list_my_department_review_tasks(status: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-review-view", "recruitment-review-act"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.list_my_department_review_tasks(_session.get("id") or "unknown", status=status)
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/department-reviews/assignments/{assignment_id}/candidate")
async def get_my_department_review_candidate_detail(
    assignment_id: int,
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-review-view", "recruitment-review-act"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.get_department_review_candidate_detail(assignment_id, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.get("/department-reviews/assignments/{assignment_id}/history")
async def list_my_department_review_assignment_history(
    assignment_id: int,
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-review-view", "recruitment-review-act"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.list_department_review_assignment_history(assignment_id, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.get("/department-reviews/assignments/{assignment_id}/resume-files/{resume_file_id}/download")
async def download_my_department_review_resume_file(
    assignment_id: int,
    resume_file_id: int,
    http_request: Request,
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-review-view", "recruitment-review-act"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        payload = service.get_department_review_resume_file_download(
            assignment_id,
            resume_file_id,
            _session.get("id") or "unknown",
        )
        return _resume_download_response(payload, http_request.headers.get("range"))
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.post("/department-reviews/assignments/{assignment_id}/decision")
async def decide_department_review_assignment(assignment_id: int, payload: DepartmentReviewDecisionRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-review-act")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.decide_department_review_assignment(assignment_id, payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.post("/candidates/upload-resumes")
async def upload_resumes(
    request: Request,
    files: List[UploadFile] = File(...),
    position_id: Optional[int] = Query(None),
    org_code: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    city_source: Optional[str] = Query(None),
    match_mode: Optional[str] = Query("position", description="匹配模式: position=指定岗位, none=暂不匹配, smart=AI智能匹配"),
    source: Optional[str] = Query("manual", description="简历来源: manual/boss/liepin/headhunter/other"),
    duplicate_strategy: Optional[str] = Query("skip", description="重复处理策略: skip/overwrite/prompt"),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    staging_root = RECRUITMENT_UPLOAD_ROOT / "_staging"
    staging_root.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix="resume-batch-", dir=str(staging_root)))
    uploaded_files: List[Dict[str, Any]] = []
    try:
        try:
            service.db.rollback()
        except Exception:
            logger.debug("Failed to release recruitment DB session before staging upload", exc_info=True)
        for item in files:
            uploaded_files.append(await _stage_upload_file(item, staging_dir))

        # 根据match_mode处理岗位匹配
        effective_position_id = position_id
        if match_mode == "none":
            # 暂不匹配岗位，设置为None让候选人进入人才库
            effective_position_id = None
        elif match_mode == "smart":
            # AI智能匹配，先不设置岗位，后续由AI匹配
            effective_position_id = None

        rows = service.upload_resume_files(
            uploaded_files, effective_position_id, _session.get("id") or "unknown",
            org_code, city, city_source=city_source,
            match_mode=match_mode,
            source=source, duplicate_strategy=duplicate_strategy
        )
        uploaded_rows = _filter_uploaded_resume_rows(rows)
        skipped_duplicate_count = len(rows) - len(uploaded_rows)

        # 如果是AI智能匹配模式，只提交后台任务，不在上传接口里等待 OCR/识别链路。
        ai_match_result = None
        if match_mode == "smart" and uploaded_rows:
            candidate_ids = [row["id"] for row in uploaded_rows]
            actor_id = _session.get("id") or "unknown"
            session_token = get_script_hub_token_from_request(request)
            governance_session = _with_session_token(request, _session)
            asyncio.create_task(
                _dispatch_ai_position_match_background(
                    candidate_ids,
                    actor_id,
                    governance_session,
                    session_token,
                )
            )
            ai_match_result = {
                "matched_count": 0,
                "total_candidates": len(candidate_ids),
                "background": True,
                "message": "AI岗位匹配已提交后台处理，结果将实时更新",
            }
            logger.info("AI position match scheduled in background: candidate_ids=%s", candidate_ids)
        elif match_mode == "smart" and rows and skipped_duplicate_count:
            ai_match_result = {
                "matched_count": 0,
                "total_candidates": 0,
                "background": False,
                "skipped_duplicate_count": skipped_duplicate_count,
                "message": "重复简历已跳过，未启动AI岗位匹配",
            }

        auto_screen_queued_count = 0
        auto_screen_skipped_existing_live_task_count = 0
        auto_screen_failed_count = 0
        auto_screen_tasks: List[Dict[str, Any]] = []
        batch_id = f"upload-batch-{uuid.uuid4().hex[:12]}" if len(rows) > 1 else None
        for row in rows:
            row["auto_screen_needed"] = bool(row.get("latest_resume_file_id") and row.get("auto_screen_enabled"))
            row["auto_screen_candidate_id"] = row.get("id")
            row["auto_screen_queued"] = False
            row["auto_screen_task_id"] = None
            row["auto_screen_task_status"] = None
            row["auto_screen_reused_existing_task"] = False
            row["auto_screen_error"] = None
            if not row["auto_screen_needed"]:
                continue
            try:
                task = service.enqueue_screen_candidate(
                    row["id"],
                    _session.get("id") or "unknown",
                    skill_ids=[],
                    use_position_skills=True,
                    use_candidate_memory=True,
                    custom_requirements="",
                    dispatch=False,
                    batch_id=batch_id,
                )
                row["auto_screen_task_id"] = task.get("task_id")
                row["auto_screen_task_status"] = task.get("status")
                row["auto_screen_reused_existing_task"] = bool(task.get("reused_existing_task"))
                row["auto_screen_queued"] = not bool(task.get("reused_existing_task"))
                if row["auto_screen_reused_existing_task"]:
                    auto_screen_skipped_existing_live_task_count += 1
                else:
                    auto_screen_queued_count += 1
                auto_screen_tasks.append(task)
            except Exception as exc:
                row["auto_screen_error"] = str(exc)
                auto_screen_failed_count += 1
        if auto_screen_tasks:
            service.process_next_screening_task()

        # 记录审计日志
        try:
            write_audit_log(
                db=service.db,
                actor=_session,
                request=request,
                action="recruitment.candidate.upload",
                target_type="recruitment-candidate",
                target_code=f"batch-{len(uploaded_rows)}",
                details={
                    "uploaded_count": len(uploaded_rows),
                    "skipped_duplicate_count": skipped_duplicate_count,
                    "returned_count": len(rows),
                    "match_mode": match_mode,
                    "source": source,
                    "duplicate_strategy": duplicate_strategy,
                    "position_id": position_id,
                    "auto_screen_queued_count": auto_screen_queued_count,
                    "ai_match_result": ai_match_result,
                    "candidate_ids": [row["id"] for row in rows],
                    "uploaded_candidate_ids": [row["id"] for row in uploaded_rows],
                }
            )
        except Exception as log_exc:
            logger.warning(f"Failed to write audit log for upload: {log_exc}")

        return {
            "success": True,
            "data": {
                "items": rows,
                "uploaded_count": len(uploaded_rows),
                "skipped_duplicate_count": skipped_duplicate_count,
                "returned_count": len(rows),
                "auto_screen_queued_count": auto_screen_queued_count,
                "auto_screen_skipped_existing_live_task_count": auto_screen_skipped_existing_live_task_count,
                "auto_screen_failed_count": auto_screen_failed_count,
                "auto_screen_task_ids": [task.get("task_id") for task in auto_screen_tasks if task.get("task_id")],
                "auto_screen_tasks": auto_screen_tasks,
                "batch_id": batch_id,
                "ai_match_result": ai_match_result,
            },
            "request_id": str(uuid.uuid4()),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    finally:
        await run_in_threadpool(shutil.rmtree, staging_dir, True)


@recruitment_router.post("/candidates/batch-assign-position")
async def batch_assign_position(
    payload: CandidateBatchUpdatePositionRequest,
    update_status: bool = Query(True, description="是否同时更新状态为pending_screening"),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """批量分配岗位并可选更新状态"""
    try:
        data = service.batch_assign_position_with_status(
            payload.candidate_ids,
            payload.position_id,
            _session.get("id") or "unknown",
            update_status=update_status
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/ai-match-positions")
async def trigger_ai_position_match(
    request: Request,
    candidate_ids: List[int],
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """触发AI智能岗位匹配（异步，结果通过SSE推送）"""
    try:
        data = await service.trigger_ai_position_match(
            candidate_ids,
            _session.get("id") or "unknown",
            task_type="ai_position_rematch",
        )

        # 记录审计日志
        write_audit_log(
            db=service.db,
            actor=_session,
            request=request,
            action="recruitment.candidate.ai-match",
            target_type="recruitment-candidate",
            target_code=f"batch-{len(candidate_ids)}",
            details={
                "candidate_ids": candidate_ids,
                "matched_count": data.get("matched_count", 0),
                "total_candidates": data.get("total_candidates", 0),
            }
        )

        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/cancel-match")
async def cancel_match(
    candidate_id: int,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """取消正在匹配的候选人"""
    try:
        data = service.cancel_match_for_candidate(candidate_id, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/move-to-talent-pool")
async def move_to_talent_pool(
    candidate_id: int,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """将候选人移入人才库"""
    try:
        service.move_to_talent_pool(candidate_id, _session.get("id") or "unknown")
        return {"success": True, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/batch-move-to-talent-pool")
async def batch_move_to_talent_pool(
    payload: CandidateBatchDeleteRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service)
):
    """批量移入人才库"""
    try:
        data = service.batch_move_to_talent_pool(payload.candidate_ids, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/parse")
async def trigger_candidate_parse(request: Request, candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "trigger_latest_parse",
            candidate_id,
            _session.get("id") or "unknown",
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/screen")
async def screen_candidate(request: Request, candidate_id: int, payload: CandidateScreenRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "screen_candidate",
            candidate_id,
            _session.get("id") or "unknown",
            skill_ids=payload.skill_ids,
            use_position_skills=payload.use_position_skills,
            use_candidate_memory=payload.use_candidate_memory,
            custom_requirements=payload.custom_requirements or "",
            force_one_pass=payload.force_one_pass,
            force_fallback=payload.force_fallback,
            allow_reuse_parse=payload.allow_reuse_parse,
            allow_score_only_rerun=payload.allow_score_only_rerun,
            screening_mode=payload.screening_mode,
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/screen/start")
async def start_screen_candidate(request: Request, candidate_id: int, payload: CandidateScreenRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "start_screen_candidate",
            candidate_id,
            _session.get("id") or "unknown",
            skill_ids=payload.skill_ids,
            use_position_skills=payload.use_position_skills,
            use_candidate_memory=payload.use_candidate_memory,
            custom_requirements=payload.custom_requirements or "",
            force_one_pass=payload.force_one_pass,
            force_fallback=payload.force_fallback,
            allow_reuse_parse=payload.allow_reuse_parse,
            allow_score_only_rerun=payload.allow_score_only_rerun,
            screening_mode=payload.screening_mode,
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/screen/batch-start")
@recruitment_router.post("/candidates/screen/batch/start")
async def batch_start_screen_candidates(request: Request, payload: CandidateScreenBatchStartRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "batch_start_screen_candidates",
            payload.candidate_ids,
            _session.get("id") or "unknown",
            skill_ids=payload.skill_ids,
            use_position_skills=payload.use_position_skills,
            use_candidate_memory=payload.use_candidate_memory,
            custom_requirements=payload.custom_requirements or "",
            force_one_pass=payload.force_one_pass,
            force_fallback=payload.force_fallback,
            allow_reuse_parse=payload.allow_reuse_parse,
            allow_score_only_rerun=payload.allow_score_only_rerun,
            screening_mode=payload.screening_mode,
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/screen/batch/query")
async def query_screening_batch(payload: CandidateScreenBatchQueryRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "get_screening_batch_status",
            payload.batch_id,
            governance_session=_session,
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/screen/batch/cancel")
async def cancel_screening_batch(request: Request, payload: CandidateScreenBatchCancelRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "cancel_screening_batch",
            payload.batch_id,
            _session.get("id") or "unknown",
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/screen/visible/cancel")
async def cancel_visible_screening_tasks(request: Request, payload: CandidateScreenVisibleCancelRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "cancel_visible_screening_tasks",
            _session.get("id") or "unknown",
            org_code=payload.org_code,
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/score")
async def trigger_candidate_score(request: Request, candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "trigger_latest_score",
            candidate_id,
            _session.get("id") or "unknown",
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/interview-questions")
async def generate_interview_questions(request: Request, candidate_id: int, payload: InterviewQuestionGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "generate_interview_questions",
            candidate_id,
            payload.round_name,
            payload.custom_requirements or "",
            payload.skill_ids,
            _session.get("id") or "unknown",
            use_candidate_memory=payload.use_candidate_memory,
            use_position_skills=payload.use_position_skills,
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/candidates/{candidate_id}/interview-questions/preview-stream")
async def stream_generate_interview_questions(candidate_id: int, payload: InterviewQuestionGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    actor_id = _session.get("id") or "unknown"
    event_queue: "queue.Queue[Optional[str]]" = queue.Queue()
    backend_started_at_ms = int(time.time() * 1000)

    def push(event_name: str, payload_data: Dict[str, Any]) -> None:
        event_queue.put(_encode_sse_event(event_name, payload_data))

    def worker() -> None:
        db = SessionLocal()
        service = RecruitmentService(db).set_permission_context(_session)
        try:
            candidate = service._get_candidate(candidate_id)
            skill_rows, memory_source = service._resolve_interview_skills(
                candidate,
                payload.skill_ids,
                use_candidate_memory=payload.use_candidate_memory,
                use_position_skills=payload.use_position_skills,
            )
            skill_snapshots = service._tailor_skill_snapshots_for_task(service._build_skill_snapshots(skill_rows), "interview")
            related_skill_ids = service._extract_related_skill_ids(skill_snapshots)
            if not candidate.position_id:
                raise ValueError("候选人未绑定岗位，无法生成面试题。请先为候选人分配岗位后再生成面试题。")
            if not skill_snapshots:
                raise ValueError("该岗位未配置面试题Skill，无法生成面试题。请先在岗位配置中绑定面试题Skill后再生成面试题。")
            request_hash = service._build_request_hash(
                "interview_question_generation",
                candidate.id,
                payload.round_name,
                payload.custom_requirements or "",
                related_skill_ids,
                memory_source,
            )
            task_log = service._create_ai_task_log(
                "interview_question_generation",
                created_by=actor_id,
                related_position_id=candidate.position_id,
                related_candidate_id=candidate.id,
                related_skill_ids=related_skill_ids,
                related_skill_snapshots=skill_snapshots,
                memory_source=memory_source,
                request_hash=request_hash,
            )
            first_preview_delta_at_ms: Optional[int] = None

            push("preview.started", {
                "candidate_id": candidate_id,
                "task_log_id": task_log.id,
                "backend_started_at_ms": backend_started_at_ms,
                "memory_source": memory_source,
                "skill_ids": related_skill_ids,
            })

            def on_delta(delta: str) -> None:
                nonlocal first_preview_delta_at_ms
                now_ms = int(time.time() * 1000)
                if first_preview_delta_at_ms is None:
                    first_preview_delta_at_ms = now_ms
                push("preview.delta", {
                    "delta": delta,
                    "delta_length": len(delta),
                    "emitted_at_ms": now_ms,
                })

            preview = service.stream_interview_question_preview(
                candidate_id,
                payload.round_name,
                payload.custom_requirements or "",
                payload.skill_ids,
                actor_id,
                on_delta,
                use_candidate_memory=payload.use_candidate_memory,
                use_position_skills=payload.use_position_skills,
            )
            push("preview.completed", {
                "preview": preview,
                "task_log_id": task_log.id,
                "backend_first_preview_delta_at_ms": first_preview_delta_at_ms,
                "backend_preview_completed_at_ms": int(time.time() * 1000),
            })

            question = service.generate_interview_questions(
                candidate_id,
                payload.round_name,
                payload.custom_requirements or "",
                payload.skill_ids,
                actor_id,
                use_candidate_memory=payload.use_candidate_memory,
                use_position_skills=payload.use_position_skills,
                existing_task_id=task_log.id,
            )
            task_log_payload = service.get_ai_task_log(task_log.id)
            push("final.result", {
                "candidate": service._serialize_candidate_summary(candidate),
                "question": question,
                "task_log": task_log_payload,
                "preview": preview,
                "stream_timing": {
                    "backend_started_at_ms": backend_started_at_ms,
                    "backend_first_preview_delta_at_ms": first_preview_delta_at_ms,
                    "backend_finalized_at_ms": int(time.time() * 1000),
                },
            })
        except Exception as exc:
            push("run.error", {
                "message": str(exc),
                "backend_failed_at_ms": int(time.time() * 1000),
            })
        finally:
            try:
                db.close()
            finally:
                event_queue.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def stream_events():
        while True:
            chunk = event_queue.get()
            if chunk is None:
                break
            yield chunk

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@recruitment_router.post("/candidates/{candidate_id}/interview-questions/start")
async def start_generate_interview_questions(request: Request, candidate_id: int, payload: InterviewQuestionGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "start_generate_interview_questions",
            candidate_id,
            payload.round_name,
            payload.custom_requirements or "",
            payload.skill_ids,
            _session.get("id") or "unknown",
            use_candidate_memory=payload.use_candidate_memory,
            use_position_skills=payload.use_position_skills,
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/interview-questions/{question_id}/download")
async def download_interview_question(question_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        payload = service.get_interview_question_download(question_id)
        quoted_name = quote(payload["file_name"])
        headers = {"Content-Disposition": f"attachment; filename=\"interview-question.html\"; filename*=UTF-8''{quoted_name}"}
        return Response(content=payload["html_content"], media_type="text/html; charset=utf-8", headers=headers)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/candidates/{candidate_id}/interview-schedules")
async def list_interview_schedules(
    candidate_id: int,
    schedule_id: Optional[int] = Query(None, ge=1),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(RECRUITMENT_CANDIDATE_INTERVIEW_SCHEDULE_PERMISSIONS)),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    can_view_all = (
        _session_has_permission(_session, "recruitment-dashboard-view")
        or _session_has_permission(_session, "recruitment-interview-manage")
    )
    try:
        data = service.list_interview_schedules(
            candidate_id,
            actor_id=None if can_view_all else (_session.get("id") or "unknown"),
            schedule_id=schedule_id,
        )
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404 if can_view_all else 403, detail=str(exc))
    except Exception as exc:
        logger.error("list_interview_schedules failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/interview-availability/my")
async def list_my_interview_availability(
    start_at: Optional[str] = Query(None),
    end_at: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-interview-view", "recruitment-interview-act"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.list_my_interview_availability(
            _session.get("id") or "unknown",
            start_at=start_at,
            end_at=end_at,
        )
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.put("/interview-availability/my")
@recruitment_router.post("/interview-availability/my")
async def replace_my_interview_availability(
    payload: InterviewAvailabilityReplaceRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-interview-act")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.replace_my_interview_availability(payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/interview-availability")
async def list_interview_availability(
    user_codes: Optional[str] = Query(None),
    start_at: Optional[str] = Query(None),
    end_at: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-candidate-manage", "recruitment-interview-manage"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        codes = [code.strip() for code in (user_codes or "").split(",") if code.strip()]
        data = service.list_interview_availability(
            interviewer_user_codes=codes,
            start_at=start_at,
            end_at=end_at,
        )
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/interviews/my")
async def list_my_interview_tasks(
    status: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-interview-view", "recruitment-interview-act"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.list_my_interview_tasks(_session.get("id") or "unknown", status=status)
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/interviews/candidates/{candidate_id}")
async def get_my_interview_candidate_detail(
    candidate_id: int,
    schedule_id: Optional[int] = Query(None, ge=1),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(RECRUITMENT_INTERVIEW_SCOPED_PERMISSIONS)),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.get_interview_candidate_detail(
            candidate_id,
            _session.get("id") or "unknown",
            schedule_id=schedule_id,
            can_manage=_session_has_permission(_session, "recruitment-interview-manage"),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.get("/interviews/resume-files/{resume_file_id}/download")
async def download_my_interview_resume_file(
    resume_file_id: int,
    http_request: Request,
    schedule_id: Optional[int] = Query(None, ge=1),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(RECRUITMENT_INTERVIEW_SCOPED_PERMISSIONS)),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        payload = service.get_interview_resume_file_download(
            resume_file_id,
            _session.get("id") or "unknown",
            schedule_id=schedule_id,
            can_manage=_session_has_permission(_session, "recruitment-interview-manage"),
        )
        return _resume_download_response(payload, http_request.headers.get("range"))
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.get("/interviews")
async def list_interview_tasks(
    status: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-interview-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.list_interview_tasks(status=status)
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/interviews/interviewers")
async def list_interviewers(
    org_code: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(80, ge=1, le=200),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-candidate-manage", "recruitment-interview-manage"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.list_interviewers(org_code=org_code, query=q, limit=limit)
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.post("/interview-schedules")
async def create_interview_schedule(payload: InterviewScheduleCreateRequest, _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-candidate-manage", "recruitment-interview-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_interview_schedule(payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.patch("/interview-schedules/{schedule_id}")
async def update_interview_schedule(schedule_id: int, payload: InterviewScheduleUpdateRequest, _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-candidate-manage", "recruitment-interview-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_interview_schedule(schedule_id, payload.model_dump(exclude_none=True), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.delete("/interview-schedules/{schedule_id}")
async def delete_interview_schedule(schedule_id: int, _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-candidate-manage", "recruitment-interview-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_interview_schedule(schedule_id, _session.get("id") or "unknown")
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.post("/interview-schedules/{schedule_id}/result")
async def submit_interview_schedule_result(schedule_id: int, payload: InterviewScheduleResultRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-interview-act")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.submit_interview_schedule_result(schedule_id, payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/candidates/{candidate_id}/follow-ups")
async def list_follow_ups(candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.list_follow_ups(candidate_id)
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/follow-ups")
async def create_follow_up(payload: FollowUpCreateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_follow_up(payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.delete("/follow-ups/{follow_up_id}")
async def delete_follow_up(follow_up_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_follow_up(follow_up_id, _session.get("id") or "unknown")
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/candidates/{candidate_id}/offers")
async def list_offers(candidate_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.list_offers(candidate_id)
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/offers")
async def create_offer(payload: OfferCreateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_offer(payload.model_dump(), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.patch("/offers/{offer_id}")
async def update_offer(offer_id: int, payload: OfferUpdateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_offer(offer_id, payload.model_dump(exclude_none=True), _session.get("id") or "unknown")
        return {"success": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.delete("/offers/{offer_id}")
async def delete_offer(offer_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_offer(offer_id, _session.get("id") or "unknown")
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/resume-files/{resume_file_id}/download")
async def download_resume_file(http_request: Request, resume_file_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        payload = service.get_resume_file_download(resume_file_id)
        return _resume_download_response(payload, http_request.headers.get("range"))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.delete("/resume-files/{resume_file_id}")
async def delete_resume_file(
    http_request: Request,
    resume_file_id: int,
    db: Session = Depends(get_db),
    session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-candidate-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    try:
        data = service.delete_resume_file(resume_file_id, session.get("id") or "unknown")
        try:
            write_audit_log(
                db,
                actor=session,
                request=http_request,
                action="recruitment.resume-file.delete",
                target_type="recruitment-resume-file",
                target_code=str(resume_file_id),
                details={
                    "resume_file_id": resume_file_id,
                    "candidate_id": data.get("candidate_id"),
                    "remaining_resume_count": data.get("remaining_resume_count"),
                },
            )
        except Exception:
            pass
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except RecruitmentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/skills")
def list_skills(query: Optional[str] = Query(None), task_type: Optional[str] = Query(None), org_code: Optional[List[str]] = Query(None), limit: int = Query(0, ge=0, le=100), offset: int = Query(0, ge=0), summary: bool = Query(False), _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-skill-view", "recruitment-skill-bind", "recruitment-skill-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.list_skills(query=query, task_type=task_type, org_codes=org_code, limit=limit, offset=offset, summary=summary)
        total = int(data.get("total") or 0) if isinstance(data, dict) else len(data)
        return {"success": True, "data": data, "total": total, "request_id": str(uuid.uuid4())}
    except Exception as exc:
        logger.error("list_skills failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.get("/skills/{skill_id}")
def get_skill_detail(skill_id: int, _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-skill-view", "recruitment-skill-bind", "recruitment-skill-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        return {"success": True, "data": service.get_skill_detail(skill_id), "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/skills")
async def create_skill(http_request: Request, payload: SkillUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-skill-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.create_skill(payload.model_dump(), _session.get("id") or "unknown")
    write_audit_log(db, actor=_session, request=http_request, action="recruitment.skill.create", target_type="recruitment-skill", target_code=str(data.get("skill_code") or data.get("id")), target_org_code=data.get("org_code"), details={"name": data.get("name"), "share_policy": data.get("share_policy")})
    return {"success": True, "data": data, "request_id": str(uuid.uuid4())}


@recruitment_router.patch("/skills/{skill_id}")
async def update_skill(http_request: Request, skill_id: int, payload: SkillUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-skill-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_skill(skill_id, payload.model_dump(), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.skill.update", target_type="recruitment-skill", target_code=str(data.get("skill_code") or skill_id), target_org_code=data.get("org_code"), details={"skill_id": skill_id, "share_policy": data.get("share_policy")})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.delete("/skills/{skill_id}")
async def delete_skill(http_request: Request, skill_id: int, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-skill-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_skill(skill_id, _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.skill.delete", target_type="recruitment-skill", target_code=str(skill_id), target_org_code=_session.get("primaryOrgCode"), details={"skill_id": skill_id})
        return {"success": True, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/skills/{skill_id}/toggle")
async def toggle_skill(skill_id: int, enabled: bool = Query(...), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-skill-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.toggle_skill(skill_id, enabled, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/skills/generate-content")
async def generate_skill_content_stream(payload: SkillContentGenerateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-skill-manage"))):
    event_queue: "queue.Queue[Optional[str]]" = queue.Queue()

    def push(event_name: str, data: Dict[str, Any]) -> None:
        event_queue.put(_encode_sse_event(event_name, data))

    def extract_completed_content(value: Any) -> str:
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, dict):
            for key in ("markdown", "text", "content"):
                extracted = extract_completed_content(value.get(key))
                if extracted:
                    return extracted
            html = value.get("html")
            if isinstance(html, str) and html.strip():
                return html.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n").strip()
        return ""

    def worker() -> None:
        db = SessionLocal()
        service = RecruitmentService(db).set_permission_context(_session)
        try:
            chunks: List[str] = []
            def on_delta(delta: str) -> None:
                chunks.append(delta)
                push("delta", {"delta": delta})
            def on_task_created(task_id: int) -> None:
                push("task_created", {"task_id": task_id})
            result = service.generate_skill_content_stream(payload.role_name, payload.extra_requirements or "", payload.position_jd or "", on_delta, actor_id=_session.get("id") or "unknown", on_task_created=on_task_created)
            completed_content = extract_completed_content(result.get("content") if isinstance(result, dict) else result)
            push("completed", {"content": "".join(chunks) or completed_content})
        except RecruitmentTaskCancelled:
            push("cancelled", {"message": "已停止生成"})
        except Exception as exc:
            push("error", {"message": str(exc)})
        finally:
            event_queue.put(None)
            db.close()

    threading.Thread(target=worker, name="skill-content-gen", daemon=True).start()

    async def event_generator():
        while True:
            item = await run_in_threadpool(event_queue.get)
            if item is None:
                break
            yield item

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@recruitment_router.patch("/resource-governance/{resource_kind}/{resource_id}")
async def update_resource_governance(
    http_request: Request,
    resource_kind: str,
    resource_id: int,
    payload: RecruitmentResourceGovernanceUpdateRequest,
    db: Session = Depends(get_db),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("resource-sharing-manage")),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    patch = payload.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="No governance fields provided")

    try:
        if resource_kind == "skill":
            data = service.update_skill(resource_id, patch, _session.get("id") or "unknown")
            target_type = "recruitment-skill"
            target_code = str(data.get("skill_code") or resource_id)
            sensitivity = "normal"
        elif resource_kind == "model":
            model_patch = dict(patch)
            if "is_enabled" in model_patch:
                model_patch["is_active"] = model_patch.pop("is_enabled")
            data = service.update_llm_config(resource_id, model_patch, _session.get("id") or "unknown")
            target_type = "recruitment-llm-config"
            target_code = str(data.get("config_key") or resource_id)
            sensitivity = "sensitive"
        elif resource_kind == "mail-sender":
            data = service.update_mail_sender(resource_id, patch, _session.get("id") or "unknown")
            target_type = "recruitment-mail-sender"
            target_code = str(resource_id)
            sensitivity = "sensitive"
        elif resource_kind == "mail-recipient":
            data = service.update_mail_recipient(resource_id, patch, _session.get("id") or "unknown")
            target_type = "recruitment-mail-recipient"
            target_code = str(resource_id)
            sensitivity = "normal"
        else:
            raise HTTPException(status_code=400, detail="Unsupported resource kind")

        write_audit_log(
            db,
            actor=_session,
            request=http_request,
            action="recruitment.resource-governance.update",
            target_type=target_type,
            target_code=target_code,
            target_org_code=data.get("org_code"),
            sensitivity=sensitivity,
            details={
                "resource_kind": resource_kind,
                "resource_id": resource_id,
                "org_code": data.get("org_code"),
                "scope_level": data.get("scope_level"),
                "share_policy": data.get("share_policy"),
                "allow_sub_org_use": data.get("allow_sub_org_use"),
                "allow_copy": data.get("allow_copy"),
                "is_enabled": data.get("is_enabled", data.get("is_active")),
            },
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/resource-governance/{resource_kind}/{resource_id}/copy")
async def copy_resource(
    http_request: Request,
    resource_kind: str,
    resource_id: int,
    payload: RecruitmentResourceCopyRequest,
    db: Session = Depends(get_db),
    _session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-skill-manage", "recruitment-llm-config-manage", "recruitment-mail-sender-manage", "recruitment-mail-config-manage"])),
    service: RecruitmentService = Depends(get_recruitment_service),
):
    _ensure_resource_copy_allowed(_session, resource_kind)
    try:
        if resource_kind == "skill":
            data = service.copy_skill(resource_id, _session.get("id") or "unknown", payload.target_org_code)
            target_type = "recruitment-skill"
            target_code = str(data.get("skill_code") or data.get("id"))
            sensitivity = "normal"
        elif resource_kind == "model":
            data = service.copy_llm_config(resource_id, _session.get("id") or "unknown", payload.target_org_code)
            target_type = "recruitment-llm-config"
            target_code = str(data.get("config_key") or data.get("id"))
            sensitivity = "sensitive"
        elif resource_kind == "mail-sender":
            data = service.copy_mail_sender(resource_id, _session.get("id") or "unknown", payload.target_org_code)
            target_type = "recruitment-mail-sender"
            target_code = str(data.get("id"))
            sensitivity = "sensitive"
        elif resource_kind == "mail-recipient":
            data = service.copy_mail_recipient(resource_id, _session.get("id") or "unknown", payload.target_org_code)
            target_type = "recruitment-mail-recipient"
            target_code = str(data.get("id"))
            sensitivity = "normal"
        else:
            raise HTTPException(status_code=400, detail="Unsupported resource kind")

        write_audit_log(
            db,
            actor=_session,
            request=http_request,
            action="recruitment.resource-governance.copy",
            target_type=target_type,
            target_code=target_code,
            target_org_code=data.get("org_code"),
            sensitivity=sensitivity,
            details={
                "resource_kind": resource_kind,
                "source_resource_id": resource_id,
                "target_org_code": data.get("org_code"),
            },
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@recruitment_router.get("/llm-configs")
def list_llm_configs(_session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-llm-config-view", "recruitment-llm-config-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.list_llm_configs()
    return {"success": True, "data": data, "total": len(data), "request_id": str(uuid.uuid4())}


@recruitment_router.post("/llm-configs")
async def create_llm_config(http_request: Request, payload: RecruitmentLLMConfigUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-llm-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_llm_config(payload.model_dump(), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.llm-config.create", target_type="recruitment-llm-config", target_code=str(data.get("config_key") or data.get("id")), target_org_code=data.get("org_code"), sensitivity="sensitive", details={"config_key": data.get("config_key"), "provider": data.get("provider"), "share_policy": data.get("share_policy"), "api_key_value": payload.api_key_value})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.patch("/llm-configs/{config_id}")
async def update_llm_config(http_request: Request, config_id: int, payload: RecruitmentLLMConfigUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-llm-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_llm_config(config_id, payload.model_dump(exclude_none=True), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.llm-config.update", target_type="recruitment-llm-config", target_code=str(data.get("config_key") or config_id), target_org_code=data.get("org_code"), sensitivity="sensitive", details={"config_id": config_id, "share_policy": data.get("share_policy"), "api_key_value": payload.api_key_value})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        detail = str(exc)
        is_not_found = "不存在" in detail or "不存在或已删除" in detail
        raise HTTPException(status_code=404 if is_not_found else 400, detail=detail)


@recruitment_router.delete("/llm-configs/{config_id}")
async def delete_llm_config(http_request: Request, config_id: int, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-llm-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_llm_config(config_id, _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.llm-config.delete", target_type="recruitment-llm-config", target_code=str(config_id), target_org_code=_session.get("primaryOrgCode"), sensitivity="sensitive", details={"config_id": config_id})
        return {"success": True, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/mail-senders")
def list_mail_senders(_session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-mail-view", "recruitment-mail-sender-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.list_mail_senders()
        return {"success": True, "data": data, "total": len(data), "request_id": str(uuid.uuid4())}
    except Exception as exc:
        logger.error("list_mail_senders failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@recruitment_router.post("/mail-senders")
async def create_mail_sender(http_request: Request, payload: RecruitmentMailSenderUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-sender-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_mail_sender(payload.model_dump(), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-sender.create", target_type="recruitment-mail-sender", target_code=str(data.get("id")), target_org_code=data.get("org_code"), sensitivity="sensitive", details={"name": data.get("name"), "from_email": data.get("from_email"), "share_policy": data.get("share_policy"), "password": payload.password})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.patch("/mail-senders/{sender_id}")
async def update_mail_sender(http_request: Request, sender_id: int, payload: RecruitmentMailSenderUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-sender-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_mail_sender(sender_id, payload.model_dump(exclude_none=True), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-sender.update", target_type="recruitment-mail-sender", target_code=str(sender_id), target_org_code=data.get("org_code"), sensitivity="sensitive", details={"sender_id": sender_id, "share_policy": data.get("share_policy"), "password": payload.password})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.delete("/mail-senders/{sender_id}")
async def delete_mail_sender(http_request: Request, sender_id: int, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-sender-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_mail_sender(sender_id, _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-sender.delete", target_type="recruitment-mail-sender", target_code=str(sender_id), target_org_code=_session.get("primaryOrgCode"), sensitivity="sensitive", details={"sender_id": sender_id})
        return {"success": True, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/mail-recipients")
def list_mail_recipients(_session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-mail-view", "recruitment-mail-config-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.list_mail_recipients()
    return {"success": True, "data": data, "total": len(data), "request_id": str(uuid.uuid4())}


@recruitment_router.get("/mail-auto-config")
def get_mail_auto_push_global_config(_session: Dict[str, Any] = Depends(require_script_hub_any_permission(["recruitment-mail-view", "recruitment-mail-config-manage"])), service: RecruitmentService = Depends(get_recruitment_service)):
    return {"success": True, "data": service.get_mail_auto_push_global_config(), "request_id": str(uuid.uuid4())}


@recruitment_router.patch("/mail-auto-config")
async def update_mail_auto_push_global_config(http_request: Request, payload: RecruitmentMailAutoPushGlobalConfigRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.update_mail_auto_push_global_config(payload.model_dump())
    write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-auto-config.update", target_type="recruitment-mail-auto-config", target_code="global", target_org_code=_session.get("primaryOrgCode"), details=data)
    return {"success": True, "data": data, "request_id": str(uuid.uuid4())}


@recruitment_router.post("/mail-recipients")
async def create_mail_recipient(http_request: Request, payload: RecruitmentMailRecipientUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_mail_recipient(payload.model_dump(), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-recipient.create", target_type="recruitment-mail-recipient", target_code=str(data.get("id")), target_org_code=data.get("org_code"), details={"name": data.get("name"), "email": data.get("email"), "share_policy": data.get("share_policy")})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.patch("/mail-recipients/{recipient_id}")
async def update_mail_recipient(http_request: Request, recipient_id: int, payload: RecruitmentMailRecipientUpsertRequest, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.update_mail_recipient(recipient_id, payload.model_dump(exclude_none=True), _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-recipient.update", target_type="recruitment-mail-recipient", target_code=str(recipient_id), target_org_code=data.get("org_code"), details={"recipient_id": recipient_id, "share_policy": data.get("share_policy")})
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.delete("/mail-recipients/{recipient_id}")
async def delete_mail_recipient(http_request: Request, recipient_id: int, db: Session = Depends(get_db), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-config-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        service.delete_mail_recipient(recipient_id, _session.get("id") or "unknown")
        write_audit_log(db, actor=_session, request=http_request, action="recruitment.mail-recipient.delete", target_type="recruitment-mail-recipient", target_code=str(recipient_id), target_org_code=_session.get("primaryOrgCode"), details={"recipient_id": recipient_id})
        return {"success": True, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/resume-mail-dispatches")
def list_resume_mail_dispatches(org_code: Optional[List[str]] = Query(None), limit: int = Query(0, ge=0, le=100), offset: int = Query(0, ge=0), summary: bool = Query(False), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.list_resume_mail_dispatches(org_codes=org_code, limit=limit, offset=offset, summary=summary)
    total = int(data.get("total") or 0) if isinstance(data, dict) else len(data)
    return {"success": True, "data": data, "total": total, "request_id": str(uuid.uuid4())}


@recruitment_router.get("/resume-mail-dispatches/{dispatch_id}")
def get_resume_mail_dispatch(dispatch_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        return {"success": True, "data": service.get_resume_mail_dispatch(dispatch_id), "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/resume-mail-dispatches/send")
async def send_resume_mail_dispatch(request: Request, payload: RecruitmentResumeMailSendRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-mail-send"))):
    try:
        data = await run_in_threadpool(
            _run_recruitment_service_call,
            "send_resume_mail_dispatch",
            payload.model_dump(),
            _session.get("id") or "unknown",
            governance_session=_with_session_token(request, _session),
        )
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@recruitment_router.get("/ai-task-logs/stats")
async def get_ai_task_log_stats(task_type: Optional[str] = Query(None), org_code: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-log-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    stats = service.get_ai_task_log_stats(task_type=task_type, org_code=org_code)
    return {"success": True, "data": stats, "request_id": str(uuid.uuid4())}


@recruitment_router.get("/ai-task-logs")
async def list_ai_task_logs(task_type: Optional[str] = Query(None), status: Optional[str] = Query(None), limit: int = Query(20), offset: int = Query(0), org_code: Optional[str] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-log-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    result = service.list_ai_task_logs(task_type=task_type, status=status, limit=limit, offset=offset, org_code=org_code)
    return {"success": True, "data": {"items": result["items"], "total": result["total"]}, "request_id": str(uuid.uuid4())}


@recruitment_router.get("/ai-task-logs/{task_id}")
async def get_ai_task_log(task_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-log-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        return {"success": True, "data": service.get_ai_task_log(task_id), "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/ai-task-logs/{task_id}/cancel")
async def cancel_ai_task(task_id: int, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        return {"success": True, "data": service.cancel_ai_task(task_id, _session.get("id") or "unknown"), "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.post("/publish-tasks")
async def create_publish_task(payload: PublishTaskCreateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-position-manage")), service: RecruitmentService = Depends(get_recruitment_service)):
    try:
        data = service.create_publish_task(payload.position_id, payload.target_platform, payload.mode, _session.get("id") or "unknown")
        return {"success": True, "data": data, "request_id": str(uuid.uuid4())}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@recruitment_router.get("/publish-tasks")
async def list_publish_tasks(position_id: Optional[int] = Query(None), _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-dashboard-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.list_publish_tasks(position_id=position_id)
    return {"success": True, "data": data, "total": len(data), "request_id": str(uuid.uuid4())}


@recruitment_router.get("/chat/context")
async def get_chat_context(_session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-assistant-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    return {"success": True, "data": service.get_chat_context(_session.get("id") or "unknown"), "request_id": str(uuid.uuid4())}


@recruitment_router.post("/chat/context")
async def update_chat_context(payload: RecruitmentChatContextUpdateRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-assistant-view")), service: RecruitmentService = Depends(get_recruitment_service)):
    data = service.update_chat_context(_session.get("id") or "unknown", payload.position_id, payload.skill_ids, payload.candidate_id)
    return {"success": True, "data": data, "request_id": str(uuid.uuid4())}


@recruitment_router.post("/chat")
async def chat(request: Request, payload: RecruitmentChatRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    data = await run_in_threadpool(
        _run_recruitment_service_call,
        "chat",
        _session.get("id") or "unknown",
        _session.get("name") or "unknown",
        payload.message,
        payload.context,
        governance_session=_with_session_token(request, _session),
    )
    return {"success": True, "data": data, "request_id": str(uuid.uuid4())}


@recruitment_router.post("/chat/start")
async def start_chat(request: Request, payload: RecruitmentChatRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    data = await run_in_threadpool(
        _run_recruitment_service_call,
        "start_chat",
        _session.get("id") or "unknown",
        _session.get("name") or "unknown",
        payload.message,
        payload.context,
        governance_session=_with_session_token(request, _session),
    )
    return {"success": True, "data": data, "request_id": str(uuid.uuid4())}


@recruitment_router.post("/chat/stream")
async def stream_chat(payload: RecruitmentChatRequest, _session: Dict[str, Any] = Depends(require_script_hub_permission("recruitment-process-execute"))):
    actor_id = _session.get("id") or "unknown"
    actor_name = _session.get("name") or "unknown"
    event_queue: "queue.Queue[Optional[str]]" = queue.Queue()
    backend_started_at_ms = int(time.time() * 1000)

    def push(event_name: str, payload_data: Dict[str, Any]) -> None:
        event_queue.put(_encode_sse_event(event_name, payload_data))

    def worker() -> None:
        db = SessionLocal()
        service = RecruitmentService(db).set_permission_context(_session)
        try:
            current_context = payload.context or {}
            skill_ids = current_context.get("skill_ids") or []
            push("preview.started", {
                "backend_started_at_ms": backend_started_at_ms,
                "position_id": current_context.get("position_id"),
                "candidate_id": current_context.get("candidate_id"),
                "skill_ids": skill_ids,
            })
            first_preview_delta_at_ms: Optional[int] = None
            preview_chunks: List[str] = []

            def on_delta(delta: str) -> None:
                nonlocal first_preview_delta_at_ms
                now_ms = int(time.time() * 1000)
                if first_preview_delta_at_ms is None:
                    first_preview_delta_at_ms = now_ms
                preview_chunks.append(delta)
                push("preview.delta", {
                    "delta": delta,
                    "delta_length": len(delta),
                    "emitted_at_ms": now_ms,
                })

            result = service.stream_chat(
                actor_id,
                actor_name,
                payload.message,
                payload.context,
                on_delta,
            )
            push("preview.completed", {
                "reply_length": len("".join(preview_chunks)),
                "first_preview_delta_at_ms": first_preview_delta_at_ms,
                "completed_at_ms": int(time.time() * 1000),
            })
            push("final.result", result)
        except RecruitmentTaskCancelled:
            push("run.cancelled", {
                "reason": "user_cancelled",
            })
        except Exception as exc:
            push("run.error", {
                "message": str(exc),
                "retryable": False,
            })
        finally:
            event_queue.put(None)
            db.close()

    threading.Thread(target=worker, name="recruitment-chat-stream", daemon=True).start()

    async def event_generator():
        while True:
            item = await run_in_threadpool(event_queue.get)
            if item is None:
                break
            yield item

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
