-- =====================================================================
-- ZK-TemporalDB — PostgreSQL: least-privilege role for the *live* SQL console
--
-- The dashboard and CLI let a user change the working bank data with plain SQL
-- (INSERT / UPDATE / DELETE, or calls to the bank's stored procedures). Those
-- statements run as ztdb_writer, which:
--   * can read and write the four bank tables and use the txn id sequence
--   * can call bank.sp_transfer / sp_settle_txn / sp_reverse_txn
--   * cannot TRUNCATE, create or alter anything, and has no access to `vcs`
--     (commits, anchors, branches): history can only change through commits
--   * runs with a 5 s statement timeout
-- Every business rule still applies: CHECK constraints, foreign keys and the
-- transaction state-machine trigger fire exactly as for the bank application.
--
-- Idempotent: the API also applies this file at startup, so existing databases
-- pick it up without being recreated.
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ztdb_writer') THEN
        CREATE ROLE ztdb_writer LOGIN PASSWORD 'ztdb_writer'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
    END IF;
END $$;

ALTER ROLE ztdb_writer SET statement_timeout = '5s';
ALTER ROLE ztdb_writer SET idle_in_transaction_session_timeout = '10s';

GRANT CONNECT ON DATABASE ztdb TO ztdb_writer;
GRANT USAGE ON SCHEMA bank TO ztdb_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bank TO ztdb_writer;
GRANT USAGE, SELECT ON SEQUENCE bank.txn_id_seq TO ztdb_writer;
GRANT EXECUTE ON FUNCTION bank.sp_transfer(BIGINT, BIGINT, BIGINT, VARCHAR, VARCHAR),
                          bank.sp_settle_txn(BIGINT),
                          bank.sp_reverse_txn(BIGINT) TO ztdb_writer;
REVOKE ALL ON SCHEMA vcs FROM ztdb_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA vcs FROM ztdb_writer;

-- The audit trigger writes to vcs.change_log, which ztdb_writer cannot touch:
-- run it with its owner's rights (SECURITY DEFINER, pinned search_path) and
-- record who really made the change (session_user, not the definer).
CREATE OR REPLACE FUNCTION vcs.fn_audit_row() RETURNS trigger
SECURITY DEFINER SET search_path = pg_catalog, vcs AS $$
DECLARE v_pk TEXT;
BEGIN
    IF current_setting('ztdb.restoring', true) = 'on' THEN
        RETURN NULL;
    END IF;
    v_pk := CASE TG_OP WHEN 'DELETE' THEN to_jsonb(OLD) ->> TG_ARGV[0] ELSE to_jsonb(NEW) ->> TG_ARGV[0] END;
    INSERT INTO vcs.change_log (table_name, pk, op, old_row, new_row, db_user)
    VALUES (TG_TABLE_NAME, v_pk, left(TG_OP, 1),
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
            session_user);
    RETURN NULL;
END $$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION vcs.fn_audit_row() FROM PUBLIC;
