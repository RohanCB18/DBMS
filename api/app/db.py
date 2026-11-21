"""Connections to the three databases.

PostgreSQL : live bank tables (schema `bank`) + version-control metadata (schema `vcs`)
MongoDB    : `bank_live.kyc_documents` (live NoSQL data that is also versioned)
             `ztdb.blobs` / `ztdb.trees` / `ztdb.proofs` (the snapshot object store)
Neo4j      : commit DAG + record lineage + proofs graph
"""
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from pymongo import MongoClient
from neo4j import GraphDatabase

from . import config

mongo = MongoClient(config.MONGO_URI, tz_aware=True)
live_db = mongo["bank_live"]   # live NoSQL business data
store = mongo["ztdb"]          # content-addressed snapshot store

neo = GraphDatabase.driver(config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD))


RESET_LOCK_KEY = 72026102   # pg advisory-lock id: "the demo reset is truncating the tables"


@contextmanager
def pg(exclusive: bool = False):
    """A Postgres connection; commits on success, rolls back on error.

    Every transaction first takes a *shared* transaction-level advisory lock; the demo reset takes
    it *exclusively*. TRUNCATE needs an ACCESS EXCLUSIVE lock on every table, while the dashboard's
    polling reads several tables per transaction — taking this one lock before any table lock means
    the two can only queue behind each other, never deadlock.
    """
    with psycopg.connect(config.PG_DSN, row_factory=dict_row) as conn:
        if exclusive:
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (RESET_LOCK_KEY,))
        else:
            conn.execute("SELECT pg_advisory_xact_lock_shared(%s)", (RESET_LOCK_KEY,))
        yield conn
