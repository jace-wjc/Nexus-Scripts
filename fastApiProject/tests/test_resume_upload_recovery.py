import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.recruitment_models import RecruitmentCandidate, RecruitmentResumeFile
from app.services import recruitment_service_impl as implementation
from app.routers import recruitment
from app.script_hub_session import create_script_hub_session


@pytest.fixture
def upload_service(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    monkeypatch.setattr(implementation, "RECRUITMENT_UPLOAD_ROOT", tmp_path)
    try:
        yield implementation.RecruitmentService(session), tmp_path
    finally:
        session.close()
        engine.dispose()


def upload(service, *names, strategy="skip"):
    return service.upload_resume_files(
        [{"file_name": name, "content": b"synthetic resume", "file_index": index} for index, name in enumerate(names)],
        None, "synthetic-uploader", match_mode="none", duplicate_strategy=strategy,
    )


def test_failed_middle_item_preserves_successes_and_removes_only_its_new_file(upload_service, monkeypatch):
    service, root = upload_service
    serialize = service._serialize_candidate_summary
    def fail_second(candidate):
        if candidate.source_detail == "failed.pdf":
            raise RuntimeError("synthetic serialization failure before commit")
        return serialize(candidate)
    monkeypatch.setattr(service, "_serialize_candidate_summary", fail_second)
    rows = upload(service, "first.pdf", "failed.pdf", "third.pdf")
    assert [row["upload_status"] for row in rows] == ["uploaded", "failed", "uploaded"]
    assert [row["file_index"] for row in rows] == [0, 1, 2]
    assert rows[1]["retryable"] is True
    candidates = service.db.query(RecruitmentCandidate).all()
    resumes = service.db.query(RecruitmentResumeFile).all()
    assert {row.source_detail for row in candidates} == {"first.pdf", "third.pdf"}
    assert len(resumes) == len(list(root.rglob("*.pdf"))) == 2
    for candidate in candidates:
        resume = next(row for row in resumes if row.id == candidate.latest_resume_file_id)
        assert resume.candidate_id == candidate.id
        assert resume.org_code == candidate.org_code
        assert (root / resume.storage_path).read_bytes() == b"synthetic resume"
    monkeypatch.setattr(service, "_serialize_candidate_summary", serialize)
    retry = upload(service, "failed.pdf")
    assert retry[0]["upload_status"] == "uploaded"
    assert service.db.query(RecruitmentCandidate).count() == 3


@pytest.mark.parametrize("committed", [False, True])
def test_lost_commit_response_is_unknown_and_never_deletes_possibly_committed_file(upload_service, monkeypatch, committed):
    service, root = upload_service
    commit = service.db.commit
    calls = 0
    def uncertain_commit():
        nonlocal calls
        calls += 1
        if calls == 2:
            if committed:
                commit()
            raise RuntimeError("synthetic lost commit response")
        commit()
    monkeypatch.setattr(service.db, "commit", uncertain_commit)
    rows = upload(service, "first.pdf", "uncertain.pdf", "third.pdf")
    assert [row["upload_status"] for row in rows] == ["uploaded", "unknown", "uploaded"]
    assert rows[1]["retryable"] is False
    assert service.db.query(RecruitmentCandidate).count() == (3 if committed else 2)
    assert len(list(root.rglob("*.pdf"))) == 3
    for resume in service.db.query(RecruitmentResumeFile):
        assert (root / resume.storage_path).is_file()


def test_failed_overwrite_preserves_old_resume_pointer_and_business_state(upload_service, monkeypatch):
    service, root = upload_service
    original = upload(service, "existing.pdf")[0]
    candidate = service.db.get(RecruitmentCandidate, original["id"])
    candidate.status = "interview_passed"
    candidate.name = "synthetic manual identity"
    service.db.commit()
    old_resume = service.db.get(RecruitmentResumeFile, candidate.latest_resume_file_id)
    old_path = root / old_resume.storage_path
    old_bytes = old_path.read_bytes()
    old_id = old_resume.id
    monkeypatch.setattr(service, "_serialize_candidate_summary", lambda row: (_ for _ in ()).throw(RuntimeError("synthetic failure")))
    result = upload(service, "existing.pdf", strategy="overwrite")[0]
    assert result["upload_status"] == "failed"
    service.db.expire_all()
    assert candidate.latest_resume_file_id == old_id
    assert candidate.status == "interview_passed"
    assert candidate.name == "synthetic manual identity"
    assert old_path.read_bytes() == old_bytes
    assert service.db.query(RecruitmentResumeFile).count() == 1
    assert len(list(root.rglob("*.pdf"))) == 1


def test_missing_staged_file_does_not_discard_later_valid_item(upload_service):
    service, root = upload_service
    rows = service.upload_resume_files([
        {"file_name": "missing.pdf", "staged_path": str(root / "missing")},
        {"file_name": "later.pdf", "content": b"synthetic"},
    ], None, "synthetic-uploader", match_mode="none")
    assert [row["upload_status"] for row in rows] == ["failed", "uploaded"]
    assert service.db.query(RecruitmentCandidate).count() == 1


def test_route_returns_file_results_and_keeps_successful_items_compatible(upload_service, monkeypatch):
    service, root = upload_service
    monkeypatch.setattr(recruitment, "RECRUITMENT_UPLOAD_ROOT", root)
    monkeypatch.setattr(recruitment, "write_audit_log", lambda **kwargs: None)
    app = FastAPI()
    app.include_router(recruitment.recruitment_router)
    app.dependency_overrides[recruitment.get_recruitment_service] = lambda: service
    token = create_script_hub_session({"id": "synthetic", "permissions": {"recruitment-candidate-manage": True}})["token"]
    with TestClient(app) as client:
        response = client.post("/recruitment/candidates/upload-resumes?match_mode=none", headers={"Authorization": f"Bearer {token}"},
                               files=[("files", ("invalid.txt", b"synthetic")), ("files", ("valid.pdf", b"synthetic"))])
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    data = payload["data"]
    assert data["uploaded_count"] == len(data["items"]) == 1
    assert data["failed_count"] == 1
    assert data["unknown_count"] == 0
    assert [row["status"] for row in data["file_results"]] == ["failed", "uploaded"]
    assert data["items"][0]["id"] == data["file_results"][1]["candidate_id"]
    assert not list((root / "_staging").iterdir())


def test_dispatch_failure_does_not_turn_saved_upload_into_a_request_failure(upload_service, monkeypatch):
    service, root = upload_service
    monkeypatch.setattr(recruitment, "RECRUITMENT_UPLOAD_ROOT", root)
    monkeypatch.setattr(recruitment, "write_audit_log", lambda **kwargs: None)
    def save(*args, **kwargs):
        return [{"id": 1, "file_index": 0, "file_name": "synthetic.pdf", "upload_status": "uploaded",
                 "latest_resume_file_id": 2, "auto_screen_enabled": True}]
    monkeypatch.setattr(service, "upload_resume_files", save)
    monkeypatch.setattr(service, "enqueue_screen_candidate", lambda *args, **kwargs: {"task_id": 3, "status": "queued"})
    def dispatch():
        raise RuntimeError("synthetic dispatch outage")
    monkeypatch.setattr(service, "process_next_screening_task", dispatch)
    app = FastAPI()
    app.include_router(recruitment.recruitment_router)
    app.dependency_overrides[recruitment.get_recruitment_service] = lambda: service
    token = create_script_hub_session({"id": "synthetic", "permissions": {"recruitment-candidate-manage": True}})["token"]
    with TestClient(app) as client:
        response = client.post("/recruitment/candidates/upload-resumes?match_mode=none", headers={"Authorization": f"Bearer {token}"},
                               files=[("files", ("synthetic.pdf", b"synthetic"))])
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["uploaded_count"] == 1
    assert data["auto_screen_queued_count"] == 1
    assert data["auto_screen_dispatch_pending"] is True
    assert data["failed_count"] == 0
