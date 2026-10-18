import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, GitCompare, Minus, Plus, PenLine } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, inputCls } from "../components/ui";
import { CommitPicker } from "../components/CommitPicker";
import { JsonView } from "../components/JsonView";
import { cell } from "../lib/format";

export default function DiffPage() {
  const [params, setParams] = useSearchParams();
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const [a, setA] = useState(params.get("a") ?? "");
  const [b, setB] = useState(params.get("b") ?? "");
  const [filter, setFilter] = useState("");

  useEffect(() => {   // default: previous commit -> latest commit
    if (!a && !b && log.data && log.data.length) {
      setA(log.data[1]?.commit_id ?? log.data[0].commit_id);
      setB(log.data.length > 1 ? log.data[0].commit_id : "WORKING");
    }
  }, [log.data, a, b]);
  useEffect(() => { if (a && b) setParams({ a, b }, { replace: true }); }, [a, b, setParams]);

  const diff = useQuery({ queryKey: ["diff", a, b], queryFn: () => api.diff(a, b), enabled: !!a && !!b && a !== b });
  const d = diff.data;
  const match = (k: string) => !filter || k.toLowerCase().includes(filter.toLowerCase());

  return (
    <>
      <PageHeader title="Diff" icon={<GitCompare className="h-7 w-7" />}
        subtitle="Record- and field-level differences between two commits, or between a commit and the live database (WORKING)." />
      <Card>
        <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr_16rem]">
          <label><span className="mb-1.5 block text-sm text-slate-400">from</span><CommitPicker value={a} onChange={setA} /></label>
          <ArrowRight className="mb-3 hidden h-5 w-5 text-slate-500 md:block" />
          <label><span className="mb-1.5 block text-sm text-slate-400">to</span><CommitPicker value={b} onChange={setB} allowWorking /></label>
          <label><span className="mb-1.5 block text-sm text-slate-400">filter keys</span><input className={inputCls} placeholder="e.g. transactions:1006" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        </div>
      </Card>

      <div className="mt-5">
        {a === b && a ? <Empty>Pick two different commits.</Empty> : diff.isLoading ? <Spinner /> : diff.error ? <ErrorBox error={diff.error} /> : d && (
          <>
            <div className="mb-4 flex gap-3 text-[15px]">
              <Badge tone="ok" className="px-3 py-1 text-sm"><Plus className="h-3.5 w-3.5" />{d.summary.added} added</Badge>
              <Badge tone="warn" className="px-3 py-1 text-sm"><PenLine className="h-3.5 w-3.5" />{d.summary.modified} modified</Badge>
              <Badge tone="bad" className="px-3 py-1 text-sm"><Minus className="h-3.5 w-3.5" />{d.summary.deleted} deleted</Badge>
            </div>
            {d.summary.added + d.summary.modified + d.summary.deleted === 0 && <Empty>No differences.</Empty>}
            <div className="space-y-3">
              {d.modified.filter((m) => match(m.key)).map((m, i) => (
                <motion.div key={m.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.02 }}
                  className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] px-4 py-3">
                  <div className="mb-2 font-mono text-[15px] text-amber-200">~ {m.key}</div>
                  <table className="text-[15px]">
                    <tbody>
                      {m.changes.map((c) => (
                        <tr key={c.field}>
                          <td className="pr-6 text-slate-400">{c.field}</td>
                          <td className="pr-3"><span className="rounded bg-bad/15 px-2 py-0.5 font-mono text-bad line-through decoration-bad/50">{cell(c.field, c.old)}</span></td>
                          <td className="pr-3 text-slate-500">→</td>
                          <td><span className="rounded bg-ok/15 px-2 py-0.5 font-mono text-ok">{cell(c.field, c.new)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </motion.div>
              ))}
              {d.added.filter((x) => match(x.key)).map((x) => (
                <details key={x.key} className="rounded-xl border border-ok/25 bg-ok/[0.04] px-4 py-3">
                  <summary className="cursor-pointer font-mono text-[15px] text-ok">+ {x.key}</summary>
                  <div className="mt-2"><JsonView value={x.record} /></div>
                </details>
              ))}
              {d.deleted.filter((x) => match(x.key)).map((x) => (
                <details key={x.key} className="rounded-xl border border-bad/25 bg-bad/[0.04] px-4 py-3">
                  <summary className="cursor-pointer font-mono text-[15px] text-bad">− {x.key}</summary>
                  <div className="mt-2"><JsonView value={x.record} /></div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
