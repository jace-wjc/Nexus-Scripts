"""Storage path checks shared by directory uploads; no filesystem writes."""
from pathlib import Path, PurePosixPath, PureWindowsPath


def safe_upload_relative_path(filename: str) -> Path:
    normalized = filename.replace("\\", "/")
    parts = normalized.split("/")
    if (not normalized or "\x00" in normalized or PurePosixPath(normalized).is_absolute()
            or PureWindowsPath(normalized).drive or any(part in {"", ".", ".."} for part in parts)):
        raise ValueError("Invalid upload path")
    return Path(*parts)


def safe_upload_destination(root: Path, filename: str) -> Path:
    destination = (root / safe_upload_relative_path(filename)).resolve()
    if not destination.is_relative_to(root.resolve()):
        raise ValueError("Upload path escapes storage directory")
    return destination
