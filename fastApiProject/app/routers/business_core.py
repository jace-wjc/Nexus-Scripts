import logging
import time as _time
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    BalanceVerificationRequest,
    BalanceVerificationResponse,
    BizSceneInitRequest,
    BizSceneTaskInitResponse,
    BizTaskInitRequest,
    CommissionCalculationRequest,
    CommissionCalculationResponse,
    DepartmentListRequest,
    EnterpriseListRequest,
    PaymentStatsRequest,
    PaymentStatsResponse,
    SettlementRequest,
    SettlementResponse,
)
from ..services import (
    AccountBalanceService,
    CommissionCalculationService,
    EnterpriseSettlementService,
    PaymentStatsService,
)
from ..services.biz_scene_task_service import BizSceneTaskService
from ..script_hub_session import require_script_hub_permission
from ..services.script_hub_audit_service import write_audit_log

logger = logging.getLogger(__name__)
business_core_router = APIRouter(tags=["核心业务"])


def get_settlement_service():
    return EnterpriseSettlementService()


def get_balance_service(request: BalanceVerificationRequest):
    return AccountBalanceService(environment=request.environment)


def get_commission_service(request: CommissionCalculationRequest):
    return CommissionCalculationService(environment=request.environment)


@business_core_router.post("/settlement/process", response_model=SettlementResponse, tags=["结算处理"])
async def process_settlement(
    http_request: Request,
    request: SettlementRequest,
    db: Session = Depends(get_db),
    service: EnterpriseSettlementService = Depends(get_settlement_service),
    session: Dict[str, Any] = Depends(require_script_hub_permission("settlement")),
):
    request_id = str(uuid.uuid4())
    start_time = _time.time()
    logger.info(f"[结算处理] 开始 | 请求ID: {request_id}")
    logger.info(f"[结算处理] 参数: 企业数量={len(request.enterprises)}, 并发={request.concurrent_workers}")

    try:
        result = service.process_settlement(request)
        elapsed = round(_time.time() - start_time, 2)
        logger.info(f"[结算处理] 完成 | 请求ID: {request_id} | 耗时: {elapsed}秒 | 成功: {result.get('success', False)}")
        write_audit_log(
            db,
            actor=session,
            request=http_request,
            action="business.settlement.process",
            target_type="settlement-job",
            target_code=request_id,
            details={
                "enterprise_count": len(request.enterprises),
                "mode": request.mode,
                "concurrent_workers": request.concurrent_workers,
                "interval_seconds": request.interval_seconds,
                "environment": request.environment,
                "success": bool(result.get("success", False)),
            },
        )
        return result
    except Exception as exc:
        elapsed = round(_time.time() - start_time, 2)
        logger.error(f"[结算处理] 失败 | 请求ID: {request_id} | 耗时: {elapsed}秒 | 错误: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"处理结算请求时发生错误: {str(exc)}")


@business_core_router.post("/balance/verify", response_model=BalanceVerificationResponse, tags=["账户核对"])
async def verify_balance(
    request: BalanceVerificationRequest,
    service: AccountBalanceService = Depends(get_balance_service),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("balance")),
):
    request_id = str(uuid.uuid4())
    start_time = _time.time()
    logger.info(f"[余额核对] 开始 | 请求ID: {request_id}")
    logger.info(f"[余额核对] 参数: 企业ID={request.tenant_id}, 环境={request.environment}, 超时={request.timeout}秒")

    try:
        result = service.verify_balances_with_timeout(
            tenant_id=request.tenant_id,
            timeout=request.timeout,
        )
        elapsed = round(_time.time() - start_time, 2)
        data_count = len(result) if result else 0
        logger.info(f"[余额核对] 完成 | 请求ID: {request_id} | 耗时: {elapsed}秒 | 数据条数: {data_count}")

        if result:
            for item in result[:3]:
                logger.info(f"[余额核对] 响应数据: 账户={item.get('enterprise_name', 'N/A') + '_' + item.get('tax_address', 'N/A')}, 余额={item.get('actual_balance', 'N/A')}")
            if len(result) > 3:
                logger.info(f"[余额核对] ... 共 {len(result)} 条数据")

        return {
            "success": True,
            "message": "核对完成" if result else "未找到企业数据",
            "data": result,
            "request_id": request_id,
            "enterprise_id": request.tenant_id,
        }
    except TimeoutError as exc:
        elapsed = round(_time.time() - start_time, 2)
        logger.warning(f"[余额核对] 超时 | 请求ID: {request_id} | 耗时: {elapsed}秒")
        raise HTTPException(status_code=408, detail=str(exc))
    except Exception as exc:
        elapsed = round(_time.time() - start_time, 2)
        logger.error(f"[余额核对] 失败 | 请求ID: {request_id} | 耗时: {elapsed}秒 | 错误: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@business_core_router.post("/commission/calculate", response_model=CommissionCalculationResponse, tags=["佣金计算"])
async def calculate_commission(
    request: CommissionCalculationRequest,
    service: CommissionCalculationService = Depends(get_commission_service),
    _session: Dict[str, Any] = Depends(require_script_hub_permission("commission")),
):
    request_id = str(uuid.uuid4())
    start_time = _time.time()
    logger.info(f"[佣金计算] 开始 | 请求ID: {request_id}")
    logger.info(f"[佣金计算] 参数: 渠道ID={request.channel_id}, 环境={request.environment}, 超时={request.timeout}秒")

    try:
        result = service.calculate_commission(
            channel_id=request.channel_id,
            timeout=request.timeout,
        )
        elapsed = round(_time.time() - start_time, 2)
        data_count = len(result) if result else 0
        logger.info(f"[佣金计算] 完成 | 请求ID: {request_id} | 耗时: {elapsed}秒 | 结果条数: {data_count}")
        return {
            "success": True,
            "message": "佣金计算完成",
            "data": result,
            "request_id": request_id,
            "channel_id": request.channel_id,
        }
    except TimeoutError as exc:
        elapsed = round(_time.time() - start_time, 2)
        logger.warning(f"[佣金计算] 超时 | 请求ID: {request_id} | 耗时: {elapsed}秒")
        raise HTTPException(status_code=408, detail=str(exc))
    except Exception as exc:
        elapsed = round(_time.time() - start_time, 2)
        logger.error(f"[佣金计算] 失败 | 请求ID: {request_id} | 耗时: {elapsed}秒 | 错误: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@business_core_router.post("/stats/payment/enterprises", response_model=PaymentStatsResponse, tags=["支付统计"])
async def get_payment_enterprises(
    request: PaymentStatsRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("payment-stats")),
):
    request_id = str(uuid.uuid4())
    try:
        service = PaymentStatsService(environment=request.environment)
        enterprises = service.get_normal_enterprises()
        return {
            "success": True,
            "message": "获取成功",
            "data": {"enterprises": enterprises},
            "request_id": request_id,
        }
    except Exception as exc:
        logger.error(f"获取企业列表失败: {exc}")
        return {
            "success": False,
            "message": str(exc),
            "request_id": request_id,
        }


@business_core_router.post("/stats/payment/calculate", response_model=PaymentStatsResponse, tags=["支付统计"])
async def calculate_payment_stats(
    request: PaymentStatsRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("payment-stats")),
):
    request_id = str(uuid.uuid4())
    try:
        service = PaymentStatsService(environment=request.environment)
        stats = service.calculate_stats(enterprise_ids=request.enterprise_ids)
        return {
            "success": True,
            "message": "计算成功",
            "data": stats,
            "request_id": request_id,
        }
    except Exception as exc:
        logger.error(f"计算统计失败: {exc}")
        return {
            "success": False,
            "message": str(exc),
            "request_id": request_id,
        }


@business_core_router.post("/biz-scene/init", response_model=BizSceneTaskInitResponse, tags=["业务场景管理"])
async def init_biz_scene(
    request: BizSceneInitRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("biz-scene")),
):
    """初始化业务场景（6个标准场景，可自定义）"""
    request_id = str(uuid.uuid4())
    logger.info(f"[BizSceneInit API] 添加场景，请求ID: {request_id}")

    try:
        service = BizSceneTaskService(environment=request.environment)
        scenes_data = None
        if request.scenes:
            scenes_data = [s.model_dump() for s in request.scenes]
        result = service.init_scenes(scenes=scenes_data)
        return {
            "success": True,
            "message": "业务场景添加完成",
            "data": result,
            "request_id": request_id,
        }
    except Exception as exc:
        logger.error(f"[BizSceneInit API] 失败: {exc}", exc_info=True)
        return {
            "success": False,
            "message": f"添加失败: {str(exc)}",
            "data": None,
            "request_id": request_id,
        }


@business_core_router.post("/biz-task/init", response_model=BizSceneTaskInitResponse, tags=["任务管理"])
async def init_biz_task(
    request: BizTaskInitRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("biz-task")),
):
    """初始化任务

    默认12条任务（指派3+抢单3，仅企业交付）
    设置enable_delivery_type_1=true可扩展到24条（企业交付+合作者交付）
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[BizTaskInit API] 添加任务，企业ID: {request.enterprise_id}，请求ID: {request_id}")

    try:
        service = BizSceneTaskService(environment=request.environment)
        result = service.init_tasks(
            enterprise_id=request.enterprise_id,
            tenant_id=request.tenant_id,
            tax_id=request.tax_id,
            dept_id=request.dept_id,
            creator=request.creator,
            enable_assign=request.enable_assign,
            enable_grab=request.enable_grab,
            enable_delivery_type_1=request.enable_delivery_type_1,
            enable_enterprise_delivery=request.enable_enterprise_delivery,
        )
        return {
            "success": True,
            "message": f"任务添加完成，共创建{result['created_count']}个任务",
            "data": result,
            "request_id": request_id,
        }
    except Exception as exc:
        logger.error(f"[BizTaskInit API] 失败: {exc}", exc_info=True)
        return {
            "success": False,
            "message": f"添加失败: {str(exc)}",
            "data": None,
            "request_id": request_id,
        }


@business_core_router.post("/enterprise/list", tags=["业务场景管理"])
async def get_enterprise_list(
    request: EnterpriseListRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("biz-scene")),
):
    """获取企业列表"""
    request_id = str(uuid.uuid4())
    try:
        service = BizSceneTaskService(environment=request.environment)
        enterprises = service.get_enterprises()
        return {
            "success": True,
            "message": "获取成功",
            "data": {"enterprises": enterprises},
            "request_id": request_id,
        }
    except Exception as exc:
        logger.error(f"[EnterpriseList API] 失败: {exc}", exc_info=True)
        return {
            "success": False,
            "message": str(exc),
            "request_id": request_id,
        }


@business_core_router.post("/department/list", tags=["业务场景管理"])
async def get_department_list(
    request: DepartmentListRequest,
    _session: Dict[str, Any] = Depends(require_script_hub_permission("biz-scene")),
):
    """获取部门列表"""
    request_id = str(uuid.uuid4())
    try:
        service = BizSceneTaskService(environment=request.environment)
        departments = service.get_departments(tenant_id=request.tenant_id)
        return {
            "success": True,
            "message": "获取成功",
            "data": {"departments": departments},
            "request_id": request_id,
        }
    except Exception as exc:
        logger.error(f"[DepartmentList API] 失败: {exc}", exc_info=True)
        return {
            "success": False,
            "message": str(exc),
            "request_id": request_id,
        }
