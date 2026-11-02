import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Database, Eye, GitCommitHorizontal, GitCompare, History, Lock, PenLine, Play, ShieldAlert, Terminal } from "lucide-react";
import { api, ApiError, type LiveSqlResult, type SqlResult } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, ErrorBox, Kbd, PageHeader, cx, inputCls } from "../components/ui";
import { CommitPicker, useVersionLabels } from "../components/CommitPicker";

type Mode = "live" | "history";

const HISTORY_EXAMPLES = [
  ["Transactions by status", "SELECT status, count(*) AS n, sum(amount_paise)/100 AS inr\nFROM transactions\nGROUP BY status\nORDER BY status;"],
  ["The hero transaction", "SELECT txn_id, status, amount_paise/100 AS inr, remarks\nFROM transactions\nWHERE txn_id = 100600;"],
  ["Richest accounts", "SELECT a.account_id, c.full_name, a.balance_paise/100 AS inr, a.status\nFROM accounts a JOIN customers c USING (customer_id)\nORDER BY a.balance_paise DESC\nLIMIT 10;"],
  ["KYC from MongoDB (JSONB)", "SELECT doc->>'doc_type' AS doc_type,\n       count(*) AS n,\n       round(avg((doc->>'risk_score')::int), 1) AS avg_risk\nFROM kyc_documents\nGROUP BY 1 ORDER BY 1;"],
  ["Window function", "SELECT txn_id, from_account, amount_paise/100 AS inr,\n       rank() OVER (PARTITION BY from_account ORDER BY amount_paise DESC) AS rnk\nFROM transactions\nWHERE status = 'COMPLETED'\nORDER BY amount_paise DESC LIMIT 15;"],
];

const LIVE_EXAMPLES = [
  ["Correct a phone number", "UPDATE customers\nSET phone = '9811100007'\nWHERE customer_id = 7\nRETURNING customer_id, full_name, phone;"],
  ["Open a new customer", "INSERT INTO customers (customer_id, full_name, email, phone, city, kyc_status)\nVALUES ((SELECT max(customer_id) + 1 FROM customers),\n        'Neha Kapoor', 'neha.kapoor' || (SELECT max(customer_id) + 1 FROM customers) || '@mail.in',\n        '9822012345', 'Pune', 'PENDING')\nRETURNING *;"],
  ["Transfer money (stored procedures)", "-- creates a PENDING transfer, then settles it: debit, credit, COMPLETED\nSELECT sp_settle_txn(\n         sp_transfer(5001000001, 5001000002, 1500000, 'NEFT', 'Manual transfer')\n       ) AS result;"],
  ["Freeze an account", "UPDATE accounts\nSET status = 'FROZEN'\nWHERE account_id = 5001000003\nRETURNING account_id, status, balance_paise;"],
  ["Cancel pending transfers", "UPDATE transactions\nSET status = 'FAILED'\nWHERE status = 'PENDING' AND txn_id > 100600\nRETURNING txn_id, amount_paise, status;"],
  ["Blocked: break a business rule", "-- the state-machine trigger refuses COMPLETED -> PENDING\nUPDATE transactions\nSET status = 'PENDING'\nWHERE txn_id = 100001;"],
  ["Read: account summary view", "SELECT *\nFROM v_account_summary\nORDER BY balance_inr DESC\nLIMIT 10;"],
];

export default function SqlConsole() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "history" ? "history" : "live";
  const setMode = (m: Mode) => setParams({ mode: m }, { replace: true });

  return (
    <>
      <PageHeader title="SQL console" icon={<Terminal />}
        subtitle="Change the working bank data with plain SQL and commit it — or query the database exactly as it was at any past commit." />
      <div className="mb-6 inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        {([["live", "Live database", "read & write", <PenLine key="l" className="h-4 w-4" />],
           ["history", "Time travel", "read-only, any commit", <History key="h" className="h-4 w-4" />]] as const).map(([m, label, sub, icon]) => (
          <button key={m} onClick={() => setMode(m)}
            className={cx("relative flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-left transition",
              mode === m ? "text-white" : "text-slate-400 hover:text-slate-200")}>
            {mode === m && <motion.span layoutId="sql-mode" className="absolute inset-0 rounded-xl border border-ok/25 bg-gradient-to-r from-ok/[0.16] to-brand-cyan/[0.06]" />}
            <span className={cx("relative", mode === m && "text-ok")}>{icon}</span>
            <span className="relative"><span className="block text-[15px] font-semibold">{label}</span><span className="block text-xs text-slate-500">{sub}</span></span>
          </button>
        ))}
      </div>
      {mode === "live" ? <LiveConsole /> : <HistoryConsole />}
    </>
  );
}

// ------------------------------------------------------------------ live (read & write)

function LiveConsole() {
  const [query, setQuery] = useState(LIVE_EXAMPLES[0][1]);
  const [result, setResult] = useState<LiveSqlResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("Manual corrections via SQL");
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const cfg = useQuery({ queryKey: ["live-sql-config"], queryFn: api.liveSqlConfig });

  const exec = useAction(
    (a: { preview: boolean; full?: boolean }) => api.liveSql(query, a.preview, !!a.full),
    (r) => r.preview ? `Preview: ${describe(r)} — rolled back, nothing changed`
      : r.applied ? `Applied: ${describe(r)}` : `Ran ${r.kind.toUpperCase()} (${r.row_count} rows)`);
  const commit = useAction(() => api.commit(message, "sql-console"),
    (c) => <>Committed <b className="font-mono">{c.commit_id}</b> (+{c.summary.added} ~{c.summary.modified} −{c.summary.deleted})</>);

  const run = (preview: boolean, full = false) => {
    setError(null);
    setResult(null);
    exec.mutate({ preview, full }, {
      onSuccess: setResult,
      onError: (e) => {
        if (e instanceof ApiError && e.body?.needs_confirmation && !full) {
          if (confirm(`${e.message}\n\nRun it on the whole table anyway?`)) return run(preview, true);
        }
        setError(e);
      },
    });
  };

  const st = status.data;
  const changed = st ? [...st.added.map((k) => ["+", k]), ...st.modified.map((k) => ["~", k]), ...st.deleted.map((k) => ["−", k])] : [];

  if (cfg.data && !cfg.data.enabled) {
    return <ErrorBox error={new Error("The live SQL console is disabled on this server (ZTDB_LIVE_SQL=off).")} />;
  }

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card glow>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <Badge tone="warn" dot>working database</Badge>
            <span>branch <b className="text-slate-200">{st?.branch}</b> — changes stay uncommitted until you commit them</span>
          </div>
          <textarea value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(e.shiftKey); }
            }}
            className="h-56 w-full resize-y rounded-xl border border-white/10 bg-ink-950/80 p-4 font-mono text-[15px] leading-relaxed text-amber-50 outline-none transition focus:border-amber-300/50 focus:ring-4 focus:ring-amber-300/10" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="ghost" busy={exec.isPending && exec.variables?.preview} disabled={!query.trim() || exec.isPending} onClick={() => run(true)}>
              <Eye className="h-4 w-4" /> Preview
            </Button>
            <Button variant="primary" busy={exec.isPending && !exec.variables?.preview} disabled={!query.trim() || exec.isPending} onClick={() => run(false)}>
              <Play className="h-4 w-4" /> Execute
            </Button>
            <span className="text-sm text-slate-500"><Kbd>Ctrl Enter</Kbd> execute · <Kbd>Ctrl Shift Enter</Kbd> preview (runs, then rolls back)</span>
          </div>
          {error ? <div className="mt-4"><ErrorBox error={error} /></div> : null}
        </Card>

        <div className="space-y-5">
          <Card title="Uncommitted changes" right={st && <Badge tone={st.clean ? "ok" : "warn"} dot>{st.clean ? "clean" : `${changed.length} records`}</Badge>}>
            {st && !st.clean ? (
              <>
                <ul className="max-h-40 space-y-0.5 overflow-auto font-mono text-sm">
                  {changed.slice(0, 40).map(([m, k]) => (
                    <li key={k} className={m === "+" ? "text-ok" : m === "−" ? "text-bad" : "text-amber-300"}>{m} {k}</li>
                  ))}
                  {changed.length > 40 && <li className="text-slate-500">… {changed.length - 40} more</li>}
                </ul>
                <div className="mt-4 space-y-2">
                  <input className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="commit message" />
                  <div className="flex gap-2">
                    <Button variant="primary" className="flex-1" busy={commit.isPending} disabled={!message.trim()} onClick={() => commit.mutate(undefined)}>
                      <GitCommitHorizontal className="h-4 w-4" /> Commit
                    </Button>
                    {st.head && <Link to={`/diff?a=${st.head}&b=WORKING`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/[0.06]">
                      <GitCompare className="h-4 w-4" /> Diff</Link>}
                  </div>
                </div>
              </>
            ) : <p className="text-[15px] text-slate-400">Nothing to commit — the working database matches HEAD.</p>}
          </Card>
          <Card title="Examples">
            <div className="space-y-1.5">
              {LIVE_EXAMPLES.map(([t, q]) => (
                <button key={t} onClick={() => setQuery(q)}
                  className={cx("block w-full rounded-lg border px-3 py-2 text-left text-[14.5px] transition hover:bg-white/[0.05]",
                    t.startsWith("Blocked") ? "border-bad/25 text-rose-200" : "border-white/10 text-slate-200")}>{t}</button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
          <Card title={result.preview ? "Preview (rolled back)" : result.applied ? "Applied" : "Result"}
            right={<span className="text-sm text-slate-500">{result.elapsed_ms} ms</span>}>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-[15px]">
              <Badge tone="info">{result.kind.toUpperCase()}</Badge>
              {result.affected !== null && (
                <span className={result.preview ? "text-sky-300" : "text-ok"}>
                  {result.affected} row{result.affected === 1 ? "" : "s"} {result.preview ? "would change" : "changed"}
                </span>
              )}
              {result.preview && <span className="text-slate-400">— nothing was written. Click <b>Execute</b> to apply.</span>}
              {result.applied && <span className="text-slate-400">— now an uncommitted change; commit it to snapshot, anchor and make it provable.</span>}
            </div>
            {result.columns.length > 0 && <ResultTable columns={result.columns} rows={result.rows} />}
            {result.truncated && <p className="mt-2 text-sm text-slate-500">showing the first {result.row_count} rows</p>}
          </Card>
        </motion.div>
      )}

      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-sm text-slate-400">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <span>
          Runs as <span className="font-mono text-slate-200">ztdb_writer</span>: INSERT / UPDATE / DELETE on the bank tables
          (<span className="font-mono">{cfg.data?.tables.join(", ") ?? "customers, accounts, transactions, bank_branches"}</span>) and the
          stored procedures only — no DDL, no TRUNCATE, no access to commits or anchors. Constraints and triggers still apply,
          one statement at a time, UPDATE / DELETE need a WHERE clause, at most {cfg.data?.max_affected ?? 1000} rows per statement,
          5 s timeout. Every change is recorded in the audit log. KYC documents live in MongoDB and are not editable here.
        </span>
      </div>
    </>
  );
}

function describe(r: LiveSqlResult) {
  if (r.affected !== null) return `${r.kind.toUpperCase()} ${r.affected} row${r.affected === 1 ? "" : "s"}`;
  return `${r.kind.toUpperCase()} returned ${r.row_count} row${r.row_count === 1 ? "" : "s"}`;
}

// ------------------------------------------------------------------ time travel (read-only)

function HistoryConsole() {
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const labels = useVersionLabels();
  const [query, setQuery] = useState(HISTORY_EXAMPLES[0][1]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [res, setRes] = useState<{ a?: SqlResult; b?: SqlResult; errA?: unknown; errB?: unknown }>({});
  useEffect(() => {
    if (!a && log.data?.length) {
      setA(log.data[log.data.length - 1].commit_id);
      if (log.data.length > 1) setB(log.data[0].commit_id);
    }
  }, [log.data, a]);

  const run = useAction(async () => {
    const [ra, rb] = await Promise.allSettled([api.sql(a, query), b ? api.sql(b, query) : Promise.resolve(undefined)]);
    return {
      a: ra.status === "fulfilled" ? ra.value : undefined, errA: ra.status === "rejected" ? ra.reason : undefined,
      b: rb.status === "fulfilled" ? rb.value : undefined, errB: rb.status === "rejected" ? rb.reason : undefined,
    };
  });
  const go = () => run.mutate(undefined, { onSuccess: setRes });

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card>
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <label><span className="mb-1.5 block text-sm text-slate-400">as of</span><CommitPicker value={a} onChange={setA} /></label>
            <label><span className="mb-1.5 block text-sm text-slate-400">compare with (optional)</span>
              <div className="flex gap-2"><CommitPicker value={b} onChange={setB} />{b && <Button variant="subtle" onClick={() => setB("")}>×</Button>}</div></label>
          </div>
          <textarea value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); go(); } }}
            className="h-52 w-full resize-y rounded-xl border border-white/10 bg-ink-950/80 p-4 font-mono text-[15px] leading-relaxed text-emerald-100 outline-none transition focus:border-ok/60 focus:ring-4 focus:ring-ok/10" />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" busy={run.isPending} disabled={!a || !query.trim()} onClick={go}><Play className="h-4 w-4" /> Run</Button>
            <span className="text-sm text-slate-500"><Kbd>Ctrl Enter</Kbd> · SELECT / WITH only · 3 s timeout · 500 rows</span>
          </div>
        </Card>
        <Card title="Examples">
          <div className="space-y-1.5">
            {HISTORY_EXAMPLES.map(([t, q]) => (
              <button key={t} onClick={() => setQuery(q)} className="block w-full rounded-lg border border-white/10 px-3 py-2 text-left text-[14.5px] text-slate-200 transition hover:bg-white/[0.05]">{t}</button>
            ))}
          </div>
          <div className="mt-4 flex gap-2 text-sm text-slate-400"><Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Runs as <span className="font-mono">ztdb_reader</span>: read-only role, no access to the live <span className="font-mono">bank</span> / <span className="font-mono">vcs</span> schemas.</span></div>
          <div className="mt-3 flex gap-2 text-sm text-slate-500"><Database className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Tables: transactions, accounts, customers, bank_branches, kyc_documents (id, doc JSONB)</span></div>
        </Card>
      </div>

      <div className={cx("mt-5 grid gap-5", b && "xl:grid-cols-2")}>
        <HistoryResult title={`as of ${labels[a] ?? ""}`} r={res.a} err={res.errA} />
        {b && <HistoryResult title={`as of ${labels[b] ?? ""}`} r={res.b} err={res.errB} />}
      </div>
    </>
  );
}

function HistoryResult({ title, r, err }: { title: string; r?: SqlResult; err?: unknown }) {
  if (!r && !err) return null;
  return (
    <Card title={title} right={r && <span className="text-sm text-slate-500">{r.row_count} rows{r.truncated ? " (truncated)" : ""} · {r.query_ms} ms · schema {r.schema}</span>}>
      {err ? <ErrorBox error={err} /> : r && <ResultTable columns={r.columns} rows={r.rows} />}
    </Card>
  );
}

function ResultTable({ columns, rows }: { columns: string[]; rows: any[][] }) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded-xl border border-white/[0.08]">
      <table className="w-full text-left text-[15px]">
        <thead className="sticky top-0 bg-ink-800 text-xs uppercase text-slate-400"><tr>{columns.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-white/[0.05]">{row.map((v, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-200">{v === null ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>)}</tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length} className="px-3 py-3 text-slate-500">no rows</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
