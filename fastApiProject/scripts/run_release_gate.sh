#!/usr/bin/env bash
# AI 初筛 Release Gate 一键执行：SQLite 全量（警告即错）+ 真实 MySQL 双会话验收。
# 本地用法（需全新专用本地 MySQL 验证库，绝不可指向业务库）：
#   DB_LOCAL_HOST=localhost DB_LOCAL_PORT=3306 DB_LOCAL_USER=root \
#   DB_LOCAL_PASSWORD=xxx DB_LOCAL_DATABASE=nexus_gate_local NEXUS_MYSQL_TEST_ISOLATED=1 \
#   bash scripts/run_release_gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON_BIN:-./venv/bin/python}"
if [ ! -x "$PY" ] && ! command -v "$PY" >/dev/null 2>&1; then
    echo "指定 Python 解释器不可用：$PY" >&2
    exit 1
fi

: "${NEXUS_MYSQL_TEST_ISOLATED:?需要显式隔离 MySQL 授权 NEXUS_MYSQL_TEST_ISOLATED=1}"
: "${DB_LOCAL_HOST:?需要 DB_LOCAL_HOST，不能使用 .env 回退}"
: "${DB_LOCAL_DATABASE:?需要专用 nexus_gate_* 数据库}"
: "${DB_LOCAL_PORT:?需要显式 DB_LOCAL_PORT}"
: "${DB_LOCAL_USER:?需要显式 DB_LOCAL_USER}"
: "${DB_LOCAL_PASSWORD:?需要显式 DB_LOCAL_PASSWORD}"
[[ "$NEXUS_MYSQL_TEST_ISOLATED" == "1" ]] || { echo "拒绝未隔离的 MySQL 配置" >&2; exit 1; }
case "$DB_LOCAL_HOST" in localhost|127.0.0.1|::1) ;; *) echo "仅允许本机隔离实例" >&2; exit 1;; esac
case "$DB_LOCAL_DATABASE" in nexus_gate_*) ;; *) echo "拒绝非专用验证库" >&2; exit 1;; esac
SEED="${RECRUITMENT_TEST_SEED:-20260910}"

echo "=== [1/3] SQLite 全量（固定顺序，警告即错） ==="
"$PY" scripts/run_isolated_tests.py tests/ -p no:randomly -q -W error::Warning

echo "=== [2/3] SQLite 全量（随机顺序，检测顺序依赖） ==="
"$PY" scripts/run_isolated_tests.py tests/ --randomly-seed="$SEED" -q -W error::Warning

echo "=== [3/3] 真实 MySQL 双会话验收（Release Gate） ==="
"$PY" scripts/run_isolated_tests.py --mysql tests/test_mysql_release_gate_validation.py -p no:randomly -q -W error::Warning

echo "=== RELEASE GATE: ALL PASSED ==="
