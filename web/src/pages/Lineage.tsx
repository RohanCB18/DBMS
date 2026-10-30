import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { KeyRound, Route, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Button, Card, Empty, ErrorBox, Hash, PageHeader, Spinner, inputCls } from "../components/ui";
import { useVersionLabels } from "../components/CommitPicker";
import { cell, when } from "../lib/format";

const EXAMPLES = ["transactions:100600", "customers:7", "kyc_documents:KYC-0007", "accounts:5001000001"];

export default function Lineage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get("key") ?? "transactions:100600");
  const key = params.get("key") ?? "transactions:100600";
  const labels = useVersionLabels();
  const q = useQuery({ queryKey: ["lineage", key], queryFn: () => api.lineage(key) });
  const versions = q.data?.versions ?? [];

  // Same key -> the URL does not change and the query would not re-run, so refetch explicitly
  // (also picks up versions committed since the last trace).
  const trace = (k: string) => {
    const next = k.trim();
    if (!next) return;
    setInput(next);
    if (next === key) q.refetch();
    else setParams({ key: next });
  };

  // field-level diff between consecutive versions
  const diffs = useQueries({
    queries: versions.slice(1).map((v, i) => ({
      queryKey: ["diff", versions[i].commit_id, v.commit_id],
      queryFn: () => api.diff(versions[i].commit_id, v.commit_id),
    })),
  });

  return (
    <>
      <PageHeader title="Record lineage" icon={<Route className="h-7 w-7" />}
        subtitle="Every version of one record and the commit that introduced it — a single graph traversal in Neo4j: (:Record)-[:HAS_VERSION]->(:Version)-[:INTRODUCED_IN]->(:Commit)." />
      <Card>
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); trace(input); }}>
          <input className={inputCls + " max-w-md font-mono"} value={input} onChange={(e) => setInput(e.target.value)} placeholder="table:primary_key" />
          <Button type="submit" variant="primary" busy={q.isFetching}><Search className="h-4 w-4" /> Trace</Button>
          <div className="flex flex-wrap items-center gap-2">
            {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => trace(x)}
              className="rounded-lg border border-ink-600 px-2.5 py-1 font-mono text-xs text-slate-300 hover:bg-ink-800">{x}</button>)}
          </div>
        </form>
      </Card>

      <div className="mt-6">
        {q.data && versions.length > 0 && (
          <p className="mb-4 text-slate-300">
            <span className="font-mono text-white">{key}</span>: {versions.length} version{versions.length > 1 ? "s" : ""}
            {q.data.deleted_in.length > 0 && <>, deleted in {q.data.deleted_in.length} commit{q.data.deleted_in.length > 1 ? "s" : ""}</>}
          </p>
        )}
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !versions.length ? <Empty>No versions of <span className="font-mono">{key}</span> in the graph.</Empty> : (
          <ol className="relative ml-4 border-l-2 border-ink-600">
            {versions.map((v, i) => {
              const d = i > 0 ? diffs[i - 1]?.data?.modified.find((m) => m.key === key) : undefined;
              return (
                <motion.li key={v.blob} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="relative mb-6 pl-8">
                  <span className={`absolute -left-[11px] top-1.5 h-5 w-5 rounded-full border-4 border-ink-950 ${v.kind === "added" ? "bg-ok" : "bg-amber-300"}`} />
                  <Card>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={v.kind === "added" ? "ok" : "warn"}>{v.kind}</Badge>
                      <span className="text-lg font-semibold text-white">{labels[v.commit_id]} · {v.message}</span>
                      <span className="text-sm text-slate-400">{when(v.created_at)}</span>
                      {v.proofs.length > 0 && <Badge tone="info"><KeyRound className="h-3 w-3" />{v.proofs.length} ZK proof{v.proofs.length > 1 ? "s" : ""}</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-5 text-sm text-slate-400">
                      <span>commit <Hash value={v.commit_id} head={10} tail={0} /></span>
                      <span>version blob <Hash value={v.blob} /></span>
                    </div>
                    {d && (
                      <div className="mt-3 space-y-1 text-[15px]">
                        {d.changes.map((c) => (
                          <div key={c.field}>
                            <span className="text-slate-400">{c.field}: </span>
                            <span className="font-mono text-bad line-through">{cell(c.field, c.old)}</span>
                            <span className="text-slate-500"> → </span>
                            <span className="font-mono text-ok">{cell(c.field, c.new)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Link to={`/time-travel?ref=${v.commit_id}&table=${key.split(":")[0]}`} className="text-sm text-ok hover:underline">view snapshot →</Link>
                      <Link to={`/prove?ref=${v.commit_id}&table=${key.split(":")[0]}&pk=${encodeURIComponent(key.split(":").slice(1).join(":"))}`} className="ml-3 text-sm text-sky-300 hover:underline">prove a fact about this version →</Link>
                    </div>
                  </Card>
                </motion.li>
              );
            })}
            {q.data!.deleted_in.map((x) => (
              <li key={x.commit_id} className="relative mb-6 pl-8">
                <span className="absolute -left-[11px] top-1.5 h-5 w-5 rounded-full border-4 border-ink-950 bg-bad" />
                <Card><Trash2 className="mr-2 inline h-4 w-4 text-bad" /> deleted in {labels[x.commit_id]} <Hash value={x.commit_id} /></Card>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
