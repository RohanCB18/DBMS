import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { api, TABLES } from "../lib/api";
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, cx } from "../components/ui";
import { RecordTable } from "../components/RecordTable";

const PK: Record<string, string> = { transactions: "txn_id", accounts: "account_id", customers: "customer_id", bank_branches: "branch_code", kyc_documents: "_id" };
const PAGE = 50;

export default function LiveData() {
  const [table, setTable] = useState<string>("transactions");
  const [page, setPage] = useState(0);
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const q = useQuery({ queryKey: ["live", table, page], queryFn: () => api.live(table, PAGE, page * PAGE) });

  const highlight = useMemo(() => {
    const m = new Map<string, "added" | "modified">();
    status.data?.added.forEach((k) => m.set(k, "added"));
    status.data?.modified.forEach((k) => m.set(k, "modified"));
    return m;
  }, [status.data]);
  const changedHere = [...highlight.keys()].filter((k) => k.startsWith(table + ":")).length;
  const total = q.data?.total ?? 0;

  return (
    <>
      <PageHeader title="Live data" icon={<Table2 className="h-7 w-7" />}
        subtitle="The working databases right now. Rows changed since HEAD are highlighted: green = added, amber = modified." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABLES.map((t) => {
          const n = [...highlight.keys()].filter((k) => k.startsWith(t + ":")).length;
          return (
            <button key={t} onClick={() => { setTable(t); setPage(0); }}
              className={cx("flex items-center gap-2 rounded-xl border px-4 py-2 text-[15px] transition",
                t === table ? "border-ok/50 bg-ok/10 text-ok" : "border-ink-600 text-slate-300 hover:bg-ink-800")}>
              {t}
              <span className="text-xs text-slate-500">{t === "kyc_documents" ? "MongoDB" : "PostgreSQL"}</span>
              {n > 0 && <Badge tone="warn">{n}</Badge>}
            </button>
          );
        })}
      </div>
      <Card title={`${table} — ${total} rows`} right={
        <div className="flex items-center gap-2 text-sm text-slate-400">
          {changedHere > 0 && <Badge tone="warn">{changedHere} changed since HEAD</Badge>}
          <Button variant="subtle" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)}
          <Button variant="subtle" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      }>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> :
          <RecordTable rows={q.data!.rows} keyOf={(r) => `${table}:${r[PK[table]]}`} highlight={highlight} />}
        {table === "kyc_documents" && <p className="mt-3 text-sm text-slate-500">Schema-less MongoDB documents — click a row to see the nested JSON.</p>}
      </Card>
    </>
  );
}
