# How ZK-TemporalDB Works — explained from zero

This document explains the whole project in simple words, in the order it was built. Read it
once from top to bottom before reading the code; section 13 tells you which file to open for
each idea. To see each idea working, follow [RUN_GUIDE.md](RUN_GUIDE.md) alongside it.

---

## Contents
1. The problem and the one-line idea
2. The big picture: five parts, three databases
3. The bank (PostgreSQL): the data being versioned
4. Tracking changes: the change log
5. Hashing: the building block
6. Committing: taking a snapshot
7. Zero-knowledge proofs: proving without showing
8. Reading history: log, diff, time travel, lineage, SQL console
9. Branches, restore and merge
10. Tamper detection: catching a dishonest insider
11. Neo4j: the history graph and fraud rings
12. The dashboard, CLI and tests
13. Where each idea lives in the code (reading order for tomorrow)
14. DBMS concepts checklist (for the teachers)
15. Limits and likely viva questions

---

## 1. The problem and the one-line idea

A bank changes its database thousands of times a day. Months later an auditor asks:
*"Was transaction #100600 really COMPLETED on 1 October?"*

Today the bank can only say **"trust us"** and show a backup — but a backup can be edited, and
showing it reveals every other customer's data too.

**ZK-TemporalDB** gives the bank two powers:

1. **Verifiable history** — like Git, it saves versions ("commits") of the database. Each commit
   gets a mathematical fingerprint. If anyone edits old data later, the fingerprint no longer
   matches and the edit is caught.
2. **Private proof** — the bank can prove one fact about an old version ("#100600 was COMPLETED")
   to an outsider **without showing anything else**, using a *zero-knowledge proof*.

> **One line:** *Git for databases, with cryptographic proof* — "trust us" becomes "here is mathematical proof", while protecting privacy.

---

## 2. The big picture: five parts, three databases

```
                     Web dashboard + auditor portal  (React, port 8090)
                                    │   asks
                                    ▼
                     API  (Python FastAPI, port 8100)  ── the brain
          ┌──────────────┬──────────┴──────────┬─────────────────────┐
          ▼              ▼                     ▼                     ▼
     PostgreSQL       MongoDB               Neo4j              zk-service (Node, port 7000)
     (port 5544)      (port 27018)          (port 7687)        the cryptography engine
```

| Part | What it does | Analogy |
|---|---|---|
| **PostgreSQL** | Holds the live bank tables **and** the version-control records (commits, branches, the anchor log) | The bank's ledger + the official register of versions |
| **MongoDB** | Holds live KYC documents **and** the saved contents of every version, plus proof files | The archive room |
| **Neo4j** | Holds the *history as a graph*: which commit came from which, which record changed where, and money flowing between accounts | The family tree / map of connections |
| **zk-service** | Computes the special hashes, the Merkle trees and the zero-knowledge proofs | The notary with a maths degree |
| **API** | Receives every request and coordinates the four parts above | The manager |
| **Web dashboard** | Buttons and screens for everything | The front desk |

Why three databases? Each does the job it is best at — tables and transactions (SQL),
flexible documents and file-like storage (NoSQL), connections and paths (graph). Section 14
lists the DBMS concepts each one demonstrates.

---

## 3. The bank (PostgreSQL): the data being versioned

We needed realistic data to version, so we built a small bank called **ZTDB Bank**.

### 3.1 Tables (schema `bank`)

```
bank_branches (branch_code, branch_name, city, ifsc)
customers     (customer_id, full_name, email, phone, city, kyc_status, created_at)
accounts      (account_id, customer_id → customers, branch_code → bank_branches,
               account_type, balance_paise, status, opened_at)
transactions  (txn_id, from_account → accounts, to_account → accounts,
               amount_paise, status, channel, created_at, remarks)
```

* **Money is stored in paise** (₹1 = 100 paise) as whole numbers, so there are no decimal
  rounding errors. ₹2,50,000 = `25000000`.
* **Normalised to 3NF**: a transaction does not store the customer's name or branch city — it
  stores only the account number, and you *join* to find the rest. That avoids the same fact being
  stored twice (and getting out of sync). Full analysis: [DATABASE_DESIGN.md](DATABASE_DESIGN.md).
* **Constraints** guard the data: a balance can never go negative (`CHECK balance_paise >= 0`),
  an amount must be positive, a status must be one of a fixed list, foreign keys must point to real rows.

### 3.2 Stored procedures (how money moves)

The bank never updates balances by hand. It calls procedures that live inside PostgreSQL:

| Procedure | What it does |
|---|---|
| `sp_transfer(from, to, amount, …)` | creates a new **PENDING** transaction |
| `sp_settle_txn(id)` | locks both accounts, checks funds, moves the money, marks **COMPLETED** (or **FAILED** if there isn't enough money) — all in one atomic transaction |
| `sp_reverse_txn(id)` | refunds a COMPLETED transaction → **REVERSED** |

### 3.3 A business-rule trigger

`trg_txn_state_machine` runs before every update of a transaction and only allows
PENDING → COMPLETED/FAILED and COMPLETED → REVERSED. Changing an amount or going backwards is refused.

### 3.4 The KYC documents (MongoDB)

Each customer also has a KYC (identity-check) document in MongoDB, collection
`bank_live.kyc_documents`:

```json
{ "_id": "KYC-0007", "customer_id": 7, "doc_type": "PAN", "verified": true,
  "address": { "city": "Mumbai", "pincode": "400123" }, "risk_score": 31 }
```

It is flexible JSON (note the nested `address`) — a natural fit for a document database. Our
version control treats these documents **exactly like SQL rows**: one commit captures both.

### 3.5 The seed data

`Reset demo` loads 6 branches, 41 customers, 54 accounts, 600 transactions and 41 KYC documents
— **742 records** in total. Two of them are planted on purpose:
* **#100600** — the "hero": a ₹2,50,000 property advance from Ananya Rao, **PENDING** at first.
* **#100590–#100593** — a hidden fraud ring (section 11).

---

## 4. Tracking changes: the change log

Every insert, update or delete on a bank table fires an **audit trigger** (`vcs.fn_audit_row`)
that writes a row into `vcs.change_log`: which table, which row, old value, new value, time.

This is the project's **"git status"**: it shows what changed since the last commit. It is *not*
a version — when you commit, the log is cleared.

> **Important:** a version is created only when someone **commits**, not on every change —
> exactly like Git. A "business day" may make 50 changes; one commit at the end captures the
> state after all of them.

---

## 5. Hashing: the building block

A **hash function** turns any data into a fixed-size number — its fingerprint.

```
"status=COMPLETED"  ──hash──►  9f86d081884c7d65…
"status=COMPLETEd"  ──hash──►  1b4f0e9851971998…   ← one letter changed, totally different
```

Three properties make it useful:
1. **Same input → always the same output.**
2. **Tiny change → completely different output.**
3. **One-way:** you cannot get the input back from the output, and you cannot find another input
   with the same output.

We use two hash functions:

| Hash | Where | Why |
|---|---|---|
| **SHA-256** | naming stored record versions ("blobs"), the anchor log | the standard, fast, used by Git and Bitcoin |
| **Poseidon** | the Merkle tree | designed to be cheap inside zero-knowledge proofs (~240 steps instead of ~27,000 for SHA-256) |

---

## 6. Committing: taking a snapshot

When you click **Commit**, the API (`vcs.commit` in `api/app/vcs.py`) does these steps.

### Step 6.1 — Read every record and write it in one fixed format ("canonical form")
Every row from the four PostgreSQL tables and every MongoDB document becomes a *record*:

```json
{ "table": "transactions", "pk": 100600,
  "fields": [["amount_paise", 25000000], ["channel", "NEFT"], ["created_at", "2026-10-01T10:00:00.000000Z"],
             ["from_account", 5001000001], ["remarks", "Property advance…"], ["status", "COMPLETED"],
             ["to_account", 5001000054]] }
```

Fields are sorted by name, dates are written in one standard format (UTC), etc. — so the same data
**always** produces exactly the same text, and therefore the same hash. (`api/app/canonical.py`)

### Step 6.2 — Store each record version once, named by its hash ("content addressing")
Each record's SHA-256 hash becomes its **blob id**. Blobs are saved in MongoDB (`ztdb.blobs`).
If a record didn't change since the last commit, its hash is the same, so the existing blob is
re-used — nothing new is stored. This is how Git stores files too.

> After a business day, a commit stores only ~50 new blobs, not 760. The dashboard's **dedup ratio**
> (e.g. ×8) shows how many record-versions are shared.

Each blob also gets a **random secret number, the salt** (248 bits), created once. It is mixed into
the record's hash in the next step so that nobody can guess a record's contents by trying values.

### Step 6.3 — Build the Merkle tree → one root
Each record becomes a **leaf** (a Poseidon hash of the table, primary key, its fields and its salt).
Then leaves are hashed **in pairs**, those results in pairs, and so on, until one number is left —
the **Merkle root**:

```
                     ROOT = H(H12, H34)              ← one number = fingerprint of the whole DB
                    /                  \
            H12 = H(L1, L2)       H34 = H(L3, L4)
             /        \            /        \
          L1          L2         L3          L4       ← one leaf per record
        txn 1       txn 2      txn 3       txn 4
```

If **any** record changes, its leaf changes, which changes its parent, and so on up — the root
changes. So **one root number vouches for all 742+ records at once**.

Our tree is 13 levels deep, which fits up to 2¹³ = **8192 records**. (Built by `zk-service`,
`src/crypto.js`.)

### Step 6.4 — Save the manifest (MongoDB)
The commit's "table of contents" — every record key, its blob id and its leaf — is saved in
`ztdb.trees`. This is like a Git *tree* object.

### Step 6.5 — Record the commit atomically (PostgreSQL stored procedure)
`vcs.sp_record_commit(...)` does, in **one** transaction (all or nothing):
1. insert the commit row (id, branch, Merkle root, message, author, time) into `vcs.commits`
2. insert its parent link(s) into `vcs.commit_parents` (two parents for a merge)
3. append an entry to the **anchor log** (step 6.6)
4. move the branch to point at the new commit
5. clear the change log

### Step 6.6 — The anchor log: a mini blockchain
`vcs.anchors` is an append-only list. Each entry stores the commit's root **and a hash of the
previous entry**:

```
#1: root₁, prev = 000…0,   hash₁ = SHA-256(000…0 | commit₁ | root₁ | time₁)
#2: root₂, prev = hash₁,   hash₂ = SHA-256(hash₁  | commit₂ | root₂ | time₂)
#3: root₃, prev = hash₂,   hash₃ = SHA-256(hash₂  | commit₃ | root₃ | time₃)
```

A trigger (`trg_anchor_chain`) computes these hashes automatically. Changing an old entry breaks
every link after it. Other triggers (`fn_forbid_rewrite`) refuse any UPDATE or DELETE on commits,
parents and anchors — history is **append-only**.

*Optional extra (`api/app/anchoring.py`):* each anchor hash can also be published **outside** the
bank — to a file or a public GitHub repository — so that even someone who controls the whole
database cannot rewrite the chain unnoticed.

### Step 6.7 — Update the history graph (Neo4j)
A `Commit` node is created and linked to its parent; for each changed record a `Version` node is
linked to its `Record` and to this commit. (`api/app/graph.py`)

**Result:** the commit is identified by a 16-character id, has a Merkle root, an anchor number,
and the old version is still fully readable later.

---

## 7. Zero-knowledge proofs: proving without showing

### 7.1 What we want
The bank wants to convince an auditor:
*"In commit v2, transaction #100600 has status = COMPLETED"*
— and the auditor should learn **nothing else**: not the amount, not the accounts, not the
other 741 records.

The auditor already trusts one number: the **Merkle root of v2** (it is in the anchor log).

### 7.2 The claim, written as maths (the circuit)
In `circuits/record_claim.circom` we wrote the claim as a set of conditions:

1. "I know a record (all fields + salt) that hashes to some leaf"
2. "Hashing that leaf up the tree with 13 secret neighbour hashes gives **the root**"
3. "One of its fields is named **status**"
4. "That field's value **= COMPLETED**" (or **≥** / **≤** a number, for range claims)

| Public — the auditor sees these 6 numbers | Private — never leaves the bank |
|---|---|
| root, table, primary key, field name, operator, claimed value | all field values, the salt, the 13 neighbour hashes (= all other records), which field position |

### 7.3 Turning it into equations (R1CS)
The proof system only understands equations of the form **a × b = c**. The Circom compiler chops
our conditions into **12,531** such tiny equations. If someone knows values that satisfy all of
them, the claim is true.

> Tiny example: to prove you know x with x³ + x + 5 = 35 (x = 3), you write
> `x × x = a`, `a × x = b`, `(b + x + 5) × 1 = 35`. Our circuit is the same idea, 12,531 lines long.

### 7.4 Locking the numbers (elliptic curves)
We need to prove "I satisfy all 12,531 equations" **without showing the values**. An *elliptic
curve* (ours is called BN254) acts like a **lock for numbers**:
* locking a number is easy, unlocking it is practically impossible;
* you can still do some maths on locked numbers;
* a special checker, the **pairing**, can confirm "locked a × locked b = locked c" without unlocking.

### 7.5 Groth16: the recipe
**Groth16** (published in 2016) uses those locks to squash the 12,531 checks into **one check on
three locked numbers**:

1. **Trusted setup** (done once, `circuits/build.mjs`): a secret random value is used to create a
   **proving key** (for the bank) and a **verification key** (public, 4 KB), then destroyed.
2. **Prove** (`zk-service`, ~1–2 s): the bank plugs in its secret data, adds random "noise" so
   nothing leaks, and gets **3 locked numbers (A, B, C)** — the proof, about 720 bytes.
   *If the claim is false, no values satisfy the equations, so no proof can be produced at all*
   — that is the "no proof can exist" error.
3. **Verify** (~10–300 ms, even in a browser): one pairing equation with A, B, C, the 6 public
   numbers and the verification key → **true** or **false**.

### 7.6 What the auditor checks (`proofs.verify_package`, auditor portal)
1. **The Groth16 proof is valid** — pure maths, done in the browser.
2. **The proof is about exactly the stated claim** — the auditor re-encodes "transactions",
   "100600", "status", "COMPLETED" into numbers and checks they equal the proof's public inputs.
   (That is why changing the claim to "FAILED" is rejected.)
3. **The root is the one anchored for that commit** — so the bank could not use a made-up database.

### 7.7 The word "zk-SNARK"
**Z**ero-**K**nowledge (reveals nothing else) · **S**uccinct (tiny, fast to check) ·
**N**on-interactive (one file, no back-and-forth) · **AR**gument of **K**nowledge (the prover
must really know the data).

### 7.8 Comparison: a plain Merkle proof
`POST /api/inclusion` gives an ordinary Merkle proof: the full record + the 13 neighbour hashes.
It also proves the record is in the commit — but **reveals the whole record**. The ZK proof reveals
only the one claim. Showing both side by side explains why ZK matters.

---

## 8. Reading history

| Feature | How it works | Page |
|---|---|---|
| **Log** | list of commits; following parent links uses a **recursive SQL query** (`vcs.fn_ancestors`) | History |
| **Diff** | compare two manifests: records whose blob id differs changed; only those are opened and compared field by field. Can also compare a commit with the live database (`WORKING`) | Diff |
| **Time travel** | read a commit's manifest and blobs → show the old data. Read-only | Time travel |
| **Record lineage** | a Neo4j path query: `(Record)-[:HAS_VERSION]->(Version)-[:INTRODUCED_IN]->(Commit)` | Record lineage |
| **SQL console** | the commit's data is copied into its own PostgreSQL schema `snap_<commit>` (the last 5 are kept); your `SELECT` runs there as the read-only user `ztdb_reader`, inside a READ ONLY transaction with a 3-second limit and at most 500 rows | SQL console |

---

## 9. Branches, restore and merge

* **Branch** — a name pointing to a commit (`vcs.branches`). `main` is the default.
  `vcs.head` stores which branch the live database is currently on.
* **Restore** — write a commit's records back into the live tables and MongoDB. It runs with a
  special setting (`ztdb.restoring`) that tells the audit and state-machine triggers to stand aside,
  because restoring history is allowed to "go backwards".
* **Checkout** — switch to another branch = restore that branch's latest commit.

### Three-way merge (`api/app/merge.py`)
Two branches went different ways; we want to combine them.

1. Find the **base** — the last commit both branches share (`vcs.fn_merge_base`, recursive SQL).
2. For every record, and inside it every field, compare **base**, **ours** (current branch) and
   **theirs** (the other branch):

| Situation | Result |
|---|---|
| ours = theirs | keep it |
| ours = base (only they changed it) | take **theirs** |
| theirs = base (only we changed it) | keep **ours** |
| both changed it differently | **conflict** — you choose ours or theirs |

3. Write the merged data, then make a **merge commit with two parents**.

Example (Merge page): branch `kyc-review` sets customer 7's phone to one number and KYC risk score
to 95; `main` sets a different phone and risk 3 → two conflicts, one in PostgreSQL and one in MongoDB.

---

## 10. Tamper detection: catching a dishonest insider

**Verify** (`vcs.verify`) recalculates everything and checks four independent layers:

| Layer | Check | Catches |
|---|---|---|
| 1. Record content hashes | each stored blob still hashes (SHA-256) to its own id | someone edited an old record in MongoDB |
| 2. Merkle leaves | each record + salt still gives the saved Poseidon leaf | same, and edited salts/leaves |
| 3. Merkle root | rebuilding the tree from the leaves gives the root saved in PostgreSQL | someone changed the manifest or the commit's root |
| 4. Anchor chain | every anchor entry links to the previous one, and holds the same root as the commit | someone rewrote a root even with triggers disabled |

The broken **record is named** (e.g. `transactions:100600`), and every verify run is saved in
`vcs.verification_runs`.

**The two attacks in the Tamper lab:**
1. *Edit #100600 in MongoDB* (₹2,50,000 → ₹25,000) → layers 1 and 2 fail and point at the record.
2. *Rewrite a root in PostgreSQL* → the first attempt is **blocked by a trigger**; the insider then
   disables the trigger and does it anyway → layers 3 and 4 fail, because the anchor chain kept
   the original.

---

## 11. Neo4j: the history graph and fraud rings

**History graph** (`api/app/graph.py`):

```
(:Branch)-[:HEAD]->(:Commit)-[:PARENT]->(:Commit)
(:Record)-[:HAS_VERSION]->(:Version)-[:INTRODUCED_IN]->(:Commit)
(:Proof)-[:ABOUT]->(:Version),  (:Proof)-[:AGAINST]->(:Commit)
```

Questions like "every version of this record", "what did this commit change", "all proofs ever
issued about this record" are each one graph pattern.

**Fraud rings** (`api/app/analytics.py`): the transactions of a commit are loaded as a money-flow
graph `(:Account)-[:SENT {amount, time}]->(:Account)`. One Cypher query looks for **cycles of
3–5 large completed transfers within a few hours** — money going round in a circle to hide its
origin ("layering"). The seed data hides a ring of 4 accounts moving about ₹2 lakh each hop
(₹7.9 lakh in 108 minutes). In SQL this needs many self-joins; in a graph DB it is one pattern.
After finding it you can **freeze** the accounts, commit, and prove "account … status = FROZEN"
to a regulator.

---

## 12. The dashboard, CLI and tests

* **Web dashboard** (`web/`, React + TypeScript + Tailwind): 12 pages — Overview, Live data,
  History (commit graph), Diff, Time travel, Record lineage, Verify, Tamper lab, Prove, Merge,
  SQL console, Fraud rings — plus the **Auditor portal** (`/audit`), which verifies proofs **in the
  browser** with the `snarkjs` library and the public verification key. `web/src/lib/zk.ts`
  re-implements the claim encoding so the browser does not have to trust the server.
* **CLI** (`api/cli.py`): the same features in a terminal — `status`, `commit -m`, `log`, `diff`,
  `branch`, `checkout`, `restore`, `merge`, `verify`, `prove`, `audit`, `sql`, `rings`, `stats`.
* **Tests:** 35 Python unit tests (`api/tests/`), 14 browser-encoding tests (`web/`), the circuit
  self-test (`zk-service/test/`), and `api/scripts/demo_flow.py` — the full demo with 24 checks.
  GitHub Actions (`.github/workflows/ci.yml`) runs them on every push.
* **Safety:** commit/restore/merge take a database lock so two can't run at once; demo buttons
  can be switched off or protected with a token (`.env`).

---

## 13. Where each idea lives in the code (reading order for tomorrow)

Read in this order — each file builds on the previous ones.

| # | File | What to look for |
|---|---|---|
| 1 | `db/postgres/01_bank_schema.sql` | bank tables, constraints, the state-machine trigger, the 3 money procedures |
| 2 | `db/postgres/02_vcs_schema.sql` | commits, parents, branches, anchors, change log; immutability triggers; anchor chain; recursive CTEs |
| 3 | `api/app/canonical.py` | how a row/document becomes a canonical record; `blob_id` |
| 4 | `zk-service/src/crypto.js` | value encoding, Poseidon leaf, Merkle tree, Merkle path |
| 5 | `api/app/vcs.py` | `commit`, `status`, `diff`, `restore`, `verify` — the heart of the project |
| 6 | `api/app/graph.py` | the Neo4j model and queries |
| 7 | `circuits/record_claim.circom` | the zero-knowledge circuit (read the comments) |
| 8 | `zk-service/src/server.js` | `/prove` and `/verify` |
| 9 | `api/app/proofs.py` | proof packages and the auditor's three checks |
| 10 | `api/app/merge.py`, `sqlconsole.py`, `analytics.py`, `anchoring.py` | the advanced features |
| 11 | `api/app/demo.py` | seed data, business day, attacks |
| 12 | `api/app/main.py` | the list of API routes (the "menu") |
| 13 | `web/src/pages/*.tsx` | one file per dashboard page; `web/src/lib/zk.ts` for in-browser checking |
| 14 | `api/scripts/demo_flow.py` | the whole story as a script — great for understanding the order |

---

## 14. DBMS concepts checklist (for the teachers)

| Concept | Where |
|---|---|
| ER modelling, keys, relationships | `docs/DATABASE_DESIGN.md` diagrams |
| Normalisation (1NF → 3NF/BCNF) | bank schema; `commit_parents` as a separate table |
| PK / FK / UNIQUE / CHECK constraints | both SQL schema files |
| Indexes | `idx_txn_from`, `idx_txn_status`, … |
| Triggers | state machine, audit log, immutability, anchor hash chain |
| Stored procedures / functions | `sp_transfer`, `sp_settle_txn`, `sp_reverse_txn`, `sp_record_commit` |
| ACID transactions, row locking (`FOR UPDATE`), deadlock avoidance | `sp_settle_txn`, commit procedure |
| Views | `bank.v_account_summary`, `vcs.v_commit_log` |
| Recursive CTEs | `fn_ancestors` (log), `fn_merge_base` (merge) |
| Window functions | `LAG` in `fn_verify_anchor_chain` |
| Roles & privileges (least privilege) | `ztdb_reader` in `03_roles.sql` |
| NoSQL documents, nested data, content addressing | KYC documents; `blobs` / `trees` / `proofs` |
| Graph model, Cypher, path queries | history graph; fraud-ring detection |
| Polyglot persistence & cross-DB consistency | PostgreSQL is the source of truth; see DATABASE_DESIGN §6 |
| Temporal databases / versioning | the whole project |
| Data integrity & security | Merkle trees, anchor chain, verify, zero-knowledge proofs |

---

## 15. Limits and likely viva questions

**"Is every change a version?"** No — versions are made when you commit (like Git). Every change is
*tracked* in the change log, and commits can be made as often as needed (e.g. end of each day).

**"How is this different from a backup / Supabase / point-in-time recovery?"** Those restore old
data. We also *prove* old data is untouched (Merkle roots + anchor chain) and can prove single facts
privately (zero-knowledge).

**"Can the bank fake a proof?"** Only by breaking elliptic-curve cryptography or knowing the deleted
setup secret. A false claim cannot even be turned into a proof.

**"Can the database admin rewrite all history?"** One edited record or root is caught by verify. Rewriting
the *entire* anchor chain needs external anchoring (publishing the anchor hashes outside the bank).

**Limits:**
* 8192 records per commit (Merkle depth 13); a bigger tree needs a bigger setup.
* Our trusted setup was done by one person on one laptop — fine for a demo; real systems run a
  public ceremony with many participants, or use setup-free proof systems (PLONK, STARKs).
* At most 8 provable fields per record; extra fields are bundled together.
* Restore and merge rewrite the whole live database — fine at this size.
* MongoDB and PostgreSQL writes are not one single transaction; PostgreSQL is the source of truth.
