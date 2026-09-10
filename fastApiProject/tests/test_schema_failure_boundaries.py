from unittest.mock import MagicMock, Mock

import pytest

from app import schema_maintenance as schema


@pytest.mark.parametrize("result", [0, None])
def test_failed_schema_lock_never_enters_ddl_and_discards_connection(monkeypatch, result):
    engine = Mock()
    engine.dialect.name = "mysql"
    connection = engine.connect.return_value
    connection.execute.return_value.scalar.return_value = result
    monkeypatch.setattr(schema, "engine", engine)
    entered = False
    with pytest.raises(RuntimeError, match="Could not acquire schema lock"):
        with schema._MysqlAdvisoryLock("synthetic-lock"):
            entered = True
    assert entered is False
    connection.invalidate.assert_called_once()
    connection.close.assert_called_once()


def test_schema_lock_uses_one_connection_and_bound_parameters(monkeypatch):
    engine = Mock()
    engine.dialect.name = "mysql"
    connection = engine.connect.return_value
    connection.execute.return_value.scalar.return_value = 1
    monkeypatch.setattr(schema, "engine", engine)
    with schema._MysqlAdvisoryLock("synthetic-lock", timeout=2):
        pass
    assert engine.connect.call_count == 1
    calls = connection.execute.call_args_list
    assert str(calls[0].args[0]) == "SELECT GET_LOCK(:name, :timeout)"
    assert calls[0].args[1] == {"name": "synthetic-lock", "timeout": 2}
    assert str(calls[1].args[0]) == "SELECT RELEASE_LOCK(:name)"
    connection.invalidate.assert_not_called()
    connection.close.assert_called_once()


def test_release_failure_cannot_return_a_lock_holding_connection_to_pool(monkeypatch):
    engine = Mock()
    engine.dialect.name = "mysql"
    connection = engine.connect.return_value
    acquired = Mock()
    acquired.scalar.return_value = 1
    connection.execute.side_effect = [acquired, RuntimeError("synthetic transport error")]
    monkeypatch.setattr(schema, "engine", engine)
    with schema._MysqlAdvisoryLock("synthetic-lock"):
        pass
    connection.invalidate.assert_called_once()
    connection.close.assert_called_once()


@pytest.mark.parametrize("kind", ["column", "index"])
@pytest.mark.parametrize("stage", ["inspect", "ddl"])
def test_required_schema_step_failure_propagates_after_retries(monkeypatch, kind, stage):
    inspector = Mock()
    query = inspector.get_columns if kind == "column" else inspector.get_indexes
    query.return_value = []
    if stage == "inspect":
        query.side_effect = RuntimeError("synthetic permission denied")
    engine = MagicMock()
    if stage == "ddl":
        engine.begin.return_value.__enter__.return_value.execute.side_effect = RuntimeError("synthetic DDL failure")
    monkeypatch.setattr(schema, "engine", engine)
    monkeypatch.setattr(schema.time, "sleep", lambda seconds: None)
    helper = schema._add_column_if_missing if kind == "column" else schema._add_index_if_missing
    with pytest.raises(RuntimeError, match="Schema"):
        helper(inspector, "synthetic_table", "synthetic_field", "synthetic SQL", "created")
    if stage == "inspect":
        assert query.call_count == 3
        engine.begin.assert_not_called()
    else:
        assert engine.begin.call_count == 3


@pytest.mark.parametrize("kind", ["column", "index"])
def test_existing_schema_elements_remain_idempotent(monkeypatch, kind):
    inspector = Mock()
    query = inspector.get_columns if kind == "column" else inspector.get_indexes
    query.return_value = [{"name": "existing"}]
    engine = Mock()
    monkeypatch.setattr(schema, "engine", engine)
    helper = schema._add_column_if_missing if kind == "column" else schema._add_index_if_missing
    helper(inspector, "synthetic_table", "existing", "must not run", "created")
    engine.begin.assert_not_called()
