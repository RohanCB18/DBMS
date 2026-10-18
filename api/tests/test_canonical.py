from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.canonical import NFIELDS, blob_id, canon, make_record, record_key, unfold


def test_canon_scalars():
    assert canon(None) is None and canon(True) is True and canon("x") == "x"
    assert canon(Decimal("12")) == 12 and canon(Decimal("1.50")) == "1.50"
    assert canon(2**60) == str(2**60)            # beyond JS safe integers -> string
    assert canon(date(2026, 10, 1)) == "2026-10-01"


def test_canon_datetimes_are_utc_iso():
    ist = timezone(timedelta(hours=5, minutes=30))
    assert canon(datetime(2026, 10, 1, 15, 30, tzinfo=ist)) == "2026-10-01T10:00:00.000000Z"
    assert canon(datetime(2026, 10, 1, 10, 0)) == "2026-10-01T10:00:00.000000Z"   # naive = UTC


def test_canon_nested_dicts_sorted():
    assert list(canon({"b": 1, "a": {"d": 2, "c": 3}})) == ["a", "b"]
    assert list(canon({"b": 1, "a": {"d": 2, "c": 3}})["a"]) == ["c", "d"]


def test_make_record_sorts_fields_and_drops_pk():
    r = make_record("transactions", "txn_id", {"txn_id": 7, "status": "PENDING", "amount_paise": 100})
    assert r == {"table": "transactions", "pk": 7, "fields": [["amount_paise", 100], ["status", "PENDING"]]}


def test_make_record_folds_extra_fields_into_rest():
    row = {"id": 1, **{f"f{i:02d}": i for i in range(12)}}
    r = make_record("t", "id", row)
    assert len(r["fields"]) == NFIELDS
    assert r["fields"][-1][0] == "~rest"
    assert unfold(r) == {k: v for k, v in row.items() if k != "id"}


def test_blob_id_is_stable_and_content_sensitive():
    a = make_record("customers", "customer_id", {"customer_id": 1, "city": "Pune", "phone": "1"})
    b = make_record("customers", "customer_id", {"phone": "1", "city": "Pune", "customer_id": 1})
    assert blob_id(a) == blob_id(b)                       # column order does not matter
    assert len(blob_id(a)) == 64
    c = make_record("customers", "customer_id", {"customer_id": 1, "city": "Pune", "phone": "2"})
    assert blob_id(a) != blob_id(c)
    assert blob_id({**a, "salt": "123"}) == blob_id(a)    # salt is not part of the content address


def test_record_key():
    assert record_key("transactions", 100600) == "transactions:100600"
