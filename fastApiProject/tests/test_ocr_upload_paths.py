from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.upload_paths import safe_upload_destination, safe_upload_relative_path
from app.routers import workbench
from app.script_hub_session import create_script_hub_session


@pytest.mark.parametrize("name", ["../outside.xlsx", "/tmp/outside.xlsx", "C:\\temp\\bad.png", "\\\\server\\share\\bad.png", "folder/../../bad.png", "a//b.png", "a/./b.png", "a\x00b"])
def test_unsafe_paths_are_rejected(name, tmp_path):
    with pytest.raises(ValueError): safe_upload_destination(tmp_path, name)
    assert list(tmp_path.iterdir()) == []


def test_nested_windows_and_chinese_names_are_preserved(tmp_path):
    assert safe_upload_relative_path("上传目录\\张三\\正面.png") == Path("上传目录/张三/正面.png")
    assert safe_upload_destination(tmp_path, "目录/证件.png") == tmp_path / "目录" / "证件.png"
    outside = tmp_path.parent / "external-synthetic"
    (tmp_path / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError): safe_upload_destination(tmp_path, "link/file.png")


@pytest.mark.parametrize("excel,image", [("../escape.xlsx", "folder/image.png"), ("input.xlsx", "folder/../escape.png")])
def test_ocr_rejects_traversal_before_audit_content_read_or_engine(monkeypatch, excel, image):
    def forbidden(*args, **kwargs): pytest.fail("Invalid path reached an operation with side effects")
    monkeypatch.setattr(workbench, "write_audit_log", forbidden)
    monkeypatch.setattr(workbench, "run_ocr_process", forbidden)
    app = FastAPI()
    app.include_router(workbench.workbench_router)
    app.dependency_overrides[workbench.get_db] = lambda: SimpleNamespace()
    token = create_script_hub_session({"id": "synthetic", "permissions": {"ocr-tool": True}})["token"]
    with TestClient(app) as client:
        response = client.post("/ocr/process-upload", headers={"Authorization": f"Bearer {token}"}, files=[
            ("excel_file", (excel, b"synthetic", "application/octet-stream")),
            ("image_files", (image, b"synthetic", "application/octet-stream")),
        ])
    assert response.status_code == 400
