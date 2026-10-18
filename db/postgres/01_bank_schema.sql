-- =====================================================================
-- ZK-TemporalDB — PostgreSQL: the live, versioned business database
-- Domain: a small retail bank (branches, customers, accounts, transactions)
-- Normalised to 3NF — see docs/DATABASE_DESIGN.md for the dependency analysis.
-- Money is stored as BIGINT paise (1 INR = 100 paise): exact, no float rounding.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS bank;

CREATE TABLE bank.bank_branches (
    branch_code  CHAR(6)      PRIMARY KEY,                -- e.g. BLR001
    branch_name  VARCHAR(80)  NOT NULL,
    city         VARCHAR(40)  NOT NULL,
    ifsc         CHAR(11)     NOT NULL UNIQUE
);

CREATE TABLE bank.customers (
    customer_id  INTEGER      PRIMARY KEY,
    full_name    VARCHAR(80)  NOT NULL,
    email        VARCHAR(120) NOT NULL UNIQUE,
    phone        VARCHAR(15)  NOT NULL,
    city         VARCHAR(40)  NOT NULL,
    kyc_status   VARCHAR(10)  NOT NULL DEFAULT 'PENDING'
                 CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    created_at   DATE         NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE bank.accounts (
    account_id     BIGINT       PRIMARY KEY,
    customer_id    INTEGER      NOT NULL REFERENCES bank.customers (customer_id),
    branch_code    CHAR(6)      NOT NULL REFERENCES bank.bank_branches (branch_code),
    account_type   VARCHAR(10)  NOT NULL CHECK (account_type IN ('SAVINGS', 'CURRENT')),
    balance_paise  BIGINT       NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
    status         VARCHAR(8)   NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
    opened_at      DATE         NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX idx_accounts_customer ON bank.accounts (customer_id);

CREATE TABLE bank.transactions (
    txn_id        BIGINT       PRIMARY KEY,
    from_account  BIGINT       NOT NULL REFERENCES bank.accounts (account_id),
    to_account    BIGINT       NOT NULL REFERENCES bank.accounts (account_id),
    amount_paise  BIGINT       NOT NULL CHECK (amount_paise > 0),
    status        VARCHAR(9)   NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')),
    channel       VARCHAR(4)   NOT NULL CHECK (channel IN ('UPI', 'NEFT', 'IMPS', 'CARD')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    remarks       VARCHAR(120),
    CHECK (from_account <> to_account)
);
CREATE INDEX idx_txn_from ON bank.transactions (from_account);
CREATE INDEX idx_txn_to   ON bank.transactions (to_account);
CREATE INDEX idx_txn_status ON bank.transactions (status);

CREATE SEQUENCE bank.txn_id_seq START 100001;

-- ---------------------------------------------------------------------
-- Business-rule trigger: transactions follow a strict state machine.
--   PENDING -> COMPLETED | FAILED,  COMPLETED -> REVERSED.  Nothing else.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bank.fn_txn_state_machine() RETURNS trigger AS $$
BEGIN
    IF current_setting('ztdb.restoring', true) = 'on' THEN
        RETURN NEW;                                  -- restoring a commit: history is authoritative
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'PENDING'   AND NEW.status IN ('COMPLETED', 'FAILED'))
        OR (OLD.status = 'COMPLETED' AND NEW.status = 'REVERSED')) THEN
        RAISE EXCEPTION 'illegal status transition % -> % for txn %', OLD.status, NEW.status, OLD.txn_id;
    END IF;
    IF NEW.amount_paise <> OLD.amount_paise OR NEW.from_account <> OLD.from_account
       OR NEW.to_account <> OLD.to_account THEN
        RAISE EXCEPTION 'transaction % is immutable except for its status', OLD.txn_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_txn_state_machine
    BEFORE UPDATE ON bank.transactions
    FOR EACH ROW EXECUTE FUNCTION bank.fn_txn_state_machine();

-- ---------------------------------------------------------------------
-- Stored procedures: the only sanctioned way the "bank app" moves money.
-- ---------------------------------------------------------------------

-- Create a PENDING transfer and return its id.
CREATE OR REPLACE FUNCTION bank.sp_transfer(p_from BIGINT, p_to BIGINT, p_amount BIGINT,
                                            p_channel VARCHAR, p_remarks VARCHAR DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE v_id BIGINT := nextval('bank.txn_id_seq');
BEGIN
    INSERT INTO bank.transactions (txn_id, from_account, to_account, amount_paise, status, channel, remarks)
    VALUES (v_id, p_from, p_to, p_amount, 'PENDING', p_channel, p_remarks);
    RETURN v_id;
END $$ LANGUAGE plpgsql;

-- Settle a PENDING transfer atomically: debit, credit, mark COMPLETED —
-- or mark FAILED if funds are insufficient / an account is not ACTIVE.
CREATE OR REPLACE FUNCTION bank.sp_settle_txn(p_txn BIGINT) RETURNS VARCHAR AS $$
DECLARE
    t   bank.transactions%ROWTYPE;
    src bank.accounts%ROWTYPE;
    dst bank.accounts%ROWTYPE;
BEGIN
    SELECT * INTO t FROM bank.transactions WHERE txn_id = p_txn FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'txn % not found', p_txn; END IF;
    IF t.status <> 'PENDING' THEN RETURN t.status; END IF;

    -- lock both accounts in a fixed order to avoid deadlocks
    PERFORM 1 FROM bank.accounts WHERE account_id IN (t.from_account, t.to_account)
        ORDER BY account_id FOR UPDATE;
    SELECT * INTO src FROM bank.accounts WHERE account_id = t.from_account;
    SELECT * INTO dst FROM bank.accounts WHERE account_id = t.to_account;

    IF src.status <> 'ACTIVE' OR dst.status <> 'ACTIVE' OR src.balance_paise < t.amount_paise THEN
        UPDATE bank.transactions SET status = 'FAILED' WHERE txn_id = p_txn;
        RETURN 'FAILED';
    END IF;

    UPDATE bank.accounts SET balance_paise = balance_paise - t.amount_paise WHERE account_id = t.from_account;
    UPDATE bank.accounts SET balance_paise = balance_paise + t.amount_paise WHERE account_id = t.to_account;
    UPDATE bank.transactions SET status = 'COMPLETED' WHERE txn_id = p_txn;
    RETURN 'COMPLETED';
END $$ LANGUAGE plpgsql;

-- Reverse a COMPLETED transfer (refund), if the receiver still has the funds.
CREATE OR REPLACE FUNCTION bank.sp_reverse_txn(p_txn BIGINT) RETURNS VARCHAR AS $$
DECLARE t bank.transactions%ROWTYPE;
BEGIN
    SELECT * INTO t FROM bank.transactions WHERE txn_id = p_txn FOR UPDATE;
    IF t.status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'only COMPLETED transactions can be reversed (txn % is %)', p_txn, t.status;
    END IF;
    UPDATE bank.accounts SET balance_paise = balance_paise - t.amount_paise WHERE account_id = t.to_account;
    UPDATE bank.accounts SET balance_paise = balance_paise + t.amount_paise WHERE account_id = t.from_account;
    UPDATE bank.transactions SET status = 'REVERSED' WHERE txn_id = p_txn;
    RETURN 'REVERSED';
END $$ LANGUAGE plpgsql;

-- Reporting view: one row per account with owner, branch and txn activity.
CREATE OR REPLACE VIEW bank.v_account_summary AS
SELECT a.account_id, c.full_name, b.branch_name, a.account_type, a.status,
       a.balance_paise / 100.0 AS balance_inr,
       COUNT(t.txn_id) FILTER (WHERE t.from_account = a.account_id) AS sent_count,
       COUNT(t.txn_id) FILTER (WHERE t.to_account = a.account_id)   AS received_count
FROM bank.accounts a
JOIN bank.customers c     ON c.customer_id = a.customer_id
JOIN bank.bank_branches b ON b.branch_code = a.branch_code
LEFT JOIN bank.transactions t ON a.account_id IN (t.from_account, t.to_account)
GROUP BY a.account_id, c.full_name, b.branch_name;
