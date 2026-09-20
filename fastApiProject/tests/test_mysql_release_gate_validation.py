"""真实 MySQL 双会话验证（AI 初筛 Release Gate 的仓库内可复现证据）。

默认跳过（普通 CI/SQLite 全量不受影响）。在本地 MySQL 环境执行：

    RECRUITMENT_MYSQL_VALIDATION=1 ENVIRONMENT=local PYTHONPATH=. \
    ./venv/bin/python -m pytest tests/test_mysql_release_gate_validation.py -p no:randomly -q

前置：仅通过 scripts/run_isolated_tests.py --mysql 运行，显式配置专用 nexus_gate_* 库；禁止 .env 回退。
所有测试数据用 MYSQLGATE 前缀标记，测试自清理。

覆盖复审验收标准：
- 终态提交语义：关会话重开后 run 必须已是终态、active 指针为空；
- 晋级幂等：同一 run 重复执行只产生一份权威 Score；
- 人工决策优先：HR 运行期推进状态后，迟到 AI 结果不得回写候选人；
- /score 双会话乱序：旧评分后完成不得覆盖新评分；
- 原子入队：提交前派单器看不到无 run 的 queued 任务；
- 批量邮件：失败批次即使有历史通过分也不发信。
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("RECRUITMENT_MYSQL_VALIDATION") != "1",
    reason="需要真实 MySQL：设置 RECRUITMENT_MYSQL_VALIDATION=1 并配置本地 DB_LOCAL_* 后运行",
)

MARKER_PREFIX = "MYSQLGATE"

SCORE_CONTENT_TEMPLATE = {
    "score": {
        "total_score": 8.0,
        "match_percent": 80,
        "recommendation": "建议面试",
        "suggested_status": "screening_passed",
        "advantages": ["强"],
        "concerns": [],
    },
}


def _new_session():
    from app.database import SessionLocal

    return SessionLocal()


def _cleanup(db):
    from app.recruitment_models import (
        RecruitmentAITaskLog,
        RecruitmentCandidate,
        RecruitmentCandidateScore,
        RecruitmentCandidateScreeningRun,
        RecruitmentResumeFile,
        RecruitmentResumeParseResult,
    )

    rows = db.query(RecruitmentCandidate).filter(
        RecruitmentCandidate.candidate_code.like(f"{MARKER_PREFIX}%"),
    ).all()
    for candidate in rows:
        db.query(RecruitmentCandidateScore).filter(RecruitmentCandidateScore.candidate_id == candidate.id).delete()
        db.query(RecruitmentCandidateScreeningRun).filter(RecruitmentCandidateScreeningRun.candidate_id == candidate.id).delete()
        db.query(RecruitmentAITaskLog).filter(RecruitmentAITaskLog.related_candidate_id == candidate.id).delete()
        db.query(RecruitmentResumeParseResult).filter(RecruitmentResumeParseResult.candidate_id == candidate.id).delete()
        db.query(RecruitmentResumeFile).filter(RecruitmentResumeFile.candidate_id == candidate.id).delete()
        db.delete(candidate)
    db.commit()


def _seed_candidate(db, marker: str, *, status: str = "pending_screening", position_id=None):
    from app.recruitment_models import (
        RecruitmentCandidate,
        RecruitmentResumeFile,
        RecruitmentResumeParseResult,
    )

    candidate = RecruitmentCandidate(
        candidate_code=marker, org_code="group", name=marker, position_id=position_id,
        source="manual_upload", status=status, screening_generation=0, deleted=False,
        created_by="mysqlgate",
    )
    db.add(candidate)
    db.flush()
    resume = RecruitmentResumeFile(
        candidate_id=candidate.id, org_code="group", original_name="r.txt", stored_name="r.txt",
        storage_path="/tmp/mysqlgate.txt", file_ext=".txt", parse_status="success", uploaded_by="mysqlgate",
    )
    db.add(resume)
    db.flush()
    candidate.latest_resume_file_id = resume.id
    parse = RecruitmentResumeParseResult(
        candidate_id=candidate.id, resume_file_id=resume.id, org_code="group",
        raw_text="候选人简历：三年 IoT 测试经验，负责 BLE 协议联调与自动化测试。", status="success",
    )
    db.add(parse)
    db.flush()
    candidate.latest_parse_result_id = parse.id
    db.commit()
    return candidate, parse


def _score_content():
    from app.services.recruitment_service_impl import RAW_SCREENING_SCORE_STORAGE_FORMAT

    content = {"_storage_format": RAW_SCREENING_SCORE_STORAGE_FORMAT}
    content.update({k: dict(v) if isinstance(v, dict) else v for k, v in SCORE_CONTENT_TEMPLATE.items()})
    return content


@pytest.fixture()
def mysql_db():
    if (os.getenv("NEXUS_TEST_ISOLATED") != "1"
            or os.getenv("NEXUS_MYSQL_TEST_ISOLATED") != "1"
            or not os.getenv("DB_LOCAL_DATABASE", "").startswith("nexus_gate_")):
        pytest.fail("MySQL tests require the isolated runner and a dedicated nexus_gate_* database")
    db = _new_session()
    _cleanup(db)
    try:
        yield db
    finally:
        try:
            db.rollback()
        except Exception:
            pass
        _cleanup(db)
        db.close()


def test_upload_partial_commit_is_visible_to_fresh_session_and_retry_is_scoped(mysql_db, tmp_path, monkeypatch):
    from app.services import recruitment_service_impl as implementation
    from app.recruitment_models import RecruitmentCandidate, RecruitmentResumeFile

    monkeypatch.setattr(implementation, "RECRUITMENT_UPLOAD_ROOT", tmp_path)
    service = implementation.RecruitmentService(mysql_db)
    serialize = service._serialize_candidate_summary
    visible_before_last = []

    def serialize_with_failure(candidate):
        candidate.candidate_code = f"{MARKER_PREFIX}-UPLOAD-{candidate.id}"
        mysql_db.flush()
        if candidate.source_detail == "synthetic-failed.pdf":
            raise RuntimeError("synthetic precommit failure")
        if candidate.source_detail == "synthetic-last.pdf":
            with _new_session() as observer:
                visible_before_last.extend(row.source_detail for row in observer.query(RecruitmentCandidate)
                                           .filter(RecruitmentCandidate.candidate_code.like(f"{MARKER_PREFIX}-UPLOAD-%")))
        return serialize(candidate)

    monkeypatch.setattr(service, "_serialize_candidate_summary", serialize_with_failure)
    files = [{"file_name": f"synthetic-{name}.pdf", "content": b"synthetic"} for name in ("first", "failed", "last")]
    rows = service.upload_resume_files(files, None, "mysqlgate", match_mode="none")
    assert [row["upload_status"] for row in rows] == ["uploaded", "failed", "uploaded"]
    assert visible_before_last == ["synthetic-first.pdf"]

    def serialize_retry(candidate):
        candidate.candidate_code = f"{MARKER_PREFIX}-UPLOAD-{candidate.id}"
        mysql_db.flush()
        return serialize(candidate)

    monkeypatch.setattr(service, "_serialize_candidate_summary", serialize_retry)
    retry = service.upload_resume_files([files[1]], None, "mysqlgate", match_mode="none")
    assert retry[0]["upload_status"] == "uploaded"
    with _new_session() as observer:
        candidates = observer.query(RecruitmentCandidate).filter(RecruitmentCandidate.candidate_code.like(f"{MARKER_PREFIX}-UPLOAD-%")).all()
        assert len(candidates) == 3
        for candidate in candidates:
            resume = observer.get(RecruitmentResumeFile, candidate.latest_resume_file_id)
            assert resume.candidate_id == candidate.id
            assert resume.org_code == candidate.org_code
            assert (tmp_path / resume.storage_path).read_bytes() == b"synthetic"
    assert len(list(tmp_path.rglob("*.pdf"))) == 3


@pytest.mark.parametrize("committed", [False, True])
def test_upload_commit_acknowledgement_loss_never_claims_safe_retry(mysql_db, tmp_path, monkeypatch, committed):
    from app.services import recruitment_service_impl as implementation
    from app.recruitment_models import RecruitmentCandidate, RecruitmentResumeFile

    monkeypatch.setattr(implementation, "RECRUITMENT_UPLOAD_ROOT", tmp_path)
    service = implementation.RecruitmentService(mysql_db)
    serialize = service._serialize_candidate_summary
    commit = mysql_db.commit

    def mark(candidate):
        candidate.candidate_code = f"{MARKER_PREFIX}-UNCERTAIN-{candidate.id}"
        mysql_db.flush()
        return serialize(candidate)

    def lost_acknowledgement():
        if committed:
            commit()
        raise RuntimeError("synthetic lost commit acknowledgement")

    monkeypatch.setattr(service, "_serialize_candidate_summary", mark)
    with monkeypatch.context() as patch:
        patch.setattr(mysql_db, "commit", lost_acknowledgement)
        rows = service.upload_resume_files([{"file_name": "synthetic-uncertain.pdf", "content": b"synthetic"}], None, "mysqlgate", match_mode="none")
    assert rows[0]["upload_status"] == "unknown"
    assert rows[0]["retryable"] is False
    with _new_session() as observer:
        candidates = observer.query(RecruitmentCandidate).filter(RecruitmentCandidate.candidate_code.like(f"{MARKER_PREFIX}-UNCERTAIN-%")).all()
        assert len(candidates) == int(committed)
        for candidate in candidates:
            resume = observer.get(RecruitmentResumeFile, candidate.latest_resume_file_id)
            assert (tmp_path / resume.storage_path).is_file()
    assert len(list(tmp_path.rglob("*.pdf"))) == 1


def test_schema_lock_timeout_across_processes_and_reacquire(mysql_db):
    import selectors
    import subprocess
    import sys
    from app import schema_maintenance as schema

    name = "nexus_gate_schema_advisory_test"
    script = (
        "import isolated_network; isolated_network.pytest_configure(); "
        "from app.schema_maintenance import _MysqlAdvisoryLock; import sys\n"
        f"with _MysqlAdvisoryLock({name!r}, timeout=1):\n"
        " print('LOCKED', flush=True)\n sys.stdin.readline()\n"
    )
    process = subprocess.Popen([sys.executable, "-c", script], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(timeout=15), "Lock holder did not become ready"
            assert process.stdout.readline().strip() == "LOCKED"
        with pytest.raises(RuntimeError, match="Could not acquire"):
            with schema._MysqlAdvisoryLock(name, timeout=0):
                pytest.fail("DDL body entered without the lock")
        process.communicate(input="release\n", timeout=10)
        assert process.returncode == 0
        with schema._MysqlAdvisoryLock(name, timeout=0):
            pass
    finally:
        if process.poll() is None:
            process.terminate()
        process.communicate(timeout=10)


def test_schema_ddl_failure_can_be_retried_and_remains_idempotent(mysql_db, monkeypatch):
    from sqlalchemy import inspect, text
    from app import schema_maintenance as schema

    table = "MYSQLGATE_SCHEMA_TEST"
    monkeypatch.setattr(schema.time, "sleep", lambda seconds: None)
    try:
        with schema.engine.begin() as connection:
            connection.execute(text(f"CREATE TABLE {table} (id INT PRIMARY KEY)"))
        with pytest.raises(RuntimeError, match="Schema"):
            schema._add_column_if_missing(inspect(schema.engine), table, "extra",
                f"ALTER TABLE {table} ADD COLUMN extra NONEXISTENT_TEST_TYPE", "synthetic")
        assert {column["name"] for column in inspect(schema.engine).get_columns(table)} == {"id"}
        for _ in range(2):
            schema._add_column_if_missing(inspect(schema.engine), table, "extra",
                f"ALTER TABLE {table} ADD COLUMN extra INT", "synthetic")
        assert {column["name"] for column in inspect(schema.engine).get_columns(table)} == {"id", "extra"}
    finally:
        with schema.engine.begin() as connection:
            connection.execute(text(f"DROP TABLE IF EXISTS {table}"))


def test_terminal_finalize_survives_session_reopen(mysql_db):
    """P0-2 提交语义：finalize+commit 后，全新 Session 必须看到 run 终态 + active 指针为空。"""
    from app.recruitment_models import RecruitmentCandidate, RecruitmentCandidateScreeningRun
    from app.services.recruitment_service_impl import RecruitmentService

    candidate, _parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-FIN")
    service = RecruitmentService(mysql_db)
    run = service._open_screening_run(candidate=candidate, root_task_id=990001, screening_run_key="k", request_meta={}, actor_id="mysqlgate")
    run.status = "running"
    mysql_db.add(run)
    mysql_db.commit()
    run_id, candidate_id = run.id, candidate.id

    service._current_screening_run_id = run_id
    # 与 finish_root_task 生产路径一致：finalize 后必须显式提交
    service._finalize_bound_screening_run("failed", candidate_ref=candidate)
    mysql_db.commit()

    fresh = _new_session()
    try:
        fresh_run = fresh.query(RecruitmentCandidateScreeningRun).filter(RecruitmentCandidateScreeningRun.id == run_id).first()
        fresh_candidate = fresh.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate_id).first()
        assert fresh_run.status == "failed", f"重开会话后 run 必须已终态，实际 {fresh_run.status}"
        assert fresh_run.completed_at is not None
        assert fresh_candidate.active_screening_run_id is None, "重开会话后 active 指针必须为空"
    finally:
        fresh.close()


def test_duplicate_promotion_is_idempotent(mysql_db):
    """P0-2 幂等：同一 promoted run 重复执行 _save_score_result 只产生一份权威 Score。"""
    from app.recruitment_models import RecruitmentCandidateScreeningRun
    from app.services.recruitment_service_impl import RecruitmentService

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-IDEM")
    service = RecruitmentService(mysql_db)
    run = service._open_screening_run(candidate=candidate, root_task_id=990002, screening_run_key="k", request_meta={}, actor_id="mysqlgate")
    run.status = "running"
    mysql_db.add(run)
    mysql_db.commit()
    service._current_screening_run_id = run.id

    score_first = service._save_score_result(candidate, parse, "mysqlgate", _score_content(), allow_status_advance=True)
    mysql_db.commit()
    mysql_db.refresh(candidate)
    assert getattr(score_first, "_superseded_reason", None) is None
    assert candidate.latest_score_id == score_first.id

    # 模拟重复回调/重复 worker：同一 run 再执行一次
    score_second = service._save_score_result(candidate, parse, "mysqlgate", _score_content(), allow_status_advance=True)
    mysql_db.commit()
    mysql_db.refresh(candidate)
    run_row = mysql_db.query(RecruitmentCandidateScreeningRun).filter(RecruitmentCandidateScreeningRun.id == run.id).first()
    assert getattr(score_second, "_superseded_reason", None) == "already_promoted"
    assert candidate.latest_score_id == score_first.id, "重复执行不得改写权威评分指针"
    assert run_row.status == "promoted", "promoted 是不可变终态"
    assert run_row.score_result_id == score_first.id, "run 必须保留首次晋级的评分"


def test_hr_status_advance_blocks_late_promotion(mysql_db):
    """P0-3 人工决策优先：HR 在另一会话把候选人推进到部门评审后，迟到 AI 结果不得回写。"""
    from app.recruitment_models import RecruitmentCandidate, RecruitmentCandidateScreeningRun
    from app.services.recruitment_service_impl import RecruitmentService

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-HR")
    service = RecruitmentService(mysql_db)
    run = service._open_screening_run(candidate=candidate, root_task_id=990003, screening_run_key="k", request_meta={}, actor_id="mysqlgate")
    run.status = "running"
    mysql_db.add(run)
    mysql_db.commit()
    service._current_screening_run_id = run.id

    # HR 会话：把候选人推进到部门评审通过
    hr_db = _new_session()
    try:
        hr_candidate = hr_db.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).with_for_update().first()
        hr_candidate.status = "department_review_passed"
        hr_candidate.updated_by = "hr-user"
        hr_db.add(hr_candidate)
        hr_db.commit()
    finally:
        hr_db.close()

    # worker 会话：迟到的 AI 评分尝试晋级
    score_row = service._save_score_result(candidate, parse, "mysqlgate", _score_content(), allow_status_advance=True)
    mysql_db.commit()

    fresh = _new_session()
    try:
        fresh_candidate = fresh.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
        fresh_run = fresh.query(RecruitmentCandidateScreeningRun).filter(RecruitmentCandidateScreeningRun.id == run.id).first()
        assert getattr(score_row, "_superseded_reason", None) == "candidate_status_advanced"
        assert fresh_candidate.status == "department_review_passed", "AI 不得把人工推进的状态拉回初筛域"
        assert fresh_candidate.latest_score_id is None, "迟到 AI 结果不得写权威评分指针"
        assert fresh_run.status == "superseded"
    finally:
        fresh.close()


def test_out_of_order_scores_do_not_regress_latest(mysql_db):
    """P0-4 /score 乱序：新评分（gen2, 90）先完成、旧评分（gen1, 60）后完成 → latest 保持 90。"""
    from app.services.recruitment_service_impl import RecruitmentService

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-ORDER")
    service = RecruitmentService(mysql_db)
    run_old = service._open_screening_run(candidate=candidate, root_task_id=990004, screening_run_key="k1", request_meta={}, actor_id="mysqlgate")
    mysql_db.commit()
    run_new = service._open_screening_run(candidate=candidate, root_task_id=990005, screening_run_key="k2", request_meta={}, actor_id="mysqlgate")
    mysql_db.commit()

    content_new = _score_content()
    content_new["score"]["total_score"] = 9.0
    content_new["score"]["match_percent"] = 90
    service._current_screening_run_id = run_new.id
    score_new = service._save_score_result(candidate, parse, "mysqlgate", content_new, allow_status_advance=True)
    mysql_db.commit()

    content_old = _score_content()
    content_old["score"]["total_score"] = 6.0
    content_old["score"]["match_percent"] = 60
    service._current_screening_run_id = run_old.id
    score_old = service._save_score_result(candidate, parse, "mysqlgate", content_old, allow_status_advance=True)
    mysql_db.commit()
    mysql_db.refresh(candidate)

    assert getattr(score_old, "_superseded_reason", None) == "generation_changed"
    assert candidate.latest_score_id == score_new.id, "旧评分后完成不得覆盖新评分"
    assert float(candidate.match_percent or 0) == 90.0


def test_atomic_enqueue_dispatcher_cannot_see_runless_task(mysql_db):
    """P0-4 原子入队：defer_commit 提交前，独立会话（派单器视角）看不到 queued 任务；
    提交后 task+run+active 指针同时可见。"""
    from app.recruitment_models import RecruitmentAITaskLog, RecruitmentCandidate, RecruitmentCandidateScreeningRun
    from app.services.recruitment_service_impl import SCREENING_FLOW_TASK_TYPE, RecruitmentService, _build_screening_run_id

    candidate, _parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-ATOM")
    service = RecruitmentService(mysql_db)
    run_key = _build_screening_run_id(candidate.id)
    task_row = service._create_ai_task_log(
        SCREENING_FLOW_TASK_TYPE, created_by="mysqlgate", related_candidate_id=candidate.id,
        status="queued", stage="queued", screening_run_id=run_key, defer_commit=True,
    )
    run = service._open_screening_run(candidate=candidate, root_task_id=task_row.id, screening_run_key=run_key, request_meta={}, actor_id="mysqlgate")
    assert run is not None

    dispatcher = _new_session()
    try:
        before = dispatcher.query(RecruitmentAITaskLog).filter(
            RecruitmentAITaskLog.related_candidate_id == candidate.id,
            RecruitmentAITaskLog.status == "queued",
        ).first()
        assert before is None, "提交前派单器不得看到 queued 任务（否则会抢到无 run 任务造成双 run）"

        mysql_db.commit()

        dispatcher.rollback()  # 刷新可重复读快照
        after_task = dispatcher.query(RecruitmentAITaskLog).filter(
            RecruitmentAITaskLog.related_candidate_id == candidate.id,
            RecruitmentAITaskLog.status == "queued",
        ).first()
        after_run = dispatcher.query(RecruitmentCandidateScreeningRun).filter(
            RecruitmentCandidateScreeningRun.root_task_id == task_row.id,
        ).first()
        after_candidate = dispatcher.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
        assert after_task is not None and after_run is not None, "提交后 task 与 run 必须同时可见"
        assert after_candidate.active_screening_run_id == after_run.id
    finally:
        dispatcher.close()


def test_hr_reject_inside_screening_domain_blocks_late_ai(mysql_db):
    """re2 P0-3 复现：HR 双会话在 AI 运行期间手动 screening_rejected（初筛域内）——
    business_revision CAS 使迟到 AI 结果过期，绝不改回 screening_passed。"""
    from app.recruitment_models import RecruitmentCandidate, RecruitmentCandidateScreeningRun
    from app.services.recruitment_service_impl import RecruitmentService

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-HRREJ")
    service = RecruitmentService(mysql_db)
    run = service._open_screening_run(candidate=candidate, root_task_id=990007, screening_run_key="k", request_meta={}, actor_id="mysqlgate")
    run.status = "running"
    mysql_db.add(run)
    mysql_db.commit()
    assert run.expected_candidate_revision is not None

    # HR 会话：手动淘汰（走真实服务方法 → business_revision 自增）
    hr_db = _new_session()
    try:
        hr_service = RecruitmentService(hr_db)
        hr_service.update_candidate_status(candidate.id, "screening_rejected", "人工判断不合适", "hr-user")
    finally:
        hr_db.close()

    service._current_screening_run_id = run.id
    score_row = service._save_score_result(candidate, parse, "mysqlgate", _score_content(), allow_status_advance=True)
    mysql_db.commit()

    fresh = _new_session()
    try:
        fresh_candidate = fresh.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
        fresh_run = fresh.query(RecruitmentCandidateScreeningRun).filter(RecruitmentCandidateScreeningRun.id == run.id).first()
        assert getattr(score_row, "_superseded_reason", None) == "candidate_revision_changed"
        assert fresh_candidate.status == "screening_rejected", "人工淘汰不得被迟到 AI 改回通过"
        assert fresh_candidate.latest_score_id is None
        assert fresh_run.status == "superseded"
    finally:
        fresh.close()


def test_workflow_gate_rejects_stale_session_pointer(mysql_db):
    """re2 P0-4 复现：旧会话内存里 latest_score_id 仍是旧值，DB 已被新会话更新——
    工作流门控必须加锁重读 DB，旧 run 不得把工作流指针写回旧评分。"""
    from app.recruitment_models import RecruitmentCandidate, RecruitmentCandidateScore, RecruitmentCandidateWorkflowMemory
    from app.services.recruitment_service_impl import RecruitmentService, json_dumps_safe

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-WFSTALE")
    old_score = RecruitmentCandidateScore(
        org_code="group", candidate_id=candidate.id, parse_result_id=parse.id,
        score_json=json_dumps_safe({"score": {"total_score": 6.0}}), total_score=6.0, match_percent=60,
    )
    mysql_db.add(old_score)
    mysql_db.flush()
    candidate.latest_score_id = old_score.id
    mysql_db.commit()

    # 新会话：写入新评分并把权威指针推进到新值
    new_db = _new_session()
    try:
        fresh_candidate = new_db.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).with_for_update().first()
        new_score = RecruitmentCandidateScore(
            org_code="group", candidate_id=candidate.id, parse_result_id=parse.id,
            score_json=json_dumps_safe({"score": {"total_score": 9.0}}), total_score=9.0, match_percent=90,
        )
        new_db.add(new_score)
        new_db.flush()
        fresh_candidate.latest_score_id = new_score.id
        new_db.commit()
        new_score_id = new_score.id
    finally:
        new_db.close()

    # 旧会话（内存 latest 仍指旧评分）尝试用旧评分写工作流 → 门控加锁重读 DB 后拒绝
    service = RecruitmentService(mysql_db)
    assert candidate.latest_score_id == old_score.id  # 旧会话内存确实是旧值
    service._save_screening_workflow_memory(
        candidate=candidate, actor_id="mysqlgate", parse_row=parse, score_row=old_score,
        memory_source="test", related_skill_ids=[], custom_requirements="",
    )
    mysql_db.commit()

    fresh = _new_session()
    try:
        workflow = fresh.query(RecruitmentCandidateWorkflowMemory).filter(RecruitmentCandidateWorkflowMemory.candidate_id == candidate.id).first()
        fresh_candidate = fresh.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
        assert fresh_candidate.latest_score_id == new_score_id, "权威指针必须保持新评分"
        assert workflow is None or getattr(workflow, "latest_score_id", None) != old_score.id, "旧 run 不得把工作流指针写回旧评分"
    finally:
        fresh.close()


def test_same_state_rescreen_updates_candidate_pointer(mysql_db):
    """re2 P0-1 复现：候选人已 screening_passed（旧分），重筛出新分且建议状态相同
    （auto-advance 无操作、无中途 flush）→ autoflush=False 下 populate_existing 刷新
    不得吞掉 pending 的 latest_score_id：run promoted 后候选人必须指向新分。"""
    from app.recruitment_models import RecruitmentCandidate, RecruitmentCandidateScore, RecruitmentCandidateScreeningRun
    from app.services.recruitment_service_impl import RecruitmentService, json_dumps_safe

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-SAMEST", status="screening_passed")
    old_score = RecruitmentCandidateScore(
        org_code="group", candidate_id=candidate.id, parse_result_id=parse.id,
        score_json=json_dumps_safe({"score": {"total_score": 7.0}}), total_score=7.0, match_percent=70,
        suggested_status="screening_passed",
    )
    mysql_db.add(old_score)
    mysql_db.flush()
    candidate.latest_score_id = old_score.id
    candidate.ai_recommended_status = "screening_passed"
    mysql_db.commit()

    service = RecruitmentService(mysql_db)
    run = service._open_screening_run(candidate=candidate, root_task_id=990008, screening_run_key="k", request_meta={}, actor_id="mysqlgate")
    run.status = "running"
    mysql_db.add(run)
    mysql_db.commit()
    service._current_screening_run_id = run.id

    new_score = service._save_score_result(candidate, parse, "mysqlgate", _score_content(), allow_status_advance=True)
    mysql_db.commit()

    fresh = _new_session()
    try:
        fresh_candidate = fresh.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
        fresh_run = fresh.query(RecruitmentCandidateScreeningRun).filter(RecruitmentCandidateScreeningRun.id == run.id).first()
        assert fresh_run.status == "promoted"
        assert fresh_run.score_result_id == new_score.id
        assert fresh_candidate.latest_score_id == new_score.id, "重开会话后候选人必须指向新分（不得被刷新吞掉）"
        assert float(fresh_candidate.match_percent or 0) == 80.0
    finally:
        fresh.close()


def test_business_revision_bump_is_atomic_across_stale_sessions(mysql_db):
    """re2 P0-2 复现：旧会话持有 stale 对象再 bump，不得算出与已有版本相同的值（ABA）——
    bump 必须是数据库端原子自增，两次并发 bump 后版本必须是 2。"""
    from app.recruitment_models import RecruitmentCandidate
    from app.services.recruitment_service_impl import RecruitmentService

    candidate, _parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-ABA")

    # 旧会话先加载（rev=0 的 stale 对象）
    stale_db = _new_session()
    stale_candidate = stale_db.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
    assert int(stale_candidate.business_revision or 0) == 0

    # 新会话先 bump 到 1
    service = RecruitmentService(mysql_db)
    service._bump_candidate_business_revision(candidate)
    mysql_db.commit()

    # 旧会话再 bump：若按 stale 值 0+1=1 就与 run 冻结值撞车（ABA）；原子自增必须得到 2
    try:
        stale_service = RecruitmentService(stale_db)
        stale_service._bump_candidate_business_revision(stale_candidate)
        stale_db.commit()
    finally:
        stale_db.close()

    fresh = _new_session()
    try:
        final_rev = fresh.query(RecruitmentCandidate.business_revision).filter(
            RecruitmentCandidate.id == candidate.id,
        ).scalar()
        assert int(final_rev or 0) == 2, f"两次 bump 后版本必须为 2（原子自增），实际 {final_rev}"
    finally:
        fresh.close()


def test_real_enqueue_creates_visible_task_and_run(mysql_db):
    """回归（自动初筛静默失效）：真实 enqueue_screen_candidate 全链路——跨进程去重复查
    不得把自己 flush 的任务当撞车回滚（flush 行同事务可见，必须 exclude 自身）。
    断言：入队后全新会话能看到 queued 根任务 + 绑定 run + active 指针。"""
    from app.recruitment_models import (
        RecruitmentAITaskLog, RecruitmentCandidate, RecruitmentCandidateScreeningRun,
        RecruitmentPosition, RecruitmentSkill,
        RecruitmentLLMConfig,
    )
    from app.services.recruitment_service_impl import SCREENING_FLOW_TASK_TYPE, RecruitmentService, json_dumps_safe

    # Model provenance is required by real enqueue even when dispatch=False.
    model = RecruitmentLLMConfig(
        config_key=f"{MARKER_PREFIX}-model", task_type="default", provider="openai-compatible",
        model_name="synthetic-no-network", base_url="http://127.0.0.1:1/v1", org_code="group",
        is_active=True, priority=1,
    )
    mysql_db.add(model)
    # 独立岗位 + 初筛评估方案（不依赖库中现有数据，自建自清理）
    skill = RecruitmentSkill(
        skill_code=f"{MARKER_PREFIX}-skill", name=f"{MARKER_PREFIX}-初筛规则", org_code="group",
        description="gate", content="---\ntask_type: screening\n---\n| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| 自动化测试 | 100% | 10 | 需要自动化脚本经验 |",
        is_enabled=True, deleted=False,
    )
    mysql_db.add(skill)
    mysql_db.flush()
    position = RecruitmentPosition(
        position_code=f"{MARKER_PREFIX}-POS", title=f"{MARKER_PREFIX}-岗位", org_code="group",
        status="recruiting", deleted=False,
        screening_skill_ids_json=json_dumps_safe([skill.id]), created_by="mysqlgate",
    )
    mysql_db.add(position)
    mysql_db.flush()
    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-ENQ", position_id=position.id)
    # pending 候选人走 force_fresh 会重新提取简历原文——给个真实存在的 txt 文件（≥50 字）
    import os
    import tempfile
    from app.recruitment_models import RecruitmentResumeFile
    _tmp = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
    _tmp.write("候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    _tmp.close()
    resume_row = mysql_db.query(RecruitmentResumeFile).filter(RecruitmentResumeFile.candidate_id == candidate.id).first()
    resume_row.storage_path = _tmp.name
    resume_row.file_ext = ".txt"
    mysql_db.add(resume_row)
    mysql_db.commit()
    try:
        service = RecruitmentService(mysql_db)
        result = service.enqueue_screen_candidate(candidate.id, "mysqlgate", dispatch=False)
        mysql_db.commit()
        assert result.get("status") == "queued", f"入队应返回 queued，实际 {result}"
        assert result.get("reused_existing_task") is False, "首次入队不得被误判为复用"

        fresh = _new_session()
        try:
            task = fresh.query(RecruitmentAITaskLog).filter(
                RecruitmentAITaskLog.related_candidate_id == candidate.id,
                RecruitmentAITaskLog.task_type == SCREENING_FLOW_TASK_TYPE,
            ).first()
            assert task is not None and task.status == "queued", "入队后必须存在 queued 根任务（回归会静默丢弃）"
            run = fresh.query(RecruitmentCandidateScreeningRun).filter(
                RecruitmentCandidateScreeningRun.root_task_id == task.id,
            ).first()
            fresh_candidate = fresh.query(RecruitmentCandidate).filter(RecruitmentCandidate.id == candidate.id).first()
            assert run is not None and run.generation == 1
            assert fresh_candidate.active_screening_run_id == run.id
        finally:
            fresh.close()
    finally:
        mysql_db.rollback()
        mysql_db.query(RecruitmentPosition).filter(RecruitmentPosition.id == position.id).delete()
        mysql_db.query(RecruitmentSkill).filter(RecruitmentSkill.id == skill.id).delete()
        mysql_db.query(RecruitmentLLMConfig).filter(RecruitmentLLMConfig.id == model.id).delete()
        mysql_db.commit()
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass


def test_failed_batch_never_emails_even_with_historical_pass(mysql_db):
    """P0-5：本批根任务失败时，即使候选人有历史通过分（latest_score_id 有值）也绝不发信；
    正控：success 根任务 + promoted run + run 评分==latest 才发。"""
    from unittest.mock import Mock

    from app.recruitment_models import RecruitmentAITaskLog
    from app.services.recruitment_service_impl import SCREENING_FLOW_TASK_TYPE, RecruitmentService

    candidate, parse = _seed_candidate(mysql_db, f"{MARKER_PREFIX}-MAIL", position_id=999999)
    service = RecruitmentService(mysql_db)

    # 历史通过分：先跑一个正常晋级 run
    run_hist = service._open_screening_run(candidate=candidate, root_task_id=990006, screening_run_key="k1", request_meta={}, actor_id="mysqlgate")
    mysql_db.commit()
    service._current_screening_run_id = run_hist.id
    score_hist = service._save_score_result(candidate, parse, "mysqlgate", _score_content(), allow_status_advance=True)
    mysql_db.commit()
    mysql_db.refresh(candidate)
    assert candidate.latest_score_id == score_hist.id

    sent_calls = []
    service._send_batch_auto_mail_for_position = Mock(side_effect=lambda **kwargs: sent_calls.append(kwargs))

    # 负例：本批根任务 failed（未开新 run）→ 不发信
    failed_task = RecruitmentAITaskLog(
        task_type=SCREENING_FLOW_TASK_TYPE, org_code="group", status="failed",
        related_candidate_id=candidate.id, created_by="mysqlgate",
    )
    mysql_db.add(failed_task)
    mysql_db.commit()
    service._send_batch_auto_resume_mail_for_batch("batch-neg", [failed_task])
    assert not sent_calls, "失败批次不得复用历史通过分发信"

    # 正控：success 根任务 + promoted run + run 评分 == candidate.latest → 发信
    success_task = RecruitmentAITaskLog(
        task_type=SCREENING_FLOW_TASK_TYPE, org_code="group", status="success",
        related_candidate_id=candidate.id, created_by="mysqlgate",
    )
    mysql_db.add(success_task)
    mysql_db.flush()
    run_hist_row = run_hist
    run_hist_row.root_task_id = success_task.id
    mysql_db.add(run_hist_row)
    mysql_db.commit()
    service._send_batch_auto_resume_mail_for_batch("batch-pos", [success_task])
    assert len(sent_calls) == 1, "完整链条成立时应正常发信（正控）"
