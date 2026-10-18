# ZK-TemporalDB

> **Git for databases, with cryptographic proof.**
> Commit, diff, branch, merge, time-travel and restore a multi-database system — and prove what a
> past record said to an outsider *without revealing anything else*.

Normal backups answer *"can I recover old data?"*. ZK-TemporalDB answers *"can I **prove** what the
data looked like, without exposing everything?"* — useful for banks proving old transactions to
auditors, hospitals proving consent records, e-commerce price disputes, and legal evidence.

**Status: feature-complete for the demo.** Backend, cryptography, the three databases, the web
dashboard, the auditor portal, merge, time-travel SQL, fraud-ring analytics, CLI and external
anchoring all work end-to-end (`api/scripts/demo_flow.py`: 26 checks). Cloud deployment is
optional and not done — see [HANDOFF.md](HANDOFF.md).

## How it works

```
        React dashboard (:8090)                      Auditor portal (/audit)
        overview · history DAG · diff · verify ·      verifies Groth16 proofs IN THE BROWSER,
        tamper lab · prove · merge · SQL · fraud      re-encodes the claim itself
                                  │
                     FastAPI  (api/, Python)  ── http://localhost:8100/docs      ztdb CLI (api/cli.py)
        ┌──────────────┬──────────┴────────┬──────────────────────┐
   PostgreSQL       MongoDB              Neo4j               zk-service (Node)
   live bank data   KYC docs (live)      commit DAG          Poseidon Merkle trees
   vcs metadata     snapshot blobs,      record lineage      Groth16 prove / verify
   anchor chain     trees, proofs        money-flow graph    (circuits/record_claim.circom)
   snap_<commit>    external anchors     fraud rings
```

1. **Commit** — every row (Postgres) and document (Mongo) becomes a canonical *record*; each record
   is stored once as a content-addressed blob (SHA-256) and hashed into a Poseidon Merkle leaf.
   The Merkle root is the fingerprint of the entire database at that moment.
2. **Anchor** — each root is appended to a hash-chained transparency log in Postgres
   (immutable via triggers), and optionally published outside the database (file / GitHub).
3. **Verify** — four (five with external anchoring) independent layers. Any edit to history, in any
   database, is detected and pinpointed to the record.
4. **Prove** — a Circom circuit (Groth16, ~12.5k constraints) proves
   *"record X in commit C has field F = / ≥ / ≤ V"* while hiding all other fields, all other
   records and (for ranges) the value itself. Proofs are ~720 bytes and verify in milliseconds.
5. **Branch & merge** — three-way, record- and field-level merge with conflict resolution;
   merge commits have two parents.
6. **Time-travel SQL** — any commit can be materialised into its own schema and queried with
   ordinary `SELECT`s by a read-only role.
7. **Graph analytics** — Neo4j finds money-laundering rings in a commit's transactions.

## Quick start — Windows, no Docker (portable databases)

Prerequisites: Node 20+, Python 3.11+, Java 17+ (for Neo4j), MongoDB running locally on 27017.
Unpack the portable builds into `.local\` (gitignored): PostgreSQL 16 Windows binaries
(EnterpriseDB zip → `.local\pgsql`) and Neo4j 5 Community (`.local\neo4j-community-5.26.x`).

```powershell
cd zk-service; npm install; cd ..
cd api; python -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt; cd ..
cd web; npm install; cd ..
powershell -ExecutionPolicy Bypass -File scripts\local\setup.ps1     # once: initdb, schema, Neo4j password, .env
powershell -ExecutionPolicy Bypass -File scripts\local\start.ps1     # Postgres, Neo4j, zk-service, API, web
```

Open **http://localhost:8090** → *Reset demo*. Stop everything with `scripts\local\stop.ps1`.

## Quick start — Docker

```bash
cp .env.example .env           # adjust secrets; never expose demo controls publicly
docker compose up -d --build   # web :8090, API :8100, zk-service :7000
```

The SQL files in `db/postgres` run only on a fresh volume — after changing them:
`docker compose down -v && docker compose up -d`.

## Testing

```bash
cd api && .venv/Scripts/python -m pytest -q          # 35 unit tests (no databases needed)
cd api && .venv/Scripts/python scripts/demo_flow.py   # end-to-end demo, 26 checks (stack running)
cd web && npm test                                   # browser claim encoding == zk-service encoding
cd zk-service && npm test                            # circuit self-test (true/false claims)
```

GitHub Actions runs all four (the end-to-end test inside docker compose).

## CLI

```bash
cd api
python cli.py status
python cli.py demo business-day
python cli.py commit -m "End of day"
python cli.py log
python cli.py diff <a> [<b>|WORKING]
python cli.py verify main
python cli.py prove --table transactions --pk 100600 --field status --value COMPLETED -o proof.json
python cli.py audit proof.json
python cli.py merge audit-fix --resolve "customers:7|phone=theirs"
python cli.py sql main "SELECT status, count(*) FROM transactions GROUP BY status"
python cli.py rings
```

| Service | URL | Credentials |
|---|---|---|
| Dashboard | http://localhost:8090 (auditor portal: `/audit`) | — |
| API + Swagger UI | http://localhost:8100/docs | demo controls: optional `X-Admin-Token` |
| PostgreSQL | localhost:5544, db `ztdb` | `ztdb` / `ztdb`; console role `ztdb_reader` |
| MongoDB | Docker: localhost:27018 · portable setup: 27017 | — |
| Neo4j browser | http://localhost:7474 (bolt :7687) | `neo4j` / `ztdb-neo4j` |
| zk-service | http://localhost:7000/health | — |

## Repository layout

```
circuits/       record_claim.circom + build.mjs (compile + Groth16 trusted setup)
zk-service/     Node: Poseidon Merkle tree, prove/verify; artifacts/ = wasm, zkey, verification key
api/app/        FastAPI: vcs.py (commit/diff/restore/merge/verify), merge.py (3-way merge), proofs.py,
                sqlconsole.py (time-travel SQL), analytics.py + graph.py (Neo4j), anchoring.py,
                stats.py, demo.py, canonical.py
api/cli.py      ztdb command-line client
api/tests/      pytest unit tests;  api/scripts/demo_flow.py = end-to-end demo & integration test
db/postgres/    01_bank_schema.sql, 02_vcs_schema.sql, 03_roles.sql
web/            React dashboard + auditor portal (Vite, TypeScript, Tailwind)
scripts/local/  setup/start/stop the stack without Docker (Windows)
docs/           DATABASE_DESIGN.md, IMPLEMENTATION_PLAN.md
HANDOFF.md      demo script, gotchas, known limitations, what is left (deployment)
```

## API overview

| Method | Path | What |
|---|---|---|
| GET | `/api/status` | uncommitted changes vs HEAD + recent change log |
| POST | `/api/commit` | `{message, author}` → new commit (root, anchor, external anchor, summary) |
| GET | `/api/log?branch=` | commit history (recursive CTE) |
| GET | `/api/diff?a=&b=` | record + field level diff (`b=WORKING` for live DB) |
| GET | `/api/commits/{ref}/records?table=` · `/api/commits/{ref}/record/{key}` | browse a historical snapshot |
| GET/POST | `/api/branches` | list / create branch |
| POST | `/api/checkout` | switch branch (restores its head) |
| POST | `/api/restore` | `{ref, force, move_head}` reset live DB to any commit (optionally move the branch) |
| POST | `/api/merge` | `{source, resolutions?, dry_run?}` three-way merge; 409 + conflict list |
| POST | `/api/sql` | `{ref, query}` read-only SELECT against a past commit |
| POST | `/api/verify/{ref}` · GET `/api/verify-runs` | integrity check / history |
| GET | `/api/anchors` · `/api/anchors/external` | the transparency log / external publication |
| POST | `/api/proofs` · GET `/api/proofs[/{id}]` | `{ref, table, pk, field, op: eq/gte/lte, value}` → ZK proof package |
| POST | `/api/proofs/verify` | auditor-side verification of a package |
| POST | `/api/inclusion` | plain (non-ZK) Merkle inclusion proof, for comparison |
| GET | `/api/graph/commits`, `/api/graph/records/{key}` | Neo4j commit DAG / record lineage |
| GET | `/api/graph/fraud-rings?ref=&min_amount_inr=&max_hours=` | cycles in the money-flow graph |
| GET | `/api/stats` | counts across the three databases, dedup ratio |
| GET | `/api/live/{table}` | live rows (`transactions`, `accounts`, `customers`, `bank_branches`, `kyc_documents`) |
| POST | `/api/demo/reset` · `business-day` · `tamper` · `merge-scenario` · `freeze` | demo controls (`ZTDB_DEMO_MODE`) |
