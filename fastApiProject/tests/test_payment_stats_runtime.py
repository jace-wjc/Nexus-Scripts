import asyncio
import json
import threading
import time

import httpx
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.pool import QueuePool

from app.routers import business_core
from app.services import payment_stats_service
from app.script_hub_session import create_script_hub_session


def app_and_headers():
    app = FastAPI()
    app.include_router(business_core.business_core_router)
    token = create_script_hub_session({'id': 'synthetic-payment-reviewer', 'permissions': {'payment-stats': True}})['token']
    return app, {'Authorization': 'Bearer ' + token}


@pytest.mark.parametrize('endpoint,method', [('enterprises', 'get_normal_enterprises'), ('calculate', 'calculate_stats')])
def test_payment_sync_work_runs_outside_event_loop(monkeypatch, endpoint, method):
    calls = []
    class SlowService:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def execute(self, **kwargs):
            calls.append(threading.get_ident())
            time.sleep(0.15)
            return [] if endpoint == 'enterprises' else {'total_settlement': 0.0}
    setattr(SlowService, method, SlowService.execute)
    monkeypatch.setattr(business_core, 'PaymentStatsService', SlowService)
    app, headers = app_and_headers()
    @app.get('/synthetic-heartbeat')
    async def heartbeat(): return {'alive': True}

    async def scenario():
        loop_thread = threading.get_ident()
        latencies = []
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://synthetic') as client:
            for _ in range(3):
                start = time.perf_counter()
                async def probe():
                    await asyncio.sleep(0.02)
                    reply = await client.get('/synthetic-heartbeat')
                    assert reply.json() == {'alive': True}
                    latencies.append((time.perf_counter() - start - 0.02) * 1000)
                response, _ = await asyncio.gather(client.post('/stats/payment/' + endpoint, headers=headers,
                                                    json={'environment': 'local', 'enterprise_ids': [1]}), probe())
                assert response.status_code == 200
                assert response.json()['success'] is True
        print(json.dumps({'endpoint': endpoint, 'service_delay_ms': 150, 'rounds': 3,
                          'heartbeat_lateness_ms': latencies, 'worker_threads': [value != loop_thread for value in calls]}))
        assert len(calls) == 3
        assert all(value != loop_thread for value in calls), 'synchronous service blocked the ASGI event loop'
    asyncio.run(scenario())


@pytest.mark.parametrize('query_fails', [False, True])
def test_payment_request_closes_real_test_pool_even_when_query_fails(monkeypatch, query_fails):
    engines, opened, closed = [], [], []
    def engine_factory(_self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=QueuePool)
        engines.append(engine)
        event.listen(engine, 'connect', lambda *_: opened.append(True))
        event.listen(engine, 'close', lambda *_: closed.append(True))
        return engine
    monkeypatch.setattr(payment_stats_service.PaymentStatsService, '_init_db_connection', engine_factory)
    def query(*args, **kwargs):
        if query_fails: raise RuntimeError('synthetic query failure')
        return pd.DataFrame([{'enterprise_name': 'synthetic enterprise', 'id': 1}])
    monkeypatch.setattr(payment_stats_service.pd, 'read_sql', query)
    app, headers = app_and_headers()
    try:
        with TestClient(app) as client:
            for _ in range(3):
                response = client.post('/stats/payment/enterprises', headers=headers, json={'environment': 'local'})
                assert response.status_code == 200
                assert response.json()['success'] is not query_fails
                if not query_fails:
                    assert response.json()['data'] == {'enterprises': [{'enterprise_name': 'synthetic enterprise', 'id': 1}]}
        assert len(opened) == len(closed) == 3
    finally:
        for engine in engines: engine.dispose()
