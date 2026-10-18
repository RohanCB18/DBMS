# ZK-TemporalDB — Status Review & Implementation Plan

*Prepared 18 Oct 2026 for approval. Demo target: about 20 days out (around 7 Nov 2026).*
*Basis: I read every tracked source file (37 files, about 2,350 lines of code and SQL), not just HANDOFF.md.*

---

## 1. Where the project stands

### 1.1 Done (I checked these in the code)

| Area | What exists | Files |
|---|---|---|
| **ZK circuit** | Groth16 `RecordClaim(13, 8)`: proves `field = / ≥ / ≤ value` for one record in a Poseidon Merkle tree (8192 leaves, 8 fields per leaf, salted leaves, private field index). Local trusted setup script. Built artifacts are committed. | `circuits/record_claim.circom`, `circuits/build.mjs`, `zk-service/artifacts/*` |
| **zk-service (Node)** | Express service: leaf hashing, root, Merkle path, value encoding, `/prove` (returns 422 when the claim is false), `/verify`, `/vkey`. Has a self-test script. | `zk-service/src/*.js`, `test/selftest.js` |
| **PostgreSQL** | `bank` schema in 3NF (branches, customers, accounts, transactions), a transaction state-machine trigger, stored procedures `sp_transfer` / `sp_settle_txn` / `sp_reverse_txn`, and a view. `vcs` schema: commits, parents (2-parent DAG), branches, head, a hash-chained anchor log, change log, verification runs. Immutability triggers, audit triggers, `sp_record_commit`, recursive CTEs `fn_ancestors` and `fn_merge_base`. | `db/postgres/01_*.sql`, `02_*.sql` |
| **MongoDB** | Live `kyc_documents`. Content-addressed `blobs` (deduplicated, salted), `trees` (commit manifests), `proofs`. | `api/app/vcs.py`, `proofs.py` |
| **Neo4j** | Commit DAG, branch heads, record → version → commit lineage, proof nodes. Sync is best-effort and never blocks a commit. | `api/app/graph.py` |
| **Version control** | commit, status, log, diff (record and field level, also against the live DB), snapshot browsing, restore, branches, checkout | `api/app/vcs.py` |
| **Integrity** | 4-layer verify (content hash → leaf → root → anchor chain), pinpoints tampered records, stores each run | `vcs.verify` |
| **Proofs** | Proof package create/list/get, auditor verification (proof + claim binding + anchored root), plain Merkle inclusion proof for comparison | `api/app/proofs.py` |
| **Demo** | Seeded bank (742 records, deterministic), business day run through the stored procedures, two insider attacks plus undo, reset | `api/app/demo.py` |
| **API** | FastAPI with about 30 routes, CORS open, Swagger at `/docs` | `api/app/main.py` |
| **Integration test** | `demo_flow.py` runs the whole story and checks 15 expectations | `api/scripts/demo_flow.py` |
| **Docs** | ER diagrams, normalisation, trigger catalogue, Mongo and Neo4j models | `docs/DATABASE_DESIGN.md` |
| **Containers** | Compose file for postgres, mongo, neo4j, zk-service, api. Dockerfiles for api and zk-service. | `docker-compose.yml` |

Checks I ran: all Python files compile, and `web/public/zk/verification_key.json` matches the zk-service key byte for byte.
**I did not run the stack.** Docker is not on this shell's PATH, so the "15/15 passed" result comes from HANDOFF and I have not reproduced it. That is step 0.1 below.

### 1.2 Pending: from HANDOFF.md

| ID | Item | Status |
|---|---|---|
| P1-A | **Web dashboard and auditor portal** (React) | **Not started.** `web/` only contains the verification key. |
| P1-B | Three-way merge (`POST /api/merge`, conflict resolution) | Not started. The SQL side is ready: `fn_merge_base` and 2-parent support exist. |
| P1-C | Time-travel SQL console (`POST /api/sql`) | Not started |
| P2-A | Neo4j money-flow graph and fraud-ring detection | Not started |
| P2-B | `ztdb` CLI (Typer + rich) | Not started |
| P2-C | External anchoring (GitHub / OpenTimestamps) | Not started |
| P3 | `/api/stats`, pytest unit tests, web Dockerfile + nginx, AWS deployment | Not started |

### 1.3 Pending: gaps I found that HANDOFF does not list

| # | Problem | Why it matters | Fix |
|---|---|---|---|
| G1 | No lock around commit, restore or checkout | A double-click in the UI, or UI and CLI at the same time, can run two at once and leave the live DB half-restored | Take `pg_advisory_xact_lock` (or a session lock) in commit/restore/checkout/merge |
| G2 | Database errors come back as HTTP 500 (for example a duplicate branch name) | The UI shows ugly errors | Map psycopg `IntegrityError` to 409 and `CheckViolation` to 400 in one exception handler |
| G3 | `POST /proofs/verify` crashes with a `KeyError` (500) on a malformed package | An auditor drops in a bad file and the API errors out | Add a Pydantic model for the package and return 400 with a clear message |
| G4 | `restore` changes the live DB but not the branch head, so `status` shows "dirty" afterwards | Confusing in the demo. Merge fast-forward also needs to move the head. | Add a `move_head` option (like `git reset --hard`) and show the detached/dirty state in the UI |
| G5 | `/demo/reset` and `/demo/tamper` have no auth | Once on AWS, anyone can wipe or tamper the DB | Add a `ZTDB_DEMO_MODE` flag plus an admin token header. Off by default in production. |
| G6 | Passwords are hard-coded in compose and `config.py` | Not acceptable on a public server | Move them to `.env` and add `.env.example` (`.env` is already gitignored) |
| G7 | No unit tests and no CI | Regressions surface during rehearsal | pytest plus a GitHub Actions workflow (lint, unit tests, zk self-test) |
| G8 | `@app.on_event("startup")` is deprecated | Warning noise | Switch to a `lifespan` handler (small change) |
| G9 | Mongo and Postgres writes in restore are not atomic (already a known limitation) | A crash mid-restore can leave the two stores out of step | Write Mongo into a temp collection and rename it after the Postgres commit. That is cheap and makes the swap atomic. |

---

## 2. Implementation plan

Rough split: about 60% of the remaining effort is the web UI, because it carries the demo. Backend work comes first wherever the UI depends on it.

### Phase 0: Baseline and hardening (Day 1, backend)
- 0.1 Bring the stack up (see the Avast/Docker gotchas in HANDOFF §4) and run `demo_flow.py`. Record the result.
- 0.2 G1 locking, G2 error mapping, G3 package validation, G8 lifespan.
- 0.3 G6 `.env` / `.env.example`, compose `env_file`.
- **Done when:** `demo_flow.py` passes 15/15, a duplicate branch returns 409, and a garbage package returns 400.

### Phase 1: Backend features the UI needs (Days 2–5)
- **1.1 Three-way merge (P1-B)**, in `vcs.py` and `main.py`
  - Refactor the restore body into `_write_live(by_table)`. Add `extra_parent` to `commit()`. Add a `move_head` option (G4).
  - `merge(source, resolutions)`: already-up-to-date / fast-forward / record- and field-level 3-way merge. Return 409 with a conflict list `[{key, field, base, ours, theirs}]`.
  - `POST /api/merge {source, resolutions?}`. Neo4j already draws both parent edges.
  - Add demo helpers: an `audit-fix` branch that edits a customer phone (clean merge), and a second edit to the same field (conflict).
- **1.2 Time-travel SQL console (P1-C)**
  - `03_roles.sql`: a read-only role `ztdb_reader`. Materialise `snap_<commit>` schemas, cached, LRU of 5.
  - `POST /api/sql {ref, query}`: single `SELECT`/`WITH` only, `BEGIN READ ONLY`, 3 s timeout, at most 500 rows.
  - Note: the SQL files only run on a fresh volume, so this needs `docker compose down -v`, or run `03_roles.sql` by hand.
- **1.3 `GET /api/stats`**: counts per DB, blobs vs record versions (dedup ratio), proofs issued, verify runs.
- **1.4 Unit tests (G7)**: `api/tests/` covering `canonical` (canonical form, fold/unfold, stable blob ids), `_changes`, the merge decision table (pure function, no DB needed), and the SQL statement guard.
- **Done when:** `demo_flow.py` also covers a clean merge, a conflict merge with resolution, and `/sql` on v1 vs v2, and pytest is green.

### Phase 2: Web dashboard (Days 1–10, frontend, runs alongside Phase 1)
Stack as specified: Vite + React + TypeScript + Tailwind, `@xyflow/react`, `lucide-react`, `framer-motion`, `snarkjs`, plus TanStack Query for data fetching and React Router.

| Days | Pages |
|---|---|
| 1–2 | Scaffold, typed API client (`src/lib/api.ts`), dark projector-friendly layout, hash chip with copy button. **Overview** (status, HEAD, counts, Business day / Commit / Reset). **Live data** (tabs, nested JSON for KYC, rows changed since HEAD highlighted). |
| 3–5 | **History** (xyflow DAG, side panel with Verify / Restore), **Diff** (commit or WORKING picker, per-field old → new), **Time travel** (paginated snapshot), **Record lineage** (timeline from Neo4j with proof badges) |
| 5–6 | **Verify** (4 layer cards animated in sequence, tampered keys shown), **Tamper lab** (3 big buttons, shows the trigger-blocked message) |
| 6–8 | **Prove** (form with a field dropdown filled from the snapshot, spinner, download JSON, open in auditor portal). **Auditor portal** `/audit` (separate minimal layout, in-browser `groth16.verify`, browser claim re-encoding in `src/lib/zk.ts` matching `crypto.js` exactly, "learned vs hidden" panel, optional anchor check). |
| 8–9 | **Merge** page (branch picker, conflict resolver ours/theirs per field), **SQL console** (editor, "as of" picker, result grid) |
| 10 | Polish, animations, projector test at 1280×720, empty and error states |

- **Critical test:** the browser accepts a package from `POST /proofs` and rejects it after `claim.value` is edited. Add a small vitest test for `zk.ts` against values captured from `/api/encode`.
- **Done when:** the full demo script (HANDOFF §3) can be run from the UI alone, without Swagger.

### Phase 3: Stretch features (Days 6–9, backend)
- **3.1 Fraud ring (P2-A):** plant a 3–4 account ring in `_seed_rows`, make sure the balances stay consistent (the seed is deterministic, so expected values will shift). Add `graph.sync_money_flow` (HEAD only) and `GET /api/graph/fraud-rings`. Then a UI card that highlights the ring, and a proof that "account X is FROZEN".
- **3.2 CLI (P2-B):** `api/cli.py` with Typer + rich wrapping the API (status, commit, log, diff, branch, checkout, restore, verify, prove, audit, merge, sql).
- **3.3 External anchoring (P2-C):** behind the optional `ZTDB_EXTERNAL_ANCHOR=github` setting. After each commit, append `{seq, entry_hash}` to a file in a public repo through the GitHub API (token in `.env`). Show "externally anchored ✓" in the auditor portal. Off means fully offline. (OpenTimestamps is the alternative, but Bitcoin confirmation takes hours, which is awkward for a live demo.)

### Phase 4: Packaging and deployment (Days 10–13)
- 4.1 `web/Dockerfile` (node build → `nginx:alpine`) and `nginx.conf` proxying `/api/` to `api:8000`. Un-comment `web` in compose (port 8090).
- 4.2 G5 demo-mode and admin-token gating.
- 4.3 AWS: one EC2 t3.large (Ubuntu 24.04), Docker Compose plus a Caddy container for HTTPS. Security group open on 80/443 only (plus 22 limited to your IP). Neo4j heap tuned for 8 GB.
- 4.4 GitHub Actions CI: pytest, `npm run build` for web, zk self-test.
- **Done when:** the public HTTPS URL runs the demo, DB ports are not reachable from outside, and reset works only with the admin token.

### Phase 5: Rehearsal and documentation (Days 14–20)
- Run `demo_flow.py` before every rehearsal. Do a dry run on the projector. Record a backup demo video.
- Update README (drop "~60%", add UI screenshots), DATABASE_DESIGN (merge, roles, snapshot schemas, money-flow graph), and HANDOFF.
- Viva prep: the known-limitations list in HANDOFF §5, plus the trusted-setup and capacity answers.

### Timeline at a glance

```
Day:        1  2  3  4  5  6  7  8  9  10 11 12 13 14-20
Backend:   [P0][--P1 merge/sql/stats/tests--][--P3 fraud/CLI/anchor--][--P4 deploy--]
Frontend:  [-------------- P2 dashboard + auditor portal --------------][polish]
All:                                                                    [P5 rehearse/docs]
```

Buffer: Days 14–20 leave about a week for slippage. If time runs short, cut in this order: OpenTimestamps → AWS (demo from the laptop) → CLI → fraud ring. **Never cut** the UI pages in the demo script, merge, or the auditor portal.

---

## 3. Decisions I need from you

1. **Who builds what?** Should I implement everything here in order (backend first, then the UI)? Or should I split it the way HANDOFF suggests, with the frontend and backend tracks in separate sessions working in parallel?
2. **AWS deployment:** do it (Phase 4.3), or present from the laptop with a local Docker stack only?
3. **External anchoring:** GitHub repo file (recommended, instant) or OpenTimestamps (slow confirmations), or skip it?
4. **Scope:** do the 9 extra hardening items (G1–G9) go in, or HANDOFF items only?
