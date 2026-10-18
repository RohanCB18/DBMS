"""ZK-TemporalDB HTTP API.  Interactive docs: http://localhost:8100/docs"""
import secrets
from contextlib import asynccontextmanager
from typing import Literal

import psycopg
from fastapi import Depends, FastAPI, Header, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import config, demo, graph, proofs, sqlconsole, stats, vcs, zk


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        graph.ensure_schema()
    except Exception:  # noqa: BLE001 — neo4j may still be booting; constraints are re-ensured on reset
        pass
    yield


app = FastAPI(title="ZK-TemporalDB", version="0.9.0", lifespan=lifespan,
              description="Git for databases, with cryptographic proof.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(vcs.VcsError)
def _vcs_error(_req: Request, e: vcs.VcsError):
    return JSONResponse(status_code=e.status, content=jsonable_encoder({"error": str(e), **e.extra}))


def _pg_message(e: psycopg.Error) -> str:
    diag = getattr(e, "diag", None)
    return (diag.message_primary if diag and diag.message_primary else str(e).splitlines()[0])


@app.exception_handler(psycopg.errors.CheckViolation)
def _check_violation(_req: Request, e: psycopg.Error):
    return JSONResponse(status_code=400, content={"error": _pg_message(e)})


@app.exception_handler(psycopg.errors.IntegrityError)
def _integrity_error(_req: Request, e: psycopg.Error):
    return JSONResponse(status_code=409, content={"error": _pg_message(e)})


@app.exception_handler(psycopg.errors.RaiseException)
def _raised(_req: Request, e: psycopg.Error):   # business rules raised by triggers / procedures
    return JSONResponse(status_code=400, content={"error": _pg_message(e)})


def demo_guard(x_admin_token: str | None = Header(default=None)):
    """Demo controls can wipe and tamper with the database: off unless ZTDB_DEMO_MODE is on."""
    if not config.DEMO_MODE:
        raise vcs.VcsError("demo controls are disabled on this server (ZTDB_DEMO_MODE=off)", 403)
    if config.ADMIN_TOKEN and not secrets.compare_digest(x_admin_token or "", config.ADMIN_TOKEN):
        raise vcs.VcsError("missing or wrong X-Admin-Token header", 401)


# ------------------------------------------------------------------ models

class CommitIn(BaseModel):
    message: str = Field(min_length=1, max_length=200)
    author: str = "demo-user"


class BranchIn(BaseModel):
    name: str
    start: str | None = None


class CheckoutIn(BaseModel):
    branch: str
    force: bool = False


class RestoreIn(BaseModel):
    ref: str
    force: bool = False
    move_head: bool = Field(False, description="also move the current branch to this commit (reset --hard)")


class MergeIn(BaseModel):
    source: str = Field(description="branch name or commit to merge into the current branch")
    resolutions: dict[str, Literal["ours", "theirs"]] | None = Field(
        None, description='conflict choices: {"<key>" or "<key>|<field>": "ours" | "theirs"}')
    message: str | None = Field(None, max_length=200)
    author: str = "demo-user"
    dry_run: bool = Field(False, description="report the outcome and conflicts without writing")


class SqlIn(BaseModel):
    ref: str = Field(description="commit id, prefix or branch name to query 'as of'")
    query: str = Field(min_length=1, max_length=5000)


class ProofIn(BaseModel):
    ref: str = Field(description="commit id, prefix or branch name")
    table: str
    pk: str
    field: str
    op: Literal["eq", "gte", "lte"] = "eq"
    value: str | int


class InclusionIn(BaseModel):
    ref: str
    table: str
    pk: str


class TamperIn(BaseModel):
    mode: Literal["blob", "root", "undo"]


class ScenarioIn(BaseModel):
    mode: Literal["clean", "conflict"]


# ------------------------------------------------------------------ version control

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/status")
def status():
    return vcs.status()


@app.post("/api/commit")
def commit(body: CommitIn):
    return vcs.commit(body.message, body.author)


@app.get("/api/log")
def log(branch: str | None = None, limit: int = 100):
    return vcs.log(branch, limit)


@app.get("/api/diff")
def diff(a: str, b: str = "WORKING"):
    return vcs.diff(a, b)


@app.get("/api/commits/{ref}/records")
def commit_records(ref: str, table: str | None = None, offset: int = 0, limit: int = 50):
    return vcs.snapshot_records(ref, table, offset, limit)


@app.get("/api/branches")
def branches():
    return vcs.branches()


@app.post("/api/branches")
def create_branch(body: BranchIn):
    return vcs.create_branch(body.name, body.start)


@app.post("/api/checkout")
def checkout(body: CheckoutIn):
    return vcs.checkout(body.branch, body.force)


@app.post("/api/restore")
def restore(body: RestoreIn):
    return vcs.restore(body.ref, body.force, body.move_head)


@app.post("/api/merge")
def merge(body: MergeIn):
    return vcs.merge(body.source, body.resolutions, body.message, body.author, body.dry_run)


@app.post("/api/sql")
def time_travel_sql(body: SqlIn):
    return JSONResponse(jsonable_encoder(sqlconsole.run(body.ref, body.query)))


@app.get("/api/stats")
def overview_stats():
    return stats.overview()


@app.get("/api/verify-runs")
def verify_runs(limit: int = 20):
    return vcs.verification_runs(limit)


@app.post("/api/verify/{ref}")
def verify(ref: str):
    return vcs.verify(ref)


@app.get("/api/anchors")
def anchors():
    return vcs.anchors()


# ------------------------------------------------------------------ proofs

@app.post("/api/proofs")
def create_proof(body: ProofIn):
    return proofs.create(body.ref, body.table, body.pk, body.field, body.op, body.value)


@app.get("/api/proofs")
def list_proofs():
    return proofs.list_all()


@app.get("/api/proofs/{proof_id}")
def get_proof(proof_id: str):
    return proofs.get(proof_id)


@app.post("/api/proofs/verify")
def verify_proof(package: dict):
    return proofs.verify_package(package)


@app.get("/api/vkey")
def vkey():
    return zk.vkey()


@app.post("/api/inclusion")
def inclusion(body: InclusionIn):
    return proofs.inclusion(body.ref, body.table, body.pk)


# ------------------------------------------------------------------ graph

@app.get("/api/graph/commits")
def graph_commits():
    return graph.commit_graph()


@app.get("/api/graph/records/{key}")
def graph_record(key: str):
    return graph.record_history(key)


@app.get("/api/graph/commits/{commit_id}/touched")
def graph_touched(commit_id: str):
    return graph.touched_by(commit_id)


# ------------------------------------------------------------------ live data + demo

@app.get("/api/live/{table}")
def live(table: str, limit: int = 100, offset: int = 0):
    return JSONResponse(jsonable_encoder(demo.live_rows(table, limit, offset)))


@app.get("/api/demo/config")
def demo_config():
    return {"demo_mode": config.DEMO_MODE, "token_required": bool(config.ADMIN_TOKEN)}


@app.post("/api/demo/reset", dependencies=[Depends(demo_guard)])
def demo_reset():
    return demo.reset()


@app.post("/api/demo/business-day", dependencies=[Depends(demo_guard)])
def demo_business_day():
    return demo.business_day()


@app.post("/api/demo/tamper", dependencies=[Depends(demo_guard)])
def demo_tamper(body: TamperIn):
    return demo.tamper(body.mode)


@app.post("/api/demo/merge-scenario", dependencies=[Depends(demo_guard)])
def demo_merge_scenario(body: ScenarioIn):
    return demo.merge_scenario(body.mode)
