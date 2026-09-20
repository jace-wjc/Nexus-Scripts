from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.responses import JSONResponse
from sqlalchemy import text
import logging
import asyncio
import os
import sys
import time
import uuid

from . import config
from .services.monitoring_service import check_and_alert
from .config import settings
from .database import SessionLocal
from .schema_maintenance import ensure_recruitment_schema, ensure_script_hub_schema
from .routers import (
    ai_resources_router,
    auth_router,
    business_core_router,
    mobile_sms_router,
    monitoring_router,
    rbac_router,
    recruitment_router,
    tax_tools_router,
    team_resources_router,
    workbench_router,
    settlement_sim_router,
)
from .routers.recruitment import recover_orphaned_tasks_on_startup
from .services.recruitment_service import RecruitmentService
from .services.match_scheduler import key_rotator, scheduler

# 配置日志。Gunicorn/Uvicorn 可能已提前安装 handler，basicConfig 会直接跳过；
# 这里显式同步 root/handler 级别，保证容器里也能看到应用 INFO 日志。
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(message)s"


def _configure_app_logging() -> None:
    raw_level = (os.getenv("APP_LOG_LEVEL") or "INFO").strip().upper()
    level = getattr(logging, raw_level, logging.INFO)
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(level=level, format=LOG_FORMAT)
    else:
        root_logger.setLevel(level)
        formatter = logging.Formatter(LOG_FORMAT)
        for handler in root_logger.handlers:
            handler.setLevel(level)
            if handler.formatter is None:
                handler.setFormatter(formatter)
    logging.getLogger("httpx").setLevel(level)


_configure_app_logging()
logger = logging.getLogger(__name__)
APP_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = APP_ROOT / "static"


@asynccontextmanager
async def application_lifespan(application: FastAPI):
    application.state.recruitment_ready = False
    application.state.background_tasks = []
    try:
        await startup_event()
        application.state.recruitment_ready = True
        yield
    finally:
        application.state.recruitment_ready = False
        tasks = application.state.background_tasks
        for task in tasks:
            task.cancel()
        try:
            await scheduler.stop()
        finally:
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)


# 创建FastAPI应用
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    description=settings.DESCRIPTION,
    # 关闭默认的docs和redoc，使用自定义路由
    docs_url=None,
    redoc_url=None,
    lifespan=application_lifespan,
)


@app.get("/health/live", include_in_schema=False)
def health_live():
    return {"status": "alive"}


@app.get("/health/ready", include_in_schema=False)
def health_ready():
    if not getattr(app.state, "recruitment_ready", False) or not scheduler.running:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return {"status": "ready"}


def _request_timing_log_enabled() -> bool:
    value = (os.getenv("REQUEST_TIMING_LOG_ENABLED") or "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _request_timing_prefixes() -> tuple[str, ...]:
    raw = os.getenv("REQUEST_TIMING_LOG_PREFIXES") or "/recruitment,/auth/session"
    return tuple(prefix.strip().rstrip("/") for prefix in raw.split(",") if prefix.strip())


def _should_log_request_timing(path: str) -> bool:
    if not _request_timing_log_enabled():
        return False
    prefixes = _request_timing_prefixes()
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in prefixes)


def _request_query_keys(request: Request) -> list[str]:
    return sorted(set(request.query_params.keys()))


@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    path = request.url.path
    if not _should_log_request_timing(path):
        return await call_next(request)

    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    started_at = time.perf_counter()
    client = request.client.host if request.client else "-"
    query_keys = _request_query_keys(request)
    status_code = 500
    error_name = None

    logger.info(
        "[request-timing] start request_id=%s method=%s path=%s query_keys=%s client=%s pid=%s",
        request_id,
        request.method,
        path,
        query_keys,
        client,
        os.getpid(),
    )

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as exc:
        error_name = type(exc).__name__
        logger.exception(
            "[request-timing] exception request_id=%s method=%s path=%s error=%s",
            request_id,
            request.method,
            path,
            error_name,
        )
        raise
    finally:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[request-timing] finish request_id=%s method=%s path=%s status=%s duration_ms=%s error=%s",
            request_id,
            request.method,
            path,
            status_code,
            duration_ms,
            error_name,
        )


def _resume_recruitment_screening_queue() -> None:
    ensure_recruitment_schema()
    db = SessionLocal()
    try:
        service = RecruitmentService(db)
        result = service.resume_screening_queue_on_startup()
        logger.info(
            "Recruitment screening queue resume finished: requeued=%s dispatched=%s active=%s",
            result.get("requeued_count", 0),
            result.get("dispatch", {}).get("started_count", 0) if isinstance(result.get("dispatch"), dict) else 0,
            result.get("dispatch", {}).get("active_count", 0) if isinstance(result.get("dispatch"), dict) else 0,
        )
    finally:
        db.close()


async def _init_match_scheduler() -> None:
    """从DB加载LLM key配置，初始化匹配调度器并启动worker"""
    from .services.match_scheduler import load_match_key_configs
    db = SessionLocal()
    try:
        key_configs = load_match_key_configs(db)
        key_rotator.reload(key_configs)
        await scheduler.start()
        logger.info("Match scheduler initialized: %d keys, %d workers",
                     len(key_configs), scheduler.stats().get("worker_count", 0))
    except Exception as exc:
        logger.error("Failed to init match scheduler: %s", exc, exc_info=True)
        raise
    finally:
        db.close()


def _warmup_recruitment_pdf_ocr() -> None:
    if sys.platform == "darwin":
        logger.info("Recruitment PDF OCR warmup skipped on macOS; Vision OCR is used on demand")
        return
    try:
        from .ocr_service import warmup_ocr_engine

        logger.info(
            "Recruitment PDF OCR warmup started max_pages=%s render_scale=%s",
            os.getenv("RECRUITMENT_PDF_OCR_MAX_PAGES", "1"),
            os.getenv("RECRUITMENT_PDF_OCR_RENDER_SCALE", "2"),
        )
        warmup_ocr_engine()
        logger.info("Recruitment PDF OCR warmup finished")
    except Exception as exc:
        logger.warning("Recruitment PDF OCR warmup skipped or failed: %s", exc, exc_info=True)


async def startup_event():
    """启动时初始化"""
    # 招聘模块的事件总线/匹配调度器/限流器均为进程内单例，多 worker 部署会导致
    # SSE 丢事件、匹配恢复互踩、模型限流超发。扩容前必须先外部化这些状态，
    # 因此默认 fail-fast 拒绝多 worker 启动；确需临时放开需显式设置
    # RECRUITMENT_ALLOW_MULTIPROCESS=1（自担风险）。
    try:
        web_concurrency = int(str(os.getenv("WEB_CONCURRENCY", "1") or "1").strip())
    except (TypeError, ValueError):
        web_concurrency = 1
    allow_multiprocess = str(os.getenv("RECRUITMENT_ALLOW_MULTIPROCESS", "0") or "0").strip() == "1"
    if web_concurrency > 1 and not allow_multiprocess:
        raise RuntimeError(
            f"WEB_CONCURRENCY={web_concurrency} > 1：招聘模块的队列/SSE/限流为进程内状态，"
            "多 worker 会导致重复调度、限流超发与 SSE 丢事件。请将 WEB_CONCURRENCY 降回 1；"
            "在完成队列/事件/限流外部化前如确需放开，显式设置 RECRUITMENT_ALLOW_MULTIPROCESS=1。"
        )
    if web_concurrency > 1 and allow_multiprocess:
        logger.warning(
            "WEB_CONCURRENCY=%s > 1 且 RECRUITMENT_ALLOW_MULTIPROCESS=1：已放开多进程限制，"
            "但 SSE 丢事件与模型限流超发风险仍在，请尽快完成状态外部化。",
            web_concurrency,
        )
    try:
        await run_in_threadpool(ensure_script_hub_schema)
        await recover_orphaned_tasks_on_startup()
        await run_in_threadpool(_resume_recruitment_screening_queue)
        await _init_match_scheduler()
    except Exception as exc:
        logger.error("Failed to initialize schemas or recruitment queue on startup: %s", exc, exc_info=True)
        raise
    logger.info("Starting background tasks...")
    app.state.background_tasks.append(asyncio.create_task(background_monitoring_loop()))
    if os.getenv("RECRUITMENT_PRELOAD_PDF_OCR", "1").strip() != "0":
        app.state.background_tasks.append(asyncio.create_task(asyncio.to_thread(_warmup_recruitment_pdf_ocr)))

async def background_monitoring_loop():
    """后台监控循环"""
    while True:
        try:
            # 首次启动等待 10 秒
            await asyncio.sleep(10)
            await check_and_alert()
        except Exception as e:
            logger.error(f"Error in monitoring loop: {e}")
        # 每 1 小时检查一次
        await asyncio.sleep(3600)


# 挂载静态文件目录（关键：让FastAPI能访问本地资源）
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 配置CORS（保持不变）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_origin_regex=settings.cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(rbac_router)
app.include_router(monitoring_router)
app.include_router(ai_resources_router)
app.include_router(team_resources_router)
app.include_router(business_core_router)
app.include_router(tax_tools_router)
app.include_router(mobile_sms_router)
app.include_router(recruitment_router)
app.include_router(workbench_router)
app.include_router(settlement_sim_router)


# 自定义Swagger UI路由（使用本地资源）
@app.get("/docs", include_in_schema=False, tags=["文档"])
async def custom_swagger_ui():
    return get_swagger_ui_html(
        openapi_url="/openapi.json",  # 指向自动生成的API规范
        title="春苗系统结算API - 文档",
        # 本地资源路径（对应static/swagger目录下的文件）
        swagger_js_url="/static/swagger/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger/swagger-ui.css",
        swagger_favicon_url="",  # 可选：移除favicon避免额外请求
    )


# 自定义ReDoc路由（可选，如需修复redoc空白页）
from fastapi.openapi.docs import get_redoc_html


@app.get("/redoc", include_in_schema=False, tags=["文档"])
async def custom_redoc_ui():
    return get_redoc_html(
        openapi_url="/openapi.json",
        title="春苗系统结算API - ReDoc",
        redoc_js_url="/static/swagger/redoc.standalone.js",  # 需提前下载redoc文件
    )
