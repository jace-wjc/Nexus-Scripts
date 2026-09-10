import json
import logging
import os
import re
import time
from collections import defaultdict
from threading import Lock

from sqlalchemy import inspect, text

from .database import Base, SessionLocal, engine
from .rbac_catalog import DEPRECATED_PERMISSION_KEYS, PERMISSION_DEFINITIONS, ROLE_DEFINITIONS
from .permission_governance import ROOT_ORG_CODE
from .rbac_models import ScriptHubOrganization, ScriptHubPermission, ScriptHubRole, ScriptHubRolePermission, ScriptHubUser, ScriptHubUserPermission, ScriptHubUserRole
from .recruitment_models import (
    RecruitmentFollowUp,
    RecruitmentInterviewAvailabilitySlot,
    RecruitmentInterviewSchedule,
    RecruitmentLLMConfig,
    RecruitmentMailRecipient,
    RecruitmentMailSenderConfig,
    RecruitmentOffer,
    RecruitmentPosition,
    RecruitmentPositionSkillLink,
    RecruitmentResumeMailDispatch,
    RecruitmentRuleConfig,
    RecruitmentSkill,
)
from .secret_crypto import encrypt_secret
from .services.recruitment_utils import DEFAULT_RULE_CONFIGS, DEFAULT_SKILLS

logger = logging.getLogger(__name__)

_schema_lock = Lock()
_schema_ensured = False
_recruitment_schema_ensured = False


class _MysqlAdvisoryLock:
    """MySQL GET_LOCK wrapper — prevents concurrent DDL across processes.

    GET_LOCK / RELEASE_LOCK MUST run on the **same** MySQL connection;
    the lock is connection-scoped and auto-releases when the connection closes.
    Non-MySQL dialects (SQLite, PostgreSQL, …) are no-ops.
    """

    def __init__(self, lock_name: str, timeout: int = 30):
        self._lock_name = lock_name
        self._timeout = timeout
        self._active = engine.dialect.name == "mysql"
        self._conn = None  # 持久化同一个连接，确保 GET/RELEASE 在同一连接上

    def __enter__(self):
        if not self._active:
            return self
        self._conn = engine.connect()
        try:
            acquired = self._conn.execute(
                text("SELECT GET_LOCK(:name, :timeout)"),
                {"name": self._lock_name, "timeout": self._timeout},
            ).scalar()
            if acquired != 1:
                raise RuntimeError(f"Could not acquire schema lock: {self._lock_name}")
        except Exception:
            self._conn.invalidate()
            self._conn.close()
            self._conn = None
            raise
        return self

    def __exit__(self, *_):
        if not self._active or self._conn is None:
            return
        try:
            released = self._conn.execute(
                text("SELECT RELEASE_LOCK(:name)"), {"name": self._lock_name},
            ).scalar()
            if released != 1:
                self._conn.invalidate()
                logger.warning("Schema lock release was not confirmed; connection discarded: %s", self._lock_name)
        except Exception as exc:
            self._conn.invalidate()
            logger.warning("Schema lock release failed; connection discarded: %s", type(exc).__name__)
        finally:
            self._conn.close()
            self._conn = None

_SCHEMA_SKILL_TASK_KEYWORDS = {
    "screening": {"screening", "score", "scoring", "resume_score", "resume-screening", "初筛", "评分", "筛选"},
    "interview": {"interview", "question", "questions", "interview-question", "面试", "面试题", "出题"},
    "jd": {"jd", "job_description", "job-description", "岗位jd", "职位jd", "jd生成", "生成jd", "岗位描述", "职位描述"},
}


def _add_column_if_missing(
    inspector,
    table_name: str,
    column_name: str,
    ddl: str,
    log_message: str,
) -> None:
    for attempt in range(3):
        try:
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            break
        except Exception as e:
            if attempt == 2:
                logger.warning("Could not inspect columns for %s: %s", table_name, e)
                raise RuntimeError(f"Schema column inspection failed: {table_name}.{column_name}") from e
            time.sleep(1)
            try:
                inspector.clear_cache()
            except Exception:
                pass
    if column_name in columns:
        return
    for attempt in range(3):
        try:
            with engine.begin() as connection:
                connection.execute(text(ddl))
            break
        except Exception as e:
            if attempt == 2:
                logger.warning("Could not execute DDL on %s: %s", table_name, e)
                raise RuntimeError(f"Schema column creation failed: {table_name}.{column_name}") from e
            time.sleep(1)
    try:
        inspector.clear_cache()
    except Exception:
        pass
    logger.info(log_message)


def _add_index_if_missing(
    inspector,
    table_name: str,
    index_name: str,
    ddl: str,
    log_message: str,
) -> None:
    for attempt in range(3):
        try:
            indexes = {index["name"] for index in inspector.get_indexes(table_name)}
            break
        except Exception as e:
            if attempt == 2:
                logger.warning("Could not inspect indexes for %s: %s", table_name, e)
                raise RuntimeError(f"Schema index inspection failed: {table_name}.{index_name}") from e
            time.sleep(1)
            try:
                inspector.clear_cache()
            except Exception:
                pass
    if index_name in indexes:
        return
    for attempt in range(3):
        try:
            with engine.begin() as connection:
                connection.execute(text(ddl))
            break
        except Exception as e:
            if attempt == 2:
                logger.warning("Could not create index %s on %s: %s", index_name, table_name, e)
                raise RuntimeError(f"Schema index creation failed: {table_name}.{index_name}") from e
            time.sleep(1)
    try:
        inspector.clear_cache()
    except Exception:
        pass
    logger.info(log_message)


def _sync_default_organization(db) -> None:
    root = db.query(ScriptHubOrganization).filter(ScriptHubOrganization.org_code == ROOT_ORG_CODE).first()
    if not root:
        db.add(
            ScriptHubOrganization(
                org_code=ROOT_ORG_CODE,
                name="集团总部",
                org_type="group",
                parent_org_code=None,
                path=ROOT_ORG_CODE,
                sort_order=10,
                is_active=True,
            )
        )
    else:
        root.name = root.name or "集团总部"
        root.org_type = root.org_type or "group"
        root.path = root.path or ROOT_ORG_CODE
        root.sort_order = root.sort_order or 10
        root.is_active = True




def _needs_legacy_default_skill_refresh(row: RecruitmentSkill) -> bool:
    if row.skill_code != "skill-iot-resume-screener":
        return False
    text = f"{row.description or ''}\n{row.content or ''}"
    legacy_markers = [
        "面试分析 Skill",
        "模块三",
        "面试结果分析",
        "个人信息卡片时机",
        "全流程招聘助手，分三个模块",
        "专用筛选、出题与面试分析 Skill",
    ]
    return any(marker in text for marker in legacy_markers)


def _parse_skill_frontmatter(content: str) -> dict[str, str]:
    match = re.match(r"^\s*---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", content or "", re.DOTALL)
    if not match:
        return {}
    result: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip().strip("'").strip('"')
        if key and value:
            result[key] = value
    return result


def _normalize_schema_skill_task_name(value: str) -> str | None:
    text = (value or "").strip().lower()
    if not text:
        return None
    for task_kind, keywords in _SCHEMA_SKILL_TASK_KEYWORDS.items():
        if text == task_kind or text in keywords:
            return task_kind
    return None


def _extract_schema_skill_tasks(row: RecruitmentSkill) -> list[str]:
    tags = json.loads(row.tags_json or "[]") if row.tags_json else []
    if not isinstance(tags, list):
        tags = []
    tag_texts = [str(item or "").strip() for item in tags if str(item or "").strip()]
    frontmatter = _parse_skill_frontmatter(row.content or "")
    task_candidates: list[str] = []
    for field_name in ["applies_to", "task", "tasks", "task_type"]:
        raw_value = frontmatter.get(field_name)
        if raw_value:
            task_candidates.extend(re.split(r"[,/|，、\s]+", raw_value))
    for tag in tag_texts:
        lower_tag = tag.lower()
        if lower_tag.startswith("task:"):
            task_candidates.append(tag.split(":", 1)[1].strip())
        else:
            task_candidates.append(tag)
    haystacks = [str(row.skill_code or "").lower(), str(row.name or "").lower(), *[tag.lower() for tag in tag_texts]]
    tasks: list[str] = []
    for raw_value in task_candidates:
        normalized = _normalize_schema_skill_task_name(raw_value)
        if normalized and normalized not in tasks:
            tasks.append(normalized)
    if not tasks:
        for task_kind, keywords in _SCHEMA_SKILL_TASK_KEYWORDS.items():
            if any(any(keyword in haystack for keyword in keywords) for haystack in haystacks if haystack):
                tasks.append(task_kind)
    return tasks


def _extract_schema_skill_pack_meta(row: RecruitmentSkill) -> dict[str, str]:
    tags = json.loads(row.tags_json or "[]") if row.tags_json else []
    if not isinstance(tags, list):
        tags = []
    tag_texts = [str(item or "").strip() for item in tags if str(item or "").strip()]
    frontmatter = _parse_skill_frontmatter(row.content or "")
    group = str(getattr(row, "skill_group", None) or frontmatter.get("skill_group") or frontmatter.get("group") or "").strip()
    version = str(getattr(row, "version", None) or frontmatter.get("version") or frontmatter.get("skill_version") or "").strip()
    for tag in tag_texts:
        lower_tag = tag.lower()
        if not group and lower_tag.startswith("group:"):
            group = tag.split(":", 1)[1].strip()
        if not version and lower_tag.startswith("version:"):
            version = tag.split(":", 1)[1].strip()
    return {
        "group": group,
        "version": version,
    }


def _sync_script_hub_catalog() -> None:
    db = SessionLocal()
    try:
        _sync_default_organization(db)
        created_permission_keys = set()
        permission_rows = {
            row.permission_key: row
            for row in db.query(ScriptHubPermission).all()
        }
        for definition in PERMISSION_DEFINITIONS:
            row = permission_rows.get(definition.key)
            if row is None:
                created_permission_keys.add(definition.key)
                row = ScriptHubPermission(
                    permission_key=definition.key,
                    name=definition.name,
                    category=definition.category,
                    description=definition.description,
                    sort_order=definition.sort_order,
                    is_active=True,
                )
                db.add(row)
                permission_rows[definition.key] = row
            else:
                row.name = definition.name
                row.category = definition.category
                row.description = definition.description
                row.sort_order = definition.sort_order
                row.is_active = True

        # Deactivate deprecated permissions that are no longer in PERMISSION_DEFINITIONS.
        # They may still exist in the database from prior versions; marking them inactive
        # hides them from the UI while preserving existing role_permission links for
        # backward compatibility (expand_permission_aliases handles the derivation).
        for key in DEPRECATED_PERMISSION_KEYS:
            dep_row = permission_rows.get(key)
            if dep_row and dep_row.is_active:
                dep_row.is_active = False

        db.flush()

        role_rows = {
            row.role_code: row
            for row in db.query(ScriptHubRole).all()
        }
        for definition in ROLE_DEFINITIONS:
            row = role_rows.get(definition.code)
            if row is None:
                row = ScriptHubRole(
                    role_code=definition.code,
                    name=definition.name,
                    description=definition.description,
                    sort_order=definition.sort_order,
                    is_system=True,
                    is_active=True,
                    is_deleted=False,
                    deleted_at=None,
                    landing_page=definition.landing_page,
                    recruitment_menu_grouped=definition.recruitment_menu_grouped,
                )
                db.add(row)
                role_rows[definition.code] = row
            else:
                row.name = definition.name
                row.description = definition.description
                row.sort_order = definition.sort_order
                row.is_system = True
                row.is_active = True
                row.is_deleted = False
                row.deleted_at = None
                row.landing_page = definition.landing_page
                row.recruitment_menu_grouped = definition.recruitment_menu_grouped

        db.flush()

        permission_id_by_key = {
            row.permission_key: row.id
            for row in db.query(ScriptHubPermission).all()
        }
        existing_links = {
            (row.role_id, row.permission_id)
            for row in db.query(ScriptHubRolePermission).all()
        }
        for definition in ROLE_DEFINITIONS:
            role = role_rows.get(definition.code)
            if role is None:
                continue
            for permission_key in definition.permissions:
                permission_id = permission_id_by_key.get(permission_key)
                if permission_id is None:
                    continue
                link_key = (role.id, permission_id)
                if link_key in existing_links:
                    continue
                db.add(ScriptHubRolePermission(role_id=role.id, permission_id=permission_id))
                existing_links.add(link_key)

        legacy_visibility_backfill = {
            "recruitment-talent-pool-view": ("recruitment-candidate-manage",),
            "recruitment-assistant-view": (
                "recruitment-dashboard-view",
                "recruitment-position-manage",
                "recruitment-candidate-manage",
                "recruitment-process-execute",
                "recruitment-log-view",
            ),
        }
        if created_permission_keys:
            role_ids_by_permission_key = defaultdict(set)
            for role_id, permission_key in (
                db.query(ScriptHubRolePermission.role_id, ScriptHubPermission.permission_key)
                .join(ScriptHubPermission, ScriptHubPermission.id == ScriptHubRolePermission.permission_id)
                .all()
            ):
                role_ids_by_permission_key[permission_key].add(role_id)

            for new_permission_key, legacy_permission_keys in legacy_visibility_backfill.items():
                if new_permission_key not in created_permission_keys:
                    continue
                new_permission_id = permission_id_by_key.get(new_permission_key)
                if new_permission_id is None:
                    continue
                backfill_role_ids = set()
                for legacy_permission_key in legacy_permission_keys:
                    backfill_role_ids.update(role_ids_by_permission_key.get(legacy_permission_key, set()))
                for role_id in backfill_role_ids:
                    link_key = (role_id, new_permission_id)
                    if link_key in existing_links:
                        continue
                    db.add(ScriptHubRolePermission(role_id=role_id, permission_id=new_permission_id))
                    existing_links.add(link_key)

            role_ids_by_user_id = defaultdict(set)
            for user_id, role_id in db.query(ScriptHubUserRole.user_id, ScriptHubUserRole.role_id).all():
                role_ids_by_user_id[user_id].add(role_id)

            super_admin_user_ids = {
                user_id
                for user_id, in db.query(ScriptHubUser.id).filter(
                    ScriptHubUser.is_super_admin.is_(True),
                    ScriptHubUser.is_deleted.is_(False),
                ).all()
            }

            user_ids_by_granted_permission_key = defaultdict(set)
            user_ids_by_revoked_permission_key = defaultdict(set)
            existing_user_permission_links = set()
            for user_id, permission_id, permission_key, is_granted in (
                db.query(
                    ScriptHubUserPermission.user_id,
                    ScriptHubUserPermission.permission_id,
                    ScriptHubPermission.permission_key,
                    ScriptHubUserPermission.is_granted,
                )
                .join(ScriptHubPermission, ScriptHubPermission.id == ScriptHubUserPermission.permission_id)
                .all()
            ):
                existing_user_permission_links.add((user_id, permission_id))
                if is_granted:
                    user_ids_by_granted_permission_key[permission_key].add(user_id)
                else:
                    user_ids_by_revoked_permission_key[permission_key].add(user_id)

            def user_had_legacy_visibility(user_id, legacy_permission_keys):
                for legacy_permission_key in legacy_permission_keys:
                    if user_id in user_ids_by_revoked_permission_key.get(legacy_permission_key, set()):
                        continue
                    if user_id in user_ids_by_granted_permission_key.get(legacy_permission_key, set()):
                        return True
                    if user_id in super_admin_user_ids:
                        return True
                    if role_ids_by_user_id.get(user_id, set()) & role_ids_by_permission_key.get(legacy_permission_key, set()):
                        return True
                return False

            for new_permission_key, legacy_permission_keys in legacy_visibility_backfill.items():
                if new_permission_key not in created_permission_keys:
                    continue
                new_permission_id = permission_id_by_key.get(new_permission_key)
                if new_permission_id is None:
                    continue
                backfill_user_ids = set()
                for legacy_permission_key in legacy_permission_keys:
                    backfill_user_ids.update(user_ids_by_granted_permission_key.get(legacy_permission_key, set()))
                for user_id in backfill_user_ids:
                    link_key = (user_id, new_permission_id)
                    if link_key in existing_user_permission_links:
                        continue
                    db.add(ScriptHubUserPermission(user_id=user_id, permission_id=new_permission_id, is_granted=True))
                    existing_user_permission_links.add(link_key)

                revoked_candidate_user_ids = set()
                for legacy_permission_key in legacy_permission_keys:
                    revoked_candidate_user_ids.update(user_ids_by_revoked_permission_key.get(legacy_permission_key, set()))
                for user_id in revoked_candidate_user_ids:
                    if user_had_legacy_visibility(user_id, legacy_permission_keys):
                        continue
                    link_key = (user_id, new_permission_id)
                    if link_key in existing_user_permission_links:
                        continue
                    db.add(ScriptHubUserPermission(user_id=user_id, permission_id=new_permission_id, is_granted=False))
                    existing_user_permission_links.add(link_key)

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ensure_script_hub_schema() -> None:
    global _schema_ensured

    if _schema_ensured:
        return

    with _schema_lock:
        if _schema_ensured:
            return

        with _MysqlAdvisoryLock("nexus_script_hub_schema"):
            Base.metadata.create_all(bind=engine)
            inspector = inspect(engine)
            if not inspector.has_table("script_hub_users"):
                _schema_ensured = True
                return

            columns = {column["name"] for column in inspector.get_columns("script_hub_users")}
            if "primary_org_code" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN primary_org_code VARCHAR(100) NOT NULL DEFAULT 'group'"))
                logger.info("Added script_hub_users.primary_org_code column")

            if "data_scope" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN data_scope VARCHAR(40) NOT NULL DEFAULT 'ORG_ONLY'"))
                logger.info("Added script_hub_users.data_scope column")

            if "custom_org_codes_json" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN custom_org_codes_json TEXT NULL"))
                logger.info("Added script_hub_users.custom_org_codes_json column")

            if "authorization_boundary_json" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN authorization_boundary_json TEXT NULL"))
                logger.info("Added script_hub_users.authorization_boundary_json column")

            if "permission_version" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN permission_version INTEGER NOT NULL DEFAULT 1"))
                logger.info("Added script_hub_users.permission_version column")

            if "access_key_version" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN access_key_version INTEGER NOT NULL DEFAULT 1"))
                logger.info("Added script_hub_users.access_key_version column")

            if "team_resources_access_enabled" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN team_resources_access_enabled BOOLEAN NOT NULL DEFAULT TRUE"))
                logger.info("Added script_hub_users.team_resources_access_enabled column")

            if "is_deleted" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE"))
                logger.info("Added script_hub_users.is_deleted column")

            if "deleted_at" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_users ADD COLUMN deleted_at DATETIME NULL"))
                logger.info("Added script_hub_users.deleted_at column")

            org_columns = {column["name"] for column in inspector.get_columns("script_hub_organizations")}
            if "is_deleted" not in org_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_organizations ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE"))
                logger.info("Added script_hub_organizations.is_deleted column")

            if "deleted_at" not in org_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_organizations ADD COLUMN deleted_at DATETIME NULL"))
                logger.info("Added script_hub_organizations.deleted_at column")

            role_columns = {column["name"] for column in inspector.get_columns("script_hub_roles")}
            if "landing_page" not in role_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_roles ADD COLUMN landing_page VARCHAR(20) NOT NULL DEFAULT 'home'"))
                logger.info("Added script_hub_roles.landing_page column")

            if "recruitment_menu_grouped" not in role_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_roles ADD COLUMN recruitment_menu_grouped BOOLEAN NOT NULL DEFAULT TRUE"))
                logger.info("Added script_hub_roles.recruitment_menu_grouped column")

            if "is_deleted" not in role_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_roles ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE"))
                logger.info("Added script_hub_roles.is_deleted column")

            if "deleted_at" not in role_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_roles ADD COLUMN deleted_at DATETIME NULL"))
                logger.info("Added script_hub_roles.deleted_at column")

            audit_columns = {column["name"] for column in inspector.get_columns("script_hub_audit_logs")}
            if "target_org_code" not in audit_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_audit_logs ADD COLUMN target_org_code VARCHAR(100) NULL"))
                logger.info("Added script_hub_audit_logs.target_org_code column")

            if "sensitivity" not in audit_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE script_hub_audit_logs ADD COLUMN sensitivity VARCHAR(40) NOT NULL DEFAULT 'normal'"))
                logger.info("Added script_hub_audit_logs.sensitivity column")

            _sync_script_hub_catalog()
        _schema_ensured = True


def ensure_recruitment_schema() -> None:
    global _recruitment_schema_ensured

    if _recruitment_schema_ensured:
        return

    with _schema_lock:
        if _recruitment_schema_ensured:
            return

        with _MysqlAdvisoryLock("nexus_recruitment_schema"):
            Base.metadata.create_all(bind=engine)
            inspector = inspect(engine)
            if not inspector.has_table("recruitment_rule_configs"):
                _recruitment_schema_ensured = True
                return

            for table_name in [
                "recruitment_positions",
                "recruitment_jd_versions",
                "recruitment_candidates",
                "recruitment_resume_files",
                "recruitment_resume_parse_results",
                "recruitment_candidate_scores",
                "recruitment_candidate_status_history",
                "recruitment_ai_task_logs",
                "recruitment_rule_configs",
                "recruitment_interview_questions",
                "recruitment_candidate_workflow_memories",
                "recruitment_chat_context_memories",
                "recruitment_resume_mail_dispatches",
                "recruitment_interview_results",
                "recruitment_publish_tasks",
            ]:
                if inspector.has_table(table_name):
                    _add_column_if_missing(
                        inspector,
                        table_name,
                        "org_code",
                        f"ALTER TABLE {table_name} ADD COLUMN org_code VARCHAR(100) NOT NULL DEFAULT 'group'",
                        f"Added {table_name}.org_code column",
                    )
    
            for table_name in [
                "recruitment_skills",
                "recruitment_llm_configs",
                "recruitment_mail_sender_configs",
                "recruitment_mail_recipients",
            ]:
                if not inspector.has_table(table_name):
                    continue
                _add_column_if_missing(inspector, table_name, "org_code", f"ALTER TABLE {table_name} ADD COLUMN org_code VARCHAR(100) NOT NULL DEFAULT 'group'", f"Added {table_name}.org_code column")
                _add_column_if_missing(inspector, table_name, "scope_level", f"ALTER TABLE {table_name} ADD COLUMN scope_level VARCHAR(40) NOT NULL DEFAULT 'ORG'", f"Added {table_name}.scope_level column")
                _add_column_if_missing(inspector, table_name, "share_policy", f"ALTER TABLE {table_name} ADD COLUMN share_policy VARCHAR(40) NOT NULL DEFAULT 'PRIVATE'", f"Added {table_name}.share_policy column")
                _add_column_if_missing(inspector, table_name, "allow_sub_org_use", f"ALTER TABLE {table_name} ADD COLUMN allow_sub_org_use BOOLEAN NOT NULL DEFAULT FALSE", f"Added {table_name}.allow_sub_org_use column")
                _add_column_if_missing(inspector, table_name, "allow_copy", f"ALTER TABLE {table_name} ADD COLUMN allow_copy BOOLEAN NOT NULL DEFAULT FALSE", f"Added {table_name}.allow_copy column")
    
            if inspector.has_table("recruitment_skills"):
                _add_column_if_missing(
                    inspector,
                    "recruitment_skills",
                    "is_system_base",
                    "ALTER TABLE recruitment_skills ADD COLUMN is_system_base BOOLEAN NOT NULL DEFAULT FALSE",
                    "Added recruitment_skills.is_system_base column",
                )
    
            if inspector.has_table("recruitment_llm_configs"):
                _add_column_if_missing(inspector, "recruitment_llm_configs", "created_by", "ALTER TABLE recruitment_llm_configs ADD COLUMN created_by VARCHAR(100) NULL", "Added recruitment_llm_configs.created_by column")
                _add_column_if_missing(inspector, "recruitment_llm_configs", "updated_by", "ALTER TABLE recruitment_llm_configs ADD COLUMN updated_by VARCHAR(100) NULL", "Added recruitment_llm_configs.updated_by column")

            # generation/CAS（Commit 2）：候选人代次与活动 run 指针；解析/评分行回填 run_id。
            if inspector.has_table("recruitment_candidates"):
                _add_column_if_missing(inspector, "recruitment_candidates", "screening_generation", "ALTER TABLE recruitment_candidates ADD COLUMN screening_generation INTEGER NOT NULL DEFAULT 0", "Added recruitment_candidates.screening_generation column")
                _add_column_if_missing(inspector, "recruitment_candidates", "active_screening_run_id", "ALTER TABLE recruitment_candidates ADD COLUMN active_screening_run_id INTEGER NULL", "Added recruitment_candidates.active_screening_run_id column")
                _add_column_if_missing(inspector, "recruitment_candidates", "latest_screening_run_id", "ALTER TABLE recruitment_candidates ADD COLUMN latest_screening_run_id INTEGER NULL", "Added recruitment_candidates.latest_screening_run_id column")
                _add_column_if_missing(inspector, "recruitment_candidates", "business_revision", "ALTER TABLE recruitment_candidates ADD COLUMN business_revision INTEGER NOT NULL DEFAULT 0", "Added recruitment_candidates.business_revision column")
            if inspector.has_table("recruitment_candidate_screening_runs"):
                _add_column_if_missing(inspector, "recruitment_candidate_screening_runs", "expected_candidate_revision", "ALTER TABLE recruitment_candidate_screening_runs ADD COLUMN expected_candidate_revision INTEGER NULL", "Added recruitment_candidate_screening_runs.expected_candidate_revision column")
                # ALTER 只加列不建索引；模型上这些列声明了 index=True，需在既有生产表上补建。
                _add_index_if_missing(inspector, "recruitment_candidates", "ix_recruitment_candidates_active_screening_run_id", "CREATE INDEX ix_recruitment_candidates_active_screening_run_id ON recruitment_candidates (active_screening_run_id)", "Created index ix_recruitment_candidates_active_screening_run_id")
                _add_index_if_missing(inspector, "recruitment_candidates", "ix_recruitment_candidates_latest_screening_run_id", "CREATE INDEX ix_recruitment_candidates_latest_screening_run_id ON recruitment_candidates (latest_screening_run_id)", "Created index ix_recruitment_candidates_latest_screening_run_id")
            if inspector.has_table("recruitment_resume_parse_results"):
                _add_column_if_missing(inspector, "recruitment_resume_parse_results", "screening_run_id", "ALTER TABLE recruitment_resume_parse_results ADD COLUMN screening_run_id INTEGER NULL", "Added recruitment_resume_parse_results.screening_run_id column")
                _add_index_if_missing(inspector, "recruitment_resume_parse_results", "ix_recruitment_resume_parse_results_screening_run_id", "CREATE INDEX ix_recruitment_resume_parse_results_screening_run_id ON recruitment_resume_parse_results (screening_run_id)", "Created index ix_recruitment_resume_parse_results_screening_run_id")
            if inspector.has_table("recruitment_candidate_scores"):
                _add_column_if_missing(inspector, "recruitment_candidate_scores", "screening_run_id", "ALTER TABLE recruitment_candidate_scores ADD COLUMN screening_run_id INTEGER NULL", "Added recruitment_candidate_scores.screening_run_id column")
                _add_index_if_missing(inspector, "recruitment_candidate_scores", "ix_recruitment_candidate_scores_screening_run_id", "CREATE INDEX ix_recruitment_candidate_scores_screening_run_id ON recruitment_candidate_scores (screening_run_id)", "Created index ix_recruitment_candidate_scores_screening_run_id")

            jd_columns = {column["name"] for column in inspector.get_columns("recruitment_jd_versions")}
            if "publish_text" not in jd_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_jd_versions ADD COLUMN publish_text TEXT NULL"))
                logger.info("Added recruitment_jd_versions.publish_text column")
    
            position_columns = {column["name"] for column in inspector.get_columns("recruitment_positions")}
            if "auto_screen_on_upload" not in position_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_positions ADD COLUMN auto_screen_on_upload BOOLEAN NOT NULL DEFAULT FALSE"))
                logger.info("Added recruitment_positions.auto_screen_on_upload column")
            if "auto_advance_on_screening" not in position_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_positions ADD COLUMN auto_advance_on_screening BOOLEAN NOT NULL DEFAULT TRUE"))
                logger.info("Added recruitment_positions.auto_advance_on_screening column")
            if "jd_skill_ids_json" not in position_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_positions ADD COLUMN jd_skill_ids_json TEXT NULL"))
                logger.info("Added recruitment_positions.jd_skill_ids_json column")
            if "screening_skill_ids_json" not in position_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_positions ADD COLUMN screening_skill_ids_json TEXT NULL"))
                logger.info("Added recruitment_positions.screening_skill_ids_json column")
            if "interview_skill_ids_json" not in position_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_positions ADD COLUMN interview_skill_ids_json TEXT NULL"))
                logger.info("Added recruitment_positions.interview_skill_ids_json column")
            _add_index_if_missing(
                inspector,
                "recruitment_positions",
                "idx_position_org_status_deleted",
                "CREATE INDEX idx_position_org_status_deleted ON recruitment_positions (org_code, status, deleted)",
                "Created index idx_position_org_status_deleted",
            )
    
            skill_columns = {column["name"] for column in inspector.get_columns("recruitment_skills")}
            if "skill_group" not in skill_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_skills ADD COLUMN skill_group VARCHAR(120) NULL"))
                logger.info("Added recruitment_skills.skill_group column")
            if "version" not in skill_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_skills ADD COLUMN version VARCHAR(40) NULL"))
                logger.info("Added recruitment_skills.version column")
            if "tags_json" not in skill_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_skills ADD COLUMN tags_json TEXT NULL"))
                logger.info("Added recruitment_skills.tags_json column")
            if "task_types_json" not in skill_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_skills ADD COLUMN task_types_json TEXT NULL"))
                logger.info("Added recruitment_skills.task_types_json column")
            if "bound_position_id" not in skill_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_skills ADD COLUMN bound_position_id INTEGER NULL"))
                logger.info("Added recruitment_skills.bound_position_id column")
    
            ai_task_columns = {column["name"] for column in inspector.get_columns("recruitment_ai_task_logs")}
            if "screening_run_id" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN screening_run_id VARCHAR(80) NULL"))
                logger.info("Added recruitment_ai_task_logs.screening_run_id column")
            if "batch_id" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN batch_id VARCHAR(80) NULL"))
                logger.info("Added recruitment_ai_task_logs.batch_id column")
            if "parent_task_id" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN parent_task_id INTEGER NULL"))
                logger.info("Added recruitment_ai_task_logs.parent_task_id column")
            if "root_task_id" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN root_task_id INTEGER NULL"))
                logger.info("Added recruitment_ai_task_logs.root_task_id column")
            if "stage" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN stage VARCHAR(50) NULL"))
                logger.info("Added recruitment_ai_task_logs.stage column")
            if "stage_started_at" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN stage_started_at DATETIME NULL"))
                logger.info("Added recruitment_ai_task_logs.stage_started_at column")
            if "stage_completed_at" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN stage_completed_at DATETIME NULL"))
                logger.info("Added recruitment_ai_task_logs.stage_completed_at column")
            if "duration_ms" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN duration_ms INTEGER NULL"))
                logger.info("Added recruitment_ai_task_logs.duration_ms column")
            if "related_skill_ids_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN related_skill_ids_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.related_skill_ids_json column")
            if "related_skill_snapshots_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN related_skill_snapshots_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.related_skill_snapshots_json column")
    
            if "memory_source" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN memory_source VARCHAR(80) NULL"))
                logger.info("Added recruitment_ai_task_logs.memory_source column")
            if "skill_resolution_source" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN skill_resolution_source VARCHAR(80) NULL"))
                logger.info("Added recruitment_ai_task_logs.skill_resolution_source column")
            if "skill_resolution_detail_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN skill_resolution_detail_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.skill_resolution_detail_json column")
            if "score_rule_snapshot_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN score_rule_snapshot_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.score_rule_snapshot_json column")
            if "timing_breakdown_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN timing_breakdown_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.timing_breakdown_json column")
            if "request_hash" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN request_hash VARCHAR(120) NULL"))
                logger.info("Added recruitment_ai_task_logs.request_hash column")
            if "session_token" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN session_token VARCHAR(1024) NULL"))
                logger.info("Added recruitment_ai_task_logs.session_token column")
            if "output_snapshot" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN output_snapshot TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.output_snapshot column")
            if "full_request_snapshot" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN full_request_snapshot TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.full_request_snapshot column")
            if "raw_response_text" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN raw_response_text TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.raw_response_text column")
            if "parsed_response_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN parsed_response_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.parsed_response_json column")
            if "sanitized_response_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN sanitized_response_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.sanitized_response_json column")
            if "validation_meta_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN validation_meta_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.validation_meta_json column")
            if "persisted_result_refs_json" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN persisted_result_refs_json TEXT NULL"))
                logger.info("Added recruitment_ai_task_logs.persisted_result_refs_json column")
            if "model_source" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN model_source VARCHAR(120) NULL"))
                logger.info("Added recruitment_ai_task_logs.model_source column")
            if "batch_email_sent" not in ai_task_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs ADD COLUMN batch_email_sent BOOLEAN NOT NULL DEFAULT FALSE"))
                logger.info("Added recruitment_ai_task_logs.batch_email_sent column")
                with engine.begin() as connection:
                    connection.execute(text("CREATE INDEX ix_recruitment_ai_task_logs_batch_email_sent ON recruitment_ai_task_logs (batch_email_sent)"))
                logger.info("Created index ix_recruitment_ai_task_logs_batch_email_sent")
            _add_index_if_missing(
                inspector,
                "recruitment_ai_task_logs",
                "idx_task_log_candidate",
                "CREATE INDEX idx_task_log_candidate ON recruitment_ai_task_logs (related_candidate_id, created_at)",
                "Created index idx_task_log_candidate",
            )
            _add_index_if_missing(
                inspector,
                "recruitment_ai_task_logs",
                "idx_task_log_batch",
                "CREATE INDEX idx_task_log_batch ON recruitment_ai_task_logs (batch_id)",
                "Created index idx_task_log_batch",
            )
            task_log_session_index_ddl = (
                "CREATE INDEX idx_task_log_session ON recruitment_ai_task_logs (session_token(64))"
                if engine.dialect.name == "mysql"
                else "CREATE INDEX idx_task_log_session ON recruitment_ai_task_logs (session_token)"
            )
            _add_index_if_missing(
                inspector,
                "recruitment_ai_task_logs",
                "idx_task_log_session",
                task_log_session_index_ddl,
                "Created index idx_task_log_session",
            )
            if engine.dialect.name == "mysql":
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN related_skill_snapshots_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN skill_resolution_detail_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN score_rule_snapshot_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN timing_breakdown_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN prompt_snapshot LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN full_request_snapshot LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN output_summary LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN output_snapshot LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN raw_response_text LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN parsed_response_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN sanitized_response_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN validation_meta_json LONGTEXT NULL"))
                    connection.execute(text("ALTER TABLE recruitment_ai_task_logs MODIFY COLUMN persisted_result_refs_json LONGTEXT NULL"))
                logger.info("Expanded recruitment_ai_task_logs large text columns to LONGTEXT")
    
            score_columns = {column["name"]: column for column in inspector.get_columns("recruitment_candidate_scores")}
            recommendation_column = score_columns.get("recommendation")
            recommendation_length = None
            if recommendation_column is not None:
                recommendation_length = getattr(recommendation_column.get("type"), "length", None)
            if recommendation_column is not None and recommendation_length and recommendation_length < 255:
                if engine.dialect.name == "mysql":
                    with engine.begin() as connection:
                        connection.execute(text("ALTER TABLE recruitment_candidate_scores MODIFY COLUMN recommendation VARCHAR(255) NULL"))
                    logger.info("Expanded recruitment_candidate_scores.recommendation to VARCHAR(255)")
                else:
                    logger.info("Skipped expanding recruitment_candidate_scores.recommendation on dialect %s", engine.dialect.name)

            score_json_column = score_columns.get("score_json")
            if score_json_column is not None and engine.dialect.name == "mysql":
                col_type = score_json_column.get("type")
                type_name = str(col_type).upper() if col_type else ""
                if "LONGTEXT" not in type_name:
                    with engine.begin() as connection:
                        connection.execute(text("ALTER TABLE recruitment_candidate_scores MODIFY COLUMN score_json LONGTEXT NULL"))
                    logger.info("Expanded recruitment_candidate_scores.score_json to LONGTEXT")

            llm_columns = {column["name"] for column in inspector.get_columns("recruitment_llm_configs")}
            if "api_key_ciphertext" not in llm_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_llm_configs ADD COLUMN api_key_ciphertext TEXT NULL"))
                logger.info("Added recruitment_llm_configs.api_key_ciphertext column")
            if "max_concurrent" not in llm_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_llm_configs ADD COLUMN max_concurrent INTEGER NOT NULL DEFAULT 4 COMMENT '该key最大并发数'"))
                logger.info("Added recruitment_llm_configs.max_concurrent column")
            if "max_qps" not in llm_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_llm_configs ADD COLUMN max_qps INTEGER NOT NULL DEFAULT 10 COMMENT '该key每秒最大请求数，0表示不限制'"))
                logger.info("Added recruitment_llm_configs.max_qps column")

            mail_dispatch_columns = {column["name"] for column in inspector.get_columns("recruitment_resume_mail_dispatches")}
            if "position_id" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN position_id INTEGER NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.position_id column")
            if "screening_score_id" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN screening_score_id INTEGER NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.screening_score_id column")
            if "cc_recipient_ids_json" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN cc_recipient_ids_json TEXT NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.cc_recipient_ids_json column")
            if "cc_recipient_emails_json" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN cc_recipient_emails_json TEXT NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.cc_recipient_emails_json column")
            if "bcc_recipient_ids_json" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN bcc_recipient_ids_json TEXT NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.bcc_recipient_ids_json column")
            if "bcc_recipient_emails_json" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN bcc_recipient_emails_json TEXT NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.bcc_recipient_emails_json column")
            if "send_mode" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN send_mode VARCHAR(50) NOT NULL DEFAULT 'manual'"))
                logger.info("Added recruitment_resume_mail_dispatches.send_mode column")
            if "trigger_type" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN trigger_type VARCHAR(80) NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.trigger_type column")
            if "candidate_status" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN candidate_status VARCHAR(50) NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.candidate_status column")
            if "dedup_key" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN dedup_key VARCHAR(255) NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.dedup_key column")
            if "trigger_rule_json" not in mail_dispatch_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_resume_mail_dispatches ADD COLUMN trigger_rule_json TEXT NULL"))
                logger.info("Added recruitment_resume_mail_dispatches.trigger_rule_json column")
    
            candidate_columns = {column["name"] for column in inspector.get_columns("recruitment_candidates")}
            if "name_source" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN name_source VARCHAR(40) NULL"))
                logger.info("Added recruitment_candidates.name_source column")
            if "name_confidence" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN name_confidence FLOAT NULL"))
                logger.info("Added recruitment_candidates.name_confidence column")
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "ix_recruitment_candidates_name_source",
                "CREATE INDEX ix_recruitment_candidates_name_source ON recruitment_candidates (name_source)",
                "Created index ix_recruitment_candidates_name_source",
            )
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "ix_recruitment_candidates_source_detail",
                "CREATE INDEX ix_recruitment_candidates_source_detail ON recruitment_candidates (source_detail)",
                "Created index ix_recruitment_candidates_source_detail",
            )
            if "age" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN age INTEGER NULL"))
                logger.info("Added recruitment_candidates.age column")
            if "city" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN city VARCHAR(100) NULL"))
                logger.info("Added recruitment_candidates.city column")
            if "expected_city" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN expected_city VARCHAR(200) NULL"))
                logger.info("Added recruitment_candidates.expected_city column")
            if "owner_id" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN owner_id VARCHAR(100) NULL"))
                logger.info("Added recruitment_candidates.owner_id column")
            if "ai_match_position_id" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_match_position_id INTEGER NULL"))
                logger.info("Added recruitment_candidates.ai_match_position_id column")
            if "ai_match_position_title" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_match_position_title VARCHAR(200) NULL"))
                logger.info("Added recruitment_candidates.ai_match_position_title column")
            if "ai_match_confidence" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_match_confidence FLOAT NULL"))
                logger.info("Added recruitment_candidates.ai_match_confidence column")
            if "ai_match_reason" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_match_reason TEXT NULL"))
                logger.info("Added recruitment_candidates.ai_match_reason column")
            if "ai_match_alternatives" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_match_alternatives TEXT NULL"))
                logger.info("Added recruitment_candidates.ai_match_alternatives column")
            if "ai_match_at" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_match_at DATETIME NULL"))
                logger.info("Added recruitment_candidates.ai_match_at column")
            if "ai_potential_position" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_potential_position VARCHAR(200) NULL"))
                logger.info("Added recruitment_candidates.ai_potential_position column")
            if "ai_potential_reason" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN ai_potential_reason TEXT NULL"))
                logger.info("Added recruitment_candidates.ai_potential_reason column")
            if "talent_pool_reason" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN talent_pool_reason VARCHAR(50) NULL"))
                logger.info("Added recruitment_candidates.talent_pool_reason column")
            if "talent_pool_source_status" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN talent_pool_source_status VARCHAR(50) NULL"))
                logger.info("Added recruitment_candidates.talent_pool_source_status column")
            if "talent_pool_moved_by" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN talent_pool_moved_by VARCHAR(64) NULL"))
                logger.info("Added recruitment_candidates.talent_pool_moved_by column")
            if "talent_pool_moved_at" not in candidate_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidates ADD COLUMN talent_pool_moved_at DATETIME NULL"))
                logger.info("Added recruitment_candidates.talent_pool_moved_at column")
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "idx_candidate_org_status_deleted",
                "CREATE INDEX idx_candidate_org_status_deleted ON recruitment_candidates (org_code, status, deleted)",
                "Created index idx_candidate_org_status_deleted",
            )
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "idx_candidate_position_status",
                "CREATE INDEX idx_candidate_position_status ON recruitment_candidates (position_id, status, deleted)",
                "Created index idx_candidate_position_status",
            )
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "idx_candidate_created_at",
                "CREATE INDEX idx_candidate_created_at ON recruitment_candidates (created_at)",
                "Created index idx_candidate_created_at",
            )
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "idx_candidate_org_deleted_updated",
                "CREATE INDEX idx_candidate_org_deleted_updated ON recruitment_candidates (org_code, deleted, updated_at, id)",
                "Created index idx_candidate_org_deleted_updated",
            )
            _add_index_if_missing(
                inspector,
                "recruitment_candidates",
                "idx_candidate_position_deleted_updated",
                "CREATE INDEX idx_candidate_position_deleted_updated ON recruitment_candidates (position_id, deleted, updated_at, id)",
                "Created index idx_candidate_position_deleted_updated",
            )
            if inspector.has_table("recruitment_interview_schedules"):
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "subject", "ALTER TABLE recruitment_interview_schedules ADD COLUMN subject VARCHAR(200) NULL", "Added recruitment_interview_schedules.subject column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "round_index", "ALTER TABLE recruitment_interview_schedules ADD COLUMN round_index INT NOT NULL DEFAULT 1", "Added recruitment_interview_schedules.round_index column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "interview_method", "ALTER TABLE recruitment_interview_schedules ADD COLUMN interview_method VARCHAR(50) NULL DEFAULT 'onsite'", "Added recruitment_interview_schedules.interview_method column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "interviewer_user_code", "ALTER TABLE recruitment_interview_schedules ADD COLUMN interviewer_user_code VARCHAR(100) NULL", "Added recruitment_interview_schedules.interviewer_user_code column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "meeting_room", "ALTER TABLE recruitment_interview_schedules ADD COLUMN meeting_room VARCHAR(120) NULL", "Added recruitment_interview_schedules.meeting_room column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "video_tool", "ALTER TABLE recruitment_interview_schedules ADD COLUMN video_tool VARCHAR(120) NULL", "Added recruitment_interview_schedules.video_tool column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "contact_phone", "ALTER TABLE recruitment_interview_schedules ADD COLUMN contact_phone VARCHAR(50) NULL", "Added recruitment_interview_schedules.contact_phone column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "visible_sections_json", "ALTER TABLE recruitment_interview_schedules ADD COLUMN visible_sections_json TEXT NULL", "Added recruitment_interview_schedules.visible_sections_json column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "availability_slot_id", "ALTER TABLE recruitment_interview_schedules ADD COLUMN availability_slot_id INT NULL", "Added recruitment_interview_schedules.availability_slot_id column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "department_review_assignment_id", "ALTER TABLE recruitment_interview_schedules ADD COLUMN department_review_assignment_id INT NULL", "Added recruitment_interview_schedules.department_review_assignment_id column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "notification_status", "ALTER TABLE recruitment_interview_schedules ADD COLUMN notification_status VARCHAR(50) NOT NULL DEFAULT 'pending'", "Added recruitment_interview_schedules.notification_status column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "notified_at", "ALTER TABLE recruitment_interview_schedules ADD COLUMN notified_at DATETIME NULL", "Added recruitment_interview_schedules.notified_at column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "result_status", "ALTER TABLE recruitment_interview_schedules ADD COLUMN result_status VARCHAR(50) NULL", "Added recruitment_interview_schedules.result_status column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "result_comment", "ALTER TABLE recruitment_interview_schedules ADD COLUMN result_comment TEXT NULL", "Added recruitment_interview_schedules.result_comment column")
                _add_column_if_missing(inspector, "recruitment_interview_schedules", "result_submitted_at", "ALTER TABLE recruitment_interview_schedules ADD COLUMN result_submitted_at DATETIME NULL", "Added recruitment_interview_schedules.result_submitted_at column")
                _add_index_if_missing(
                    inspector,
                    "recruitment_interview_schedules",
                    "idx_interview_schedule_interviewer_time",
                    "CREATE INDEX idx_interview_schedule_interviewer_time ON recruitment_interview_schedules (interviewer_user_code, scheduled_at, status)",
                    "Created index idx_interview_schedule_interviewer_time",
                )
                _add_index_if_missing(
                    inspector,
                    "recruitment_interview_schedules",
                    "idx_interview_schedule_candidate_status",
                    "CREATE INDEX idx_interview_schedule_candidate_status ON recruitment_interview_schedules (candidate_id, status, scheduled_at)",
                    "Created index idx_interview_schedule_candidate_status",
                )
            if inspector.has_table("recruitment_interview_availability_slots"):
                _add_index_if_missing(
                    inspector,
                    "recruitment_interview_availability_slots",
                    "idx_interview_availability_user_time",
                    "CREATE INDEX idx_interview_availability_user_time ON recruitment_interview_availability_slots (interviewer_user_code, start_at, end_at, status)",
                    "Created index idx_interview_availability_user_time",
                )
            if inspector.has_table("recruitment_department_review_batches"):
                _add_index_if_missing(
                    inspector,
                    "recruitment_department_review_batches",
                    "idx_dept_review_batch_candidate",
                    "CREATE INDEX idx_dept_review_batch_candidate ON recruitment_department_review_batches (candidate_id, status, created_at)",
                    "Created index idx_dept_review_batch_candidate",
                )
                _add_index_if_missing(
                    inspector,
                    "recruitment_department_review_batches",
                    "idx_dept_review_batch_position",
                    "CREATE INDEX idx_dept_review_batch_position ON recruitment_department_review_batches (position_id, status, created_at)",
                    "Created index idx_dept_review_batch_position",
                )
            if inspector.has_table("recruitment_department_review_assignments"):
                _add_index_if_missing(
                    inspector,
                    "recruitment_department_review_assignments",
                    "idx_dept_review_assignment_reviewer_status",
                    "CREATE INDEX idx_dept_review_assignment_reviewer_status ON recruitment_department_review_assignments (reviewer_user_code, status, created_at)",
                    "Created index idx_dept_review_assignment_reviewer_status",
                )
                _add_index_if_missing(
                    inspector,
                    "recruitment_department_review_assignments",
                    "idx_dept_review_assignment_candidate",
                    "CREATE INDEX idx_dept_review_assignment_candidate ON recruitment_department_review_assignments (candidate_id, status, created_at)",
                    "Created index idx_dept_review_assignment_candidate",
                )

            # Widen phone column to handle encrypted/masked values from resume platforms
            try:
                phone_col = next((c for c in inspector.get_columns("recruitment_candidates") if c["name"] == "phone"), None)
                if phone_col is not None:
                    col_type = str(phone_col.get("type") or "")
                    if "40" in col_type and "128" not in col_type:
                        with engine.begin() as connection:
                            connection.execute(text("ALTER TABLE recruitment_candidates MODIFY COLUMN phone VARCHAR(128) NULL"))
                        logger.info("Widened recruitment_candidates.phone to VARCHAR(128)")
            except Exception as exc:
                logger.warning("Failed to check/widen phone column: %s", exc)
    
            score_columns = {col["name"] for col in inspector.get_columns("recruitment_candidate_scores")}
            if "hr_feedback" not in score_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidate_scores ADD COLUMN hr_feedback VARCHAR(50) NULL"))
                logger.info("Added recruitment_candidate_scores.hr_feedback column")
            if "hr_feedback_reason" not in score_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE recruitment_candidate_scores ADD COLUMN hr_feedback_reason TEXT NULL"))
                logger.info("Added recruitment_candidate_scores.hr_feedback_reason column")
    
            db = SessionLocal()
            try:
                for config_key, config_value in DEFAULT_RULE_CONFIGS.items():
                    exists = db.query(RecruitmentRuleConfig).filter(RecruitmentRuleConfig.config_key == config_key, RecruitmentRuleConfig.scope == "global").first()
                    if not exists:
                        db.add(RecruitmentRuleConfig(config_key=config_key, config_type="json", scope="global", scope_id=None, config_value=json.dumps(config_value, ensure_ascii=False), description=f"Default recruitment config: {config_key}"))
    
                for skill in DEFAULT_SKILLS:
                    seed_frontmatter = _parse_skill_frontmatter(skill.get("content") or "")
                    seed_group = str(skill.get("skill_group") or seed_frontmatter.get("skill_group") or seed_frontmatter.get("group") or "").strip() or None
                    seed_version = str(skill.get("version") or seed_frontmatter.get("version") or seed_frontmatter.get("skill_version") or "").strip() or None
                    exists = db.query(RecruitmentSkill).filter(RecruitmentSkill.skill_code == skill["skill_code"]).first()
                    if not exists:
                        db.add(RecruitmentSkill(skill_code=skill["skill_code"], org_code=ROOT_ORG_CODE, scope_level="GLOBAL", share_policy="SHARED_READONLY", allow_sub_org_use=True, allow_copy=False, is_system_base=True, name=skill["name"], description=skill.get("description"), skill_group=seed_group, version=seed_version, content=skill["content"], tags_json=json.dumps(skill.get("tags") or [], ensure_ascii=False), sort_order=skill.get("sort_order") or 99, is_enabled=True, created_by="system", updated_by="system", deleted=False))
                    elif exists.deleted:
                        continue
                    elif (exists.updated_by or "system") == "system" or _needs_legacy_default_skill_refresh(exists):
                        exists.name = skill["name"]
                        exists.description = skill.get("description")
                        exists.skill_group = seed_group
                        exists.version = seed_version
                        exists.content = skill["content"]
                        exists.tags_json = json.dumps(skill.get("tags") or [], ensure_ascii=False)
                        exists.sort_order = skill.get("sort_order") or 99
                        exists.is_enabled = bool(exists.is_enabled)
                        exists.org_code = getattr(exists, "org_code", None) or ROOT_ORG_CODE
                        exists.scope_level = "GLOBAL"
                        exists.share_policy = "SHARED_READONLY"
                        exists.allow_sub_org_use = True
                        exists.allow_copy = False
                        exists.is_system_base = True
                        exists.updated_by = "system"
    
                legacy_combined_skill = db.query(RecruitmentSkill).filter(RecruitmentSkill.skill_code == "skill-iot-resume-screener").first()
                split_screening_skill = db.query(RecruitmentSkill).filter(RecruitmentSkill.skill_code == "skill-iot-screening-score", RecruitmentSkill.deleted.is_(False)).first()
                split_interview_skill = db.query(RecruitmentSkill).filter(RecruitmentSkill.skill_code == "skill-iot-interview-question", RecruitmentSkill.deleted.is_(False)).first()
                if legacy_combined_skill and split_screening_skill and split_interview_skill and not legacy_combined_skill.deleted and (legacy_combined_skill.updated_by or "system") == "system":
                    legacy_combined_skill.is_enabled = False
                    legacy_combined_skill.updated_by = "system"
    
                # 停用旧的系统自动 seed 的 LLM 配置（gemini、glm 模板等）
                for seeded_config in db.query(RecruitmentLLMConfig).filter(
                    RecruitmentLLMConfig.created_by == "system",
                    RecruitmentLLMConfig.is_active.is_(True),
                ).all():
                    seeded_config.is_active = False
                    seeded_config.updated_by = "system"
    
                db.commit()
    
                default_position_links: list[tuple[str, list[str]]] = []
                skill_rows = {
                    row.skill_code: row
                    for row in db.query(RecruitmentSkill).filter(RecruitmentSkill.deleted.is_(False)).all()
                }
                for title, skill_codes in default_position_links:
                    position = db.query(RecruitmentPosition).filter(RecruitmentPosition.deleted.is_(False), RecruitmentPosition.title == title).first()
                    if not position:
                        continue
                    existing_ids = {
                        row.skill_id
                        for row in db.query(RecruitmentPositionSkillLink).filter(RecruitmentPositionSkillLink.position_id == position.id).all()
                    }
                    for skill_code in skill_codes:
                        skill = skill_rows.get(skill_code)
                        if skill and skill.id not in existing_ids:
                            db.add(RecruitmentPositionSkillLink(position_id=position.id, skill_id=skill.id, created_by="system", updated_by="system"))
                    legacy_skill = skill_rows.get("skill-iot-resume-screener")
                    if legacy_skill:
                        db.query(RecruitmentPositionSkillLink).filter(
                            RecruitmentPositionSkillLink.position_id == position.id,
                            RecruitmentPositionSkillLink.skill_id == legacy_skill.id,
                        ).delete(synchronize_session=False)
                    db.commit()
    
                all_skill_rows = {
                    row.id: row
                    for row in db.query(RecruitmentSkill).filter(RecruitmentSkill.deleted.is_(False)).all()
                }
                for skill_row in all_skill_rows.values():
                    pack_meta = _extract_schema_skill_pack_meta(skill_row)
                    if not skill_row.skill_group and pack_meta["group"]:
                        skill_row.skill_group = pack_meta["group"]
                    if not skill_row.version and pack_meta["version"]:
                        skill_row.version = pack_meta["version"]
                    db.add(skill_row)
                db.commit()
                positions = db.query(RecruitmentPosition).filter(RecruitmentPosition.deleted.is_(False)).all()
                for position in positions:
                    if (
                        position.jd_skill_ids_json is not None
                        and position.screening_skill_ids_json is not None
                        and position.interview_skill_ids_json is not None
                    ):
                        continue
                    linked_ids = [
                        row.skill_id
                        for row in db.query(RecruitmentPositionSkillLink)
                        .filter(RecruitmentPositionSkillLink.position_id == position.id)
                        .order_by(RecruitmentPositionSkillLink.id.asc())
                        .all()
                    ]
                    jd_ids: list[int] = []
                    screening_ids: list[int] = []
                    interview_ids: list[int] = []
                    for skill_id in linked_ids:
                        skill = all_skill_rows.get(skill_id)
                        if not skill:
                            continue
                        tasks = _extract_schema_skill_tasks(skill)
                        if "jd" in tasks and skill_id not in jd_ids:
                            jd_ids.append(skill_id)
                        if "screening" in tasks and skill_id not in screening_ids:
                            screening_ids.append(skill_id)
                        if "interview" in tasks and skill_id not in interview_ids:
                            interview_ids.append(skill_id)
                    if position.jd_skill_ids_json is None:
                        position.jd_skill_ids_json = json.dumps(jd_ids, ensure_ascii=False)
                    if position.screening_skill_ids_json is None:
                        position.screening_skill_ids_json = json.dumps(screening_ids, ensure_ascii=False)
                    if position.interview_skill_ids_json is None:
                        position.interview_skill_ids_json = json.dumps(interview_ids, ensure_ascii=False)
                    db.add(position)
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

        _recruitment_schema_ensured = True
