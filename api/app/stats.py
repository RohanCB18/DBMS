"""Overview numbers across the three databases (for the dashboard's overview page)."""
from .canonical import SQL_TABLES
from .db import live_db, neo, pg, store


def overview() -> dict:
    with pg() as conn:
        live_sql = {t: conn.execute(f"SELECT count(*) AS n FROM bank.{t}").fetchone()["n"] for t in SQL_TABLES}
        vcs_counts = conn.execute("""SELECT (SELECT count(*) FROM vcs.commits)           AS commits,
                                            (SELECT count(*) FROM vcs.branches)          AS branches,
                                            (SELECT count(*) FROM vcs.anchors)           AS anchors,
                                            (SELECT count(*) FROM vcs.verification_runs) AS verify_runs,
                                            (SELECT count(*) FROM vcs.verification_runs WHERE NOT ok) AS verify_failures,
                                            (SELECT count(*) FROM vcs.change_log)        AS uncommitted_changes,
                                            (SELECT pg_database_size(current_database())) AS size_bytes
                                  """).fetchone()

    agg = list(store.trees.aggregate([{"$project": {"n": {"$size": "$entries"}}},
                                      {"$group": {"_id": None, "versions": {"$sum": "$n"}}}]))
    referenced = agg[0]["versions"] if agg else 0
    blobs = store.blobs.estimated_document_count()
    mongo = {"kyc_documents": live_db.kyc_documents.estimated_document_count(), "blobs": blobs,
             "trees": store.trees.estimated_document_count(), "proofs": store.proofs.estimated_document_count(),
             "record_versions_referenced": referenced,
             "dedup_ratio": round(referenced / blobs, 2) if blobs else None}

    try:
        with neo.session() as s:
            labels = {r["label"]: r["n"] for r in s.run(
                "MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS n")}
            rels = s.run("MATCH ()-[r]->() RETURN count(r) AS n").single()["n"]
        neo4j = {"nodes": labels, "relationships": rels, "online": True}
    except Exception as e:  # noqa: BLE001 — the graph is a secondary index
        neo4j = {"online": False, "error": str(e).splitlines()[0]}

    return {"postgres": {"live": live_sql, **vcs_counts},
            "mongo": mongo, "neo4j": neo4j,
            "records_live": sum(live_sql.values()) + mongo["kyc_documents"]}
