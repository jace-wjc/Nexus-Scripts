from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import business_core, settlement_sim
from app.script_hub_session import create_script_hub_session


def headers(permission):
    token = create_script_hub_session({"id": "synthetic-operator", "name": "Synthetic", "permissions": {permission: True}})["token"]
    return {"Authorization": f"Bearer {token}"}


def test_settlement_sim_auth_precedes_business_database(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Unauthorized request reached business configuration/database")
    monkeypatch.setattr(settlement_sim, "DatabaseManager", forbidden)
    monkeypatch.setattr(settlement_sim, "settings", SimpleNamespace(get_db_config=forbidden))
    app = FastAPI()
    app.include_router(settlement_sim.settlement_sim_router)
    with TestClient(app) as client:
        body = {"mode": "batch_no", "batch_no": "SYNTHETIC"}
        assert client.post("/settlement-sim/execute", json=body).status_code == 401
        assert client.post("/settlement-sim/execute", json=body, headers=headers("settlement")).status_code == 403


@pytest.mark.parametrize("mode,statement_count", [("batch_no", 2), ("balance_no", 1), ("batch_no_tax", 1), ("balance_no_tax", 1)])
def test_settlement_sim_authorized_modes_preserve_commit_and_parameters(monkeypatch, caplog, mode, statement_count):
    statements = []
    commits = []

    class Database:
        rowcount = 2
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def cursor(self, *args): return self
        def execute(self, sql, parameters): statements.append((sql, parameters))
        def fetchall(self): return []
        def commit(self): commits.append(True)

    monkeypatch.setattr(settlement_sim, "DatabaseManager", lambda config: Database())
    monkeypatch.setattr(settlement_sim, "settings", SimpleNamespace(get_db_config=lambda env: {"synthetic": env}))
    monkeypatch.setattr(settlement_sim, "build_pay_over_time", lambda *args: datetime(2026, 1, 15, 12))
    app = FastAPI()
    app.include_router(settlement_sim.settlement_sim_router)
    with caplog.at_level("INFO"), TestClient(app) as client:
        response = client.post("/settlement-sim/execute", headers=headers("settlement-sim"), json={
            "mode": mode, "batch_no": "SYN-BATCH", "balance_no": "SYN-BALANCE", "env": "local",
        })
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert len(statements) == statement_count
    assert commits == [True]
    assert all("SYN-" not in sql for sql, _ in statements)
    assert "actor_id=synthetic-operator phase=committed" in caplog.text


@pytest.mark.parametrize("success,data", [(True, [{"result": "ok"}]), (False, None), (True, [{"success": True}, {"success": False}])])
def test_settlement_route_uses_current_dict_contract_once(monkeypatch, success, data):
    calls = []
    audits = []
    expected = {"success": success, "message": "synthetic-result", "data": data, "request_id": "synthetic-service-id"}
    def process(request):
        calls.append(request)
        return expected
    monkeypatch.setattr(business_core, "write_audit_log", lambda db, **kwargs: audits.append(kwargs))
    app = FastAPI()
    app.include_router(business_core.business_core_router)
    app.dependency_overrides[business_core.get_db] = lambda: object()
    app.dependency_overrides[business_core.get_settlement_service] = lambda: SimpleNamespace(process_settlement=process)
    with TestClient(app) as client:
        response = client.post("/settlement/process", headers=headers("settlement"), json={
            "enterprises": [], "concurrent_workers": 3, "interval_seconds": 0.5, "environment": "local", "mode": 2,
        })
    assert response.status_code == 200
    assert response.json() == expected
    assert len(calls) == 1
    assert calls[0].concurrent_workers == 3
    assert calls[0].interval_seconds == 0.5
    assert audits[0]["details"]["success"] is success
