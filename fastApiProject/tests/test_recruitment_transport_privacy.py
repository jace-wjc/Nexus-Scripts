import asyncio
import json
import time
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.routers import recruitment
from app.script_hub_session import create_script_hub_session
from app.services.recruitment_ai_gateway import RecruitmentAIJSONParseError, _log_strict_json_recovery_context


def _session():
    return {"id": "synthetic", "permissions": {"recruitment-process-execute": True}}


def _request(token):
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    return Request({"type": "http", "method": "GET", "path": "/recruitment/task-events",
                    "headers": [(b"authorization", f"Bearer {token}".encode())]}, receive=receive)


@pytest.mark.parametrize("failure", [HTTPException(401), HTTPException(403), RuntimeError("database unavailable")])
def test_stream_closes_and_unsubscribes_before_sending_event_when_access_fails(monkeypatch, failure):
    async def scenario():
        queue = asyncio.Queue()
        await queue.put(json.dumps({"type": "candidate_updated", "candidate_id": 7}))
        monkeypatch.setattr(recruitment, "_load_task_event_context", lambda session: object())
        monkeypatch.setattr(recruitment, "_refresh_task_event_access", Mock(side_effect=failure))
        monkeypatch.setattr(recruitment.TaskEventBus, "subscribe", lambda token: ("subscription", queue))
        unsubscribe = Mock()
        monkeypatch.setattr(recruitment.TaskEventBus, "unsubscribe", unsubscribe)
        token = create_script_hub_session(_session())["token"]
        response = await recruitment.stream_task_events(_request(token), _session())
        events = [event async for event in response.body_iterator]
        assert len(events) == 1
        assert '"hello"' in events[0]
        unsubscribe.assert_called_once_with(token, "subscription")
    asyncio.run(scenario())


def test_stream_rechecks_expiry_and_rebuilds_scope_when_permissions_change(monkeypatch):
    from app import script_hub_session
    session = _session()
    token = create_script_hub_session(session)["token"]
    previous_context = object()
    new_context = object()
    loader = Mock(return_value=new_context)
    monkeypatch.setattr(recruitment, "_load_task_event_context", loader)
    request = _request(token)
    refreshed = recruitment._refresh_task_event_access(request, session, previous_context, time.monotonic())
    assert refreshed[1] is new_context
    unchanged = recruitment._refresh_task_event_access(request, refreshed[0], new_context, refreshed[2])
    assert unchanged[1] is new_context
    assert loader.call_count == 1
    monkeypatch.setattr(script_hub_session, "verify_script_hub_session", lambda value: None)
    with pytest.raises(HTTPException) as caught:
        recruitment._refresh_task_event_access(request, refreshed[0], new_context, refreshed[2])
    assert caught.value.status_code == 401


def test_stream_refreshes_org_context_periodically_without_rebuilding_on_every_event(monkeypatch):
    session = _session()
    monkeypatch.setattr(recruitment, "require_script_hub_any_permission", lambda permissions: lambda request: session)
    loader = Mock(return_value=object())
    monkeypatch.setattr(recruitment, "_load_task_event_context", loader)
    context = object()
    recent = recruitment._refresh_task_event_access(None, session, context, time.monotonic())
    assert recent[1] is context
    loader.assert_not_called()
    expired = recruitment._refresh_task_event_access(None, session, context, time.monotonic() - 26)
    assert expired[1] is loader.return_value
    loader.assert_called_once_with(session)


def test_duplicate_body_keeps_legacy_result_and_denies_wrong_permission_before_service():
    app = FastAPI()
    app.include_router(recruitment.recruitment_router)
    service = Mock()
    service.check_candidate_duplicates.return_value = [{"id": 7, "phone": "synthetic-phone"}]
    app.dependency_overrides[recruitment.get_recruitment_service] = lambda: service
    token = create_script_hub_session({"id": "synthetic", "permissions": {"recruitment-dashboard-view": True}})["token"]
    payload = {"phone": "synthetic-phone", "email": None, "exclude_candidate_id": 5}
    with TestClient(app) as client:
        anonymous = client.post("/recruitment/candidates/check-duplicates", json=payload)
        assert anonymous.status_code == 401
        service.check_candidate_duplicates.assert_not_called()
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post("/recruitment/candidates/check-duplicates", headers=headers, json=payload)
        legacy = client.get("/recruitment/candidates/check-duplicates", headers=headers,
                            params={"phone": payload["phone"], "exclude_candidate_id": 5})
        assert response.status_code == legacy.status_code == 200
        assert response.json() == legacy.json()
    service.check_candidate_duplicates.assert_called_with(**payload)


def test_json_recovery_log_excludes_sensitive_values_but_keeps_original_error_evidence(caplog):
    marker = "SYNTHETIC_PRIVATE_7@example.invalid"
    error = RecruitmentAIJSONParseError(marker, raw_response_text=marker,
                                       provider_payload={"resume": marker}, debug_meta={"request": marker})
    _log_strict_json_recovery_context(task_type="screening", exc=error,
                                     prompt_snapshot=marker, full_request_snapshot=marker)
    assert marker not in caplog.text
    assert "STRICT_JSON_RECOVERY" in caplog.text
    assert "json_parse_failed" in caplog.text
    assert error.raw_response_text == marker
    assert error.provider_payload == {"resume": marker}
