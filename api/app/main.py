"""ZK-TemporalDB HTTP API.  Interactive docs: http://localhost:8100/docs"""
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import demo, graph, proofs, vcs, zk

app = FastAPI(title="ZK-TemporalDB", version="0.6.0",
              description="Git for databases, with cryptographic proof.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(vcs.VcsError)
def _vcs_error(_req: Request, e: vcs.VcsError):
    return JSONResponse(status_code=e.status, content={"error": str(e)})


@app.on_event("startup")
def _startup():
    try:
        graph.ensure_schema()
    except Exception:  # noqa: BLE001 — neo4j may still be booting; constraints are re-ensured on reset
        pass


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
    return vcs.restore(body.ref, body.force)


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


@app.post("/api/demo/reset")
def demo_reset():
    return demo.reset()


@app.post("/api/demo/business-day")
def demo_business_day():
    return demo.business_day()


@app.post("/api/demo/tamper")
def demo_tamper(body: TamperIn):
    return demo.tamper(body.mode)
