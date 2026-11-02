"""Live SQL console: change the *working* bank data with plain SQL, then commit it.

The time-travel console (sqlconsole.py) only reads past commits. This one reads and writes the
live `bank` tables, so a user can edit data by hand instead of relying on the scripted
business day:

    UPDATE customers SET phone = '9876543210' WHERE customer_id = 7;
    SELECT sp_settle_txn(sp_transfer(5001000001, 5001000002, 500000, 'UPI', 'rent'));

Safety, in layers:
  1. statement check: one SELECT / WITH / INSERT / UPDATE / DELETE statement; UPDATE and DELETE
     need a WHERE clause unless the caller explicitly allows a whole-table change
  2. runs as `ztdb_writer` (04_live_sql.sql): DML on the bank tables only, no TRUNCATE / DDL,
     no access to the version-control schema, 5 s statement timeout
  3. every constraint and trigger still applies (CHECKs, foreign keys, the transaction
     state machine), and the audit trigger records each change in vcs.change_log
  4. at most MAX_AFFECTED rows per statement; `preview` executes and then rolls back
  5. holds the version-control lock, so a commit never snapshots a half-applied change

Changes made here show up as uncommitted changes (status / diff vs WORKING) until committed.
"""
import re
import time
from pathlib import Path

import psycopg
from psycopg import sql

from . import config
from .db import pg
from .sqlconsole import _COMMENTS, _STRINGS
from .vcs import VcsError, status, vcs_lock

MAX_ROWS = 500          # rows returned to the client
MAX_AFFECTED = 1000     # rows a single statement may change
ALLOWED = ("select", "with", "insert", "update", "delete")
WRITES = ("insert", "update", "delete")
_FORBIDDEN = re.compile(r"\b(truncate|drop|alter|create|grant|revoke|copy|vacuum|lock|set|reset|"
                        r"begin|commit|rollback|savepoint|prepare|execute|listen|notify|do|call)\b")
SCHEMA_FILE = Path(__file__).resolve().parents[2] / "db" / "postgres" / "04_live_sql.sql"


def _bare(query: str) -> str:
    """The statement with comments removed and string literals blanked."""
    return _STRINGS.sub("''", _COMMENTS.sub(" ", query)).strip()


def check_statement(query: str, allow_full_table: bool = False) -> tuple[str, str]:
    """Returns (cleaned statement, kind) or raises VcsError. kind = first keyword."""
    q = query.strip()
    while q.endswith(";"):
        q = q[:-1].rstrip()
    if not q:
        raise VcsError("empty statement")
    bare = _bare(q).lower()
    if ";" in bare:
        raise VcsError("run one statement at a time")
    kind = bare.split(None, 1)[0] if bare else ""
    if kind not in ALLOWED:
        raise VcsError("the live console accepts SELECT, INSERT, UPDATE or DELETE "
                       "(and SELECT sp_transfer(...) / sp_settle_txn(...) / sp_reverse_txn(...))")
    hits = {m.group(1) for m in _FORBIDDEN.finditer(bare)}
    if kind == "update":
        hits.discard("set")                         # UPDATE ... SET
    if kind == "insert":
        hits -= {"do", "set"}                       # INSERT ... ON CONFLICT DO UPDATE SET
    if hits:
        raise VcsError(f"'{sorted(hits)[0].upper()}' is not allowed in the live console — "
                       "only data changes (no DDL, transactions or session settings)")
    if kind in ("update", "delete") and not re.search(r"\bwhere\b", bare) and not allow_full_table:
        raise VcsError(f"{kind.upper()} without WHERE would change every row — add a WHERE clause "
                       "(or confirm a whole-table change)", 422, needs_confirmation=True)
    return q, kind


def ensure_role() -> None:
    """Apply 04_live_sql.sql (idempotent) so existing databases get the writer role."""
    if SCHEMA_FILE.is_file():
        with pg() as conn:
            conn.execute(SCHEMA_FILE.read_text(encoding="utf-8"))


def run(query: str, preview: bool = False, allow_full_table: bool = False) -> dict:
    q, kind = check_statement(query, allow_full_table)
    t0 = time.perf_counter()
    with vcs_lock():
        try:
            with psycopg.connect(config.PG_WRITER_DSN) as conn:
                conn.execute("SET LOCAL statement_timeout = '5s'")
                conn.execute(sql.SQL("SET LOCAL search_path = bank, pg_catalog"))
                cur = conn.execute(q)
                affected = cur.rowcount if kind in WRITES else None
                columns = [d.name for d in cur.description] if cur.description else []
                rows = cur.fetchmany(MAX_ROWS + 1) if cur.description else []
                if affected is not None and affected > MAX_AFFECTED:
                    conn.rollback()
                    raise VcsError(f"this statement would change {affected} rows (limit {MAX_AFFECTED}) — "
                                   "nothing was changed", 422)
                if preview:
                    conn.rollback()
                else:
                    conn.commit()
        except VcsError:
            raise
        except psycopg.errors.QueryCanceled:
            raise VcsError("statement cancelled — it ran longer than 5 seconds; nothing was changed")
        except psycopg.errors.InsufficientPrivilege as e:
            raise VcsError(f"permission denied: {e.diag.message_primary} — the live console can only "
                           "change the bank tables", 403)
        except psycopg.OperationalError as e:
            raise VcsError(f"cannot connect as ztdb_writer: {str(e).splitlines()[0]}", 503)
        except psycopg.errors.RaiseException as e:      # business rule from a trigger / procedure
            raise VcsError(f"rejected by a database rule: {e.diag.message_primary}; nothing was changed")
        except psycopg.errors.IntegrityError as e:      # CHECK, FK, UNIQUE, NOT NULL
            raise VcsError(f"rejected by a constraint: {e.diag.message_primary}"
                           + (f" ({e.diag.message_detail})" if e.diag.message_detail else "")
                           + "; nothing was changed", 409)
        except psycopg.Error as e:
            raise VcsError(f"SQL error: {e.diag.message_primary or str(e).splitlines()[0]}")
        st = status()
    return {
        "kind": kind, "preview": preview, "applied": not preview and kind in WRITES,
        "affected": affected, "columns": columns, "rows": [list(r) for r in rows[:MAX_ROWS]],
        "truncated": len(rows) > MAX_ROWS, "row_count": min(len(rows), MAX_ROWS),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000),
        "status": {"branch": st["branch"], "head": st["head"], "clean": st["clean"],
                   "added": st["added"], "modified": st["modified"], "deleted": st["deleted"]},
    }
