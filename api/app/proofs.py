"""Zero-knowledge claims about historical records, and plain Merkle inclusion proofs.

A *proof package* is a self-contained JSON file an auditor can verify with only
the public verification key — no database access:

    {proof_id, commit_id, root, anchor, claim: {table, pk, field, op, value}, proof, publicSignals}

publicSignals = [root, tableTag, pk, fieldName, op, claimValue]  (see circuits/record_claim.circom)
"""
import secrets
from datetime import datetime, timezone

from . import graph, zk
from .canonical import record_key, unfold
from .db import pg, store
from .vcs import VcsError, manifest, resolve

OPS = {"eq": 0, "gte": 1, "lte": 2}
OP_TEXT = {"eq": "=", "gte": "≥", "lte": "≤"}


def _locate(ref: str, table: str, pk: str):
    with pg() as conn:
        cid = resolve(conn, ref)
        anchor = conn.execute("SELECT seq, entry_hash, anchored_at FROM vcs.anchors WHERE commit_id = %s",
                              (cid,)).fetchone()
    tree = manifest(cid)
    key = record_key(table, pk)
    for i, e in enumerate(tree["entries"]):
        if e["key"] == key:
            blob = store.blobs.find_one({"_id": e["blob"]})
            return cid, tree, i, e, blob, anchor
    raise VcsError(f"{key} does not exist in commit {cid}", 404)


def _coerce(actual, op: str, value):
    """Give the claimed value the same type as the stored one (the prover knows the data)."""
    if isinstance(actual, bool):
        return str(value).lower() in ("true", "1", "yes")
    if isinstance(actual, int):
        try:
            return int(value)
        except (TypeError, ValueError):
            raise VcsError("this field is numeric — the claimed value must be an integer")
    if op != "eq":
        raise VcsError("range claims (≥, ≤) need a numeric field")
    return None if value is None else str(value)


def create(ref: str, table: str, pk: str, field: str, op: str, value) -> dict:
    if op not in OPS:
        raise VcsError(f"op must be one of {list(OPS)}")
    cid, tree, idx, entry, blob, anchor = _locate(ref, table, pk)
    record = {k: blob[k] for k in ("table", "pk", "fields", "salt")}
    data = unfold(blob)
    if field not in data or field == "~rest":
        raise VcsError(f"field '{field}' is not provable on {table}")
    if any(f[0] == "~rest" and field in f[1] for f in blob["fields"]):
        raise VcsError(f"field '{field}' is folded into ~rest and cannot be proven individually")
    value = _coerce(data[field], op, value)
    try:
        res = zk.prove(record, [e["leaf"] for e in tree["entries"]], idx, field, op, value)
    except zk.ZkError as e:
        raise VcsError(str(e), e.status)

    proof_id = secrets.token_hex(8)
    claim = {"table": table, "pk": blob["pk"], "field": field, "op": op, "value": value}
    package = {
        "_id": proof_id, "proof_id": proof_id, "commit_id": cid, "root": tree["root"],
        "anchor": {"seq": anchor["seq"], "entry_hash": anchor["entry_hash"],
                   "anchored_at": anchor["anchored_at"].isoformat()},
        "claim": claim, "claim_text": f"{table} #{blob['pk']}: {field} {OP_TEXT[op]} {value}",
        "proof": res["proof"], "publicSignals": res["publicSignals"],
        "proving_ms": res["provingMs"], "created_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "groth16 / bn128 / Poseidon Merkle depth 13",
    }
    store.proofs.insert_one(dict(package))
    graph.add_proof(proof_id, cid, entry["blob"], package["claim_text"])
    return package


def get(proof_id: str) -> dict:
    p = store.proofs.find_one({"_id": proof_id}, {"_id": 0})
    if not p:
        raise VcsError("unknown proof", 404)
    return p


def list_all(limit: int = 50) -> list[dict]:
    return list(store.proofs.find({}, {"_id": 0, "proof": 0, "publicSignals": 0})
                .sort("created_at", -1).limit(limit))


def verify_package(pkg: dict) -> dict:
    """What an auditor checks. Only (3) touches our ledger; (1) and (2) are pure maths."""
    checks = []
    sig = pkg["publicSignals"]
    ok_proof = zk.verify(pkg["proof"], sig)
    checks.append({"check": "Groth16 proof is valid for the public inputs", "ok": ok_proof})

    c = pkg["claim"]
    enc = zk.encode([c["table"], c["pk"], c["field"], c["value"]])
    bound = (sig[1] == enc[0] and sig[2] == enc[1] and sig[3] == enc[2]
             and sig[4] == str(OPS[c["op"]]) and sig[5] == enc[3] and sig[0] == pkg["root"])
    checks.append({"check": "Proof is about exactly the stated claim and root", "ok": bound})

    with pg() as conn:
        a = conn.execute("SELECT merkle_root::text AS root FROM vcs.anchors WHERE commit_id = %s",
                         (pkg["commit_id"],)).fetchone()
        broken = conn.execute("SELECT count(*) AS n FROM vcs.fn_verify_anchor_chain()").fetchone()["n"]
    anchored = a is not None and a["root"] == pkg["root"] and broken == 0
    checks.append({"check": "Root is the one anchored for that commit in the transparency log", "ok": anchored})
    return {"valid": all(x["ok"] for x in checks), "checks": checks, "claim_text": pkg.get("claim_text")}


def inclusion(ref: str, table: str, pk: str) -> dict:
    """Non-ZK Merkle proof: reveals the whole record, salt and path (for comparison with ZK)."""
    cid, tree, idx, entry, blob, _ = _locate(ref, table, pk)
    path = zk.merkle_path([e["leaf"] for e in tree["entries"]], idx)
    return {"commit_id": cid, "root": tree["root"], "leaf_index": idx, "leaf": entry["leaf"],
            "record": {k: blob[k] for k in ("table", "pk", "fields")}, "salt": blob["salt"],
            "pathElements": path["pathElements"], "pathIndices": path["pathIndices"]}
