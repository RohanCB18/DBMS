"""External anchoring: publish each transparency-log entry somewhere the database admin cannot rewrite.

The anchor hash chain in PostgreSQL catches an edit to *one* commit, but someone with full
control of the database could recompute the *whole* chain. Publishing every `entry_hash`
outside our infrastructure closes that gap: an auditor compares the anchor in a proof package
(or the chain in the database) with the published copy.

Modes (ZTDB_EXTERNAL_ANCHOR):
  off     nothing is published (default; the demo works fully offline)
  file    append a JSON line to ZTDB_EXTERNAL_ANCHOR_FILE (e.g. a synced folder or a USB stick)
  github  commit the line to a file in a GitHub repository (ZTDB_GITHUB_REPO / _TOKEN / _PATH)

Publication is best-effort: a failure never blocks a commit, it is reported and recorded.
"""
import base64
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx

from . import config
from .db import store

log = logging.getLogger("ztdb.anchoring")
GITHUB_API = "https://api.github.com"


def mode() -> str:
    return config.EXTERNAL_ANCHOR if config.EXTERNAL_ANCHOR in ("file", "github") else "off"


def _file_path() -> Path:
    if config.EXTERNAL_ANCHOR_FILE:
        return Path(config.EXTERNAL_ANCHOR_FILE)
    return Path(__file__).resolve().parents[2] / ".local" / "external_anchors.jsonl"


def _gh_headers() -> dict:
    return {"Authorization": f"Bearer {config.GITHUB_TOKEN}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"}


def _gh_url() -> str:
    return f"{GITHUB_API}/repos/{config.GITHUB_REPO}/contents/{config.GITHUB_PATH}"


def _gh_read() -> tuple[str, str | None]:
    r = httpx.get(_gh_url(), headers=_gh_headers(), params={"ref": config.GITHUB_BRANCH}, timeout=15)
    if r.status_code == 404:
        return "", None
    r.raise_for_status()
    body = r.json()
    return base64.b64decode(body["content"]).decode("utf-8"), body["sha"]


def _read_all() -> list[dict]:
    if mode() == "file":
        p = _file_path()
        text = p.read_text(encoding="utf-8") if p.exists() else ""
    elif mode() == "github":
        text, _ = _gh_read()
    else:
        return []
    out = []
    for line in text.splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def publish(anchor: dict) -> dict:
    """anchor = {seq, commit_id, merkle_root, entry_hash, anchored_at}"""
    m = mode()
    if m == "off":
        return {"mode": "off", "published": False}
    entry = {"seq": anchor["seq"], "commit_id": anchor["commit_id"].strip(), "root": str(anchor["merkle_root"]),
             "entry_hash": anchor["entry_hash"], "anchored_at": str(anchor["anchored_at"]),
             "published_at": datetime.now(timezone.utc).isoformat()}
    line = json.dumps(entry, separators=(",", ":")) + "\n"
    try:
        if m == "file":
            p = _file_path()
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a", encoding="utf-8") as f:
                f.write(line)
            location = str(p)
        else:
            if not (config.GITHUB_TOKEN and config.GITHUB_REPO):
                raise RuntimeError("ZTDB_GITHUB_TOKEN and ZTDB_GITHUB_REPO must be set")
            text, sha = _gh_read()
            body = {"message": f"ztdb anchor #{entry['seq']} ({entry['commit_id']})",
                    "content": base64.b64encode((text + line).encode("utf-8")).decode("ascii"),
                    "branch": config.GITHUB_BRANCH}
            if sha:
                body["sha"] = sha
            r = httpx.put(_gh_url(), headers=_gh_headers(), json=body, timeout=20)
            r.raise_for_status()
            location = r.json().get("commit", {}).get("html_url") or _gh_url()
        result = {"mode": m, "published": True, "location": location}
    except Exception as e:  # noqa: BLE001 — never block a commit on the outside world
        log.warning("external anchoring failed: %s", e)
        result = {"mode": m, "published": False, "error": str(e).splitlines()[0]}
    store.external_anchors.insert_one({**entry, **result})
    return result


def lookup(seq: int) -> dict | None:
    """The externally published entry for one anchor sequence number (None if absent).

    The latest publication wins: a demo reset restarts sequence numbers, and older entries stay
    in the append-only log."""
    for e in reversed(_read_all()):
        if e.get("seq") == seq:
            return e
    return None


def check(seq: int, entry_hash: str) -> dict:
    """Does the outside world agree with this anchor entry?"""
    m = mode()
    if m == "off":
        return {"mode": "off", "checked": False}
    try:
        e = lookup(seq)
    except Exception as ex:  # noqa: BLE001
        return {"mode": m, "checked": False, "error": str(ex).splitlines()[0]}
    if e is None:
        return {"mode": m, "checked": True, "ok": False, "problem": f"anchor #{seq} was never published"}
    ok = e["entry_hash"] == entry_hash
    return {"mode": m, "checked": True, "ok": ok, "published": e,
            **({} if ok else {"problem": "published entry hash differs — the anchor log was rewritten"})}


def status() -> dict:
    m = mode()
    info = {"mode": m}
    if m == "file":
        info["location"] = str(_file_path())
    elif m == "github":
        info["location"] = f"https://github.com/{config.GITHUB_REPO}/blob/{config.GITHUB_BRANCH}/{config.GITHUB_PATH}"
    info["recent"] = list(store.external_anchors.find({}, {"_id": 0}).sort("seq", -1).limit(10))
    return info
