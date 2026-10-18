"""Runtime configuration. Defaults target the docker-compose ports from the host."""
import os

PG_DSN = os.getenv("PG_DSN", "postgresql://ztdb:ztdb@localhost:5544/ztdb")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27018")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "ztdb-neo4j")
ZK_URL = os.getenv("ZK_URL", "http://localhost:7000")
