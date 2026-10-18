"""The version-control engine: commit, status, log, diff, restore, branches, verify.

Storage layout of one commit
----------------------------
PostgreSQL  vcs.commits        commit_id, merkle_root, message, author, ...   (trust anchor)
            vcs.commit_parents DAG edges
            vcs.anchors        hash-chained transparency log of roots
MongoDB     ztdb.trees         {_id: commit_id, root, entries: [{key, blob, leaf}, ...]}  (manifest)
            ztdb.blobs         {_id: sha256, key, table, pk, fields, salt}  (deduplicated record versions)
Neo4j       (:Commit)-[:PARENT]->(:Commit), (:Record)-[:HAS_VERSION]->(:Version)-[:INTRODUCED_IN]->(:Commit)
"""
import hashlib
import json
import secrets
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg

from pymongo import UpdateOne

from . import graph, zk
from .canonical import (MONGO_COLLECTIONS, SQL_TABLES, blob_id, make_record,
                        record_key, unfold)
from .merge import merge_snapshots
from . import config
from .db import live_db, pg, store


class VcsError(Exception):
    def __init__(self, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


# ---------------------------------------------------------------- locking

LOCK_KEY = 72026101          # pg advisory-lock id for "a version-control write is running"
_lock_state = threading.local()


@contextmanager
def vcs_lock(wait_seconds: int = 15):
    """Serialise commit / restore / checkout / merge across threads and processes.

    Uses a session-level PostgreSQL advisory lock on its own connection, so it also
    protects against the CLI and the web UI acting at the same time. Re-entrant per thread
    (checkout -> restore, merge -> commit).
    """
    if getattr(_lock_state, "depth", 0):
        _lock_state.depth += 1
        try:
            yield
        finally:
            _lock_state.depth -= 1
        return
    conn = psycopg.connect(config.PG_DSN, autocommit=True)
    try:
        conn.execute(f"SET lock_timeout = '{int(wait_seconds)}s'")
        try:
            conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        except psycopg.errors.LockNotAvailable:
            raise VcsError("another version-control operation is in progress — try again", 409)
        _lock_state.depth = 1
        try:
            yield
        finally:
            _lock_state.depth = 0
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
    finally:
        conn.close()


# ---------------------------------------------------------------- live state

def collect_live(conn) -> list[dict]:
    """Every live record from Postgres + MongoDB, in a deterministic order."""
    records = []
    for table, pk in SQL_TABLES.items():
        for row in conn.execute(f"SELECT * FROM bank.{table} ORDER BY {pk}"):
            records.append(make_record(table, pk, row))
    for coll, pk in MONGO_COLLECTIONS.items():
        for doc in live_db[coll].find().sort(pk, 1):
            records.append(make_record(coll, pk, doc))
    return records


def head(conn) -> dict:
    row = conn.execute("""SELECT h.branch_name, b.head_commit FROM vcs.head h
                          JOIN vcs.branches b USING (branch_name)""").fetchone()
    return {"branch": row["branch_name"], "commit": (row["head_commit"] or "").strip() or None}


def manifest(commit_id: str) -> dict:
    tree = store.trees.find_one({"_id": commit_id})
    if not tree:
        raise VcsError(f"unknown commit {commit_id}", 404)
    return tree


def resolve(conn, ref: str) -> str:
    """Branch name, full commit id or unique prefix -> commit id."""
    row = conn.execute("SELECT head_commit FROM vcs.branches WHERE branch_name = %s", (ref,)).fetchone()
    if row and row["head_commit"]:
        return row["head_commit"].strip()
    rows = conn.execute("SELECT commit_id FROM vcs.commits WHERE commit_id LIKE %s", (ref + "%",)).fetchall()
    if len(rows) != 1:
        raise VcsError(f"cannot resolve '{ref}' to a single commit", 404)
    return rows[0]["commit_id"].strip()


def _key_map(records: list[dict]) -> dict[str, str]:
    return {record_key(r["table"], r["pk"]): blob_id(r) for r in records}


# ---------------------------------------------------------------- commit

def commit(message: str, author: str, extra_parent: str | None = None) -> dict:
    """Snapshot the live databases. `extra_parent` makes it a merge commit (two parents)."""
    with vcs_lock():
        return _commit(message, author, extra_parent)


def _commit(message: str, author: str, extra_parent: str | None = None) -> dict:
    with pg() as conn:
        h = head(conn)
        records = collect_live(conn)
        if len(records) > 2**13:
            raise VcsError("database exceeds the 8192-record capacity of the Merkle tree")
        parent_tree = manifest(h["commit"]) if h["commit"] else None
        ids = [blob_id(r) for r in records]
        if parent_tree and not extra_parent and [e["blob"] for e in parent_tree["entries"]] == ids:
            raise VcsError("nothing to commit — working database matches HEAD", 409)

        # Content-addressed blob store: an unchanged record keeps its blob (and salt).
        salts = {b["_id"]: b["salt"] for b in store.blobs.find({"_id": {"$in": ids}}, {"salt": 1})}
        new_blobs = []
        for r, bid in zip(records, ids):
            if bid not in salts:
                salts[bid] = str(secrets.randbits(248))
                new_blobs.append(UpdateOne({"_id": bid}, {"$setOnInsert": {
                    **r, "key": record_key(r["table"], r["pk"]), "salt": salts[bid]}}, upsert=True))
        if new_blobs:
            store.blobs.bulk_write(new_blobs, ordered=False)

        root, leaves = zk.merkle_commit([{**r, "salt": salts[b]} for r, b in zip(records, ids)])

        created = datetime.now(timezone.utc)
        parents = [h["commit"]] if h["commit"] else []
        if extra_parent:
            parents.append(extra_parent)
        commit_id = hashlib.sha256(
            f"{root}|{','.join(parents)}|{message}|{author}|{created.isoformat()}".encode()).hexdigest()[:16]
        entries = [{"key": record_key(r["table"], r["pk"]), "blob": b, "leaf": l}
                   for r, b, l in zip(records, ids, leaves)]
        store.trees.insert_one({"_id": commit_id, "root": root, "created_at": created, "entries": entries})

        # One atomic stored procedure: commit row, parent edges, anchor, branch head, clear change log.
        conn.execute("CALL vcs.sp_record_commit(%s, %s, %s::numeric, %s, %s, %s, %s::char(16)[])",
                     (commit_id, h["branch"], root, message, author, len(records), parents))
        conn.commit()
        anchor = conn.execute("SELECT seq, entry_hash FROM vcs.anchors WHERE commit_id = %s",
                              (commit_id,)).fetchone()

    changes = _changes(parent_tree, entries)
    graph_ok = graph.sync_commit(commit_id, root, message, author, created, h["branch"], parents,
                                 len(records), changes)
    return {"commit_id": commit_id, "branch": h["branch"], "root": root, "parents": parents,
            "record_count": len(records), "anchor": anchor, "graph_synced": graph_ok,
            "summary": {k: len(v) for k, v in changes.items()}}


def _changes(parent_tree, entries) -> dict:
    old = {e["key"]: e["blob"] for e in parent_tree["entries"]} if parent_tree else {}
    new = {e["key"]: e["blob"] for e in entries}
    return {
        "added": [{"key": k, "blob": b, "prev": None} for k, b in new.items() if k not in old],
        "modified": [{"key": k, "blob": b, "prev": old[k]} for k, b in new.items() if k in old and old[k] != b],
        "deleted": [{"key": k, "blob": None, "prev": b} for k, b in old.items() if k not in new],
    }


# ---------------------------------------------------------------- read side

def log(branch: str | None = None, limit: int = 100) -> list[dict]:
    with pg() as conn:
        if branch:
            start = resolve(conn, branch)
            rows = conn.execute("""SELECT l.*, a.depth FROM vcs.fn_ancestors(%s) a
                                   JOIN vcs.v_commit_log l USING (commit_id)
                                   ORDER BY l.created_at DESC LIMIT %s""", (start, limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM vcs.v_commit_log ORDER BY created_at DESC LIMIT %s",
                                (limit,)).fetchall()
    for r in rows:
        r["commit_id"] = r["commit_id"].strip()
        r["parents"] = [p.strip() for p in r["parents"]]
    return rows


def status() -> dict:
    with pg() as conn:
        h = head(conn)
        live = _key_map(collect_live(conn))
        recent = conn.execute("""SELECT change_id, table_name, pk, op, changed_at, db_user
                                 FROM vcs.change_log ORDER BY change_id DESC LIMIT 50""").fetchall()
    committed = {e["key"]: e["blob"] for e in manifest(h["commit"])["entries"]} if h["commit"] else {}
    added = [k for k in live if k not in committed]
    modified = [k for k in live if k in committed and committed[k] != live[k]]
    deleted = [k for k in committed if k not in live]
    return {"branch": h["branch"], "head": h["commit"], "clean": not (added or modified or deleted),
            "added": added, "modified": modified, "deleted": deleted, "change_log": recent}


def _blobs(ids) -> dict[str, dict]:
    return {b["_id"]: b for b in store.blobs.find({"_id": {"$in": list(ids)}})}


def diff(a: str, b: str) -> dict:
    """Record- and field-level diff. `b` may be 'WORKING' for the live database."""
    with pg() as conn:
        a_id = resolve(conn, a)
        a_map = {e["key"]: e["blob"] for e in manifest(a_id)["entries"]}
        if b.upper() == "WORKING":
            live = collect_live(conn)
            b_id, b_map = "WORKING", _key_map(live)
            live_blobs = {blob_id(r): r for r in live}
        else:
            b_id = resolve(conn, b)
            b_map = {e["key"]: e["blob"] for e in manifest(b_id)["entries"]}
            live_blobs = {}

    changed = [k for k in set(a_map) | set(b_map) if a_map.get(k) != b_map.get(k)]
    blobs = _blobs({a_map[k] for k in changed if k in a_map} | {b_map[k] for k in changed if k in b_map})
    blobs.update(live_blobs)

    out = {"from": a_id, "to": b_id, "added": [], "deleted": [], "modified": []}
    for k in sorted(changed):
        old = unfold(blobs[a_map[k]]) if k in a_map else None
        new = unfold(blobs[b_map[k]]) if k in b_map else None
        if old is None:
            out["added"].append({"key": k, "record": new})
        elif new is None:
            out["deleted"].append({"key": k, "record": old})
        else:
            fields = [{"field": f, "old": old.get(f), "new": new.get(f)}
                      for f in sorted(set(old) | set(new)) if old.get(f) != new.get(f)]
            out["modified"].append({"key": k, "changes": fields})
    out["summary"] = {k: len(out[k]) for k in ("added", "deleted", "modified")}
    return out


def snapshot_records(ref: str, table: str | None = None, offset: int = 0, limit: int = 50) -> dict:
    """Browse the contents of a historical commit (time travel, read-only)."""
    with pg() as conn:
        cid = resolve(conn, ref)
    entries = manifest(cid)["entries"]
    if table:
        entries = [e for e in entries if e["key"].startswith(table + ":")]
    page = entries[offset: offset + limit]
    blobs = _blobs(e["blob"] for e in page)
    return {"commit_id": cid, "total": len(entries),
            "records": [{"key": e["key"], **unfold(blobs[e["blob"]])} for e in page]}


# ---------------------------------------------------------------- restore / branches

def snapshot_by_table(cid: str) -> dict[str, list[dict]]:
    """A commit's records grouped by table, as flat rows with their primary key in `__pk`."""
    entries = manifest(cid)["entries"]
    blobs = _blobs(e["blob"] for e in entries)
    by_table: dict[str, list[dict]] = {}
    for e in entries:
        b = blobs[e["blob"]]
        by_table.setdefault(b["table"], []).append({**unfold(b), "__pk": b["pk"]})
    return by_table


def _write_live(by_table: dict[str, list[dict]]) -> None:
    """Replace the live Postgres tables and Mongo collections with the given rows.

    MongoDB is staged into `<coll>__incoming` first and swapped in with an atomic rename
    only after the PostgreSQL transaction has committed, so a failure on either side never
    leaves the two stores half-restored.
    """
    staged = {}
    for coll, pk in MONGO_COLLECTIONS.items():
        tmp = f"{coll}__incoming"
        live_db[tmp].drop()
        docs = [{pk: r["__pk"], **{k: v for k, v in r.items() if k != "__pk"}} for r in by_table.get(coll, [])]
        if docs:
            live_db[tmp].insert_many(docs)
        staged[coll] = (tmp, bool(docs))
    try:
        with pg() as conn:
            with conn.transaction():
                conn.execute("SET LOCAL ztdb.restoring = 'on'")       # silences audit + state-machine triggers
                for table in reversed(SQL_TABLES):
                    conn.execute(f"DELETE FROM bank.{table}")
                for table, pk in SQL_TABLES.items():
                    rows = by_table.get(table, [])
                    if not rows:
                        continue
                    cols = [pk] + [c for c in rows[0] if c != "__pk"]
                    sql = (f"INSERT INTO bank.{table} ({', '.join(cols)}) "
                           f"VALUES ({', '.join(['%s'] * len(cols))})")
                    with conn.cursor() as cur:
                        cur.executemany(sql, [[r["__pk"]] + [r.get(c) for c in cols[1:]] for r in rows])
                conn.execute("""SELECT setval('bank.txn_id_seq', GREATEST(
                                  (SELECT COALESCE(MAX(txn_id), 100000) FROM bank.transactions),
                                  (SELECT last_value FROM bank.txn_id_seq)))""")
                conn.execute("DELETE FROM vcs.change_log")
    except Exception:
        for tmp, _ in staged.values():
            live_db[tmp].drop()
        raise
    for coll, (tmp, has_docs) in staged.items():
        if has_docs:
            live_db[tmp].rename(coll, dropTarget=True)
        else:
            live_db[coll].delete_many({})


def _move_head(cid: str) -> str:
    with pg() as conn:
        branch = head(conn)["branch"]
        conn.execute("UPDATE vcs.branches SET head_commit = %s WHERE branch_name = %s", (cid, branch))
    graph.set_branch(branch, cid)
    return branch


def restore(ref: str, force: bool = False, move_head: bool = False) -> dict:
    """Overwrite the live databases with the state of a commit.

    move_head=False: `git checkout <commit> -- .` (the branch still points at its old head,
    so `status` shows the difference). move_head=True: `git reset --hard <commit>`.
    """
    with vcs_lock():
        st = status()
        if not st["clean"] and not force:
            raise VcsError("working database has uncommitted changes — commit them or pass force=true", 409)
        with pg() as conn:
            cid = resolve(conn, ref)
        by_table = snapshot_by_table(cid)
        _write_live(by_table)
        result = {"restored": cid, "records": sum(len(v) for v in by_table.values())}
        if move_head:
            result["branch_moved"] = _move_head(cid)
        return result


def branches() -> list[dict]:
    with pg() as conn:
        h = head(conn)
        rows = conn.execute("SELECT branch_name, head_commit, created_at FROM vcs.branches ORDER BY created_at").fetchall()
    return [{"name": r["branch_name"], "head": (r["head_commit"] or "").strip() or None,
             "current": r["branch_name"] == h["branch"], "created_at": r["created_at"]} for r in rows]


def create_branch(name: str, start: str | None = None) -> dict:
    with pg() as conn:
        cid = resolve(conn, start) if start else head(conn)["commit"]
        if not cid:
            raise VcsError("make a first commit before branching")
        if conn.execute("SELECT 1 FROM vcs.branches WHERE branch_name = %s", (name,)).fetchone():
            raise VcsError(f"branch '{name}' already exists", 409)
        conn.execute("INSERT INTO vcs.branches (branch_name, head_commit) VALUES (%s, %s)", (name, cid))
    graph.set_branch(name, cid)
    return {"name": name, "head": cid}


def checkout(branch: str, force: bool = False) -> dict:
    """Switch the working database to another branch (restores its head commit)."""
    with vcs_lock():
        with pg() as conn:
            row = conn.execute("SELECT head_commit FROM vcs.branches WHERE branch_name = %s", (branch,)).fetchone()
        if not row:
            raise VcsError(f"no branch '{branch}'", 404)
        result = restore(row["head_commit"].strip(), force=force)
        with pg() as conn:
            conn.execute("UPDATE vcs.head SET branch_name = %s", (branch,))
        return {"branch": branch, **result}


# ---------------------------------------------------------------- merge

def merge(source: str, resolutions: dict | None = None, message: str | None = None,
          author: str = "demo-user", dry_run: bool = False) -> dict:
    """Three-way merge of `source` (branch or commit) into the current branch.

    up-to-date  -> nothing to do
    fast-forward-> the current branch simply moves to `source` (no new commit)
    merged      -> record/field-level three-way merge, written to the live DBs and
                   committed with two parents; HTTP 409 with the conflict list if any
                   conflict has no entry in `resolutions` ("key" or "key|field" -> ours|theirs)
    dry_run=True reports what would happen (including conflicts) without writing anything.
    """
    with vcs_lock():
        if not status()["clean"]:
            raise VcsError("working database has uncommitted changes — commit them before merging", 409)
        with pg() as conn:
            h = head(conn)
            ours, theirs = h["commit"], resolve(conn, source)
            if not ours:
                raise VcsError("the current branch has no commits yet")
            base = conn.execute("SELECT vcs.fn_merge_base(%s, %s) AS b", (ours, theirs)).fetchone()["b"]
            base = base.strip() if base else None
        info = {"branch": h["branch"], "ours": ours, "theirs": theirs, "base": base}
        if theirs == ours or base == theirs:
            return {"result": "up-to-date", **info}
        if base == ours:
            if dry_run:
                return {"result": "fast-forward", "commit_id": theirs, "dry_run": True, **info}
            restore(theirs, force=True, move_head=True)
            return {"result": "fast-forward", "commit_id": theirs, **info}

        snapshots, pks = {}, {}
        trees = {name: manifest(cid)["entries"] if cid else []
                 for name, cid in (("base", base), ("ours", ours), ("theirs", theirs))}
        blobs = _blobs({e["blob"] for entries in trees.values() for e in entries})
        for name, entries in trees.items():
            snapshots[name] = {e["key"]: unfold(blobs[e["blob"]]) for e in entries}
            for e in entries:
                pks[e["key"]] = (blobs[e["blob"]]["table"], blobs[e["blob"]]["pk"])
        merged, conflicts, resolved = merge_snapshots(
            snapshots["base"], snapshots["ours"], snapshots["theirs"], resolutions)
        if dry_run:
            changed = sum(1 for k in set(merged) | set(snapshots["ours"])
                          if merged.get(k) != snapshots["ours"].get(k))
            return {"result": "conflicts" if conflicts else "clean", "dry_run": True, "conflicts": conflicts,
                    "conflicts_resolved": resolved, "records_changed_on_ours": changed, **info}
        if conflicts:
            raise VcsError(f"{len(conflicts)} merge conflict(s) — resolve each one as ours or theirs", 409,
                           conflicts=conflicts, **info)

        by_table: dict[str, list[dict]] = {}
        for key, row in merged.items():
            table, pk = pks[key]
            by_table.setdefault(table, []).append({**row, "__pk": pk})
        _write_live(by_table)
        result = commit(message or f"Merge {source} into {h['branch']}", author, extra_parent=theirs)
        return {"result": "merged", "commit_id": result["commit_id"], "commit": result,
                "conflicts_resolved": resolved, **info}


# ---------------------------------------------------------------- verify

def verify(ref: str) -> dict:
    """Four independent integrity layers. Any edit to history breaks at least one."""
    with pg() as conn:
        cid = resolve(conn, ref)
        pg_root = str(conn.execute("SELECT merkle_root FROM vcs.commits WHERE commit_id = %s",
                                   (cid,)).fetchone()["merkle_root"])
        chain_issues = conn.execute("SELECT * FROM vcs.fn_verify_anchor_chain()").fetchall()
        anchor = conn.execute("SELECT merkle_root, entry_hash FROM vcs.anchors WHERE commit_id = %s",
                              (cid,)).fetchone()
    tree = manifest(cid)
    entries = tree["entries"]
    blobs = _blobs(e["blob"] for e in entries)
    layers = []

    # 1. every blob still hashes to its content address
    content_bad = []
    for e in entries:
        b = blobs.get(e["blob"])
        if b is None:
            content_bad.append({"key": e["key"], "problem": "blob missing"})
        elif blob_id(b) != e["blob"]:
            content_bad.append({"key": e["key"], "problem": "record content changed after commit"})
    layers.append({"layer": "1. Record content hashes (SHA-256)", "ok": not content_bad, "issues": content_bad})

    # 2. every leaf recomputes from the stored record + salt
    present = [e for e in entries if e["blob"] in blobs]
    leaves = zk.leaves_for([{k: blobs[e["blob"]][k] for k in ("table", "pk", "fields", "salt")} for e in present])
    leaf_bad = [{"key": e["key"], "problem": "Merkle leaf does not match record"}
                for e, leaf in zip(present, leaves) if leaf != e["leaf"]]
    layers.append({"layer": "2. Merkle leaves (Poseidon)", "ok": not leaf_bad, "issues": leaf_bad})

    # 3. manifest leaves rebuild the root stored in PostgreSQL
    rebuilt = zk.merkle_root([e["leaf"] for e in entries])
    root_ok = rebuilt == pg_root == tree["root"]
    layers.append({"layer": "3. Merkle root vs commit record", "ok": root_ok,
                   "issues": [] if root_ok else [{"problem": "root mismatch", "rebuilt": rebuilt,
                                                  "commit_table": pg_root, "manifest": tree["root"]}]})

    # 4. the anchor log is an unbroken hash chain and agrees with this commit
    anchor_ok = not chain_issues and anchor is not None and str(anchor["merkle_root"]) == pg_root
    layers.append({"layer": "4. Anchor hash chain (transparency log)", "ok": anchor_ok,
                   "issues": [dict(i, commit_id=i["commit_id"].strip()) for i in chain_issues]
                   + ([] if anchor and str(anchor["merkle_root"]) == pg_root
                      else [{"problem": "anchored root differs from commit root"}])})

    ok = all(l["ok"] for l in layers)
    tampered = sorted({i["key"] for l in layers for i in l["issues"] if "key" in i})
    result = {"commit_id": cid, "ok": ok, "root": pg_root, "layers": layers, "tampered_records": tampered}
    with pg() as conn:
        conn.execute("INSERT INTO vcs.verification_runs (commit_id, ok, details) VALUES (%s, %s, %s)",
                     (cid, ok, json.dumps({"tampered_records": tampered,
                                           "failed_layers": [l["layer"] for l in layers if not l["ok"]]})))
    return result


def anchors() -> list[dict]:
    with pg() as conn:
        rows = conn.execute("""SELECT seq, commit_id, merkle_root::text AS merkle_root, prev_hash, entry_hash, anchored_at
                               FROM vcs.anchors ORDER BY seq""").fetchall()
    for r in rows:
        r["commit_id"] = r["commit_id"].strip()
    return rows


def verification_runs(limit: int = 20) -> list[dict]:
    with pg() as conn:
        rows = conn.execute("""SELECT run_id, commit_id, ok, details, ran_at FROM vcs.verification_runs
                               ORDER BY run_id DESC LIMIT %s""", (limit,)).fetchall()
    for r in rows:
        r["commit_id"] = r["commit_id"].strip()
    return rows
