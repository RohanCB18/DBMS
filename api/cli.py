"""ztdb — command-line client for ZK-TemporalDB (wraps the HTTP API).

    python cli.py status
    python cli.py commit -m "End of day"
    python cli.py log
    python cli.py diff <a> [<b>|WORKING]
    python cli.py branch [NAME] [--start REF]
    python cli.py checkout NAME
    python cli.py restore REF [--hard]
    python cli.py merge SOURCE [--resolve "customers:7|phone=theirs"] [--dry-run]
    python cli.py verify [REF]
    python cli.py prove --ref main --table transactions --pk 100600 --field status --op eq --value COMPLETED -o proof.json
    python cli.py audit proof.json
    python cli.py sql REF "SELECT status, count(*) FROM transactions GROUP BY status"
    python cli.py rings
    python cli.py stats
    python cli.py demo reset | business-day | tamper blob|root|undo | scenario clean|conflict

API address: --api option or ZTDB_API env var (default http://localhost:8100).
"""
import json
import os
from pathlib import Path
from typing import Optional

import httpx
import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

app = typer.Typer(help="ZK-TemporalDB: git for databases, with cryptographic proof.", no_args_is_help=True,
                  add_completion=False)
demo_app = typer.Typer(help="Demo scenario controls.", no_args_is_help=True)
app.add_typer(demo_app, name="demo")
con = Console()
state = {"api": os.getenv("ZTDB_API", "http://localhost:8100"), "token": os.getenv("ZTDB_ADMIN_TOKEN", "")}


@app.callback()
def main(api: str = typer.Option(None, help="API base URL"),
         token: str = typer.Option(None, help="admin token for demo controls")):
    if api:
        state["api"] = api
    if token:
        state["token"] = token


def call(method: str, path: str, ok=(200,), **kw):
    headers = {"X-Admin-Token": state["token"]} if state["token"] else {}
    try:
        r = httpx.request(method, state["api"].rstrip("/") + "/api" + path, timeout=300, headers=headers, **kw)
    except httpx.HTTPError as e:
        con.print(f"[red]cannot reach the API at {state['api']}: {e}[/red]")
        raise typer.Exit(2)
    body = r.json() if r.content else {}
    if r.status_code not in ok:
        con.print(f"[bold red]error {r.status_code}:[/bold red] {body.get('error', body)}")
        raise typer.Exit(1)
    return r.status_code, body


def short(h: Optional[str], n: int = 8) -> str:
    return "-" if not h else (h if len(h) <= n + 4 else f"{h[:n]}…{h[-4:]}")


def ok_mark(ok: bool) -> str:
    return "[bold green]✔ OK[/bold green]" if ok else "[bold red]✘ BAD[/bold red]"


# ------------------------------------------------------------------ version control

@app.command()
def status():
    """Uncommitted changes in the working databases."""
    _, s = call("GET", "/status")
    con.print(f"On branch [bold cyan]{s['branch']}[/bold cyan], HEAD [yellow]{s['head']}[/yellow]")
    if s["clean"]:
        con.print("[green]nothing to commit, working databases match HEAD[/green]")
        return
    for kind, colour, mark in (("added", "green", "+"), ("modified", "yellow", "~"), ("deleted", "red", "-")):
        for k in s[kind][:30]:
            con.print(f"  [{colour}]{mark} {k}[/{colour}]")
        if len(s[kind]) > 30:
            con.print(f"  [{colour}]… {len(s[kind]) - 30} more {kind}[/{colour}]")


@app.command()
def commit(message: str = typer.Option(..., "-m", "--message"), author: str = typer.Option("cli-user", "--author")):
    """Snapshot PostgreSQL + MongoDB into a new commit."""
    _, c = call("POST", "/commit", json={"message": message, "author": author})
    sm = c["summary"]
    con.print(Panel.fit(f"[bold]{c['commit_id']}[/bold] on {c['branch']}\n"
                        f"root   {short(c['root'], 16)}\nanchor #{c['anchor']['seq']} {short(c['anchor']['entry_hash'])}\n"
                        f"[green]+{sm['added']}[/green] [yellow]~{sm['modified']}[/yellow] [red]-{sm['deleted']}[/red]"
                        f"  ({c['record_count']} records)", title="committed", border_style="green"))


@app.command()
def log(branch: Optional[str] = typer.Argument(None), limit: int = 20):
    """Commit history (recursive CTE over the commit DAG)."""
    _, rows = call("GET", "/log", params={"branch": branch, "limit": limit} if branch else {"limit": limit})
    t = Table(show_lines=False)
    for col in ("commit", "branch", "when", "author", "message", "parents", "anchor"):
        t.add_column(col)
    for r in rows:
        merge = len(r["parents"]) > 1
        t.add_row(f"[yellow]{r['commit_id']}[/yellow]", r["branch_name"], r["created_at"][:19].replace("T", " "),
                  r["author"], ("[magenta]⑂ [/magenta]" if merge else "") + r["message"],
                  ", ".join(p[:8] for p in r["parents"]), f"#{r['anchor_seq']}")
    con.print(t)


@app.command()
def diff(a: str, b: str = typer.Argument("WORKING")):
    """Record- and field-level diff between two commits (or a commit and WORKING)."""
    _, d = call("GET", "/diff", params={"a": a, "b": b})
    con.print(f"[bold]{short(d['from'], 16)} → {short(d['to'], 16)}[/bold]  {d['summary']}")
    for x in d["added"]:
        con.print(f"[green]+ {x['key']}[/green]")
    for x in d["deleted"]:
        con.print(f"[red]- {x['key']}[/red]")
    for x in d["modified"]:
        con.print(f"[yellow]~ {x['key']}[/yellow]")
        for c in x["changes"]:
            con.print(f"    {c['field']}: [red]{c['old']}[/red] → [green]{c['new']}[/green]")


@app.command()
def branch(name: Optional[str] = typer.Argument(None), start: Optional[str] = typer.Option(None)):
    """List branches, or create NAME (from --start or HEAD)."""
    if name:
        _, b = call("POST", "/branches", json={"name": name, "start": start})
        con.print(f"created branch [cyan]{b['name']}[/cyan] at {b['head']}")
        return
    _, rows = call("GET", "/branches")
    for b in rows:
        con.print(f"{'*' if b['current'] else ' '} [cyan]{b['name']}[/cyan]  {b['head']}")


@app.command()
def checkout(name: str, force: bool = typer.Option(False, "--force")):
    """Switch the working databases to another branch."""
    _, r = call("POST", "/checkout", json={"branch": name, "force": force})
    con.print(f"switched to [cyan]{r['branch']}[/cyan] ({r['records']} records restored from {r['restored']})")


@app.command()
def restore(ref: str, hard: bool = typer.Option(False, "--hard", help="also move the branch (reset --hard)"),
            force: bool = typer.Option(False, "--force")):
    """Overwrite the working databases with the state of REF."""
    _, r = call("POST", "/restore", json={"ref": ref, "force": force, "move_head": hard})
    con.print(f"restored {r['records']} records from {r['restored']}" +
              (f"; branch {r['branch_moved']} now points there" if r.get("branch_moved") else ""))


@app.command()
def merge(source: str, resolve: list[str] = typer.Option([], "--resolve", help='"key|field=ours|theirs" (repeatable)'),
          dry_run: bool = typer.Option(False, "--dry-run"), message: Optional[str] = typer.Option(None, "-m")):
    """Three-way merge SOURCE into the current branch."""
    res = {}
    for item in resolve:
        k, _, v = item.rpartition("=")
        res[k] = v
    code, r = call("POST", "/merge", ok=(200, 409),
                   json={"source": source, "resolutions": res or None, "dry_run": dry_run, "message": message})
    if code == 409:
        con.print(f"[bold red]{r['error']}[/bold red]  (base {short(r.get('base'))})")
        t = Table("key", "field", "base", "ours", "theirs")
        for c in r.get("conflicts", []):
            t.add_row(c["key"], str(c["field"]), str(c["base"]), f"[cyan]{c['ours']}[/cyan]", f"[magenta]{c['theirs']}[/magenta]")
        con.print(t)
        con.print('resolve with e.g. --resolve "customers:7|phone=theirs"')
        raise typer.Exit(1)
    if r["result"] == "merged":
        con.print(f"[green]merged[/green] {source} → {r['branch']}: commit {r['commit_id']} "
                  f"(parents {short(r['ours'])}, {short(r['theirs'])}; {r['conflicts_resolved']} conflicts resolved)")
    else:
        con.print(f"[cyan]{r['result']}[/cyan] {json.dumps({k: v for k, v in r.items() if k != 'conflicts'})}")


@app.command()
def verify(ref: str = typer.Argument("main")):
    """Four-layer integrity check of a commit."""
    _, v = call("POST", f"/verify/{ref}")
    for layer in v["layers"]:
        con.print(f"{ok_mark(layer['ok'])}  {layer['layer']}")
    if v["ok"]:
        con.print(Panel.fit(f"commit {v['commit_id']} is intact", border_style="green"))
    else:
        con.print(Panel.fit("TAMPERED: " + (", ".join(v["tampered_records"]) or "see failed layers"),
                            border_style="red"))
        raise typer.Exit(1)


# ------------------------------------------------------------------ proofs

@app.command()
def prove(ref: str = typer.Option("main"), table: str = typer.Option(...), pk: str = typer.Option(...),
          field: str = typer.Option(...), op: str = typer.Option("eq", help="eq | gte | lte"),
          value: str = typer.Option(...), out: Path = typer.Option(Path("proof.json"), "-o", "--out")):
    """Generate a zero-knowledge proof package for one claim about one historical record."""
    with con.status("generating Groth16 proof…"):
        _, p = call("POST", "/proofs", json={"ref": ref, "table": table, "pk": pk, "field": field, "op": op, "value": value})
    out.write_text(json.dumps(p, indent=2), encoding="utf-8")
    size = len(json.dumps(p["proof"]))
    con.print(Panel.fit(f"[bold]{p['claim_text']}[/bold]\ncommit {p['commit_id']}  anchor #{p['anchor']['seq']}\n"
                        f"proof {size} bytes, {p['proving_ms']} ms → {out}", title="proof", border_style="green"))


@app.command()
def audit(package: Path):
    """Verify a proof package as an outside auditor would."""
    pkg = json.loads(package.read_text(encoding="utf-8"))
    _, r = call("POST", "/proofs/verify", json=pkg)
    con.print(f"claim: [bold]{r.get('claim_text')}[/bold]")
    for c in r["checks"]:
        con.print(f"{ok_mark(c['ok'])}  {c['check']}")
    con.print(Panel.fit("VALID" if r["valid"] else "INVALID", border_style="green" if r["valid"] else "red"))
    if not r["valid"]:
        raise typer.Exit(1)


# ------------------------------------------------------------------ analytics

@app.command()
def sql(ref: str, query: str):
    """Run a read-only SELECT against the database as of REF."""
    _, r = call("POST", "/sql", json={"ref": ref, "query": query})
    t = Table(*r["columns"], title=f"as of {r['commit_id']}")
    for row in r["rows"]:
        t.add_row(*[str(x) for x in row])
    con.print(t)
    con.print(f"{r['row_count']} rows{' (truncated)' if r['truncated'] else ''}, {r['query_ms']} ms")


@app.command()
def rings(ref: str = typer.Argument("HEAD"), min_inr: int = 100_000, hours: int = 24):
    """Find money-laundering rings with a Neo4j graph query."""
    _, r = call("GET", "/graph/fraud-rings", params={"ref": ref, "min_amount_inr": min_inr, "max_hours": hours})
    if not r["rings"]:
        con.print("[green]no rings found[/green]")
    for ring in r["rings"]:
        path = " → ".join(f"{a} ({o})" for a, o in zip(ring["accounts"], ring["owners"]))
        con.print(Panel.fit(f"{path} → back to start\n₹{ring['total_amount'] / 100:,.0f} moved in "
                            f"{ring['span_minutes']} minutes over {len(ring['transfers'])} hops",
                            title="fraud ring", border_style="red"))


@app.command()
def stats():
    """Counts across PostgreSQL, MongoDB and Neo4j."""
    _, s = call("GET", "/stats")
    con.print_json(data=s)


# ------------------------------------------------------------------ demo

@demo_app.command("reset")
def demo_reset():
    _, r = call("POST", "/demo/reset")
    con.print(f"seeded {r['seeded']} → commit {r['commit']['commit_id']}")


@demo_app.command("business-day")
def demo_business_day():
    _, r = call("POST", "/demo/business-day")
    for e in r["events"]:
        con.print(f"• {e}")


@demo_app.command("tamper")
def demo_tamper(mode: str = typer.Argument(..., help="blob | root | undo")):
    _, r = call("POST", "/demo/tamper", json={"mode": mode})
    con.print_json(data=r)


@demo_app.command("scenario")
def demo_scenario(mode: str = typer.Argument(..., help="clean | conflict")):
    _, r = call("POST", "/demo/merge-scenario", json={"mode": mode})
    con.print(f"branch [cyan]{r['source_branch']}[/cyan] diverged from {r['target_branch']} — now run: "
              f"python cli.py merge {r['source_branch']}")


if __name__ == "__main__":
    app()
