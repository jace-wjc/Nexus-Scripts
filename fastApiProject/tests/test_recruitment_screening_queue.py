import asyncio
import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest
from sqlalchemy.exc import OperationalError, SQLAlchemyError, TimeoutError as SQLAlchemyTimeoutError

import app.services.recruitment_service_impl as recruitment_impl
from app.recruitment_models import RecruitmentSkill
from app.services.recruitment_ai_gateway import RecruitmentAIGateway, RecruitmentAIJSONParseError, RecruitmentLLMRuntimeConfig, _compose_json_user_prompt, _parse_llm_json_response, _parse_strict_json_response
from app.services.recruitment_ai_gateway import (
    POSITION_MATCH_REQUEST_TIMEOUT_SECONDS,
    RecruitmentAIScreeningTotalTimeoutError,
    SCREENING_TOTAL_TIMEOUT_SECONDS,
)
from app.services.recruitment_task_control import RecruitmentTaskControl
from app.services.recruitment_prompts import (
    RESUME_SCREENING_SYSTEM_PROMPT,
    RESUME_PARSE_SYSTEM_PROMPT,
    RESUME_SCORE_SYSTEM_PROMPT,
    SCORE_ONLY_OUTPUT_SCHEMA,
    SCREENING_OUTPUT_SCHEMA,
    _COMMON_EVIDENCE_RULES,
)
from app.services.recruitment_service_impl import (
    RAW_SCREENING_SCORE_STORAGE_FORMAT,
    RecruitmentService,
    RecruitmentScreeningResumeTextUnavailableError,
    RecruitmentScreeningRuleInvalidError,
    SCREENING_ONE_PASS_TASK_TYPE,
    SCREENING_PAYLOAD_SCHEMA_CONFIG,
    SCREENING_FLOW_TASK_TYPE,
    _build_screening_schema_config,
    _detect_score_json_variant_conflict,
    _build_score_compat_payload,
    _build_dimension_concern_summary,
    _build_dimension_reason_summary,
    _classify_ai_match_failure,
    _classify_infra_failure,
    _classify_screening_task_failure,
    _classify_screening_score_validity,
    _extract_json_parse_failure_meta,
    _extract_model_score_payload_with_meta,
    _is_retryable_infra_failure_code,
    _select_one_pass_json_candidate,
    _prepare_resume_text_for_parse_prompt,
    _sanitize_ai_parsed_resume,
    _sanitize_ai_parsed_resume_with_meta,
    _validate_screening_payload_warnings,
    sanitize_screening_payload,
    sanitize_screening_score_payload,
    sanitize_dimensions,
)


def _build_http_status_error(status_code: int, text: str = "") -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.test/v1/chat/completions")
    response = httpx.Response(status_code, request=request, text=text)
    return httpx.HTTPStatusError(f"{status_code} error", request=request, response=response)


def _build_openai_json_http_response(raw_text: str) -> Mock:
    response = Mock()
    response.status_code = 200
    response.headers = {"content-type": "application/json"}
    response.raise_for_status = Mock()
    response.json = Mock(
        return_value={
            "choices": [
                {
                    "message": {
                        "content": raw_text,
                    }
                }
            ]
        }
    )
    response.text = json.dumps(response.json.return_value, ensure_ascii=False)
    return response


def test_database_connection_exhaustion_is_retryable_infra_failure():
    cases = [
        OperationalError("SELECT 1", {}, Exception("(1040, 'Too many connections')")),
        SQLAlchemyTimeoutError("QueuePool limit reached"),
        OperationalError("ROLLBACK", {}, Exception("(2013, 'Lost connection to MySQL server during query')")),
        OperationalError("SELECT 1", {}, Exception("(2006, 'MySQL server has gone away')")),
        SQLAlchemyError("Can't reconnect until invalid transaction is rolled back."),
    ]

    for exc in cases:
        failure_code, failure_message = _classify_infra_failure(exc)

        assert failure_code == "database_connection_exhausted"
        assert "数据库连接" in failure_message
        assert _is_retryable_infra_failure_code(failure_code)
        assert _classify_screening_task_failure(exc)[0] == "database_connection_exhausted"
        assert _classify_ai_match_failure(exc)[0] == "database_connection_exhausted"


def test_screening_queue_concurrency_auto_uses_model_sum_when_db_budget_allows(monkeypatch):
    monkeypatch.setattr(recruitment_impl, "SCREENING_WORKER_MAX_CONCURRENCY", None)
    monkeypatch.setattr(recruitment_impl, "SCREENING_DB_CONNECTION_RESERVE", 4)
    monkeypatch.setattr(recruitment_impl, "DB_POOL_SIZE", 20)
    monkeypatch.setattr(recruitment_impl, "DB_MAX_OVERFLOW", 10)
    service = RecruitmentService.__new__(RecruitmentService)
    rows_by_task = {
        SCREENING_ONE_PASS_TASK_TYPE: [SimpleNamespace(id=1, max_concurrent=10)],
        "resume_score": [SimpleNamespace(id=2, max_concurrent=10)],
    }
    service._load_effective_llm_config_rows_for_task = lambda task_type: rows_by_task.get(task_type, [])

    assert service._resolve_screening_queue_max_concurrency() == 20


def test_screening_queue_concurrency_auto_is_capped_by_db_budget(monkeypatch):
    monkeypatch.setattr(recruitment_impl, "SCREENING_WORKER_MAX_CONCURRENCY", None)
    monkeypatch.setattr(recruitment_impl, "SCREENING_DB_CONNECTION_RESERVE", 4)
    monkeypatch.setattr(recruitment_impl, "DB_POOL_SIZE", 10)
    monkeypatch.setattr(recruitment_impl, "DB_MAX_OVERFLOW", 5)
    service = RecruitmentService.__new__(RecruitmentService)
    rows_by_task = {
        SCREENING_ONE_PASS_TASK_TYPE: [SimpleNamespace(id=1, max_concurrent=10)],
        "resume_score": [SimpleNamespace(id=2, max_concurrent=10)],
    }
    service._load_effective_llm_config_rows_for_task = lambda task_type: rows_by_task.get(task_type, [])

    assert service._resolve_screening_queue_max_concurrency() == 11


def test_screening_queue_concurrency_respects_lower_worker_limit(monkeypatch):
    monkeypatch.setattr(recruitment_impl, "SCREENING_WORKER_MAX_CONCURRENCY", 8)
    monkeypatch.setattr(recruitment_impl, "SCREENING_DB_CONNECTION_RESERVE", 4)
    monkeypatch.setattr(recruitment_impl, "DB_POOL_SIZE", 20)
    monkeypatch.setattr(recruitment_impl, "DB_MAX_OVERFLOW", 10)
    service = RecruitmentService.__new__(RecruitmentService)
    rows_by_task = {
        SCREENING_ONE_PASS_TASK_TYPE: [SimpleNamespace(id=1, max_concurrent=10)],
        "resume_score": [SimpleNamespace(id=2, max_concurrent=10)],
    }
    service._load_effective_llm_config_rows_for_task = lambda task_type: rows_by_task.get(task_type, [])

    assert service._resolve_screening_queue_max_concurrency() == 8


def test_screening_provider_slot_releases_clean_db_connection_before_model_wait():
    class FakeDb:
        new = ()
        dirty = ()
        deleted = ()

        def __init__(self):
            self.rollback_count = 0

        def rollback(self):
            self.rollback_count += 1

    fake_db = FakeDb()
    service = RecruitmentService.__new__(RecruitmentService)
    service.db = fake_db
    service._resolve_screening_provider_limits = lambda _source: (1, 0)
    service._raise_if_cancelled = lambda _control: None

    with service._acquire_screening_provider_slot(source="db:test"):
        pass

    assert fake_db.rollback_count == 1


def test_batch_mail_partial_failure_bubbles_for_retry():
    class FakeQuery:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *_args):
            return self

        def first(self):
            return self.rows.pop(0)

    class FakeDb:
        def __init__(self, rows):
            self.rows = rows

        def query(self, *_args):
            return FakeQuery(self.rows)

    candidates = [
        SimpleNamespace(id=1, position_id=101, latest_score_id=201),
        SimpleNamespace(id=2, position_id=102, latest_score_id=202),
    ]
    scores = [SimpleNamespace(id=201), SimpleNamespace(id=202)]
    service = RecruitmentService.__new__(RecruitmentService)
    service.db = FakeDb([candidates[0], scores[0], candidates[1], scores[1], *candidates])
    runs = {
        301: SimpleNamespace(id=401, status="promoted", score_result_id=201),
        302: SimpleNamespace(id=402, status="promoted", score_result_id=202),
    }
    service._get_screening_run_for_root_task = lambda task_id: runs[task_id]
    service._send_batch_auto_mail_for_position = Mock(side_effect=[None, RuntimeError("smtp unavailable")])
    tasks = [
        SimpleNamespace(id=301, status="success", related_candidate_id=1),
        SimpleNamespace(id=302, status="success", related_candidate_id=2),
    ]

    with pytest.raises(RuntimeError, match="position failures"):
        service._send_batch_auto_resume_mail_for_batch("batch-partial", tasks)

    assert service._send_batch_auto_mail_for_position.call_count == 2


def test_ai_match_callback_does_not_hold_db_session_during_model_call(monkeypatch):
    from app import database

    open_session_count = 0
    model_call_open_session_count = None
    candidate = SimpleNamespace(id=123, status="matching", org_code="group")
    runtime_config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={},
    )

    class FakeQuery:
        def __init__(self, row):
            self.row = row

        def filter(self, *args, **kwargs):
            return self

        def with_for_update(self, *args, **kwargs):
            return self

        def populate_existing(self, *args, **kwargs):
            return self

        def first(self):
            return self.row

    class FakeSession:
        def __init__(self):
            nonlocal open_session_count
            open_session_count += 1
            self.closed = False

        def query(self, model):
            if getattr(model, "__name__", "") == "RecruitmentCandidate":
                return FakeQuery(candidate)
            return FakeQuery(None)

        def add(self, row):
            self.added = row

        def commit(self):
            pass

        def flush(self):
            pass

        def refresh(self, row):
            if getattr(row, "id", None) is None:
                row.id = 1

        def rollback(self):
            pass

        def close(self):
            nonlocal open_session_count
            if not self.closed:
                self.closed = True
                open_session_count -= 1

    def session_factory():
        return FakeSession()

    def resolve_config_by_id(self, config_id):
        return runtime_config

    def match_position(
        self,
        candidate_id,
        resume_content,
        positions,
        *,
        runtime_config=None,
        key_id=None,
        cancel_control=None,
    ):
        nonlocal model_call_open_session_count
        model_call_open_session_count = open_session_count
        return {
            "position_id": None,
            "position_title": None,
            "confidence": None,
            "reason": "无匹配",
            "potential_position": None,
            "potential_reason": None,
            "provider": runtime_config.provider,
            "model_name": runtime_config.model_name,
            "source": runtime_config.source,
            "prompt_snapshot": "snapshot",
            "full_request_snapshot": "{}",
            "raw_response_text": "{}",
            "parsed_response": {},
        }

    monkeypatch.setattr(database, "SessionLocal", session_factory)
    monkeypatch.setattr(RecruitmentAIGateway, "resolve_config_by_id", resolve_config_by_id)
    # 0.1-C：回调每次自建网关并调用其类方法 match_position，故打桩到类方法而非实例。
    monkeypatch.setattr(RecruitmentAIGateway, "match_position", match_position)
    monkeypatch.setattr(RecruitmentService, "_serialize_realtime_candidate_item", lambda self, row: {"status": row.status})

    service = RecruitmentService(Mock())
    # P0-3：回调改为无状态 handler，请求级上下文随 MatchTask 传递
    callback = service._create_match_callback()

    task = SimpleNamespace(
        candidate_id=123,
        batch_id="batch-1",
        resume_content="resume text",
        user_id="actor",
        task_type="ai_position_match",
        session_token=None,
        position_summaries=[{"id": 1, "title": "产品经理", "department": "", "key_requirements": ""}],
    )
    slot = SimpleNamespace(config_id=7, key_id="config_7")
    asyncio.run(callback(task, slot))

    assert model_call_open_session_count == 0
    assert open_session_count == 0
    assert candidate.status == "unmatched"


def test_ai_match_resume_text_db_exhaustion_is_retried_not_marked_unavailable(monkeypatch):
    from app import database

    open_session_count = 0
    created_session_count = 0
    candidate = SimpleNamespace(id=123, status="matching", org_code="group")
    runtime_config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={},
    )
    db_exc = OperationalError("SELECT 1", {}, Exception("(1040, 'Too many connections')"))

    class FakeQuery:
        def __init__(self, should_raise=False):
            self.should_raise = should_raise

        def filter(self, *args, **kwargs):
            return self

        def first(self):
            if self.should_raise:
                raise db_exc
            return candidate

    class FakeSession:
        def __init__(self):
            nonlocal open_session_count, created_session_count
            created_session_count += 1
            open_session_count += 1
            self.index = created_session_count
            self.closed = False

        def query(self, model):
            return FakeQuery(should_raise=self.index == 2)

        def close(self):
            nonlocal open_session_count
            if not self.closed:
                self.closed = True
                open_session_count -= 1

    def session_factory():
        return FakeSession()

    def resolve_config_by_id(self, config_id):
        return runtime_config

    monkeypatch.setattr(database, "SessionLocal", session_factory)
    monkeypatch.setattr(RecruitmentAIGateway, "resolve_config_by_id", resolve_config_by_id)

    service = RecruitmentService(Mock())
    service.ai_gateway.match_position = Mock(side_effect=AssertionError("model call should not run"))
    # P0-3：回调改为无状态 handler，请求级上下文随 MatchTask 传递
    callback = service._create_match_callback()

    task = SimpleNamespace(
        candidate_id=123,
        batch_id="batch-1",
        resume_content=None,
        user_id="actor",
        task_type="ai_position_match",
        session_token=None,
        position_summaries=[{"id": 1, "title": "产品经理", "department": "", "key_requirements": ""}],
    )
    slot = SimpleNamespace(config_id=7, key_id="config_7")

    try:
        asyncio.run(callback(task, slot))
        assert False, "expected database exhaustion to bubble up for scheduler retry"
    except OperationalError as exc:
        assert "Too many connections" in str(exc)

    service.ai_gateway.match_position.assert_not_called()
    assert open_session_count == 0
    assert candidate.status == "matching"


def _build_screening_rule_skill_snapshots() -> list[dict[str, str]]:
    return [
        {
            "name": "IoT 初筛规则",
            "content": """
| 维度 | 权重 | 满分 | 说明 |
| --- | --- | --- | --- |
| IoT协议 | 30% | 5 | 核心第一优先，必须提供与 BLE / Zigbee 相关的简历原文证据 |
| 自动化测试 | 20% | 3 | 需要体现自动化脚本或测试平台经验 |
| 文档输出能力 | 10% | 2 | 需要体现测试方案、报告或文档交付能力 |
""".strip(),
        }
    ]


def test_ai_match_raw_snippets_preserve_tail_evidence_in_long_section():
    head = "".join(f"头部无关{i}\n" for i in range(450))
    work = "".join(f"职责描述{i}\n" for i in range(350))
    tail = "".join(f"结尾无关{i}\n" for i in range(2000))
    raw_text = (
        "基本信息\n"
        + head
        + "工作经历\n"
        + work
        + "关键岗位证据：AI产品经理 B端产品规划\n"
        + tail
    )

    snippet, truncated, labels = RecruitmentService._select_ai_match_raw_resume_snippets(
        raw_text,
        max_chars=6000,
    )

    assert truncated is True
    assert len(snippet) <= 6000
    assert "工作经验" in labels
    assert "关键岗位证据" in snippet
    assert "AI产品经理" in snippet
    assert "B端产品规划" in snippet


def _build_variable_max_score_skill_snapshots() -> list[dict[str, str]]:
    return [
        {
            "name": "动态总分规则",
            "content": """
| 维度 | 权重 | 满分 | 说明 |
| --- | --- | --- | --- |
| 核心经验 | 60% | 8 | 需要直接项目或岗位经历证据 |
| 自动化能力 | 40% | 4 | 需要自动化脚本或平台建设证据 |
""".strip(),
        }
    ]


def _build_query_mock(*, all_value=None, first_value=None) -> Mock:
    query = Mock()
    query.filter.return_value = query
    query.order_by.return_value = query
    query.with_for_update.return_value = query
    query.limit.return_value = query
    query.all.return_value = all_value
    query.first.return_value = first_value
    return query


def _build_skill_row(skill_id: int, task_kind: str, *, group: str, version: str = "v1", enabled: bool = True) -> RecruitmentSkill:
    return RecruitmentSkill(
        id=skill_id,
        skill_code=f"{group}-{task_kind}-{skill_id}",
        name=f"{group}-{task_kind}",
        description=f"{task_kind} module",
        content=f"---\nskill_group: {group}\nversion: {version}\ntask_type: {task_kind}\n---\n",
        tags_json=json.dumps([f"group:{group}", f"version:{version}", f"task:{task_kind}"], ensure_ascii=False),
        sort_order=skill_id,
        is_enabled=enabled,
        deleted=False,
        skill_group=group,
        version=version,
    )


def _build_ai_task_log_row(**overrides) -> SimpleNamespace:
    payload = {
        "id": 1,
        "task_type": "resume_score",
        "screening_run_id": "run-1",
        "batch_id": None,
        "parent_task_id": None,
        "root_task_id": None,
        "stage": "completed",
        "stage_started_at": datetime(2026, 4, 14, 12, 0, 0),
        "stage_completed_at": datetime(2026, 4, 14, 12, 0, 5),
        "related_position_id": 3,
        "related_candidate_id": 7,
        "related_skill_id": None,
        "related_skill_ids_json": "[]",
        "related_skill_snapshots_json": json.dumps([{"name": "IoT 初筛规则", "content": "X" * 40000}], ensure_ascii=False),
        "related_resume_file_id": 11,
        "related_publish_task_id": None,
        "memory_source": "position_binding",
        "skill_resolution_source": "position_binding",
        "skill_resolution_detail_json": json.dumps({"source": "position_binding", "note": "Y" * 40000}, ensure_ascii=False),
        "score_rule_snapshot_json": json.dumps([{"label": "IoT协议", "rule": "Z" * 40000}], ensure_ascii=False),
        "timing_breakdown_json": json.dumps({"score_duration_ms": 87583, "total_duration_ms": 87583}, ensure_ascii=False),
        "request_hash": "hash-1",
        "model_provider": "openai-compatible",
        "model_name": "minimax",
        "model_source": "db:minimax",
        "prompt_snapshot": "P" * 40000,
        "input_summary": "input " * 2000,
        "output_summary": "output " * 2000,
        "output_snapshot": json.dumps({"raw": "O" * 50000, "nested": {"more": "N" * 50000}}, ensure_ascii=False),
        "raw_response_text": "R" * 50000,
        "parsed_response_json": json.dumps({"score": {"recommendation": "K" * 50000}}, ensure_ascii=False),
        "sanitized_response_json": json.dumps({"score": {"dimensions": [{"label": "IoT协议", "reason": "Q" * 50000}]}}, ensure_ascii=False),
        "validation_meta_json": json.dumps({"validation_warnings": ["W" * 50000]}, ensure_ascii=False),
        "persisted_result_refs_json": json.dumps({"candidate_status_after": "pending_screening"}, ensure_ascii=False),
        "duration_ms": 87583,
        "status": "success",
        "error_message": None,
        "token_usage_json": json.dumps({"total_tokens": 1234}, ensure_ascii=False),
        "created_by": "tester",
        "created_at": datetime(2026, 4, 14, 12, 0, 0),
        "updated_at": datetime(2026, 4, 14, 12, 1, 28),
        "full_request_snapshot": json.dumps({"messages": ["M" * 40000]}, ensure_ascii=False),
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def test_stream_text_uses_provided_runtime_config_without_resolving_again():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(side_effect=AssertionError("should not resolve again"))
    gateway._stream_openai_compatible_completion = Mock(
        return_value={
            "content": {"markdown": "ok", "html": "ok"},
            "token_usage": {"total_tokens": 12},
        }
    )
    runtime_config = RecruitmentLLMRuntimeConfig(
        provider="openai-compatible",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="db:MINIMAX",
        api_key_masked="***",
        extra_config={},
    )

    result = gateway.stream_text(
        task_type="jd_generation",
        system_prompt="system",
        user_prompt="user",
        on_delta=lambda chunk: None,
        runtime_config=runtime_config,
    )

    assert result["provider"] == "openai-compatible"
    assert result["model_name"] == "MiniMax-M2.7-highspeed"
    assert result["source"] == "db:MINIMAX"
    gateway.resolve_config.assert_not_called()
    assert gateway._stream_openai_compatible_completion.call_args.args[0].source == "db:MINIMAX"


def test_ai_task_log_display_prefers_full_request_snapshot_runtime():
    service = RecruitmentService(Mock())
    row = _build_ai_task_log_row(
        task_type="ai_position_rematch",
        related_candidate_id=1770,
        model_provider="Claude",
        model_name="qwen3.7-max",
        model_source="db:千问04",
        full_request_snapshot=json.dumps(
            {
                "provider": "openai-compatible",
                "runtime_provider": "openai-compatible",
                "model_name": "MiniMax-M2.7-highspeed",
                "source": "db:MINIMAX",
                "request_body": {"model": "MiniMax-M2.7-highspeed"},
            },
            ensure_ascii=False,
        ),
    )

    payload = service._serialize_ai_task_log(row)

    assert payload["model_provider"] == "openai-compatible"
    assert payload["model_name"] == "MiniMax-M2.7-highspeed"
    assert payload["model_source"] == "db:MINIMAX"


def test_finish_ai_task_log_persists_full_request_snapshot_runtime():
    service = RecruitmentService(Mock())
    row = _build_ai_task_log_row(
        status="running",
        stage="scoring",
        model_provider="Claude",
        model_name="qwen3.7-max",
        model_source="db:千问04",
    )
    full_request_snapshot = json.dumps(
        {
            "provider": "openai-compatible",
            "runtime_provider": "openai-compatible",
            "model_name": "MiniMax-M2.7-highspeed",
            "source": "db:MINIMAX",
            "request_body": {"model": "MiniMax-M2.7-highspeed"},
        },
        ensure_ascii=False,
    )

    service._finish_ai_task_log(
        row,
        status="success",
        request_hash="actual-runtime-hash",
        provider="Claude",
        model_name="qwen3.7-max",
        model_source="db:千问04",
        full_request_snapshot=full_request_snapshot,
        emit_sse=False,
    )

    assert row.model_provider == "openai-compatible"
    assert row.model_name == "MiniMax-M2.7-highspeed"
    assert row.model_source == "db:MINIMAX"
    assert row.request_hash == "actual-runtime-hash"


def test_sanitize_dimensions_preserves_evidence_list():
    dimensions = sanitize_dimensions(
        [
            {
                "label": "IoT协议",
                "score": 1.0,
                "max_score": 1.0,
                "reason": "命中",
                "evidence": ["BLE 协议测试", "Zigbee 联调"],
            }
        ],
        SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
    )

    assert dimensions[0]["evidence"] == ["BLE 协议测试", "Zigbee 联调"]


def test_classify_screening_score_validity_marks_rule_text_evidence_invalid():
    score_payload = {
        "total_score": 1.0,
        "match_percent": 10,
        "advantages": ["有经验"],
        "concerns": ["需补充"],
        "recommendation": "建议继续观察",
        "suggested_status": "talent_pool",
        "dimensions": [
            {
                "label": "IoT协议",
                "score": 1.0,
                "max_score": 1.0,
                "reason": "命中",
                "evidence": ["核心第一优先，要求 BLE/Zigbee 协议经验"],
            }
        ],
    }
    schema_config = {
        "score": {
            **SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
            "required_dimension_labels": ("IoT协议",),
        }
    }

    valid, reasons = _classify_screening_score_validity(
        score_payload,
        schema_config,
        validation_warnings=["维度[IoT协议]的evidence疑似引用了 Skill/JD 规则文本。"],
    )

    assert valid is False
    assert any("Skill/JD 规则文本" in item for item in reasons)


def test_one_pass_salvages_top_level_suggested_status_and_dimensions():
    skill_snapshots = _build_screening_rule_skill_snapshots()
    schema_config = _build_screening_schema_config(skill_snapshots)
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "王欢",
                "phone": "",
                "email": "",
                "years_of_experience": "5年",
                "education": "本科",
                "location": "上海",
            },
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 5.0,
            "match_percent": 50,
            "advantages": ["有 IoT 协议测试经验"],
            "concerns": ["自动化经验还需补充"],
            "recommendation": "建议保留观察",
            "suggested_status": "",
            "dimensions": [],
        },
        "suggested_status": "talent_pool",
        "dimensions": [
            {
                "label": "IoT协议",
                "score": 5.0,
                "max_score": 5.0,
                "reason": "命中核心要求",
                "evidence": ["负责 BLE 协议联调与测试"],
                "is_inferred": False,
            },
            {
                "label": "自动化测试",
                "score": 0.0,
                "max_score": 3.0,
                "reason": "简历未提及",
                "evidence": [],
                "is_inferred": False,
            },
            {
                "label": "文档输出能力",
                "score": 0.0,
                "max_score": 2.0,
                "reason": "简历未提及",
                "evidence": [],
                "is_inferred": False,
            },
        ],
    }

    sanitized_payload, meta = sanitize_screening_payload(
        payload,
        schema_config,
        one_pass_compat=True,
        skill_snapshots=skill_snapshots,
    )
    valid, reasons = _classify_screening_score_validity(
        sanitized_payload["score"],
        schema_config,
        validation_warnings=meta["warnings"],
    )

    # P0-1：最终状态由确定性规则推导（50 分 < pool 阈值 55 → screening_rejected），
    # 模型给的 talent_pool 仅作审计留存。
    assert sanitized_payload["score"]["suggested_status"] == "screening_rejected"
    assert meta["raw_model_suggested_status"] == "talent_pool"
    assert [item["label"] for item in sanitized_payload["score"]["dimensions"]] == ["IoT协议", "自动化测试", "文档输出能力"]
    assert any("top-level stray score 字段" in item for item in meta["warnings"])
    assert valid is True
    assert reasons == []


def test_one_pass_backfills_missing_required_dimensions_as_zero_score():
    skill_snapshots = _build_screening_rule_skill_snapshots()
    schema_config = _build_screening_schema_config(skill_snapshots)
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "王欢",
                "phone": "",
                "email": "",
                "years_of_experience": "5年",
                "education": "本科",
                "location": "上海",
            },
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 8.0,
            "match_percent": 80,
            "advantages": ["有 BLE 协议测试经验"],
            "concerns": ["文档能力待确认"],
            "recommendation": "建议保留观察",
            "suggested_status": "talent_pool",
            "dimensions": [
                {
                    "label": "IoT协议",
                    "score": 5.0,
                    "max_score": 5.0,
                    "reason": "命中核心要求",
                    "evidence": ["负责 BLE 协议联调与测试"],
                    "is_inferred": False,
                }
            ],
        },
    }

    sanitized_payload, meta = sanitize_screening_payload(
        payload,
        schema_config,
        one_pass_compat=True,
        skill_snapshots=skill_snapshots,
    )
    dimensions = sanitized_payload["score"]["dimensions"]

    assert [item["label"] for item in dimensions] == ["IoT协议", "自动化测试", "文档输出能力"]
    assert dimensions[1]["score"] == 0.0
    assert dimensions[1]["reason"] == "简历未提及"
    assert dimensions[1]["evidence"] == []
    assert dimensions[2]["score"] == 0.0
    assert sanitized_payload["score"]["total_score"] == 5.0
    assert sanitized_payload["score"]["match_percent"] == 50
    assert any("已按规则补零" in item for item in meta["warnings"])
    assert any("score.total_score 已按 dimensions 自动校正" == item for item in meta["warnings"])
    assert any("score.match_percent 已按 total_score 自动校正" == item for item in meta["warnings"])


def test_one_pass_derives_suggested_status_when_missing_but_score_is_complete():
    skill_snapshots = _build_screening_rule_skill_snapshots()
    schema_config = _build_screening_schema_config(skill_snapshots)
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "王欢",
                "phone": "",
                "email": "",
                "years_of_experience": "5年",
                "education": "本科",
                "location": "上海",
            },
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 8.0,
            "match_percent": 80,
            "advantages": ["IoT 协议和自动化基础较好"],
            "concerns": ["文档能力需面试确认"],
            "recommendation": "建议安排首面",
            "suggested_status": "",
            "dimensions": [
                {
                    "label": "IoT协议",
                    "score": 5.0,
                    "max_score": 5.0,
                    "reason": "命中核心要求",
                    "evidence": ["负责 BLE 协议联调与测试"],
                    "is_inferred": False,
                },
                {
                    "label": "自动化测试",
                    "score": 3.0,
                    "max_score": 3.0,
                    "reason": "有自动化平台经验",
                    "evidence": ["使用 Python 编写自动化测试脚本"],
                    "is_inferred": False,
                },
                {
                    "label": "文档输出能力",
                    "score": 0.0,
                    "max_score": 2.0,
                    "reason": "简历未提及",
                    "evidence": [],
                    "is_inferred": False,
                },
            ],
        },
    }

    sanitized_payload, meta = sanitize_screening_payload(
        payload,
        schema_config,
        one_pass_compat=True,
        skill_snapshots=skill_snapshots,
    )

    assert meta["raw_model_suggested_status"] is None
    assert meta["normalized_final_suggested_status"] == "screening_passed"
    assert sanitized_payload["score"]["suggested_status"] == "screening_passed"
    assert any("已按最终分数规则自动推导" in item for item in meta["warnings"])


def test_one_pass_selects_usable_candidate_over_empty_shell_score():
    skill_snapshots = _build_screening_rule_skill_snapshots()
    schema_config = _build_screening_schema_config(skill_snapshots)
    empty_shell = {
        "parsed_resume": {
            "basic_info": {"name": "王欢", "education": "本科", "years_of_experience": "5年"},
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 0,
            "match_percent": 0,
            "advantages": [],
            "concerns": [],
            "recommendation": "",
            "suggested_status": "",
            "dimensions": [],
        },
    }
    usable = {
        "parsed_resume": {
            "basic_info": {"name": "王欢", "education": "本科", "years_of_experience": "5年"},
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 8.0,
            "match_percent": 80,
            "advantages": ["IoT 协议经验较强"],
            "concerns": ["文档能力待确认"],
            "recommendation": "建议安排首面",
            "suggested_status": "screening_passed",
            "dimensions": [
                {"label": "IoT协议", "score": 5.0, "max_score": 5.0, "reason": "命中", "evidence": ["负责 BLE 协议联调"], "is_inferred": False},
                {"label": "自动化测试", "score": 3.0, "max_score": 3.0, "reason": "命中", "evidence": ["使用 Python 编写自动化脚本"], "is_inferred": False},
                {"label": "文档输出能力", "score": 0.0, "max_score": 2.0, "reason": "简历未提及", "evidence": [], "is_inferred": False},
            ],
        },
    }

    selected, meta = _select_one_pass_json_candidate(
        f"{json.dumps(empty_shell, ensure_ascii=False)}\n{json.dumps(usable, ensure_ascii=False)}",
        {},
        schema_config=schema_config,
        skill_snapshots=skill_snapshots,
    )

    assert selected["score"]["recommendation"] == "建议安排首面"
    assert meta["selected_candidate_index"] == 1
    assert meta["selected_candidate_empty_score"] is False


def test_strict_one_pass_merges_split_section_array_response():
    raw_response = json.dumps(
        [
            {
                "parsed_resume": {
                    "basic_info": {"name": "冯筱楠", "phone": "187-0100-2872"},
                    "work_experiences": [{"company": "北京神州租车汽车租赁有限公司"}],
                    "education_experiences": [],
                    "skills": ["SQL", "Python"],
                    "projects": [],
                    "summary": "商务拓展经验丰富",
                }
            },
            {
                "total_score": 1.8,
                "match_percent": 18,
                "advantages": ["学历背景良好"],
                "concerns": ["缺少产品经理经验"],
                "recommendation": "建议不通过初筛",
                "suggested_status": "screening_rejected",
                "dimensions": [
                    {
                        "label": "履约系统产品经验",
                        "score": 0,
                        "max_score": 2.5,
                        "reason": "简历未提及",
                        "evidence": "",
                        "is_inferred": False,
                        "radar_category": "专业能力",
                    }
                ],
                "radar_scores": [
                    {
                        "category": "专业能力",
                        "score": 0.7,
                        "max_score": 2.0,
                        "reason": "缺少产品经验",
                        "evidence": "SQL、Python数据分析工具",
                    }
                ],
            },
            {
                "recommended_position": "高级商务经理",
                "confidence": 95,
                "reason": "商务经验匹配",
                "potential_position": "商务总监",
                "potential_reason": "渠道管理经验丰富",
            },
        ],
        ensure_ascii=False,
    )

    result = _parse_strict_json_response(raw_response, task_type=SCREENING_ONE_PASS_TASK_TYPE)

    assert result["content"]["parsed_resume"]["basic_info"]["name"] == "冯筱楠"
    assert result["content"]["score"]["suggested_status"] == "screening_rejected"
    assert result["content"]["position_match"]["recommended_position"] == "高级商务经理"
    assert result["debug_meta"]["selected_candidate_source"] == "split_section_objects"


def test_strict_one_pass_repairs_inner_quotes_and_missing_array_object_open():
    raw_response = (
        '{"parsed_resume":{"basic_info":{"name":"唐琳"},"work_experiences":[],"education_experiences":[],'
        '"skills":[],"projects":[],"summary":""},'
        '"score":{"total_score":5.2,"match_percent":52,"advantages":["产品经验"],"concerns":["AI经验不足"],'
        '"recommendation":"建议不通过初筛","suggested_status":"screening_rejected",'
        '"dimensions":[{"label":"AI智能化能力","score":0,"max_score":2.2,'
        '"reason":"简历仅提及"了解AI绘画Stable diffusion"，未提及主流AI工具",'
        '"evidence":"了解AI绘画Stable diffusion","is_inferred":false,"radar_category":"专业能力"}],'
        '"radar_scores":[{"category":"专业能力","score":1.2,"max_score":2.0,"reason":"工具链完整",'
        '"evidence":"Axure"},"category":"学习潜力","score":0.9,"max_score":2.0,'
        '"reason":"有持续学习轨迹","evidence":"艺术设计本科"}]},'
        '"position_match":{"recommended_position":"产品经理","confidence":55,"reason":"产品经验","potential_position":"数据产品经理","potential_reason":"数据工具基础"}}'
    )

    result = _parse_strict_json_response(raw_response, task_type=SCREENING_ONE_PASS_TASK_TYPE)

    assert result["content"]["parsed_resume"]["basic_info"]["name"] == "唐琳"
    assert result["content"]["score"]["dimensions"][0]["reason"] == '简历仅提及"了解AI绘画Stable diffusion",未提及主流AI工具'
    assert len(result["content"]["score"]["radar_scores"]) == 2
    assert result["content"]["score"]["radar_scores"][1]["category"] == "学习潜力"


def test_strict_one_pass_repairs_extra_array_closer_after_string_field():
    raw_response = (
        '{"parsed_resume":{"basic_info":{"name":"罗艳艳"},"work_experiences":[],"education_experiences":[],'
        '"skills":[],"projects":[],"summary":""},'
        '"score":{"total_score":9.1,"match_percent":91,"advantages":["硬件测试经验丰富"],"concerns":["无明显硬性不足"],'
        '"recommendation":"候选人硬件测试能力突出,建议进入下一轮面试"],'
        '"suggested_status":"screening_passed","dimensions":[{"label":"硬件测试方法与流程","score":2.3,'
        '"max_score":2.5,"reason":"测试经验完整","evidence":"硬件测试","is_inferred":false,'
        '"radar_category":"专业能力"}],"radar_scores":[]},'
        '"position_match":{"recommended_position":"硬件测试工程师","confidence":95,"reason":"经验匹配",'
        '"potential_position":"硬件测试组长","potential_reason":"测试流程管理经验"}}'
    )

    result = _parse_strict_json_response(raw_response, task_type=SCREENING_ONE_PASS_TASK_TYPE)

    assert result["content"]["parsed_resume"]["basic_info"]["name"] == "罗艳艳"
    assert result["content"]["score"]["recommendation"] == "候选人硬件测试能力突出,建议进入下一轮面试"
    assert result["content"]["score"]["suggested_status"] == "screening_passed"


def test_strict_one_pass_repairs_orphan_evidence_string_values():
    raw_response = (
        '{"parsed_resume":{"basic_info":{"name":"高锋","email":"454863113@qq.com","age":"33"},'
        '"work_experiences":[],"education_experiences":[],"skills":[],"projects":[],"summary":""},'
        '"score":{"total_score":3.8,"match_percent":38,"advantages":["项目交付经验"],'
        '"concerns":["协议经验需确认"],"recommendation":"建议进入人才池","suggested_status":"talent_pool",'
        '"dimensions":[{"label":"基础条件匹配","score":0.5,"max_score":0.5,'
        '"reason":"年龄和驾照匹配","evidence":"33岁","驾驶证C1","is_inferred":false,'
        '"radar_category":"岗位匹配度"}],'
        '"radar_scores":[{"category":"岗位匹配度","score":1.6,"max_score":2.0,'
        '"reason":"基础条件匹配","evidence":"33岁","驾驶证C1"}]},'
        '"position_match":{"recommended_position":"智能家居技术工程师","confidence":75,'
        '"reason":"项目经验匹配","potential_position":"弱电智能化项目经理",'
        '"potential_reason":"具备项目管控经验"}}'
    )

    result = _parse_strict_json_response(raw_response, task_type=SCREENING_ONE_PASS_TASK_TYPE)

    dimension_evidence = result["content"]["score"]["dimensions"][0]["evidence"]
    radar_evidence = result["content"]["score"]["radar_scores"][0]["evidence"]
    assert dimension_evidence == ["33岁", "驾驶证C1"]
    assert radar_evidence == ["33岁", "驾驶证C1"]
    assert result["content"]["score"]["suggested_status"] == "talent_pool"


def test_strict_one_pass_recovers_parse_only_fragment_array_for_score_salvage():
    raw_response = json.dumps(
        [
            {
                "name": "王召",
                "phone": "18910827602",
                "email": "wangzhao6288@163.com",
                "years_of_experience": "14年",
                "education": "中国传媒大学 艺术设计 本科",
                "location": "北京",
                "expected_city": "北京",
            },
            {
                "company": "昆仑数智",
                "title": "产品经理",
                "duration": "2024.04—2026.03",
                "description": "油气专业软件共享数字化解决方案",
            },
            {
                "school": "中国传媒大学",
                "degree": "本科",
                "major": "艺术设计",
                "duration": "2015.03—2017.07",
            },
        ],
        ensure_ascii=False,
    )

    result = _parse_strict_json_response(raw_response, task_type=SCREENING_ONE_PASS_TASK_TYPE)

    assert result["content"]["parsed_resume"]["basic_info"]["name"] == "王召"
    assert result["content"]["parsed_resume"]["work_experiences"][0]["company"] == "昆仑数智"
    assert result["content"]["parsed_resume"]["education_experiences"][0]["school"] == "中国传媒大学"
    assert result["content"]["score"] == {}
    assert result["debug_meta"]["selected_candidate_source"] == "parse_only_fragment_array"


def test_strict_one_pass_merges_raw_parse_fragments_with_score_object():
    raw_response = json.dumps(
        [
            {"name": "王召", "phone": "18910827602", "years_of_experience": "14年"},
            {"company": "昆仑数智", "title": "产品经理", "duration": "2024.04—2026.03"},
            {
                "total_score": 6.5,
                "match_percent": 65,
                "advantages": ["数字化产品经验"],
                "concerns": ["履约系统经验不足"],
                "recommendation": "建议进入人才库",
                "suggested_status": "talent_pool",
                "dimensions": [
                    {
                        "label": "履约系统产品经验",
                        "score": 1.0,
                        "max_score": 2.5,
                        "reason": "有数字化平台经验",
                        "evidence": "数字化解决方案",
                        "is_inferred": False,
                        "radar_category": "岗位匹配度",
                    }
                ],
            },
        ],
        ensure_ascii=False,
    )

    result = _parse_strict_json_response(raw_response, task_type=SCREENING_ONE_PASS_TASK_TYPE)

    assert result["content"]["parsed_resume"]["basic_info"]["name"] == "王召"
    assert result["content"]["parsed_resume"]["work_experiences"][0]["company"] == "昆仑数智"
    assert result["content"]["score"]["suggested_status"] == "talent_pool"
    assert result["debug_meta"]["selected_candidate_source"] == "split_section_objects"


def test_one_pass_selects_more_salvageable_candidate_over_empty_shell_score():
    skill_snapshots = _build_screening_rule_skill_snapshots()
    schema_config = _build_screening_schema_config(skill_snapshots)
    empty_shell = {
        "parsed_resume": {
            "basic_info": {"name": "王欢", "education": "本科", "years_of_experience": "5年"},
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 0,
            "match_percent": 0,
            "advantages": [],
            "concerns": [],
            "recommendation": "",
            "suggested_status": "",
            "dimensions": [],
        },
    }
    salvageable = {
        "parsed_resume": {
            "basic_info": {"name": "王欢", "education": "本科", "years_of_experience": "5年"},
            "summary": "",
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
        },
        "score": {
            "total_score": 8.0,
            "match_percent": 80,
            "advantages": ["IoT 协议经验较强"],
            "concerns": ["文档能力待确认"],
            "recommendation": "",
            "suggested_status": "screening_passed",
            "dimensions": [
                {"label": "IoT协议", "score": 5.0, "max_score": 5.0, "reason": "命中", "evidence": ["负责 BLE 协议联调"], "is_inferred": False},
                {"label": "自动化测试", "score": 3.0, "max_score": 3.0, "reason": "命中", "evidence": ["使用 Python 编写自动化脚本"], "is_inferred": False},
                {"label": "文档输出能力", "score": 0.0, "max_score": 2.0, "reason": "简历未提及", "evidence": [], "is_inferred": False},
            ],
        },
    }

    selected, meta = _select_one_pass_json_candidate(
        f"{json.dumps(empty_shell, ensure_ascii=False)}\n{json.dumps(salvageable, ensure_ascii=False)}",
        {},
        schema_config=schema_config,
        skill_snapshots=skill_snapshots,
    )

    assert selected["score"]["suggested_status"] == "screening_passed"
    assert selected["score"]["recommendation"] == ""
    assert meta["selected_candidate_index"] == 1
    assert meta["selected_candidate_validity_rank"] == 1


def test_enqueue_screen_candidate_reuses_existing_live_task():
    service = RecruitmentService(Mock())
    service._get_candidate = Mock(return_value=SimpleNamespace(id=7, position_id=3, latest_resume_file_id=11))
    service._find_live_screening_task = Mock(return_value=SimpleNamespace(id=101, status="running", screening_run_id="run-101"))

    payload = service.enqueue_screen_candidate(7, "tester")

    assert payload == {
        "batch_id": None,
        "task_id": 101,
        "status": "running",
        "task_type": SCREENING_FLOW_TASK_TYPE,
        "related_candidate_id": 7,
        "related_position_id": 3,
        "screening_run_id": "run-101",
        "reused_existing_task": True,
        "reused_existing_result": False,
    }


def test_batch_start_screen_candidates_reports_queued_and_skipped_counts():
    service = RecruitmentService(Mock())
    queued = {
        "task_id": 201,
        "status": "queued",
        "task_type": SCREENING_FLOW_TASK_TYPE,
        "related_candidate_id": 1,
        "related_position_id": 11,
        "reused_existing_task": False,
        "reused_existing_result": False,
    }
    reused = {
        "task_id": 202,
        "status": "running",
        "task_type": SCREENING_FLOW_TASK_TYPE,
        "related_candidate_id": 2,
        "related_position_id": 11,
        "reused_existing_task": True,
        "reused_existing_result": False,
    }
    service.enqueue_screen_candidate = Mock(side_effect=[queued, reused])
    service._dispatch_screening_queue = Mock(return_value={"started_count": 1, "active_count": 1, "max_concurrency": 8})

    payload = service.batch_start_screen_candidates([1, 2], "tester")

    assert payload["batch_id"]
    assert payload["total_count"] == 2
    assert payload["queued_count"] == 1
    assert payload["duplicated_count"] == 0
    assert payload["skipped_existing_live_task_count"] == 1
    assert payload["failed_count"] == 0
    assert payload["task_ids"] == [201, 202]


def test_dispatch_screening_queue_uses_screening_root_task_filter():
    service = RecruitmentService(Mock())
    stale_query = Mock()
    stale_query.filter.return_value = stale_query
    stale_query.order_by.return_value = stale_query
    stale_query.all.return_value = []
    queued_query = Mock()
    queued_query.filter.return_value = queued_query
    queued_query.order_by.return_value = queued_query
    queued_query.with_for_update.return_value = queued_query
    queued_query.limit.return_value = queued_query
    queued_query.all.return_value = [SimpleNamespace(id=301, created_by="tester")]
    dispatch_db = Mock()
    dispatch_db.query = Mock(side_effect=[stale_query, queued_query])
    service._start_background_ai_task = Mock()
    service._build_screening_queue_runner = Mock(return_value=Mock())

    with patch("app.services.recruitment_service_impl.SessionLocal", return_value=dispatch_db), \
            patch.object(RecruitmentService, "_screening_root_task_filter", return_value="ROOT_FILTER"), \
            patch.object(RecruitmentService, "_mark_screening_task_claimed") as mark_claimed, \
            patch("app.services.recruitment_service_impl._screening_provider_cooldown_until", None), \
            patch("app.services.recruitment_service_impl._screening_worker_active_task_ids", set()):
        payload = service._dispatch_screening_queue()

    assert payload["started_count"] == 1
    assert "ROOT_FILTER" in queued_query.filter.call_args.args
    queued_query.with_for_update.assert_called_once_with(skip_locked=True)
    mark_claimed.assert_called_once()
    service._start_background_ai_task.assert_called_once()


def test_sync_position_task_skill_bindings_keeps_three_task_selections_independent():
    service = RecruitmentService(Mock())
    row = SimpleNamespace(
        id=201,
        jd_skill_ids_json=json.dumps([901], ensure_ascii=False),
        screening_skill_ids_json=json.dumps([902], ensure_ascii=False),
        interview_skill_ids_json=json.dumps([903], ensure_ascii=False),
    )
    service._sync_position_skill_links = Mock()
    # 产品护栏：绑定时校验评估方案的 task_type 与槽位匹配——夹具须提供类型正确的 skill
    _skills = {
        101: _build_skill_row(101, "jd", group="g"),
        202: _build_skill_row(202, "screening", group="g"),
        303: _build_skill_row(303, "interview", group="g"),
    }
    service._get_skill = Mock(side_effect=lambda skill_id: _skills[int(skill_id)])

    service._sync_position_task_skill_bindings(
        row,
        actor_id="tester",
        jd_skill_ids=[101, 101],
        screening_skill_ids=[202],
        interview_skill_ids=[303],
    )

    assert json.loads(row.jd_skill_ids_json) == [101]
    assert json.loads(row.screening_skill_ids_json) == [202]
    assert json.loads(row.interview_skill_ids_json) == [303]
    service._sync_position_skill_links.assert_called_once_with(row.id, [101, 202, 303], "tester")


def test_resolve_jd_skills_prefers_system_base_before_global_fallback():
    service = RecruitmentService(Mock())
    position = SimpleNamespace(id=301)
    base_jd = _build_skill_row(311, "jd", group="system-base", version="v1")
    global_jd = _build_skill_row(312, "jd", group="global-fallback", version="v1")
    service._load_skill_rows = Mock(return_value=[])
    service._get_position_task_skill_rows = Mock(return_value=[])
    service._load_system_base_skill_rows = Mock(return_value=[base_jd])
    service._load_enabled_skills = Mock(return_value=[global_jd])

    rows, source = service._resolve_jd_skills(position)

    assert [row.id for row in rows] == [base_jd.id]
    assert source == "system_builtin_base"
    service._load_enabled_skills.assert_not_called()


def test_resolve_screening_skills_prefers_system_base_before_candidate_memory():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=401, position_id=77)
    workflow = SimpleNamespace(
        screening_skill_ids_json=json.dumps([998], ensure_ascii=False),
        screening_memory_source="candidate_memory",
    )
    base_screening = _build_skill_row(411, "screening", group="system-base", version="v1")
    service._get_position = Mock(return_value=SimpleNamespace(id=77))
    service._get_position_task_skill_ids = Mock(return_value=[])
    service._get_workflow_memory = Mock(return_value=workflow)
    service._load_skill_rows = Mock(return_value=[])
    service._get_position_task_skill_rows = Mock(return_value=[])
    service._load_system_base_skill_rows = Mock(return_value=[base_screening])

    rows, source, memory_source, detail = service._resolve_screening_skills(candidate, None)

    assert [row.id for row in rows] == [base_screening.id]
    assert source == "system_builtin_base"
    assert memory_source == "system_builtin_base"
    assert detail["used_candidate_memory"] is False
    assert detail["workflow_memory_skill_ids"] == [998]


def test_resolve_interview_skills_prefers_system_base_before_candidate_memory():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=501, position_id=88)
    workflow = SimpleNamespace(
        interview_skill_ids_json=json.dumps([1234], ensure_ascii=False),
        screening_memory_source="candidate_memory",
    )
    base_interview = _build_skill_row(511, "interview", group="system-base", version="v1")
    service._load_skill_rows = Mock(return_value=[])
    service._get_position_task_skill_rows = Mock(return_value=[])
    service._load_system_base_skill_rows = Mock(return_value=[base_interview])
    service._get_workflow_memory = Mock(return_value=workflow)

    rows, source = service._resolve_interview_skills(candidate, None)

    assert [row.id for row in rows] == [base_interview.id]
    assert source == "system_builtin_base"


def test_resume_screening_queue_on_startup_requeues_orphans_by_process_boot_time():
    # P0.1：重投判定与孤儿判定同源——最后心跳早于本进程启动时间即为中断孤儿，
    # 直接重投（不再只重投"超过 10 分钟陈旧"的任务，避免重启前几分钟的任务漏投后
    # 又被孤儿结算按启动时间判死）。心跳晚于本进程启动时间的任务视为仍在执行，不动。
    service = RecruitmentService(Mock())
    boot = recruitment_impl.PROCESS_BOOTED_AT
    interrupted_row = SimpleNamespace(
        id=401,
        status="running",
        stage="running",
        updated_at=boot - timedelta(minutes=3),
        stage_started_at=boot - timedelta(minutes=4),
        created_at=boot - timedelta(minutes=5),
        output_snapshot=None,
        validation_meta_json=None,
        duration_ms=99,
        error_message="boom",
        output_summary="old",
    )
    live_row = SimpleNamespace(
        id=402,
        status="running",
        stage="running",
        updated_at=boot + timedelta(minutes=1),
        stage_started_at=boot + timedelta(minutes=1),
        created_at=boot - timedelta(minutes=1),
        output_snapshot=None,
        validation_meta_json=None,
        duration_ms=None,
        error_message=None,
        output_summary="live",
    )
    query = _build_query_mock(all_value=[interrupted_row, live_row])
    service.db.query.return_value = query
    service._dispatch_screening_queue = Mock(return_value={"started_count": 1, "active_count": 1, "max_concurrency": 1})

    with patch.object(RecruitmentService, "_screening_root_task_filter", return_value="ROOT_FILTER"), \
            patch("app.services.recruitment_service_impl._screening_worker_active_task_ids", {interrupted_row.id, live_row.id}):
        payload = service.resume_screening_queue_on_startup()

    assert payload["requeued_task_ids"] == [interrupted_row.id]
    assert interrupted_row.status == "queued"
    assert interrupted_row.stage == "queued"
    assert live_row.status == "running"
    service.db.commit.assert_called_once()
    service._dispatch_screening_queue.assert_called_once()


def test_prepare_json_request_context_uses_remaining_budget_as_effective_timeout():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 300, "max_retries": 1},
        )
    )

    context = gateway.prepare_json_request_context(
        task_type="resume_parse",
        system_prompt="SYSTEM",
        user_prompt="USER",
        timeout_seconds_override=280,
        screening_total_timeout_seconds=SCREENING_TOTAL_TIMEOUT_SECONDS,
        remaining_budget_seconds=280,
    )

    assert context["provider"] == "glm"
    assert context["runtime_provider"] == "openai-compatible"
    assert context["model_name"] == "glm-5"
    assert context["source"] == "test"
    assert context["timeout_seconds"] == 280.0
    assert context["configured_read_timeout_seconds"] == 300.0
    assert context["effective_timeout_seconds"] == 280.0
    assert context["remaining_budget_seconds"] == 280
    assert context["is_stream_mode"] is False
    assert context["runtime_config"].extra_config["use_stream_json"] is False
    assert context["runtime_config"].extra_config["max_retries"] == 0
    assert '"stream": false' in context["full_request_snapshot"].lower()


def test_resume_score_uses_openai_non_stream_json_by_default():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 300, "max_retries": 2, "use_stream_json": True},
        )
    )

    context = gateway.prepare_json_request_context(
        task_type="resume_score",
        system_prompt="SYSTEM",
        user_prompt="USER",
        timeout_seconds_override=280,
        screening_total_timeout_seconds=SCREENING_TOTAL_TIMEOUT_SECONDS,
        remaining_budget_seconds=280,
    )

    assert context["is_stream_mode"] is False
    assert context["runtime_config"].extra_config["use_stream_json"] is False
    assert context["runtime_config"].extra_config["max_retries"] == 0
    assert '"stream": false' in context["full_request_snapshot"].lower()


def test_prepare_json_request_context_raises_total_timeout_when_budget_too_low():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 300, "max_retries": 1},
        )
    )

    try:
        gateway.prepare_json_request_context(
            task_type="resume_parse",
            system_prompt="SYSTEM",
            user_prompt="USER",
            timeout_seconds_override=15,
            screening_total_timeout_seconds=SCREENING_TOTAL_TIMEOUT_SECONDS,
            remaining_budget_seconds=15,
        )
        assert False, "expected screening total timeout"
    except RecruitmentAIScreeningTotalTimeoutError as exc:
        assert exc.total_timeout_seconds == SCREENING_TOTAL_TIMEOUT_SECONDS


def test_generate_json_skips_model_call_when_remaining_budget_below_stage_min_timeout():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 300, "max_retries": 1},
        )
    )
    gateway._call_openai_compatible_json = Mock()

    try:
        gateway.generate_json(
            task_type="resume_parse",
            system_prompt="SYSTEM",
            user_prompt="USER",
            timeout_seconds_override=15,
            screening_total_timeout_seconds=SCREENING_TOTAL_TIMEOUT_SECONDS,
            remaining_budget_seconds=15,
        )
        assert False, "expected screening total timeout"
    except RecruitmentAIScreeningTotalTimeoutError:
        pass

    gateway._call_openai_compatible_json.assert_not_called()


def test_resume_parse_default_max_retries_is_zero_for_screening():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 60},
        )
    )

    context = gateway.prepare_json_request_context(
        task_type="resume_parse",
        system_prompt="SYSTEM",
        user_prompt="USER",
    )

    assert context["retry_count"] == 0
    assert context["runtime_config"].extra_config["max_retries"] == 0
    assert context["runtime_config"].extra_config["use_stream_json"] is False


def test_resume_parse_uses_openai_non_stream_json_by_default():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    gateway._call_openai_compatible_json_non_stream = Mock(
        return_value={
            "content": {"basic_info": {"name": "李四"}},
            "token_usage": None,
            "raw_response_text": '{"basic_info":{"name":"李四"}}',
            "response_debug": {"is_stream_mode": False, "raw_response_text_length": 28},
        }
    )
    gateway._stream_openai_compatible_completion = Mock(side_effect=AssertionError("resume_parse should not use stream json by default"))

    payload = gateway._call_openai_compatible_json(
        config,
        "SYSTEM",
        "USER",
        task_type="resume_parse",
    )

    assert payload["response_debug"]["is_stream_mode"] is False
    gateway._call_openai_compatible_json_non_stream.assert_called_once()
    gateway._stream_openai_compatible_completion.assert_not_called()


def test_resume_score_selects_valid_candidate_after_think_and_broken_json_prefix():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    client = Mock()
    client.post = Mock(
        return_value=_build_openai_json_http_response(
            """
<think>先分析岗位要求，再组织 JSON</think>
{"total_score":8.3,"match_percent":83,"advantages":["旧版本"]
说明：上面那段作废，请以下面的最终 JSON 为准。
{"total_score":7.8,"match_percent":78,"advantages":["基础匹配较好"],"concerns":["仍需面试核实"],"recommendation":"建议继续评估","suggested_status":"talent_pool","dimensions":[{"label":"基础匹配","score":7.8,"max_score":10.0,"reason":"命中","evidence":["测试经验"],"is_inferred":false}]}
""".strip()
        )
    )
    client.close = Mock()
    gateway._build_httpx_client = Mock(return_value=client)

    payload = gateway._call_openai_compatible_json_non_stream(
        config,
        "SYSTEM",
        "USER",
        task_type="resume_score",
    )

    assert payload["content"]["total_score"] == 7.8
    assert payload["content"]["match_percent"] == 78
    assert payload["content"]["suggested_status"] == "talent_pool"


def test_resume_score_recovers_missing_comma_json_in_non_stream_mode():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    client = Mock()
    client.post = Mock(
        return_value=_build_openai_json_http_response(
            '{"total_score":7.8 "match_percent":78,"advantages":["基础匹配较好"],"concerns":["仍需面试核实"],"recommendation":"建议继续评估","suggested_status":"talent_pool","dimensions":[{"label":"基础匹配","score":7.8,"max_score":10.0,"reason":"命中","evidence":["测试经验"],"is_inferred":false}]}'
        )
    )
    client.close = Mock()
    gateway._build_httpx_client = Mock(return_value=client)

    payload = gateway._call_openai_compatible_json_non_stream(
        config,
        "SYSTEM",
        "USER",
        task_type="resume_score",
    )

    assert payload["content"]["total_score"] == 7.8
    assert payload["content"]["match_percent"] == 78


def test_resume_score_rejects_conflicting_multiple_valid_candidates():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    raw_text = """
{"total_score":7.8,"match_percent":78,"advantages":["基础匹配较好"],"concerns":["仍需面试核实"],"recommendation":"建议继续评估","suggested_status":"talent_pool","dimensions":[{"label":"基础匹配","score":7.8,"max_score":10.0,"reason":"命中","evidence":["测试经验"],"is_inferred":false}]}
{"total_score":8.1,"match_percent":81,"advantages":["基础匹配较好"],"concerns":["仍需面试核实"],"recommendation":"建议继续评估","suggested_status":"screening_passed","dimensions":[{"label":"自动化测试","score":8.1,"max_score":10.0,"reason":"命中","evidence":["自动化经验"],"is_inferred":false}]}
""".strip()
    client = Mock()
    client.post = Mock(return_value=_build_openai_json_http_response(raw_text))
    client.close = Mock()
    gateway._build_httpx_client = Mock(return_value=client)

    try:
        gateway._call_openai_compatible_json_non_stream(
            config,
            "SYSTEM",
            "USER",
            task_type="resume_score",
        )
        assert False, "expected invalid_json_variant_conflict"
    except RecruitmentAIJSONParseError as exc:
        assert exc.error_code == "invalid_json_variant_conflict"
        assert "suggested_status" in "".join(exc.debug_meta.get("reasons") or []) or "漂移" in str(exc)


def test_generate_json_records_first_attempt_failed_reason_after_retry():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 45, "max_retries": 1, "use_stream_json": False},
        )
    )
    gateway._call_openai_compatible_json = Mock(
        side_effect=[
            httpx.ReadTimeout("timed out"),
            {
                "content": {"basic_info": {"name": "李四"}},
                "token_usage": None,
                "raw_response_text": '{"basic_info":{"name":"李四"}}',
                "response_debug": {"is_stream_mode": False, "raw_response_text_length": 28},
            },
        ]
    )

    payload = gateway.generate_json(
        task_type="chat_orchestrator",
        system_prompt="SYSTEM",
        user_prompt="USER",
    )

    assert payload["response_debug"]["first_attempt_failed_reason"] == "timeout"


def test_generate_json_strict_json_retries_once_for_resume_score_and_then_succeeds():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 45, "max_retries": 0, "use_stream_json": False},
        )
    )
    gateway._call_openai_compatible_json = Mock(
        side_effect=[
            RecruitmentAIJSONParseError(
                "AI screening JSON 解析失败: Expecting ',' delimiter",
                raw_response_text='{"total_score":7.8 "match_percent":78}',
                error_code="json_parse_failed",
                debug_meta={"is_stream_mode": False},
            ),
            {
                "content": {
                    "total_score": 7.8,
                    "match_percent": 78,
                    "advantages": ["基础匹配较好"],
                    "concerns": ["仍需面试核实"],
                    "recommendation": "建议继续评估",
                    "suggested_status": "talent_pool",
                    "dimensions": [
                        {
                            "label": "基础匹配",
                            "score": 7.8,
                            "max_score": 10.0,
                            "reason": "命中",
                            "evidence": ["测试经验"],
                            "is_inferred": False,
                        }
                    ],
                },
                "token_usage": None,
                "raw_response_text": '{"total_score":7.8,"match_percent":78}',
                "response_debug": {"is_stream_mode": False},
                "warnings": [],
            },
        ]
    )

    with patch("app.services.recruitment_ai_gateway.logger.warning") as log_warning:
        payload = gateway.generate_json(
            task_type="resume_score",
            system_prompt="SYSTEM",
            user_prompt="USER",
        )

    assert gateway._call_openai_compatible_json.call_count == 2
    assert payload["response_debug"]["strict_json_recovery_retry_count"] == 1
    assert "strict JSON 首次解析失败，已自动进行一次同 prompt 恢复重试" in payload["warnings"]
    assert any("[STRICT_JSON_RECOVERY]" in str(call.args[0]) for call in log_warning.call_args_list)
    assert all('{"total_score":7.8 "match_percent":78}' not in str(call.args) for call in log_warning.call_args_list)
    assert payload["raw_response_text"] == '{"total_score":7.8,"match_percent":78}'
    assert "SYSTEM" in payload["prompt_snapshot"]
    assert "USER" in payload["prompt_snapshot"]


def test_parse_llm_json_response_repairs_unescaped_inner_quotes():
    raw_text = (
        '{"projects":[{"name":"旅游线路及滴滴导游平台",'
        '"description":"构建"出行+导游"场景融合规划,完成"三重一大"事项决策监督"}],'
        '"score":{"recommendation":"建议继续评估"}}'
    )

    payload = _parse_llm_json_response(raw_text)

    assert payload["projects"][0]["description"] == '构建"出行+导游"场景融合规划,完成"三重一大"事项决策监督'


def test_ai_position_match_corrects_copied_example_id_by_title():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    raw_payload = {
        "position_id": 17,
        "position_title": "IoT测试工程师（研发部）",
        "confidence": 92,
        "reason": "8年测试经验，含小米智能门锁等IoT产品全流程测试",
        "potential_position": "测试开发工程师",
        "potential_reason": "具备接口测试和自动化测试思维",
    }
    gateway.generate_json = Mock(
        return_value={
            "content": raw_payload,
            "provider": "minimax",
            "model_name": "MiniMax-M2.7-highspeed",
            "source": "test",
            "used_fallback": False,
            "error_message": None,
            "prompt_snapshot": "snapshot",
            "full_request_snapshot": "{}",
            "input_summary": "summary",
            "output_summary": "summary",
            "raw_response_text": json.dumps(raw_payload, ensure_ascii=False),
        }
    )

    cancel_control = RecruitmentTaskControl(1472)
    result = gateway.match_position(
        1472,
        "岳珊珊 8年测试经验 小米智能门锁 IOT 全功能测试",
        [
            {"id": 1, "title": "IoT测试工程师", "department": "研发部门", "key_requirements": "iot测试"},
            {"id": 19, "title": "iot测试工程师", "department": "研发部", "key_requirements": ""},
            {"id": 24, "title": "硬件测试工程师", "department": "研发部", "key_requirements": ""},
        ],
        runtime_config=config,
        cancel_control=cancel_control,
    )

    assert result["position_id"] == 19
    assert result["position_title"] == "iot测试工程师（研发部）"
    user_prompt = gateway.generate_json.call_args.kwargs["user_prompt"]
    assert "岗位ID=19" in user_prompt
    assert "岗位名称=税务会计" not in user_prompt
    assert '"position_id": 17' not in user_prompt
    assert gateway.generate_json.call_args.kwargs["cancel_control"] is cancel_control
    assert gateway.generate_json.call_args.kwargs["timeout_seconds_override"] == POSITION_MATCH_REQUEST_TIMEOUT_SECONDS


def test_ai_position_match_maps_product_subtype_to_noisy_product_position():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    raw_payload = {
        "position_id": None,
        "position_title": "AI产品总监",
        "confidence": 88,
        "reason": "产品规划与需求分析经验匹配",
        "potential_position": "售前解决方案专家",
        "potential_reason": "具备业务抽象和客户沟通能力",
    }
    gateway.generate_json = Mock(return_value={
        "content": raw_payload,
        "provider": "minimax",
        "model_name": "MiniMax-M2.7-highspeed",
        "source": "test",
        "used_fallback": False,
        "error_message": None,
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "output_summary": "summary",
        "raw_response_text": json.dumps(raw_payload, ensure_ascii=False),
    })

    result = gateway.match_position(
        2410,
        "SOURCE_FILE_NAME_OR_DELIVERY_POSITION: 产品经理 北京 15 20K\n\n候选人 10年产品规划、需求分析、PRD、跨部门协作经验",
        [
            {"id": 31, "title": "产品经理 北京 15 20K", "department": "", "key_requirements": "产品规划 需求分析"},
            {"id": 32, "title": "装修项目经理", "department": "", "key_requirements": "装修项目管理"},
        ],
        runtime_config=config,
    )

    assert result["position_id"] == 31
    assert result["position_title"] == "产品经理 北京 15 20K"
    assert result["parsed_response"]["position_id"] == 31
    user_prompt = gateway.generate_json.call_args.kwargs["user_prompt"]
    assert "招聘需求桶" in user_prompt
    assert "核心职能一致" in user_prompt


def test_ai_position_match_does_not_cross_match_project_manager_to_product_position():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    raw_payload = {
        "position_id": None,
        "position_title": "项目经理",
        "confidence": 78,
        "reason": "项目计划与交付管理经验突出",
        "potential_position": "项目总监",
        "potential_reason": "具备跨团队推进经验",
    }
    gateway.generate_json = Mock(return_value={
        "content": raw_payload,
        "provider": "minimax",
        "model_name": "MiniMax-M2.7-highspeed",
        "source": "test",
        "used_fallback": False,
        "error_message": None,
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "output_summary": "summary",
        "raw_response_text": json.dumps(raw_payload, ensure_ascii=False),
    })

    result = gateway.match_position(
        2411,
        "候选人 8年项目计划、现场协调、交付管理经验",
        [
            {"id": 31, "title": "产品经理 北京 15 20K", "department": "", "key_requirements": "产品规划 需求分析"},
            {"id": 33, "title": "税务会计", "department": "", "key_requirements": "税务申报"},
        ],
        runtime_config=config,
    )

    assert result["position_id"] is None
    assert result["position_title"] == "项目经理"


def test_ai_position_match_does_not_force_generic_product_into_specific_product_position():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    raw_payload = {
        "position_id": None,
        "position_title": "产品经理",
        "confidence": 74,
        "reason": "具备需求分析和产品规划经验",
        "potential_position": "售前解决方案专家",
        "potential_reason": "具备业务沟通能力",
    }
    gateway.generate_json = Mock(return_value={
        "content": raw_payload,
        "provider": "minimax",
        "model_name": "MiniMax-M2.7-highspeed",
        "source": "test",
        "used_fallback": False,
        "error_message": None,
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "output_summary": "summary",
        "raw_response_text": json.dumps(raw_payload, ensure_ascii=False),
    })

    result = gateway.match_position(
        2412,
        "候选人 6年通用产品规划、需求分析经验，未体现明显金融业务背景",
        [
            {"id": 41, "title": "金融产品经理", "department": "", "key_requirements": "金融支付业务经验"},
        ],
        runtime_config=config,
    )

    assert result["position_id"] is None
    assert result["position_title"] == "产品经理"


def test_ai_position_match_requires_specific_accounting_subtype_when_multiple_exist():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    raw_payload = {
        "position_id": None,
        "position_title": "会计",
        "confidence": 71,
        "reason": "具备会计核算经验",
        "potential_position": "财务分析",
        "potential_reason": "具备数据核算基础",
    }
    gateway.generate_json = Mock(return_value={
        "content": raw_payload,
        "provider": "minimax",
        "model_name": "MiniMax-M2.7-highspeed",
        "source": "test",
        "used_fallback": False,
        "error_message": None,
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "output_summary": "summary",
        "raw_response_text": json.dumps(raw_payload, ensure_ascii=False),
    })

    result = gateway.match_position(
        2413,
        "候选人 5年会计核算经验，未明确税务申报或财务会计方向",
        [
            {"id": 51, "title": "税务会计", "department": "", "key_requirements": "税务申报 纳税筹划"},
            {"id": 52, "title": "财务会计", "department": "", "key_requirements": "财务核算 月结报表"},
        ],
        runtime_config=config,
    )

    assert result["position_id"] is None
    assert result["position_title"] == "会计"
    user_prompt = gateway.generate_json.call_args.kwargs["user_prompt"]
    assert "不要只返回“会计”" in user_prompt
    assert "不要只返回“产品经理”" in user_prompt


def test_ai_position_match_does_not_cross_match_finance_manager_to_accounting_position():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )

    def run_match(position_title: str, positions: list[dict[str, object]]) -> dict[str, object]:
        raw_payload = {
            "position_id": None,
            "position_title": position_title,
            "confidence": 80,
            "reason": "财务管理方向经验突出",
            "potential_position": "财务分析",
            "potential_reason": "具备财务数据和业务理解能力",
        }
        gateway.generate_json = Mock(return_value={
            "content": raw_payload,
            "provider": "minimax",
            "model_name": "MiniMax-M2.7-highspeed",
            "source": "test",
            "used_fallback": False,
            "error_message": None,
            "prompt_snapshot": "snapshot",
            "full_request_snapshot": "{}",
            "input_summary": "summary",
            "output_summary": "summary",
            "raw_response_text": json.dumps(raw_payload, ensure_ascii=False),
        })
        return gateway.match_position(2415, "候选人核心经历为财务管理，不是会计核算", positions, runtime_config=config)

    finance_manager_result = run_match("财务经理", [
        {"id": 52, "title": "财务会计", "department": "", "key_requirements": "财务核算 月结报表"},
    ])
    tax_manager_result = run_match("税务经理", [
        {"id": 51, "title": "税务会计", "department": "", "key_requirements": "税务申报 纳税筹划"},
    ])

    assert finance_manager_result["position_id"] is None
    assert finance_manager_result["position_title"] == "财务经理"
    assert tax_manager_result["position_id"] is None
    assert tax_manager_result["position_title"] == "税务经理"


def test_ai_position_match_keeps_exact_specific_accounting_and_product_matches():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="minimax",
        runtime_provider="openai-compatible",
        model_name="MiniMax-M2.7-highspeed",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )

    def run_match(position_title: str, positions: list[dict[str, object]]) -> dict[str, object]:
        gateway.generate_json = Mock(return_value={
            "content": {
                "position_id": None,
                "position_title": position_title,
                "confidence": 86,
                "reason": "核心方向匹配",
                "potential_position": "业务分析",
                "potential_reason": "具备跨部门沟通能力",
            },
            "provider": "minimax",
            "model_name": "MiniMax-M2.7-highspeed",
            "source": "test",
            "used_fallback": False,
            "error_message": None,
            "prompt_snapshot": "snapshot",
            "full_request_snapshot": "{}",
            "input_summary": "summary",
            "output_summary": "summary",
            "raw_response_text": json.dumps({"position_title": position_title}, ensure_ascii=False),
        })
        return gateway.match_position(2414, "候选人核心经历与投递方向一致", positions, runtime_config=config)

    tax_result = run_match("税务会计", [
        {"id": 51, "title": "税务会计", "department": "", "key_requirements": "税务申报"},
        {"id": 52, "title": "财务会计", "department": "", "key_requirements": "财务核算"},
    ])
    ai_product_result = run_match("AI产品经理", [
        {"id": 61, "title": "AI产品经理", "department": "", "key_requirements": "AI产品规划"},
        {"id": 62, "title": "C端产品经理", "department": "", "key_requirements": "C端增长"},
    ])
    c_product_result = run_match("C端产品经理", [
        {"id": 61, "title": "AI产品经理", "department": "", "key_requirements": "AI产品规划"},
        {"id": 62, "title": "C端产品经理", "department": "", "key_requirements": "C端增长"},
    ])

    assert tax_result["position_id"] == 51
    assert tax_result["position_title"] == "税务会计"
    assert ai_product_result["position_id"] == 61
    assert ai_product_result["position_title"] == "AI产品经理"
    assert c_product_result["position_id"] == 62
    assert c_product_result["position_title"] == "C端产品经理"


def test_generate_json_strict_json_retry_is_bounded_to_once():
    gateway = RecruitmentAIGateway(Mock())
    gateway.resolve_config = Mock(
        return_value=RecruitmentLLMRuntimeConfig(
            provider="glm",
            runtime_provider="openai-compatible",
            model_name="glm-5",
            base_url="https://example.test/v1",
            api_key="secret",
            source="test",
            api_key_masked="***",
            extra_config={"read_timeout_seconds": 45, "max_retries": 0, "use_stream_json": False},
        )
    )
    gateway._call_openai_compatible_json = Mock(
        side_effect=[
            RecruitmentAIJSONParseError(
                "AI screening JSON 解析失败: bad json",
                raw_response_text='{"total_score":7.8 "match_percent":78}',
                error_code="json_parse_failed",
                debug_meta={"is_stream_mode": False},
            ),
            RecruitmentAIJSONParseError(
                "AI screening JSON 解析失败: still bad",
                raw_response_text='{"total_score":7.8 "match_percent":78}',
                error_code="json_parse_failed",
                debug_meta={"is_stream_mode": False},
            ),
        ]
    )

    try:
        gateway.generate_json(
            task_type="resume_score",
            system_prompt="SYSTEM",
            user_prompt="USER",
        )
        assert False, "expected bounded strict json retry failure"
    except RecruitmentAIJSONParseError as exc:
        assert gateway._call_openai_compatible_json.call_count == 2
        assert exc.debug_meta["strict_json_recovery_retry_count"] == 1


def test_openai_non_stream_json_rejects_non_dict_payload():
    gateway = RecruitmentAIGateway(Mock())
    config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    response = Mock()
    response.status_code = 200
    response.headers = {"content-type": "application/json"}
    response.raise_for_status = Mock()
    response.json = Mock(return_value=None)
    response.text = "null"
    client = Mock()
    client.post = Mock(return_value=response)
    client.close = Mock()
    gateway._build_httpx_client = Mock(return_value=client)

    try:
        gateway._call_openai_compatible_json_non_stream(config, "SYSTEM", "USER")
        assert False, "expected invalid provider payload"
    except RecruitmentAIJSONParseError as exc:
        assert exc.error_code == "invalid_provider_payload"


def test_parse_latest_resume_prelogs_request_snapshot_and_passes_cancel_control():
    db = Mock()
    db.add = Mock()
    db.commit = Mock()
    db.refresh = Mock()
    db.flush = Mock()
    db.rollback = Mock()
    service = RecruitmentService(db)
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        name="李四",
        phone=None,
        email=None,
        years_of_experience=None,
        education=None,
        updated_by=None,
    )
    resume_file = SimpleNamespace(
        id=12,
        storage_path="/tmp/demo.pdf",
        file_ext=".pdf",
        parse_status=None,
        parse_error=None,
    )
    log_row = SimpleNamespace(
        id=91,
        status="running",
        created_at=datetime.now(),
        stage_started_at=datetime.now(),
    )
    runtime_config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 90},
    )
    request_context = {
        "runtime_config": runtime_config,
        "provider": "glm",
        "model_name": "glm-5",
        "endpoint": "https://example.test/v1/chat/completions",
        "timeout_seconds": 90.0,
        "retry_count": 1,
        "is_stream_mode": False,
        "full_request_snapshot": {"body": {"model": "glm-5"}},
        "input_summary": "李四 BLE 测试",
        "prompt_snapshot": "SYSTEM:\nPARSE\n\nUSER:\n李四 BLE 测试",
    }
    sanitized_resume = {
        "basic_info": {"name": "李四"},
        "work_experiences": [],
        "education_experiences": [],
        "skills": ["BLE"],
        "projects": [],
        "summary": "具备 BLE 测试经验。",
    }
    service._get_resume_file = Mock(return_value=resume_file)
    service._build_request_hash = Mock(return_value="hash")
    service._create_ai_task_log = Mock(return_value=log_row)
    service._update_ai_task_log = Mock(return_value=log_row)
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 501})
    service._finish_ai_task_log = Mock(return_value=log_row)
    service.ai_gateway.prepare_json_request_context = Mock(return_value=request_context)
    service.ai_gateway.generate_json = Mock(
        return_value={
            "content": sanitized_resume,
            "provider": "glm",
            "model_name": "glm-5",
            "prompt_snapshot": request_context["prompt_snapshot"],
            "full_request_snapshot": request_context["full_request_snapshot"],
            "input_summary": request_context["input_summary"],
            "token_usage": None,
            "raw_response_text": '{"basic_info":{"name":"李四"}}',
            "response_debug": {"status_code": 200, "stream_raw_line_count": 4, "raw_response_text_length": 24},
            "warnings": [],
        }
    )
    cancel_control = Mock()
    cancel_control.raise_if_cancelled = Mock()

    with patch("app.services.recruitment_service_impl.extract_resume_text", return_value="李四\nBLE 测试"), \
            patch("app.services.recruitment_service_impl._sanitize_ai_parsed_resume_with_meta", return_value=(sanitized_resume, [])):
        service._parse_latest_resume(candidate, "tester", cancel_control=cancel_control)

    pre_request_kwargs = service._update_ai_task_log.call_args_list[0].kwargs
    assert pre_request_kwargs["provider"] == "glm"
    assert pre_request_kwargs["model_name"] == "glm-5"
    assert pre_request_kwargs["full_request_snapshot"] == {"body": {"model": "glm-5"}}
    assert pre_request_kwargs["input_summary"] == "李四 BLE 测试"
    assert pre_request_kwargs["output_snapshot"]["timeout_seconds"] == 90.0
    assert pre_request_kwargs["output_snapshot"]["retry_count"] == 1
    assert pre_request_kwargs["output_snapshot"]["is_stream_mode"] is False
    assert pre_request_kwargs["output_snapshot"]["endpoint"] == "https://example.test/v1/chat/completions"
    assert pre_request_kwargs["output_snapshot"]["raw_text_chars"] == len("李四\nBLE 测试")
    service.ai_gateway.generate_json.assert_called_once()
    assert service.ai_gateway.generate_json.call_args.kwargs["cancel_control"] is cancel_control
    assert service.ai_gateway.generate_json.call_args.kwargs["runtime_config"] is runtime_config


def test_parse_latest_resume_failure_does_not_crash_when_task_is_none():
    db = Mock()
    db.add = Mock()
    db.commit = Mock()
    db.refresh = Mock()
    db.flush = Mock()
    db.rollback = Mock()
    service = RecruitmentService(db)
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        name="李四",
        phone=None,
        email=None,
        years_of_experience=None,
        education=None,
        updated_by=None,
    )
    resume_file = SimpleNamespace(
        id=12,
        storage_path="/tmp/demo.pdf",
        file_ext=".pdf",
        parse_status=None,
        parse_error=None,
    )
    log_row = SimpleNamespace(
        id=91,
        status="running",
        created_at=datetime.now(),
        stage_started_at=datetime.now(),
    )
    runtime_config = RecruitmentLLMRuntimeConfig(
        provider="glm",
        runtime_provider="openai-compatible",
        model_name="glm-5",
        base_url="https://example.test/v1",
        api_key="secret",
        source="test",
        api_key_masked="***",
        extra_config={"read_timeout_seconds": 45, "use_stream_json": False},
    )
    request_context = {
        "runtime_config": runtime_config,
        "provider": "glm",
        "model_name": "glm-5",
        "endpoint": "https://example.test/v1/chat/completions",
        "timeout_seconds": 45.0,
        "retry_count": 1,
        "is_stream_mode": False,
        "full_request_snapshot": {"body": {"model": "glm-5", "stream": False}},
        "input_summary": "李四 BLE 测试",
        "prompt_snapshot": "SYSTEM:\nPARSE\n\nUSER:\n李四 BLE 测试",
    }
    service._get_resume_file = Mock(return_value=resume_file)
    service._build_request_hash = Mock(return_value="hash")
    service._create_ai_task_log = Mock(return_value=log_row)
    service._update_ai_task_log = Mock(return_value=log_row)
    service._finish_ai_task_log = Mock(return_value=log_row)
    service._build_screening_persisted_result_refs = Mock(return_value={})
    service.ai_gateway.prepare_json_request_context = Mock(return_value=request_context)
    service.ai_gateway.generate_json = Mock(side_effect=httpx.ReadTimeout("timed out"))

    with patch("app.services.recruitment_service_impl.extract_resume_text", return_value="李四\nBLE 测试"):
        try:
            service._parse_latest_resume(candidate, "tester")
            assert False, "expected timeout failure"
        except httpx.ReadTimeout as exc:
            assert "NoneType" not in str(exc)

    service._finish_ai_task_log.assert_called_once()
    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "upstream_timeout"
    # 面向用户的失败文案已统一净化为中文（不再透出原始英文异常）
    assert "超时" in (kwargs["output_summary"] or "")
    assert kwargs["error_message"] == kwargs["output_summary"]
    assert kwargs["validation_meta"]["screening_result_valid"] is False
    assert kwargs["provider"] == "glm"
    assert kwargs["model_name"] == "glm-5"
    assert kwargs["full_request_snapshot"] == {"body": {"model": "glm-5", "stream": False}}


def test_extract_json_parse_failure_meta_marks_empty_parse_response():
    meta = _extract_json_parse_failure_meta(
        RecruitmentAIJSONParseError(
            "AI screening JSON 解析失败: 模型返回了空响应内容",
            raw_response_text="",
            error_code="empty_response",
            debug_meta={"status_code": 200, "stream_raw_line_count": 7},
        ),
        default_source="parse_request_failed",
    )

    assert meta["final_response_source"] == "parse_empty_response"
    assert meta["screening_result_state"] == "empty_response"
    assert meta["failure_code"] == "empty_response"
    assert meta["debug_meta"]["stream_raw_line_count"] == 7


def test_screen_candidate_reranks_from_existing_parse_when_mode_explicit():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="screening_passed", match_percent=80, ai_recommended_status="screening_passed")
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    score_row = SimpleNamespace(id=41)
    score_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"screening_result_valid":true,"screening_result_state":"success","parse_strategy":"rerank_from_existing_parse","reused_existing_parse":true,"final_response_source":"primary_score_model","primary_model_call_succeeded":true}',
        output_summary="初筛评分完成",
        error_message=None,
        status="success",
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json='{"parse_duration_ms":0,"score_duration_ms":120,"save_duration_ms":30}',
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: score_log if kwargs.get("task_type") == "resume_score" else None)
    service._get_latest_screening_score_run_task = Mock(return_value=score_log)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1000})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._screen_candidate_with_single_ai_call = Mock(side_effect=AssertionError("should not call one-pass"))
    service._save_screening_workflow_memory = Mock()
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    payload = service.screen_candidate(5, "tester", screening_mode="rerank_from_existing_parse")

    assert payload == {"candidate": {"id": 5}}
    service._parse_latest_resume.assert_not_called()
    service._score_candidate.assert_called_once()
    assert service._score_candidate.call_args.kwargs.get("task_log_row") is None
    assert service._score_candidate.call_args.kwargs["parent_task_id"] == root_log.id
    assert service._score_candidate.call_args.kwargs["root_task_id"] == root_log.id
    assert service._score_candidate.call_args.kwargs["reused_existing_parse"] is True
    assert service._score_candidate.call_args.kwargs["deadline_at"] is not None
    service._screen_candidate_with_single_ai_call.assert_not_called()


def test_screen_candidate_uses_one_pass_as_default_path_when_parse_missing():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None)
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success")
    score_row = SimpleNamespace(id=41)
    score_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"screening_result_valid":true,"screening_result_state":"success","parse_strategy":"combined_parse_and_score","reused_existing_parse":false,"final_response_source":"primary_screening_model","primary_model_call_succeeded":true}',
        output_summary="初筛评分完成",
        error_message=None,
        status="success",
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json='{"parse_duration_ms":180,"score_duration_ms":120,"save_duration_ms":30}',
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._screen_candidate_with_single_ai_call = Mock(return_value=(parse_row, score_row))
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: score_log if kwargs.get("task_type") == "resume_score" else None)
    service._get_latest_screening_score_run_task = Mock(return_value=score_log)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1200})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._save_screening_workflow_memory = Mock()
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    cancel_control = object()
    payload = service.screen_candidate(5, "tester", cancel_control=cancel_control)

    assert payload == {"candidate": {"id": 5}}
    service._parse_latest_resume.assert_not_called()
    service._score_candidate.assert_not_called()
    service._screen_candidate_with_single_ai_call.assert_called_once()
    assert service._screen_candidate_with_single_ai_call.call_args.kwargs["parent_task_id"] == root_log.id
    assert service._screen_candidate_with_single_ai_call.call_args.kwargs["root_task_id"] == root_log.id
    assert service._screen_candidate_with_single_ai_call.call_args.kwargs["cancel_control"] is cancel_control
    assert service._screen_candidate_with_single_ai_call.call_args.kwargs["deadline_at"] is not None


def _make_screen_orchestration_service(one_pass_return):
    """构造一个只暴露 screen_candidate 根编排、内部依赖全部 mock 的 service。"""
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="pending_screening")
    root_log = SimpleNamespace(
        id=91, screening_run_id="run-91", root_task_id=91, validation_meta_json=None,
        error_message=None, output_summary="初筛完成", timing_breakdown_json=None, output_snapshot=None,
    )
    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先 |\n| 自动化测试 | 50% | 5 | 次要 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash", "position_id": 9})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock()
    service._score_candidate = Mock()
    service._reparse_candidate_basic_info = Mock()
    service._save_screening_workflow_memory = Mock()
    service._maybe_send_auto_resume_mail_after_screening = Mock()
    service._auto_advance_candidate_after_screening = Mock()
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._get_latest_screening_score_run_task = Mock(return_value=None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1})
    service._build_screening_persisted_result_refs = Mock(return_value={})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._serialize_parse_result = Mock(return_value={})
    service._serialize_score = Mock(return_value={})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5, "status": candidate.status}})
    service._screen_candidate_with_single_ai_call = Mock(return_value=one_pass_return)
    return service, candidate, root_log


def test_root_short_circuits_on_one_pass_superseded_and_skips_downstream():
    # P0 控制流端到端：one-pass 返回 superseded 时，根编排必须直接进 superseded 终态——
    # 不 reparse、不 salvage、不 fallback、不写工作流记忆、不自动推进、不发邮件。
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", basic_info_json='{"name":"张三","phone":"1","email":"a@b.c","age":"30","years_of_experience":"3","education":"本科","location":"上海"}')
    score_row = SimpleNamespace(id=41)
    setattr(score_row, "_superseded_reason", "resume_changed")

    service, candidate, root_log = _make_screen_orchestration_service((parse_row, score_row))
    service.screen_candidate(5, "tester")

    # 根任务落 superseded 终态
    finish_kwargs = service._finish_ai_task_log.call_args.kwargs
    assert finish_kwargs["status"] == "superseded"
    # 禁止 reparse / fallback / 工作流记忆 / 自动推进 / 邮件
    service._reparse_candidate_basic_info.assert_not_called()
    service._parse_latest_resume.assert_not_called()
    service._score_candidate.assert_not_called()
    service._save_screening_workflow_memory.assert_not_called()
    service._auto_advance_candidate_after_screening.assert_not_called()
    service._maybe_send_auto_resume_mail_after_screening.assert_not_called()


def test_root_fails_closed_when_resume_text_unavailable():
    # P0 evidence fail-closed 端到端：简历原文为空/过短 → 不调用模型，直接抛 resume_text_unavailable。
    service, candidate, root_log = _make_screen_orchestration_service((None, None))
    service._extract_resume_file_raw_text = Mock(return_value="太短")
    with pytest.raises(RecruitmentScreeningResumeTextUnavailableError):
        service.screen_candidate(5, "tester")
    service._screen_candidate_with_single_ai_call.assert_not_called()


def test_root_fails_closed_when_skill_has_no_parseable_dimensions():
    # P0 evidence fail-closed 端到端：绑定 Skill 但无可解析维度 → 不调用模型，直接抛 screening_rule_invalid。
    service, candidate, root_log = _make_screen_orchestration_service((None, None))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "空规则", "content": "没有任何维度表的纯文字规则"}], [1], ""))
    with pytest.raises(RecruitmentScreeningRuleInvalidError):
        service.screen_candidate(5, "tester")
    service._screen_candidate_with_single_ai_call.assert_not_called()


def test_one_pass_task_type_is_not_resume_score():
    db = Mock()
    db.add = Mock()
    db.commit = Mock()
    db.flush = Mock()
    db.refresh = Mock()
    service = RecruitmentService(db)
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        name="王欢",
        phone=None,
        email=None,
        years_of_experience=None,
        education=None,
        latest_parse_result_id=None,
        latest_score_id=None,
        match_percent=None,
        ai_recommended_status=None,
        age=None,
        updated_by=None,
    )
    resume_file = SimpleNamespace(id=12, storage_path="/tmp/resume.pdf", file_ext=".pdf", parse_status=None, parse_error=None)
    log_row = SimpleNamespace(id=91)
    score_row = SimpleNamespace(id=41)

    service._get_resume_file = Mock(return_value=resume_file)
    service._get_rule_config = Mock(return_value={"pass_threshold": 75.0, "pool_threshold": 55.0})
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_resume_screening_prompt = Mock(return_value="screening prompt")
    service._build_request_hash = Mock(return_value="hash")
    service._create_ai_task_log = Mock(return_value=log_row)
    service.ai_gateway.prepare_json_request_context = Mock(return_value={
        "provider": "openai-compatible",
        "runtime_provider": "openai-compatible",
        "model_name": "gpt-4o-mini",
        "source": "db:actual-model",
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "endpoint": "https://example.test/v1/chat/completions",
        "timeout_seconds": 30,
        "configured_read_timeout_seconds": 30,
        "effective_timeout_seconds": 30,
        "screening_total_timeout_seconds": 300,
        "remaining_budget_seconds": 30,
        "retry_count": 0,
        "is_stream_mode": False,
        "runtime_config": object(),
    })
    service._update_ai_task_log = Mock(return_value=log_row)
    service._run_screening_provider_json_request = Mock(return_value={
        "provider": "openai-compatible",
        "model_name": "gpt-4o-mini",
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "output_summary": "output",
        "token_usage": {},
        "raw_response_text": json.dumps(
            {
                "parsed_resume": {
                    "basic_info": {
                        "name": "王欢",
                        "phone": "",
                        "email": "",
                        "years_of_experience": "5年",
                        "education": "本科",
                        "location": "上海",
                    },
                    "summary": "",
                    "work_experiences": [],
                    "education_experiences": [],
                    "skills": [],
                    "projects": [],
                },
                "score": {
                    "total_score": 5.0,
                    "match_percent": 50,
                    "advantages": ["有 IoT 测试经验"],
                    "concerns": ["自动化经验待确认"],
                    "recommendation": "建议保留观察",
                    "suggested_status": "talent_pool",
                    "dimensions": [],
                },
            },
            ensure_ascii=False,
        ),
        "content": {},
    })
    service._save_score_result = Mock(return_value=score_row)
    service._finish_ai_task_log = Mock(return_value=log_row)
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._maybe_send_auto_resume_mail_after_screening = Mock()
    request_meta = {
        "request_hash": "preview-hash",
        "request_scope": "screening_one_pass",
        "resume_file_id": 12,
        "raw_resume_text_hash": "resume-hash",
        "position_id": 9,
        "position_snapshot_hash": "position-hash",
        "score_rule_snapshot_hash": "rule-hash",
        "custom_requirements_hash": "",
        "prompt_version": "resume_screening_one_pass_v8",
        "status_thresholds_hash": "threshold-hash",
        "evidence_ref_protocol": "line_refs_v1",
        "provider": "openai-compatible",
        "runtime_provider": "openai-compatible",
        "model_name": "MiniMax-M2.7-highspeed",
        "source": "db:MINIMAX",
        "temperature": 0,
    }

    service._screen_candidate_with_single_ai_call(
        candidate,
        "tester",
        [],
        "position",
        request_meta=request_meta,
        raw_text_override="候选人简历",
    )

    assert service.ai_gateway.prepare_json_request_context.call_args.kwargs["task_type"] == SCREENING_ONE_PASS_TASK_TYPE
    assert service._run_screening_provider_json_request.call_args.kwargs["task_type"] == SCREENING_ONE_PASS_TASK_TYPE
    assert request_meta["model_name"] == "gpt-4o-mini"
    assert request_meta["source"] == "db:actual-model"
    assert service._update_ai_task_log.call_args_list[0].kwargs["output_snapshot"]["request_meta"]["model_name"] == "gpt-4o-mini"
    assert service._update_ai_task_log.call_args_list[0].kwargs["request_hash"] == request_meta["request_hash"]


def test_one_pass_persists_normalized_total_score_and_match_percent():
    db = Mock()
    db.commit = Mock()
    db.flush = Mock()
    db.refresh = Mock()
    db.add = Mock()
    service = RecruitmentService(db)
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        name="王欢",
        phone=None,
        email=None,
        years_of_experience=None,
        education=None,
        latest_parse_result_id=None,
        latest_score_id=None,
        match_percent=None,
        ai_recommended_status=None,
        status="pending_screening",
        updated_by=None,
    )
    resume_file = SimpleNamespace(id=12, storage_path="/tmp/resume.pdf", file_ext=".pdf", parse_status=None, parse_error=None)
    log_row = SimpleNamespace(id=91)
    service._get_resume_file = Mock(return_value=resume_file)
    service._get_rule_config = Mock(return_value={"pass_threshold": 75.0, "pool_threshold": 55.0})
    skill_snapshots = _build_screening_rule_skill_snapshots()
    service._prepare_screening_task_context = Mock(return_value=(skill_snapshots, [], ""))
    service._build_resume_screening_prompt = Mock(return_value="screening prompt")
    service._build_request_hash = Mock(return_value="hash")
    service._create_ai_task_log = Mock(return_value=log_row)
    service.ai_gateway.prepare_json_request_context = Mock(return_value={
        "provider": "openai-compatible",
        "model_name": "gpt-4o-mini",
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "endpoint": "https://example.test/v1/chat/completions",
        "timeout_seconds": 30,
        "configured_read_timeout_seconds": 30,
        "effective_timeout_seconds": 30,
        "screening_total_timeout_seconds": 300,
        "remaining_budget_seconds": 30,
        "retry_count": 0,
        "is_stream_mode": False,
        "runtime_config": object(),
    })
    service._update_ai_task_log = Mock(return_value=log_row)
    service._run_screening_provider_json_request = Mock(return_value={
        "provider": "openai-compatible",
        "model_name": "gpt-4o-mini",
        "prompt_snapshot": "snapshot",
        "full_request_snapshot": "{}",
        "input_summary": "summary",
        "output_summary": "output",
        "token_usage": {},
        "raw_response_text": json.dumps(
            {
                "parsed_resume": {
                    "basic_info": {
                        "name": "王欢",
                        "phone": "",
                        "email": "",
                        "years_of_experience": "5年",
                        "education": "本科",
                        "location": "上海",
                    },
                    "summary": "",
                    "work_experiences": [],
                    "education_experiences": [],
                    "skills": [],
                    "projects": [],
                },
                "score": {
                    "total_score": 8.3,
                    "match_percent": 83,
                    "advantages": ["IoT 协议经验较强"],
                    "concerns": ["文档能力待确认"],
                    "recommendation": "建议保留观察",
                    "suggested_status": "talent_pool",
                    "dimensions": [
                        {
                            "label": "IoT协议",
                            "score": 5.0,
                            "max_score": 5.0,
                            "reason": "命中核心要求",
                            "evidence": ["负责 BLE 协议联调与测试"],
                            "is_inferred": False,
                        },
                        {
                            "label": "自动化测试",
                            "score": 2.8,
                            "max_score": 3.0,
                            "reason": "具备自动化经验",
                            "evidence": ["使用 Python 编写自动化测试脚本"],
                            "is_inferred": False,
                        },
                        {
                            "label": "文档输出能力",
                            "score": 0.0,
                            "max_score": 2.0,
                            "reason": "简历未提及",
                            "evidence": [],
                            "is_inferred": False,
                        },
                    ],
                },
            },
            ensure_ascii=False,
        ),
        "content": {},
    })
    service._finish_ai_task_log = Mock(return_value=log_row)
    service._maybe_send_auto_resume_mail_after_screening = Mock()
    service._auto_advance_candidate_after_screening = Mock()

    _parse_row, score_row = service._screen_candidate_with_single_ai_call(
        candidate,
        "tester",
        [],
        "position",
        # P0-3：evidence 必须能在简历原文中证实，正分维度才会被保留。
        raw_text_override="候选人简历：负责 BLE 协议联调与测试；使用 Python 编写自动化测试脚本。",
    )

    stored_payload = json.loads(score_row.score_json)
    finish_kwargs = service._finish_ai_task_log.call_args.kwargs

    assert score_row.total_score == 7.8
    assert score_row.match_percent == 78
    assert stored_payload["_storage_format"] == RAW_SCREENING_SCORE_STORAGE_FORMAT
    assert stored_payload["score"]["total_score"] == 7.8
    assert stored_payload["score"]["match_percent"] == 78
    assert candidate.match_percent == 78
    assert finish_kwargs["output_snapshot"]["score"]["total_score"] == 7.8
    assert finish_kwargs["output_snapshot"]["score"]["match_percent"] == 78
    assert finish_kwargs["persisted_result_refs"]["candidate_match_percent_after"] == 78
    assert "score.total_score 已按 dimensions 自动校正" in finish_kwargs["validation_meta"]["validation_warnings"]


def test_screen_candidate_reuses_cached_result_without_model_call():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        latest_parse_result_id=None,
        latest_score_id=None,
        # pending_screening 会触发 force_fresh_screening（产品语义：待初筛必开新 run、禁用缓存），
        # 缓存复用场景应是重筛（如初筛失败后重跑同一请求）。
        status="screening_failed",
        match_percent=None,
        ai_recommended_status=None,
        updated_by=None,
    )
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    score_row = SimpleNamespace(id=41, match_percent=86, suggested_status="screening_passed")
    cached_root_log = SimpleNamespace(id=77, screening_run_id="run-cached")
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json="{}",
        output_snapshot=None,
        batch_id=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash-1"})
    service._load_reusable_screening_result = Mock(return_value={
        "root_log": cached_root_log,
        "parse_row": parse_row,
        "score_row": score_row,
        "validation_meta": {
            "screening_result_valid": True,
            "screening_result_state": "success",
            "final_response_source": "reused_existing_result",
            "primary_model_call_succeeded": True,
            "raw_model_suggested_status": "screening_passed",
            "normalized_final_suggested_status": "screening_passed",
        },
    })
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._get_latest_screening_score_run_task = Mock(return_value=None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 10})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._save_screening_workflow_memory = Mock()
    service._auto_advance_candidate_after_screening = Mock()
    service._screen_candidate_with_single_ai_call = Mock(side_effect=AssertionError("should not call model"))
    service._score_candidate = Mock(side_effect=AssertionError("should not call score-only"))
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    payload = service.screen_candidate(5, "tester")

    assert payload == {"candidate": {"id": 5}}
    assert candidate.latest_parse_result_id == 31
    assert candidate.latest_score_id == 41
    service._screen_candidate_with_single_ai_call.assert_not_called()
    service._score_candidate.assert_not_called()


def test_invalid_one_pass_result_triggers_controlled_score_only_salvage_when_allowed():
    service = RecruitmentService(Mock())
    # pending_screening 触发 force_fresh 会禁用 score-only salvage；salvage 场景应为重筛（初筛失败重跑）
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="screening_failed", match_percent=None, ai_recommended_status=None)
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success")
    one_pass_score_row = SimpleNamespace(
        id=41,
        score_json=json.dumps(
            {
                "_storage_format": RAW_SCREENING_SCORE_STORAGE_FORMAT,
                "score": {
                    "total_score": 8.0,
                    "match_percent": 80,
                    "advantages": ["IoT 协议经验较强"],
                    "concerns": ["文档能力待确认"],
                    "recommendation": "",
                    "suggested_status": "screening_passed",
                    "dimensions": [
                        {"label": "IoT协议", "score": 5.0, "max_score": 5.0, "reason": "命中", "evidence": ["负责 BLE 协议联调"], "is_inferred": False},
                        {"label": "自动化测试", "score": 3.0, "max_score": 3.0, "reason": "命中", "evidence": ["使用 Python 编写自动化脚本"], "is_inferred": False},
                        {"label": "文档输出能力", "score": 0.0, "max_score": 2.0, "reason": "简历未提及", "evidence": [], "is_inferred": False},
                    ],
                },
            },
            ensure_ascii=False,
        ),
    )
    salvaged_score_row = SimpleNamespace(id=42, match_percent=86, suggested_status="screening_passed")
    one_pass_invalid_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"screening_result_valid":false,"screening_result_state":"invalid","parse_strategy":"combined_parse_and_score","invalid_result_reasons":["score.recommendation 缺失或无效"],"final_response_source":"primary_screening_model_invalid","primary_model_call_succeeded":true}',
        output_summary="AI 返回了无效初筛结果",
        error_message="AI 返回了无效初筛结果",
        status="invalid_result",
        output_snapshot=None,
    )
    salvage_success_log = SimpleNamespace(
        id=93,
        validation_meta_json='{"screening_result_valid":true,"screening_result_state":"success","parse_strategy":"reuse_parse_then_score","reused_existing_parse":true,"final_response_source":"primary_score_model","primary_model_call_succeeded":true,"raw_model_suggested_status":"screening_passed","normalized_final_suggested_status":"screening_passed"}',
        output_summary="score-only salvage 成功",
        error_message=None,
        status="success",
        output_snapshot=None,
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛进行中",
        timing_breakdown_json="{}",
        output_snapshot=None,
        batch_id=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock()
    service._screen_candidate_with_single_ai_call = Mock(return_value=(parse_row, one_pass_score_row))
    current_score_log = {"value": one_pass_invalid_log}

    def _score_candidate_salvage(*args, **kwargs):
        current_score_log["value"] = salvage_success_log
        candidate.status = "screening_passed"
        candidate.match_percent = 86
        candidate.ai_recommended_status = "screening_passed"
        candidate.latest_score_id = 42
        return salvaged_score_row

    service._score_candidate = Mock(side_effect=_score_candidate_salvage)
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._get_latest_screening_score_run_task = Mock(side_effect=lambda *args, **kwargs: current_score_log["value"])
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1200})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 42})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._save_screening_workflow_memory = Mock()
    service._get_rule_config = Mock(return_value={"pass_threshold": 75.0, "pool_threshold": 55.0})
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 42})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5, "status": "screening_passed"}})

    payload = service.screen_candidate(5, "tester")

    assert payload == {"candidate": {"id": 5, "status": "screening_passed"}}
    service._screen_candidate_with_single_ai_call.assert_called_once()
    service._score_candidate.assert_called_once()
    service._parse_latest_resume.assert_not_called()
    assert service._score_candidate.call_args.kwargs["reused_existing_parse"] is True
    assert service._finish_ai_task_log.call_args.kwargs["status"] == "success"
    assert service._finish_ai_task_log.call_args.kwargs["validation_meta"]["final_response_source"] == "primary_screening_model_salvaged"
    assert candidate.status == "screening_passed"


def test_invalid_one_pass_result_keeps_invalid_when_salvage_fails():
    service = RecruitmentService(Mock())
    # pending_screening 触发 force_fresh 会禁用 score-only salvage；salvage 场景应为重筛（初筛失败重跑）
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="screening_failed", match_percent=None, ai_recommended_status=None)
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success")
    one_pass_score_row = SimpleNamespace(
        id=41,
        score_json=json.dumps(
            {
                "_storage_format": RAW_SCREENING_SCORE_STORAGE_FORMAT,
                "score": {
                    "total_score": 8.0,
                    "match_percent": 80,
                    "advantages": ["IoT 协议经验较强"],
                    "concerns": ["文档能力待确认"],
                    "recommendation": "",
                    "suggested_status": "screening_passed",
                    "dimensions": [
                        {"label": "IoT协议", "score": 5.0, "max_score": 5.0, "reason": "命中", "evidence": ["负责 BLE 协议联调"], "is_inferred": False},
                        {"label": "自动化测试", "score": 3.0, "max_score": 3.0, "reason": "命中", "evidence": ["使用 Python 编写自动化脚本"], "is_inferred": False},
                        {"label": "文档输出能力", "score": 0.0, "max_score": 2.0, "reason": "简历未提及", "evidence": [], "is_inferred": False},
                    ],
                },
            },
            ensure_ascii=False,
        ),
    )
    one_pass_invalid_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"screening_result_valid":false,"screening_result_state":"invalid","parse_strategy":"combined_parse_and_score","invalid_result_reasons":["score.recommendation 缺失或无效"],"final_response_source":"primary_screening_model_invalid","primary_model_call_succeeded":true}',
        output_summary="AI 返回了无效初筛结果",
        error_message="AI 返回了无效初筛结果",
        status="invalid_result",
        output_snapshot=None,
    )
    salvage_failed_log = SimpleNamespace(
        id=93,
        validation_meta_json='{"screening_result_valid":false,"screening_result_state":"request_failed","failure_code":"request_failed","final_response_source":"score_request_failed","primary_model_call_succeeded":false}',
        output_summary="score-only salvage 失败",
        error_message="score-only salvage 失败",
        status="request_failed",
        output_snapshot=None,
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛进行中",
        timing_breakdown_json="{}",
        output_snapshot=None,
        batch_id=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock()
    service._screen_candidate_with_single_ai_call = Mock(return_value=(parse_row, one_pass_score_row))
    current_score_log = {"value": one_pass_invalid_log}

    def _score_candidate_salvage_fail(*args, **kwargs):
        current_score_log["value"] = salvage_failed_log
        raise RuntimeError("score-only salvage exploded")

    service._score_candidate = Mock(side_effect=_score_candidate_salvage_fail)
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._get_latest_screening_score_run_task = Mock(side_effect=lambda *args, **kwargs: current_score_log["value"])
    service._build_screening_run_timing_breakdown = Mock(return_value={"parse_duration_ms": None, "score_duration_ms": 800, "total_duration_ms": 1200})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._save_screening_workflow_memory = Mock()
    service._get_rule_config = Mock(return_value={"pass_threshold": 75.0, "pool_threshold": 55.0})
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5, "status": "pending_screening"}})

    # f414caa 语义：one-pass invalid + salvage 失败后还会进入 fallback 降级链路再试一次；
    # fallback 也失败 → 根任务落 failed 终态并向上抛出，候选人档案保持零污染。
    try:
        service.screen_candidate(5, "tester")
        assert False, "fallback 链路失败应向上抛出"
    except RuntimeError as exc:
        assert "salvage exploded" in str(exc)

    assert service._score_candidate.call_count == 2  # salvage 一次 + fallback 降级一次
    assert service._finish_ai_task_log.call_args.kwargs["status"] == "failed"
    assert service._finish_ai_task_log.call_args.kwargs["validation_meta"]["parse_strategy"] == "combined_parse_and_score"
    assert candidate.status == "screening_failed"
    assert getattr(candidate, "latest_score_id", None) is None


def test_fallback_parse_then_score_does_not_bind_parse_or_score_directly_to_root_log():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None)
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success")
    score_row = SimpleNamespace(id=41)
    score_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"screening_result_valid":true,"screening_result_state":"success"}',
        output_summary="初筛评分完成",
        error_message=None,
        status="success",
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json='{"parse_duration_ms":180,"score_duration_ms":120}',
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: score_log if kwargs.get("task_type") == "resume_score" else None)
    service._get_latest_screening_score_run_task = Mock(return_value=score_log)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1200})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._save_screening_workflow_memory = Mock()
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    service.screen_candidate(5, "tester", force_one_pass=False)

    assert service._parse_latest_resume.call_args.kwargs["parent_task_id"] == root_log.id
    assert service._parse_latest_resume.call_args.kwargs["root_task_id"] == root_log.id
    assert service._parse_latest_resume.call_args.kwargs.get("task_log_row") is None
    assert service._score_candidate.call_args.kwargs["parent_task_id"] == root_log.id
    assert service._score_candidate.call_args.kwargs["root_task_id"] == root_log.id
    assert service._score_candidate.call_args.kwargs.get("task_log_row") is None


def test_finish_root_task_called_when_parse_raises():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None)
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary=None,
        timing_breakdown_json="{}",
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock(side_effect=RuntimeError("parse exploded"))
    service._score_candidate = Mock()
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._get_latest_screening_score_run_task = Mock(return_value=None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 120})
    service._build_screening_persisted_result_refs = Mock(return_value={})
    service._finish_ai_task_log = Mock(return_value=root_log)

    try:
        service.screen_candidate(5, "tester", force_one_pass=False)
        assert False, "screen_candidate should raise parse failure"
    except RuntimeError as exc:
        assert str(exc) == "parse exploded"

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "failed"
    assert kwargs["stage"] == "failed"


def test_root_failure_inherits_parse_child_request_context():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None)
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary=None,
        timing_breakdown_json="{}",
        output_snapshot=None,
    )
    parse_log = SimpleNamespace(
        id=101,
        validation_meta_json='{"screening_result_valid":false,"screening_result_state":"empty_response","final_response_source":"parse_empty_response","primary_model_call_succeeded":false,"failure_code":"empty_response","invalid_result_reasons":["AI screening JSON 解析失败: 模型返回了空响应内容"]}',
        output_summary="AI screening JSON 解析失败: 模型返回了空响应内容",
        error_message="AI screening JSON 解析失败: 模型返回了空响应内容",
        status="json_parse_failed",
        model_provider="GLM",
        model_name="glm-5",
        model_source="db:GLM",
        prompt_snapshot="SYSTEM:\nparse",
        full_request_snapshot='{"model":"glm-5","source":"db:GLM"}',
        input_summary="李四 BLE 测试",
        raw_response_text="",
        parsed_response_json=None,
        sanitized_response_json=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=False)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock(
        side_effect=RecruitmentAIJSONParseError(
            "AI screening JSON 解析失败: 模型返回了空响应内容",
            raw_response_text="",
            error_code="empty_response",
        )
    )
    service._score_candidate = Mock()
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: parse_log if kwargs.get("task_type") == "resume_parse" else None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"parse_duration_ms": 1200, "total_duration_ms": 1200})
    service._build_screening_persisted_result_refs = Mock(return_value={})
    service._finish_ai_task_log = Mock(return_value=root_log)

    try:
        service.screen_candidate(5, "tester", force_one_pass=False)
        assert False, "screen_candidate should raise parse failure"
    except RecruitmentAIJSONParseError as exc:
        assert getattr(exc, "error_code", None) == "empty_response"

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "json_parse_failed"
    assert kwargs["provider"] == "GLM"
    assert kwargs["model_name"] == "glm-5"
    assert kwargs["model_source"] == "db:GLM"
    assert kwargs["full_request_snapshot"] == '{"model":"glm-5","source":"db:GLM"}'
    assert kwargs["input_summary"] == "李四 BLE 测试"
    assert kwargs["raw_response_text"] == ""
    assert kwargs["validation_meta"]["failure_code"] == "empty_response"


def test_finish_root_task_called_when_score_raises():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None)
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success")
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary=None,
        timing_breakdown_json="{}",
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._parse_latest_resume = Mock()
    service._score_candidate = Mock(side_effect=RuntimeError("score exploded"))
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 120})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})

    try:
        service.screen_candidate(5, "tester", force_one_pass=False)
        assert False, "screen_candidate should raise score failure"
    except RuntimeError as exc:
        assert str(exc) == "score exploded"

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "failed"
    assert kwargs["stage"] == "failed"


def test_screen_candidate_keeps_parse_result_and_closes_root_when_score_json_parse_still_fails_after_bounded_retry():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        latest_parse_result_id=31,
        latest_score_id=None,
        updated_by=None,
        status="pending_screening",
        match_percent=None,
        ai_recommended_status=None,
    )
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary=None,
        timing_breakdown_json="{}",
        output_snapshot='{"parse_strategy":"fallback_parse_then_score"}',
    )
    score_log = SimpleNamespace(
        id=92,
        status="json_parse_failed",
        output_summary="AI screening JSON 解析失败: malformed score payload",
        error_message="AI screening JSON 解析失败: malformed score payload",
        validation_meta_json='{"screening_result_valid":false,"screening_result_state":"json_parse_failed","final_response_source":"score_json_parse_failed","failure_code":"json_parse_failed"}',
        model_provider="GLM",
        model_name="glm-5",
        prompt_snapshot="SYSTEM:\\nUSER",
        full_request_snapshot='{"stream":false}',
        input_summary="PROMPT",
        raw_response_text='{"total_score":7.8 "match_percent":78}',
        parsed_response_json=None,
        sanitized_response_json=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._get_latest_valid_screening_result_for_candidate = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    # pending_screening 触发 force_fresh：不复用旧解析而是重新解析；重解析产出同一行（id=31）
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._score_candidate = Mock(
        side_effect=RecruitmentAIJSONParseError(
            "AI screening JSON 解析失败: malformed score payload",
            raw_response_text='{"total_score":7.8 "match_percent":78}',
            error_code="json_parse_failed",
            debug_meta={"strict_json_recovery_retry_count": 1},
        )
    )
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._get_latest_screening_score_run_task = Mock(return_value=score_log)
    service._build_screening_run_timing_breakdown = Mock(return_value={"score_duration_ms": 900, "total_duration_ms": 1234})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})

    try:
        service.screen_candidate(5, "tester", force_one_pass=False)
        assert False, "screen_candidate should raise score json parse failure"
    except RecruitmentAIJSONParseError as exc:
        assert exc.error_code == "json_parse_failed"

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "json_parse_failed"
    assert kwargs["stage"] == "failed"
    assert kwargs["persisted_result_refs"]["parse_result_id"] == 31
    assert kwargs["persisted_result_refs"]["score_result_id"] is None
    assert kwargs["validation_meta"]["failure_code"] == "json_parse_failed"
    assert candidate.status == "pending_screening"


def test_settle_orphaned_screening_flow_marks_stale_running_root_failed():
    service = RecruitmentService(Mock())
    root_log = SimpleNamespace(
        id=91,
        task_type=SCREENING_FLOW_TASK_TYPE,
        parent_task_id=None,
        root_task_id=91,
        screening_run_id="run-91",
        related_candidate_id=5,
        status="running",
        stage="parsing",
        stage_started_at=datetime.now() - timedelta(minutes=15),
        stage_completed_at=None,
        created_at=datetime.now() - timedelta(minutes=15),
        updated_at=datetime.now() - timedelta(minutes=15),
        output_snapshot='{"parse_status":"running"}',
        validation_meta_json=None,
        timing_breakdown_json="{}",
        error_message=None,
        output_summary="正在解析最新简历",
    )
    candidate = SimpleNamespace(id=5, deleted=False, latest_parse_result_id=None, latest_score_id=None)
    candidate_query = Mock()
    candidate_query.filter.return_value = candidate_query
    candidate_query.first.return_value = candidate
    service.db.query = Mock(return_value=candidate_query)
    service._settle_orphaned_cancelling_task = Mock(return_value=False)
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._is_orphaned_live_task = Mock(return_value=True)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 999})
    service._build_screening_persisted_result_refs = Mock(return_value={})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._mark_candidate_screening_failed_if_needed = Mock()

    settled = service._settle_orphaned_live_task(root_log)

    assert settled is True
    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "failed"
    assert kwargs["stage"] == "failed"
    assert "长时间未完成" in kwargs["output_summary"]


def test_settle_orphaned_screening_flow_keeps_root_while_fallback_parse_is_live():
    service = RecruitmentService(Mock())
    root_log = SimpleNamespace(
        id=191,
        task_type=SCREENING_FLOW_TASK_TYPE,
        parent_task_id=None,
        status="running",
    )
    fallback_parse = SimpleNamespace(status="running")
    failed_one_pass = SimpleNamespace(status="failed")
    recruitment_impl.recruitment_task_registry.pop(root_log.id)
    service._get_screening_flow_child_logs = Mock(return_value=(fallback_parse, failed_one_pass))
    service._finish_ai_task_log = Mock()

    settled = service._settle_orphaned_live_task(root_log)

    assert settled is False
    service._finish_ai_task_log.assert_not_called()


def test_settle_orphaned_screening_flow_keeps_root_while_worker_is_registered():
    service = RecruitmentService(Mock())
    root_log = SimpleNamespace(
        id=192,
        task_type=SCREENING_FLOW_TASK_TYPE,
        parent_task_id=None,
        status="running",
    )
    failed_one_pass = SimpleNamespace(status="failed")
    service._get_screening_flow_child_logs = Mock(return_value=(None, failed_one_pass))
    service._finish_ai_task_log = Mock()
    recruitment_impl.recruitment_task_registry.register(root_log.id, Mock())
    try:
        settled = service._settle_orphaned_live_task(root_log)
    finally:
        recruitment_impl.recruitment_task_registry.pop(root_log.id)

    assert settled is False
    service._finish_ai_task_log.assert_not_called()


def test_rate_limited_parse_task_is_requeued_not_failed():
    service = RecruitmentService(Mock())
    db = Mock()
    db.rollback = Mock()
    db.close = Mock()
    db.add = Mock()
    db.commit = Mock()
    db.refresh = Mock()
    log_row = SimpleNamespace(
        id=91,
        status="running",
        stage="parsing",
        related_candidate_id=5,
        validation_meta_json=None,
        output_snapshot=None,
        created_by="tester",
        stage_started_at=datetime.now() - timedelta(seconds=5),
        created_at=datetime.now() - timedelta(seconds=5),
    )
    candidate = SimpleNamespace(id=5, status="pending_screening")
    exc = _build_http_status_error(429, '{"message":"rate limit exceeded"}')

    with patch("app.services.recruitment_service_impl.SessionLocal", return_value=db), \
            patch.object(RecruitmentService, "_run_queued_screening_task", side_effect=exc), \
            patch.object(RecruitmentService, "_get_ai_task_log_row", return_value=log_row), \
            patch.object(RecruitmentService, "_get_candidate", return_value=candidate), \
            patch.object(RecruitmentService, "_dispatch_screening_queue", return_value={"started_count": 0, "active_count": 0, "max_concurrency": 1}), \
            patch.object(RecruitmentService, "_mark_candidate_screening_failed_if_needed") as mark_failed, \
            patch.object(RecruitmentService, "_finish_ai_task_log") as finish_task:
        service._build_screening_queue_runner(91, "tester")(object())

    validation_meta = json.loads(log_row.validation_meta_json)
    output_snapshot = json.loads(log_row.output_snapshot)
    assert log_row.status == "queued"
    assert log_row.stage == "queued"
    assert log_row.output_summary == "模型接口限流，系统将自动重试，请稍候。"
    assert validation_meta["failure_code"] == "rate_limited"
    assert validation_meta["auto_requeue_scheduled"] is True
    assert validation_meta["infra_retry_count"] == 1
    assert validation_meta["next_retry_at"]
    assert output_snapshot["next_retry_at"]
    assert candidate.status == "pending_screening"
    mark_failed.assert_not_called()
    finish_task.assert_not_called()


def test_timeout_parse_task_is_requeued_not_failed():
    service = RecruitmentService(Mock())
    db = Mock()
    db.rollback = Mock()
    db.close = Mock()
    db.add = Mock()
    db.commit = Mock()
    db.refresh = Mock()
    log_row = SimpleNamespace(
        id=92,
        status="running",
        stage="parsing",
        related_candidate_id=5,
        validation_meta_json=None,
        output_snapshot=None,
        created_by="tester",
        stage_started_at=datetime.now() - timedelta(seconds=5),
        created_at=datetime.now() - timedelta(seconds=5),
    )
    candidate = SimpleNamespace(id=5, status="pending_screening")

    with patch("app.services.recruitment_service_impl.SessionLocal", return_value=db), \
            patch.object(RecruitmentService, "_run_queued_screening_task", side_effect=httpx.ReadTimeout("timed out")), \
            patch.object(RecruitmentService, "_get_ai_task_log_row", return_value=log_row), \
            patch.object(RecruitmentService, "_get_candidate", return_value=candidate), \
            patch.object(RecruitmentService, "_dispatch_screening_queue", return_value={"started_count": 0, "active_count": 0, "max_concurrency": 1}), \
            patch.object(RecruitmentService, "_mark_candidate_screening_failed_if_needed") as mark_failed, \
            patch.object(RecruitmentService, "_finish_ai_task_log") as finish_task:
        service._build_screening_queue_runner(92, "tester")(object())

    validation_meta = json.loads(log_row.validation_meta_json)
    output_snapshot = json.loads(log_row.output_snapshot)
    assert log_row.status == "queued"
    assert log_row.stage == "queued"
    assert log_row.output_summary == "模型接口超时，系统将自动重试，请稍候。"
    assert validation_meta["failure_code"] == "upstream_timeout"
    assert validation_meta["auto_requeue_scheduled"] is True
    assert validation_meta["infra_retry_count"] == 1
    assert validation_meta["next_retry_at"]
    assert output_snapshot["next_retry_at"]
    assert candidate.status == "pending_screening"
    mark_failed.assert_not_called()
    finish_task.assert_not_called()


def test_screen_candidate_marks_total_timeout_when_remaining_budget_is_exhausted_before_score():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=12,
        updated_by=None,
        status="pending_screening",
        match_percent=None,
        ai_recommended_status=None,
    )
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历")
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛进行中",
        timing_breakdown_json="{}",
        output_snapshot=json.dumps({
            "screening_started_at": (datetime.now() - timedelta(seconds=260)).isoformat(),
            "screening_deadline_at": (datetime.now() + timedelta(seconds=15)).isoformat(),
        }),
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._get_resume_file = Mock(return_value=SimpleNamespace(id=12))
    service._extract_resume_file_raw_text = Mock(return_value="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._score_candidate = Mock(side_effect=AssertionError("score should not start"))
    service._get_latest_screening_run_task = Mock(return_value=None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 300000})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})

    try:
        service.screen_candidate(5, "tester", force_one_pass=False)
        assert False, "expected total timeout"
    except RecruitmentAIScreeningTotalTimeoutError as exc:
        assert exc.total_timeout_seconds == SCREENING_TOTAL_TIMEOUT_SECONDS

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["status"] == "screening_total_timeout"
    assert kwargs["stage"] == "failed"
    assert "300 秒" in kwargs["output_summary"]
    assert kwargs["validation_meta"]["failure_code"] == "screening_total_timeout"
    service._score_candidate.assert_not_called()


def test_dispatch_screening_queue_skips_tasks_before_next_retry_at():
    service = RecruitmentService(Mock())
    stale_query = Mock()
    stale_query.filter.return_value = stale_query
    stale_query.order_by.return_value = stale_query
    stale_query.all.return_value = []
    queued_query = Mock()
    queued_query.filter.return_value = queued_query
    queued_query.order_by.return_value = queued_query
    queued_query.limit.return_value = queued_query
    queued_query.all.return_value = [
        SimpleNamespace(
            id=301,
            created_by="tester",
            output_snapshot=json.dumps({"next_retry_at": (datetime.now() + timedelta(minutes=5)).isoformat()}),
        ),
        SimpleNamespace(
            id=302,
            created_by="tester",
            output_snapshot=json.dumps({"next_retry_at": (datetime.now() - timedelta(seconds=5)).isoformat()}),
        ),
    ]
    dispatch_db = Mock()
    dispatch_db.query = Mock(side_effect=[stale_query, queued_query])
    service._start_background_ai_task = Mock()
    service._build_screening_queue_runner = Mock(return_value=Mock())

    with patch("app.services.recruitment_service_impl.SessionLocal", return_value=dispatch_db), \
            patch.object(RecruitmentService, "_resolve_screening_queue_max_concurrency", return_value=8), \
            patch("app.services.recruitment_service_impl._screening_provider_cooldown_until", None), \
            patch("app.services.recruitment_service_impl._screening_worker_active_task_ids", set()):
        payload = service._dispatch_screening_queue()

    assert payload["started_count"] == 1
    assert payload["max_concurrency"] == 8
    assert service._start_background_ai_task.call_args.args[0] == 302


def test_dispatch_screening_queue_respects_provider_cooldown_after_rate_limit():
    service = RecruitmentService(Mock())
    service._start_background_ai_task = Mock()

    with patch.object(RecruitmentService, "_resolve_screening_queue_max_concurrency", return_value=12), \
            patch("app.services.recruitment_service_impl._screening_provider_cooldown_until", datetime.now() + timedelta(seconds=30)), \
            patch("app.services.recruitment_service_impl._screening_worker_active_task_ids", set()):
        payload = service._dispatch_screening_queue()

    assert payload["started_count"] == 0
    assert payload["max_concurrency"] == 12
    service._start_background_ai_task.assert_not_called()


def test_batch_screening_queue_respects_single_concurrency():
    service = RecruitmentService(Mock())
    stale_query = Mock()
    stale_query.filter.return_value = stale_query
    stale_query.order_by.return_value = stale_query
    stale_query.all.return_value = []
    queued_query = Mock()
    queued_query.filter.return_value = queued_query
    queued_query.order_by.return_value = queued_query
    queued_query.limit.return_value = queued_query
    queued_query.all.return_value = [
        SimpleNamespace(id=401 + idx, created_by="tester", output_snapshot=None)
        for idx in range(5)
    ]
    dispatch_db = Mock()
    dispatch_db.query = Mock(side_effect=[stale_query, queued_query])
    service._start_background_ai_task = Mock()
    service._build_screening_queue_runner = Mock(return_value=Mock())

    with patch("app.services.recruitment_service_impl.SessionLocal", return_value=dispatch_db), \
            patch.object(RecruitmentService, "_resolve_screening_queue_max_concurrency", return_value=3), \
            patch("app.services.recruitment_service_impl._screening_provider_cooldown_until", None), \
            patch("app.services.recruitment_service_impl._screening_worker_active_task_ids", set()):
        payload = service._dispatch_screening_queue()

    assert payload["started_count"] == 3
    assert payload["active_count"] == 3
    assert payload["max_concurrency"] == 3
    assert service._start_background_ai_task.call_count == 3


def test_queued_screening_task_is_not_orphaned_while_waiting():
    service = RecruitmentService(Mock())
    row = SimpleNamespace(
        id=501,
        status="queued",
        updated_at=datetime.now() - timedelta(hours=6),
        created_at=datetime.now() - timedelta(hours=6),
    )

    assert service._is_orphaned_live_task(row) is False


def test_screening_queue_capacity_sums_effective_model_configs():
    service = RecruitmentService(Mock())
    default_model = SimpleNamespace(id=1, max_concurrent=2)
    one_pass_model = SimpleNamespace(id=2, max_concurrent=3)
    score_model = SimpleNamespace(id=3, max_concurrent=4)

    service._load_effective_llm_config_rows_for_task = Mock(
        side_effect=lambda task_type: [one_pass_model, default_model]
        if task_type == SCREENING_ONE_PASS_TASK_TYPE
        else [score_model, default_model]
    )

    assert service._resolve_screening_queue_max_concurrency() == 9


def test_infra_failure_does_not_mark_candidate_screening_failed():
    service = RecruitmentService(Mock())
    db = Mock()
    db.rollback = Mock()
    db.close = Mock()
    db.add = Mock()
    db.commit = Mock()
    db.refresh = Mock()
    log_row = SimpleNamespace(
        id=93,
        status="running",
        stage="scoring",
        related_candidate_id=5,
        validation_meta_json=None,
        output_snapshot=None,
        created_by="tester",
        stage_started_at=datetime.now() - timedelta(seconds=5),
        created_at=datetime.now() - timedelta(seconds=5),
    )

    with patch("app.services.recruitment_service_impl.SessionLocal", return_value=db), \
            patch.object(RecruitmentService, "_run_queued_screening_task", side_effect=httpx.ReadTimeout("timed out")), \
            patch.object(RecruitmentService, "_get_ai_task_log_row", return_value=log_row), \
            patch.object(RecruitmentService, "_dispatch_screening_queue", return_value={"started_count": 0, "active_count": 0, "max_concurrency": 1}), \
            patch.object(RecruitmentService, "_mark_candidate_screening_failed_if_needed") as mark_failed:
        service._build_screening_queue_runner(93, "tester")(object())

    mark_failed.assert_not_called()
    assert log_row.status == "queued"


def test_screening_queue_runner_continues_dispatch_with_fresh_session():
    service = RecruitmentService(Mock())
    task_db = Mock()
    dispatch_db = Mock()
    events = []

    def close_task_db():
        events.append("task_db.close")

    def close_dispatch_db():
        events.append("dispatch_db.close")

    def dispatch_queue(dispatch_service):
        events.append("dispatch.start")
        assert dispatch_service.db is dispatch_db
        return {"started_count": 0, "active_count": 0, "max_concurrency": 1}

    task_db.close.side_effect = close_task_db
    dispatch_db.close.side_effect = close_dispatch_db

    with patch("app.services.recruitment_service_impl.SessionLocal", side_effect=[task_db, dispatch_db]), \
            patch.object(RecruitmentService, "_restore_session_token_from_task", return_value=None), \
            patch.object(RecruitmentService, "_run_queued_screening_task", return_value=None), \
            patch.object(RecruitmentService, "_dispatch_screening_queue", dispatch_queue), \
            patch("app.services.recruitment_service_impl._screening_worker_active_task_ids", {94}):
        service._build_screening_queue_runner(94, "tester")(object())

    assert events == ["task_db.close", "dispatch.start", "dispatch_db.close"]


def test_run_queued_screening_task_defaults_to_one_pass_path():
    service = RecruitmentService(Mock())
    log_row = SimpleNamespace(
        id=91,
        status="queued",
        related_candidate_id=5,
        related_skill_snapshots_json="[]",
        memory_source="task_snapshot",
        output_snapshot='{"screening_mode":"default","allow_reuse_parse":true,"allow_score_only_rerun":true}',
    )
    service._get_ai_task_log_row = Mock(return_value=log_row)
    service.screen_candidate = Mock(return_value={"candidate": {"id": 5}})

    cancel_control = object()
    payload = service._run_queued_screening_task(91, "tester", cancel_control=cancel_control)

    assert payload == {"candidate": {"id": 5}}
    service.screen_candidate.assert_called_once()
    assert service.screen_candidate.call_args.kwargs["force_one_pass"] is True
    assert service.screen_candidate.call_args.kwargs["screening_mode"] == "default"
    assert service.screen_candidate.call_args.kwargs["cancel_control"] is cancel_control


def test_score_candidate_uses_gateway_strict_json_recovery_result_without_second_model_repair():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        latest_resume_file_id=11,
        status="pending_screening",
        match_percent=None,
        ai_recommended_status=None,
        ai_match_position_id=9,
        ai_match_position_title="岗位识别原始岗位",
        ai_match_confidence=72.0,
        ai_match_reason="岗位识别原始原因",
        ai_potential_position="岗位识别转岗建议",
        ai_potential_reason="岗位识别转岗原因",
    )
    parse_row = SimpleNamespace(id=31, resume_file_id=11, raw_text="候选人简历")
    log_row = SimpleNamespace(id=91, timing_breakdown_json="{}", stage="scoring", status="running")
    score_row = SimpleNamespace(id=41)

    service._serialize_parse_result = Mock(
        return_value={
            "basic_info": {"name": "候选人A", "years_of_experience": "6年", "education": "本科"},
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
            "summary": "",
            "raw_text": "候选人简历",
        }
    )
    service._get_rule_config = Mock(return_value={})
    service._prepare_screening_task_context = Mock(return_value=([], [], ""))
    service._build_score_resume_helper_payload = Mock(
        return_value=(
            {
                "basic_info": {"name": "候选人A", "years_of_experience": "6年", "education": "本科"},
                "work_experiences": [],
                "education_experiences": [],
                "skills": [],
                "projects": [],
                "summary": "",
            },
            [],
        )
    )
    service._build_resume_score_prompt = Mock(return_value="PROMPT")
    service._update_ai_task_log = Mock(return_value=log_row)
    service._save_score_result = Mock(return_value=score_row)
    service._maybe_send_auto_resume_mail_after_screening = Mock()
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})

    request_context = {
        "provider": "glm",
        "model_name": "glm-5",
        "runtime_config": Mock(),
        "endpoint": "https://example.test/v1/chat/completions",
        "timeout_seconds": 300,
        "configured_read_timeout_seconds": 300,
        "effective_timeout_seconds": 300,
        "screening_total_timeout_seconds": 300,
        "remaining_budget_seconds": 300,
        "retry_count": 0,
        "is_stream_mode": False,
        "prompt_snapshot": "SYSTEM\\nUSER",
        "full_request_snapshot": "{\"stream\": false}",
        "input_summary": "PROMPT",
    }
    service.ai_gateway.prepare_json_request_context = Mock(return_value=dict(request_context))
    service.ai_gateway.generate_json = Mock(
        return_value={
            "provider": "glm",
            "model_name": "glm-5",
            "prompt_snapshot": "SYSTEM\\nUSER",
            "full_request_snapshot": "{\"stream\": false}",
            "input_summary": "PROMPT",
            "raw_response_text": json.dumps(
                {
                    "total_score": 8.1,
                    "match_percent": 81,
                    "advantages": ["基础匹配较好"],
                    "concerns": ["仍需面试核实"],
                    "recommendation": "建议继续评估",
                    "suggested_status": "screening_passed",
                    "dimensions": [
                        {
                            "label": "基础匹配",
                            "score": 8.1,
                            "max_score": 10.0,
                            "reason": "命中",
                            "evidence": ["测试经验"],
                            "is_inferred": False,
                        }
                    ],
                    "position_match": {
                        "recommended_position": "测试工程师",
                        "confidence": 86,
                        "reason": "测试经验匹配",
                        "potential_position": "测试开发工程师",
                        "potential_reason": "有自动化基础",
                    },
                },
                ensure_ascii=False,
            ),
            "content": {
                "total_score": 8.1,
                "match_percent": 81,
                "advantages": ["基础匹配较好"],
                "concerns": ["仍需面试核实"],
                "recommendation": "建议继续评估",
                "suggested_status": "screening_passed",
                "dimensions": [
                    {
                        "label": "基础匹配",
                        "score": 8.1,
                        "max_score": 10.0,
                        "reason": "命中",
                        "evidence": ["测试经验"],
                        "is_inferred": False,
                    }
                ],
                "position_match": {
                    "recommended_position": "测试工程师",
                    "confidence": 86,
                    "reason": "测试经验匹配",
                    "potential_position": "测试开发工程师",
                    "potential_reason": "有自动化基础",
                },
            },
            "token_usage": None,
            "response_debug": {"is_stream_mode": False, "strict_json_recovery_retry_count": 1},
            "warnings": ["strict JSON 首次解析失败，已自动进行一次同 prompt 恢复重试"],
        }
    )

    payload = service._score_candidate(
        candidate,
        parse_row,
        "tester",
        [],
        "position_binding",
        "",
        screening_run_id="run-1",
        parent_task_id=91,
        root_task_id=91,
        task_log_row=log_row,
        reused_existing_parse=True,
    )

    assert payload is score_row
    assert service.ai_gateway.generate_json.call_count == 1
    final_validation_meta = service._update_ai_task_log.call_args_list[-1].kwargs["validation_meta"]
    assert "strict JSON 首次解析失败，已自动进行一次同 prompt 恢复重试" in final_validation_meta["validation_warnings"]
    assert final_validation_meta["score_model_retry_count"] == 1
    assert final_validation_meta["screening_result_valid"] is True
    assert final_validation_meta["position_match_returned"] is True
    assert candidate.ai_match_position_title == "岗位识别原始岗位"
    assert candidate.ai_match_confidence == 72.0
    assert candidate.ai_potential_position == "岗位识别转岗建议"
    saved_payload = service._save_score_result.call_args.args[3]
    assert saved_payload["score"]["position_match"]["recommended_position"] == "测试工程师"

    serialized_score = service._serialize_score(SimpleNamespace(
        id=41,
        candidate_id=5,
        parse_result_id=31,
        score_json=json.dumps(saved_payload, ensure_ascii=False),
        total_score=8.1,
        match_percent=81.0,
        recommendation="建议继续评估",
        suggested_status="screening_passed",
        manual_override_score=None,
        manual_override_reason=None,
        hr_feedback=None,
        hr_feedback_reason=None,
        created_at=None,
        updated_at=None,
    ))
    assert serialized_score["screening_position_match"]["recommended_position"] == "测试工程师"


def test_candidate_ai_match_snapshot_recovers_legacy_screening_overwrite_from_match_log():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(
        id=5,
        position_id=9,
        status="talent_pool",
        talent_pool_reason="evidence_review_required",
        ai_match_position_id=None,
        ai_match_position_title="初筛覆盖岗位",
        ai_match_confidence=5.0,
        ai_match_reason="初筛覆盖原因",
        ai_match_alternatives=None,
        ai_potential_position="初筛转岗建议",
        ai_potential_reason="初筛转岗原因",
    )
    match_log = SimpleNamespace(
        related_position_id=9,
        parsed_response_json=json.dumps({
            "position_id": 9,
            "position_title": "智能家居工程师",
            "confidence": 75,
            "reason": "岗位识别原始原因",
            "potential_position": "项目交付经理",
            "potential_reason": "具备项目交付经验",
        }, ensure_ascii=False),
        output_summary="岗位识别完成",
    )

    snapshot = service._build_direct_candidate_ai_match_snapshot(candidate)
    assert service._candidate_ai_match_snapshot_was_overwritten_by_screening(candidate, snapshot) is True
    recovered = service._merge_candidate_ai_match_snapshot_from_log(
        candidate,
        snapshot,
        match_log,
        prefer_log=True,
    )

    assert recovered["ai_match_position_id"] == 9
    assert recovered["ai_match_position_title"] == "智能家居工程师"
    assert recovered["ai_match_confidence"] == 75.0
    assert recovered["ai_match_reason"] == "岗位识别原始原因"

    manually_cleared = dict(snapshot)
    manually_cleared.update({
        "ai_match_position_title": None,
        "ai_match_confidence": None,
        "ai_match_reason": None,
        "ai_potential_position": None,
    })
    assert service._candidate_ai_match_snapshot_was_overwritten_by_screening(candidate, manually_cleared) is False


def test_serialize_score_recovers_legacy_one_pass_position_match_from_authoritative_payload():
    service = RecruitmentService(Mock())
    stored_payload = {
        "_storage_format": RAW_SCREENING_SCORE_STORAGE_FORMAT,
        "score": {
            "total_score": 0.5,
            "match_percent": 5,
            "recommendation": "建议淘汰",
            "suggested_status": "screening_rejected",
            "dimensions": [],
        },
        "authoritative": {
            "parsed_response": {
                "position_match": {
                    "recommended_position": "采购经理",
                    "confidence": 20,
                    "reason": "初筛后的岗位建议",
                    "potential_position": "供应链专员",
                    "potential_reason": "具备采购经验",
                },
            },
        },
        "debug": {},
    }
    serialized = service._serialize_score(SimpleNamespace(
        id=42,
        candidate_id=5,
        parse_result_id=31,
        score_json=json.dumps(stored_payload, ensure_ascii=False),
        total_score=0.5,
        match_percent=5.0,
        recommendation="建议淘汰",
        suggested_status="screening_rejected",
        manual_override_score=None,
        manual_override_reason=None,
        hr_feedback=None,
        hr_feedback_reason=None,
        created_at=None,
        updated_at=None,
    ))

    assert serialized["screening_position_match"]["recommended_position"] == "采购经理"
    assert serialized["screening_position_match"]["confidence"] == 20.0


def test_trigger_latest_parse_propagates_cancel_control():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5)
    parse_row = SimpleNamespace(id=31)
    service._get_candidate = Mock(return_value=candidate)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._serialize_parse_result = Mock(return_value={"parse_result_id": 31})
    cancel_control = object()

    payload = service.trigger_latest_parse(5, "tester", cancel_control=cancel_control)

    assert payload == {"parse_result_id": 31}
    assert service._parse_latest_resume.call_args.kwargs["cancel_control"] is cancel_control


def test_trigger_latest_score_propagates_cancel_control_when_parse_missing():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5)
    parse_row = SimpleNamespace(id=31)
    score_row = SimpleNamespace(id=41)
    service._get_candidate = Mock(return_value=candidate)
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._get_current_parse_result = Mock(return_value=None)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    cancel_control = object()

    payload = service.trigger_latest_score(5, "tester", cancel_control=cancel_control)

    assert payload == {"score_result_id": 41}
    assert service._parse_latest_resume.call_args.kwargs["cancel_control"] is cancel_control
    assert service._score_candidate.call_args.kwargs["cancel_control"] is cancel_control


def test_resume_score_prompt_uses_score_only_schema():
    assert SCORE_ONLY_OUTPUT_SCHEMA in RESUME_SCORE_SYSTEM_PROMPT
    assert SCREENING_OUTPUT_SCHEMA not in RESUME_SCORE_SYSTEM_PROMPT
    assert _COMMON_EVIDENCE_RULES in RESUME_SCORE_SYSTEM_PROMPT
    assert "Do not return parsed_resume in resume_score tasks." in RESUME_SCORE_SYSTEM_PROMPT
    assert "match_percent must equal round(total_score / MAX_POSSIBLE_SCORE * 100)." in RESUME_SCORE_SYSTEM_PROMPT
    assert "position_match" in SCORE_ONLY_OUTPUT_SCHEMA
    assert "The top-level object must contain only total_score, match_percent, advantages, concerns, recommendation, suggested_status, dimensions, radar_scores, and position_match." in RESUME_SCORE_SYSTEM_PROMPT
    assert "Return exactly one final JSON object" in RESUME_SCORE_SYSTEM_PROMPT
    assert "OTA压测" not in RESUME_SCORE_SYSTEM_PROMPT
    assert "智能家居生态" not in RESUME_SCORE_SYSTEM_PROMPT


def test_resume_score_prompt_requests_position_match_once():
    service = RecruitmentService(Mock())
    service._get_position_screening_payload = Mock(return_value={"title": "测试工程师"})
    service._build_available_positions_text = Mock(return_value="1. 测试工程师：负责测试")
    candidate = SimpleNamespace(name="候选人A", position_title="测试工程师")

    prompt = service._build_resume_score_prompt(
        candidate=candidate,
        parsed_resume_helper_payload={"basic_info": {"name": "候选人A"}},
        raw_resume_text="简历原文",
        skill_snapshots=_build_variable_max_score_skill_snapshots(),
        custom_requirements="",
        status_rules={},
    )

    assert "岗位推荐和转岗建议" in prompt
    assert "CURRENT_SCREENING_POSITION: 测试工程师" in prompt
    assert "AVAILABLE_POSITIONS（position_match 优先匹配这些招聘需求）:" in prompt
    assert "1. 测试工程师：负责测试" in prompt


def test_resume_score_sanitizer_preserves_position_match():
    schema_config = _build_screening_schema_config(_build_variable_max_score_skill_snapshots())
    payload = {
        "total_score": 8.0,
        "match_percent": 67,
        "advantages": ["核心经验匹配"],
        "concerns": ["需核实稳定性"],
        "recommendation": "建议继续评估",
        "suggested_status": "talent_pool",
        "dimensions": [
            {"label": "核心经验", "score": 6.0, "max_score": 8.0, "reason": "命中", "evidence": ["核心项目经验"], "is_inferred": False},
            {"label": "加分项", "score": 2.0, "max_score": 4.0, "reason": "部分命中", "evidence": ["自动化"], "is_inferred": False},
        ],
        "position_match": {
            "recommended_position": "测试工程师",
            "confidence": "88",
            "reason": "测试经验匹配",
            "potential_position": "测试开发工程师",
            "potential_reason": "有自动化基础",
        },
    }

    score_payload, meta = sanitize_screening_score_payload(payload, schema_config)

    assert meta["model_schema_violation"] is False
    assert score_payload["position_match"] == {
        "recommended_position": "测试工程师",
        "confidence": 88.0,
        "reason": "测试经验匹配",
        "potential_position": "测试开发工程师",
        "potential_reason": "有自动化基础",
    }


def test_resume_screening_prompt_reuses_common_evidence_rules():
    assert SCREENING_OUTPUT_SCHEMA in RESUME_SCREENING_SYSTEM_PROMPT
    assert _COMMON_EVIDENCE_RULES in RESUME_SCREENING_SYSTEM_PROMPT
    assert "Return strict JSON only." not in RESUME_SCREENING_SYSTEM_PROMPT
    assert "match_percent must equal round(total_score * 10)." in RESUME_SCREENING_SYSTEM_PROMPT


def test_resume_prompt_builders_inject_dynamic_max_possible_score():
    service = RecruitmentService(Mock())
    service._get_position_screening_payload = Mock(return_value={"title": "测试工程师"})
    candidate = SimpleNamespace(name="候选人A")
    skill_snapshots = _build_variable_max_score_skill_snapshots()

    screening_prompt = service._build_resume_screening_prompt(
        candidate=candidate,
        raw_text="简历原文",
        skill_snapshots=skill_snapshots,
        custom_requirements="",
        status_rules={},
    )
    score_prompt = service._build_resume_score_prompt(
        candidate=candidate,
        parsed_resume_helper_payload={"basic_info": {"name": "候选人A"}},
        raw_resume_text="简历原文",
        skill_snapshots=skill_snapshots,
        custom_requirements="",
        status_rules={},
    )

    assert "MAX_POSSIBLE_SCORE:" not in screening_prompt
    assert "MAX_POSSIBLE_SCORE: 12.0" in score_prompt
    assert screening_prompt.endswith("只返回 strict JSON，不要 markdown，不要解释。")
    assert score_prompt.endswith("只返回 strict JSON，不要 markdown，不要解释。")


def test_validate_screening_payload_warnings_uses_dimension_max_score_formula():
    schema_config = _build_screening_schema_config(_build_variable_max_score_skill_snapshots())
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "候选人A",
                "phone": "",
                "email": "",
                "years_of_experience": "",
                "education": "",
                "location": "",
            },
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
            "summary": "",
        },
        "score": {
            "total_score": 9.0,
            "match_percent": 75,
            "advantages": ["核心经验匹配较强。"],
            "concerns": ["自动化能力仍需面试核实。"],
            "recommendation": "建议继续评估",
            "suggested_status": "talent_pool",
            "dimensions": [
                {
                    "label": "核心经验",
                    "score": 6.0,
                    "max_score": 8.0,
                    "reason": "命中",
                    "evidence": "核心项目经验",
                    "is_inferred": False,
                },
                {
                    "label": "自动化能力",
                    "score": 3.0,
                    "max_score": 4.0,
                    "reason": "命中",
                    "evidence": "自动化脚本经验",
                    "is_inferred": False,
                },
            ],
        },
    }

    warnings = _validate_screening_payload_warnings(payload, schema_config)

    assert not any("score.match_percent 与 round(total_score / max_possible_score * 100) 不一致" in item for item in warnings)


def test_compose_json_user_prompt_keeps_single_chinese_suffix():
    prompt = _compose_json_user_prompt("TASK")
    assert prompt == "TASK\n\n只返回 strict JSON，不要 markdown，不要解释。"
    assert _compose_json_user_prompt("TASK\n\nPlease return valid JSON only.") == prompt
    assert _compose_json_user_prompt("TASK\n\nReturn valid JSON only.") == prompt
    assert _compose_json_user_prompt("TASK\n\n只返回 strict JSON，不要 markdown，不要解释。") == prompt


def test_extract_model_score_payload_warns_on_nested_score_response():
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "岳珊珊",
            },
        },
        "score": {
            "total_score": 1.0,
            "match_percent": 10,
            "advantages": ["有 IoT 相关经验"],
            "concerns": ["自动化测试证据不足"],
            "recommendation": "建议安排初试",
            "suggested_status": "screening_passed",
            "dimensions": [
                {
                    "label": "IoT通信协议",
                    "score": 1.0,
                    "max_score": 1.0,
                    "reason": "命中",
                    "evidence": ["BLE 协议测试"],
                    "is_inferred": False,
                }
            ],
        },
    }

    score_payload, meta = _extract_model_score_payload_with_meta(payload)

    assert score_payload["total_score"] == 1.0
    assert score_payload["dimensions"][0]["label"] == "IoT通信协议"
    assert meta["model_schema_violation"] is True
    assert meta["model_schema_violation_reason"] == "resume_score task returned nested parsed_resume+score payload; expected score-only schema"
    assert "模型未遵循 resume_score score-only schema，已降级提取 score 字段。" in meta["warnings"]


def test_resume_parse_prompt_tightens_duplicate_time_and_skill_rules():
    assert "Do not output the same work experience twice in different granularities." in RESUME_PARSE_SYSTEM_PROMPT
    assert "Do not output start_time or end_time." in RESUME_PARSE_SYSTEM_PROMPT
    assert "Never return a Python-list string or JSON-like string" in RESUME_PARSE_SYSTEM_PROMPT
    assert "skills must only contain concrete, discriminative skills" in RESUME_PARSE_SYSTEM_PROMPT


def test_prepare_resume_text_for_parse_prompt_compacts_duplicate_lines():
    raw_text = "\n".join(["李四", "李四", "", "", "北京智联科技有限公司 测试工程师", "北京智联科技有限公司 测试工程师", "Python 脚本"])

    prepared = _prepare_resume_text_for_parse_prompt(raw_text, max_chars=200)

    assert prepared.count("李四") == 1
    assert prepared.count("北京智联科技有限公司 测试工程师") == 1
    assert "Python 脚本" in prepared


def test_prepare_resume_text_for_parse_prompt_precleans_headings_dates_and_contact_noise():
    raw_text = "\n".join(
        [
            "基本信息",
            "基本信息",
            "教育背景",
            "邮箱：foo@example.com 2024- 09 ~ 至今 北京工业大学（211）",
            "工作经验",
            "电话：138 0013 8000 2024- 04 ~ 2025- 03 北京快手科技有限公司 测试工程师",
            "技能特长",
            "技能特长",
            "Python",
        ]
    )

    prepared = _prepare_resume_text_for_parse_prompt(raw_text, max_chars=400)

    assert prepared.count("基本信息") == 1
    assert prepared.count("技能特长") == 1
    assert "2024-09 ~ 至今 北京工业大学（211）" in prepared
    assert "2024-04 ~ 2025-03 北京快手科技有限公司 测试工程师" in prepared
    assert "foo@example.com" not in prepared
    assert "138 0013 8000" not in prepared


def test_score_payload_total_and_match_percent_auto_corrected_from_dimensions():
    schema_config = {
        "parsed_resume": SCREENING_PAYLOAD_SCHEMA_CONFIG["parsed_resume"],
        "score": {
            **SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
            "required_dimension_labels": ("智能家居生态", "IoT通信协议", "软件测试基础"),
        },
    }
    payload = {
        "total_score": 7.8,
        "match_percent": 78,
        "advantages": ["IoT 测试经验较匹配"],
        "concerns": ["自动化测试还需继续核实"],
        "recommendation": "建议安排初试",
        "suggested_status": "screening_passed",
        "dimensions": [
            {"label": "智能家居生态", "score": 2.5, "max_score": 2.5, "reason": "命中", "evidence": ["米家联动测试"], "is_inferred": False},
            {"label": "IoT通信协议", "score": 2.6, "max_score": 2.6, "reason": "命中", "evidence": ["BLE 协议测试"], "is_inferred": False},
            {"label": "软件测试基础", "score": 3.0, "max_score": 5.0, "reason": "命中", "evidence": ["接口测试"], "is_inferred": False},
        ],
    }

    score_payload, meta = sanitize_screening_score_payload(payload, schema_config)
    valid, reasons = _classify_screening_score_validity(
        score_payload,
        schema_config,
        validation_warnings=meta["warnings"],
    )

    assert score_payload["total_score"] == 8.1
    assert score_payload["match_percent"] == 81
    assert valid is True
    assert reasons == []
    assert "score.total_score 已按 dimensions 自动校正" in meta["warnings"]
    assert "score.match_percent 已按 total_score 自动校正" in meta["warnings"]


def test_dimension_score_over_max_is_clamped_and_totals_recomputed():
    schema_config = {
        "parsed_resume": SCREENING_PAYLOAD_SCHEMA_CONFIG["parsed_resume"],
        "score": {
            **SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
            "required_dimension_labels": ("基础匹配", "加分项"),
        },
    }
    payload = {
        "total_score": 5.1,
        "match_percent": 51,
        "advantages": ["基础条件满足"],
        "concerns": ["加分项需进一步核实"],
        "recommendation": "建议继续评估",
        "suggested_status": "talent_pool",
        "dimensions": [
            {"label": "基础匹配", "score": 5.0, "max_score": 5.0, "reason": "命中", "evidence": ["测试经验"], "is_inferred": False},
            {"label": "加分项", "score": 0.3, "max_score": 0.2, "reason": "部分命中", "evidence": ["自动化"], "is_inferred": False},
        ],
    }

    score_payload, meta = sanitize_screening_score_payload(payload, schema_config)

    assert score_payload["dimensions"][1]["score"] == 0.2
    assert score_payload["total_score"] == 5.2
    assert score_payload["match_percent"] == 52
    assert "维度[加分项]得分超过上限，已自动裁剪" in meta["warnings"]
    assert "score.total_score 已按 dimensions 自动校正" in meta["warnings"]
    assert "score.match_percent 已按 total_score 自动校正" in meta["warnings"]


def test_detect_score_json_variant_conflict_on_multiple_candidates_and_total_mismatch():
    raw_text = """{"total_score":7.8,"match_percent":78,"advantages":["A"],"concerns":["B"],"recommendation":"建议继续评估","suggested_status":"screening_passed","dimensions":[{"label":"基础匹配","score":8.1,"max_score":10.0,"reason":"命中","evidence":"测试经验","is_inferred":false}]}
{"total_score":8.1,"match_percent":81,"advantages":["A"],"concerns":["B"],"recommendation":"建议继续评估","suggested_status":"talent_pool","dimensions":[{"label":"基础匹配","score":8.1,"max_score":10.0,"reason":"命中","evidence":"测试经验","is_inferred":false}]}"""
    payload = {
        "total_score": 7.8,
        "match_percent": 78,
        "advantages": ["A"],
        "concerns": ["B"],
        "recommendation": "建议继续评估",
        "suggested_status": "screening_passed",
        "dimensions": [
            {"label": "基础匹配", "score": 8.1, "max_score": 10.0, "reason": "命中", "evidence": "测试经验", "is_inferred": False},
        ],
    }

    conflict = _detect_score_json_variant_conflict(raw_text, payload)

    assert conflict is not None
    assert conflict["failure_code"] == "invalid_json_variant_conflict"
    assert "检测到多个顶层 JSON 候选" in conflict["reasons"]
    assert "suggested_status 在同次模型返回中发生漂移" in conflict["reasons"]
    assert "total_score 在同次模型返回中发生漂移" in conflict["reasons"]
    assert "total_score 与 dimensions 求和不一致" in conflict["reasons"]


def test_sanitize_ai_parsed_resume_prefers_clean_model_parse_over_fallback_noise():
    raw_text = """张三
北京博彦科技有限公司 测试工程师 2022-01 ~ 2024-01
北京工业大学 本科 自动化 2014-09 ~ 2018-06
智能门锁项目 BLE 联调测试
Python BLE
"""
    model_parse = {
        "basic_info": {
            "name": "张三",
            "email": "zhangsan@example.com",
        },
        "work_experiences": [
            {
                "company_name": "北京博彦科技有限公司",
                "position": "测试工程师",
                "duration": "2022-01 ~ 2024-01",
            }
        ],
        "education_experiences": [
            {
                "school": "北京工业大学",
                "degree": "本科",
                "major": "自动化",
                "duration": "2014-09 ~ 2018-06",
            }
        ],
        "skills": ["Python", "BLE"],
        "projects": [
            {
                "project_name": "智能门锁项目",
                "description": "负责 BLE 联调测试",
            }
        ],
        "summary": "5年 IoT 测试经验，具备 BLE 联调经历。",
    }
    fallback_noise = {
        "basic_info": {
            "name": "张三",
            "email": "15210672214@163.com",
        },
        "work_experiences": [
            {
                "company_name": "北京博彦科技有限公司",
                "position": "测试工程师",
                "duration": "2022-01 ~ 2024-01",
            }
        ],
        "education_experiences": [
            {
                "school": "邮箱：15210672214@163.com 2024-09 ~ 至今 北京工业大学",
                "degree": "本科",
                "major": "自动化",
            },
            {
                "school": "北京工业大学",
                "degree": "本科",
                "major": "自动化",
            },
        ],
        "skills": ["Python", "IoT测试"],
        "projects": [
            {
                "project_name": "智能门锁项目项目描述：BLE 联调测试",
                "description": "整段脏文本",
            }
        ],
        "summary": "个人简历PERSONAL RESUME 联系电话：15210672214 邮箱：15210672214@163.com 自我评价：IoT测试",
    }

    with patch("app.services.recruitment_service_impl.extract_resume_structured_data", return_value=fallback_noise):
        sanitized = _sanitize_ai_parsed_resume(model_parse, raw_text, "张三")

    assert sanitized["work_experiences"][0]["company_name"] == "北京博彦科技有限公司"
    assert sanitized["work_experiences"][0]["position"] == "测试工程师"
    assert sanitized["work_experiences"][0]["duration"].replace(" ", "") == "2022-01~2024-01"
    assert len(sanitized["education_experiences"]) == 1
    assert sanitized["education_experiences"][0]["school"] == "北京工业大学"
    assert sanitized["education_experiences"][0]["degree"] == "本科"
    assert sanitized["education_experiences"][0]["major"] == "自动化"
    assert sanitized["education_experiences"][0]["duration"].replace(" ", "") == "2014-09~2018-06"
    assert sanitized["projects"] == model_parse["projects"]
    assert sanitized["summary"] == model_parse["summary"]
    assert "raw_text" not in sanitized


def test_parse_sanitize_does_not_replace_education_with_self_evaluation_noise():
    raw_text = """邓友志
江西交通职业技术学院 建筑工程技术 大专 2017-09 至 2020-06
熟悉主流房企精装工程标准与管理要求。具备扎实的精装专业知识、丰富的现场实操经验，擅长工艺把控、班组管理与多方协调。
"""
    model_parse = {
        "basic_info": {
            "name": "邓友志",
            "phone": "18760406393",
            "email": "1006898386@qq.com",
            "years_of_experience": "6",
            "education": "江西交通职业技术学院 建筑工程技术 大专",
        },
        "work_experiences": [],
        "education_experiences": [
            {
                "school": "江西交通职业技术学院",
                "degree": "大专",
                "major": "建筑工程技术",
                "start_date": "2017-09",
                "end_date": "2020-06",
            },
            {
                "school": "熟悉主流房企精装工程标准与管理要求。具备扎实的精装专业知识、丰富的现场实操经验，擅长工艺把控、班组管理与多方协调。",
                "major": "知识、丰富的现场实操经验",
            },
        ],
        "skills": [],
        "projects": [],
        "summary": "",
    }

    with patch("app.services.recruitment_service_impl.extract_resume_structured_data", return_value=model_parse):
        sanitized, warnings = _sanitize_ai_parsed_resume_with_meta(model_parse, raw_text, "邓友志")

    assert sanitized["basic_info"]["education"] == "江西交通职业技术学院 建筑工程技术 大专"
    assert len(sanitized["basic_info"]["education"]) <= 120
    assert sanitized["education_experiences"] == [
        {
            "school": "江西交通职业技术学院",
            "degree": "大专",
            "major": "建筑工程技术",
            "start_date": "2017-09",
            "end_date": "2020-06",
        }
    ]
    assert warnings == []


def test_parse_sanitize_dedupes_work_filters_generic_skills_and_normalizes_project_highlights():
    raw_text = """李四
北京智联科技有限公司 测试工程师 2022-01 ~ 2024-01
2022-01 ~ 2024-01 北京智联科技有限公司 测试工程师
智能网关项目
负责网关设备测试
亮点：自动化回归、BLE 联调
Python 脚本
"""
    model_parse = {
        "basic_info": {"name": "李四"},
        "work_experiences": [
            {
                "company_name": "北京智联科技有限公司",
                "position": "测试工程师",
                "duration": "2022-01 ~ 2024-01",
                "description": "['承担测试计划制定', '执行回归测试']",
            },
            {
                "company_name": "北京智联科技有限公司",
                "position": "测试工程师",
                "start_time": "2022-01",
                "end_time": "2024-01",
            },
        ],
        "education_experiences": [],
        "skills": ["IoT", "测试", "SQL", "BLE", "Python"],
        "projects": [
            {
                "project_name": "智能网关项目",
                "description": "['负责网关设备测试', '跟进缺陷闭环']",
                "highlights": "['自动化回归', 'BLE 联调']",
                "start_time": "2023-01",
                "end_time": "2023-12",
            }
        ],
        "summary": "具备智能硬件测试经验。",
    }

    with patch("app.services.recruitment_service_impl.extract_resume_structured_data", return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""}):
        sanitized, warnings = _sanitize_ai_parsed_resume_with_meta(model_parse, raw_text, "李四")

    assert len(sanitized["work_experiences"]) == 1
    assert sanitized["work_experiences"][0]["company_name"] == "北京智联科技有限公司"
    assert sanitized["work_experiences"][0]["duration"].replace(" ", "") == "2022-01~2024-01"
    assert sanitized["work_experiences"][0]["description"] == ["承担测试计划制定", "执行回归测试"]
    assert "start_time" not in sanitized["work_experiences"][0]
    assert "end_time" not in sanitized["work_experiences"][0]
    assert sanitized["skills"] == ["BLE", "Python"]
    assert sanitized["projects"][0]["description"] == ["负责网关设备测试", "跟进缺陷闭环"]
    assert sanitized["projects"][0]["highlights"] == ["自动化回归", "BLE 联调"]
    assert sanitized["projects"][0]["start_date"] == "2023-01"
    assert sanitized["projects"][0]["end_date"] == "2023-12"
    assert "start_time" not in sanitized["projects"][0]
    assert "end_time" not in sanitized["projects"][0]
    assert "work_experiences 存在重复结构，已去重" in warnings
    assert "work_experiences.description 为字符串化列表，已归一" in warnings
    assert "skills 存在泛词污染，已过滤" in warnings
    assert "projects.highlights 为字符串化列表，已归一" in warnings
    assert "projects.description 为字符串化列表，已归一" in warnings


def test_parse_sanitize_drops_pseudo_work_items_filters_extra_generic_skills_and_enriches_education():
    raw_text = """王欢
上海智联科技有限公司 测试工程师 2022-01 ~ 2024-01
负责 BLE 设备联调、Postman 接口测试、Linux 常用命令排查、MySQL增删改查。
上海交通大学 硕士 电子信息
技能：Postman接口测试、Linux常用命令、MySQL增删改查、Xmind测试思维导图
项目：智能网关项目，负责接口联调与测试报告输出。
"""
    model_parse = {
        "basic_info": {"name": "王欢", "education": "硕士"},
        "work_experiences": [
            {
                "company_name": "上海智联科技有限公司",
                "position": "测试工程师",
                "duration": "2022-01 ~ 2024-01",
                "description": "['负责 BLE 联调', '输出测试报告']",
            },
            {
                "company_name": "深度参与整机测试，负责关键软件",
                "position": "负责关键软件测试",
                "duration": "",
            },
            {
                "company_name": "建立新机软件",
                "position": "",
                "description": "['职责碎片']",
            },
        ],
        "education_experiences": [
            {"school": "上海交通大学", "degree": "硕士", "major": "电子信息"},
        ],
        "skills": ["质量", "沟通", "硬件", "驱动", "测试", "iot", "MySQL增删改查", "Linux常用命令", "Postman接口测试", "Xmind测试思维导图"],
        "projects": [
            {
                "project_name": "智能网关项目",
                "description": "['接口联调', '输出测试报告']",
                "highlights": "['Postman接口测试', 'Linux常用命令']",
            }
        ],
        "summary": "具备智能硬件测试经验。",
    }

    with patch("app.services.recruitment_service_impl.extract_resume_structured_data", return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""}):
        sanitized, warnings = _sanitize_ai_parsed_resume_with_meta(model_parse, raw_text, "王欢")

    assert sanitized["work_experiences"] == [
        {
            "company_name": "上海智联科技有限公司",
            "position": "测试工程师",
            "duration": "2022-01 ~ 2024-01",
            "description": ["负责 BLE 联调", "输出测试报告"],
        }
    ]
    assert sanitized["skills"] == ["MySQL增删改查", "Linux常用命令", "Postman接口测试", "Xmind测试思维导图"]
    assert sanitized["projects"][0]["description"] == ["接口联调", "输出测试报告"]
    assert sanitized["projects"][0]["highlights"] == ["Postman接口测试", "Linux常用命令"]
    assert sanitized["basic_info"]["education"] == "上海交通大学 硕士 电子信息"
    assert "work_experiences 中存在结构异常的工作经历条目，已过滤" in warnings
    assert "skills 存在泛词污染，已过滤" in warnings


def test_root_task_completed_snapshot_contains_timing_and_persisted_refs():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="screening_passed", match_percent=81, ai_recommended_status="screening_passed")
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    score_row = SimpleNamespace(id=41)
    score_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"validation_warnings":[],"invalid_result_reasons":[],"screening_result_valid":true,"screening_result_state":"success","parse_strategy":"rerank_from_existing_parse","reused_existing_parse":true,"final_response_source":"primary_score_model","primary_model_call_succeeded":true}',
        output_summary="初筛评分完成",
        error_message=None,
        status="success",
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json='{"parse_duration_ms":0,"score_duration_ms":400,"validation_duration_ms":120,"save_duration_ms":80}',
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: score_log if kwargs.get("task_type") == "resume_score" else None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1234})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41, "candidate_status_after": "screening_passed"})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._screen_candidate_with_single_ai_call = Mock(side_effect=AssertionError("should not call one-pass"))
    service._save_screening_workflow_memory = Mock()
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    service.screen_candidate(5, "tester", screening_mode="rerank_from_existing_parse")

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["timing_breakdown"] == {"total_duration_ms": 1234}
    assert kwargs["persisted_result_refs"] == {"parse_result_id": 31, "score_result_id": 41, "candidate_status_after": "screening_passed"}


def test_build_screening_run_timing_breakdown_uses_child_total_when_root_total_is_too_small():
    service = RecruitmentService(Mock())
    created_at = datetime.now() - timedelta(seconds=90)
    root_log = SimpleNamespace(
        created_at=created_at,
        updated_at=created_at + timedelta(seconds=1),
        stage_started_at=created_at + timedelta(milliseconds=200),
        stage_completed_at=created_at + timedelta(seconds=1),
        duration_ms=1000,
        status="success",
        timing_breakdown_json='{"parse_duration_ms":0,"total_duration_ms":1000}',
        output_snapshot='{"parse_strategy":"combined_parse_and_score"}',
        validation_meta_json="{}",
    )
    score_log = SimpleNamespace(
        created_at=created_at + timedelta(milliseconds=200),
        updated_at=created_at + timedelta(seconds=88),
        stage_started_at=created_at + timedelta(milliseconds=200),
        stage_completed_at=created_at + timedelta(seconds=88),
        duration_ms=87883,
        timing_breakdown_json='{"score_duration_ms":87583,"validation_duration_ms":200,"save_duration_ms":100,"total_duration_ms":87883}',
    )

    timing = service._build_screening_run_timing_breakdown(
        root_log=root_log,
        parse_log=None,
        score_log=score_log,
    )

    assert timing["parse_duration_ms"] is None
    assert timing["score_duration_ms"] == 87583
    assert timing["total_duration_ms"] >= 87883


def test_build_screening_run_timing_breakdown_does_not_fake_zero_parse_duration_for_one_pass():
    service = RecruitmentService(Mock())
    created_at = datetime.now() - timedelta(seconds=10)
    root_log = SimpleNamespace(
        created_at=created_at,
        updated_at=created_at + timedelta(seconds=9),
        stage_started_at=created_at + timedelta(milliseconds=100),
        stage_completed_at=created_at + timedelta(seconds=9),
        duration_ms=9000,
        status="success",
        timing_breakdown_json='{"parse_duration_ms":0,"score_duration_ms":8200,"validation_duration_ms":300,"save_duration_ms":200,"total_duration_ms":9000}',
        output_snapshot='{"parse_strategy":"combined_parse_and_score"}',
        validation_meta_json="{}",
    )
    score_log = SimpleNamespace(
        created_at=created_at + timedelta(milliseconds=100),
        updated_at=created_at + timedelta(seconds=9),
        stage_started_at=created_at + timedelta(milliseconds=100),
        stage_completed_at=created_at + timedelta(seconds=9),
        duration_ms=8700,
        timing_breakdown_json='{"parse_duration_ms":null,"score_duration_ms":8200,"validation_duration_ms":300,"save_duration_ms":200,"total_duration_ms":8700}',
    )

    timing = service._build_screening_run_timing_breakdown(
        root_log=root_log,
        parse_log=None,
        score_log=score_log,
    )

    assert timing["parse_duration_ms"] is None
    assert timing["total_duration_ms"] >= timing["score_duration_ms"]


def test_get_candidate_detail_compacts_heavy_payload_and_survives_activity_failures():
    db = Mock()
    service = RecruitmentService(db)
    candidate = SimpleNamespace(id=7, latest_parse_result_id=31, latest_score_id=41)
    parse_row = SimpleNamespace(
        id=31,
        candidate_id=7,
        resume_file_id=11,
        raw_text="A" * 50000,
        basic_info_json=json.dumps({"name": "王欢", "education": "本科"}, ensure_ascii=False),
        work_experiences_json=json.dumps([{"company_name": "上海某科技有限公司", "description": "D" * 40000}], ensure_ascii=False),
        education_experiences_json="[]",
        skills_json=json.dumps(["Postman接口测试", "Linux常用命令"], ensure_ascii=False),
        projects_json="[]",
        summary_text="S" * 30000,
        status="success",
        error_message=None,
        created_at=datetime(2026, 4, 14, 12, 0, 0),
    )
    score_row = SimpleNamespace(id=41)
    bad_log = _build_ai_task_log_row(id=1, task_type="resume_score")
    good_log = _build_ai_task_log_row(id=2, task_type=SCREENING_FLOW_TASK_TYPE)

    db.query.side_effect = [
        _build_query_mock(all_value=[]),
        _build_query_mock(first_value=parse_row),
        _build_query_mock(first_value=score_row),
        _build_query_mock(all_value=[]),
        _build_query_mock(all_value=[]),
        _build_query_mock(all_value=[bad_log, good_log]),
        _build_query_mock(first_value=None),
    ]

    service._get_candidate = Mock(return_value=candidate)
    service._get_workflow_memory = Mock(return_value=None)
    service._serialize_candidate_summary = Mock(
        return_value={
            "id": 7,
            "name": "王欢",
            "position_screening_skills": [{"id": 1, "name": "IoT 初筛规则", "content": "C" * 50000}],
        }
    )
    service._serialize_score = Mock(return_value={"id": 41, "total_score": 7.8, "match_percent": 78})
    service._settle_orphaned_live_task = Mock(side_effect=[RuntimeError("settle failed"), False])

    original_serialize_ai_task_log = service._serialize_ai_task_log

    def _serialize_with_failure(row, **kwargs):
        if row.id == 1:
            raise RuntimeError("serialize failed")
        return original_serialize_ai_task_log(row, **kwargs)

    service._serialize_ai_task_log = Mock(side_effect=_serialize_with_failure)

    payload = service.get_candidate_detail(7)

    assert payload["candidate"]["position_screening_skills"][0]["content"].endswith("...")
    assert payload["parse_result"]["raw_text"].endswith("...")
    assert payload["activity_meta"]["returned_count"] == 2
    assert payload["activity"][0]["validation_meta"]["detail_log_serialization_failed"] is True
    assert payload["activity"][0]["output_summary"] == "该条日志序列化失败，已返回精简兜底信息。"
    assert payload["activity"][1]["raw_response_text"].endswith("...")
    assert payload["activity"][1]["output_snapshot"]["raw"].endswith("...")


def test_root_task_completed_inherits_model_from_score_log():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="screening_passed", match_percent=81, ai_recommended_status="screening_passed")
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    score_row = SimpleNamespace(id=41)
    score_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"screening_result_valid":true,"screening_result_state":"success","parse_strategy":"rerank_from_existing_parse","reused_existing_parse":true}',
        output_summary="初筛评分完成",
        error_message=None,
        status="success",
        model_provider="GLM",
        model_name="glm-5",
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json='{"parse_duration_ms":0,"score_duration_ms":400}',
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: score_log if kwargs.get("task_type") == "resume_score" else None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1234})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._save_screening_workflow_memory = Mock()
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    service.screen_candidate(5, "tester", screening_mode="rerank_from_existing_parse")

    kwargs = service._finish_ai_task_log.call_args.kwargs
    assert kwargs["provider"] == "GLM"
    assert kwargs["model_name"] == "glm-5"


def test_root_validation_meta_does_not_embed_full_parsed_resume_and_score():
    service = RecruitmentService(Mock())
    candidate = SimpleNamespace(id=5, position_id=9, latest_resume_file_id=12, updated_by=None, status="screening_passed", match_percent=81, ai_recommended_status="screening_passed")
    parse_row = SimpleNamespace(id=31, resume_file_id=12, status="success", raw_text="候选人简历：三年物联网测试经验，负责 IoT 协议联调与自动化测试，使用 Python 编写自动化测试脚本与测试平台，熟悉智能家居生态与设备联动测试。")
    score_row = SimpleNamespace(id=41)
    score_log = SimpleNamespace(
        id=92,
        validation_meta_json='{"validation_warnings":["结构校验提醒"],"invalid_result_reasons":[],"invalid_result_summary":null,"model_schema_violation":false,"model_schema_violation_reason":null,"screening_result_valid":true,"screening_result_state":"success","parse_strategy":"rerank_from_existing_parse","reused_existing_parse":true}',
        output_summary="初筛评分完成",
        error_message=None,
        status="success",
    )
    root_log = SimpleNamespace(
        id=91,
        screening_run_id="run-91",
        root_task_id=91,
        validation_meta_json=None,
        error_message=None,
        output_summary="初筛完成",
        timing_breakdown_json='{"parse_duration_ms":0,"score_duration_ms":400,"validation_duration_ms":120,"save_duration_ms":80}',
        output_snapshot=None,
    )

    service._get_candidate = Mock(return_value=candidate)
    service._can_reuse_existing_parse_result = Mock(return_value=True)
    service._resolve_screening_skills = Mock(return_value=([], "position", "position_binding", {}))
    service._prepare_screening_task_context = Mock(return_value=([{"id": 1, "name": "初筛规则", "content": "| 维度 | 权重 | 满分 | 说明 |\n| --- | --- | --- | --- |\n| IoT协议 | 50% | 5 | 核心第一优先，必须提供 BLE 相关简历原文证据 |\n| 自动化测试 | 50% | 5 | 需要体现自动化脚本或测试平台经验 |"}], [1], ""))
    service._build_screening_request_meta = Mock(return_value={"request_hash": "hash"})
    service._load_reusable_screening_result = Mock(return_value=None)
    service._ensure_screening_root_task = Mock(return_value=root_log)
    service._update_ai_task_log = Mock(return_value=root_log)
    service._get_current_parse_result = Mock(return_value=parse_row)
    service._score_candidate = Mock(return_value=score_row)
    service._parse_latest_resume = Mock(return_value=parse_row)
    service._get_latest_screening_run_task = Mock(side_effect=lambda screening_run_id, **kwargs: score_log if kwargs.get("task_type") == "resume_score" else None)
    service._build_screening_run_timing_breakdown = Mock(return_value={"total_duration_ms": 1234})
    service._build_screening_persisted_result_refs = Mock(return_value={"parse_result_id": 31, "score_result_id": 41})
    service._finish_ai_task_log = Mock(return_value=root_log)
    service._screen_candidate_with_single_ai_call = Mock(side_effect=AssertionError("should not call one-pass"))
    service._save_screening_workflow_memory = Mock()
    service._serialize_parse_result = Mock(return_value={"basic_info": {}, "work_experiences": [], "education_experiences": [], "skills": [], "projects": [], "summary": ""})
    service._serialize_score = Mock(return_value={"score_result_id": 41})
    service.get_candidate_detail = Mock(return_value={"candidate": {"id": 5}})

    service.screen_candidate(5, "tester", screening_mode="rerank_from_existing_parse")

    validation_meta = service._finish_ai_task_log.call_args.kwargs["validation_meta"]
    assert "parsed_resume" not in validation_meta
    assert "score" not in validation_meta
    assert "raw_response_text" not in validation_meta
    assert validation_meta["parse_strategy"] == "rerank_from_existing_parse"


def test_suggested_status_conflict_resolved_by_deterministic_rules_before_save():
    service = RecruitmentService(Mock())
    service._auto_advance_candidate_after_screening = Mock(
        side_effect=lambda candidate, actor_id=None: setattr(candidate, "status", candidate.ai_recommended_status)
    )
    candidate = SimpleNamespace(
        id=5,
        latest_score_id=None,
        match_percent=None,
        ai_recommended_status=None,
        status="talent_pool",
        updated_by=None,
    )
    parse_row = SimpleNamespace(id=31)
    schema_config = {
        "parsed_resume": SCREENING_PAYLOAD_SCHEMA_CONFIG["parsed_resume"],
        "score": {
            **SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
            "required_dimension_labels": ("核心匹配", "经验匹配"),
            "status_thresholds": {"pass_threshold": 75.0, "pool_threshold": 55.0},
        },
    }
    payload = {
        "total_score": 8.0,
        "match_percent": 80,
        "advantages": ["核心维度命中"],
        "concerns": ["需继续核实自动化能力"],
        "recommendation": "建议保留观察",
        "suggested_status": "talent_pool",
        "dimensions": [
            {"label": "核心匹配", "score": 4.0, "max_score": 5.0, "reason": "命中", "evidence": ["核心经验"], "is_inferred": False},
            {"label": "经验匹配", "score": 4.0, "max_score": 5.0, "reason": "命中", "evidence": ["项目经验"], "is_inferred": False},
        ],
    }

    score_payload, meta = sanitize_screening_score_payload(payload, schema_config)
    score_row = service._save_score_result(
        candidate,
        parse_row,
        "tester",
        {
            "_storage_format": RAW_SCREENING_SCORE_STORAGE_FORMAT,
            "score": score_payload,
        },
    )

    # P0-1 契约反转：最终状态一律由确定性规则推导（80 分 ≥ pass 阈值 75 → screening_passed），
    # 模型给的 talent_pool 仅作审计留存并产生不一致告警。
    assert meta["raw_model_suggested_status"] == "talent_pool"
    assert meta["normalized_final_suggested_status"] == "screening_passed"
    assert any("已以规则结果为准" in item for item in meta["warnings"])
    assert score_payload["suggested_status"] == "screening_passed"
    assert candidate.ai_recommended_status == "screening_passed"
    assert candidate.status == "screening_passed"
    assert score_row.suggested_status == "screening_passed"


def test_final_score_dimensions_do_not_leak_weight_text_or_is_core():
    normalized_score = {
        "total_score": 8.1,
        "match_percent": 81,
        "advantages": ["经验匹配"],
        "concerns": ["自动化能力待核实"],
        "recommendation": "建议安排初试",
        "suggested_status": "screening_passed",
    }
    score_enhancements = {
        "dimensions": [
            {
                "label": "IoT通信协议",
                "score": 2.6,
                "max_score": 2.5,
                "reason": "命中",
                "evidence": ["BLE 协议测试"],
                "is_inferred": False,
                "weight_text": "25%",
                "is_core": True,
            }
        ],
        "dimensions_mode": "strict",
        "missing_core_labels": [],
        "score_cap_reason": None,
        "derived_total_score_from_dimensions": 8.1,
        "derived_match_percent_from_dimensions": 81,
        "score_quality_warnings": [],
        "repair_reason": None,
        "report_markdown": None,
    }

    score_payload = _build_score_compat_payload(normalized_score, score_enhancements)

    # radar_category 是后续新增的安全展示字段；仍用精确集合断言，确保 weight_text/is_core 不泄漏。
    assert set(score_payload["dimensions"][0].keys()) == {"label", "score", "max_score", "reason", "evidence", "is_inferred", "radar_category"}


def test_recommendation_matches_screening_passed_semantically():
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "",
                "phone": "",
                "email": "",
                "years_of_experience": "",
                "education": "",
                "location": "",
            },
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
            "summary": "",
        },
        "score": {
            "total_score": 8.0,
            "match_percent": 80,
            "advantages": ["核心维度命中"],
            "concerns": ["自动化测试偏弱"],
            "recommendation": "核心维度匹配良好，建议通过初筛",
            "suggested_status": "screening_passed",
            "dimensions": [
                {"label": "智能家居生态", "score": 2.5, "max_score": 2.5, "reason": "命中", "evidence": ["米家联动测试"], "is_inferred": False},
                {"label": "IoT通信协议", "score": 2.5, "max_score": 2.5, "reason": "命中", "evidence": ["BLE 协议测试"], "is_inferred": False},
                {"label": "软件测试基础", "score": 3.0, "max_score": 5.0, "reason": "命中", "evidence": ["接口测试"], "is_inferred": False},
            ],
        },
    }
    schema_config = {
        "parsed_resume": SCREENING_PAYLOAD_SCHEMA_CONFIG["parsed_resume"],
        "score": {
            **SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
            "status_thresholds": {"pass_threshold": 75.0, "pool_threshold": 55.0},
        },
    }

    warnings = _validate_screening_payload_warnings(payload, schema_config)

    assert "score.recommendation 与 suggested_status 不一致。" not in warnings


def test_recommendation_conflicts_with_screening_rejected():
    payload = {
        "parsed_resume": {
            "basic_info": {
                "name": "",
                "phone": "",
                "email": "",
                "years_of_experience": "",
                "education": "",
                "location": "",
            },
            "work_experiences": [],
            "education_experiences": [],
            "skills": [],
            "projects": [],
            "summary": "",
        },
        "score": {
            "total_score": 4.0,
            "match_percent": 40,
            "advantages": ["基础测试经验"],
            "concerns": ["核心维度缺失"],
            "recommendation": "建议安排首面进一步评估",
            "suggested_status": "screening_rejected",
            "dimensions": [
                {"label": "智能家居生态", "score": 0.0, "max_score": 2.5, "reason": "简历未提及", "evidence": "", "is_inferred": False},
                {"label": "IoT通信协议", "score": 0.0, "max_score": 2.5, "reason": "简历未提及", "evidence": "", "is_inferred": False},
                {"label": "软件测试基础", "score": 4.0, "max_score": 5.0, "reason": "命中", "evidence": ["接口测试"], "is_inferred": False},
            ],
        },
    }
    schema_config = {
        "parsed_resume": SCREENING_PAYLOAD_SCHEMA_CONFIG["parsed_resume"],
        "score": {
            **SCREENING_PAYLOAD_SCHEMA_CONFIG["score"],
            "status_thresholds": {"pass_threshold": 75.0, "pool_threshold": 55.0},
        },
    }

    warnings = _validate_screening_payload_warnings(payload, schema_config)

    assert "score.recommendation 与 suggested_status 不一致。" in warnings


def test_build_parsed_resume_helper_payload_cleans_noisy_fields():
    service = RecruitmentService(Mock())
    helper, warnings = service._build_score_resume_helper_payload(
        {
            "basic_info": {
                "name": "岳珊珊",
                "phone": "15210672214",
                "email": "15210672214@163.com",
                "years_of_experience": "8年",
                "education": "硕士",
                "location": "北京",
            },
            "work_experiences": [
                {
                    "duration": "2024- 04 ~ 2025- 03",
                    "company": "北京博彦科技有限公司",
                    "position": "测试",
                    "description": "负责功能测试",
                }
            ],
            "education_experiences": [
                {
                    "school": "邮 箱 ： 15210672214@163.com 2024- 09 ~ 至今 北京工业大学（211）",
                    "degree": "硕士",
                    "start_date": "2024- 09",
                    "end_date": "至今",
                },
                {
                    "school": "北京工业大学（211）",
                    "degree": "硕士",
                    "start_date": "2024- 09",
                    "end_date": "至今",
                    "major": "计算机",
                },
            ],
            "skills": ["MySQL", ",", "；", "Linux", "MySQL"],
            "projects": [
                {
                    "project_name": "小米智能门锁项目描述：小米门锁业务线，全线品牌的门锁软硬件测试",
                    "description": "",
                }
            ],
            "summary": "个人简历PERSONAL RESUME 联系电话：15210672214 邮箱：15210672214@163.com 出生年月：1993-12 自我评价：8年经验，长期从事IoT测试。",
        }
    )

    assert helper["basic_info"] == {
        "name": "岳珊珊",
        "years_of_experience": "8年",
        "education": "硕士",
    }
    assert helper["education_experiences"] == [
        {
            "school": "北京工业大学（211）",
            "degree": "硕士",
            "start_date": "2024-09",
            "end_date": "至今",
        }
    ]
    assert helper["projects"] == [
        {
            "project_name": "小米智能门锁",
            "description": "小米门锁业务线，全线品牌的门锁软硬件测试",
        }
    ]
    assert helper["summary"] == ""
    assert helper["skills"] == ["MySQL", "Linux"]
    assert warnings == ["score helper sanitized from parse result before scoring"]


def test_dimension_reason_summary_is_generic_for_unknown_label():
    summary = _build_dimension_reason_summary(
        "数据分析能力",
        score=0.0,
        max_score=1.0,
        raw_reason="",
        evidence=[],
    )

    assert summary in {"简历未提及", "未见与该维度直接对应的简历证据"}
    assert "IoT" not in summary
    assert "智能家居" not in summary


def test_dimension_concern_summary_is_generic_for_unknown_label():
    summary = _build_dimension_concern_summary(
        {
            "label": "数据分析能力",
            "score": 0.4,
            "max_score": 1.0,
        }
    )

    assert summary == "数据分析能力方面匹配度偏弱，建议面试继续核实。"
    assert "IoT" not in summary
    assert "智能家居" not in summary


def test_build_parsed_resume_helper_payload_dedupes_work_experiences_and_filters_generic_skills():
    service = RecruitmentService(Mock())
    helper, warnings = service._build_score_resume_helper_payload(
        {
            "basic_info": {
                "name": "候选人A",
                "years_of_experience": "6年",
                "education": "本科",
            },
            "work_experiences": [
                {"duration": "2022-01 ~ 2024-01", "company": "甲公司", "position": "测试工程师"},
                {"duration": "2022-01 ~ 2024-01", "company": "甲公司", "position": "测试工程师", "description": "重复经历"},
                {"duration": "2020-01 ~ 2021-12", "company": "乙公司", "position": "QA"},
            ],
            "education_experiences": [
                {"school": "某大学", "degree": "本科", "start_date": "2014-09", "end_date": "2018-06"},
                {"school": "某大学", "degree": "本科", "start_date": "2014-09", "end_date": "2018-06"},
            ],
            "skills": ["iot", "测试", "web", "app", "MySQL", "Linux", "Postman", "Jira", "自动化测试"],
            "projects": [
                {"project_name": "支付平台升级项目", "description": "负责支付链路改造、接口联调、回归测试与线上问题跟踪。" * 20},
            ],
            "summary": "",
        }
    )

    assert helper["work_experiences"] == [
        {"duration": "2022-01 ~ 2024-01", "company": "甲公司", "position": "测试工程师"},
        {"duration": "2020-01 ~ 2021-12", "company": "乙公司", "position": "QA"},
    ]
    assert helper["education_experiences"] == [
        {"school": "某大学", "degree": "本科", "start_date": "2014-09", "end_date": "2018-06"},
    ]
    assert helper["skills"][:5] == ["MySQL", "Linux", "Postman", "Jira", "自动化测试"]
    assert "iot" not in helper["skills"]
    assert "测试" not in helper["skills"]
    assert "web" not in helper["skills"]
    assert "app" not in helper["skills"]
    assert len(helper["projects"][0]["description"]) <= 160
    assert warnings == ["score helper sanitized from parse result before scoring"]


def test_build_parsed_resume_helper_payload_downgrades_to_basic_info_when_parse_risk_is_high():
    service = RecruitmentService(Mock())
    helper, warnings = service._build_score_resume_helper_payload(
        {
            "basic_info": {
                "name": "候选人A",
                "phone": "13800138000",
                "email": "test@example.com",
                "years_of_experience": "6年",
                "education": "本科",
                "location": "北京",
            },
            "work_experiences": [
                {"duration": "2022-01 ~ 2024-01", "company": "甲公司", "position": "测试工程师"},
            ],
            "education_experiences": [
                {"school": "某大学", "degree": "本科", "start_date": "2014-09", "end_date": "2018-06"},
            ],
            "skills": ["MySQL", "Linux"],
            "projects": [
                {"project_name": "支付平台升级项目", "description": "负责支付链路改造"},
            ],
            "summary": "负责测试。",
        },
        parse_quality_warnings=["work_experiences 中仍存在结构异常的工作经历条目"],
    )

    assert helper == {
        "basic_info": {
            "name": "候选人A",
            "years_of_experience": "6年",
            "education": "本科",
        },
        "work_experiences": [],
        "education_experiences": [],
        "skills": [],
        "projects": [],
        "summary": "",
    }
    assert "high-risk parse result detected; score helper downgraded to basic_info only" in warnings
    assert "score helper sanitized from parse result before scoring" in warnings
