"""Business analytics on a commit snapshot, using Neo4j as a graph engine (fraud-ring detection)."""
from . import graph
from .db import pg
from .vcs import VcsError, head, resolve, snapshot_by_table

RING_QUERY = ("MATCH p = (a:Account) (()-[r:SENT WHERE r.amount >= $min AND r.status = 'COMPLETED']->()){3,5} (a) "
              "... WHERE duration.inSeconds(first, last).hours <= $hours")


def _resolve(ref: str) -> str:
    with pg() as conn:
        if ref.upper() == "HEAD":
            cid = head(conn)["commit"]
            if not cid:
                raise VcsError("no commits yet")
            return cid
        return resolve(conn, ref)


def _build(cid: str) -> None:
    by_table = snapshot_by_table(cid)
    owners = {c["__pk"]: c["full_name"] for c in by_table.get("customers", [])}
    accounts = [{"id": a["__pk"], "owner": owners.get(a["customer_id"], "?"), "status": a["status"],
                 "branch": a["branch_code"]} for a in by_table.get("accounts", [])]
    txns = [{"id": t["__pk"], "from": t["from_account"], "to": t["to_account"], "amount": t["amount_paise"],
             "status": t["status"], "at": t["created_at"], "channel": t["channel"]}
            for t in by_table.get("transactions", [])]
    graph.sync_money_flow(cid, accounts, txns)


def fraud_rings(ref: str = "HEAD", min_amount_inr: int = 100_000, max_hours: int = 24) -> dict:
    cid = _resolve(ref)
    try:
        _build(cid)
        rings = graph.fraud_rings(min_amount_inr * 100, max_hours)
        for ring in rings:
            ring["transfers"].sort(key=lambda t: t["at"])        # chronological order of the hops
        summary = graph.money_flow_summary()
    except Exception as e:  # noqa: BLE001 — Neo4j down or still booting
        raise VcsError(f"graph analytics unavailable (Neo4j): {str(e).splitlines()[0]}", 503)
    return {"commit_id": cid, "min_amount_inr": min_amount_inr, "max_hours": max_hours,
            "rings": rings, "graph": summary, "cypher": RING_QUERY}
