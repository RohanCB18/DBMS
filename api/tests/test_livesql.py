"""Statement checks of the live SQL console (the database role is the real enforcement)."""
import pytest

from app.livesql import check_statement
from app.vcs import VcsError


@pytest.mark.parametrize("q,kind", [
    ("UPDATE customers SET phone = '1' WHERE customer_id = 7", "update"),
    ("update accounts set status='FROZEN' where account_id=1;", "update"),
    ("DELETE FROM transactions WHERE txn_id = 100700", "delete"),
    ("INSERT INTO customers (customer_id) VALUES (99) RETURNING *", "insert"),
    ("INSERT INTO bank_branches VALUES ('A','b','c','d') ON CONFLICT (branch_code) DO UPDATE SET city = 'x'", "insert"),
    ("SELECT sp_settle_txn(sp_transfer(1, 2, 100, 'UPI', 'x'))", "select"),
    ("WITH x AS (SELECT 1) SELECT * FROM x", "with"),
    ("UPDATE customers SET full_name = 'drop table; create' WHERE customer_id = 1", "update"),
    ("-- fix\nUPDATE customers SET city = 'Pune' WHERE customer_id = 1", "update"),
])
def test_accepts_single_dml(q, kind):
    assert check_statement(q)[1] == kind


@pytest.mark.parametrize("q", [
    "", "TRUNCATE transactions", "DROP TABLE customers", "ALTER TABLE customers ADD x int",
    "CREATE TABLE x (a int)", "GRANT ALL ON customers TO public", "COPY customers TO 'f'",
    "BEGIN", "SET search_path = vcs", "UPDATE customers SET city = 'A' WHERE customer_id = 1; DELETE FROM accounts WHERE true",
    "DO $$ BEGIN END $$", "CALL vcs.sp_record_commit()", "SELECT 1; SELECT 2",
])
def test_rejects_everything_else(q):
    with pytest.raises(VcsError):
        check_statement(q)


def test_whole_table_changes_need_confirmation():
    for q in ("UPDATE customers SET city = 'X'", "DELETE FROM transactions"):
        with pytest.raises(VcsError) as e:
            check_statement(q)
        assert e.value.status == 422 and e.value.extra.get("needs_confirmation")
        assert check_statement(q, allow_full_table=True)
