import secrets
import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, load_only

from ..permission_governance import (
    DATA_SCOPE_ALL,
    DATA_SCOPE_CUSTOM_ORGS,
    DATA_SCOPE_ORG_AND_CHILDREN,
    DATA_SCOPE_ORG_ONLY,
    DATA_SCOPE_SELF,
    LEGACY_RECRUITMENT_MANAGE_PERMISSIONS,
    LEGACY_RECRUITMENT_VIEW_PERMISSIONS,
    build_permission_context,
    expand_permission_aliases,
    normalize_data_scope,
    normalize_org_code,
    normalize_org_code_list,
)
from ..rbac_catalog import ALL_PERMISSION_KEYS, DEPRECATED_PERMISSION_KEYS
from ..rbac_models import (
    ScriptHubOrganization,
    ScriptHubAuditLog,
    ScriptHubPermission,
    ScriptHubRole,
    ScriptHubRolePermission,
    ScriptHubUser,
    ScriptHubUserPermission,
    ScriptHubUserRole,
)
from ..script_hub_session import invalidate_script_hub_session_refresh_cache
from .script_hub_auth_service import (
    build_permission_map,
    create_access_key_material,
    load_roles_for_user,
    load_user_permission_overrides,
    resolve_primary_role,
)
from .script_hub_audit_service import (
    list_recent_audit_logs,
    serialize_audit_log,
)
from ..rbac_schemas import ORG_CODE_RE, ROLE_CODE_RE, USER_CODE_RE


def _normalize_user_code(user_code: str) -> str:
    normalized = (user_code or "").strip().lower()
    if not USER_CODE_RE.match(normalized):
        raise ValueError("User code must use lowercase letters, numbers, dots, underscores, or hyphens")
    return normalized


def _normalize_org_code_for_mutation(org_code: str) -> str:
    normalized = (org_code or "").strip().lower()
    if not ORG_CODE_RE.match(normalized):
        raise ValueError("Organization code must use lowercase letters, numbers, dots, underscores, or hyphens")
    return normalized


def _normalize_org_type(org_type: Optional[str]) -> str:
    normalized = (org_type or "company").strip().lower()
    allowed = {"group", "sub_group", "company", "department"}
    if normalized not in allowed:
        raise ValueError("Invalid organization type")
    return normalized


def _normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _case_insensitive_contains(column: Any, value: str):
    return func.lower(column).contains(value.lower(), autoescape=True)


def _generate_access_key() -> str:
    return f"sh_{secrets.token_urlsafe(24).replace('-', 'A').replace('_', 'B')[:28]}"


class RbacMutationConflictError(ValueError):
    pass


RBAC_CONFIG_PERMISSION_KEYS = frozenset(
    {
        "recruitment-mail-config-manage",
        "recruitment-mail-sender-manage",
        "recruitment-skill-manage",
        "recruitment-llm-config-manage",
        "resource-sharing-manage",
    }
)

_ADMIN_USER_LIST_COLUMNS = (
    ScriptHubUser.id,
    ScriptHubUser.user_code,
    ScriptHubUser.display_name,
    ScriptHubUser.primary_org_code,
    ScriptHubUser.data_scope,
    ScriptHubUser.custom_org_codes_json,
    ScriptHubUser.authorization_boundary_json,
    ScriptHubUser.permission_version,
    ScriptHubUser.team_resources_access_enabled,
    ScriptHubUser.is_super_admin,
    ScriptHubUser.is_active,
    ScriptHubUser.notes,
    ScriptHubUser.last_login_at,
    ScriptHubUser.created_at,
    ScriptHubUser.updated_at,
)

_ADMIN_ROLE_LIST_COLUMNS = (
    ScriptHubRole.id,
    ScriptHubRole.role_code,
    ScriptHubRole.name,
    ScriptHubRole.description,
    ScriptHubRole.sort_order,
    ScriptHubRole.is_system,
    ScriptHubRole.is_active,
    ScriptHubRole.landing_page,
    ScriptHubRole.recruitment_menu_grouped,
)

_ADMIN_ORGANIZATION_LIST_COLUMNS = (
    ScriptHubOrganization.org_code,
    ScriptHubOrganization.name,
    ScriptHubOrganization.org_type,
    ScriptHubOrganization.parent_org_code,
    ScriptHubOrganization.path,
    ScriptHubOrganization.sort_order,
    ScriptHubOrganization.is_active,
    ScriptHubOrganization.is_deleted,
)

_ADMIN_PERMISSION_LIST_COLUMNS = (
    ScriptHubPermission.permission_key,
    ScriptHubPermission.name,
    ScriptHubPermission.category,
    ScriptHubPermission.description,
    ScriptHubPermission.sort_order,
)


def _json_dumps_safe(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _json_loads_safe(value: Optional[str], fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        parsed = json.loads(value)
    except Exception:
        return fallback
    return parsed


def _serialize_organization(row: ScriptHubOrganization) -> Dict[str, object]:
    return {
        "org_code": row.org_code,
        "name": row.name,
        "org_type": row.org_type,
        "parent_org_code": row.parent_org_code,
        "path": row.path,
        "sort_order": row.sort_order,
        "is_active": bool(row.is_active),
        "is_deleted": bool(getattr(row, "is_deleted", False)),
    }


def _list_organizations(db: Session) -> List[Dict[str, object]]:
    return [
        _serialize_organization(row)
        for row in db.query(ScriptHubOrganization)
        .options(load_only(*_ADMIN_ORGANIZATION_LIST_COLUMNS))
        .filter(ScriptHubOrganization.is_deleted.is_(False))
        .order_by(ScriptHubOrganization.path.asc(), ScriptHubOrganization.is_active.desc(), ScriptHubOrganization.sort_order.asc(), ScriptHubOrganization.org_code.asc())
        .all()
    ]


def _get_org_row(db: Session, org_code: str) -> Optional[ScriptHubOrganization]:
    return db.query(ScriptHubOrganization).filter(ScriptHubOrganization.org_code == normalize_org_code(org_code)).first()


def _ensure_org_exists(db: Session, org_code: str) -> str:
    normalized = normalize_org_code(org_code)
    if normalized == "group" and not db.query(ScriptHubOrganization).filter(ScriptHubOrganization.org_code == normalized).first():
        db.add(
            ScriptHubOrganization(
                org_code="group",
                name="集团总部",
                org_type="group",
                parent_org_code=None,
                path="group",
                sort_order=10,
                is_active=True,
            )
        )
        db.flush()
    if not db.query(ScriptHubOrganization).filter(ScriptHubOrganization.org_code == normalized, ScriptHubOrganization.is_active.is_(True)).first():
        raise ValueError(f"Unknown organization: {normalized}")
    return normalized


def _data_scope_rank(value: str) -> int:
    return {
        DATA_SCOPE_ALL: 50,
        DATA_SCOPE_ORG_AND_CHILDREN: 40,
        DATA_SCOPE_CUSTOM_ORGS: 30,
        DATA_SCOPE_ORG_ONLY: 20,
        DATA_SCOPE_SELF: 10,
    }.get(normalize_data_scope(value), 20)


def _is_data_scope_downgrade(
    *,
    current_scope: str,
    next_scope: str,
    current_custom_orgs: Iterable[str],
    next_custom_orgs: Iterable[str],
) -> bool:
    if _data_scope_rank(next_scope) < _data_scope_rank(current_scope):
        return True
    if normalize_data_scope(current_scope) == DATA_SCOPE_CUSTOM_ORGS and normalize_data_scope(next_scope) == DATA_SCOPE_CUSTOM_ORGS:
        return not set(next_custom_orgs).issuperset(set(current_custom_orgs))
    return False


def _actor_has_unbounded_grant(actor: Optional[Dict[str, Any]]) -> bool:
    if not actor:
        return True
    roles = set(actor.get("roles") or [])
    return bool(actor.get("isSuperAdmin")) or "admin" in roles


def _boundary_allows_grant(boundary: Dict[str, Any]) -> bool:
    return bool(boundary.get("allow_grant") or boundary.get("can_grant"))


def _boundary_managed_org_codes(boundary: Dict[str, Any]) -> Set[str]:
    return set(normalize_org_code_list(boundary.get("managed_org_codes") or boundary.get("manageable_org_codes") or []))


def _boundary_assignable_role_codes(boundary: Dict[str, Any]) -> Set[str]:
    return set(str(item or "").strip() for item in boundary.get("assignable_role_codes") or [])


def _boundary_assignable_permission_keys(boundary: Dict[str, Any]) -> Set[str]:
    return set(str(item or "").strip() for item in boundary.get("assignable_permission_keys") or [])


def _validate_org_codes_within_actor_boundary(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]],
    org_codes: Iterable[str],
    error_prefix: str,
) -> None:
    if _actor_has_unbounded_grant(actor):
        return

    context = build_permission_context(db, actor)
    boundary = actor.get("authorizationBoundary") if actor else {}
    if not isinstance(boundary, dict) or not _boundary_allows_grant(boundary):
        raise ValueError("Actor is not allowed to grant permissions")

    managed_orgs = _boundary_managed_org_codes(boundary)
    visible_orgs = set(context.visible_org_codes or ())
    for org_code in {normalize_org_code(item) for item in org_codes if normalize_org_code(item)}:
        if managed_orgs and org_code not in managed_orgs:
            raise ValueError(f"{error_prefix} is outside the actor authorization boundary")
        if not context.has_all_orgs and org_code not in visible_orgs:
            raise ValueError(f"{error_prefix} is outside the actor data scope")


def _validate_target_authorization_boundary(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]],
    target_boundary: Optional[Dict[str, Any]],
) -> None:
    if _actor_has_unbounded_grant(actor) or not target_boundary:
        return

    if not isinstance(target_boundary, dict):
        raise ValueError("Target authorization boundary is invalid")

    if not _boundary_allows_grant(target_boundary):
        return

    actor_boundary = actor.get("authorizationBoundary") if actor else {}
    if not isinstance(actor_boundary, dict) or not _boundary_allows_grant(actor_boundary):
        raise ValueError("Actor is not allowed to grant permissions")

    target_managed_orgs = _boundary_managed_org_codes(target_boundary)
    if target_managed_orgs:
        _validate_org_codes_within_actor_boundary(
            db,
            actor=actor,
            org_codes=target_managed_orgs,
            error_prefix="Target authorization boundary organization",
        )

    actor_assignable_roles = _boundary_assignable_role_codes(actor_boundary)
    target_assignable_roles = _boundary_assignable_role_codes(target_boundary)
    if "admin" in target_assignable_roles and "admin" not in actor_assignable_roles:
        raise ValueError("Target authorization boundary role assignment exceeds actor authorization boundary")
    if actor_assignable_roles and not target_assignable_roles.issubset(actor_assignable_roles):
        raise ValueError("Target authorization boundary role assignment exceeds actor authorization boundary")

    actor_assignable_permissions = _boundary_assignable_permission_keys(actor_boundary)
    target_assignable_permissions = _boundary_assignable_permission_keys(target_boundary)
    if actor_assignable_permissions and not target_assignable_permissions.issubset(actor_assignable_permissions):
        raise ValueError("Target authorization boundary permission grant exceeds actor authorization boundary")

    actor_max_data_scope = normalize_data_scope(actor_boundary.get("max_data_scope") or DATA_SCOPE_SELF)
    target_max_data_scope = normalize_data_scope(target_boundary.get("max_data_scope") or DATA_SCOPE_SELF)
    if _data_scope_rank(target_max_data_scope) > _data_scope_rank(actor_max_data_scope):
        raise ValueError("Target authorization boundary data scope exceeds actor authorization boundary")


def _validate_org_mutation_boundary(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]],
    target_org_code: str,
    parent_org_code: Optional[str] = None,
) -> None:
    if _actor_has_unbounded_grant(actor):
        return

    context = build_permission_context(db, actor)
    boundary = actor.get("authorizationBoundary") if actor else {}
    if not isinstance(boundary, dict) or not _boundary_allows_grant(boundary):
        raise ValueError("Actor is not allowed to manage organizations")

    checked_org_codes = [normalize_org_code(target_org_code)]
    if parent_org_code:
        checked_org_codes.append(normalize_org_code(parent_org_code))

    managed_orgs = _boundary_managed_org_codes(boundary)
    visible_orgs = set(context.visible_org_codes or ())
    for org_code in checked_org_codes:
        if managed_orgs and org_code not in managed_orgs:
            raise ValueError("Organization is outside the actor authorization boundary")
        if not context.has_all_orgs and org_code not in visible_orgs:
            raise ValueError("Organization is outside the actor data scope")


def _validate_authorization_boundary(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]],
    target_org_code: str,
    custom_org_codes: Iterable[str],
    target_authorization_boundary: Optional[Dict[str, Any]],
    role_codes: Iterable[str],
    granted_permissions: Iterable[str],
    revoked_permissions: Iterable[str],
    data_scope: str,
    is_super_admin: bool,
) -> None:
    if _actor_has_unbounded_grant(actor):
        return

    if is_super_admin:
        raise ValueError("Super admin grant exceeds actor authorization boundary")

    context = build_permission_context(db, actor)
    boundary = actor.get("authorizationBoundary") if actor else {}
    if not isinstance(boundary, dict) or not _boundary_allows_grant(boundary):
        raise ValueError("Actor is not allowed to grant permissions")

    managed_orgs = _boundary_managed_org_codes(boundary)
    if managed_orgs and target_org_code not in managed_orgs:
        raise ValueError("Target organization is outside the actor authorization boundary")

    if not context.has_all_orgs and target_org_code not in set(context.visible_org_codes or ()):
        raise ValueError("Target organization is outside the actor data scope")

    _validate_org_codes_within_actor_boundary(
        db,
        actor=actor,
        org_codes=custom_org_codes,
        error_prefix="Custom organization",
    )
    _validate_target_authorization_boundary(
        db,
        actor=actor,
        target_boundary=target_authorization_boundary,
    )

    assignable_roles = _boundary_assignable_role_codes(boundary)
    if "admin" in set(role_codes) and "admin" not in assignable_roles:
        raise ValueError("Role assignment exceeds actor authorization boundary")
    if assignable_roles and not set(role_codes).issubset(assignable_roles):
        raise ValueError("Role assignment exceeds actor authorization boundary")

    assignable_permissions = _boundary_assignable_permission_keys(boundary)
    if assignable_permissions and not set(granted_permissions).issubset(assignable_permissions):
        raise ValueError("Permission grant exceeds actor authorization boundary")
    if assignable_permissions and not set(revoked_permissions).issubset(assignable_permissions):
        raise ValueError("Permission revocation exceeds actor authorization boundary")

    max_data_scope = normalize_data_scope(boundary.get("max_data_scope") or DATA_SCOPE_SELF)
    if _data_scope_rank(data_scope) > _data_scope_rank(max_data_scope):
        raise ValueError("Data scope exceeds actor authorization boundary")


def _validate_role_mutation_boundary(
    *,
    actor: Optional[Dict[str, Any]],
    permission_keys: Iterable[str],
) -> None:
    if _actor_has_unbounded_grant(actor):
        return

    boundary = actor.get("authorizationBoundary") if actor else {}
    if not isinstance(boundary, dict) or not _boundary_allows_grant(boundary):
        raise ValueError("Actor is not allowed to grant permissions")

    assignable_permissions = _boundary_assignable_permission_keys(boundary)
    if assignable_permissions and not set(permission_keys).issubset(assignable_permissions):
        raise ValueError("Role permission assignment exceeds actor authorization boundary")


def _validate_user_target_boundary(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]],
    user: ScriptHubUser,
) -> None:
    if _actor_has_unbounded_grant(actor):
        return

    role_codes = [role.role_code for role in load_roles_for_user(db, user.id)]
    granted_permissions = []
    revoked_permissions = []
    for permission_key, is_granted in load_user_permission_overrides(db, user.id):
        if is_granted:
            granted_permissions.append(permission_key)
        else:
            revoked_permissions.append(permission_key)

    _validate_authorization_boundary(
        db,
        actor=actor,
        target_org_code=normalize_org_code(user.primary_org_code),
        custom_org_codes=normalize_org_code_list(user.custom_org_codes_json),
        target_authorization_boundary=_json_loads_safe(user.authorization_boundary_json, {}),
        role_codes=role_codes,
        granted_permissions=granted_permissions,
        revoked_permissions=revoked_permissions,
        data_scope=normalize_data_scope(user.data_scope),
        is_super_admin=bool(user.is_super_admin),
    )


def _permission_rows(db: Session) -> Dict[str, ScriptHubPermission]:
    return {
        permission.permission_key: permission
        for permission in db.query(ScriptHubPermission).filter(ScriptHubPermission.is_active.is_(True)).all()
    }


def _role_rows(db: Session) -> Dict[str, ScriptHubRole]:
    return {
        role.role_code: role
        for role in db.query(ScriptHubRole).filter(
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
        ).all()
    }


def _normalize_role_codes(role_codes: Iterable[str], available_roles: Dict[str, ScriptHubRole]) -> List[str]:
    normalized = sorted({str(role_code).strip() for role_code in role_codes if str(role_code).strip()})
    if not normalized:
        raise ValueError("At least one role is required")

    invalid = [role_code for role_code in normalized if role_code not in available_roles]
    if invalid:
        raise ValueError(f"Unknown roles: {', '.join(invalid)}")
    return normalized


def _normalize_permission_keys(permission_keys: Iterable[str], available_permissions: Dict[str, ScriptHubPermission]) -> List[str]:
    normalized = sorted({str(permission_key).strip() for permission_key in permission_keys if str(permission_key).strip()})
    # Silently strip deprecated keys that may still exist in legacy role data.
    # They are no longer assignable but should not cause errors when editing old roles.
    normalized = [key for key in normalized if key not in DEPRECATED_PERMISSION_KEYS]
    invalid = [permission_key for permission_key in normalized if permission_key not in available_permissions]
    if invalid:
        raise ValueError(f"Unknown permissions: {', '.join(invalid)}")
    return normalized


def _normalize_role_code(role_code: str) -> str:
    normalized = (role_code or "").strip().lower()
    if not ROLE_CODE_RE.match(normalized):
        raise ValueError("Role code must use lowercase letters, numbers, dots, underscores, or hyphens")
    return normalized


def _set_user_roles(db: Session, user_id: int, role_codes: List[str], role_rows: Dict[str, ScriptHubRole]):
    db.query(ScriptHubUserRole).filter(ScriptHubUserRole.user_id == user_id).delete()
    for role_code in role_codes:
        db.add(ScriptHubUserRole(user_id=user_id, role_id=role_rows[role_code].id))


def _set_user_permission_overrides(
    db: Session,
    user_id: int,
    granted_permissions: List[str],
    revoked_permissions: List[str],
    permission_rows: Dict[str, ScriptHubPermission],
):
    overlap = sorted(set(granted_permissions) & set(revoked_permissions))
    if overlap:
        raise ValueError(f"Permissions cannot be both granted and revoked: {', '.join(overlap)}")

    db.query(ScriptHubUserPermission).filter(ScriptHubUserPermission.user_id == user_id).delete()

    for permission_key in granted_permissions:
        db.add(
            ScriptHubUserPermission(
                user_id=user_id,
                permission_id=permission_rows[permission_key].id,
                is_granted=True,
            )
        )

    for permission_key in revoked_permissions:
        db.add(
            ScriptHubUserPermission(
                user_id=user_id,
                permission_id=permission_rows[permission_key].id,
                is_granted=False,
            )
        )


def _serialize_role_permission_keys(db: Session, role_ids: List[int]) -> List[str]:
    if not role_ids:
        return []

    rows = (
        db.query(ScriptHubPermission.permission_key)
        .join(ScriptHubRolePermission, ScriptHubRolePermission.permission_id == ScriptHubPermission.id)
        .filter(ScriptHubRolePermission.role_id.in_(role_ids))
        .distinct()
        .all()
    )
    return sorted(permission_key for permission_key, in rows)


def _get_assigned_user_count(db: Session, role_id: int) -> int:
    return (
        db.query(ScriptHubUserRole)
        .join(ScriptHubUser, ScriptHubUser.id == ScriptHubUserRole.user_id)
        .filter(
            ScriptHubUserRole.role_id == role_id,
            ScriptHubUser.is_deleted.is_(False),
        )
        .count()
    )


def _load_role_permission_keys_by_role_id(
    db: Session,
    role_ids: Iterable[int],
) -> Dict[int, List[str]]:
    normalized_role_ids = sorted({int(role_id) for role_id in role_ids})
    if not normalized_role_ids:
        return {}

    rows = (
        db.query(ScriptHubRolePermission.role_id, ScriptHubPermission.permission_key)
        .join(ScriptHubPermission, ScriptHubPermission.id == ScriptHubRolePermission.permission_id)
        .filter(ScriptHubRolePermission.role_id.in_(normalized_role_ids))
        .order_by(ScriptHubPermission.permission_key.asc())
        .all()
    )
    result: Dict[int, List[str]] = {role_id: [] for role_id in normalized_role_ids}
    for role_id, permission_key in rows:
        result.setdefault(int(role_id), []).append(permission_key)
    return result


def _load_assigned_user_counts_by_role_id(
    db: Session,
    role_ids: Iterable[int],
) -> Dict[int, int]:
    normalized_role_ids = sorted({int(role_id) for role_id in role_ids})
    if not normalized_role_ids:
        return {}

    rows = (
        db.query(ScriptHubUserRole.role_id, func.count(ScriptHubUserRole.user_id))
        .join(ScriptHubUser, ScriptHubUser.id == ScriptHubUserRole.user_id)
        .filter(
            ScriptHubUserRole.role_id.in_(normalized_role_ids),
            ScriptHubUser.is_deleted.is_(False),
        )
        .group_by(ScriptHubUserRole.role_id)
        .all()
    )
    return {int(role_id): int(count or 0) for role_id, count in rows}


def _serialize_admin_roles_bulk(
    db: Session,
    roles: Iterable[ScriptHubRole],
) -> List[Dict[str, object]]:
    role_rows = list(roles)
    permission_keys_by_role_id = _load_role_permission_keys_by_role_id(
        db,
        [role.id for role in role_rows],
    )
    assigned_counts_by_role_id = _load_assigned_user_counts_by_role_id(
        db,
        [role.id for role in role_rows],
    )
    serialized_roles: List[Dict[str, object]] = []
    for role in role_rows:
        landing_page = getattr(role, "landing_page", None)
        serialized_roles.append(
            {
                "code": role.role_code,
                "name": role.name,
                "description": role.description or "",
                "sort_order": role.sort_order,
                "permission_keys": permission_keys_by_role_id.get(role.id, []),
                "is_system": bool(role.is_system),
                "is_active": bool(role.is_active),
                "assigned_user_count": assigned_counts_by_role_id.get(role.id, 0),
                "landing_page": landing_page if landing_page is not None else "home",
                "recruitment_menu_grouped": bool(getattr(role, "recruitment_menu_grouped", True)),
            }
        )
    return serialized_roles


def _load_admin_user_preloads(
    db: Session,
    user_ids: Iterable[int],
) -> Tuple[
    Dict[int, List[str]],
    Dict[int, List[Tuple[str, bool]]],
    Dict[int, List[str]],
]:
    normalized_user_ids = sorted({int(user_id) for user_id in user_ids})
    if not normalized_user_ids:
        return {}, {}, {}

    role_rows = (
        db.query(
            ScriptHubUserRole.user_id,
            ScriptHubRole.id,
            ScriptHubRole.role_code,
        )
        .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
        .filter(
            ScriptHubUserRole.user_id.in_(normalized_user_ids),
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
        )
        .order_by(
            ScriptHubUserRole.user_id.asc(),
            ScriptHubRole.sort_order.asc(),
            ScriptHubRole.role_code.asc(),
        )
        .all()
    )
    role_codes_by_user_id: Dict[int, List[str]] = {
        user_id: [] for user_id in normalized_user_ids
    }
    role_ids_by_user_id: Dict[int, List[int]] = {
        user_id: [] for user_id in normalized_user_ids
    }
    all_role_ids: Set[int] = set()
    for user_id, role_id, role_code in role_rows:
        normalized_user_id = int(user_id)
        normalized_role_id = int(role_id)
        role_codes_by_user_id[normalized_user_id].append(role_code)
        role_ids_by_user_id[normalized_user_id].append(normalized_role_id)
        all_role_ids.add(normalized_role_id)

    permission_keys_by_role_id = _load_role_permission_keys_by_role_id(db, all_role_ids)
    role_permission_keys_by_user_id: Dict[int, List[str]] = {}
    for user_id in normalized_user_ids:
        permission_keys: Set[str] = set()
        for role_id in role_ids_by_user_id[user_id]:
            permission_keys.update(permission_keys_by_role_id.get(role_id, []))
        role_permission_keys_by_user_id[user_id] = sorted(permission_keys)

    override_rows = (
        db.query(
            ScriptHubUserPermission.user_id,
            ScriptHubPermission.permission_key,
            ScriptHubUserPermission.is_granted,
        )
        .join(ScriptHubPermission, ScriptHubPermission.id == ScriptHubUserPermission.permission_id)
        .filter(ScriptHubUserPermission.user_id.in_(normalized_user_ids))
        .all()
    )
    overrides_by_user_id: Dict[int, List[Tuple[str, bool]]] = {
        user_id: [] for user_id in normalized_user_ids
    }
    for user_id, permission_key, is_granted in override_rows:
        overrides_by_user_id[int(user_id)].append((permission_key, bool(is_granted)))

    return (
        role_codes_by_user_id,
        overrides_by_user_id,
        role_permission_keys_by_user_id,
    )


def _serialize_admin_users_bulk(
    db: Session,
    users: Iterable[ScriptHubUser],
) -> List[Dict[str, object]]:
    user_rows = list(users)
    (
        role_codes_by_user_id,
        overrides_by_user_id,
        role_permission_keys_by_user_id,
    ) = _load_admin_user_preloads(db, [user.id for user in user_rows])

    serialized_users: List[Dict[str, object]] = []
    for user in user_rows:
        role_codes = role_codes_by_user_id.get(user.id, [])
        role_permission_keys = role_permission_keys_by_user_id.get(user.id, [])
        overrides = overrides_by_user_id.get(user.id, [])
        granted_overrides = sorted(
            permission_key
            for permission_key, is_granted in overrides
            if is_granted
        )
        revoked_overrides = sorted(
            permission_key
            for permission_key, is_granted in overrides
            if not is_granted
        )

        if user.is_super_admin or "admin" in set(role_codes):
            effective_permissions = set(ALL_PERMISSION_KEYS)
        else:
            effective_permissions = set(role_permission_keys)
        effective_permissions.update(granted_overrides)
        effective_permissions.difference_update(revoked_overrides)
        effective_permission_keys = sorted(
            expand_permission_aliases(
                {permission_key: True for permission_key in effective_permissions}
            ).keys()
        )

        serialized_users.append(
            {
                "user_code": user.user_code,
                "display_name": user.display_name,
                "primary_org_code": user.primary_org_code or "group",
                "data_scope": normalize_data_scope(user.data_scope),
                "custom_org_codes": normalize_org_code_list(user.custom_org_codes_json),
                "authorization_boundary": _json_loads_safe(user.authorization_boundary_json, {}),
                "permission_version": int(user.permission_version or 1),
                "primary_role": resolve_primary_role(role_codes),
                "role_codes": role_codes,
                "role_permission_keys": role_permission_keys,
                "granted_overrides": granted_overrides,
                "revoked_overrides": revoked_overrides,
                "effective_permission_keys": effective_permission_keys,
                "team_resources_login_key_enabled": bool(user.team_resources_access_enabled),
                "is_active": bool(user.is_active),
                "is_super_admin": bool(user.is_super_admin),
                "notes": user.notes,
                "last_login_at": user.last_login_at,
                "created_at": user.created_at,
                "updated_at": user.updated_at,
            }
        )
    return serialized_users


def serialize_admin_role(db: Session, role: ScriptHubRole) -> Dict[str, object]:
    landing_page = getattr(role, "landing_page", None)
    return {
        "code": role.role_code,
        "name": role.name,
        "description": role.description or "",
        "sort_order": role.sort_order,
        "permission_keys": _serialize_role_permission_keys(db, [role.id]),
        "is_system": bool(role.is_system),
        "is_active": bool(role.is_active),
        "assigned_user_count": _get_assigned_user_count(db, role.id),
        "landing_page": landing_page if landing_page is not None else "home",
        "recruitment_menu_grouped": bool(getattr(role, "recruitment_menu_grouped", True)),
    }


def serialize_admin_user(db: Session, user: ScriptHubUser) -> Dict[str, object]:
    roles = load_roles_for_user(db, user.id)
    role_codes = [role.role_code for role in roles]
    role_permission_keys = _serialize_role_permission_keys(db, [role.id for role in roles])
    overrides = load_user_permission_overrides(db, user.id)
    granted_overrides = sorted(permission_key for permission_key, is_granted in overrides if is_granted)
    revoked_overrides = sorted(permission_key for permission_key, is_granted in overrides if not is_granted)
    effective_permission_keys = sorted(build_permission_map(db, user).keys())

    return {
        "user_code": user.user_code,
        "display_name": user.display_name,
        "primary_org_code": user.primary_org_code or "group",
        "data_scope": normalize_data_scope(user.data_scope),
        "custom_org_codes": normalize_org_code_list(user.custom_org_codes_json),
        "authorization_boundary": _json_loads_safe(user.authorization_boundary_json, {}),
        "permission_version": int(user.permission_version or 1),
        "primary_role": resolve_primary_role(role_codes),
        "role_codes": role_codes,
        "role_permission_keys": role_permission_keys,
        "granted_overrides": granted_overrides,
        "revoked_overrides": revoked_overrides,
        "effective_permission_keys": effective_permission_keys,
        "team_resources_login_key_enabled": bool(user.team_resources_access_enabled),
        "is_active": bool(user.is_active),
        "is_super_admin": bool(user.is_super_admin),
        "notes": user.notes,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


def _is_admin_capable(db: Session, user: ScriptHubUser, role_codes: Optional[Iterable[str]] = None, is_super_admin: Optional[bool] = None) -> bool:
    effective_is_super_admin = user.is_super_admin if is_super_admin is None else bool(is_super_admin)
    effective_role_codes = set(role_codes or [role.role_code for role in load_roles_for_user(db, user.id)])
    return effective_is_super_admin or "admin" in effective_role_codes


def _count_other_active_admins(db: Session, excluded_user_id: int) -> int:
    count = 0
    users = db.query(ScriptHubUser).filter(ScriptHubUser.is_active.is_(True), ScriptHubUser.id != excluded_user_id).all()
    users = [
        user for user in users
        if not bool(user.is_deleted)
    ]
    for user in users:
        if _is_admin_capable(db, user):
            count += 1
    return count


def _guard_last_admin(db: Session, user: ScriptHubUser, next_is_active: bool, next_is_super_admin: bool, next_role_codes: List[str]):
    if next_is_active and _is_admin_capable(db, user, next_role_codes, next_is_super_admin):
        return

    if _count_other_active_admins(db, user.id) == 0:
        raise ValueError("At least one active administrator must remain in the system")


def _admin_user_query(db: Session):
    return (
        db.query(ScriptHubUser)
        .options(load_only(*_ADMIN_USER_LIST_COLUMNS))
        .filter(ScriptHubUser.is_deleted.is_(False))
    )


def _admin_role_rows(db: Session) -> List[ScriptHubRole]:
    return (
        db.query(ScriptHubRole)
        .options(load_only(*_ADMIN_ROLE_LIST_COLUMNS))
        .filter(ScriptHubRole.is_deleted.is_(False))
        .order_by(
            ScriptHubRole.is_active.desc(),
            ScriptHubRole.is_system.desc(),
            ScriptHubRole.sort_order.asc(),
            ScriptHubRole.role_code.asc(),
        )
        .all()
    )


def _admin_permission_items(db: Session) -> List[Dict[str, object]]:
    rows = (
        db.query(ScriptHubPermission)
        .options(load_only(*_ADMIN_PERMISSION_LIST_COLUMNS))
        .filter(ScriptHubPermission.is_active.is_(True))
        .order_by(
            ScriptHubPermission.sort_order.asc(),
            ScriptHubPermission.permission_key.asc(),
        )
        .all()
    )
    return [
        {
            "key": permission.permission_key,
            "name": permission.name,
            "category": permission.category,
            "description": permission.description or "",
            "sort_order": permission.sort_order,
        }
        for permission in rows
    ]


def _user_visible_to_context(user: ScriptHubUser, context: Any) -> bool:
    if context is None or context.has_all_orgs:
        return True
    visible_orgs = set(context.visible_org_codes or ())
    target_orgs = {normalize_org_code(user.primary_org_code)}
    target_orgs.update(normalize_org_code_list(user.custom_org_codes_json))
    return bool(target_orgs & visible_orgs) or user.user_code == context.actor_user_code


def _organization_visible_to_context(organization: Dict[str, object], context: Any) -> bool:
    if context is None or context.has_all_orgs:
        return True
    return normalize_org_code(organization.get("org_code")) in set(context.visible_org_codes or ())


def _visible_admin_user_rows(db: Session, context: Any) -> List[ScriptHubUser]:
    rows = (
        _admin_user_query(db)
        .order_by(ScriptHubUser.created_at.asc(), ScriptHubUser.user_code.asc())
        .all()
    )
    return [user for user in rows if _user_visible_to_context(user, context)]


def _visible_organization_items(
    db: Session,
    context: Any,
    *,
    include_primary_user_count: bool = False,
) -> List[Dict[str, object]]:
    organizations = [
        organization
        for organization in _list_organizations(db)
        if _organization_visible_to_context(organization, context)
    ]
    if not include_primary_user_count:
        return organizations

    visible_org_codes = {str(organization["org_code"]) for organization in organizations}
    if not visible_org_codes:
        return organizations
    count_rows = (
        db.query(ScriptHubUser.primary_org_code, func.count(ScriptHubUser.id))
        .filter(
            ScriptHubUser.is_deleted.is_(False),
            ScriptHubUser.primary_org_code.in_(visible_org_codes),
        )
        .group_by(ScriptHubUser.primary_org_code)
        .all()
    )
    counts = {normalize_org_code(org_code): int(count or 0) for org_code, count in count_rows}
    return [
        {
            **organization,
            "primary_user_count": counts.get(normalize_org_code(organization["org_code"]), 0),
        }
        for organization in organizations
    ]


def _list_overview_audit_logs(db: Session, actor: Optional[Dict[str, Any]], context: Any) -> List[Dict[str, Any]]:
    if not actor:
        return list_recent_audit_logs(db, limit=60)

    rows = (
        db.query(ScriptHubAuditLog)
        .order_by(ScriptHubAuditLog.created_at.desc(), ScriptHubAuditLog.id.desc())
        .limit(60)
        .all()
    )
    can_view_sensitive = bool(context.permissions.get("audit-log-sensitive-view"))
    can_view_all_audit = bool(context.permissions.get("audit-log-view"))
    visible_orgs = None if context.has_all_orgs else set(context.visible_org_codes or ())
    result: List[Dict[str, Any]] = []
    for row in rows:
        if row.target_org_code and visible_orgs is not None:
            if normalize_org_code(row.target_org_code) not in visible_orgs:
                continue
        if not can_view_all_audit and row.actor_user_code != context.actor_user_code:
            continue
        payload = serialize_audit_log(row)
        if row.sensitivity == "sensitive" and not can_view_sensitive:
            payload["details"] = {"sensitive": "***redacted***"}
        result.append(payload)
    return result


def list_rbac_overview(db: Session, actor: Optional[Dict[str, Any]] = None) -> Dict[str, object]:
    context = build_permission_context(db, actor) if actor else None
    roles = _serialize_admin_roles_bulk(db, _admin_role_rows(db))
    users = _serialize_admin_users_bulk(db, _visible_admin_user_rows(db, context))
    return {
        "catalog": {
            "permissions": _admin_permission_items(db),
            "roles": roles,
            "organizations": _visible_organization_items(db, context),
        },
        "users": users,
        "audit_logs": _list_overview_audit_logs(db, actor, context),
    }


def list_rbac_catalog(db: Session, actor: Optional[Dict[str, Any]] = None) -> Dict[str, object]:
    context = build_permission_context(db, actor) if actor else None
    return {
        "permissions": _admin_permission_items(db),
        "roles": _serialize_admin_roles_bulk(db, _admin_role_rows(db)),
        "organizations": _visible_organization_items(db, context),
    }


def list_rbac_roles(db: Session) -> Dict[str, object]:
    items = _serialize_admin_roles_bulk(db, _admin_role_rows(db))
    return {"items": items, "total": len(items)}


def list_rbac_organizations(db: Session, actor: Optional[Dict[str, Any]] = None) -> Dict[str, object]:
    context = build_permission_context(db, actor) if actor else None
    items = _visible_organization_items(db, context, include_primary_user_count=True)
    return {"items": items, "total": len(items)}


def _apply_actor_user_visibility_filter(query: Any, context: Any):
    if context is None or context.has_all_orgs:
        return query
    visible_orgs = tuple(context.visible_org_codes or ())
    visibility_filters = [
        ScriptHubUser.primary_org_code.in_(visible_orgs),
        ScriptHubUser.user_code == context.actor_user_code,
    ]
    visibility_filters.extend(
        ScriptHubUser.custom_org_codes_json.contains(org_code, autoescape=True)
        for org_code in visible_orgs
    )
    return query.filter(or_(*visibility_filters))


def _user_matches_org(user: ScriptHubUser, org_code: str) -> bool:
    normalized_org_code = normalize_org_code(org_code)
    if normalize_org_code(user.primary_org_code) == normalized_org_code:
        return True
    return normalized_org_code in set(normalize_org_code_list(user.custom_org_codes_json))


def _effective_config_permission_predicates() -> List[Any]:
    has_admin_role = exists(
        select(1)
        .select_from(ScriptHubUserRole)
        .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
        .where(
            ScriptHubUserRole.user_id == ScriptHubUser.id,
            ScriptHubRole.role_code == "admin",
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
        )
        .correlate(ScriptHubUser)
    )
    predicates: List[Any] = []
    for permission_key in sorted(RBAC_CONFIG_PERMISSION_KEYS):
        has_override = exists(
            select(1)
            .select_from(ScriptHubUserPermission)
            .join(
                ScriptHubPermission,
                ScriptHubPermission.id == ScriptHubUserPermission.permission_id,
            )
            .where(
                ScriptHubUserPermission.user_id == ScriptHubUser.id,
                ScriptHubPermission.permission_key == permission_key,
            )
            .correlate(ScriptHubUser)
        )
        has_granted_override = exists(
            select(1)
            .select_from(ScriptHubUserPermission)
            .join(
                ScriptHubPermission,
                ScriptHubPermission.id == ScriptHubUserPermission.permission_id,
            )
            .where(
                ScriptHubUserPermission.user_id == ScriptHubUser.id,
                ScriptHubPermission.permission_key == permission_key,
                ScriptHubUserPermission.is_granted.is_(True),
            )
            .correlate(ScriptHubUser)
        )
        has_role_permission = exists(
            select(1)
            .select_from(ScriptHubUserRole)
            .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
            .join(
                ScriptHubRolePermission,
                ScriptHubRolePermission.role_id == ScriptHubRole.id,
            )
            .join(
                ScriptHubPermission,
                ScriptHubPermission.id == ScriptHubRolePermission.permission_id,
            )
            .where(
                ScriptHubUserRole.user_id == ScriptHubUser.id,
                ScriptHubRole.is_active.is_(True),
                ScriptHubRole.is_deleted.is_(False),
                ScriptHubPermission.permission_key == permission_key,
            )
            .correlate(ScriptHubUser)
        )
        predicates.append(
            or_(
                has_granted_override,
                and_(
                    ~has_override,
                    or_(
                        ScriptHubUser.is_super_admin.is_(True),
                        has_admin_role,
                        has_role_permission,
                    ),
                ),
            )
        )
    return predicates


def _legacy_manage_expansion_predicate():
    has_admin_role = exists(
        select(1)
        .select_from(ScriptHubUserRole)
        .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
        .where(
            ScriptHubUserRole.user_id == ScriptHubUser.id,
            ScriptHubRole.role_code == "admin",
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
        )
        .correlate(ScriptHubUser)
    )
    has_legacy_override = exists(
        select(1)
        .select_from(ScriptHubUserPermission)
        .join(
            ScriptHubPermission,
            ScriptHubPermission.id == ScriptHubUserPermission.permission_id,
        )
        .where(
            ScriptHubUserPermission.user_id == ScriptHubUser.id,
            ScriptHubPermission.permission_key == "ai-recruitment-manage",
        )
        .correlate(ScriptHubUser)
    )
    has_granted_legacy_override = exists(
        select(1)
        .select_from(ScriptHubUserPermission)
        .join(
            ScriptHubPermission,
            ScriptHubPermission.id == ScriptHubUserPermission.permission_id,
        )
        .where(
            ScriptHubUserPermission.user_id == ScriptHubUser.id,
            ScriptHubPermission.permission_key == "ai-recruitment-manage",
            ScriptHubUserPermission.is_granted.is_(True),
        )
        .correlate(ScriptHubUser)
    )
    has_legacy_role_permission = exists(
        select(1)
        .select_from(ScriptHubUserRole)
        .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
        .join(
            ScriptHubRolePermission,
            ScriptHubRolePermission.role_id == ScriptHubRole.id,
        )
        .join(
            ScriptHubPermission,
            ScriptHubPermission.id == ScriptHubRolePermission.permission_id,
        )
        .where(
            ScriptHubUserRole.user_id == ScriptHubUser.id,
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
            ScriptHubPermission.permission_key == "ai-recruitment-manage",
        )
        .correlate(ScriptHubUser)
    )
    implicit_admin = or_(
        ScriptHubUser.is_super_admin.is_(True),
        has_admin_role,
    )
    has_effective_legacy_manage = or_(
        has_granted_legacy_override,
        and_(
            ~has_legacy_override,
            ~implicit_admin,
            has_legacy_role_permission,
        ),
    )

    fine_grained_keys = tuple(
        sorted(
            LEGACY_RECRUITMENT_VIEW_PERMISSIONS
            | LEGACY_RECRUITMENT_MANAGE_PERMISSIONS
        )
    )
    has_granted_fine_override = exists(
        select(1)
        .select_from(ScriptHubUserPermission)
        .join(
            ScriptHubPermission,
            ScriptHubPermission.id == ScriptHubUserPermission.permission_id,
        )
        .where(
            ScriptHubUserPermission.user_id == ScriptHubUser.id,
            ScriptHubUserPermission.is_granted.is_(True),
            ScriptHubPermission.permission_key.in_(fine_grained_keys),
        )
        .correlate(ScriptHubUser)
    )

    revoked_override = aliased(ScriptHubUserPermission)
    has_revoked_role_permission_override = exists(
        select(1)
        .select_from(revoked_override)
        .where(
            revoked_override.user_id == ScriptHubUser.id,
            revoked_override.permission_id == ScriptHubPermission.id,
            revoked_override.is_granted.is_(False),
        )
        .correlate(ScriptHubUser, ScriptHubPermission)
    )
    has_effective_fine_role_permission = exists(
        select(1)
        .select_from(ScriptHubUserRole)
        .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
        .join(
            ScriptHubRolePermission,
            ScriptHubRolePermission.role_id == ScriptHubRole.id,
        )
        .join(
            ScriptHubPermission,
            ScriptHubPermission.id == ScriptHubRolePermission.permission_id,
        )
        .where(
            ScriptHubUserRole.user_id == ScriptHubUser.id,
            ScriptHubRole.is_active.is_(True),
            ScriptHubRole.is_deleted.is_(False),
            ScriptHubPermission.permission_key.in_(fine_grained_keys),
            ~has_revoked_role_permission_override,
        )
        .correlate(ScriptHubUser)
    )

    revoked_admin_override = aliased(ScriptHubUserPermission)
    has_revoked_admin_permission_override = exists(
        select(1)
        .select_from(revoked_admin_override)
        .where(
            revoked_admin_override.user_id == ScriptHubUser.id,
            revoked_admin_override.permission_id == ScriptHubPermission.id,
            revoked_admin_override.is_granted.is_(False),
        )
        .correlate(ScriptHubUser, ScriptHubPermission)
    )
    has_unrevoked_admin_fine_permission = exists(
        select(1)
        .select_from(ScriptHubPermission)
        .where(
            ScriptHubPermission.permission_key.in_(fine_grained_keys),
            ~has_revoked_admin_permission_override,
        )
        .correlate(ScriptHubUser)
    )
    has_any_effective_fine_permission = or_(
        has_granted_fine_override,
        and_(~implicit_admin, has_effective_fine_role_permission),
        and_(implicit_admin, has_unrevoked_admin_fine_permission),
    )
    return and_(
        has_effective_legacy_manage,
        ~has_any_effective_fine_permission,
    )


def _config_state_predicate(config_state: str):
    permission_predicates = _effective_config_permission_predicates()
    has_any_direct = or_(*permission_predicates)
    has_all_direct = and_(*permission_predicates)
    expands_legacy_manage = _legacy_manage_expansion_predicate()
    if config_state == "enabled":
        return or_(expands_legacy_manage, has_all_direct)
    if config_state == "none":
        return and_(~expands_legacy_manage, ~has_any_direct)
    return and_(~expands_legacy_manage, has_any_direct, ~has_all_direct)


def list_rbac_users(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]] = None,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    org_code: Optional[str] = None,
    role_code: Optional[str] = None,
    data_scope: Optional[str] = None,
    is_active: Optional[bool] = None,
    config_state: Optional[str] = None,
) -> Dict[str, object]:
    normalized_page = max(1, int(page))
    normalized_page_size = max(1, min(int(page_size), 100))
    normalized_config_state = str(config_state or "").strip().lower()
    if normalized_config_state and normalized_config_state not in {"enabled", "partial", "none"}:
        raise ValueError("Invalid config state")

    context = build_permission_context(db, actor) if actor else None
    query = _apply_actor_user_visibility_filter(_admin_user_query(db), context)
    normalized_search = str(search or "").strip()
    if normalized_search:
        matching_role_user_ids = (
            select(ScriptHubUserRole.user_id)
            .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
            .where(
                ScriptHubRole.is_active.is_(True),
                ScriptHubRole.is_deleted.is_(False),
                or_(
                    _case_insensitive_contains(ScriptHubRole.role_code, normalized_search),
                    _case_insensitive_contains(ScriptHubRole.name, normalized_search),
                ),
            )
        )
        matching_org_codes = select(ScriptHubOrganization.org_code).where(
            ScriptHubOrganization.is_deleted.is_(False),
            _case_insensitive_contains(ScriptHubOrganization.name, normalized_search),
        )
        query = query.filter(
            or_(
                _case_insensitive_contains(ScriptHubUser.user_code, normalized_search),
                _case_insensitive_contains(ScriptHubUser.display_name, normalized_search),
                _case_insensitive_contains(ScriptHubUser.primary_org_code, normalized_search),
                _case_insensitive_contains(ScriptHubUser.data_scope, normalized_search),
                _case_insensitive_contains(ScriptHubUser.custom_org_codes_json, normalized_search),
                ScriptHubUser.primary_org_code.in_(matching_org_codes),
                ScriptHubUser.id.in_(matching_role_user_ids),
            )
        )

    normalized_org_code = str(org_code or "").strip()
    if normalized_org_code:
        query = query.filter(
            or_(
                ScriptHubUser.primary_org_code == normalize_org_code(normalized_org_code),
                ScriptHubUser.custom_org_codes_json.contains(normalized_org_code, autoescape=True),
            )
        )
    normalized_role_code = str(role_code or "").strip()
    if normalized_role_code:
        matching_role_user_ids = (
            select(ScriptHubUserRole.user_id)
            .join(ScriptHubRole, ScriptHubRole.id == ScriptHubUserRole.role_id)
            .where(
                ScriptHubRole.role_code == normalized_role_code,
                ScriptHubRole.is_active.is_(True),
                ScriptHubRole.is_deleted.is_(False),
            )
        )
        query = query.filter(ScriptHubUser.id.in_(matching_role_user_ids))
    if data_scope:
        normalized_data_scope = str(data_scope).strip().upper()
        if normalized_data_scope not in {
            DATA_SCOPE_ALL,
            DATA_SCOPE_ORG_AND_CHILDREN,
            DATA_SCOPE_ORG_ONLY,
            DATA_SCOPE_CUSTOM_ORGS,
            DATA_SCOPE_SELF,
        }:
            raise ValueError("Invalid data scope")
        query = query.filter(ScriptHubUser.data_scope == normalized_data_scope)
    if is_active is not None:
        query = query.filter(ScriptHubUser.is_active.is_(bool(is_active)))
    if normalized_config_state:
        query = query.filter(_config_state_predicate(normalized_config_state))

    query = query.order_by(ScriptHubUser.created_at.asc(), ScriptHubUser.user_code.asc())
    requires_python_visibility = bool(
        (context is not None and not context.has_all_orgs)
        or normalized_org_code
    )
    if not requires_python_visibility:
        total = int(
            query.with_entities(func.count(ScriptHubUser.id)).order_by(None).scalar()
            or 0
        )
        page_rows = query.offset((normalized_page - 1) * normalized_page_size).limit(normalized_page_size).all()
        items = _serialize_admin_users_bulk(db, page_rows)
    else:
        candidate_rows = query.all()
        if context is not None and not context.has_all_orgs:
            candidate_rows = [
                user for user in candidate_rows
                if _user_visible_to_context(user, context)
            ]
        if normalized_org_code:
            candidate_rows = [
                user for user in candidate_rows
                if _user_matches_org(user, normalized_org_code)
            ]
        total = len(candidate_rows)
        start = (normalized_page - 1) * normalized_page_size
        items = _serialize_admin_users_bulk(
            db,
            candidate_rows[start:start + normalized_page_size],
        )
    return {
        "items": items,
        "total": total,
        "page": normalized_page,
        "page_size": normalized_page_size,
    }


def get_rbac_user(
    db: Session,
    user_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, object]:
    normalized_user_code = str(user_code or "").strip().lower()
    user = _admin_user_query(db).filter(ScriptHubUser.user_code == normalized_user_code).first()
    if not user:
        raise ValueError("User not found")
    context = build_permission_context(db, actor) if actor else None
    if not _user_visible_to_context(user, context):
        raise ValueError("User is outside the actor data scope")
    return _serialize_admin_users_bulk(db, [user])[0]


def _audit_query_for_actor(db: Session, context: Any):
    query = db.query(ScriptHubAuditLog)
    if context is None:
        return query
    if not context.has_all_orgs:
        visible_orgs = tuple(context.visible_org_codes or ())
        query = query.filter(
            or_(
                ScriptHubAuditLog.target_org_code.is_(None),
                ScriptHubAuditLog.target_org_code.in_(visible_orgs),
            )
        )
    if not context.permissions.get("audit-log-view"):
        query = query.filter(ScriptHubAuditLog.actor_user_code == context.actor_user_code)
    return query


def list_rbac_audit_logs(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]] = None,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    actor_search: Optional[str] = None,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    result: Optional[str] = None,
    sensitivity: Optional[str] = None,
) -> Dict[str, object]:
    normalized_page = max(1, int(page))
    normalized_page_size = max(1, min(int(page_size), 100))
    context = build_permission_context(db, actor) if actor else None
    base_query = _audit_query_for_actor(db, context)
    target_types = sorted(
        target_type_value
        for target_type_value, in base_query.with_entities(ScriptHubAuditLog.target_type)
        .distinct()
        .all()
        if target_type_value
    )
    query = base_query
    normalized_search = str(search or "").strip()
    if normalized_search:
        query = query.filter(
            or_(
                _case_insensitive_contains(ScriptHubAuditLog.actor_user_code, normalized_search),
                _case_insensitive_contains(ScriptHubAuditLog.actor_display_name, normalized_search),
                _case_insensitive_contains(ScriptHubAuditLog.action, normalized_search),
                _case_insensitive_contains(ScriptHubAuditLog.target_type, normalized_search),
                _case_insensitive_contains(ScriptHubAuditLog.target_code, normalized_search),
                _case_insensitive_contains(ScriptHubAuditLog.target_org_code, normalized_search),
            )
        )
    normalized_actor_search = str(actor_search or "").strip()
    if normalized_actor_search:
        query = query.filter(
            or_(
                _case_insensitive_contains(ScriptHubAuditLog.actor_user_code, normalized_actor_search),
                _case_insensitive_contains(ScriptHubAuditLog.actor_display_name, normalized_actor_search),
            )
        )
    if action:
        query = query.filter(ScriptHubAuditLog.action == str(action).strip())
    if target_type:
        query = query.filter(ScriptHubAuditLog.target_type == str(target_type).strip())
    if result:
        query = query.filter(ScriptHubAuditLog.result == str(result).strip())
    if sensitivity:
        query = query.filter(ScriptHubAuditLog.sensitivity == str(sensitivity).strip())

    total = int(
        query.with_entities(func.count(ScriptHubAuditLog.id)).order_by(None).scalar()
        or 0
    )
    rows = (
        query.order_by(ScriptHubAuditLog.created_at.desc(), ScriptHubAuditLog.id.desc())
        .offset((normalized_page - 1) * normalized_page_size)
        .limit(normalized_page_size)
        .all()
    )
    can_view_sensitive = bool(
        context is None or context.permissions.get("audit-log-sensitive-view")
    )
    items: List[Dict[str, Any]] = []
    for row in rows:
        payload = serialize_audit_log(row)
        if row.sensitivity == "sensitive" and not can_view_sensitive:
            payload["details"] = {"sensitive": "***redacted***"}
        items.append(payload)
    return {
        "items": items,
        "total": total,
        "page": normalized_page,
        "page_size": normalized_page_size,
        "target_types": target_types,
    }


def get_rbac_summary(db: Session, actor: Optional[Dict[str, Any]] = None) -> Dict[str, object]:
    context = build_permission_context(db, actor) if actor else None
    role_rows = _admin_role_rows(db)
    organization_items = _visible_organization_items(db, context)
    data_scope_counts = {
        DATA_SCOPE_ALL: 0,
        DATA_SCOPE_ORG_AND_CHILDREN: 0,
        DATA_SCOPE_ORG_ONLY: 0,
        DATA_SCOPE_CUSTOM_ORGS: 0,
        DATA_SCOPE_SELF: 0,
    }
    if context is None or context.has_all_orgs:
        grouped_user_counts = (
            db.query(
                ScriptHubUser.data_scope,
                ScriptHubUser.is_active,
                func.count(ScriptHubUser.id),
            )
            .filter(ScriptHubUser.is_deleted.is_(False))
            .group_by(ScriptHubUser.data_scope, ScriptHubUser.is_active)
            .all()
        )
        user_count = 0
        active_user_count = 0
        for data_scope, is_active_value, count in grouped_user_counts:
            normalized_count = int(count or 0)
            user_count += normalized_count
            if is_active_value:
                active_user_count += normalized_count
            data_scope_counts[normalize_data_scope(data_scope)] += normalized_count

        high_risk_predicate = or_(
            ScriptHubUser.is_super_admin.is_(True),
            *_effective_config_permission_predicates(),
            _legacy_manage_expansion_predicate(),
        )
        high_risk_query = _admin_user_query(db).filter(high_risk_predicate)
        high_risk_user_count = int(
            high_risk_query.with_entities(func.count(ScriptHubUser.id)).scalar()
            or 0
        )
        high_risk_rows = (
            high_risk_query.order_by(
                ScriptHubUser.created_at.asc(),
                ScriptHubUser.user_code.asc(),
            )
            .limit(8)
            .all()
        )
        high_risk_users = _serialize_admin_users_bulk(db, high_risk_rows)
    else:
        user_rows = _visible_admin_user_rows(db, context)
        serialized_users = _serialize_admin_users_bulk(db, user_rows)
        user_count = len(serialized_users)
        active_user_count = sum(1 for user in serialized_users if user.get("is_active"))
        for user in serialized_users:
            normalized_scope = normalize_data_scope(user.get("data_scope"))
            data_scope_counts[normalized_scope] += 1
        high_risk_users = [
            user for user in serialized_users
            if bool(user.get("is_super_admin"))
            or bool(set(user.get("effective_permission_keys") or []) & RBAC_CONFIG_PERMISSION_KEYS)
        ]
        high_risk_user_count = len(high_risk_users)

    audit_count = int(
        _audit_query_for_actor(db, context)
        .with_entities(func.count(ScriptHubAuditLog.id))
        .scalar()
        or 0
    )
    return {
        "user_count": user_count,
        "active_user_count": active_user_count,
        "role_count": len(role_rows),
        "active_role_count": sum(1 for role in role_rows if role.is_active),
        "system_role_count": sum(1 for role in role_rows if role.is_system),
        "organization_count": len(organization_items),
        "active_organization_count": sum(
            1 for organization in organization_items if organization.get("is_active")
        ),
        "audit_log_count": audit_count,
        "data_scope_counts": data_scope_counts,
        "high_risk_user_count": high_risk_user_count,
        "high_risk_users": [
            {
                "user_code": user["user_code"],
                "display_name": user["display_name"],
                "is_super_admin": user["is_super_admin"],
                "effective_permission_keys": user["effective_permission_keys"],
            }
            for user in high_risk_users[:8]
        ],
    }


def _resolve_parent_org(db: Session, parent_org_code: Optional[str]) -> Optional[ScriptHubOrganization]:
    if not parent_org_code:
        return None
    parent = db.query(ScriptHubOrganization).filter(
        ScriptHubOrganization.org_code == normalize_org_code(parent_org_code),
        ScriptHubOrganization.is_active.is_(True),
    ).first()
    if not parent:
        raise ValueError("Parent organization not found")
    return parent


def _build_org_path(org_code: str, parent: Optional[ScriptHubOrganization]) -> str:
    return f"{parent.path}/{org_code}" if parent else org_code


def _org_has_active_children(db: Session, org_code: str) -> bool:
    return db.query(ScriptHubOrganization).filter(
        ScriptHubOrganization.parent_org_code == normalize_org_code(org_code),
        ScriptHubOrganization.is_active.is_(True),
    ).first() is not None


def _org_has_user_references(db: Session, org_code: str) -> bool:
    normalized = normalize_org_code(org_code)
    users = db.query(ScriptHubUser).filter(ScriptHubUser.is_deleted.is_(False)).all()
    for user in users:
        if normalize_org_code(user.primary_org_code) == normalized:
            return True
        if normalized in set(normalize_org_code_list(user.custom_org_codes_json)):
            return True
    return False


def get_org_users(
    db: Session,
    org_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    search: Optional[str] = None,
) -> Dict[str, object]:
    normalized = normalize_org_code(org_code)
    org = (
        db.query(ScriptHubOrganization)
        .options(load_only(ScriptHubOrganization.org_code, ScriptHubOrganization.name))
        .filter(ScriptHubOrganization.org_code == normalized)
        .first()
    )
    if not org:
        raise ValueError("Organization not found")
    _validate_org_codes_within_actor_boundary(
        db,
        actor=actor,
        org_codes=[normalized],
        error_prefix="Organization",
    )
    query = (
        db.query(ScriptHubUser)
        .options(
            load_only(
                ScriptHubUser.user_code,
                ScriptHubUser.display_name,
                ScriptHubUser.primary_org_code,
                ScriptHubUser.custom_org_codes_json,
                ScriptHubUser.is_active,
            )
        )
        .filter(
            ScriptHubUser.is_deleted.is_(False),
            or_(
                ScriptHubUser.primary_org_code == normalized,
                ScriptHubUser.custom_org_codes_json.contains(normalized, autoescape=True),
            ),
        )
    )
    normalized_search = str(search or "").strip()
    if normalized_search:
        query = query.filter(
            or_(
                _case_insensitive_contains(ScriptHubUser.user_code, normalized_search),
                _case_insensitive_contains(ScriptHubUser.display_name, normalized_search),
            )
        )

    primary_users: List[Dict[str, object]] = []
    data_scope_users: List[Dict[str, object]] = []
    for user in query.order_by(ScriptHubUser.user_code.asc()).all():
        serialized_user = {
            "user_code": user.user_code,
            "display_name": user.display_name,
            "is_active": bool(user.is_active),
        }
        if normalize_org_code(user.primary_org_code) == normalized:
            primary_users.append(serialized_user)
        elif normalized in set(normalize_org_code_list(user.custom_org_codes_json)):
            data_scope_users.append(serialized_user)

    primary_total_count = len(primary_users)
    data_scope_total_count = len(data_scope_users)
    response: Dict[str, object] = {
        "org_code": normalized,
        "org_name": org.name,
        "primary_users": primary_users,
        "data_scope_users": data_scope_users,
        "primary_total_count": primary_total_count,
        "data_scope_total_count": data_scope_total_count,
        "total_count": primary_total_count + data_scope_total_count,
    }
    if page is None and page_size is None:
        return response

    normalized_page = max(1, int(page or 1))
    normalized_page_size = max(1, min(int(page_size or 50), 100))
    combined_users = [
        ("primary", user) for user in primary_users
    ] + [
        ("data_scope", user) for user in data_scope_users
    ]
    start = (normalized_page - 1) * normalized_page_size
    page_users = combined_users[start:start + normalized_page_size]
    response["primary_users"] = [
        user for user_type, user in page_users if user_type == "primary"
    ]
    response["data_scope_users"] = [
        user for user_type, user in page_users if user_type == "data_scope"
    ]
    response["page"] = normalized_page
    response["page_size"] = normalized_page_size
    return response


def _update_descendant_org_paths(db: Session, *, old_path: str, new_path: str) -> None:
    descendants = db.query(ScriptHubOrganization).filter(
        ScriptHubOrganization.path.like(f"{old_path}/%")
    ).all()
    for descendant in descendants:
        suffix = str(descendant.path or "")[len(old_path):]
        descendant.path = f"{new_path}{suffix}"


def create_organization(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]] = None,
    org_code: str,
    name: str,
    org_type: str = "company",
    parent_org_code: Optional[str] = "group",
    sort_order: int = 99,
    is_active: bool = True,
) -> Dict[str, object]:
    normalized_org_code = _normalize_org_code_for_mutation(org_code)
    if db.query(ScriptHubOrganization).filter(ScriptHubOrganization.org_code == normalized_org_code).first():
        raise ValueError("Organization code already exists")

    normalized_name = (name or "").strip()
    if not normalized_name:
        raise ValueError("Organization name is required")

    parent = _resolve_parent_org(db, parent_org_code)
    _validate_org_mutation_boundary(
        db,
        actor=actor,
        target_org_code=parent.org_code if parent else normalized_org_code,
    )

    row = ScriptHubOrganization(
        org_code=normalized_org_code,
        name=normalized_name,
        org_type=_normalize_org_type(org_type),
        parent_org_code=parent.org_code if parent else None,
        path=_build_org_path(normalized_org_code, parent),
        sort_order=int(sort_order),
        is_active=bool(is_active),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_organization(row)


def update_organization(
    db: Session,
    org_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
    name: Optional[str] = None,
    org_type: Optional[str] = None,
    parent_org_code: Optional[str] = None,
    sort_order: Optional[int] = None,
    is_active: Optional[bool] = None,
) -> Dict[str, object]:
    normalized_org_code = _normalize_org_code_for_mutation(org_code)
    row = _get_org_row(db, normalized_org_code)
    if not row:
        raise ValueError("Organization not found")

    next_parent_code = row.parent_org_code if parent_org_code is None else normalize_org_code(parent_org_code)
    if normalized_org_code == "group":
        if parent_org_code is not None and parent_org_code:
            raise ValueError("Root organization cannot have a parent")
        next_parent_code = None
    elif parent_org_code is not None and not parent_org_code:
        raise ValueError("Non-root organization must have a parent")

    parent = _resolve_parent_org(db, next_parent_code)
    if parent and parent.org_code == normalized_org_code:
        raise ValueError("Organization cannot be its own parent")
    if parent and str(parent.path or "").startswith(f"{row.path}/"):
        raise ValueError("Organization cannot be moved under its descendant")

    parent_boundary_org_code = None
    if parent_org_code is not None and normalize_org_code(parent_org_code) != normalize_org_code(row.parent_org_code):
        parent_boundary_org_code = parent.org_code if parent else None

    _validate_org_mutation_boundary(
        db,
        actor=actor,
        target_org_code=normalized_org_code,
        parent_org_code=parent_boundary_org_code,
    )

    next_is_active = row.is_active if is_active is None else bool(is_active)
    if normalized_org_code == "group" and not next_is_active:
        raise ValueError("Root organization cannot be disabled")
    if row.is_active and not next_is_active:
        if _org_has_active_children(db, normalized_org_code):
            raise ValueError("Organization has active children")
        if _org_has_user_references(db, normalized_org_code):
            raise ValueError("Organization is still assigned to users")

    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Organization name is required")
        row.name = normalized_name
    if org_type is not None:
        row.org_type = _normalize_org_type(org_type)
    if sort_order is not None:
        row.sort_order = int(sort_order)

    old_path = row.path
    new_path = _build_org_path(normalized_org_code, parent)
    row.parent_org_code = parent.org_code if parent else None
    row.path = new_path
    row.is_active = next_is_active
    if old_path != new_path:
        _update_descendant_org_paths(db, old_path=old_path, new_path=new_path)

    db.commit()
    db.refresh(row)
    return _serialize_organization(row)


def delete_organization(
    db: Session,
    org_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, object]:
    return update_organization(
        db,
        org_code,
        actor=actor,
        is_active=False,
    )


def soft_delete_organization(
    db: Session,
    org_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, object]:
    normalized_org_code = _normalize_org_code_for_mutation(org_code)
    row = _get_org_row(db, normalized_org_code)
    if not row:
        raise ValueError("Organization not found")

    if getattr(row, "is_deleted", False):
        raise ValueError("Organization is already deleted")

    if normalized_org_code == "group":
        raise ValueError("Root organization cannot be deleted")

    if _org_has_active_children(db, normalized_org_code):
        raise ValueError("Organization has active children")

    if _org_has_user_references(db, normalized_org_code):
        raise ValueError("Organization is still assigned to users")

    if db.query(ScriptHubOrganization).filter(
        ScriptHubOrganization.parent_org_code == normalized_org_code,
        ScriptHubOrganization.is_deleted.is_(False),
    ).first():
        raise ValueError("Organization has children")

    _validate_org_mutation_boundary(
        db,
        actor=actor,
        target_org_code=normalized_org_code,
    )

    row.is_deleted = True
    row.is_active = False
    row.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db.commit()
    db.refresh(row)
    return _serialize_organization(row)


def _set_role_permissions(db: Session, role_id: int, permission_keys: List[str], permission_rows: Dict[str, ScriptHubPermission]):
    db.query(ScriptHubRolePermission).filter(ScriptHubRolePermission.role_id == role_id).delete()
    for permission_key in permission_keys:
        db.add(
            ScriptHubRolePermission(
                role_id=role_id,
                permission_id=permission_rows[permission_key].id,
            )
        )


def _invalidate_users_with_role_session_cache(db: Session, role_id: int) -> None:
    rows = (
        db.query(ScriptHubUser.user_code)
        .join(ScriptHubUserRole, ScriptHubUserRole.user_id == ScriptHubUser.id)
        .filter(ScriptHubUserRole.role_id == role_id)
        .all()
    )
    for user_code, in rows:
        invalidate_script_hub_session_refresh_cache(user_code)


def create_rbac_role(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]] = None,
    code: str,
    name: str,
    description: Optional[str],
    permission_keys: Iterable[str],
    landing_page: Optional[str] = None,
    recruitment_menu_grouped: bool = True,
) -> Dict[str, object]:
    normalized_code = _normalize_role_code(code)
    if db.query(ScriptHubRole).filter(
        ScriptHubRole.role_code == normalized_code,
    ).first():
        raise ValueError("Role code already exists")

    normalized_name = (name or "").strip()
    if not normalized_name:
        raise ValueError("Role name is required")

    permission_rows = _permission_rows(db)
    normalized_permission_keys = _normalize_permission_keys(permission_keys, permission_rows)
    if not normalized_permission_keys:
        raise ValueError("At least one permission is required")
    _validate_role_mutation_boundary(actor=actor, permission_keys=normalized_permission_keys)

    max_sort_order = db.query(ScriptHubRole.sort_order).order_by(ScriptHubRole.sort_order.desc()).limit(1).scalar()
    next_sort_order = (max_sort_order or 0) + 10

    role = ScriptHubRole(
        role_code=normalized_code,
        name=normalized_name,
        description=_normalize_text(description),
        sort_order=next_sort_order,
        is_system=False,
        is_active=True,
        landing_page=landing_page if landing_page in ("", "home", "welcome") else "home",
        recruitment_menu_grouped=bool(recruitment_menu_grouped),
    )
    db.add(role)
    db.flush()
    _set_role_permissions(db, role.id, normalized_permission_keys, permission_rows)
    db.commit()
    db.refresh(role)
    return serialize_admin_role(db, role)


def update_rbac_role(
    db: Session,
    role_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    permission_keys: Optional[Iterable[str]] = None,
    is_active: Optional[bool] = None,
    landing_page: Optional[str] = None,
    recruitment_menu_grouped: Optional[bool] = None,
) -> Dict[str, object]:
    normalized_role_code = _normalize_role_code(role_code)
    role = db.query(ScriptHubRole).filter(
        ScriptHubRole.role_code == normalized_role_code,
        ScriptHubRole.is_deleted.is_(False),
    ).first()
    if not role:
        raise ValueError("Role not found")
    if role.is_system:
        raise ValueError("System roles are read-only")

    permission_rows = _permission_rows(db)
    normalized_permission_keys = (
        _normalize_permission_keys(permission_keys, permission_rows)
        if permission_keys is not None else
        _serialize_role_permission_keys(db, [role.id])
    )
    if not normalized_permission_keys:
        raise ValueError("At least one permission is required")
    _validate_role_mutation_boundary(actor=actor, permission_keys=normalized_permission_keys)

    next_is_active = role.is_active if is_active is None else bool(is_active)
    if not next_is_active and _get_assigned_user_count(db, role.id) > 0:
        raise ValueError("This role is still assigned to users. Reassign users before disabling it")

    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Role name is required")
        role.name = normalized_name

    if description is not None:
        role.description = _normalize_text(description)

    if landing_page is not None:
        role.landing_page = landing_page if landing_page in ("", "home", "welcome") else "home"

    if recruitment_menu_grouped is not None:
        role.recruitment_menu_grouped = bool(recruitment_menu_grouped)

    role.is_active = next_is_active
    _set_role_permissions(db, role.id, normalized_permission_keys, permission_rows)
    db.commit()
    _invalidate_users_with_role_session_cache(db, role.id)
    db.refresh(role)
    return serialize_admin_role(db, role)


def create_rbac_user(
    db: Session,
    *,
    actor: Optional[Dict[str, Any]] = None,
    user_code: str,
    display_name: str,
    access_key: Optional[str],
    primary_org_code: str = "group",
    data_scope: str = DATA_SCOPE_ORG_ONLY,
    custom_org_codes: Optional[Iterable[str]] = None,
    authorization_boundary: Optional[Dict[str, Any]] = None,
    role_codes: Iterable[str],
    granted_permissions: Iterable[str],
    revoked_permissions: Iterable[str],
    team_resources_login_key_enabled: bool,
    is_active: bool,
    is_super_admin: bool,
    notes: Optional[str],
) -> Tuple[Dict[str, object], str]:
    normalized_user_code = _normalize_user_code(user_code)
    if db.query(ScriptHubUser).filter(
        ScriptHubUser.user_code == normalized_user_code,
    ).first():
        raise ValueError("User code already exists")

    normalized_display_name = (display_name or "").strip()
    if not normalized_display_name:
        raise ValueError("Display name is required")

    permission_rows = _permission_rows(db)
    role_rows = _role_rows(db)
    normalized_role_codes = _normalize_role_codes(role_codes, role_rows)
    normalized_granted_permissions = _normalize_permission_keys(granted_permissions, permission_rows)
    normalized_revoked_permissions = _normalize_permission_keys(revoked_permissions, permission_rows)
    normalized_primary_org_code = _ensure_org_exists(db, primary_org_code)
    normalized_data_scope = normalize_data_scope(data_scope)
    normalized_custom_org_codes = [
        _ensure_org_exists(db, org_code)
        for org_code in normalize_org_code_list(custom_org_codes or [])
    ]
    _validate_authorization_boundary(
        db,
        actor=actor,
        target_org_code=normalized_primary_org_code,
        custom_org_codes=normalized_custom_org_codes,
        target_authorization_boundary=authorization_boundary,
        role_codes=normalized_role_codes,
        granted_permissions=normalized_granted_permissions,
        revoked_permissions=normalized_revoked_permissions,
        data_scope=normalized_data_scope,
        is_super_admin=bool(is_super_admin),
    )

    plain_access_key = (access_key or "").strip() or _generate_access_key()
    material = create_access_key_material(plain_access_key)

    if db.query(ScriptHubUser).filter(
        ScriptHubUser.access_key_lookup_hash == material["lookup_hash"],
    ).first():
        raise ValueError("Access key already exists, please choose another one")

    user = ScriptHubUser(
        user_code=normalized_user_code,
        display_name=normalized_display_name,
        access_key_lookup_hash=material["lookup_hash"],
        access_key_salt=material["salt"],
        access_key_hash=material["hash"],
        primary_org_code=normalized_primary_org_code,
        data_scope=normalized_data_scope,
        custom_org_codes_json=json.dumps(normalized_custom_org_codes, ensure_ascii=False),
        authorization_boundary_json=_json_dumps_safe(authorization_boundary or {}),
        team_resources_access_enabled=bool(team_resources_login_key_enabled),
        is_active=bool(is_active),
        is_super_admin=bool(is_super_admin),
        notes=_normalize_text(notes),
    )
    db.add(user)
    db.flush()

    _set_user_roles(db, user.id, normalized_role_codes, role_rows)
    _set_user_permission_overrides(
        db,
        user.id,
        normalized_granted_permissions,
        normalized_revoked_permissions,
        permission_rows,
    )

    db.commit()
    db.refresh(user)
    return serialize_admin_user(db, user), plain_access_key


def update_rbac_user(
    db: Session,
    user_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
    expected_permission_version: Optional[int] = None,
    data_scope_downgrade_confirmed: bool = False,
    display_name: Optional[str] = None,
    primary_org_code: Optional[str] = None,
    data_scope: Optional[str] = None,
    custom_org_codes: Optional[Iterable[str]] = None,
    authorization_boundary: Optional[Dict[str, Any]] = None,
    role_codes: Optional[Iterable[str]] = None,
    granted_permissions: Optional[Iterable[str]] = None,
    revoked_permissions: Optional[Iterable[str]] = None,
    team_resources_login_key_enabled: Optional[bool] = None,
    is_active: Optional[bool] = None,
    is_super_admin: Optional[bool] = None,
    notes: Optional[str] = None,
) -> Dict[str, object]:
    normalized_user_code = _normalize_user_code(user_code)
    user = db.query(ScriptHubUser).filter(
        ScriptHubUser.user_code == normalized_user_code,
        ScriptHubUser.is_deleted.is_(False),
    ).first()
    if not user:
        raise ValueError("User not found")
    if expected_permission_version is not None and int(user.permission_version or 1) != int(expected_permission_version):
        raise RbacMutationConflictError("User permissions changed. Refresh before saving again")

    permission_rows = _permission_rows(db)
    role_rows = _role_rows(db)
    next_role_codes = _normalize_role_codes(role_codes, role_rows) if role_codes is not None else [role.role_code for role in load_roles_for_user(db, user.id)]
    next_granted_permissions = (
        _normalize_permission_keys(granted_permissions, permission_rows)
        if granted_permissions is not None else
        [permission_key for permission_key, granted in load_user_permission_overrides(db, user.id) if granted]
    )
    next_revoked_permissions = (
        _normalize_permission_keys(revoked_permissions, permission_rows)
        if revoked_permissions is not None else
        [permission_key for permission_key, granted in load_user_permission_overrides(db, user.id) if not granted]
    )
    next_primary_org_code = _ensure_org_exists(db, primary_org_code) if primary_org_code is not None else normalize_org_code(user.primary_org_code)
    next_data_scope = normalize_data_scope(data_scope) if data_scope is not None else normalize_data_scope(user.data_scope)
    current_custom_org_codes = normalize_org_code_list(user.custom_org_codes_json)
    next_custom_org_codes = (
        [_ensure_org_exists(db, org_code) for org_code in normalize_org_code_list(custom_org_codes)]
        if custom_org_codes is not None else
        current_custom_org_codes
    )
    next_is_active = user.is_active if is_active is None else bool(is_active)
    next_is_super_admin = user.is_super_admin if is_super_admin is None else bool(is_super_admin)

    if _is_data_scope_downgrade(
        current_scope=normalize_data_scope(user.data_scope),
        next_scope=next_data_scope,
        current_custom_orgs=current_custom_org_codes,
        next_custom_orgs=next_custom_org_codes,
    ) and not data_scope_downgrade_confirmed:
        raise ValueError("Data scope downgrade requires explicit confirmation")

    _validate_authorization_boundary(
        db,
        actor=actor,
        target_org_code=next_primary_org_code,
        custom_org_codes=next_custom_org_codes,
        target_authorization_boundary=authorization_boundary if authorization_boundary is not None else _json_loads_safe(user.authorization_boundary_json, {}),
        role_codes=next_role_codes,
        granted_permissions=next_granted_permissions,
        revoked_permissions=next_revoked_permissions,
        data_scope=next_data_scope,
        is_super_admin=next_is_super_admin,
    )

    _guard_last_admin(db, user, next_is_active, next_is_super_admin, next_role_codes)

    if display_name is not None:
        normalized_display_name = display_name.strip()
        if not normalized_display_name:
            raise ValueError("Display name cannot be empty")
        user.display_name = normalized_display_name

    user.is_active = next_is_active
    user.is_super_admin = next_is_super_admin
    user.primary_org_code = next_primary_org_code
    user.data_scope = next_data_scope
    user.custom_org_codes_json = json.dumps(next_custom_org_codes, ensure_ascii=False)
    if authorization_boundary is not None:
        user.authorization_boundary_json = _json_dumps_safe(authorization_boundary or {})
    if team_resources_login_key_enabled is not None:
        user.team_resources_access_enabled = bool(team_resources_login_key_enabled)
    if notes is not None:
        user.notes = _normalize_text(notes)

    _set_user_roles(db, user.id, next_role_codes, role_rows)
    _set_user_permission_overrides(
        db,
        user.id,
        next_granted_permissions,
        next_revoked_permissions,
        permission_rows,
    )

    user.permission_version = int(user.permission_version or 1) + 1
    try:
        db.commit()
    except StaleDataError as exc:
        db.rollback()
        raise RbacMutationConflictError("User permissions changed. Refresh before saving again") from exc
    invalidate_script_hub_session_refresh_cache(user.user_code)
    db.refresh(user)
    return serialize_admin_user(db, user)


def rotate_user_access_key(
    db: Session,
    user_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
    access_key: Optional[str] = None,
) -> Tuple[Dict[str, object], str]:
    normalized_user_code = _normalize_user_code(user_code)
    user = db.query(ScriptHubUser).filter(
        ScriptHubUser.user_code == normalized_user_code,
        ScriptHubUser.is_deleted.is_(False),
    ).first()
    if not user:
        raise ValueError("User not found")
    _validate_user_target_boundary(db, actor=actor, user=user)

    plain_access_key = (access_key or "").strip() or _generate_access_key()
    material = create_access_key_material(plain_access_key)

    existing = (
        db.query(ScriptHubUser)
        .filter(
            ScriptHubUser.access_key_lookup_hash == material["lookup_hash"],
            ScriptHubUser.id != user.id,
        )
        .first()
    )
    if existing:
        raise ValueError("Access key already exists, please choose another one")

    user.access_key_lookup_hash = material["lookup_hash"]
    user.access_key_salt = material["salt"]
    user.access_key_hash = material["hash"]
    user.access_key_version = int(getattr(user, "access_key_version", 1) or 1) + 1

    db.commit()
    invalidate_script_hub_session_refresh_cache(user.user_code)
    db.refresh(user)
    return serialize_admin_user(db, user), plain_access_key


def delete_rbac_user(
    db: Session,
    user_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, object]:
    normalized_user_code = _normalize_user_code(user_code)
    user = db.query(ScriptHubUser).filter(
        ScriptHubUser.user_code == normalized_user_code,
        ScriptHubUser.is_deleted.is_(False),
    ).first()
    if not user:
        raise ValueError("User not found")
    _validate_user_target_boundary(db, actor=actor, user=user)

    current_role_codes = [role.role_code for role in load_roles_for_user(db, user.id)]
    _guard_last_admin(db, user, False, False, current_role_codes)

    user.is_active = False
    user.team_resources_access_enabled = False
    user.is_deleted = True
    user.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db.commit()
    invalidate_script_hub_session_refresh_cache(user.user_code)
    return {
        "user_code": user.user_code,
        "display_name": user.display_name,
    }


def delete_rbac_role(
    db: Session,
    role_code: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, object]:
    normalized_role_code = _normalize_role_code(role_code)
    role = db.query(ScriptHubRole).filter(
        ScriptHubRole.role_code == normalized_role_code,
        ScriptHubRole.is_deleted.is_(False),
    ).first()
    if not role:
        raise ValueError("Role not found")
    if role.is_system:
        raise ValueError("System roles are read-only")
    _validate_role_mutation_boundary(actor=actor, permission_keys=_serialize_role_permission_keys(db, [role.id]))
    if _get_assigned_user_count(db, role.id) > 0:
        raise ValueError("This role is still assigned to users. Reassign users before deleting it")

    role.is_active = False
    role.is_deleted = True
    role.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db.commit()
    return {
        "code": role.role_code,
        "name": role.name,
    }
