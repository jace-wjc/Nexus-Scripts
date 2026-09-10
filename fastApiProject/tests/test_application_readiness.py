import asyncio
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from app import main
from app.services.match_scheduler import FairMatchScheduler, KeyRotator
from app.services.recruitment_task_control import RecruitmentTaskControl


def test_lifespan_only_marks_ready_after_startup_and_stops_background_tasks(monkeypatch):
    async def scenario():
        task = None

        async def startup():
            nonlocal task
            assert not main.app.state.recruitment_ready
            task = asyncio.create_task(asyncio.sleep(3600))
            main.app.state.background_tasks.append(task)

        monkeypatch.setattr(main, "startup_event", startup)
        stop = AsyncMock()
        monkeypatch.setattr(main.scheduler, "stop", stop)
        async with main.application_lifespan(main.app):
            assert main.app.state.recruitment_ready
        assert not main.app.state.recruitment_ready
        assert task.cancelled()
        stop.assert_awaited_once()
    asyncio.run(scenario())


def test_startup_failure_is_not_reported_as_readiness(monkeypatch):
    async def scenario():
        monkeypatch.setattr(main, "startup_event", AsyncMock(side_effect=RuntimeError("synthetic schema failure")))
        monkeypatch.setattr(main.scheduler, "stop", AsyncMock())
        with pytest.raises(RuntimeError, match="synthetic schema failure"):
            async with main.application_lifespan(main.app):
                pytest.fail("must not serve after a failed initialization")
        assert not main.app.state.recruitment_ready
    asyncio.run(scenario())


def test_readiness_is_read_only_and_handles_database_outage(monkeypatch):
    monkeypatch.setattr(main.app.state, "recruitment_ready", True, raising=False)
    monkeypatch.setattr(main.scheduler, "running", True)
    session = MagicMock()
    monkeypatch.setattr(main, "SessionLocal", session)
    assert main.health_ready() == {"status": "ready"}
    db = session.return_value.__enter__.return_value
    assert str(db.execute.call_args.args[0]) == "SELECT 1"
    db.commit.assert_not_called()
    db.execute.side_effect = RuntimeError("synthetic database outage")
    assert main.health_ready().status_code == 503
    monkeypatch.setattr(main.app.state, "recruitment_ready", False)
    session.reset_mock()
    assert main.health_ready().status_code == 503
    session.assert_not_called()


def test_match_shutdown_cancels_provider_connection_without_marking_user_cancellation():
    async def scenario():
        scheduler = FairMatchScheduler(KeyRotator())
        control = RecruitmentTaskControl(7)
        close = Mock()
        control.register_closer(close)
        scheduler.register_task_control(7, control)
        await scheduler.stop()
        assert control.is_cancelled()
        close.assert_called_once()
        assert not scheduler.is_cancelled(7)
    asyncio.run(scenario())
