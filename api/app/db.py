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


@contextmanager
def pg():
    """A Postgres connection; commits on success, rolls back on error."""
    with psycopg.connect(config.PG_DSN, row_factory=dict_row) as conn:
        yield conn
