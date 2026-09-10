"""Run SQLite/unit checks in a source-only copy with synthetic configuration.

Usage: venv/bin/python scripts/run_isolated_tests.py tests/ -p no:randomly -q -W error::Warning
The printed snapshot directory retains pytest output for comparison. No business
data, environment files or credentials are copied. MySQL uses a separate gate.
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile


def main() -> int:
    args = sys.argv[1:]
    mysql = "--mysql" in args
    if mysql:
        args.remove("--mysql")
        required = ("HOST", "PORT", "USER", "PASSWORD", "DATABASE")
        mysql_config = {key: os.environ.get(f"DB_LOCAL_{key}", "") for key in required}
        if (os.environ.get("NEXUS_MYSQL_TEST_ISOLATED") != "1"
                or not all(mysql_config.values())
                or mysql_config["HOST"] not in {"127.0.0.1", "localhost", "::1"}
                or not mysql_config["DATABASE"].startswith("nexus_gate_")):
            raise SystemExit("MySQL gate requires explicit NEXUS_MYSQL_TEST_ISOLATED=1, loopback DB_LOCAL_* and a dedicated nexus_gate_* database; .env fallback is forbidden")
    repository = Path(__file__).resolve().parents[2]
    snapshot = Path(tempfile.mkdtemp(prefix="nexus-unit-"))
    excluded = {".git", ".next", "node_modules", "venv", ".venv", "__pycache__",
                ".pytest_cache", "data", "uploads", "outputs", "logs", ".codex", ".agents"}
    extensions = {".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".yml",
                  ".yaml", ".toml", ".ini", ".cfg", ".sh", ".conf"}
    roots = [repository / "fastApiProject" / name for name in ("app", "tests", "scripts", "migrations")]
    roots.extend([repository / "my-app" / "src", repository / "my-app" / "tests", repository / "nginx"])
    for root in roots:
        for directory, children, files in os.walk(root, followlinks=False):
            children[:] = [name for name in children if name not in excluded and not (Path(directory) / name).is_symlink()]
            for name in files:
                source = Path(directory) / name
                if source.is_symlink() or name.startswith(".env") or source.suffix not in extensions:
                    continue
                destination = snapshot / source.relative_to(repository)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
    for relative in ("bootstrap_resources_recruitment.py", "bootstrap_local_mysql_data.py", "my-app/package.json", "my-app/next.config.ts", "fastApiProject/run.py", "deploy.sh"):
        source = repository / relative
        if source.is_file():
            shutil.copy2(source, snapshot / relative)

    environment = {name: os.environ[name] for name in ("PATH", "LANG", "LC_ALL", "SYSTEMROOT") if name in os.environ}
    environment.update({"ENVIRONMENT": "local", "NEXUS_TEST_ISOLATED": "1",
                        "PYTHONDONTWRITEBYTECODE": "1", "PYTHON_DOTENV_DISABLED": "1",
                        "SCRIPT_HUB_SESSION_SECRET": "isolated-session-secret",
                        "TEAM_RESOURCES_PASSWORD_ENCRYPTION_KEY": "isolated-password-key",
                        "TEAM_RESOURCES_EXPORT_ENCRYPTION_KEY": "isolated-export-key"})
    for mode in ("LOCAL", "TEST", "PROD"):
        for key, value in {"HOST": "127.0.0.1", "PORT": "1", "USER": "isolated", "PASSWORD": "isolated",
                           "DATABASE": "nexus_unit_only"}.items():
            environment[f"DB_{mode}_{key}"] = value
    working = snapshot / "fastApiProject"
    (working / "static").mkdir(exist_ok=True)
    environment["PYTHONPATH"] = str(working / "tests") + os.pathsep + str(working)
    toolchain = os.environ.get("NEXUS_TEST_TOOLCHAIN")
    if toolchain:
        environment["PYTHONPATH"] = str(Path(toolchain).resolve()) + os.pathsep + environment["PYTHONPATH"]
    args = args or ["tests/", "-p", "no:randomly", "-q", "-W", "error::Warning"]
    if mysql:
        environment.update({f"DB_LOCAL_{key}": value for key, value in mysql_config.items()})
        environment["RECRUITMENT_MYSQL_VALIDATION"] = "1"
        environment["NEXUS_MYSQL_TEST_ISOLATED"] = "1"
    command = [sys.executable, "-m", "pytest", "-p", "isolated_network", *args]
    print(f"Isolated source and results: {snapshot}", flush=True)
    print(f"Interpreter: {sys.executable}; pytest arguments: {args}", flush=True)
    if mysql:
        migration = "import isolated_network; isolated_network.pytest_configure(); from app.schema_maintenance import ensure_recruitment_schema; ensure_recruitment_schema()"
        for attempt in (1, 2):
            print(f"Isolated MySQL schema pass {attempt}/2 (independent process)", flush=True)
            result = subprocess.run([sys.executable, "-c", migration], cwd=working, env=environment)
            if result.returncode:
                return result.returncode
    with (snapshot / "pytest.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(command, cwd=working, env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True)
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
            log.write(line)
        process.stdout.close()
        return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
