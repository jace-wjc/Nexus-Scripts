#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

on_error() {
    local exit_code=$?
    echo "===================================" >&2
    echo "  部署失败，已停止后续操作（退出码：${exit_code}）" >&2
    echo "===================================" >&2
    exit "$exit_code"
}

trap on_error ERR

if [[ -n "$(git status --porcelain)" ]]; then
    echo "工作区存在未提交内容；部署已停止，请先确认发布版本。" >&2
    exit 1
fi

# First adoption must preserve files that only exist in an old container layer.
# Set this acknowledgement only after copying and verifying those files.
if [[ "${PERSISTENCE_MIGRATION_CONFIRMED:-0}" != "1" ]]; then
    if [[ -n "$(docker compose ps -a -q frontend)" ]]; then
        if ! docker compose exec -T frontend node -e \
          "const fs=require('fs');if(!process.env.RESOURCE_LOGO_ROOT&&['team-logos','ai-logos'].some(d=>fs.existsSync('public/'+d)&&fs.readdirSync('public/'+d).length))process.exit(1)"; then
            echo "旧前端 Logo 尚未确认迁移，或容器无法检查；停止重建。请先按运行说明复制并核对文件。" >&2
            exit 1
        fi
    fi
    if [[ -n "$(docker compose ps -a -q fastapi)" ]]; then
        if ! docker compose exec -T fastapi python -c \
          "import os; from pathlib import Path; raise SystemExit(int(not os.getenv('TEAM_RESOURCES_BACKUP_DIR') and Path('/my-app/data/team-resources.enc.json').exists()))"; then
            echo "旧资源备份尚未确认迁移，或容器无法检查；停止重建。请先按运行说明复制并核对文件。" >&2
            exit 1
        fi
    fi
fi

echo "==================================="
echo "  正在拉取最新代码..."
echo "==================================="
git pull --ff-only
export GIT_COMMIT="$(git rev-parse HEAD)"
export BUILD_VERSION="${BUILD_VERSION:-${GIT_COMMIT:0:12}}"

export BUILDKIT_PROGRESS="${BUILDKIT_PROGRESS:-plain}"

echo
echo "==================================="
echo "  正在构建服务镜像..."
echo "==================================="
if [[ "${DEPLOY_NO_CACHE:-0}" == "1" ]]; then
    echo "前端将忽略旧缓存重新构建；FastAPI 仍使用正常缓存。"
    docker compose build --no-cache frontend
else
    docker compose build frontend
fi
docker compose build fastapi

echo
echo "==================================="
echo "  正在更新服务容器..."
echo "==================================="
docker compose up -d --no-build --force-recreate --wait --wait-timeout "${DEPLOY_WAIT_SECONDS:-300}" frontend fastapi nginx

# These read-only checks do not initialize data or trigger recruitment tasks.
curl --fail --silent --show-error --max-time 10 "${DEPLOY_SMOKE_BASE_URL:-http://127.0.0.1:8090}/api/health/ready" >/dev/null
docker compose exec -T -e EXPECTED_COMMIT="$GIT_COMMIT" frontend node -e \
  "fetch('http://127.0.0.1:3000/api/system/version').then(async r=>{if(!r.ok)throw Error('Version endpoint unavailable');const v=await r.json();if(v.commitSha!==process.env.EXPECTED_COMMIT)throw Error('Frontend commit mismatch')}).catch(e=>{console.error(e.message);process.exit(1)})"

echo
docker compose ps

echo
echo "==================================="
echo "  容器健康、只读就绪检查和前端版本核对通过；请继续业务验收"
echo "==================================="
