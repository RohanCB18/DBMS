import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { GitMerge, Search, Wand2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, ApiError, type Conflict, type MergeResult } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, Empty, ErrorBox, Hash, PageHeader, cx, inputCls } from "../components/ui";
import { cell } from "../lib/format";

const ckey = (c: Conflict) => (c.field === null ? c.key : `${c.key}|${c.field}`);

export default function MergePage() {
  const branches = useQuery({ queryKey: ["branches"], queryFn: api.branches });
  const current = branches.data?.find((b) => b.current)?.name;
  const others = branches.data?.filter((b) => !b.current) ?? [];
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<MergeResult | null>(null);
  const [choice, setChoice] = useState<Record<string, "ours" | "theirs">>({});
  const [done, setDone] = useState<MergeResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { if (!source && others.length) setSource(others[others.length - 1].name); }, [others, source]);
  useEffect(() => { setPreview(null); setChoice({}); setDone(null); setError(null); }, [source]);

  const scenario = useAction((mode: "clean" | "conflict") => api.scenario(mode), (r) => `Prepared: '${r.source_branch}' diverged from '${r.target_branch}'`);
  const dry = useAction(() => api.merge(source, undefined, true));
  const merge = useAction(() => api.merge(source, choice), (r) => r.result === "merged" ? `Merged ${source} → commit ${r.commit_id}` : `Merge: ${r.result}`);

  const conflicts = preview?.conflicts ?? [];
  const unresolved = conflicts.filter((c) => !choice[ckey(c)]).length;

  return (
    <>
      <PageHeader title="Merge" icon={<GitMerge className="h-7 w-7" />}
        subtitle="Three-way merge of database states: base = lowest common ancestor (recursive CTE). Records and fields changed on only one side merge automatically; the same field changed differently on both sides is a conflict you resolve." />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Merge a branch">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[16rem] flex-1"><span className="mb-1.5 block text-sm text-slate-400">merge</span>
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="" disabled>choose a branch…</option>
                {others.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.head?.slice(0, 8)})</option>)}
              </select>
            </label>
            <span className="mb-3 text-slate-400">into <b className="text-white">{current}</b></span>
            <Button variant="subtle" disabled={!source} busy={dry.isPending}
              onClick={() => { setError(null); dry.mutate(undefined, { onSuccess: (r) => { setPreview(r); setDone(null); } }); }}>
              <Search className="h-4 w-4" /> Preview
            </Button>
            <Button variant="primary" disabled={!preview || unresolved > 0 || preview.result === "up-to-date"} busy={merge.isPending}
              onClick={() => merge.mutate(undefined, {
                onSuccess: (r) => { setDone(r); setPreview(null); setChoice({}); },
                onError: (e) => { setError(e); if (e instanceof ApiError && e.body?.conflicts) setPreview({ ...e.body, result: "conflicts" }); },
              })}>
              <GitMerge className="h-4 w-4" /> Merge
            </Button>
          </div>
          {error ? <div className="mt-4"><ErrorBox error={error} /></div> : null}

          {preview && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-[15px]">
                <Badge tone={preview.result === "conflicts" ? "bad" : "ok"} className="px-3 py-1 text-sm">{preview.result}</Badge>
                <span className="text-slate-400">base <Hash value={preview.base} head={10} tail={0} /></span>
                <span className="text-slate-400">ours <Hash value={preview.ours} head={10} tail={0} /></span>
                <span className="text-slate-400">theirs <Hash value={preview.theirs} head={10} tail={0} /></span>
              </div>
              {preview.result === "clean" && <p className="text-ok">No conflicts — {preview.records_changed_on_ours} record(s) will change on {current}. A merge commit with two parents will be created.</p>}
              {preview.result === "fast-forward" && <p className="text-ok">{current} has no new commits — it will simply move forward to {source} (no merge commit).</p>}
              {preview.result === "up-to-date" && <p className="text-slate-300">Already up to date.</p>}
              {conflicts.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-bad"><AlertTriangle className="h-5 w-5" /> {conflicts.length} conflict(s) — choose a side for each ({unresolved} left)</div>
                  <div className="space-y-2">
                    {conflicts.map((c) => {
                      const k = ckey(c);
                      return (
                        <div key={k} className="rounded-xl border border-ink-600 bg-ink-850 p-4">
                          <div className="font-mono text-[15px] text-white">{c.key}{c.field ? <span className="text-slate-400">.{c.field}</span> : <span className="text-bad"> (deleted on one side)</span>}</div>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            <div className="rounded-lg bg-ink-900 px-3 py-2 text-sm"><div className="text-xs text-slate-500">base</div><div className="font-mono text-slate-300">{show(c.field, c.base)}</div></div>
                            {(["ours", "theirs"] as const).map((side) => (
                              <button key={side} onClick={() => setChoice({ ...choice, [k]: side })}
                                className={cx("rounded-lg border px-3 py-2 text-left text-sm transition",
                                  choice[k] === side ? "border-ok bg-ok/10" : "border-ink-600 hover:bg-ink-800")}>
                                <div className="flex items-center justify-between text-xs text-slate-400">{side === "ours" ? `ours (${current})` : `theirs (${source})`}
                                  {choice[k] === side && <CheckCircle2 className="h-4 w-4 text-ok" />}</div>
                                <div className={cx("font-mono", side === "ours" ? "text-sky-300" : "text-violet-300")}>{show(c.field, c[side])}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {done && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mt-5 rounded-2xl border-2 border-ok/50 bg-ok/10 px-5 py-4 text-ok">
              <div className="text-xl font-semibold">{done.result === "merged" ? "Merged" : done.result}</div>
              {done.commit_id && <div className="mt-1 text-[15px]">commit <Hash value={done.commit_id} head={16} tail={0} />{done.result === "merged" && <> with parents <Hash value={done.ours} head={8} tail={0} /> + <Hash value={done.theirs} head={8} tail={0} /></>}</div>}
            </motion.div>
          )}
          {!branches.data?.length && <Empty>No branches.</Empty>}
        </Card>

        <Card title="Demo scenarios">
          <p className="mb-4 text-[15px] text-slate-400">Create two diverged branches from HEAD, then merge them here. Needs a clean working database.</p>
          <div className="space-y-3">
            <Button variant="subtle" className="w-full justify-start" busy={scenario.isPending && scenario.variables === "clean"} onClick={() => scenario.mutate("clean", { onSuccess: (r) => setSource(r.source_branch) })}>
              <Wand2 className="h-4 w-4 text-ok" /> Clean merge (different records)
            </Button>
            <Button variant="subtle" className="w-full justify-start" busy={scenario.isPending && scenario.variables === "conflict"} onClick={() => scenario.mutate("conflict", { onSuccess: (r) => setSource(r.source_branch) })}>
              <Wand2 className="h-4 w-4 text-bad" /> Conflict (same fields, PostgreSQL + MongoDB)
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function show(field: string | null, v: any) {
  if (v === null || v === undefined) return "∅ (absent)";
  if (field === null) return typeof v === "object" ? JSON.stringify(v).slice(0, 80) + "…" : String(v);
  return cell(field, v);
}
