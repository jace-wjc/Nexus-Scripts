"""Run a copied deployment script against synthetic git/docker/curl executables."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


@pytest.fixture
def run_deploy(tmp_path):
    script = tmp_path / "deploy.sh"
    shutil.copyfile(Path(__file__).resolve().parents[2] / "deploy.sh", script)
    binaries = tmp_path / "bin"
    binaries.mkdir()
    driver = '''
import json, os, sys
from pathlib import Path
name, args = Path(sys.argv[0]).name, sys.argv[1:]
with open(os.environ["SYNTHETIC_COMMAND_LOG"], "a") as log:
    log.write(json.dumps([name, *args]) + "\\n")
case = os.environ["SYNTHETIC_CASE"]
if name == "git":
    if args == ["status", "--porcelain"] and case == "dirty": print(" M user-owned.txt")
    if args == ["rev-parse", "HEAD"]: print("synthetic-commit")
elif name == "docker":
    if args[:5] == ["compose", "ps", "-a", "-q", "frontend"] and case == "old_logo": print("old-frontend")
    if args[:5] == ["compose", "ps", "-a", "-q", "fastapi"] and case == "old_backup": print("old-backend")
    if args[:3] == ["compose", "exec", "-T"]:
        if case in {"old_logo", "old_backup", "version_failure"}: sys.exit(1)
    if args[:2] == ["compose", "up"] and case == "health_failure": sys.exit(1)
elif name == "curl" and case == "proxy_failure": sys.exit(22)
'''
    for name in ("git", "docker", "curl"):
        executable = binaries / name
        executable.write_text(f"#!{sys.executable}\n" + driver)
        executable.chmod(0o700)

    def run(case):
        log = tmp_path / "commands.jsonl"
        environment = {"PATH": str(binaries) + os.pathsep + os.defpath,
                       "SYNTHETIC_COMMAND_LOG": str(log), "SYNTHETIC_CASE": case}
        result = subprocess.run(["/bin/bash", str(script)], cwd=tmp_path, env=environment,
                                capture_output=True, text=True, timeout=15)
        return result, [json.loads(line) for line in log.read_text().splitlines()]
    return run


@pytest.mark.parametrize("case", ["dirty", "old_logo", "old_backup"])
def test_preflight_failure_prevents_pull_and_rebuild(run_deploy, case):
    result, calls = run_deploy(case)
    assert result.returncode != 0
    assert not any(call[:2] == ["git", "pull"] for call in calls)
    assert not any(call[:3] in (["docker", "compose", "build"], ["docker", "compose", "up"]) for call in calls)
    assert "容器健康、只读就绪检查和前端版本核对通过" not in result.stdout


@pytest.mark.parametrize("case", ["health_failure", "proxy_failure", "version_failure"])
def test_failed_health_or_version_is_not_reported_as_success(run_deploy, case):
    result, calls = run_deploy(case)
    assert result.returncode != 0
    assert "容器健康、只读就绪检查和前端版本核对通过" not in result.stdout
    if case == "health_failure":
        assert not any(call[0] == "curl" for call in calls)
    if case == "proxy_failure":
        assert not any("EXPECTED_COMMIT=synthetic-commit" in call for call in calls)


def test_success_requires_wait_proxy_readiness_and_exact_frontend_commit(run_deploy):
    result, calls = run_deploy("healthy")
    assert result.returncode == 0, result.stderr
    up_index = next(i for i, call in enumerate(calls) if call[:3] == ["docker", "compose", "up"])
    assert "--wait" in calls[up_index]
    proxy_index = next(i for i, call in enumerate(calls) if call[0] == "curl")
    assert "http://127.0.0.1:8090/api/health/ready" in calls[proxy_index]
    version_index = next(i for i, call in enumerate(calls) if "EXPECTED_COMMIT=synthetic-commit" in call)
    assert up_index < proxy_index < version_index
    assert "请继续业务验收" in result.stdout
