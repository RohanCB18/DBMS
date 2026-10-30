# Run Guide — start ZK-TemporalDB and walk through it

This guide gets the whole project running on your laptop, then walks you through every feature in
the dashboard. For each step it says **what to click**, **what you will see**, and **what is
happening behind the scenes**. Allow about 45 minutes the first time.

All commands are typed in **PowerShell**, starting from the project folder:

```
C:\Users\rohan\OneDrive\Desktop\cursorOP\DBMS_EL
```

---

## Part A — Start everything (5 minutes)

### A1. Start Docker Desktop
Open **Docker Desktop** from the Start menu and wait until it shows **"Engine running"**.

> **Why:** our three databases (PostgreSQL, MongoDB, Neo4j) run inside Docker *containers* — small
> isolated mini-computers. Docker Desktop is the engine that runs them. Without it, nothing can
> reach the databases.

### A2. Start the three databases
```bash
docker compose up -d postgres mongo neo4j
```
Wait about 30 seconds, then check they are healthy:
```bash
docker compose ps
```
All three should say `healthy`.

> **What happened:** Docker started three containers from `docker-compose.yml`:
>
> | Container | Database | Port on your laptop |
> |---|---|---|
> | `ztdb-postgres-1` | PostgreSQL — the bank's tables + version-control records | 5544 |
> | `ztdb-mongo-1` | MongoDB — KYC documents + all saved snapshots and proofs | 27018 |
> | `ztdb-neo4j-1` | Neo4j — the history graph and the money-flow graph | 7474 (browser), 7687 |
>
> The very first time PostgreSQL starts with an empty data folder, it automatically runs the three
> SQL files in `db/postgres/` — they create every table, trigger and stored procedure.
> The data lives in Docker *volumes*, so it survives restarts.

### A3. Start our three programs
```bash
powershell -ExecutionPolicy Bypass -File scripts\local\start.ps1
```
You should see lines like `zk-service is up on :7000`, `api is up on :8100`, `web is up on :8090`
(and "postgres/neo4j already running", because Docker already started those).

> **What happened:** three programs we wrote started in the background:
>
> | Program | Language | Port | Job |
> |---|---|---|---|
> | **zk-service** | Node.js | 7000 | The cryptography engine — builds Merkle trees and creates/checks zero-knowledge proofs |
> | **API** | Python (FastAPI) | 8100 | The brain — talks to all three databases and to zk-service |
> | **web** | React (Vite) | 8090 | The dashboard you click on in the browser |
>
> The website never talks to a database directly; it asks the API, and the API does the work.
> Logs are written to `.local\logs\` if anything goes wrong.

### A4. Open the dashboard
Go to **http://localhost:8090** in Chrome. You should see the **Overview** page.
Make the browser window wide (1280 px or more) — that is the size the layout is designed for.

---

## Part B — Walk through the project (30–40 minutes)

The left sidebar has 12 pages. Follow the order below: it tells the project's story.

> Buttons that overwrite data (Reset demo, Restore, switching branch, Freeze) first show a browser
> **confirmation box** — click **OK** to go ahead.

### Step 1 — Reset the demo (Overview page)
**Click:** **Reset demo** (top-middle box) → the browser asks *"Wipe all three databases and reload
the demo bank?"* → click **OK**.

**You will see:** after ~10 seconds, a toast message, then:
- **HEAD commit** — a 16-character id with the message "Initial import of ZTDB Bank…"
- **Merkle root** — a very long number
- **Anchor #1**
- Database counters at the bottom: PostgreSQL (6 branches, 41 customers, 54 accounts, 600
  transactions), MongoDB (41 KYC documents, 742 blobs), Neo4j (`:Commit 1`, `:Record 742` …)

**Behind the scenes:**
1. All three databases are wiped and a fake bank, "ZTDB Bank", is loaded: bank branches,
   customers, accounts and 600 past transactions in PostgreSQL, plus one KYC (identity document)
   per customer in MongoDB.
2. A **first commit** is made automatically. Every one of the 742 records is turned into a fixed
   text format, hashed, and all the hashes are combined into **one number — the Merkle root**.
   That number is the "fingerprint" of the entire database right now.
3. The root is written into an append-only **anchor log** in PostgreSQL (entry #1).
4. Neo4j gets one `Commit` node and one `Record` + `Version` node per record.

> Keep an eye on **transaction #100600**: a ₹2,50,000 property advance from Ananya Rao. Right now
> its status is **PENDING**. It is the "hero" record of the whole demo.

### Step 2 — Look at the live data (Live data page)
**Click:** **Live data** → try each tab: `transactions`, `accounts`, `customers`, `bank_branches`,
`kyc_documents`.

**You will see:** the current contents of the bank. The `kyc_documents` tab shows JSON documents
(with a nested `address`) — that is the MongoDB part. The others are PostgreSQL tables.
The newest transaction at the top is #100600, status PENDING.

### Step 3 — Run a business day, then commit (Overview page)
**Click:** **Run a business day**.

**You will see:** the **Uncommitted** line changes from "clean" to
"+20 added, ~32 modified, −0 deleted", a list of the day's events appears under the buttons, and
the **Activity since HEAD** list at the bottom fills with changes.

**Behind the scenes:** the API calls the bank's **stored procedures** in PostgreSQL, exactly as a
real banking app would:
- `sp_settle_txn(100600)` → moves ₹2,50,000 and marks #100600 **COMPLETED**
- `sp_transfer` creates 20 new transfers, 17 of them get settled
- `sp_reverse_txn` refunds one older transaction (a customer dispute)
- one account is **frozen**, and one customer's KYC is verified (in PostgreSQL *and* MongoDB)

Every row change fires an **audit trigger** that writes into `vcs.change_log` — that is the
activity list you see. These changes are **not a version yet** — like edited files before
`git commit`.

**Now:** type `End of business day 1` in the **commit message** box (left of the **Commit** button)
and click **Commit**.

**You will see:** a new HEAD commit and **Anchor #2**. The Uncommitted line is "clean" again.

**Behind the scenes:** a new snapshot. Only the ~52 changed or new records are stored as new
"blobs" in MongoDB; the other ~710 records are re-used from commit 1 (that is why the MongoDB
**dedup ratio** grows over time). A new Merkle root is computed and chained onto the anchor log.

### Step 4 — What changed? (Diff page)
**Click:** **Diff**. It opens with **v1** on the left and the newest commit (**v2**) on the right
already selected. (The right-hand list also has **WORKING (live database)** to see uncommitted changes.)

**You will see:** green = added records (the 20 new transfers), and modified records with
**old → new** per field. Find `transactions:100600` → `status: PENDING → COMPLETED`.

**Behind the scenes:** each commit is a list of "record → blob hash". Records whose hash is
different between the two commits are the changes; only those are opened and compared field by field.

### Step 5 — The history of one record (Record lineage page)
**Click:** **Record lineage** → click the example `transactions:100600`.

**You will see:** a timeline: *added* in v1, *modified* in v2.

**Behind the scenes:** this is a single **Neo4j graph query**:
`(Record)-[:HAS_VERSION]->(Version)-[:INTRODUCED_IN]->(Commit)`. Following links like this is what
graph databases are best at.

### Step 6 — Go back in time (Time travel page)
**Click:** **Time travel** → choose commit **v1** → table `transactions`.

**You will see:** the bank exactly as it was at v1 — #100600 is still **PENDING** there.
Nothing in the live database was changed; this is read-only.

### Step 7 — Ask questions about the past in SQL (SQL console page)
**Click:** **SQL console** → choose the example **Transactions by status** → run it "as of" **v1**,
then again as of **v2**.

**You will see:** v1 has exactly **1 PENDING** transaction (the hero); v2 has 3 and more COMPLETED.
Now type `DELETE FROM transactions` and run it → **refused**.

**Behind the scenes:** the snapshot of that commit is copied into its own PostgreSQL schema
(`snap_<commit id>`), and your query runs there as a special user `ztdb_reader` that is only
allowed to *read*, inside a read-only transaction with a 3-second time limit.

### Step 8 — Check nobody changed history (Verify page)
**Click:** **Verify** in the sidebar → choose **v2** in the list → click the **Verify** button.

**You will see:** four green checks:
1. Record content hashes (SHA-256)
2. Merkle leaves (Poseidon)
3. Merkle root vs commit record
4. Anchor hash chain (transparency log)

**Behind the scenes:** everything is recalculated from scratch and compared to what was saved at
commit time. If even one character of one old record had changed, a number would not match.

### Step 9 — Be the bad guy (Tamper lab page)
**Click:** **Edit a committed record in MongoDB**.

> You are now a dishonest insider: you go straight into MongoDB and change old transaction
> #100600 from ₹2,50,000 to ₹25,000 — no API, no app, just the database.

**Click:** **Verify HEAD now**.

**You will see:** checks 1 and 2 turn **red**, and the broken record is named:
`transactions:100600`. Checks 3 and 4 stay green.

**Click:** **Undo attacks**. Then **Rewrite a Merkle root in PostgreSQL** → **Verify HEAD now**.

**You will see:** the first attempt was **blocked by a trigger** ("history is append-only"). The
insider then disables the trigger and changes the root anyway — but checks 3 and 4 turn **red**,
because the anchor chain still holds the original root.

**Click:** **Undo attacks** again before continuing.

### Step 10 — Prove a fact without revealing data (Prove page)
**Click:** **Prove**. The form is pre-filled: commit = latest, table `transactions`,
primary key `100600`, field `status`, operator `=`, value `COMPLETED`.

Look at the right-hand box: **revealed** (only the claim) vs **stays hidden** (amount, accounts,
remarks, the salt, all other records).

**Click:** **Generate proof**.

**You will see:** in about 1–2 seconds, a **proof package** of ~720 bytes.

**Try also:** field `amount_paise`, operator `≥`, value `20000000` (= ₹2,00,000) → a proof that the
amount is at least ₹2 lakh **without revealing the amount**.
**And:** value `PENDING` with operator `=` → **error: no proof can exist**, because it is false.

**Behind the scenes:** the zk-service runs the Groth16 zero-knowledge prover (see
[HOW_IT_WORKS.md](HOW_IT_WORKS.md), part 7).

### Step 11 — Be the auditor (Auditor portal)
**Click:** **Open in auditor portal** (on the proof you just made). It opens a different-looking
page — "Independent Audit Office" — to represent another organisation.

**You will see:** three green checks and **VERIFIED**:
1. Groth16 proof is valid — checked **inside your browser**, no server involved
2. Proof is about exactly this claim
3. Root is anchored in the bank's transparency log

and a box **"What you learned"** (one fact) vs **"What stayed hidden"**.

**Click:** **Try to forge the claim** → change `COMPLETED` to `FAILED` → **Verify forged package**.
**You will see:** **REJECTED** — "mismatch: value". The proof cannot be re-used for a different claim.

### Step 12 — Branches and merging (Merge page + History page)
**Click:** **Merge** → **Clean merge (different records)**.
This creates a branch `audit-fix` that fixes customer 7's phone, while `main` moves customer 12 to Pune.
Now choose **audit-fix** in "merge … into main" → **Preview** → **Merge**.
→ merged automatically, because different records changed.

**Click:** **Conflict (same fields, PostgreSQL + MongoDB)** → choose **kyc-review** → **Preview**.
**You will see:** two **conflicts** — customer 7's phone (PostgreSQL) and KYC risk score (MongoDB)
were changed to *different* values on both sides. Pick **ours** or **theirs** for each → **Merge**.

**Click:** **History**. **You will see:** the commit graph, with lanes for branches and **merge
commits that have two parents**. Click any commit for actions (verify, diff, prove, restore).

**Behind the scenes:** the merge finds the last common commit of both branches (the "base", using a
**recursive SQL query**), then compares base / ours / theirs record by record and field by field.

### Step 13 — Catch money launderers (Fraud rings page)
**Click:** **Fraud rings** → **Search**.

**You will see:** a ring of 4 accounts passing ~₹2 lakh around in a circle within 108 minutes
(₹7.9 lakh total) — a classic money-laundering pattern called "layering".

**Behind the scenes:** the transactions are loaded into Neo4j as a graph of
`(Account)-[:SENT]->(Account)` and **one Cypher query** looks for cycles of 3–5 large transfers.
In SQL this would need many self-joins; in a graph database it is one pattern.

**Then:** **Freeze ring accounts** → **OK** → go to **Overview** → **Commit** → **Prove** with table
`accounts`, a ring account id, field `status`, value `FROZEN` — proof for the regulator that the
accounts were frozen, without showing balances.

---

## Part C — Look inside the databases yourself (optional, 10 minutes)

**Neo4j** — open **http://localhost:7474**, log in with `neo4j` / `ztdb-neo4j`, and run:
```cypher
MATCH p=(:Commit)-[:PARENT*]->(:Commit) RETURN p
```
(you will see the commit graph) and
```cypher
MATCH (r:Record {key:'transactions:100600'})-[:HAS_VERSION]->(v)-[:INTRODUCED_IN]->(c) RETURN r, v, c
```

**PostgreSQL** — open a SQL prompt inside the container:
```bash
docker compose exec postgres psql -U ztdb -d ztdb
```
then try (type `\q` to quit):
```sql
SELECT commit_id, message, record_count FROM vcs.v_commit_log;
SELECT seq, commit_id, left(prev_hash, 12), left(entry_hash, 12) FROM vcs.anchors;
SELECT * FROM vcs.fn_verify_anchor_chain();      -- empty = chain intact
\df bank.*                                       -- list the stored procedures
```

**MongoDB** — open a Mongo prompt inside the container:
```bash
docker compose exec mongo mongosh
```
then:
```js
use bank_live
db.kyc_documents.findOne()
use ztdb
db.blobs.findOne({ key: "transactions:100600" })
db.trees.findOne({}, { root: 1, created_at: 1 })
```

**API** — open **http://localhost:8100/docs**: every API endpoint, with a "Try it out" button.

**Command line** — the same features in a terminal:
```bash
cd api; .venv\Scripts\python cli.py status; cd ..
```
```bash
cd api; .venv\Scripts\python cli.py log; cd ..
```
```bash
cd api; .venv\Scripts\python cli.py verify main; cd ..
```

**Automatic check of everything** (runs the whole demo with 24 checks in ~1 minute;
it resets the data first):
```bash
cd api; .venv\Scripts\python scripts\demo_flow.py; cd ..
```

---

## Part D — Stop everything

Stop our three programs:
```bash
powershell -ExecutionPolicy Bypass -File scripts\local\stop.ps1
```
Stop the databases (data is kept):
```bash
docker compose stop
```
Next time, start again from **A1**. To wipe the databases completely (for example after changing
the SQL files), use `docker compose down -v` instead of `stop` — then click **Reset demo** after starting.

## If something goes wrong

| Problem | Fix |
|---|---|
| `error during connect … dockerDesktopLinuxEngine` | Docker Desktop is not running — step A1 |
| Docker Desktop crashes with "dockerInference" | Quit Docker, rename `%LOCALAPPDATA%\Docker\run` to `run_old`, restart it; turn off Settings → AI → Docker Model Runner |
| Dashboard shows network errors | The API is not running — run `start.ps1` again and look at `.local\logs\api.err.log` |
| "Generate proof" fails | zk-service is not running — check `.local\logs\zk.err.log` |
| SQL console says permission/role error | The database was created before `03_roles.sql` existed: `docker compose down -v`, `docker compose up -d postgres mongo neo4j`, then **Reset demo** |
| Merge scenario says "commit or discard the uncommitted changes first" | Go to Overview and **Commit** first |
