-- =====================================================================
-- ZK-TemporalDB — PostgreSQL: least-privilege role for the time-travel SQL console
--
-- The console runs user-typed SQL against *materialised snapshots* of past commits
-- (schemas named snap_<commit_id>, created by the API). It connects as ztdb_reader:
--   * may log in, but owns nothing and cannot create objects anywhere
--   * has no access to the live `bank` schema or the `vcs` metadata
--   * every session is read-only with a 3 s statement timeout
-- The API grants SELECT on each snap_* schema to this role when it materialises it.
-- (Defence in depth: the API also checks the statement and wraps it in a READ ONLY txn.)
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ztdb_reader') THEN
        CREATE ROLE ztdb_reader LOGIN PASSWORD 'ztdb_reader'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
    END IF;
END $$;

ALTER ROLE ztdb_reader SET default_transaction_read_only = on;
ALTER ROLE ztdb_reader SET statement_timeout = '3s';
ALTER ROLE ztdb_reader SET idle_in_transaction_session_timeout = '10s';

REVOKE ALL ON SCHEMA bank, vcs FROM ztdb_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA bank, vcs FROM ztdb_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE ztdb FROM PUBLIC;
GRANT CONNECT ON DATABASE ztdb TO ztdb_reader;

-- Registry of materialised snapshot schemas (LRU eviction by last_used).
CREATE TABLE IF NOT EXISTS vcs.snapshot_schemas (
    commit_id   CHAR(16)    PRIMARY KEY REFERENCES vcs.commits (commit_id),
    schema_name TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ NOT NULL DEFAULT now()
);
