"""Demo data and scripted scenarios (used by the API's /api/demo/* routes and by scripts/).

Story: "ZTDB Bank". Transaction #100600 is the hero record — a ₹2,50,000 property
advance from Ananya Rao that is PENDING at the first commit and COMPLETED after the
first business day. The auditor later asks for proof of that, without seeing anything else.
"""
import random
from datetime import datetime, timedelta, timezone

from . import graph, sqlconsole, vcs
from .canonical import SQL_TABLES
from .db import live_db, pg, store

HERO_TXN = 100600

BRANCHES = [
    ("BLR001", "MG Road", "Bengaluru"), ("BLR002", "Koramangala", "Bengaluru"),
    ("MUM001", "Fort", "Mumbai"), ("DEL001", "Connaught Place", "New Delhi"),
    ("HYD001", "Hitech City", "Hyderabad"), ("CHN001", "T Nagar", "Chennai"),
]
FIRST = ["Ananya", "Vikram", "Priya", "Rahul", "Sneha", "Arjun", "Kavya", "Rohan", "Meera", "Aditya",
         "Isha", "Karthik", "Divya", "Nikhil", "Pooja", "Siddharth", "Anjali", "Varun", "Nisha", "Harsh"]
LAST = ["Rao", "Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Menon", "Joshi", "Kulkarni"]
CHANNELS = ["UPI", "NEFT", "IMPS", "CARD"]
REMARKS = ["Rent", "Groceries", "Salary", "EMI", "Electricity bill", "School fees", "Dinner split",
           "Freelance invoice", "Insurance premium", "Gift", "Medical", "Travel booking"]
DOC_TYPES = ["AADHAAR", "PAN", "PASSPORT"]
OFFICERS = ["officer.kumar", "officer.shah", "officer.das"]


def _seed_rows(rng: random.Random):
    now = datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc)
    branches = [(c, f"ZTDB {n}", city, f"ZTDB0{c}") for c, n, city in BRANCHES]
    customers, kyc = [], []
    for cid in range(1, 41):
        name = f"{FIRST[(cid - 1) % 20]} {LAST[(cid * 7) % 10]}" if cid > 1 else "Ananya Rao"
        city = BRANCHES[cid % 6][2]
        status = "VERIFIED" if cid % 7 else "PENDING"
        customers.append((cid, name, f"{name.lower().replace(' ', '.')}{cid}@mail.in",
                          f"98{rng.randint(10_000_000, 99_999_999)}", city, status,
                          (now - timedelta(days=rng.randint(200, 1500))).date()))
        kyc.append({"_id": f"KYC-{cid:04d}", "customer_id": cid, "doc_type": DOC_TYPES[cid % 3],
                    "doc_number_masked": f"XXXX-XXXX-{rng.randint(1000, 9999)}",
                    "verified": status == "VERIFIED", "verified_by": OFFICERS[cid % 3] if status == "VERIFIED" else None,
                    "address": {"city": city, "pincode": str(rng.randint(400001, 600099))},
                    "risk_score": rng.randint(5, 60)})
    accounts, balance = [], {}
    acc_no = 5001000001
    for cid in range(1, 41):
        for _ in range(1 if cid % 3 else 2):
            bal = rng.randint(50_000, 2_000_000) * 100
            accounts.append([acc_no, cid, BRANCHES[(cid + acc_no) % 6][0], rng.choice(["SAVINGS", "SAVINGS", "CURRENT"]),
                             bal, "ACTIVE", (now - timedelta(days=rng.randint(100, 1200))).date()])
            balance[acc_no] = bal
            acc_no += 1
    # "Vikram Rao Builders" — the receiver of the hero transaction
    builder = acc_no
    customers.append((41, "Vikram Rao Builders", "accounts@vrbuilders.in", "9845000041", "Bengaluru", "VERIFIED",
                      (now - timedelta(days=900)).date()))
    kyc.append({"_id": "KYC-0041", "customer_id": 41, "doc_type": "PAN", "doc_number_masked": "XXXXX-1041",
                "verified": True, "verified_by": "officer.kumar", "address": {"city": "Bengaluru", "pincode": "560001"},
                "risk_score": 12})
    accounts.append([builder, 41, "BLR001", "CURRENT", 5_000_000_00, "ACTIVE", (now - timedelta(days=900)).date()])
    balance[builder] = 5_000_000_00
    accounts[0][4] = balance[5001000001] = 4_200_000_00   # Ananya has ₹42 lakh

    ids = [a[0] for a in accounts]
    txns, t = [], now - timedelta(days=90)
    for txn_id in range(100001, HERO_TXN):
        t += timedelta(minutes=rng.randint(60, 300))
        src, dst = rng.sample(ids, 2)
        amount = min(rng.randint(100, 50_000) * 100, balance[src])
        r = rng.random()
        status = "COMPLETED" if r < 0.93 else "FAILED" if r < 0.97 else "REVERSED"
        if amount <= 0:
            status, amount = "FAILED", 100
        if status == "COMPLETED":
            balance[src] -= amount
            balance[dst] += amount
        txns.append((txn_id, src, dst, amount, status, rng.choice(CHANNELS), t, rng.choice(REMARKS)))
    txns.append((HERO_TXN, 5001000001, builder, 250_000_00, "PENDING", "NEFT", now,
                 "Property advance - Flat 4B, Whitefield"))
    for a in accounts:
        a[4] = balance[a[0]]
    return branches, customers, [tuple(a) for a in accounts], txns, kyc


def reset() -> dict:
    """Wipe all three databases, load the seed bank, and make the first commit."""
    with pg() as conn:
        sqlconsole.drop_all(conn)
        conn.execute("""TRUNCATE bank.transactions, bank.accounts, bank.customers, bank.bank_branches,
                        vcs.verification_runs, vcs.anchors, vcs.change_log, vcs.head,
                        vcs.commit_parents, vcs.branches, vcs.commits CASCADE""")
        conn.execute("INSERT INTO vcs.branches (branch_name) VALUES ('main')")
        conn.execute("INSERT INTO vcs.head (branch_name) VALUES ('main')")
        branches, customers, accounts, txns, kyc = _seed_rows(random.Random(42))
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO bank.bank_branches VALUES (%s, %s, %s, %s)", branches)
            cur.executemany("INSERT INTO bank.customers VALUES (%s, %s, %s, %s, %s, %s, %s)", customers)
            cur.executemany("INSERT INTO bank.accounts VALUES (%s, %s, %s, %s, %s, %s, %s)", accounts)
            cur.executemany("INSERT INTO bank.transactions VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", txns)
        conn.execute(f"SELECT setval('bank.txn_id_seq', {HERO_TXN})")
    for name in ("blobs", "trees", "proofs", "tamper_backup"):
        store[name].drop()
    live_db.kyc_documents.drop()
    live_db.kyc_documents.insert_many(kyc)
    graph.wipe()
    graph.ensure_schema()
    first = vcs.commit("Initial import of ZTDB Bank (core banking + KYC)", "system")
    return {"seeded": {"branches": len(branches), "customers": len(customers), "accounts": len(accounts),
                       "transactions": len(txns), "kyc_documents": len(kyc)}, "commit": first}


def business_day() -> dict:
    """Simulate one day of banking through the stored procedures (uncommitted afterwards)."""
    log = []
    with pg() as conn:
        day = conn.execute("SELECT count(*) AS n FROM vcs.commits").fetchone()["n"]
        rng = random.Random(1000 + day)
        hero = conn.execute("SELECT status FROM bank.transactions WHERE txn_id = %s", (HERO_TXN,)).fetchone()
        if hero and hero["status"] == "PENDING":
            res = conn.execute("SELECT bank.sp_settle_txn(%s) AS s", (HERO_TXN,)).fetchone()["s"]
            log.append(f"txn {HERO_TXN} (₹2,50,000 property advance) settled -> {res}")
        active = [r["account_id"] for r in conn.execute(
            "SELECT account_id FROM bank.accounts WHERE status = 'ACTIVE' ORDER BY account_id")]
        settled = 0
        for i in range(20):
            src, dst = rng.sample(active, 2)
            tid = conn.execute("SELECT bank.sp_transfer(%s, %s, %s, %s, %s) AS id",
                               (src, dst, rng.randint(500, 40_000) * 100, rng.choice(CHANNELS),
                                rng.choice(REMARKS))).fetchone()["id"]
            if i < 17:
                conn.execute("SELECT bank.sp_settle_txn(%s)", (tid,))
                settled += 1
        log.append(f"20 new transfers created, {settled} settled, 3 left PENDING")
        rev = conn.execute("""SELECT txn_id FROM bank.transactions WHERE status = 'COMPLETED'
                              AND txn_id < %s ORDER BY txn_id DESC LIMIT 1""", (HERO_TXN,)).fetchone()
        if rev:
            try:
                with conn.transaction():
                    conn.execute("SELECT bank.sp_reverse_txn(%s)", (rev["txn_id"],))
                log.append(f"txn {rev['txn_id']} reversed (customer dispute)")
            except Exception as e:  # receiver may lack funds
                log.append(f"reversal of {rev['txn_id']} refused: {str(e).splitlines()[0]}")
        frozen = rng.choice(active[1:-1])
        conn.execute("UPDATE bank.accounts SET status = 'FROZEN' WHERE account_id = %s", (frozen,))
        log.append(f"account {frozen} frozen by compliance")
        pending = conn.execute("""SELECT customer_id FROM bank.customers WHERE kyc_status = 'PENDING'
                                  ORDER BY customer_id LIMIT 1""").fetchone()
        if pending:
            cid = pending["customer_id"]
            conn.execute("UPDATE bank.customers SET kyc_status = 'VERIFIED' WHERE customer_id = %s", (cid,))
            live_db.kyc_documents.update_one({"customer_id": cid},
                                             {"$set": {"verified": True, "verified_by": "officer.shah"}})
            log.append(f"customer {cid} KYC verified (PostgreSQL + MongoDB)")
    return {"events": log, "status": vcs.status()}


def tamper(mode: str) -> dict:
    """Play the malicious insider. Modes: blob | root | undo."""
    if mode == "blob":
        head = vcs.status()["head"]
        entry = next(e for e in vcs.manifest(head)["entries"] if e["key"] == f"transactions:{HERO_TXN}")
        blob = store.blobs.find_one({"_id": entry["blob"]})
        store.tamper_backup.replace_one({"_id": blob["_id"]}, blob, upsert=True)
        fields = [[n, 25_000_00 if n == "amount_paise" else v] for n, v in blob["fields"]]
        store.blobs.update_one({"_id": blob["_id"]}, {"$set": {"fields": fields}})
        return {"attack": "Edited committed txn #100600 directly in MongoDB: amount ₹2,50,000 -> ₹25,000",
                "blob": blob["_id"], "hint": "Now run verify on any commit containing this version."}
    if mode == "root":
        with pg() as conn:
            try:
                with conn.transaction():
                    conn.execute("UPDATE vcs.commits SET merkle_root = merkle_root + 1 WHERE commit_id = "
                                 "(SELECT commit_id FROM vcs.commits ORDER BY created_at DESC LIMIT 1)")
                blocked = None
            except Exception as e:
                blocked = str(e).splitlines()[0]
            # A determined DBA disables the trigger and rewrites the root anyway.
            row = conn.execute("SELECT commit_id, merkle_root::text AS r FROM vcs.commits ORDER BY created_at DESC LIMIT 1").fetchone()
            store.tamper_backup.replace_one({"_id": "root"}, {"_id": "root", "commit_id": row["commit_id"], "root": row["r"]}, upsert=True)
            conn.execute("ALTER TABLE vcs.commits DISABLE TRIGGER trg_commits_immutable")
            conn.execute("UPDATE vcs.commits SET merkle_root = merkle_root + 1 WHERE commit_id = %s", (row["commit_id"],))
            conn.execute("ALTER TABLE vcs.commits ENABLE TRIGGER trg_commits_immutable")
        return {"attack": f"Rewrote the Merkle root of commit {row['commit_id'].strip()} in PostgreSQL",
                "first_attempt_blocked_by_trigger": blocked,
                "hint": "The anchor hash chain still holds the original root, so verify will catch it."}
    if mode == "undo":
        undone = []
        for b in store.tamper_backup.find({"_id": {"$ne": "root"}}):
            store.blobs.replace_one({"_id": b["_id"]}, b)
            undone.append(f"blob {b['_id'][:12]} restored")
        r = store.tamper_backup.find_one({"_id": "root"})
        if r:
            with pg() as conn:
                conn.execute("ALTER TABLE vcs.commits DISABLE TRIGGER trg_commits_immutable")
                conn.execute("UPDATE vcs.commits SET merkle_root = %s::numeric WHERE commit_id = %s", (r["root"], r["commit_id"]))
                conn.execute("ALTER TABLE vcs.commits ENABLE TRIGGER trg_commits_immutable")
            undone.append(f"root of {r['commit_id'].strip()} restored")
        store.tamper_backup.drop()
        return {"undone": undone}
    raise vcs.VcsError("mode must be blob | root | undo")


def live_rows(table: str, limit: int = 100, offset: int = 0) -> dict:
    if table in SQL_TABLES:
        pk = SQL_TABLES[table]
        with pg() as conn:
            total = conn.execute(f"SELECT count(*) AS n FROM bank.{table}").fetchone()["n"]
            rows = conn.execute(f"SELECT * FROM bank.{table} ORDER BY {pk} DESC LIMIT %s OFFSET %s",
                                (limit, offset)).fetchall()
        return {"table": table, "total": total, "rows": rows}
    if table == "kyc_documents":
        return {"table": table, "total": live_db.kyc_documents.count_documents({}),
                "rows": list(live_db.kyc_documents.find().sort("_id", 1).skip(offset).limit(limit))}
    raise vcs.VcsError(f"unknown table {table}", 404)


def _free_branch_name(base: str) -> str:
    existing = {b["name"] for b in vcs.branches()}
    name, n = base, 2
    while name in existing:
        name, n = f"{base}-{n}", n + 1
    return name


def merge_scenario(mode: str) -> dict:
    """Prepare two diverged branches so the merge feature can be demonstrated.

    clean    : branch `audit-fix` corrects customer 7's phone; main updates customer 12's city.
               Different records -> merges cleanly into a two-parent commit.
    conflict : branch `kyc-review` and main both change customer 7's phone (PostgreSQL) and
               KYC risk score (MongoDB) to different values -> two field conflicts to resolve.
    Leaves the working database on the original branch, clean, ready for `POST /api/merge`.
    """
    if mode not in ("clean", "conflict"):
        raise vcs.VcsError("mode must be clean | conflict")
    st = vcs.status()
    if not st["clean"]:
        raise vcs.VcsError("commit or discard the uncommitted changes first", 409)
    home = st["branch"]
    branch = _free_branch_name("audit-fix" if mode == "clean" else "kyc-review")
    vcs.create_branch(branch)
    vcs.checkout(branch)
    with pg() as conn:
        if mode == "clean":
            conn.execute("UPDATE bank.customers SET phone = '9811122233' WHERE customer_id = 7")
            msg = "Audit fix: correct phone number of customer 7"
        else:
            conn.execute("UPDATE bank.customers SET phone = '9822200001' WHERE customer_id = 7")
            msg = "KYC review: customer 7 is high risk, phone re-verified"
    if mode == "conflict":
        live_db.kyc_documents.update_one({"customer_id": 7}, {"$set": {"risk_score": 95}})
    side = vcs.commit(msg, "auditor")
    vcs.checkout(home)
    with pg() as conn:
        if mode == "clean":
            conn.execute("UPDATE bank.customers SET city = 'Pune' WHERE customer_id = 12")
            msg = "Customer 12 moved to Pune"
        else:
            conn.execute("UPDATE bank.customers SET phone = '9833300002' WHERE customer_id = 7")
            msg = "Branch desk: customer 7 updated phone, low risk"
    if mode == "conflict":
        live_db.kyc_documents.update_one({"customer_id": 7}, {"$set": {"risk_score": 3}})
    main = vcs.commit(msg, "ops")
    return {"mode": mode, "source_branch": branch, "target_branch": home,
            "source_commit": side["commit_id"], "target_commit": main["commit_id"],
            "next": f"POST /api/merge {{\"source\": \"{branch}\"}}"}
