import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pymysql.cursors import DictCursor

from ..config import settings
from ..models import SettlementSimRequest, SettlementSimResponse
from ..utils import DatabaseManager
from ..script_hub_session import require_script_hub_permission

logger = logging.getLogger(__name__)
settlement_sim_router = APIRouter(tags=["结算状态模拟"])


def build_pay_over_time(year=None, month=None):
    """构建支付时间，年月用传入值，日时分秒用当前值"""
    now = datetime.now()
    y = year if year else now.year
    m = month if month else now.month
    return now.replace(year=y, month=m)


def calc_continuous_month(months: list[int], current_month: int) -> int:
    """
    计算连续月份数。
    先判断最大月份和当前月份是否连续，断了直接返回0。
    没断则从最大月份往前数连续有数据的月份数。
    历史年份 current_month 传 13。
    """
    max_month = max(months)
    # 最大月份和当前月份之间有断层，直接返回0
    if current_month - max_month > 1:
        return 0
    months_set = set(months)
    count = 0
    m = max_month
    while m >= 1:
        if m in months_set:
            count += 1
            m -= 1
        else:
            break
    return count


@settlement_sim_router.post("/settlement-sim/execute", response_model=SettlementSimResponse)
async def execute_settlement_sim(
    request: SettlementSimRequest,
    _session: dict = Depends(require_script_hub_permission("settlement-sim")),
):
    """
    执行结算状态模拟操作

    四种 mode：
    - batch_no: 更新批次表+结算单表
    - balance_no: 只更新结算单表
    - batch_no_tax: 写入个税累计（按批次）
    - balance_no_tax: 写入个税累计（按结算单）
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[结算模拟] 开始 | 请求ID: {request_id} | mode: {request.mode}")
    logger.info("[结算模拟审计] request_id=%s actor_id=%s mode=%s environment=%s phase=started",
                request_id, _session.get("id"), request.mode, request.env)

    # 校验必填字段
    if request.mode in ("batch_no", "batch_no_tax") and not request.batch_no:
        raise HTTPException(status_code=400, detail="mode含batch_no时，batch_no不能为空")
    if request.mode in ("balance_no", "balance_no_tax") and not request.balance_no:
        raise HTTPException(status_code=400, detail="mode含balance_no时，balance_no不能为空")

    db_config = settings.get_db_config(request.env)
    pay_over_time = build_pay_over_time(request.year, request.month)
    pay_over_time_str = pay_over_time.strftime('%Y-%m-%d %H:%M:%S')

    try:
        with DatabaseManager(db_config) as conn:
            with conn.cursor(DictCursor) as cursor:
                affected_rows = 0

                if request.mode == "batch_no":
                    # 更新批次表
                    sql_batch = """
                        UPDATE biz_balance_batch
                        SET pay_status = %s, pay_over_time = %s, update_time = NOW()
                        WHERE batch_no = %s AND deleted = 0
                    """
                    cursor.execute(sql_batch, (request.pay_status_batch, pay_over_time, request.batch_no))
                    affected_rows += cursor.rowcount

                    # 更新结算单表
                    sql_worker = """
                        UPDATE biz_balance_worker
                        SET pay_status = %s, payment_over_time = %s, update_time = NOW()
                        WHERE batch_no = %s AND deleted = 0
                    """
                    cursor.execute(sql_worker, (request.pay_status_worker, pay_over_time, request.batch_no))
                    affected_rows += cursor.rowcount

                    conn.commit()

                elif request.mode == "balance_no":
                    # 只更新结算单表
                    sql_worker = """
                        UPDATE biz_balance_worker
                        SET pay_status = %s, payment_over_time = %s, update_time = NOW()
                        WHERE balance_no = %s AND deleted = 0
                    """
                    cursor.execute(sql_worker, (request.pay_status_worker, pay_over_time, request.balance_no))
                    affected_rows += cursor.rowcount

                    conn.commit()

                elif request.mode == "batch_no_tax":
                    # 第一步：取出涉及的 worker_id
                    cursor.execute("""
                        SELECT DISTINCT worker_id
                        FROM biz_balance_worker
                        WHERE deleted = 0
                          AND pay_status = 3
                          AND batch_no = %s
                    """, (request.batch_no,))
                    worker_rows = cursor.fetchall()
                    if not worker_rows:
                        conn.commit()
                    else:
                        worker_ids = tuple(r['worker_id'] for r in worker_rows)

                        # 第二步：统计每个分组的月份列表，用于计算 continuous_month
                        cursor.execute("""
                            SELECT
                                w.worker_id,
                                w.tax_rule,
                                YEAR(w.payment_over_time) AS stat_year,
                                GROUP_CONCAT(
                                    DISTINCT MONTH(w.payment_over_time)
                                    ORDER BY MONTH(w.payment_over_time)
                                ) AS months
                            FROM biz_balance_worker w
                            WHERE w.deleted = 0
                              AND w.pay_status = 3
                              AND (w.tax_rule = 1 OR (w.tax_rule = 0 AND w.business_type = 2 AND w.report_type = 0))
                              AND w.worker_id IN %s
                            GROUP BY w.worker_id, w.tax_rule, YEAR(w.payment_over_time)
                        """, (worker_ids,))
                        month_rows = cursor.fetchall()

                        current_year = datetime.now().year
                        month_map = {}
                        for row in month_rows:
                            months = [int(m) for m in row['months'].split(',')]
                            stat_year = row['stat_year']
                            start = datetime.now().month if stat_year == current_year else 13
                            month_map[(row['worker_id'], row['tax_rule'], stat_year)] = calc_continuous_month(months, start)

                        # 第三步：统计金额并逐行写入
                        cursor.execute("""
                            SELECT
                                w.worker_id,
                                w.tax_rule,
                                YEAR(w.payment_over_time) AS stat_year,
                                ROUND(SUM(w.bill_amount - COALESCE(w.worker_service_amount, 0)), 2) AS total_worker_amount,
                                ROUND(SUM(w.tax_amount), 2) AS total_worker_tax_amount,
                                ROUND(SUM(w.original_tax_amount), 4) AS original_total_worker_tax_amount
                            FROM biz_balance_worker w
                            WHERE w.deleted = 0
                              AND w.pay_status = 3
                              AND (w.tax_rule = 1 OR (w.tax_rule = 0 AND w.business_type = 2 AND w.report_type = 0))
                              AND w.worker_id IN %s
                            GROUP BY w.worker_id, w.tax_rule, YEAR(w.payment_over_time)
                        """, (worker_ids,))
                        amount_rows = cursor.fetchall()

                        for row in amount_rows:
                            continuous = month_map.get((row['worker_id'], row['tax_rule'], row['stat_year']), 0)
                            cursor.execute("""
                                INSERT INTO biz_worker_tax_amount
                                    (worker_id, total_worker_amount, total_worker_tax_amount,
                                     original_total_worker_tax_amount, continuous_month, year,
                                     create_time, update_time, deleted, tax_rule)
                                VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW(), 0, %s)
                                ON DUPLICATE KEY UPDATE
                                    total_worker_amount              = VALUES(total_worker_amount),
                                    total_worker_tax_amount          = VALUES(total_worker_tax_amount),
                                    original_total_worker_tax_amount = VALUES(original_total_worker_tax_amount),
                                    continuous_month                 = VALUES(continuous_month),
                                    update_time                      = NOW()
                            """, (
                                row['worker_id'],
                                row['total_worker_amount'],
                                row['total_worker_tax_amount'],
                                row['original_total_worker_tax_amount'],
                                continuous,
                                row['stat_year'],
                                row['tax_rule']
                            ))
                            affected_rows += cursor.rowcount

                        conn.commit()

                elif request.mode == "balance_no_tax":
                    # 第一步：取出涉及的 worker_id
                    cursor.execute("""
                        SELECT DISTINCT worker_id
                        FROM biz_balance_worker
                        WHERE deleted = 0
                          AND pay_status = 3
                          AND balance_no = %s
                    """, (request.balance_no,))
                    worker_rows = cursor.fetchall()
                    if not worker_rows:
                        conn.commit()
                    else:
                        worker_ids = tuple(r['worker_id'] for r in worker_rows)

                        # 第二步：统计月份列表（与 batch_no_tax 完全相同）
                        cursor.execute("""
                            SELECT
                                w.worker_id,
                                w.tax_rule,
                                YEAR(w.payment_over_time) AS stat_year,
                                GROUP_CONCAT(
                                    DISTINCT MONTH(w.payment_over_time)
                                    ORDER BY MONTH(w.payment_over_time)
                                ) AS months
                            FROM biz_balance_worker w
                            WHERE w.deleted = 0
                              AND w.pay_status = 3
                              AND (w.tax_rule = 1 OR (w.tax_rule = 0 AND w.business_type = 2 AND w.report_type = 0))
                              AND w.worker_id IN %s
                            GROUP BY w.worker_id, w.tax_rule, YEAR(w.payment_over_time)
                        """, (worker_ids,))
                        month_rows = cursor.fetchall()

                        current_year = datetime.now().year
                        month_map = {}
                        for row in month_rows:
                            months = [int(m) for m in row['months'].split(',')]
                            stat_year = row['stat_year']
                            start = datetime.now().month if stat_year == current_year else 13
                            month_map[(row['worker_id'], row['tax_rule'], stat_year)] = calc_continuous_month(months, start)

                        # 第三步：统计金额并逐行写入（与 batch_no_tax 完全相同）
                        cursor.execute("""
                            SELECT
                                w.worker_id,
                                w.tax_rule,
                                YEAR(w.payment_over_time) AS stat_year,
                                ROUND(SUM(w.bill_amount - COALESCE(w.worker_service_amount, 0)), 2) AS total_worker_amount,
                                ROUND(SUM(w.tax_amount), 2) AS total_worker_tax_amount,
                                ROUND(SUM(w.original_tax_amount), 4) AS original_total_worker_tax_amount
                            FROM biz_balance_worker w
                            WHERE w.deleted = 0
                              AND w.pay_status = 3
                              AND (w.tax_rule = 1 OR (w.tax_rule = 0 AND w.business_type = 2 AND w.report_type = 0))
                              AND w.worker_id IN %s
                            GROUP BY w.worker_id, w.tax_rule, YEAR(w.payment_over_time)
                        """, (worker_ids,))
                        amount_rows = cursor.fetchall()

                        for row in amount_rows:
                            continuous = month_map.get((row['worker_id'], row['tax_rule'], row['stat_year']), 0)
                            cursor.execute("""
                                INSERT INTO biz_worker_tax_amount
                                    (worker_id, total_worker_amount, total_worker_tax_amount,
                                     original_total_worker_tax_amount, continuous_month, year,
                                     create_time, update_time, deleted, tax_rule)
                                VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW(), 0, %s)
                                ON DUPLICATE KEY UPDATE
                                    total_worker_amount              = VALUES(total_worker_amount),
                                    total_worker_tax_amount          = VALUES(total_worker_tax_amount),
                                    original_total_worker_tax_amount = VALUES(original_total_worker_tax_amount),
                                    continuous_month                 = VALUES(continuous_month),
                                    update_time                      = NOW()
                            """, (
                                row['worker_id'],
                                row['total_worker_amount'],
                                row['total_worker_tax_amount'],
                                row['original_total_worker_tax_amount'],
                                continuous,
                                row['stat_year'],
                                row['tax_rule']
                            ))
                            affected_rows += cursor.rowcount

                        conn.commit()

                else:
                    raise HTTPException(status_code=400, detail=f"未知mode: {request.mode}")

        logger.info(f"[结算模拟] 完成 | 请求ID: {request_id} | 影响行数: {affected_rows}")
        logger.info("[结算模拟审计] request_id=%s actor_id=%s phase=committed affected_rows=%s",
                    request_id, _session.get("id"), affected_rows)
        return SettlementSimResponse(
            success=True,
            affected_rows=affected_rows,
            pay_over_time=pay_over_time_str,
            message="操作成功"
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[结算模拟审计] request_id=%s actor_id=%s phase=failed error_type=%s",
                     request_id, _session.get("id"), type(exc).__name__)
        logger.error(f"[结算模拟] 失败 | 请求ID: {request_id} | 错误: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"执行失败: {str(exc)}")
