import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Link2, ShieldCheck } from "lucide-react";
import { api, type VerifyResult } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, Hash, PageHeader } from "../components/ui";
import { CommitPicker, useVersionLabels } from "../components/CommitPicker";
import { Layers } from "../components/Layers";
import { ago, when } from "../lib/format";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const runs = useQuery({ queryKey: ["verify-runs"], queryFn: api.verifyRuns });
  const anchors = useQuery({ queryKey: ["anchors"], queryFn: api.anchors });
  const ext = useQuery({ queryKey: ["external"], queryFn: api.externalAnchors });
  const labels = useVersionLabels();
  const [ref, setRef] = useState(params.get("ref") ?? "");
  const [result, setResult] = useState<VerifyResult | null>(null);
  useEffect(() => { if (!ref && log.data?.length) setRef(log.data[0].commit_id); }, [log.data, ref]);
  const verify = useAction((r: string) => api.verify(r));

  return (
    <>
      <PageHeader title="Verify" icon={<ShieldCheck className="h-7 w-7" />}
        subtitle="Independent integrity layers. Editing history in any database — MongoDB blobs, PostgreSQL commit rows, the anchor log — breaks at least one, and the broken record is pinpointed." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div>
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[22rem] flex-1"><span className="mb-1.5 block text-sm text-slate-400">commit to verify</span>
                <CommitPicker value={ref} onChange={setRef} /></label>
              <Button variant="primary" className="px-6 py-3 text-base" busy={verify.isPending} disabled={!ref}
                onClick={() => verify.mutate(ref, { onSuccess: setResult })}>
                <ShieldCheck className="h-5 w-5" /> Verify
              </Button>
            </div>
          </Card>
          <div className="mt-5">{result && <Layers result={result} />}</div>
        </div>
        <div className="space-y-5">
          <Card title="Verification history">
            <ul className="max-h-80 space-y-2 overflow-auto">
              {runs.data?.map((r) => (
                <li key={r.run_id} className="flex items-center gap-2 text-sm">
                  <Badge tone={r.ok ? "ok" : "bad"}>{r.ok ? "OK" : "BAD"}</Badge>
                  <span className="font-mono text-slate-300">{r.commit_id.slice(0, 10)}</span>
                  <span className="text-slate-500">{labels[r.commit_id]}</span>
                  <span className="ml-auto text-slate-500">{ago(r.ran_at)}</span>
                </li>
              ))}
              {!runs.data?.length && <li className="text-slate-500">No runs yet.</li>}
            </ul>
          </Card>
          <Card title="Transparency log (anchor hash chain)" right={ext.data && ext.data.mode !== "off" ? <Badge tone="info"><Link2 className="h-3 w-3" />external: {ext.data.mode}</Badge> : undefined}>
            <ol className="max-h-96 space-y-2 overflow-auto text-sm">
              {anchors.data?.slice().reverse().map((a) => (
                <li key={a.seq} className="rounded-lg bg-ink-850 px-3 py-2">
                  <div className="flex items-center gap-2"><span className="font-semibold text-white">#{a.seq}</span>
                    <span className="font-mono text-slate-400">{a.commit_id.slice(0, 10)}</span><span className="ml-auto text-xs text-slate-500">{when(a.anchored_at)}</span></div>
                  <div className="mt-1 text-xs text-slate-500">prev <Hash value={a.prev_hash} /> → entry <Hash value={a.entry_hash} /></div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
