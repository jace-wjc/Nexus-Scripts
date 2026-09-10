import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from ..permission_governance import DATA_SCOPE_ALL, DATA_SCOPE_ORG_ONLY, expand_permission_aliases
from ..rbac_catalog import ALL_PERMISSION_KEYS, ROLE_INDEX, normalize_role_code
from ..rbac_models import (
    ScriptHubPermission,
    ScriptHubRole,
    ScriptHubRolePermission,
    ScriptHubUser,
    ScriptHubUserPermission,
    ScriptHubUserRole,
)

PBKDF2_ITERATIONS = 310_000


def _compute_lookup_hash(access_key: str) -> str:
    return hashlib.sha256(access_key.encode("utf-8")).hexdigest()


def _hash_access_key(access_key: str, salt: Optional[bytes] = None) -> Tuple[str, str]:
    salt_bytes = salt or os.urandom(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        access_key.encode("utf-8"),
        salt_bytes,
        PBKDF2_ITERATIONS,
    )
    return (
        base64.b64encode(salt_bytes).decode("utf-8"),
        base64.b64encode(derived).decode("utf-8"),
    )


def create_access_key_material(access_key: str) -> Dict[str, str]:
    salt_b64, hash_b64 = _hash_access_key(access_key)
    return {
        "lookup_hash": _compute_lookup_hash(access_key),
        "salt": salt_b64,
        "hash": hash_b64,
    }


def verify_access_key(access_key: str, salt_b64: str, hash_b64: str) -> bool:
    try:
        salt_bytes = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        access_key.encode("utf-8"),
        salt_bytes,
        PBKDF2_ITERATIONS,
    )
    return hmac.compare_digest(actual, expected)


def load_roles_for_user(db: Session, user_id: int) -> List[ScriptHubRole]:
    return (
        db.query(ScriptHubRole)
        .join(ScriptHubUserRole, ScriptHubUserRole.role_id == ScriptHubRole.id)
        .filter(
            ScriptHubUserRole.user_id == user_id,
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
        )
        .order_by(ScriptHubRole.sort_order.asc(), ScriptHubRole.role_code.asc())
        .all()
    )


def load_user_permission_overrides(db: Session, user_id: int) -> List[Tuple[str, bool]]:
    rows = (
        db.query(ScriptHubPermission.permission_key, ScriptHubUserPermission.is_granted)
        .join(ScriptHubUserPermission, ScriptHubUserPermission.permission_id == ScriptHubPermission.id)
        .filter(ScriptHubUserPermission.user_id == user_id)
        .all()
    )
    return [(permission_key, bool(is_granted)) for permission_key, is_granted in rows]


def build_permission_map(
    db: Session,
    user: ScriptHubUser,
    *,
    preloaded_roles: Optional[List[ScriptHubRole]] = None,
    preloaded_overrides: Optional[List[Tuple[str, bool]]] = None,
) -> Dict[str, bool]:
    roles = preloaded_roles if preloaded_roles is not None else load_roles_for_user(db, user.id)
    role_codes = {role.role_code for role in roles}
    granted: Dict[str, bool] = {}
    if user.is_super_admin or "admin" in role_codes:
        granted.update({permission_key: True for permission_key in ALL_PERMISSION_KEYS})
    elif roles:
        rows = (
            db.query(ScriptHubPermission.permission_key)
            .join(ScriptHubRolePermission, ScriptHubRolePermission.permission_id == ScriptHubPermission.id)
            .filter(ScriptHubRolePermission.role_id.in_([role.id for role in roles]))
            .distinct()
            .all()
        )
        granted.update({permission_key: True for permission_key, in rows})

    overrides = preloaded_overrides if preloaded_overrides is not None else load_user_permission_overrides(db, user.id)
    for permission_key, is_granted in overrides:
        if is_granted:
            granted[permission_key] = True
        else:
            granted.pop(permission_key, None)

    return expand_permission_aliases(granted)


def resolve_primary_role(role_codes: Iterable[str]) -> str:
    normalized = [role_code for role_code in role_codes if role_code]
    if not normalized:
        return "custom"
    if "admin" in normalized:
        return "admin"

    ordered = sorted(
        normalized,
        key=lambda role_code: (
            ROLE_INDEX.get(role_code).sort_order if role_code in ROLE_INDEX else 999,
            role_code,
        ),
    )
    return ordered[0]


def serialize_user_session(db: Session, user: ScriptHubUser) -> Dict[str, Any]:
    roles = load_roles_for_user(db, user.id)
    role_codes = [role.role_code for role in roles]
    primary_role = resolve_primary_role(role_codes)
    session_data_scope = (
        DATA_SCOPE_ALL
        if user.is_super_admin or "admin" in role_codes
        else user.data_scope or DATA_SCOPE_ORG_ONLY
    )
    # 根据角色配置决定默认首页（从数据库读取，而非硬编码 catalog）
    primary_role_record = next((r for r in roles if r.role_code == primary_role), None)
    stored_landing_page = getattr(primary_role_record, "landing_page", None)
    landing_page = stored_landing_page if stored_landing_page is not None else "home"
    recruitment_menu_grouped = getattr(primary_role_record, "recruitment_menu_grouped", True)
    return {
        "id": user.user_code,
        "role": primary_role,
        "roles": role_codes,
        "name": user.display_name,
        "permissions": build_permission_map(db, user, preloaded_roles=roles),
        "isSuperAdmin": bool(user.is_super_admin),
        "primaryOrgCode": user.primary_org_code or "group",
        "dataScope": session_data_scope,
        "customOrgCodes": json_loads_safe(user.custom_org_codes_json, []),
        "authorizationBoundary": json_loads_safe(user.authorization_boundary_json, {}),
        "permissionVersion": int(user.permission_version or 1),
        "accessKeyVersion": int(getattr(user, "access_key_version", 1) or 1),
        "teamResourcesLoginKeyEnabled": bool(user.team_resources_access_enabled),
        "landingPage": landing_page,
        "recruitmentMenuGrouped": bool(recruitment_menu_grouped),
    }


def json_loads_safe(value: Optional[str], fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        parsed = json.loads(value)
    except Exception:
        return fallback
    return parsed


def get_active_user_by_code(db: Session, user_code: str) -> Optional[ScriptHubUser]:
    return (
        db.query(ScriptHubUser)
        .filter(
            ScriptHubUser.user_code == user_code,
            ScriptHubUser.is_active.is_(True),
            ScriptHubUser.is_deleted.is_(False),
        )
        .first()
    )


def authenticate_access_key(db: Session, access_key: str) -> Optional[Dict[str, Any]]:
    access_key = (access_key or "").strip()
    if not access_key:
        return None

    user = (
        db.query(ScriptHubUser)
        .filter(
            ScriptHubUser.access_key_lookup_hash == _compute_lookup_hash(access_key),
            ScriptHubUser.is_active.is_(True),
            ScriptHubUser.is_deleted.is_(False),
        )
        .first()
    )
    if not user:
        return None

    if not verify_access_key(access_key, user.access_key_salt, user.access_key_hash):
        return None

    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(user)
    return serialize_user_session(db, user)


def get_session_user_by_code(db: Session, user_code: str) -> Optional[Dict[str, Any]]:
    user = get_active_user_by_code(db, user_code)
    if not user:
        return None
    return serialize_user_session(db, user)
