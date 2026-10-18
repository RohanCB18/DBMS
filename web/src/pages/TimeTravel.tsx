import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, History, RotateCcw } from "lucide-react";
import { api, TABLES } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, Card, ErrorBox, PageHeader, Spinner, cx } from "../components/ui";
import { CommitPicker, useVersionLabels } from "../components/CommitPicker";
import { RecordTable } from "../components/RecordTable";
import { when } from "../lib/format";

const PAGE = 50;

export default function TimeTravel() {
  const [params, setParams] = useSearchParams();
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const labels = useVersionLabels();
  const [ref, setRef] = useState(params.get("ref") ?? "");
  const [table, setTable] = useState(params.get("table") ?? "transactions");
  const [page, setPage] = useState(0);

  useEffect(() => { if (!ref && log.data?.length) setRef(log.data[log.data.length - 1].commit_id); }, [log.data, ref]);
  useEffect(() => { if (ref) setParams({ ref, table }, { replace: true }); }, [ref, table, setParams]);

  const q = useQuery({ queryKey: ["snapshot", ref, table, page], queryFn: () => api.records(ref, table, page * PAGE, PAGE), enabled: !!ref });
  const restore = useAction(() => api.restore(ref, true), (r) => `Live databases restored to ${r.restored.slice(0, 10)} (${r.records} records)`);
  const commit = log.data?.find((c) => c.commit_id === ref);
  const total = q.data?.total ?? 0;

  return (
    <>
      <PageHeader title="Time travel" icon={<History className="h-7 w-7" />}
        subtitle="Read the database exactly as it was at any commit — straight from the content-addressed snapshot store, without touching live data." />
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[24rem] flex-1"><span className="mb-1.5 block text-sm text-slate-400">as of commit</span>
            <CommitPicker value={ref} onChange={(v) => { setRef(v); setPage(0); }} /></label>
          {commit && <div className="text-[15px] text-slate-400"><span className="text-white">{labels[ref]}</span> · {when(commit.created_at)} · {commit.record_count} records</div>}
          <Button variant="danger" className="ml-auto" disabled={!ref} busy={restore.isPending}
            onClick={() => confirm("Overwrite the live databases with this commit? Uncommitted changes are discarded.") && restore.mutate(undefined)}>
            <RotateCcw className="h-4 w-4" /> Restore to this commit
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {TABLES.map((t) => (
            <button key={t} onClick={() => { setTable(t); setPage(0); }}
              className={cx("rounded-xl border px-4 py-2 text-[15px]", t === table ? "border-ok/50 bg-ok/10 text-ok" : "border-ink-600 text-slate-300 hover:bg-ink-800")}>{t}</button>
          ))}
        </div>
      </Card>
      <Card className="mt-5" title={`${table} as of ${labels[ref] ?? ""} — ${total} records`} right={
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Button variant="subtle" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          {total ? `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)}` : "0"}
          <Button variant="subtle" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data && <RecordTable rows={q.data.records} keyOf={(r) => r.key} />}
      </Card>
    </>
  );
}
