"""Thin client for the Node zk-service (Poseidon Merkle trees + Groth16)."""
import httpx

from . import config

_client = httpx.Client(base_url=config.ZK_URL, timeout=180)


class ZkError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _post(path: str, body: dict) -> dict:
    r = _client.post(path, json=body)
    if r.status_code >= 400:
        raise ZkError(r.status_code, r.json().get("error", r.text))
    return r.json()


def merkle_commit(records: list[dict]) -> tuple[str, list[str]]:
    res = _post("/merkle/commit", {"records": records})
    return res["root"], res["leaves"]


def merkle_root(leaves: list[str]) -> str:
    return _post("/merkle/root", {"leaves": leaves})["root"]


def leaves_for(records: list[dict]) -> list[str]:
    return _post("/merkle/leaves", {"records": records})["leaves"]


def merkle_path(leaves: list[str], index: int) -> dict:
    return _post("/merkle/path", {"leaves": leaves, "leafIndex": index})


def encode(values: list) -> list[str]:
    return _post("/encode", {"values": values})["encoded"]


def prove(record: dict, leaves: list[str], index: int, field: str, op: str, value) -> dict:
    return _post("/prove", {"record": record, "leaves": leaves, "leafIndex": index,
                            "field": field, "op": op, "value": value})


def verify(proof: dict, public_signals: list[str]) -> bool:
    return _post("/verify", {"proof": proof, "publicSignals": public_signals})["valid"]


def vkey() -> dict:
    return _client.get("/vkey").json()
