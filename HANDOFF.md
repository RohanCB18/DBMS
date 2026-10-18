# HANDOFF — ZK-TemporalDB

Read this first if you are continuing the project, rehearsing the demo or writing the report.
It says what exists, how to run and present it, the traps already discovered, and the known limitations.

**Timeline:** demo around 7 Nov 2026. All features planned for the demo are implemented and tested
(as of 19 Oct 2026). What is left is rehearsal, the report/poster, and (optionally) cloud deployment.

---

## 1. What is DONE — and verified

| Check | Result |
|---|---|
| `python api/scripts/demo_flow.py` (end-to-end, stack running) | **24/24 checks pass** |
| `pytest` in `api/` (no databases needed) | 35 passed |
| `npm test` in `web/` (browser claim encoding == zk-service encoding) | 14 passed |
| `npm test` in `zk-service/` (circuit: true claims prove, false claims cannot) | passes |
| Web UI walked through in a browser: prove → auditor portal (browser verification) → forged claim rejected; tamper → verify red; merge with conflict resolution; SQL; fraud ring | works |

| Area | What | Where |
|---|---|---|
| ZK circuit | Groth16 proof of `field = / ≥ / ≤ value` for a record in a Poseidon Merkle tree (depth 13, 8 fields) | `circuits/` |
| zk-service | Poseidon leaves/roots, Merkle paths, prove (~1–2.5 s), verify | `zk-service/src/` |
| PostgreSQL | 3NF bank schema, VCS schema, triggers, stored procedures, recursive CTEs, anchor hash chain, read-only console role, snapshot schemas | `db/postgres/` |
| MongoDB | live KYC; content-addressed blobs, tree manifests, proof packages, external-anchor log | `api/app/vcs.py`, `proofs.py`, `anchoring.py` |
| Neo4j | commit DAG, record lineage, proof graph, **money-flow graph + fraud-ring query** | `api/app/graph.py`, `analytics.py` |
| Version control | commit, status, log, diff, snapshots, restore (`move_head` = reset --hard), branches, checkout, **three-way merge** | `api/app/vcs.py`, `merge.py` |
| Integrity | 4-layer verify (+ layer 5 when external anchoring is on), pinpointing, run history | `vcs.verify` |
| Proofs | packages, auditor verification, plain Merkle inclusion proof | `api/app/proofs.py` |
| Time-travel SQL | `snap_<commit>` schemas (LRU 5), `ztdb_reader` role, READ ONLY, 3 s timeout, 500 rows | `api/app/sqlconsole.py` |
| External anchoring | `ZTDB_EXTERNAL_ANCHOR=off|file|github` | `api/app/anchoring.py` |
| Hardening | advisory lock around commit/restore/checkout/merge; DB errors → 400/409; package validation; demo controls gated (`ZTDB_DEMO_MODE`, `ZTDB_ADMIN_TOKEN`); `.env`; atomic Mongo swap on restore | `api/app/` |
| Web | dashboard (12 pages) + auditor portal with in-browser Groth16 verification | `web/` |
| CLI | `python api/cli.py …` (Typer + rich) | `api/cli.py` |
| Packaging | Dockerfiles for api / zk-service / web (nginx), compose, GitHub Actions CI, Docker-free Windows scripts | `docker-compose.yml`, `.github/`, `scripts/local/` |
| Docs | ER diagrams, normalisation, trigger catalogue, Mongo + Neo4j models, merge / SQL console / analytics design | `docs/DATABASE_DESIGN.md` |

## 2. What is LEFT

* **Rehearse** with the demo script below on the projector (1280×720 or the room's resolution); record a backup video.
* **Report / poster** — start from `docs/DATABASE_DESIGN.md` and section 5.
* **Optional: cloud deployment.** Recommended shape if you do it: one EC2 t3.large (8 GB; Neo4j + proving need
  memory), Ubuntu 24.04, Docker Compose as-is plus a Caddy container for HTTPS (`your-domain { reverse_proxy web:80 }`).
  Security group 80/443 only (22 from your IP) — never expose 5544/27018/7687. In `.env`: real passwords,
  `ZTDB_DEMO_MODE=on` **with** `ZTDB_ADMIN_TOKEN` set (or `off`), then set the token in the browser with
  `localStorage.setItem("ztdb.adminToken", "<token>")`.
* **Optional: GitHub external anchoring.** Implemented but only the `file` mode was exercised; for `github`
  create a public repo + fine-grained token (contents: write) and set `ZTDB_EXTERNAL_ANCHOR=github`,
  `ZTDB_GITHUB_TOKEN`, `ZTDB_GITHUB_REPO=owner/name`. Commits then publish `anchors.jsonl` there.

## 3. Demo script for the presentation (~12 min)

Start: `scripts\local\start.ps1` (or `docker compose up -d`), open http://localhost:8090.

1. **Overview → Reset demo** — three databases; 742 records just fingerprinted into one Merkle root.
2. **Run a business day → Commit** — stored procedures settle txn **#100600** (₹2,50,000 property advance)
   PENDING→COMPLETED, new transfers, a reversal, an account frozen, a KYC doc verified in MongoDB.
3. **Diff** v1 → v2 · **Record lineage** of `transactions:100600` (Neo4j) · **Time travel** to v1 ·
   **SQL console**: "Transactions by status" on v1 vs v2 side by side; try `DELETE` → refused.
4. **Verify** v2 → all green. **Tamper lab** → edit #100600 in MongoDB → *Verify HEAD now* → red, pinpointed.
   Undo. Rewrite root in Postgres → trigger blocks it → attacker disables trigger → anchor chain catches it. Undo.
5. **Prove** "txn 100600 status = COMPLETED" (and `amount_paise ≥ 20000000`) → *Open in auditor portal*
   (a different organisation) → verified in the browser. *Try to forge the claim* → FAILED → rejected.
   Prove "status = PENDING" → impossible (no proof can exist).
6. **Merge** → *Conflict* scenario → Preview → choose ours/theirs per field → Merge → **History** shows the
   two-parent merge commit.
7. **Fraud rings** → the 4-account ring (₹7.9 lakh in 108 min, each hop just under ₹2 lakh) →
   *Freeze ring accounts* → commit → prove "account … status = FROZEN" for the regulator.
8. Close: "trust us" → "here's mathematical proof", with privacy.

The CLI (`python api/cli.py …`) can show the same story in a terminal next to the UI.

## 4. Gotchas already hit (read before debugging!)

* **No Docker on this laptop**: the portable setup in `scripts/local/` is the supported way to run locally
  (PostgreSQL zip in `.local\pgsql`, Neo4j zip in `.local\neo4j-community-*`, MongoDB service on **27017**,
  so `.env` sets `MONGO_URI=mongodb://localhost:27017`). `setup.ps1 -Reset` re-creates the Postgres data dir.
* `pg_ctl start` must be launched with `Start-Process` — its child inherits stdout, so capturing its output hangs.
* Neo4j 5 prints *"unsupported Java runtime"* with Java 23; it works anyway. Use Java 17/21 if it ever refuses.
* **Avast HTTPS scanning breaks `docker compose build`** (pip/npm `CERTIFICATE_VERIFY_FAILED`, issuer
  "Avast Web/Mail Shield Root"). Disable Web Shield → HTTPS scanning, or run natively. No `--trusted-host` hacks.
* **Docker Desktop crash "initializing Inference manager … dockerInference"**: quit Docker, rename
  `%LOCALAPPDATA%\Docker\run` to `run_old`, restart. Disable Settings → AI → Docker Model Runner.
* **Ports**: Postgres **5544**, Mongo **27018** (Docker) / 27017 (portable), API **8100**, web **8090**, Vite dev 5173.
* SQL files in `db/postgres` only run on a **fresh** database. Docker: `docker compose down -v` then `up`.
  Portable: `setup.ps1 -Reset`. Then *Reset demo*.
* PowerShell 5 `Set-Content -Encoding utf8` writes a BOM and mangles non-ASCII — edit files in your editor.
* Postgres `CHAR(16)` commit ids come back space-padded in some queries — the code `.strip()`s them; keep doing that.
* Neo4j: after `WITH … collect()` you cannot `ORDER BY` a pre-aggregation variable — order by the alias.
  The fraud-ring query uses a *quantified path pattern* (Neo4j ≥ 5.9) so the edge filter prunes during expansion;
  a plain `[:SENT*3..5]` + `WHERE all(...)` explodes combinatorially.
* Changing the circuit (depth, fields) requires `cd circuits && npm install && npm run build`
  (regenerates wasm/zkey/vkey into `zk-service/artifacts` and `web/public/zk`), restarting zk-service,
  and a demo reset. Keep `DEPTH`/`NFIELDS` in `crypto.js` in sync, and **keep `web/src/lib/zk.ts` identical to
  `crypto.js`'s `encodeValue`** — `web/src/lib/zk.test.ts` pins them together.
* The demo reset restarts identity sequences, so anchor numbers start at #1 again; the external-anchor file is
  append-only, so lookups use the *latest* publication of a sequence number.

## 5. Known limitations (be ready for viva questions)

* Capacity 8192 records per commit (Merkle depth 13); raise `DEPTH` → bigger ptau (`POWER` in build.mjs).
* Trusted setup is single-party local — fine for a demo; production uses a public multi-party ceremony
  (or a transparent system like PLONK/STARKs).
* Max 8 provable fields per record; extra fields are folded into `~rest` (hashed together, not individually provable).
* Restore and merge rewrite the whole live DB (fine at this size; production would apply a diff).
* Mongo and Postgres are not one distributed transaction. Restore stages MongoDB in a temp collection and swaps it
  in after the Postgres commit; commit writes Mongo first and Postgres is the source of truth (orphans are harmless).
* Merge is state-based (snapshots), not operation-based: a merged state can violate cross-record invariants
  (e.g. balances vs. transactions) even when there is no field conflict. Constraint violations abort the merge (409).
* The SQL console's statement check is basic; the real enforcement is the read-only role, READ ONLY transaction
  and statement timeout. Snapshot schemas omit constraints and views.
* Salted leaves hide low-entropy fields; the salt is stored with the blob, so whoever controls the blob store
  can always open the commitment (intended — they are the data owner).
* The anchor chain stops single-row edits; rewriting the *whole* chain needs external anchoring to detect.
