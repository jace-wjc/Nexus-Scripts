"""Exercise the CLI without importing the application or starting its lifecycle."""
from pathlib import Path
import runpy
import sys
from types import ModuleType
from unittest.mock import Mock

import pytest


@pytest.mark.parametrize("arguments, timeout", [([], 30), (["--graceful-timeout", "0"], 0), (["--graceful-timeout", "5", "--reload"], 5)])
def test_cli_passes_bounded_shutdown_to_uvicorn(monkeypatch, arguments, timeout):
    fake_uvicorn = ModuleType("uvicorn")
    fake_uvicorn.run = Mock()
    monkeypatch.setitem(sys.modules, "uvicorn", fake_uvicorn)
    # The reloader parent must not import or initialize the real application.
    monkeypatch.setitem(sys.modules, "app.main", None)
    monkeypatch.setattr(sys, "argv", ["run.py", *arguments])
    runpy.run_path(str(Path(__file__).resolve().parents[1] / "run.py"), run_name="__main__")
    fake_uvicorn.run.assert_called_once_with(
        "app.main:app", host="0.0.0.0", port=8000,
        reload="--reload" in arguments, timeout_graceful_shutdown=timeout,
    )


def test_cli_rejects_negative_shutdown_timeout_before_starting(monkeypatch):
    fake_uvicorn = ModuleType("uvicorn")
    fake_uvicorn.run = Mock()
    monkeypatch.setitem(sys.modules, "uvicorn", fake_uvicorn)
    monkeypatch.setattr(sys, "argv", ["run.py", "--graceful-timeout", "-1"])
    with pytest.raises(SystemExit) as error:
        runpy.run_path(str(Path(__file__).resolve().parents[1] / "run.py"), run_name="__main__")
    assert error.value.code == 2
    fake_uvicorn.run.assert_not_called()
