"""Turning live rows/documents into canonical, hashable records.

A *record* is the unit that gets versioned and becomes one Merkle leaf:

    {"table": "transactions", "pk": 100600,
     "fields": [["amount_paise", 25000000], ["channel", "NEFT"], ...]}   # sorted by name

* fields are sorted by name, so the same data always hashes the same way
* timestamps become UTC ISO-8601 strings, dates become YYYY-MM-DD
* at most NFIELDS (8) fields fit in a leaf; extra fields are folded into "~rest"
* blob id = sha256(canonical JSON) — Git-style content addressing
"""
import hashlib
import json
from datetime import date, datetime, timezone
from decimal import Decimal

NFIELDS = 8
MAX_SAFE_INT = 2**53  # larger ints would lose precision as JSON numbers in JavaScript

# table -> primary-key column, in foreign-key-safe insert order
SQL_TABLES: dict[str, str] = {
    "bank_branches": "branch_code",
    "customers": "customer_id",
    "accounts": "account_id",
    "transactions": "txn_id",
}
MONGO_COLLECTIONS: dict[str, str] = {"kyc_documents": "_id"}
ALL_TABLES = list(SQL_TABLES) + list(MONGO_COLLECTIONS)


def canon(v):
    if isinstance(v, bool) or v is None or isinstance(v, str) or isinstance(v, float):
        return v
    if isinstance(v, int):
        return v if abs(v) < MAX_SAFE_INT else str(v)
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else str(v)
    if isinstance(v, dict):
        return {str(k): canon(x) for k, x in sorted(v.items())}
    if isinstance(v, (list, tuple)):
        return [canon(x) for x in v]
    return str(v)


def make_record(table: str, pk_col: str, row: dict) -> dict:
    fields = sorted((k, canon(v)) for k, v in row.items() if k != pk_col)
    if len(fields) > NFIELDS:
        rest = dict(fields[NFIELDS - 1:])
        fields = fields[: NFIELDS - 1] + [("~rest", rest)]
    return {"table": table, "pk": canon(row[pk_col]), "fields": [list(f) for f in fields]}


def unfold(record: dict) -> dict:
    """Record fields back to a flat {column: value} dict (undoing the ~rest fold)."""
    out = {}
    for name, value in record["fields"]:
        if name == "~rest":
            out.update(value)
        else:
            out[name] = value
    return out


def record_key(table: str, pk) -> str:
    return f"{table}:{pk}"


def blob_id(record: dict) -> str:
    body = {"table": record["table"], "pk": record["pk"], "fields": record["fields"]}
    data = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()
