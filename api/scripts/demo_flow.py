"""Runs the full classroom demo against the API and narrates it.

    python scripts/demo_flow.py [--api http://localhost:8100]

Also serves as the end-to-end test: exits non-zero if any expectation fails.
"""
import argparse
import sys
import time

import httpx

ap = argparse.ArgumentParser()
ap.add_argument("--api", default="http://localhost:8100")
args = ap.parse_args()
api = httpx.Client(base_url=args.api + "/api", timeout=300)
failures = []


def step(title):
    print(f"\n\033[1;36m== {title} ==\033[0m")


def call(method, path, **kw):
    r = api.request(method, path, **kw)
    body = r.json()
    if r.status_code >= 400:
        print(f"   [{r.status_code}] {body}")
    return r.status_code, body


def expect(cond, msg):
    print(f"   {'PASS' if cond else 'FAIL'}  {msg}")
    if not cond:
        failures.append(msg)


step("1. Reset & seed ZTDB Bank, initial commit")
t = time.time()
_, r = call("POST", "/demo/reset")
print(f"   seeded {r['seeded']}  ({time.time() - t:.1f}s)")
c1 = r["commit"]
print(f"   commit {c1['commit_id']}  root {c1['root'][:24]}...  records {c1['record_count']}")
expect(c1["graph_synced"], "commit DAG synced to Neo4j")

step("2. A business day happens (stored procedures + MongoDB update)")
_, r = call("POST", "/demo/business-day")
for e in r["events"]:
    print("   -", e)
st = r["status"]
print(f"   uncommitted: +{len(st['added'])} ~{len(st['modified'])} -{len(st['deleted'])}")
expect(not st["clean"], "status shows uncommitted changes")

step("3. Commit v2 and diff it against v1")
_, c2 = call("POST", "/commit", json={"message": "End of business day 1", "author": "ops"})
print(f"   commit {c2['commit_id']}  summary {c2['summary']}")
_, d = call("GET", "/diff", params={"a": c1["commit_id"], "b": c2["commit_id"]})
hero = next(m for m in d["modified"] if m["key"] == "transactions:100600")
print(f"   transactions:100600 -> {hero['changes']}")
expect(any(c["field"] == "status" and c["new"] == "COMPLETED" for c in hero["changes"]), "diff shows hero txn PENDING -> COMPLETED")

step("4. Time travel: read txn 100600 as of v1")
_, snap = call("GET", f"/commits/{c1['commit_id']}/records", params={"table": "transactions", "offset": 599, "limit": 1})
print("   ", snap["records"][0])
expect(snap["records"][0]["status"] == "PENDING", "v1 still says PENDING")

step("5. Record lineage from Neo4j")
_, h = call("GET", "/graph/records/transactions:100600")
for v in h["versions"]:
    print(f"   {v['kind']:9} in {v['commit_id']}  '{v['message']}'")
expect(len(h["versions"]) == 2, "two versions of txn 100600 in the graph")

step("6. Verify integrity of v2")
_, v = call("POST", f"/verify/{c2['commit_id']}")
for l in v["layers"]:
    print(f"   {'OK ' if l['ok'] else 'BAD'} {l['layer']}")
expect(v["ok"], "untouched history verifies")

step("7. ZK proof: 'txn 100600 status = COMPLETED in v2' (nothing else revealed)")
code, p = call("POST", "/proofs", json={"ref": c2["commit_id"], "table": "transactions", "pk": "100600",
                                       "field": "status", "op": "eq", "value": "COMPLETED"})
print(f"   proof {p.get('proof_id')} generated in {p.get('proving_ms')} ms: {p.get('claim_text')}")
_, pv = call("POST", "/proofs/verify", json=p)
for c in pv["checks"]:
    print(f"   {'OK ' if c['ok'] else 'BAD'} {c['check']}")
expect(pv["valid"], "auditor accepts the proof")

step("8. Range proof: 'amount >= ₹2,00,000' without revealing the amount")
code, p2 = call("POST", "/proofs", json={"ref": c2["commit_id"], "table": "transactions", "pk": "100600",
                                        "field": "amount_paise", "op": "gte", "value": 20000000})
_, pv2 = call("POST", "/proofs/verify", json=p2)
expect(code == 200 and pv2["valid"], "range proof verifies")

step("9. A false claim cannot be proven: 'status = PENDING in v2'")
code, _ = call("POST", "/proofs", json={"ref": c2["commit_id"], "table": "transactions", "pk": "100600",
                                       "field": "status", "op": "eq", "value": "PENDING"})
expect(code == 422, "prover refuses (no witness exists)")

step("10. Forged claim: edit the proof package to say 'FAILED'")
forged = dict(p, claim={**p["claim"], "value": "FAILED"})
_, fv = call("POST", "/proofs/verify", json=forged)
expect(not fv["valid"], "auditor rejects the forged package")

step("11. Insider attack #1: edit committed txn in MongoDB")
_, a = call("POST", "/demo/tamper", json={"mode": "blob"})
print("  ", a["attack"])
_, v = call("POST", f"/verify/{c2['commit_id']}")
for l in v["layers"]:
    print(f"   {'OK ' if l['ok'] else 'BAD'} {l['layer']}")
print("   tampered records:", v["tampered_records"])
expect(not v["ok"] and v["tampered_records"] == ["transactions:100600"], "tampering pinpointed to txn 100600")

step("12. Insider attack #2: rewrite a Merkle root in PostgreSQL")
call("POST", "/demo/tamper", json={"mode": "undo"})
_, a = call("POST", "/demo/tamper", json={"mode": "root"})
print("   first attempt:", a["first_attempt_blocked_by_trigger"])
_, v = call("POST", f"/verify/{c2['commit_id']}")
for l in v["layers"]:
    print(f"   {'OK ' if l['ok'] else 'BAD'} {l['layer']}")
expect(not v["ok"], "root rewrite detected by anchor chain")
call("POST", "/demo/tamper", json={"mode": "undo"})
_, v = call("POST", f"/verify/{c2['commit_id']}")
expect(v["ok"], "history verifies again after undo")

step("13. Branch, restore and switch back")
call("POST", "/branches", json={"name": "audit-2026q3", "start": c1["commit_id"]})
_, co = call("POST", "/checkout", json={"branch": "audit-2026q3"})
_, live = call("GET", "/live/transactions", params={"limit": 1})
print(f"   on audit-2026q3, newest txn = {live['rows'][0]['txn_id']} ({live['rows'][0]['status']})")
expect(live["rows"][0]["txn_id"] == 100600 and live["rows"][0]["status"] == "PENDING", "working DB restored to v1")
call("POST", "/checkout", json={"branch": "main"})
_, st = call("GET", "/status")
expect(st["clean"] and st["branch"] == "main", "back on main, clean")

step("14. Time-travel SQL: the same query as of v1 and v2")
q = "SELECT status, count(*) AS n FROM transactions GROUP BY status ORDER BY status"
_, s1 = call("POST", "/sql", json={"ref": c1["commit_id"], "query": q})
_, s2 = call("POST", "/sql", json={"ref": c2["commit_id"], "query": q})
print("   v1:", s1.get("rows"))
print("   v2:", s2.get("rows"))
expect(dict(map(tuple, s1["rows"])).get("PENDING") == 1, "v1 has exactly one PENDING txn (the hero)")
code, _ = call("POST", "/sql", json={"ref": "main", "query": "DELETE FROM transactions"})
expect(code == 400, "console refuses anything but SELECT")
code, _ = call("POST", "/sql", json={"ref": "main", "query": "SELECT * FROM bank.accounts"})
expect(code == 403, "console cannot read the live schema")

step("15. Merge: clean three-way merge into a two-parent commit")
_, sc = call("POST", "/demo/merge-scenario", json={"mode": "clean"})
_, m = call("POST", "/merge", json={"source": sc["source_branch"]})
print(f"   {m.get('result')}  base {m.get('base')}  parents {m.get('commit', {}).get('parents')}")
expect(m.get("result") == "merged" and len(m["commit"]["parents"]) == 2, "clean merge creates a merge commit")

step("16. Merge: conflicting edits must be resolved")
_, sc = call("POST", "/demo/merge-scenario", json={"mode": "conflict"})
code, mc = call("POST", "/merge", json={"source": sc["source_branch"]})
for c in mc.get("conflicts", []):
    print(f"   conflict {c['key']}.{c['field']}: base={c['base']} ours={c['ours']} theirs={c['theirs']}")
expect(code == 409 and len(mc.get("conflicts", [])) == 2, "two conflicts reported (PostgreSQL + MongoDB)")
res = {f"{c['key']}|{c['field']}": "theirs" for c in mc.get("conflicts", [])}
code, m = call("POST", "/merge", json={"source": sc["source_branch"], "resolutions": res})
expect(code == 200 and m.get("result") == "merged", "merge succeeds once conflicts are resolved")
_, v = call("POST", "/verify/main")
expect(v["ok"], "merged history verifies")

step("17. Merge: fast-forward")
call("POST", "/branches", json={"name": "hotfix"})
call("POST", "/checkout", json={"branch": "hotfix"})
call("POST", "/demo/business-day")
call("POST", "/commit", json={"message": "Hotfix day", "author": "ops"})
call("POST", "/checkout", json={"branch": "main"})
_, m = call("POST", "/merge", json={"source": "hotfix"})
expect(m.get("result") == "fast-forward", "main fast-forwards to hotfix")

step("18. Overview numbers across the three databases")
_, s = call("GET", "/stats")
print(f"   commits {s['postgres']['commits']}, blobs {s['mongo']['blobs']}, dedup x{s['mongo']['dedup_ratio']}, "
      f"neo4j nodes {sum(s['neo4j'].get('nodes', {}).values())}")
expect(s["mongo"]["dedup_ratio"] and s["mongo"]["dedup_ratio"] > 1, "content addressing deduplicates record versions")

print()
if failures:
    print(f"\033[1;31m{len(failures)} check(s) failed\033[0m")
    sys.exit(1)
print("\033[1;32mAll demo checks passed\033[0m")
