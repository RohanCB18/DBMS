-- =====================================================================
-- ZK-TemporalDB — PostgreSQL: version-control metadata ("the .git folder")
--   vcs.branches        named pointers to commits
--   vcs.head            which branch the working database is on
--   vcs.commits         one row per commit, holding its Merkle root
--   vcs.commit_parents  commit DAG edges (M:N, so merges have 2 parents)
--   vcs.anchors         append-only hash chain of roots (transparency log)
--   vcs.change_log      row-level audit of uncommitted changes (trigger-fed)
--   vcs.verification_runs  history of integrity checks
-- Snapshot contents live in MongoDB; lineage lives in Neo4j.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS vcs;

CREATE TABLE vcs.commits (
    commit_id     CHAR(16)     PRIMARY KEY,
    branch_name   VARCHAR(40)  NOT NULL,
    merkle_root   NUMERIC(80)  NOT NULL,          -- Poseidon root (BN254 field element)
    message       VARCHAR(200) NOT NULL,
    author        VARCHAR(60)  NOT NULL,
    record_count  INTEGER      NOT NULL CHECK (record_count >= 0),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE vcs.commit_parents (
    commit_id     CHAR(16)  NOT NULL REFERENCES vcs.commits (commit_id),
    parent_id     CHAR(16)  NOT NULL REFERENCES vcs.commits (commit_id),
    parent_order  SMALLINT  NOT NULL CHECK (parent_order IN (1, 2)),
    PRIMARY KEY (commit_id, parent_order),
    CHECK (commit_id <> parent_id)
);
CREATE INDEX idx_parents_parent ON vcs.commit_parents (parent_id);

CREATE TABLE vcs.branches (
    branch_name  VARCHAR(40)  PRIMARY KEY CHECK (branch_name ~ '^[a-z0-9][a-z0-9._/-]*$'),
    head_commit  CHAR(16)     REFERENCES vcs.commits (commit_id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE vcs.commits
    ADD CONSTRAINT fk_commit_branch FOREIGN KEY (branch_name) REFERENCES vcs.branches (branch_name);

-- Single-row table: the branch currently checked out into the bank schema.
CREATE TABLE vcs.head (
    singleton    BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    branch_name  VARCHAR(40) NOT NULL REFERENCES vcs.branches (branch_name)
);

CREATE TABLE vcs.anchors (
    seq          BIGSERIAL    PRIMARY KEY,
    commit_id    CHAR(16)     NOT NULL UNIQUE REFERENCES vcs.commits (commit_id),
    merkle_root  NUMERIC(80)  NOT NULL,
    prev_hash    CHAR(64)     NOT NULL,
    entry_hash   CHAR(64)     NOT NULL UNIQUE,
    anchored_at  TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE vcs.change_log (
    change_id   BIGSERIAL    PRIMARY KEY,
    table_name  VARCHAR(40)  NOT NULL,
    pk          TEXT         NOT NULL,
    op          CHAR(1)      NOT NULL CHECK (op IN ('I', 'U', 'D')),
    old_row     JSONB,
    new_row     JSONB,
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    db_user     TEXT         NOT NULL DEFAULT current_user
);
CREATE INDEX idx_change_log_key ON vcs.change_log (table_name, pk);

CREATE TABLE vcs.verification_runs (
    run_id      BIGSERIAL    PRIMARY KEY,
    commit_id   CHAR(16)     NOT NULL REFERENCES vcs.commits (commit_id),
    ok          BOOLEAN      NOT NULL,
    details     JSONB        NOT NULL,
    ran_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Trigger: history is immutable. Commits, parents and anchors can never be
-- updated or deleted through normal SQL (an attacker must disable triggers,
-- which the anchor hash chain then exposes).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vcs.fn_forbid_rewrite() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ZK-TemporalDB: % on %.% is forbidden — history is append-only',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_commits_immutable BEFORE UPDATE OR DELETE ON vcs.commits
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_forbid_rewrite();
CREATE TRIGGER trg_parents_immutable BEFORE UPDATE OR DELETE ON vcs.commit_parents
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_forbid_rewrite();
CREATE TRIGGER trg_anchors_immutable BEFORE UPDATE OR DELETE ON vcs.anchors
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_forbid_rewrite();

-- ---------------------------------------------------------------------
-- Trigger: every anchor entry hashes the previous one (a mini blockchain).
--   entry_hash = sha256(prev_hash | commit_id | merkle_root | anchored_at)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vcs.fn_anchor_entry_hash(p_prev TEXT, p_commit TEXT, p_root NUMERIC, p_at TIMESTAMPTZ)
RETURNS CHAR(64) AS $$
    SELECT encode(digest(p_prev || '|' || p_commit || '|' || p_root::text || '|' ||
                         to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'sha256'), 'hex');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION vcs.fn_anchor_chain() RETURNS trigger AS $$
BEGIN
    SELECT COALESCE((SELECT entry_hash FROM vcs.anchors ORDER BY seq DESC LIMIT 1), repeat('0', 64))
      INTO NEW.prev_hash;
    NEW.anchored_at := date_trunc('milliseconds', clock_timestamp());
    NEW.entry_hash  := vcs.fn_anchor_entry_hash(NEW.prev_hash, NEW.commit_id, NEW.merkle_root, NEW.anchored_at);
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_anchor_chain BEFORE INSERT ON vcs.anchors
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_anchor_chain();

-- Re-walks the whole chain; returns one row per broken link (empty = intact).
CREATE OR REPLACE FUNCTION vcs.fn_verify_anchor_chain()
RETURNS TABLE (seq BIGINT, commit_id CHAR(16), problem TEXT) AS $$
    WITH chain AS (
        SELECT a.*, LAG(a.entry_hash, 1, repeat('0', 64)) OVER (ORDER BY a.seq) AS expected_prev
        FROM vcs.anchors a
    )
    SELECT c.seq, c.commit_id,
           CASE WHEN c.prev_hash <> c.expected_prev THEN 'chain link broken (prev_hash mismatch)'
                WHEN c.entry_hash <> vcs.fn_anchor_entry_hash(c.prev_hash, c.commit_id, c.merkle_root, c.anchored_at)
                     THEN 'entry hash does not match its contents'
                ELSE 'anchored root differs from commit root' END
    FROM chain c
    JOIN vcs.commits cm ON cm.commit_id = c.commit_id
    WHERE c.prev_hash <> c.expected_prev
       OR c.entry_hash <> vcs.fn_anchor_entry_hash(c.prev_hash, c.commit_id, c.merkle_root, c.anchored_at)
       OR c.merkle_root <> cm.merkle_root
    ORDER BY c.seq;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Trigger: capture every change to the bank tables into vcs.change_log
-- ("git status" / activity feed). Suppressed while restoring a commit.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vcs.fn_audit_row() RETURNS trigger AS $$
DECLARE v_pk TEXT;
BEGIN
    IF current_setting('ztdb.restoring', true) = 'on' THEN
        RETURN NULL;
    END IF;
    v_pk := CASE TG_OP WHEN 'DELETE' THEN to_jsonb(OLD) ->> TG_ARGV[0] ELSE to_jsonb(NEW) ->> TG_ARGV[0] END;
    INSERT INTO vcs.change_log (table_name, pk, op, old_row, new_row)
    VALUES (TG_TABLE_NAME, v_pk, left(TG_OP, 1),
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_branches AFTER INSERT OR UPDATE OR DELETE ON bank.bank_branches
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_audit_row('branch_code');
CREATE TRIGGER trg_audit_customers AFTER INSERT OR UPDATE OR DELETE ON bank.customers
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_audit_row('customer_id');
CREATE TRIGGER trg_audit_accounts AFTER INSERT OR UPDATE OR DELETE ON bank.accounts
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_audit_row('account_id');
CREATE TRIGGER trg_audit_transactions AFTER INSERT OR UPDATE OR DELETE ON bank.transactions
    FOR EACH ROW EXECUTE FUNCTION vcs.fn_audit_row('txn_id');

-- ---------------------------------------------------------------------
-- Stored procedure: record a commit atomically —
-- insert commit + parent edges, append the anchor, advance the branch,
-- and clear the change log. All-or-nothing inside one transaction.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE vcs.sp_record_commit(
    p_commit_id CHAR(16), p_branch VARCHAR, p_root NUMERIC, p_message VARCHAR,
    p_author VARCHAR, p_record_count INTEGER, p_parents CHAR(16)[])
LANGUAGE plpgsql AS $$
DECLARE i INTEGER;
BEGIN
    INSERT INTO vcs.commits (commit_id, branch_name, merkle_root, message, author, record_count)
    VALUES (p_commit_id, p_branch, p_root, p_message, p_author, p_record_count);

    FOR i IN 1 .. COALESCE(array_length(p_parents, 1), 0) LOOP
        INSERT INTO vcs.commit_parents (commit_id, parent_id, parent_order)
        VALUES (p_commit_id, p_parents[i], i);
    END LOOP;

    INSERT INTO vcs.anchors (commit_id, merkle_root, prev_hash, entry_hash)
    VALUES (p_commit_id, p_root, '', '');           -- trigger fills the hashes

    UPDATE vcs.branches SET head_commit = p_commit_id WHERE branch_name = p_branch;
    DELETE FROM vcs.change_log;
END $$;

-- ---------------------------------------------------------------------
-- Recursive CTEs over the commit DAG
-- ---------------------------------------------------------------------

-- All ancestors of a commit (inclusive) with their distance — "git log".
CREATE OR REPLACE FUNCTION vcs.fn_ancestors(p_commit CHAR(16))
RETURNS TABLE (commit_id CHAR(16), depth INTEGER) AS $$
    WITH RECURSIVE anc(commit_id, depth) AS (
        SELECT p_commit, 0
        UNION
        SELECT cp.parent_id, anc.depth + 1
        FROM anc JOIN vcs.commit_parents cp ON cp.commit_id = anc.commit_id
    )
    SELECT commit_id, MIN(depth)::INTEGER FROM anc GROUP BY commit_id;
$$ LANGUAGE sql STABLE;

-- Lowest common ancestor of two commits — the base of a three-way merge.
CREATE OR REPLACE FUNCTION vcs.fn_merge_base(p_a CHAR(16), p_b CHAR(16))
RETURNS CHAR(16) AS $$
    SELECT a.commit_id
    FROM vcs.fn_ancestors(p_a) a
    JOIN vcs.fn_ancestors(p_b) b USING (commit_id)
    ORDER BY a.depth + b.depth, a.commit_id
    LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW vcs.v_commit_log AS
SELECT c.commit_id, c.branch_name, c.message, c.author, c.created_at, c.record_count,
       c.merkle_root::text AS merkle_root,
       ARRAY(SELECT cp.parent_id FROM vcs.commit_parents cp
             WHERE cp.commit_id = c.commit_id ORDER BY cp.parent_order) AS parents,
       a.seq AS anchor_seq, a.entry_hash AS anchor_hash
FROM vcs.commits c
LEFT JOIN vcs.anchors a ON a.commit_id = c.commit_id;

-- Bootstrap: the main branch with no commits yet.
INSERT INTO vcs.branches (branch_name) VALUES ('main');
INSERT INTO vcs.head (branch_name) VALUES ('main');
