import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Terminal, Lock } from "lucide-react";
import { api, type SqlResult } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, Card, ErrorBox, PageHeader, cx } from "../components/ui";
import { CommitPicker, useVersionLabels } from "../components/CommitPicker";

const EXAMPLES = [
  ["Transactions by status", "SELECT status, count(*) AS n, sum(amount_paise)/100 AS inr\nFROM transactions\nGROUP BY status\nORDER BY status;"],
  ["The hero transaction", "SELECT txn_id, status, amount_paise/100 AS inr, remarks\nFROM transactions\nWHERE txn_id = 100600;"],
  ["Richest accounts", "SELECT a.account_id, c.full_name, a.balance_paise/100 AS inr, a.status\nFROM accounts a JOIN customers c USING (customer_id)\nORDER BY a.balance_paise DESC\nLIMIT 10;"],
  ["KYC from MongoDB (JSONB)", "SELECT doc->>'doc_type' AS doc_type,\n       count(*) AS n,\n       round(avg((doc->>'risk_score')::int), 1) AS avg_risk\nFROM kyc_documents\nGROUP BY 1 ORDER BY 1;"],
  ["Window function", "SELECT txn_id, from_account, amount_paise/100 AS inr,\n       rank() OVER (PARTITION BY from_account ORDER BY amount_paise DESC) AS rnk\nFROM transactions\nWHERE status = 'COMPLETED'\nORDER BY amount_paise DESC LIMIT 15;"],
];

export default function SqlConsole() {
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const labels = useVersionLabels();
  const [query, setQuery] = useState(EXAMPLES[0][1]);
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
      <PageHeader title="Time-travel SQL" icon={<Terminal className="h-7 w-7" />}
        subtitle="Run a read-only SELECT against the database as it was at any commit. The snapshot is materialised into its own schema and queried by a least-privilege role." />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card>
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <label><span className="mb-1.5 block text-sm text-slate-400">as of</span><CommitPicker value={a} onChange={setA} /></label>
            <label><span className="mb-1.5 block text-sm text-slate-400">compare with (optional)</span>
              <div className="flex gap-2"><CommitPicker value={b} onChange={setB} />{b && <Button variant="subtle" onClick={() => setB("")}>×</Button>}</div></label>
          </div>
          <textarea value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); go(); } }}
            className="h-52 w-full resize-y rounded-xl border border-ink-600 bg-ink-950 p-4 font-mono text-[15px] leading-relaxed text-emerald-100 outline-none focus:border-ok/60" />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" busy={run.isPending} disabled={!a || !query.trim()} onClick={go}><Play className="h-4 w-4" /> Run</Button>
            <span className="text-sm text-slate-500">Ctrl+Enter · SELECT / WITH only · 3 s timeout · 500 rows</span>
          </div>
        </Card>
        <Card title="Examples">
          <div className="space-y-2">
            {EXAMPLES.map(([t, q]) => (
              <button key={t} onClick={() => setQuery(q)} className="block w-full rounded-lg border border-ink-600 px-3 py-2 text-left text-[15px] text-slate-200 hover:bg-ink-800">{t}</button>
            ))}
          </div>
          <div className="mt-4 flex gap-2 text-sm text-slate-400"><Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Runs as <span className="font-mono">ztdb_reader</span>: read-only role, no access to the live <span className="font-mono">bank</span> / <span className="font-mono">vcs</span> schemas.</span></div>
          <div className="mt-3 text-sm text-slate-500">Tables: transactions, accounts, customers, bank_branches, kyc_documents (id, doc JSONB)</div>
        </Card>
      </div>

      <div className={cx("mt-5 grid gap-5", b && "xl:grid-cols-2")}>
        <ResultCard title={`as of ${labels[a] ?? ""}`} r={res.a} err={res.errA} />
        {b && <ResultCard title={`as of ${labels[b] ?? ""}`} r={res.b} err={res.errB} />}
      </div>
    </>
  );
}

function ResultCard({ title, r, err }: { title: string; r?: SqlResult; err?: unknown }) {
  if (!r && !err) return null;
  return (
    <Card title={title} right={r && <span className="text-sm text-slate-500">{r.row_count} rows{r.truncated ? " (truncated)" : ""} · {r.query_ms} ms · schema {r.schema}</span>}>
      {err ? <ErrorBox error={err} /> : r && (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-ink-700">
          <table className="w-full text-left text-[15px]">
            <thead className="sticky top-0 bg-ink-800 text-xs uppercase text-slate-400"><tr>{r.columns.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr></thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i} className="border-t border-ink-800">{row.map((v, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-200">{v === null ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
