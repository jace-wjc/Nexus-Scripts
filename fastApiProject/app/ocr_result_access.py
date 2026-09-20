"""Persist ownership for newly created OCR files without rewriting legacy files."""
import hashlib
import json
import os
from pathlib import Path
from typing import Mapping
import uuid

from fastapi import HTTPException

from .upload_paths import safe_upload_destination


def is_ocr_administrator(session: Mapping[str, object]) -> bool:
    # Same unbounded-admin definition as Script Hub's existing grant boundary.
    roles = session.get("roles")
    return bool(session.get("isSuperAdmin")) or (isinstance(roles, (list, tuple, set)) and "admin" in roles)


def result_path(root: Path, filename: str) -> Path:
    if Path(filename).name != filename or Path(filename).suffix.lower() not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=404, detail="ocr_result_not_found")
    try:
        return safe_upload_destination(root, filename)
    except ValueError:
        raise HTTPException(status_code=404, detail="ocr_result_not_found") from None


def _metadata_path(root: Path, kind: str, key: str) -> Path:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return safe_upload_destination(root, f".access/{kind}/{digest}.json")


def register_owner(root: Path, kind: str, key: str, session: Mapping[str, object]) -> None:
    owner_id = str(session.get("id") or "")
    if not owner_id:
        raise HTTPException(status_code=403, detail="ocr_owner_required")
    destination = _metadata_path(root, kind, key)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name(f".{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            os.chmod(temporary, 0o600)
            json.dump({"owner_id": owner_id}, output)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            # A concurrent job cannot steal an already reserved output name.
            require_owner(root, kind, key, session)
    finally:
        temporary.unlink(missing_ok=True)


def require_owner(root: Path, kind: str, key: str, session: Mapping[str, object]) -> None:
    if is_ocr_administrator(session):
        return
    try:
        record = json.loads(_metadata_path(root, kind, key).read_text(encoding="utf-8"))
    except FileNotFoundError:
        # Historical files have no inferred owner: only the existing admin can read them.
        raise HTTPException(status_code=403, detail="ocr_result_forbidden") from None
    except (OSError, ValueError):
        raise HTTPException(status_code=503, detail="ocr_access_unavailable") from None
    if not isinstance(record, dict) or not session.get("id") or record.get("owner_id") != str(session["id"]):
        raise HTTPException(status_code=403, detail="ocr_result_forbidden")
