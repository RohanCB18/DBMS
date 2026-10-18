# ZK-TemporalDB

> **Git for databases, with cryptographic proof.**
> Commit, diff, time-travel and restore a multi-database system — and prove what a past
> record said to an outsider *without revealing anything else*.

Normal backups answer *"can I recover old data?"*. ZK-TemporalDB answers *"can I **prove** what the
data looked like, without exposing everything?"* — useful for banks proving old transactions to
auditors, hospitals proving consent records, e-commerce price disputes, and legal evidence.

**Status: ~60% complete.** Backend, cryptography, all three databases and the scripted demo
work end-to-end. The web UI, merging, SQL time-travel console, CLI and AWS deployment are
specified in **[HANDOFF.md](HANDOFF.md)**.

## How it works

```
                 (React dashboard + auditor portal — TODO, see HANDOFF.md)
                                  │
                     FastAPI  (api/, Python)  ── http://localhost:8100/docs
        ┌──────────────┬──────────┴────────┬──────────────────────┐
   PostgreSQL       MongoDB              Neo4j               zk-service (Node)
   live bank data   KYC docs (live)      commit DAG          Poseidon Merkle trees
   vcs metadata     snapshot blobs,      record lineage      Groth16 prove / verify
   anchor chain     trees, proofs        proof graph         (circuits/record_claim.circom)
```

1. **Commit** — every row (Postgres) and document (Mongo) becomes a canonical *record*; each record
   is stored once as a content-addressed blob (SHA-256) and hashed into a Poseidon Merkle leaf.
   The Merkle root is the fingerprint of the entire database at that moment.
2. **Anchor** — each root is appended to a hash-chained transparency log in Postgres
   (immutable via triggers).
3. **Verify** — four independent layers (content hashes, leaves, root, anchor chain). Any edit to
   history, in any database, is detected and pinpointed to the record.
4. **Prove** — a Circom circuit (Groth16, ~12.5k constraints) proves
   *"record X in commit C has field F = / ≥ / ≤ V"* while hiding all other fields, all other
   records and (for ranges) the value itself. Proofs are ~800 bytes and verify in milliseconds.

## Quick start (development)

Prerequisites: Docker Desktop, Node 20+, Python 3.11+.

```bash
# 1. databases
docker compose up -d postgres mongo neo4j

# 2. zk-service (circuit artifacts are already committed in zk-service/artifacts)
cd zk-service && npm install && npm start            # :7000

# 3. API (new terminal)
cd api
python -m venv .venv
.venv\Scripts\activate        # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --port 8100 --reload            # docs: http://localhost:8100/docs

# 4. run the whole demo + integration test (new terminal, inside api/ with venv active)
python scripts/demo_flow.py
```

Or everything in containers: `docker compose up -d --build` (API on :8100, zk-service on :7000).

| Service | URL | Credentials |
|---|---|---|
| API + Swagger UI | http://localhost:8100/docs | — |
| PostgreSQL | localhost:5544, db `ztdb` | `ztdb` / `ztdb` |
| MongoDB | mongodb://localhost:27018 | — |
| Neo4j browser | http://localhost:7474 (bolt :7687) | `neo4j` / `ztdb-neo4j` |
| zk-service | http://localhost:7000/health | — |

## Repository layout

```
circuits/       record_claim.circom + build.mjs (compile + Groth16 trusted setup)
zk-service/     Node: Poseidon Merkle tree, prove/verify; artifacts/ = wasm, zkey, verification key
api/app/        FastAPI: vcs.py (commit/diff/restore/verify), proofs.py, graph.py, demo.py, canonical.py
api/scripts/    demo_flow.py — narrated end-to-end demo & integration test
db/postgres/    01_bank_schema.sql, 02_vcs_schema.sql (run automatically on first container start)
docs/           DATABASE_DESIGN.md (ER diagrams, normalisation, triggers, Mongo & Neo4j models)
web/public/zk/  verification_key.json for in-browser verification (UI is TODO)
HANDOFF.md      remaining work, specs, and gotchas
```

## API overview

| Method | Path | What |
|---|---|---|
| GET | `/api/status` | uncommitted changes vs HEAD + recent change log |
| POST | `/api/commit` | `{message, author}` → new commit (root, anchor, summary) |
| GET | `/api/log?branch=` | commit history (recursive CTE) |
| GET | `/api/diff?a=&b=` | record + field level diff (`b=WORKING` for live DB) |
| GET | `/api/commits/{ref}/records?table=` | browse a historical snapshot |
| GET/POST | `/api/branches` | list / create branch |
| POST | `/api/checkout` | switch branch (restores its head) |
| POST | `/api/restore` | reset live DB to any commit |
| POST | `/api/verify/{ref}` | 4-layer tamper check |
| GET | `/api/anchors` | the transparency log |
| POST | `/api/proofs` | `{ref, table, pk, field, op: eq/gte/lte, value}` → ZK proof package |
| POST | `/api/proofs/verify` | auditor-side verification of a package |
| POST | `/api/inclusion` | plain (non-ZK) Merkle inclusion proof, for comparison |
| GET | `/api/graph/commits`, `/api/graph/records/{key}` | Neo4j commit DAG / record lineage |
| GET | `/api/live/{table}` | live rows (`transactions`, `accounts`, `customers`, `bank_branches`, `kyc_documents`) |
| POST | `/api/demo/reset`, `/api/demo/business-day`, `/api/demo/tamper` | demo scenario controls |
