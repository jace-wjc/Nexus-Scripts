import json
import logging
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from ..database import get_db
from ..models import (
    ChatRequest,
    DeliveryDetailRequest,
    DeliveryLoginRequest,
    DeliverySubmitRequest,
    DeliveryTaskRequest,
    DeliveryWorkerInfoRequest,
    OCRProcessRequest,
)
from ..ocr_service import run_ocr_process, set_abort_signal
from ..script_hub_session import require_script_hub_permission
from ..services import MobileTaskService
from ..services.ai_service import AiService
from ..services.script_hub_audit_service import write_audit_log
from ..upload_paths import safe_upload_destination, safe_upload_relative_path

logger = logging.getLogger(__name__)
workbench_router = APIRouter(tags=["工作台工具"])

OUTPUTS_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)


def get_ai_service():
    return AiService()


@workbench_router.post("/ocr/process", tags=["OCR处理"])
async def process_ocr(
    request: OCRProcessRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("ocr-tool")),
):
    request_id = str(uuid.uuid4())
    logger.info(f"[OCR本地模式] 开始 | 请求ID: {request_id}")
    logger.info(f"[OCR本地模式] 参数: Excel={request.excel_path}, 附件={request.source_folder}, 模式={request.mode}")

    return StreamingResponse(
        run_ocr_process(
            excel_path=request.excel_path,
            source_folder=request.source_folder,
            target_excel_path=request.target_excel_path,
            mode=request.mode,
        ),
        media_type="application/x-ndjson",
    )


@workbench_router.post("/ocr/process-upload", tags=["OCR处理"])
async def process_ocr_upload(
    http_request: Request,
    mode: int = Form(1),
    excel_file: UploadFile = File(...),
    image_files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("ocr-tool")),
):
    request_id = str(uuid.uuid4())
    logger.info(f"[OCR上传模式] 开始 | 请求ID: {request_id}")
    # 在读取内容、记录审计或创建临时目录前验证全部路径，保留合法目录层级。
    try:
        safe_upload_relative_path(excel_file.filename or "upload.xlsx")
        for image in image_files:
            if image.filename:
                safe_upload_relative_path(image.filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid upload path") from None
    logger.info(f"[OCR上传模式] 参数: Excel={excel_file.filename}, 图片数={len(image_files)}, 模式={mode}")
    if http_request is not None:
        write_audit_log(
            db,
            actor=_session,
            request=http_request,
            action="ocr.process.upload",
            target_type="ocr-job",
            target_code=request_id,
            details={"mode": mode, "image_count": len(image_files), "excel_file": excel_file.filename},
        )

    excel_content = await excel_file.read()
    excel_filename = excel_file.filename or "upload.xlsx"

    image_data_list = []
    for image in image_files:
        if image.filename:
            content = await image.read()
            image_data_list.append({
                "filename": image.filename,
                "content": content,
            })

    total_size_mb = round(sum(len(item["content"]) for item in image_data_list) / 1024 / 1024, 2)
    logger.info(f"[OCR上传模式] 文件接收完成 | 请求ID: {request_id} | 图片总大小: {total_size_mb}MB")

    if image_data_list:
        logger.info(f"[OCR上传模式] 图片路径示例: {image_data_list[0]['filename']}")

    def process_generator():
        temp_dir = tempfile.mkdtemp()
        try:
            temp_path = Path(temp_dir)
            source_folder = temp_path / "source_images"
            source_folder.mkdir()

            excel_path = safe_upload_destination(temp_path, "input" + Path(excel_filename).suffix.lower())
            with open(excel_path, "wb") as file_handle:
                file_handle.write(excel_content)

            yield json.dumps({"type": "log", "content": f"已接收 Excel: {excel_filename}"}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "log", "content": f"mode 参数值: {mode}"}, ensure_ascii=False) + "\n"

            count = 0
            first_folder_logged = False
            for image_data in image_data_list:
                original_path = image_data["filename"]
                parts = original_path.replace("\\", "/").split("/")
                new_path = "/".join(parts)

                if not first_folder_logged:
                    yield json.dumps({"type": "log", "content": f"原始路径: {original_path} → 映射为: {new_path}"}, ensure_ascii=False) + "\n"
                    first_folder_logged = True

                target_path = safe_upload_destination(source_folder, new_path)
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with open(target_path, "wb") as file_handle:
                    file_handle.write(image_data["content"])
                count += 1

            yield json.dumps({"type": "log", "content": f"已接收图片文件: {count} 个"}, ensure_ascii=False) + "\n"

            output_filename = f"ocr_result_{uuid.uuid4().hex[:8]}.xlsx"
            target_excel_path = os.path.join(OUTPUTS_DIR, output_filename)

            ocr_gen = run_ocr_process(
                excel_path=str(excel_path),
                source_folder=str(source_folder),
                target_excel_path=target_excel_path,
                mode=mode,
                request_id=request_id,
            )

            for item in ocr_gen:
                yield item

            if os.path.exists(target_excel_path):
                yield json.dumps({
                    "type": "result",
                    "success": True,
                    "message": "处理完成",
                    "download_url": f"outputs/{output_filename}",
                }, ensure_ascii=False) + "\n"
            else:
                yield json.dumps({
                    "type": "result",
                    "success": False,
                    "message": "未生成结果文件",
                }, ensure_ascii=False) + "\n"
        finally:
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                logger.debug(f"Failed to cleanup temp_dir {temp_dir}: {e}")

    return StreamingResponse(process_generator(), media_type="application/x-ndjson")


@workbench_router.post("/ocr/abort/{request_id}", tags=["OCR处理"])
async def abort_ocr(
    request_id: str,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("ocr-tool")),
):
    logger.info(f"[OCR中止] 收到中止请求 | 请求ID: {request_id}")
    set_abort_signal(request_id)
    return {"success": True, "message": f"已发送中止信号: {request_id}"}


@workbench_router.post("/delivery/login", tags=["交付物工具"])
async def delivery_login(
    request: DeliveryLoginRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    logger.info(f"[交付物-登录] 手机号: {request.mobile}")
    service = MobileTaskService(environment=request.environment, silent=True)
    result = service.delivery_login(request.mobile, request.code)
    if result.get("success"):
        logger.info("[交付物-登录] ✅ 登录成功")
    else:
        logger.warning(f"[交付物-登录] ❌ 登录失败: {result.get('msg')}")
    return result


@workbench_router.post("/delivery/tasks", tags=["交付物工具"])
async def delivery_tasks(
    request: DeliveryTaskRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    logger.info(f"[交付物-任务列表] 获取任务列表, status={request.status}")
    service = MobileTaskService(environment=request.environment, silent=True)
    return service.delivery_get_tasks(request.token, request.status)


@workbench_router.post("/delivery/detail", tags=["交付物工具"])
async def delivery_detail(
    request: DeliveryDetailRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    logger.info(
        "[交付物-详情] 获取详情, id=%s, taskAssignId=%s",
        request.id,
        request.taskAssignId,
    )
    service = MobileTaskService(environment=request.environment, silent=True)
    return service.delivery_detail(
        request.token,
        detail_id=request.id,
        task_assign_id=request.taskAssignId,
        task_staff_id=request.taskStaffId,
        task_id=request.taskId,
    )


@workbench_router.post("/delivery/upload", tags=["交付物工具"])
async def delivery_upload(
    http_request: Request,
    environment: str = Form(...),
    token: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    logger.info(f"[交付物-上传] 文件名: {file.filename}")
    service = MobileTaskService(environment=environment, silent=True)
    content = await file.read()
    result = service.delivery_upload(token, content, file.filename)
    if result.get("code") == 0:
        logger.info(f"[交付物-上传] ✅ 上传成功, URL: {result.get('data', '无')}")
        if http_request is not None:
            write_audit_log(
                db,
                actor=_session,
                request=http_request,
                action="delivery.upload",
                target_type="delivery-file",
                target_code=file.filename or "unknown-file",
                details={"environment": environment, "success": True},
            )
    else:
        logger.warning(f"[交付物-上传] ❌ 上传失败: {result.get('msg')}")
    return result


@workbench_router.post("/delivery/submit", tags=["交付物工具"])
async def delivery_submit(
    http_request: Request,
    request: DeliverySubmitRequest,
    db: Session = Depends(get_db),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    service = MobileTaskService(environment=request.environment, silent=True)
    result = service.delivery_submit(request.token, request.payload)
    write_audit_log(
        db,
        actor=_session,
        request=http_request,
        action="delivery.submit",
        target_type="delivery-task",
        target_code=str(request.payload.get("taskId") or request.payload.get("taskAssignId") or "unknown-task"),
        details={
            "environment": request.environment,
            "attachment_count": len(request.payload.get("attachments") or []),
            "success": result.get("code") == 0,
        },
    )
    return result


@workbench_router.post("/delivery/worker-info", tags=["交付物工具"])
async def delivery_worker_info(
    request: DeliveryWorkerInfoRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    logger.info("[交付物-用户信息] 获取用户信息")
    service = MobileTaskService(environment=request.environment, silent=True)
    return service.delivery_worker_info(request.token)


@workbench_router.post("/delivery/worker-index", tags=["交付物工具"])
async def delivery_worker_index(
    request: DeliveryWorkerInfoRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("delivery-tool")),
):
    logger.info("[交付物-用户首页] 获取用户首页信息")
    service = MobileTaskService(environment=request.environment, silent=True)
    return service.delivery_worker_index(request.token)


@workbench_router.post('/ai/chat', tags=['AI助手'])
async def chat_with_ai(
    request: ChatRequest,
    service: AiService = Depends(get_ai_service),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("agent-chat")),
):
    return StreamingResponse(
        service.generate_response_stream(
            message=request.message,
            history=request.history,
            context=request.context,
            image_data=request.image,
        ),
        media_type='text/event-stream',
    )
