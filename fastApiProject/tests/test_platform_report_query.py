"""Execute report SQL against isolated rows; production reconciliation is separate."""

import sqlite3
from decimal import Decimal

import pytest

from app import reports


def insert_settlement(connection, record_id, **changes):
    row = {
        'id': record_id,
        'worker_id': 228,
        'enterprise_id': 47,
        'enterprise_name': 'Synthetic enterprise',
        'tax_id': 3,
        'tax_address': 'Synthetic tax region',
        'realname': 'Synthetic worker',
        'credential_num': 'synthetic-credential',
        'payment_account': 'synthetic-payment-account',
        'pay_amount': '110.00',
        'worker_pay_amount': '100.00',
        'bill_amount': '120.00',
        'service_amount': '10.00',
        'tax_amount': '1.00',
        'mobile': 'synthetic-mobile',
        'payment_over_time': '2026-06-15 12:00:00',
        'pay_status': 3,
        'deleted': 0,
        'service_pay_status': 0,
        'tax_pay_status': 0,
    }
    row.update(changes)
    columns = ', '.join(row)
    placeholders = ', '.join('?' for _ in row)
    connection.execute(
        f'INSERT INTO biz_balance_worker ({columns}) VALUES ({placeholders})',
        tuple(row.values()),
    )


@pytest.fixture
def report_database(monkeypatch):
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.executescript("""
        CREATE TABLE biz_balance_worker (
            id INTEGER PRIMARY KEY, worker_id INTEGER, enterprise_id INTEGER,
            enterprise_name TEXT, tax_id INTEGER, tax_address TEXT,
            realname TEXT, credential_num TEXT, payment_account TEXT,
            pay_amount NUMERIC, worker_pay_amount NUMERIC, bill_amount NUMERIC,
            service_amount NUMERIC, tax_amount NUMERIC, mobile TEXT,
            payment_over_time TEXT, pay_status INTEGER, deleted INTEGER,
            service_pay_status INTEGER, tax_pay_status INTEGER
        );
        CREATE TABLE biz_enterprise_base (
            id INTEGER PRIMARY KEY, enterprise_name TEXT, USCC TEXT
        );
        CREATE TABLE biz_worker_account (
            id INTEGER PRIMARY KEY, worker_id INTEGER, username TEXT,
            create_time TEXT NOT NULL, update_time TEXT, deleted INTEGER
        );
        CREATE TABLE biz_enterprise_sign (
            id INTEGER PRIMARY KEY, worker_id INTEGER, sign_time TEXT,
            sign_status INTEGER, deleted INTEGER
        );
        INSERT INTO biz_enterprise_base VALUES (47, 'Synthetic enterprise', 'synthetic-uscc');
        INSERT INTO biz_enterprise_base VALUES (43, 'Synthetic enterprise B', 'synthetic-uscc-b');
        INSERT INTO biz_enterprise_base VALUES (36, 'Excluded enterprise', 'excluded-uscc');
    """)

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, sql, params):
            self.cursor = connection.execute(sql.replace('%s', '?'), params)

        def fetchall(self):
            return [dict(row) for row in self.cursor.fetchall()]

    class Database:
        def __init__(self, _config):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def cursor(self, *_args):
            return Cursor()

    monkeypatch.setattr(reports, 'DatabaseManager', Database)
    platform = reports.PlatformReportGenerator.__new__(reports.PlatformReportGenerator)
    platform.db_config = {}
    tax = reports.TaxReportGenerator.__new__(reports.TaxReportGenerator)
    tax.db_config = {}
    yield connection, platform, tax
    connection.close()


def query_platform(platform, **changes):
    parameters = {
        'start_date': '2026-01-01', 'end_date': '2026-10-31',
        'enterprise_ids': [47, 43], 'amount_type': 2, 'tax_id': 3,
    }
    parameters.update(changes)
    return platform.query_platform_data(**parameters)


@pytest.mark.parametrize('account_count', [0, 1, 3])
def test_identical_settlement_amounts_are_counted_once_per_id(report_database, account_count):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1)
    insert_settlement(connection, 2)
    for account_id in range(1, account_count + 1):
        connection.execute(
            'INSERT INTO biz_worker_account VALUES (?, 228, ?, ?, ?, 0)',
            (account_id, f'account-{account_id}', f'2026-0{account_id}-01', '2026-09-01'),
        )

    rows = query_platform(platform)
    assert len(rows) == 1
    row = rows[0]
    assert row['labor_income'] == 200
    assert row['tax_amount'] == 2
    assert row['service_fee'] == 20
    assert row['total_with_tax'] == 202
    assert row['trade_count'] == 2
    assert row['miniapp_id'] == (f'account-{account_count}' if account_count else None)


def test_latest_account_uses_creation_time_instead_of_username_update_time_or_id(report_database):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1)
    connection.executemany('INSERT INTO biz_worker_account VALUES (?, 228, ?, ?, ?, 0)', [
        (900, 'zzz-old-account', '2026-01-01', '2026-10-01'),
        (100, 'aaa-latest-account', '2026-06-01', '2026-06-01'),
    ])
    row = query_platform(platform)[0]
    assert row['miniapp_id'] == 'aaa-latest-account'
    assert row['labor_income'] == 100
    assert row['trade_count'] == 1


def test_equal_creation_times_use_the_greater_account_id(report_database):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1)
    connection.executemany('INSERT INTO biz_worker_account VALUES (?, 228, ?, ?, ?, 0)', [
        (1, 'zzz-account', '2026-06-01', '2026-10-01'),
        (2, 'aaa-account', '2026-06-01', '2026-06-01'),
    ])
    assert query_platform(platform)[0]['miniapp_id'] == 'aaa-account'


@pytest.mark.parametrize('has_current_account', [False, True])
def test_deleted_accounts_do_not_override_current_binding_or_remove_settlements(report_database, has_current_account):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1)
    connection.execute("INSERT INTO biz_worker_account VALUES (3, 228, 'deleted-latest', '2026-10-01', '2026-10-01', 1)")
    if has_current_account:
        connection.execute("INSERT INTO biz_worker_account VALUES (2, 228, 'current-account', '2026-06-01', '2026-06-01', 0)")
        connection.execute("INSERT INTO biz_worker_account VALUES (1, 228, 'deleted-old', '2026-01-01', '2026-01-01', 1)")
    row = query_platform(platform)[0]
    assert row['miniapp_id'] == ('current-account' if has_current_account else None)
    assert row['labor_income'] == 100
    assert row['trade_count'] == 1


def test_cross_enterprise_records_remain_separate_even_when_enterprise_labels_match(report_database):
    connection, platform, _tax = report_database
    connection.execute("UPDATE biz_enterprise_base SET enterprise_name = 'Synthetic enterprise', USCC = 'synthetic-uscc' WHERE id = 43")
    insert_settlement(connection, 1, enterprise_id=47)
    insert_settlement(connection, 2, enterprise_id=43)
    connection.executemany('INSERT INTO biz_worker_account VALUES (?, 228, ?, ?, ?, 0)', [
        (1, 'old-account', '2026-01-01', '2026-01-01'),
        (2, 'latest-account', '2026-06-01', '2026-06-01'),
    ])
    rows = query_platform(platform)
    assert len(rows) == 2
    assert [row['trade_count'] for row in rows] == [1, 1]
    assert sum(row['labor_income'] for row in rows) == 200
    assert all(row['miniapp_id'] == 'latest-account' for row in rows)


def test_platform_filters_include_end_day_and_exclude_invalid_settlements(report_database):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1, payment_over_time='2026-01-01 00:00:00')
    insert_settlement(connection, 2, payment_over_time='2026-10-31 23:59:59.999999')
    excluded = [
        {'payment_over_time': '2025-12-31 23:59:59'},
        {'payment_over_time': '2026-11-01 00:00:00'},
        {'deleted': 1}, {'pay_status': 2}, {'tax_id': 2}, {'enterprise_id': 36},
    ]
    for record_id, changes in enumerate(excluded, start=3):
        insert_settlement(connection, record_id, worker_pay_amount='9999.99', **changes)
    row = query_platform(platform, enterprise_ids=None)[0]
    assert row['labor_income'] == 200
    assert row['trade_count'] == 2


def test_multiple_signatures_do_not_multiply_amounts_and_deleted_signatures_are_ignored(report_database):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1)
    connection.executemany('INSERT INTO biz_enterprise_sign VALUES (?, 228, ?, ?, ?)', [
        (1, '2025-01-01', 0, 1), (2, '2026-02-01', 0, 0),
        (3, '2026-03-01', 0, 0), (4, '2026-01-01', 1, 0),
    ])
    row = query_platform(platform)[0]
    assert row['sign_time'] == '2026-02-01'
    assert row['labor_income'] == 100
    assert row['trade_count'] == 1


def test_report_line_rounds_after_summing_subcent_amounts(report_database):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1, service_amount='0.004', tax_amount='0.004')
    insert_settlement(connection, 2, service_amount='0.004', tax_amount='0.004')
    row = query_platform(platform)[0]
    assert Decimal(str(row['service_fee'])) == Decimal('0.01')
    assert Decimal(str(row['tax_amount'])) == Decimal('0.01')
    assert row['trade_count'] == 2


@pytest.mark.parametrize(('amount_type', 'expected'), [(1, 110), (2, 100), (3, 120)])
def test_amount_type_keeps_its_existing_settlement_field(report_database, amount_type, expected):
    connection, platform, _tax = report_database
    insert_settlement(connection, 1)
    assert query_platform(platform, amount_type=amount_type)[0]['labor_income'] == expected


@pytest.mark.parametrize(('month', 'start', 'last', 'next_start'), [
    ('2026-01', '2026-01-01 00:00:00', '2026-01-31 23:59:59', '2026-02-01 00:00:00'),
    ('2026-12', '2026-12-01 00:00:00', '2026-12-31 23:59:59', '2027-01-01 00:00:00'),
])
def test_monthly_tax_report_uses_the_same_valid_record_and_date_boundary_rules(report_database, month, start, last, next_start):
    connection, _platform, tax = report_database
    insert_settlement(connection, 1, payment_over_time=start)
    insert_settlement(connection, 2, payment_over_time=last)
    insert_settlement(connection, 3, payment_over_time=next_start)
    insert_settlement(connection, 4, payment_over_time=start, deleted=1)
    insert_settlement(connection, 5, payment_over_time=start, pay_status=2)
    insert_settlement(connection, 6, payment_over_time=start, enterprise_id=36)
    rows = tax.query_tax_data(month, [47, 43], 2)
    assert len(rows) == 2
    assert sum(Decimal(str(row['营业额_元'])) for row in rows) == Decimal('200.00')
    assert sum(Decimal(str(row['tax_amount'])) for row in rows) == Decimal('2.00')
