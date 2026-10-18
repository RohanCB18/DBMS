"""Time-travel SQL console: run a read-only SELECT against the database *as of* any commit.

How it works
------------
1. The commit's snapshot (from the MongoDB blob store) is materialised once into its own
   PostgreSQL schema `snap_<commit_id>`: the four bank tables (same columns as `bank.*`) plus
   `kyc_documents (id TEXT, doc JSONB)` so MongoDB data can be queried with SQL/JSONB too.
   Materialised schemas are cached and evicted least-recently-used (at most SNAPSHOT_CACHE).
2. The query runs on a separate connection as the least-privilege role `ztdb_reader`
   (03_roles.sql): READ ONLY transaction, 3 s statement timeout, search_path = the snapshot
   schema, at most MAX_ROWS rows returned, and the transaction is always rolled back.
3. Before that, the text must be a single SELECT / WITH statement.
"""
import json
import re
import time

import psycopg
from psycopg import sql

from . import config
from .canonical import SQL_TABLES
from .db import pg
from .vcs import VcsError, resolve, snapshot_by_table

SNAPSHOT_CACHE = 5
MAX_ROWS = 500
READER = "ztdb_reader"

_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)
_STRINGS = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"")


def check_query(query: str) -> str:
    """Basic statement guard (the read-only role and transaction are the real enforcement)."""
    q = query.strip()
    while q.endswith(";"):
        q = q[:-1].rstrip()
    if not q:
        raise VcsError("empty query")
    bare = _STRINGS.sub("''", _COMMENTS.sub(" ", q))
    if ";" in bare:
        raise VcsError("only a single statement is allowed")
    first = bare.strip().split(None, 1)[0].lower() if bare.strip() else ""
    if first not in ("select", "with"):
        raise VcsError("only SELECT (or WITH … SELECT) queries are allowed in the time-travel console")
    return q


def schema_name(commit_id: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{16}", commit_id):
        raise VcsError("bad commit id")
    return f"snap_{commit_id}"


def materialise(commit_id: str) -> str:
    """Create (or reuse) the snap_<commit> schema for a commit; returns its name."""
    name = schema_name(commit_id)
    with pg() as conn:
        exists = conn.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", (name,)).fetchone()
        registered = conn.execute("SELECT 1 FROM vcs.snapshot_schemas WHERE commit_id = %s",
                                  (commit_id,)).fetchone()
        if exists and registered:
            conn.execute("UPDATE vcs.snapshot_schemas SET last_used = now() WHERE commit_id = %s", (commit_id,))
            return name

    by_table = snapshot_by_table(commit_id)
    ident = sql.Identifier(name)
    with pg() as conn:
        with conn.transaction():
            conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(ident))
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(ident))
            for table, pk in SQL_TABLES.items():
                conn.execute(sql.SQL("CREATE TABLE {}.{} (LIKE bank.{} INCLUDING DEFAULTS)").format(
                    ident, sql.Identifier(table), sql.Identifier(table)))
                rows = by_table.get(table, [])
                if rows:
                    cols = [pk] + [c for c in rows[0] if c != "__pk"]
                    stmt = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
                        ident, sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, cols)),
                        sql.SQL(", ").join(sql.Placeholder() * len(cols)))
                    with conn.cursor() as cur:
                        cur.executemany(stmt, [[r["__pk"]] + [r.get(c) for c in cols[1:]] for r in rows])
            conn.execute(sql.SQL("CREATE TABLE {}.kyc_documents (id TEXT PRIMARY KEY, doc JSONB NOT NULL)").format(ident))
            docs = by_table.get("kyc_documents", [])
            if docs:
                with conn.cursor() as cur:
                    cur.executemany(sql.SQL("INSERT INTO {}.kyc_documents VALUES (%s, %s)").format(ident),
                                    [(str(d["__pk"]), json.dumps({k: v for k, v in d.items() if k != "__pk"}))
                                     for d in docs])
            conn.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(ident, sql.Identifier(READER)))
            conn.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(ident, sql.Identifier(READER)))
            conn.execute("""INSERT INTO vcs.snapshot_schemas (commit_id, schema_name) VALUES (%s, %s)
                            ON CONFLICT (commit_id) DO UPDATE SET last_used = now()""", (commit_id, name))
        _evict(conn)
    return name


def _evict(conn) -> None:
    old = conn.execute("""SELECT commit_id, schema_name FROM vcs.snapshot_schemas
                          ORDER BY last_used DESC OFFSET %s""", (SNAPSHOT_CACHE,)).fetchall()
    for r in old:
        conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(r["schema_name"])))
        conn.execute("DELETE FROM vcs.snapshot_schemas WHERE commit_id = %s", (r["commit_id"],))


def drop_all(conn) -> None:
    """Remove every materialised snapshot schema (used by the demo reset)."""
    for r in conn.execute("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'snap\\_%'").fetchall():
        conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(r["nspname"])))


def run(ref: str, query: str) -> dict:
    q = check_query(query)
    with pg() as conn:
        cid = resolve(conn, ref)
    t0 = time.perf_counter()
    schema = materialise(cid)
    materialise_ms = round((time.perf_counter() - t0) * 1000)

    t1 = time.perf_counter()
    try:
        with psycopg.connect(config.PG_READER_DSN) as conn:
            conn.read_only = True
            conn.execute("SET LOCAL statement_timeout = '3s'")
            conn.execute(sql.SQL("SET LOCAL search_path = {}").format(sql.Identifier(schema)))
            cur = conn.execute(q)
            if cur.description is None:
                raise VcsError("the statement returned no result set")
            columns = [d.name for d in cur.description]
            rows = cur.fetchmany(MAX_ROWS + 1)
            conn.rollback()
    except psycopg.errors.QueryCanceled:
        raise VcsError("query cancelled — it ran longer than 3 seconds")
    except psycopg.errors.InsufficientPrivilege as e:
        raise VcsError(f"permission denied: {e.diag.message_primary} (the console can only read snapshot tables)", 403)
    except psycopg.OperationalError as e:
        raise VcsError(f"cannot connect as {READER}: {str(e).splitlines()[0]}", 503)
    except psycopg.Error as e:
        raise VcsError(f"SQL error: {e.diag.message_primary or str(e).splitlines()[0]}")
    return {"commit_id": cid, "schema": schema, "columns": columns,
            "rows": [list(r) for r in rows[:MAX_ROWS]], "truncated": len(rows) > MAX_ROWS,
            "row_count": min(len(rows), MAX_ROWS), "materialise_ms": materialise_ms,
            "query_ms": round((time.perf_counter() - t1) * 1000),
            "tables": list(SQL_TABLES) + ["kyc_documents (id, doc JSONB)"]}
