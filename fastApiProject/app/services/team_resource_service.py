import logging
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from ..orm_models import (
    TeamResourceGroup, TeamResourceSystem, 
    TeamResourceEnvironment, TeamResourceCredential
)

logger = logging.getLogger(__name__)


class TeamResourceService:
    def __init__(self, db: Session):
        self.db = db

    def _serialize_credential(self, cred: TeamResourceCredential, decrypt_pass: bool = False) -> Dict[str, Any]:
        payload = {
            "id": cred.cred_id,
            "label": cred.label or "",
            "username": cred.username or "",
            "note": cred.note or "",
            "hasPassword": bool(cred.password),
        }
        if decrypt_pass:
            from ..password_crypto import decrypt_password

            payload["password"] = decrypt_password(cred.password or "") if cred.password else ""
        return payload

    def get_all_data(self, decrypt_pass: bool = False) -> List[Dict[str, Any]]:
        """
        获取所有团队资源数据，组装成嵌套结构
        :param decrypt_pass: 是否解密密码，默认为 False。仅管理或导出场景才返回明文密码。
        """
        groups = self.db.query(TeamResourceGroup).filter(
            TeamResourceGroup.deleted == 0
        ).order_by(TeamResourceGroup.sort_order).all()

        systems = self.db.query(TeamResourceSystem).filter(
            TeamResourceSystem.deleted == 0
        ).order_by(TeamResourceSystem.sort_order).all()

        environments = self.db.query(TeamResourceEnvironment).filter(
            TeamResourceEnvironment.deleted == 0
        ).all()

        credentials = self.db.query(TeamResourceCredential).filter(
            TeamResourceCredential.deleted == 0
        ).order_by(TeamResourceCredential.sort_order).all()

        # 建立索引映射
        env_by_id = {env.id: env for env in environments}
        creds_by_env_id: Dict[int, List] = {}
        
        for cred in credentials:
            if cred.environment_id not in creds_by_env_id:
                creds_by_env_id[cred.environment_id] = []
            creds_by_env_id[cred.environment_id].append(
                self._serialize_credential(cred, decrypt_pass=decrypt_pass)
            )

        envs_by_system_id: Dict[str, Dict[str, Any]] = {}
        for env in environments:
            if env.system_id not in envs_by_system_id:
                envs_by_system_id[env.system_id] = {}
            envs_by_system_id[env.system_id][env.env_type] = {
                "url": env.url or "",
                "adminUrl": env.admin_url or "",
                "skipHealthCheck": bool(env.skip_health_check),
                "skipCertCheck": bool(env.skip_cert_check),
                "creds": creds_by_env_id.get(env.id, [])
            }

        systems_by_group_id: Dict[str, List] = {}
        for sys in systems:
            if sys.group_id not in systems_by_group_id:
                systems_by_group_id[sys.group_id] = []
            systems_by_group_id[sys.group_id].append({
                "id": sys.system_id,
                "name": sys.name,
                "description": sys.description or "",
                "environments": envs_by_system_id.get(sys.system_id, {})
            })

        result = []
        for group in groups:
            result.append({
                "id": group.group_id,
                "name": group.name,
                "logo": group.logo or "",
                "systems": systems_by_group_id.get(group.group_id, [])
            })

        return result

    def save_all_data(self, groups_data: List[Dict[str, Any]]) -> bool:
        """保存所有团队资源数据（覆盖策略）"""
        # 导入密码加密工具
        from ..password_crypto import encrypt_password
        
        try:
            # 收集所有要保留的 ID
            input_group_ids = [g["id"] for g in groups_data]
            input_system_ids = []
            input_env_keys = []  # (system_id, env_type)
            input_cred_ids = []

            for group in groups_data:
                for system in group.get("systems", []):
                    input_system_ids.append(system["id"])
                    for env_type, env_data in system.get("environments", {}).items():
                        input_env_keys.append((system["id"], env_type))
                        for cred in env_data.get("creds", []):
                            input_cred_ids.append(cred["id"])

            # 逻辑删除不在输入中的记录
            self.db.query(TeamResourceGroup).filter(
                TeamResourceGroup.group_id.notin_(input_group_ids),
                TeamResourceGroup.deleted == 0
            ).update({TeamResourceGroup.deleted: 1}, synchronize_session=False)

            self.db.query(TeamResourceSystem).filter(
                TeamResourceSystem.system_id.notin_(input_system_ids),
                TeamResourceSystem.deleted == 0
            ).update({TeamResourceSystem.deleted: 1}, synchronize_session=False)

            # 环境和凭证的删除逻辑稍复杂，先处理
            existing_envs = self.db.query(TeamResourceEnvironment).filter(
                TeamResourceEnvironment.deleted == 0
            ).all()
            for env in existing_envs:
                if (env.system_id, env.env_type) not in input_env_keys:
                    env.deleted = 1

            self.db.query(TeamResourceCredential).filter(
                TeamResourceCredential.cred_id.notin_(input_cred_ids),
                TeamResourceCredential.deleted == 0
            ).update({TeamResourceCredential.deleted: 1}, synchronize_session=False)

            # 同步集团
            for idx, group_data in enumerate(groups_data):
                existing_group = self.db.query(TeamResourceGroup).filter(
                    TeamResourceGroup.group_id == group_data["id"]
                ).first()
                if existing_group:
                    existing_group.name = group_data["name"]
                    existing_group.logo = group_data.get("logo", "")
                    existing_group.sort_order = idx
                    existing_group.deleted = 0
                else:
                    new_group = TeamResourceGroup(
                        group_id=group_data["id"],
                        name=group_data["name"],
                        logo=group_data.get("logo", ""),
                        sort_order=idx
                    )
                    self.db.add(new_group)

                # 同步系统
                for sys_idx, system_data in enumerate(group_data.get("systems", [])):
                    existing_system = self.db.query(TeamResourceSystem).filter(
                        TeamResourceSystem.system_id == system_data["id"]
                    ).first()
                    if existing_system:
                        existing_system.group_id = group_data["id"]
                        existing_system.name = system_data["name"]
                        existing_system.description = system_data.get("description", "")
                        existing_system.sort_order = sys_idx
                        existing_system.deleted = 0
                    else:
                        new_system = TeamResourceSystem(
                            system_id=system_data["id"],
                            group_id=group_data["id"],
                            name=system_data["name"],
                            description=system_data.get("description", ""),
                            sort_order=sys_idx
                        )
                        self.db.add(new_system)

                    # 同步环境
                    for env_type, env_data in system_data.get("environments", {}).items():
                        existing_env = self.db.query(TeamResourceEnvironment).filter(
                            TeamResourceEnvironment.system_id == system_data["id"],
                            TeamResourceEnvironment.env_type == env_type
                        ).first()
                        if existing_env:
                            existing_env.url = env_data.get("url", "")
                            existing_env.admin_url = env_data.get("adminUrl", "")
                            existing_env.skip_health_check = 1 if env_data.get("skipHealthCheck") else 0
                            existing_env.skip_cert_check = 1 if env_data.get("skipCertCheck") else 0
                            existing_env.deleted = 0
                            env_id = existing_env.id
                        else:
                            new_env = TeamResourceEnvironment(
                                system_id=system_data["id"],
                                env_type=env_type,
                                url=env_data.get("url", ""),
                                admin_url=env_data.get("adminUrl", ""),
                                skip_health_check=1 if env_data.get("skipHealthCheck") else 0,
                                skip_cert_check=1 if env_data.get("skipCertCheck") else 0
                            )
                            self.db.add(new_env)
                            self.db.flush()  # 获取 id
                            env_id = new_env.id

                        # 同步凭证
                        for cred_idx, cred_data in enumerate(env_data.get("creds", [])):
                            existing_cred = self.db.query(TeamResourceCredential).filter(
                                TeamResourceCredential.cred_id == cred_data["id"]
                            ).first()
                            next_password = cred_data.get("password")
                            if existing_cred:
                                existing_cred.environment_id = env_id
                                existing_cred.label = cred_data.get("label", "")
                                existing_cred.username = cred_data.get("username", "")
                                if next_password is not None:
                                    existing_cred.password = encrypt_password(next_password)
                                existing_cred.note = cred_data.get("note", "")
                                existing_cred.sort_order = cred_idx
                                existing_cred.deleted = 0
                            else:
                                new_cred = TeamResourceCredential(
                                    cred_id=cred_data["id"],
                                    environment_id=env_id,
                                    label=cred_data.get("label", ""),
                                    username=cred_data.get("username", ""),
                                    password=encrypt_password(next_password or ""),  # 加密密码
                                    note=cred_data.get("note", ""),
                                    sort_order=cred_idx
                                )
                                self.db.add(new_cred)

            self.db.commit()
            
            # 自动备份到 JSON
            try:
                self.save_json_backup()
            except Exception as backup_error:
                logger.error(f"Failed to backup to JSON: {backup_error}")
                # 备份失败不影响主流程，但记录错误
            
            return True
        except Exception as e:
            self.db.rollback()
            logger.error(f"Failed to save team resources: {e}")
            raise e

    def save_json_backup(self):
        """
        将当前数据库状态备份到 team-resources.enc.json
        注意：JSON文件是全量加密的（兼容之前的格式），而数据库中只是密码字段加密。
        """
        import json
        import hashlib
        import base64
        from Crypto.Cipher import AES
        from Crypto.Util.Padding import pad
        from Crypto.Random import get_random_bytes
        from pathlib import Path
        
        # 1. 获取不需要解密密码的数据（得拿到password的密文）
        # 但前端之前的加密逻辑是：
        #   JSON -> 明文 -> AES 全量加密 -> file
        #   所以这里应该是：
        #   DB数据 -> 解密所有密码 -> 得到完全明文的对象 -> JSON序列化 -> AES 全量加密 -> file
        
        # 获取完全明文的数据（解密DB中的密码）
        data = self.get_all_data(decrypt_pass=True)
        
        # 2. 准备加密
        # 密钥（需要与前端一致）
        import os
        ENCRYPTION_KEY = os.getenv("TEAM_RESOURCES_EXPORT_ENCRYPTION_KEY", "")
        if not ENCRYPTION_KEY:
            raise ValueError("Missing TEAM_RESOURCES_EXPORT_ENCRYPTION_KEY environment variable")
        
        # 序列化为字符串
        json_str = json.dumps(data, ensure_ascii=False)
        
        # 3. 加密逻辑 (CryptoJS 兼容)
        # 派生密钥和IV
        salt = get_random_bytes(8)
        
        def evp_bytes_to_key(pwd: bytes, salt: bytes, key_len: int = 32, iv_len: int = 16):
            d = b''
            d_i = b''
            while len(d) < key_len + iv_len:
                d_i = hashlib.md5(d_i + pwd + salt).digest()
                d += d_i
            return d[:key_len], d[key_len:key_len + iv_len]
            
        key, iv = evp_bytes_to_key(ENCRYPTION_KEY.encode('utf-8'), salt)
        
        cipher = AES.new(key, AES.MODE_CBC, iv)
        ciphertext = cipher.encrypt(pad(json_str.encode('utf-8'), AES.block_size))
        
        # 格式：Salted__ + salt + ciphertext (Base64编码)
        encrypted_bytes = b'Salted__' + salt + ciphertext
        encrypted_data = base64.b64encode(encrypted_bytes).decode('utf-8')
        
        # 4. 写入文件
        project_root = Path(__file__).parent.parent.parent.parent
        # 注意文件名改回 .enc.json
        backup_root = os.getenv("TEAM_RESOURCES_BACKUP_DIR")
        json_path = (Path(backup_root) if backup_root else project_root / "my-app" / "data") / "team-resources.enc.json"
        
        # 确保目录存在
        json_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(json_path, 'w', encoding='utf-8') as f:
            f.write(encrypted_data)
            
        logger.info(f"Backed up encrypted team resources to {json_path}")

    def import_from_json(self, groups_data: List[Dict[str, Any]]) -> Dict[str, int]:
        """从 JSON 数据导入到数据库（用于迁移）"""
        stats = {"groups": 0, "systems": 0, "environments": 0, "credentials": 0}
        
        try:
            for idx, group_data in enumerate(groups_data):
                new_group = TeamResourceGroup(
                    group_id=group_data["id"],
                    name=group_data["name"],
                    logo=group_data.get("logo", ""),
                    sort_order=idx
                )
                self.db.add(new_group)
                stats["groups"] += 1

                for sys_idx, system_data in enumerate(group_data.get("systems", [])):
                    new_system = TeamResourceSystem(
                        system_id=system_data["id"],
                        group_id=group_data["id"],
                        name=system_data["name"],
                        description=system_data.get("description", ""),
                        sort_order=sys_idx
                    )
                    self.db.add(new_system)
                    stats["systems"] += 1

                    for env_type, env_data in system_data.get("environments", {}).items():
                        new_env = TeamResourceEnvironment(
                            system_id=system_data["id"],
                            env_type=env_type,
                            url=env_data.get("url", ""),
                            admin_url=env_data.get("adminUrl", ""),
                            skip_health_check=1 if env_data.get("skipHealthCheck") else 0,
                            skip_cert_check=1 if env_data.get("skipCertCheck") else 0
                        )
                        self.db.add(new_env)
                        self.db.flush()
                        stats["environments"] += 1

                        for cred_idx, cred_data in enumerate(env_data.get("creds", [])):
                            new_cred = TeamResourceCredential(
                                cred_id=cred_data["id"],
                                environment_id=new_env.id,
                                label=cred_data.get("label", ""),
                                username=cred_data.get("username", ""),
                                password=cred_data.get("password", ""),
                                note=cred_data.get("note", ""),
                                sort_order=cred_idx
                            )
                            self.db.add(new_cred)
                            stats["credentials"] += 1

            self.db.commit()
            return stats
        except Exception as e:
            self.db.rollback()
            logger.error(f"Failed to import team resources: {e}")
            raise e
