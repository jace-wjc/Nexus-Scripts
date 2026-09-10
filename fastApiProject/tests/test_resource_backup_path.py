import base64
import hashlib
import json

from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

from app.services.team_resource_service import TeamResourceService


def test_configured_backup_directory_preserves_cryptojs_format(monkeypatch, tmp_path):
    key_text = "synthetic-backup-key"
    monkeypatch.setenv("TEAM_RESOURCES_EXPORT_ENCRYPTION_KEY", key_text)
    monkeypatch.setenv("TEAM_RESOURCES_BACKUP_DIR", str(tmp_path / "backups"))
    service = TeamResourceService(object())
    synthetic = [{"id": "synthetic", "systems": []}]
    monkeypatch.setattr(service, "get_all_data", lambda decrypt_pass: synthetic if decrypt_pass else [])
    service.save_json_backup()
    output = tmp_path / "backups" / "team-resources.enc.json"
    ciphertext = base64.b64decode(output.read_bytes())
    assert ciphertext[:8] == b"Salted__"
    key_material, previous = b"", b""
    while len(key_material) < 48:
        previous = hashlib.md5(previous + key_text.encode() + ciphertext[8:16]).digest()
        key_material += previous
    raw = AES.new(key_material[:32], AES.MODE_CBC, key_material[32:48]).decrypt(ciphertext[16:])
    assert json.loads(unpad(raw, AES.block_size).decode()) == synthetic
