"""Runtime configuration.

Values come from environment variables; a `.env` file in the repository root (or in `api/`)
is loaded first if present, without overriding variables that are already set.
Defaults target the docker-compose ports from the host — see `.env.example`.
"""
import os
from pathlib import Path


def _load_dotenv():
    here = Path(__file__).resolve().parent
    for candidate in (here.parent.parent / ".env", here.parent / ".env"):
        if not candidate.is_file():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


PG_DSN = os.getenv("PG_DSN", "postgresql://ztdb:ztdb@localhost:5544/ztdb")
# read-only role used by the time-travel SQL console (created in db/postgres/03_roles.sql)
PG_READER_DSN = os.getenv("PG_READER_DSN", "postgresql://ztdb_reader:ztdb_reader@localhost:5544/ztdb")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27018")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "ztdb-neo4j")
ZK_URL = os.getenv("ZK_URL", "http://localhost:7000")

# Demo controls (/api/demo/*). Off in production; with a token set, callers must send X-Admin-Token.
DEMO_MODE = _flag("ZTDB_DEMO_MODE", "on")
ADMIN_TOKEN = os.getenv("ZTDB_ADMIN_TOKEN", "")

# Optional external anchoring of the transparency log: "off" | "file" | "github"
EXTERNAL_ANCHOR = os.getenv("ZTDB_EXTERNAL_ANCHOR", "off").strip().lower()
EXTERNAL_ANCHOR_FILE = os.getenv("ZTDB_EXTERNAL_ANCHOR_FILE", "")
GITHUB_TOKEN = os.getenv("ZTDB_GITHUB_TOKEN", "")
GITHUB_REPO = os.getenv("ZTDB_GITHUB_REPO", "")          # owner/name
GITHUB_PATH = os.getenv("ZTDB_GITHUB_PATH", "anchors.jsonl")
GITHUB_BRANCH = os.getenv("ZTDB_GITHUB_BRANCH", "main")
