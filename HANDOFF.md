# HANDOFF — remaining work for ZK-TemporalDB

Read this first if you are continuing the project. It says what is done, what is left,
exactly how to build each remaining piece, and the traps already discovered.

**Timeline:** demo is ~20 days out (as of 18 Oct 2026). Suggested split for the two developers
is at the bottom; the third teammate (documentation / report / poster) should start from
[docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) and the demo script in section 3.

---

## 1. What is DONE (≈60%) — and verified

Run `python api/scripts/demo_flow.py` (with the stack running, see README) — it executes the
whole demo and checks 15 expectations. Last run: **all passed**.

| Area | Done | Where |
|---|---|---|
| ZK circuit | Groth16 circuit proving `field = / ≥ / ≤ value` for a record in a Poseidon Merkle tree (depth 13 → 8192 records, 8 fields per record), local trusted setup | `circuits/` |
| zk-service | Poseidon leaves/roots, Merkle paths, prove (~1.5–2 s), verify | `zk-service/src/` |
| PostgreSQL | 3NF bank schema, VCS schema, 6 triggers, 3 money procedures, commit procedure, recursive CTEs, views, anchor hash chain | `db/postgres/` |
| MongoDB | live KYC collection; content-addressed blobs, tree manifests, proof packages | `api/app/vcs.py`, `proofs.py` |
| Neo4j | commit DAG, record versions/lineage, proofs graph | `api/app/graph.py` |
| Version control | commit, status, log, diff (record + field level, also vs working DB), snapshot browsing, restore, branches, checkout | `api/app/vcs.py` |
| Integrity | 4-layer verify with record-level pinpointing, verification history table | `vcs.verify` |
| Proofs | ZK proof packages, auditor verification (proof + claim binding + anchored root), plain Merkle inclusion proof | `api/app/proofs.py` |
| Demo | seed bank (742 records), business day via stored procedures, two insider attacks + undo, reset | `api/app/demo.py` |
| API | FastAPI, Swagger at `/docs` | `api/app/main.py` |
| Docs | ER diagrams, normalisation, constraint/trigger catalogue, Mongo + Neo4j models | `docs/DATABASE_DESIGN.md` |

## 2. What is LEFT (≈40%)

Priority order — do them top-down; P1 items are needed for a good demo.

### P1-A. Web dashboard (`web/`) — biggest item, ~6–8 days

Stack: **React + Vite + TypeScript + Tailwind**, `@xyflow/react` for the commit graph,
`lucide-react` icons, `framer-motion` for transitions, `snarkjs` (browser build) for the auditor.
Talk to the API at `http://localhost:8100/api` in dev (CORS is open) and via an nginx `/api`
proxy in production.

Visual direction: dark theme, one accent colour (e.g. emerald for "verified", red for "tampered"),
monospace for hashes (show first 8 + last 4 chars with a copy button). Teachers watch this on a
projector — big fonts, few elements per screen, animate the important moments (verify turning red,
proof turning green).

Pages (each maps to existing endpoints):

| Page | Shows | Endpoints |
|---|---|---|
| **Overview** | current branch, HEAD commit, root, record counts per DB (Postgres / Mongo / Neo4j logos), uncommitted change count, buttons: *Business day*, *Commit*, *Reset demo* | `GET /status`, `POST /demo/business-day`, `POST /commit`, `POST /demo/reset` |
| **Live data** | tabs per table incl. `kyc_documents` (render nested JSON nicely); highlight rows changed since HEAD (keys from `/status`) | `GET /live/{table}`, `GET /status` |
| **History** | commit DAG (xyflow, vertical, branch labels, merge commits with 2 parents); click a commit → side panel with message, root, anchor seq/hash, added/modified/deleted counts, "Verify" and "Restore" buttons | `GET /graph/commits`, `GET /log`, `GET /anchors` |
| **Diff** | pick two commits (or WORKING); added (green) / deleted (red) / modified with per-field old → new | `GET /diff?a=&b=` |
| **Time travel** | pick a commit + table → paginated snapshot table; "Restore to this commit" | `GET /commits/{ref}/records`, `POST /restore` |
| **Record lineage** | search a key like `transactions:100600` → vertical timeline of versions (from Neo4j) with field diffs between consecutive versions and proof badges | `GET /graph/records/{key}` + `GET /diff` |
| **Verify** | 4 layer cards that animate one by one (OK = green, BAD = red + list of tampered record keys); verify history | `POST /verify/{ref}` |
| **Tamper lab** | 3 big buttons: *Edit a committed record in MongoDB*, *Rewrite a root in PostgreSQL*, *Undo attacks*; show the attack description and the trigger message `first_attempt_blocked_by_trigger` | `POST /demo/tamper` |
| **Prove** | form: commit, table, pk, field (dropdown filled from the snapshot record), operator (=, ≥, ≤), value → "Generate proof" (spinner ~2 s) → show claim text, proof size in bytes, proving time, *Download package (.json)* and *Open in auditor portal* | `POST /proofs`, `GET /proofs` |
| **Auditor portal** (`/audit`, separate minimal layout — "this is a different organisation") | drop a proof package JSON → verify **in the browser** with `snarkjs.groth16.verify(vkey, publicSignals, proof)` using `/zk/verification_key.json`; also re-encode the claim in the browser (see below) and check it equals `publicSignals[1..5]`; optionally call `POST /proofs/verify` for the anchor check. Show what the auditor *learned* (the one claim) vs what stayed hidden (greyed-out list: other fields, other 741 records) | local + `POST /proofs/verify` |

**Browser claim encoding** — port `encodeValue` from `zk-service/src/crypto.js` to
`web/src/lib/zk.ts` *exactly*:
- non-negative integer < 2^64 → `BigInt(n)`
- string → `BigInt('0x' + sha256('s:' + str)) >> 8n` (use `crypto.subtle.digest('SHA-256', …)`)
- null → `sha256('null:') >> 8`, boolean → `sha256('b:true'|'b:false') >> 8`
- `publicSignals` = `[root, enc(table), enc(pk), enc(field), op(0=eq,1=gte,2=lte), enc(value)]`

Test: the browser must accept a package from `POST /proofs` and reject it after editing `claim.value`.

Production build: add `web/Dockerfile` (node build stage → `nginx:alpine`, `nginx.conf` with
`location /api/ { proxy_pass http://api:8000; }`), then un-comment the `web` service in
`docker-compose.yml` (port 8090 — 8080 is taken on Rohan's laptop).

### P1-B. Three-way merge — ~1.5 days

Add `vcs.merge(source_branch, resolutions: dict[key, "ours"|"theirs"] | None)` and
`POST /api/merge {source, resolutions?}`.

1. `ours = head(conn)["commit"]`, `theirs = resolve(source)`, `base = SELECT vcs.fn_merge_base(ours, theirs)`.
2. If `base == theirs` → "already up to date". If `base == ours` → fast-forward (restore theirs, move branch head; no new commit).
3. Load the three manifests as `key → blob` maps. For each key in the union:
   - `o == t` → take it; `o == b` → take `t`; `t == b` → take `o`;
   - otherwise do a **field-level** three-way merge on `unfold(blob)` dicts with the same rule per field;
     a field changed differently on both sides is a **conflict** (also: deleted on one side, modified on the other).
4. If conflicts and no resolution for them → return HTTP 409 with `[{key, field, base, ours, theirs}]` (UI shows a resolver).
5. Write the merged state to the live DBs (reuse the body of `restore` — refactor it into
   `_write_live(records_by_table)`), then create a commit with **two parents**:
   `sp_record_commit` already accepts `p_parents` as an array → pass `[ours, theirs]`.
   Update `vcs.commit()` to accept an optional `extra_parent`. Neo4j will draw both `PARENT` edges automatically.
6. Demo idea: branch `audit-fix` from v2, correct a customer's phone there; on `main` run a business day;
   merge → clean merge; then create a deliberate conflict on the same field.

Note the business rule trigger: merging may move a txn status "backwards" — writing through the
restore path (`SET LOCAL ztdb.restoring = 'on'`) bypasses it, which is correct for history operations.

### P1-C. Time-travel SQL console — ~1 day

`POST /api/sql {ref, query}` → run a read-only `SELECT` against a historical commit.

1. Materialise once per commit: `CREATE SCHEMA snap_<commit_id>`; for each SQL table
   `CREATE TABLE snap_x.t (LIKE bank.t)` (no constraints) and bulk insert the snapshot rows
   (same data path as `restore`). Cache: skip if the schema exists. Optionally drop old snapshot schemas (LRU of 5).
2. Execute in a separate connection: `BEGIN READ ONLY; SET LOCAL statement_timeout = '3s';
   SET LOCAL search_path = snap_x;` then the user query; `fetchmany(500)`; `ROLLBACK`.
3. Reject anything that is not a single `SELECT`/`WITH` statement (basic check + READ ONLY transaction
   + ideally a dedicated role with `SELECT` only on `snap_*` — create it in a new `03_roles.sql`).
4. UI: SQL editor + "as of" commit picker + result grid. Demo query:
   `SELECT status, count(*), sum(amount_paise)/100 AS inr FROM transactions GROUP BY status;` on v1 vs v2.

### P2-A. Neo4j money-flow graph & fraud ring — ~1 day

Shows Neo4j for *business* analytics, not just history.
1. In `demo._seed_rows`, plant a ring: 3–4 accounts sending similar amounts A→B→C→A within a few hours.
2. `graph.sync_money_flow(commit_id)`: from the commit snapshot create `(:Account {id, commit})`
   and `(:Account)-[:SENT {txn_id, amount, status}]->(:Account)` (label nodes per commit, or keep only HEAD).
3. Queries + endpoint `GET /api/graph/fraud-rings?ref=`:
   ```cypher
   MATCH p=(a:Account)-[:SENT*3..5]->(a) WHERE all(r IN relationships(p) WHERE r.status='COMPLETED')
   RETURN [n IN nodes(p) | n.id] AS ring, reduce(s=0, r IN relationships(p) | s + r.amount) AS total LIMIT 10
   ```
4. Then a ZK proof that "account X was FROZEN at commit C" closes the story.

### P2-B. CLI `ztdb` — ~0.5 day

`api/cli.py` with **Typer** wrapping the API: `ztdb status | commit -m | log | diff A B | branch NAME |
checkout NAME | restore REF | verify REF | prove --ref --table --pk --field --op --value -o proof.json |
audit proof.json`. Coloured output with `rich`. Looks great in a terminal next to the UI.

### P2-C. External anchoring — ~0.5–1 day

The anchor chain protects against editing one row, but a DBA could rewrite the *whole* chain.
Publish the latest `entry_hash` somewhere outside our control after every commit:
simplest = append to a public GitHub gist / repo file via the GitHub API (token in env var), or
OpenTimestamps (`opentimestamps-client`, anchors in Bitcoin). Show "externally anchored ✓" in the
auditor portal. Keep it optional (env flag) so the demo works offline.

### P3. Deployment on AWS — ~1–2 days (do last)

Recommended: **one EC2 instance** (t3.large, 8 GB RAM — Neo4j + proving need memory; Ubuntu 24.04),
Docker + Compose, the same `docker-compose.yml` + a **Caddy** container for HTTPS
(`your-domain { reverse_proxy web:80 }`). Security group: 80/443 only; do **not** expose 5544/27018/7687.
Move passwords to an `.env` file (compose `env_file`). Managed alternatives (RDS for Postgres,
DocumentDB, Neo4j Aura) are possible but cost more and add networking work — not worth it for the demo.

### P3. Tests & polish

* `pytest` unit tests for `canonical.py` (canonical form, fold/unfold, blob id stability) and `vcs._changes` / diff.
* Keep `scripts/demo_flow.py` as the integration test; run it before every rehearsal.
* `GET /api/stats` for the overview page (counts per DB, total blobs vs. records → dedup ratio, proofs issued).

## 3. Demo script for the presentation (~10 min)

1. *Reset demo* → explain the three DBs and that 742 records were just fingerprinted into one Merkle root.
2. *Business day* → stored procedures settle txn **#100600** (₹2,50,000 property advance) PENDING→COMPLETED,
   new transfers, one reversal, an account frozen, a KYC doc verified in MongoDB. *Commit*.
3. **Diff** v1 → v2, **Lineage** of `transactions:100600` (Neo4j), **Time travel** to v1.
4. **Verify** v2 → all green. **Tamper lab** → edit #100600 in MongoDB (₹2,50,000 → ₹25,000) →
   verify → red, pinpointed. Then root rewrite in Postgres → trigger blocks it → attacker disables trigger →
   anchor chain catches it. Undo.
5. **Prove** "txn 100600 status = COMPLETED in v2" and "amount ≥ ₹2,00,000" → open **Auditor portal**
   in another window → green. Edit the claim to FAILED → red. Try to prove PENDING → impossible.
6. Close: "trust us" → "here's mathematical proof", with privacy.

## 4. Gotchas already hit (read before debugging!)

* **Avast HTTPS scanning breaks `docker compose build`** on Rohan's laptop (pip/npm inside containers fail with
  `CERTIFICATE_VERIFY_FAILED`, issuer "Avast Web/Mail Shield Root"). Either disable Avast → Web Shield →
  HTTPS scanning, or run API and zk-service natively (README quick start). Do not commit `--trusted-host` hacks.
* **Docker Desktop crash "initializing Inference manager … dockerInference"**: quit Docker, rename
  `%LOCALAPPDATA%\Docker\run` to `run_old`, restart. Disable Settings → AI → Docker Model Runner.
* **Ports** were moved to avoid local clashes: Postgres **5544**, Mongo **27018**, API **8100**, web **8090**.
* The SQL files in `db/postgres` only run on a **fresh** volume. After changing them:
  `docker compose down -v` (wipes data) then `up`, then `POST /api/demo/reset`.
* PowerShell 5 `Set-Content -Encoding utf8` writes a BOM and mangles non-ASCII — edit files in your editor.
* Postgres `CHAR(16)` commit ids come back space-padded in some queries — the code `.strip()`s them; keep doing that.
* Neo4j: after `WITH … collect()` you cannot `ORDER BY` a pre-aggregation variable — order by the alias.
* Changing the circuit (depth, fields) requires `cd circuits && npm install && npm run build`
  (regenerates wasm/zkey/vkey into `zk-service/artifacts` and `web/public/zk`), restarting zk-service,
  and a demo reset (old proofs become invalid). Keep `DEPTH`/`NFIELDS` in `crypto.js` in sync with the circuit.

## 5. Known limitations (be ready for viva questions)

* Capacity 8192 records per commit (Merkle depth 13); raise `DEPTH` → bigger ptau (`POWER` in build.mjs).
* Trusted setup is single-party local — fine for a demo; production uses a public multi-party ceremony
  (or a transparent system like PLONK/STARKs).
* Max 8 provable fields per record; extra fields are folded into `~rest` (hashed together, not individually provable).
* Restore rewrites the whole live DB (fine at this size; production would apply a diff).
* Mongo and Postgres writes are not one distributed transaction — Postgres is the source of truth and
  orphaned Mongo blobs are harmless (could add a GC job).
* Salted leaves hide low-entropy fields; the salt is stored with the blob, so whoever controls the blob store
  can always open the commitment (that is intended — they are the data owner).

## 6. Suggested split (2 developers)

| Dev A (frontend) | Dev B (backend) |
|---|---|
| Days 1–2: Vite scaffold, layout, Overview, Live data | Days 1–2: merge (P1-B) + tests |
| Days 3–5: History graph, Diff, Lineage, Verify, Tamper lab | Days 3–4: SQL console (P1-C) |
| Days 6–8: Prove page + Auditor portal (browser verification) | Days 5–6: fraud ring (P2-A), CLI (P2-B) |
| Days 9–10: polish, animations, projector test | Days 7–8: external anchoring, `/api/stats`, web Dockerfile + nginx |
| — | Days 9–11: AWS deployment |
| Days 12+: rehearsals together, fix bugs, record a backup demo video | |
