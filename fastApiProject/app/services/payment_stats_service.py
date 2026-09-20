import logging
import sqlalchemy
import pandas as pd
from sqlalchemy import text
from typing import List, Dict, Any
from urllib.parse import quote_plus

from ..config import settings

# 配置日志
logger = logging.getLogger(__name__)


class PaymentStatsService:
    """支付统计服务类"""

    def __init__(self, environment: str = None):
        self.environment = settings.resolve_environment(environment)
        self.db_config = settings.get_db_config(self.environment)
        self.logger = logging.getLogger(__name__)
        self.engine = self._init_db_connection()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.engine.dispose()

    def _init_db_connection(self):
        """初始化数据库连接"""
        db_uri = (
            f"mysql+pymysql://{self.db_config['user']}:{quote_plus(self.db_config['password'])}@"
            f"{self.db_config['host']}:{self.db_config['port']}/{self.db_config['database']}"
            "?charset=utf8mb4&connect_timeout=10"
        )
        return sqlalchemy.create_engine(
            db_uri,
            pool_size=5,
            pool_recycle=600,
            pool_pre_ping=True,
            pool_use_lifo=True,
        )

    def get_normal_enterprises(self) -> List[Dict[str, Any]]:
        """获取所有正常企业列表"""
        sql = """
              SELECT enterprise_name, id
              FROM biz_enterprise_base
              WHERE status NOT IN (1, 5, 6)
                AND deleted = 0
              ORDER BY id 
              """
        try:
            with self.engine.connect() as conn:
                df = pd.read_sql(sql, conn)
                return df.to_dict(orient="records")
        except Exception as e:
            self.logger.error(f"获取企业列表失败: {e}")
            raise

    def calculate_stats(self, enterprise_ids: List[int]) -> Dict[str, Any]:
        """计算统计数据"""
        self.logger.info(f"calculate_stats called with enterprise_ids: {enterprise_ids}")
        # 如果没有选中任何企业，直接返回空数据
        if not enterprise_ids:
            self.logger.warning("calculate_stats: No enterprise_ids provided, returning empty stats")
            return {
                "total_settlement": 0.0,
                "tax_address_stats": [],
                "enterprise_stats": [],
                "monthly_stats": []
            }

        # 构建包含条件
        ids_str = ",".join(map(str, enterprise_ids))
        inclusion_clause = f"AND b.enterprise_id IN ({ids_str})"

        # 唯一查询：获取按月、企业、税地分组的细项数据
        sql_query = f"""
            SELECT
                DATE_FORMAT(b.payment_over_time, '%%Y-%%m') as month,
                e.enterprise_name,
                b.enterprise_id,
                MAX(b.tax_address) as tax_address,
                b.tax_id,
                SUM(ROUND(b.pay_amount, 2)) as amount,
                SUM(ROUND(b.service_amount, 2)) as service_amount,
                SUM(ROUND(b.tax_amount, 2)) as tax_amount,
                SUM(ROUND(CASE WHEN b.has_invoiced = 2 THEN b.pay_amount ELSE 0 END, 2)) AS invoiced_amount,
                SUM(ROUND(CASE WHEN b.has_invoiced != 2 THEN b.pay_amount ELSE 0 END, 2)) AS uninvoiced_amount
            FROM biz_balance_worker b
            LEFT JOIN biz_enterprise_base e ON b.enterprise_id = e.id
            WHERE b.pay_status = 3
            AND b.tax_id NOT IN (2, 3)
            {inclusion_clause}
            GROUP BY month, b.enterprise_id, b.tax_id
            ORDER BY month DESC, amount DESC
        """
        # print("支付统计数据查询 (按月/企业/税地)：", sql_query)
        try:
            with self.engine.connect() as conn:
                df = pd.read_sql(sql_query, conn)

                if df.empty:
                    return {
                        "total_settlement": 0.0,
                        "total_service_amount": 0.0,
                        "total_tax_amount": 0.0,
                        "tax_address_stats": [],
                        "enterprise_stats": [],
                        "monthly_stats": []
                    }

                # --- 1. 计算全局总计 ---
                total_settlement = round(df['amount'].sum(), 2)
                total_service_amount = round(df['service_amount'].sum(), 2)
                total_tax_amount = round(df['tax_amount'].sum(), 2)

                # --- 2. 构造企业-税地维度统计 (EnterpriseTaxStatItem) ---
                # 聚合各个月份的数据
                df_ent = df.groupby(['enterprise_id', 'enterprise_name', 'tax_id', 'tax_address'], as_index=False).agg({
                    'invoiced_amount': 'sum',
                    'uninvoiced_amount': 'sum',
                    'service_amount': 'sum',
                    'tax_amount': 'sum',
                    'amount': 'sum'
                })
                
                enterprise_stats = []
                for _, row in df_ent.iterrows():
                    enterprise_stats.append({
                        "enterprise_name": row['enterprise_name'] or f"未知企业({row['enterprise_id']})",
                        "tax_address": row['tax_address'] or f"未知税地({row['tax_id']})",
                        "invoiced_amount": round(row['invoiced_amount'], 2),
                        "uninvoiced_amount": round(row['uninvoiced_amount'], 2),
                        "total_amount": round(row['amount'], 2),
                        "service_amount": round(row['service_amount'], 2),
                        "tax_amount": round(row['tax_amount'], 2)
                    })

                # --- 3. 构造税地维度统计 (TaxAddressStatItem) ---
                df_tax = df.groupby(['tax_id', 'tax_address'], as_index=False).agg({
                    'invoiced_amount': 'sum',
                    'uninvoiced_amount': 'sum',
                    'service_amount': 'sum',
                    'tax_amount': 'sum',
                    'amount': 'sum'
                })
                
                tax_address_stats = []
                for _, row in df_tax.iterrows():
                    tax_address_stats.append({
                        "tax_id": row['tax_id'],
                        "tax_address": row['tax_address'] or f"未知税地({row['tax_id']})",
                        "invoiced_amount": round(row['invoiced_amount'], 2),
                        "uninvoiced_amount": round(row['uninvoiced_amount'], 2),
                        "total_amount": round(row['amount'], 2),
                        "service_amount": round(row['service_amount'], 2),
                        "tax_amount": round(row['tax_amount'], 2)
                    })
                # 按未开票金额降序排序
                tax_address_stats.sort(key=lambda x: x['uninvoiced_amount'], reverse=True)

                # --- 4. 构造月度统计 (MonthlyStatItem) ---
                monthly_stats_map = {}
                for _, row in df.iterrows():
                    month = row['month']
                    if not month: continue
                    if month not in monthly_stats_map:
                        monthly_stats_map[month] = {
                            "month": month,
                            "amount": 0.0,
                            "service_amount": 0.0,
                            "tax_amount": 0.0,
                            "details": []
                        }
                    
                    monthly_stats_map[month]['amount'] += row['amount']
                    monthly_stats_map[month]['service_amount'] += row['service_amount']
                    monthly_stats_map[month]['tax_amount'] += row['tax_amount']
                    monthly_stats_map[month]['details'].append({
                        "enterprise_name": row['enterprise_name'] or f"未知企业({row['enterprise_id']})",
                        "tax_address": row['tax_address'] or f"未知税地({row['tax_id']})",
                        "invoiced_amount": round(row['invoiced_amount'], 2),
                        "uninvoiced_amount": round(row['uninvoiced_amount'], 2),
                        "total_amount": round(row['amount'], 2),
                        "service_amount": round(row['service_amount'], 2),
                        "tax_amount": round(row['tax_amount'], 2)
                    })

                # 给月度汇总值取整
                for m_item in monthly_stats_map.values():
                    m_item['amount'] = round(m_item['amount'], 2)
                    m_item['service_amount'] = round(m_item['service_amount'], 2)
                    m_item['tax_amount'] = round(m_item['tax_amount'], 2)

                monthly_stats = list(monthly_stats_map.values())

                return {
                    "total_settlement": float(total_settlement),
                    "total_service_amount": float(total_service_amount),
                    "total_tax_amount": float(total_tax_amount),
                    "tax_address_stats": tax_address_stats,
                    "enterprise_stats": enterprise_stats,
                    "monthly_stats": monthly_stats
                }

                result = {
                    "total_settlement": round(float(total_settlement), 2),
                    "total_service_amount": round(float(total_service_amount), 2),
                    "total_tax_amount": round(float(total_tax_amount), 2),
                    "tax_address_stats": tax_address_stats,
                    "enterprise_stats": enterprise_stats,
                    "monthly_stats": monthly_stats
                }

                self.logger.info(f"calculate_stats result: total_settlement={result['total_settlement']}, "
                                 f"tax_stats_count={len(result['tax_address_stats'])}, "
                                 f"enterprise_stats_count={len(result['enterprise_stats'])}, "
                                 f"monthly_stats_count={len(result['monthly_stats'])}")
                return result
        except Exception as e:
            self.logger.error(f"计算统计数据失败: {e}")
            raise
