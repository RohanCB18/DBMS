"""Neo4j: the history *graph*.

    (:Branch)-[:HEAD]->(:Commit)-[:PARENT]->(:Commit)
    (:Record {key})-[:HAS_VERSION]->(:Version {id: blob})-[:INTRODUCED_IN]->(:Commit)
    (:Version)-[:PREVIOUS]->(:Version)
    (:Record)-[:DELETED_IN]->(:Commit)
    (:Proof)-[:ABOUT]->(:Version), (:Proof)-[:AGAINST]->(:Commit)

Graph sync is best-effort: Postgres + Mongo are the source of truth, so a Neo4j
outage never blocks a commit (the result reports graph_synced=false).
"""
import logging

from .db import neo

log = logging.getLogger("ztdb.graph")

SCHEMA = [
    "CREATE CONSTRAINT commit_id IF NOT EXISTS FOR (c:Commit) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT record_key IF NOT EXISTS FOR (r:Record) REQUIRE r.key IS UNIQUE",
    "CREATE CONSTRAINT version_id IF NOT EXISTS FOR (v:Version) REQUIRE v.id IS UNIQUE",
    "CREATE CONSTRAINT branch_name IF NOT EXISTS FOR (b:Branch) REQUIRE b.name IS UNIQUE",
    "CREATE CONSTRAINT proof_id IF NOT EXISTS FOR (p:Proof) REQUIRE p.id IS UNIQUE",
]


def ensure_schema():
    with neo.session() as s:
        for q in SCHEMA:
            s.run(q)


def sync_commit(commit_id, root, message, author, created, branch, parents, record_count, changes) -> bool:
    versions = [{"key": c["key"], "table": c["key"].split(":", 1)[0], "pk": c["key"].split(":", 1)[1],
                 "blob": c["blob"], "prev": c["prev"], "kind": kind}
                for kind in ("added", "modified") for c in changes[kind]]
    deleted = [c["key"] for c in changes["deleted"]]
    try:
        with neo.session() as s:
            s.run("""MERGE (c:Commit {id: $id})
                     SET c.root = $root, c.message = $message, c.author = $author,
                         c.created_at = datetime($created), c.branch = $branch, c.record_count = $n,
                         c.added = $added, c.modified = $modified, c.deleted = $deleted
                     WITH c UNWIND $parents AS pid
                     MATCH (p:Commit {id: pid}) MERGE (c)-[:PARENT]->(p)""",
                  id=commit_id, root=root, message=message, author=author, created=created.isoformat(),
                  branch=branch, n=record_count, parents=parents,
                  added=len(changes["added"]), modified=len(changes["modified"]), deleted=len(deleted))
            set_branch(branch, commit_id, s)
            s.run("""UNWIND $versions AS v
                     MERGE (r:Record {key: v.key}) SET r.table = v.table, r.pk = v.pk
                     MERGE (ver:Version {id: v.blob}) SET ver.key = v.key
                     MERGE (r)-[:HAS_VERSION]->(ver)
                     WITH ver, v MATCH (c:Commit {id: $id})
                     MERGE (ver)-[:INTRODUCED_IN {kind: v.kind}]->(c)
                     WITH ver, v WHERE v.prev IS NOT NULL
                     MATCH (pv:Version {id: v.prev}) MERGE (ver)-[:PREVIOUS]->(pv)""",
                  versions=versions, id=commit_id)
            s.run("""UNWIND $keys AS k MATCH (r:Record {key: k}), (c:Commit {id: $id})
                     MERGE (r)-[:DELETED_IN]->(c)""", keys=deleted, id=commit_id)
        return True
    except Exception as e:  # noqa: BLE001 — graph is a secondary index
        log.warning("neo4j sync failed for %s: %s", commit_id, e)
        return False


def set_branch(name, commit_id, session=None):
    q = """MERGE (b:Branch {name: $name})
           WITH b OPTIONAL MATCH (b)-[h:HEAD]->() DELETE h
           WITH b MATCH (c:Commit {id: $id}) MERGE (b)-[:HEAD]->(c)"""
    if session:
        session.run(q, name=name, id=commit_id)
    else:
        with neo.session() as s:
            s.run(q, name=name, id=commit_id)


def add_proof(proof_id, commit_id, blob, claim_text):
    try:
        with neo.session() as s:
            s.run("""MERGE (p:Proof {id: $pid}) SET p.claim = $claim, p.created_at = datetime()
                     WITH p MATCH (c:Commit {id: $cid}) MERGE (p)-[:AGAINST]->(c)
                     WITH p MATCH (v:Version {id: $blob}) MERGE (p)-[:ABOUT]->(v)""",
                  pid=proof_id, claim=claim_text, cid=commit_id, blob=blob)
    except Exception as e:  # noqa: BLE001
        log.warning("neo4j proof sync failed: %s", e)


def commit_graph() -> dict:
    """Nodes + edges of the commit DAG, ready for a graph widget."""
    with neo.session() as s:
        nodes = [dict(r) for r in s.run(
            """MATCH (c:Commit)
               RETURN c.id AS id, c.message AS message, c.author AS author, c.branch AS branch,
                      toString(c.created_at) AS created_at, c.added AS added, c.modified AS modified,
                      c.deleted AS deleted, COUNT { (:Proof)-[:AGAINST]->(c) } AS proofs
               ORDER BY c.created_at""")]
        edges = [dict(r) for r in s.run("MATCH (c:Commit)-[:PARENT]->(p:Commit) RETURN c.id AS from, p.id AS to")]
        heads = [dict(r) for r in s.run("MATCH (b:Branch)-[:HEAD]->(c:Commit) RETURN b.name AS branch, c.id AS commit")]
    return {"nodes": nodes, "edges": edges, "branches": heads}


def record_history(key: str) -> dict:
    """Every version of one record and the commits that introduced it — a pure graph traversal."""
    with neo.session() as s:
        versions = [dict(r) for r in s.run(
            """MATCH (r:Record {key: $key})-[:HAS_VERSION]->(v:Version)-[i:INTRODUCED_IN]->(c:Commit)
               OPTIONAL MATCH (p:Proof)-[:ABOUT]->(v)
               RETURN v.id AS blob, i.kind AS kind, c.id AS commit_id, c.message AS message,
                      toString(c.created_at) AS created_at, collect(DISTINCT p.id) AS proofs
               ORDER BY created_at""", key=key)]
        deleted = [dict(r) for r in s.run(
            """MATCH (:Record {key: $key})-[:DELETED_IN]->(c:Commit)
               RETURN c.id AS commit_id, toString(c.created_at) AS created_at""", key=key)]
    return {"key": key, "versions": versions, "deleted_in": deleted}


def touched_by(commit_id: str) -> list[dict]:
    with neo.session() as s:
        return [dict(r) for r in s.run(
            """MATCH (r:Record)-[:HAS_VERSION]->(:Version)-[i:INTRODUCED_IN]->(:Commit {id: $id})
               RETURN r.key AS key, i.kind AS kind ORDER BY key""", id=commit_id)]


def wipe():
    with neo.session() as s:
        s.run("MATCH (n) DETACH DELETE n")
