"""Statement guard of the SQL console, proof-package validation, value coercion and change sets."""
import pytest

from app.proofs import _coerce, _validate
from app.sqlconsole import check_query, schema_name
from app.vcs import VcsError, _changes


@pytest.mark.parametrize("q", [
    "SELECT 1", "select * from transactions;", "  WITH x AS (SELECT 1) SELECT * FROM x ;;",
    "SELECT ';' AS semi", "-- comment\nSELECT 1", "/* c; */ SELECT 2",
])
def test_sql_guard_accepts_single_selects(q):
    assert check_query(q)


@pytest.mark.parametrize("q", [
    "", ";", "DELETE FROM transactions", "SELECT 1; DROP TABLE t", "UPDATE t SET a=1",
    "INSERT INTO t VALUES (1)", "CREATE TABLE x (a int)", "COPY t TO 'f'", "-- SELECT\nDELETE FROM t",
])
def test_sql_guard_rejects_everything_else(q):
    with pytest.raises(VcsError):
        check_query(q)


def test_schema_name_only_for_commit_ids():
    assert schema_name("0123456789abcdef") == "snap_0123456789abcdef"
    with pytest.raises(VcsError):
        schema_name("x; DROP SCHEMA bank")


GOOD = {"commit_id": "abc", "root": "1", "proof": {}, "publicSignals": ["1"] * 6,
        "claim": {"table": "t", "pk": 1, "field": "f", "op": "eq", "value": "v"}}


def test_package_validation():
    _validate(GOOD)
    for bad in ({}, [], {**GOOD, "publicSignals": ["1"] * 5}, {**GOOD, "claim": {**GOOD["claim"], "op": "neq"}}):
        with pytest.raises(VcsError) as e:
            _validate(bad)
        assert e.value.status == 400


def test_coerce_matches_stored_type():
    assert _coerce(5, "gte", "7") == 7
    assert _coerce(True, "eq", "true") is True
    assert _coerce("COMPLETED", "eq", 5) == "5"
    with pytest.raises(VcsError):
        _coerce(5, "eq", "abc")
    with pytest.raises(VcsError):
        _coerce("text", "gte", "a")


def test_changes_between_manifests():
    parent = {"entries": [{"key": "a", "blob": "1"}, {"key": "b", "blob": "2"}, {"key": "c", "blob": "3"}]}
    entries = [{"key": "a", "blob": "1"}, {"key": "b", "blob": "9"}, {"key": "d", "blob": "4"}]
    ch = _changes(parent, entries)
    assert [c["key"] for c in ch["added"]] == ["d"]
    assert ch["modified"] == [{"key": "b", "blob": "9", "prev": "2"}]
    assert [c["key"] for c in ch["deleted"]] == ["c"]
    assert len(_changes(None, entries)["added"]) == 3
