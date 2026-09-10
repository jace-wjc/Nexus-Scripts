import pytest
import sys
import os

# 将app目录添加到sys.path，以便导入app模块
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../")))

from app.services.settlement_service import EnterpriseSettlementService
from app.models import SettlementRequest, EnterpriseTaskBase


@pytest.fixture(autouse=True)
def dispose_fixture_engines(monkeypatch):
    """Sessions return SQLite connections to pools; each test also owns its pool."""
    from sqlalchemy.engine import Engine
    from sqlalchemy.orm import close_all_sessions

    engines = []
    initialize = Engine.__init__

    def track_engine(engine, *args, **kwargs):
        initialize(engine, *args, **kwargs)
        engines.append(engine)

    monkeypatch.setattr(Engine, "__init__", track_engine)
    yield
    close_all_sessions()
    for engine in engines:
        engine.dispose()

@pytest.fixture
def settlement_service():
    return EnterpriseSettlementService(base_url="http://test-api.example.com")

@pytest.fixture
def sample_settlement_request():
    return SettlementRequest(
        environment="test",
        mode=1,
        concurrent_workers=1,
        interval_seconds=0,
        enterprises=[
            EnterpriseTaskBase(
                name="Test Enterprise",
                token="test-token",
                tenant_id="123",
                tax_id="456",
                items1=["B001"],
                items2=[],
                items3={}
            )
        ]
    )
