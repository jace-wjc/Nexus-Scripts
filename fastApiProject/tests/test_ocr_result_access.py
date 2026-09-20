import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.ocr_result_access import register_owner
from app.routers import workbench
from app.script_hub_session import create_script_hub_session


@pytest.fixture
def ocr_app(tmp_path, monkeypatch):
    monkeypatch.setattr(workbench, "OUTPUTS_DIR", str(tmp_path))
    monkeypatch.setattr(workbench, "write_audit_log", lambda *args, **kwargs: None)
    app = FastAPI()
    app.include_router(workbench.workbench_router)
    app.dependency_overrides[workbench.get_db] = lambda: SimpleNamespace()
    return app, tmp_path


def headers(user="creator", **fields):
    payload = {"id": user, "permissions": {"ocr-tool": True}, **fields}
    return {"Authorization": "Bearer " + create_script_hub_session(payload)["token"]}


def test_result_access_requires_current_permission_and_durable_owner(ocr_app):
    app, root = ocr_app
    name = "new-result.xlsx"
    (root / name).write_bytes(b"synthetic result")
    register_owner(root, "results", name, {"id": "creator"})
    with TestClient(app) as client:
        assert client.get(f"/outputs/{name}").status_code == 401
        assert client.get(f"/outputs/{name}", headers=headers("creator", permissions={})).status_code == 403
        assert client.get(f"/outputs/{name}", headers=headers("other")).status_code == 403
        response = client.get(f"/outputs/{name}", headers=headers())
        assert response.status_code == 200
        assert response.content == b"synthetic result"
        assert response.headers["cache-control"] == "private, no-store"
        assert "attachment" in response.headers["content-disposition"]
    # A new app instance has no in-process owner state; the on-disk record suffices.
    restarted = FastAPI()
    restarted.include_router(workbench.workbench_router)
    with TestClient(restarted) as client:
        assert client.get(f"/outputs/{name}", headers=headers()).status_code == 200


def test_legacy_and_new_results_are_available_only_to_existing_admins_and_owner(ocr_app):
    app, root = ocr_app
    (root / "legacy.xlsx").write_bytes(b"synthetic historical data")
    (root / "new.xlsx").write_bytes(b"synthetic owned data")
    register_owner(root, "results", "new.xlsx", {"id": "creator"})
    before = (root / "legacy.xlsx").read_bytes()
    with TestClient(app) as client:
        assert client.get("/outputs/legacy.xlsx", headers=headers()).status_code == 403
        for admin in (headers("admin", isSuperAdmin=True), headers("admin", roles=["admin"])):
            assert client.get("/outputs/legacy.xlsx", headers=admin).status_code == 200
            assert client.get("/outputs/new.xlsx", headers=admin).status_code == 200
    assert (root / "legacy.xlsx").read_bytes() == before
    assert len(list((root / ".access" / "results").glob("*.json"))) == 1


def test_metadata_and_path_escape_are_never_downloadable(ocr_app):
    app, root = ocr_app
    outside = root.parent / "synthetic-outside.xlsx"
    outside.write_bytes(b"not public")
    (root / "link.xlsx").symlink_to(outside)
    with TestClient(app) as client:
        for path in (".access/results/owner.json", "link.xlsx", "%2e%2e%2fsynthetic-outside.xlsx"):
            assert client.get(f"/outputs/{path}", headers=headers("admin", isSuperAdmin=True)).status_code == 404


def test_new_job_cannot_take_ownership_of_reserved_output_name(ocr_app):
    _app, root = ocr_app
    register_owner(root, "results", "reserved.xlsx", {"id": "creator"})
    with pytest.raises(HTTPException) as error:
        register_owner(root, "results", "reserved.xlsx", {"id": "other"})
    assert error.value.status_code == 403


def test_corrupt_ownership_fails_closed_without_touching_result(ocr_app):
    app, root = ocr_app
    (root / "owned.xlsx").write_bytes(b"synthetic preserved result")
    register_owner(root, "results", "owned.xlsx", {"id": "creator"})
    next((root / ".access" / "results").glob("*.json")).write_text("{broken", encoding="utf-8")
    with TestClient(app) as client:
        assert client.get("/outputs/owned.xlsx", headers=headers()).status_code == 503
    assert (root / "owned.xlsx").read_bytes() == b"synthetic preserved result"


def test_local_mode_cannot_read_or_overwrite_another_owners_output(ocr_app, monkeypatch):
    app, root = ocr_app
    (root / "owned.xlsx").write_bytes(b"synthetic preserved result")
    register_owner(root, "results", "owned.xlsx", {"id": "creator"})
    process = Mock()
    monkeypatch.setattr(workbench, "run_ocr_process", process)
    base = {"excel_path": str(root.parent / "input.xlsx"), "source_folder": str(root.parent / "images"),
            "target_excel_path": str(root.parent / "target.xlsx"), "mode": 1}
    with TestClient(app) as client:
        for changes in ({"excel_path": str(root / "owned.xlsx")}, {"target_excel_path": str(root / "owned.xlsx")},
                        {"source_folder": str(root.parent)}):
            assert client.post("/ocr/process", headers=headers("other"), json={**base, **changes}).status_code == 403
    process.assert_not_called()
    assert (root / "owned.xlsx").read_bytes() == b"synthetic preserved result"


@pytest.mark.parametrize("success, aborted", [(True, False), (True, True), (False, False)])
def test_upload_emits_one_truthful_terminal_result_and_records_download_owner(ocr_app, monkeypatch, success, aborted):
    app, root = ocr_app
    def fake_ocr(**kwargs):
        yield json.dumps({"type": "init", "request_id": kwargs["request_id"]}) + "\n"
        Path(kwargs["target_excel_path"]).write_bytes(b"synthetic partial result")
        yield json.dumps({"type": "result", "success": success, "aborted": aborted, "message": "synthetic outcome"}) + "\n"
    monkeypatch.setattr(workbench, "run_ocr_process", fake_ocr)
    with TestClient(app) as client:
        response = client.post("/ocr/process-upload", headers=headers(), files=[
            ("excel_file", ("input.xlsx", b"synthetic")), ("image_files", ("folder/image.png", b"synthetic")),
        ])
        assert response.status_code == 200
        packets = [json.loads(line) for line in response.text.splitlines()]
        terminal = [packet for packet in packets if packet["type"] == "result"]
        assert len(terminal) == 1
        assert terminal[0]["success"] is success
        assert terminal[0]["aborted"] is aborted
        if success:
            download = "/" + terminal[0]["download_url"]
            assert client.get(download, headers=headers()).status_code == 200
            assert client.get(download, headers=headers("other")).status_code == 403
        else:
            assert "download_url" not in terminal[0]
        request_id = next(packet["request_id"] for packet in packets if packet["type"] == "init")
        cancel = Mock()
        monkeypatch.setattr(workbench, "set_abort_signal", cancel)
        assert client.post(f"/ocr/abort/{request_id}", headers=headers("other")).status_code == 403
        cancel.assert_not_called()
        assert client.post(f"/ocr/abort/{request_id}", headers=headers()).status_code == 200
        cancel.assert_called_once_with(request_id)


def test_main_application_has_no_public_outputs_static_mount():
    from app.main import app
    assert not any(getattr(route, "path", None) == "/outputs" and type(route).__name__ == "Mount" for route in app.routes)
