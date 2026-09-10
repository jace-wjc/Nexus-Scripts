"""Loaded before test collection by the isolated runner, never by the app."""
import os
import socket

import pytest


_patch = pytest.MonkeyPatch()


def pytest_configure():
    if os.environ.get("NEXUS_TEST_ISOLATED") != "1":
        raise pytest.UsageError("Use scripts/run_isolated_tests.py for source and configuration isolation")
    connect = socket.socket.connect
    mysql_port = int(os.environ.get("DB_LOCAL_PORT", "1"))
    mysql_allowed = os.environ.get("NEXUS_MYSQL_TEST_ISOLATED") == "1"

    def isolated_connect(connection, address):
        if connection.family in (socket.AF_INET, socket.AF_INET6):
            if mysql_allowed and address[0] in {"127.0.0.1", "::1"} and address[1] == mysql_port:
                return connect(connection, address)
            connection.close()
            raise RuntimeError("Network access is disabled in isolated unit tests; inject a fake service")
        return connect(connection, address)

    _patch.setattr(socket.socket, "connect", isolated_connect)
    _patch.setattr(socket.socket, "connect_ex", isolated_connect)


def pytest_unconfigure():
    _patch.undo()
