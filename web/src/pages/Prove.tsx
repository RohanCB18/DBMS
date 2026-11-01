import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Download, EyeOff, KeyRound, ExternalLink, Loader2, Eye } from "lucide-react";
import { api, TABLES, type ProofPackage } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, ErrorBox, Field, Hash, PageHeader, inputCls } from "../components/ui";
import { CommitPicker, useVersionLabels } from "../components/CommitPicker";
import { ago, cell, opText } from "../lib/format";

const DEFAULT_PK: Record<string, string> = { transactions: "100600", accounts: "5001000001", customers: "1", bank_branches: "BLR001", kyc_documents: "KYC-0001" };

export function downloadJson(obj: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Prove() {
  const [params] = useSearchParams();
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const labels = useVersionLabels();
  const [ref, setRef] = useState(params.get("ref") ?? "");
  const [table, setTable] = useState(params.get("table") ?? "transactions");
  const [pk, setPk] = useState(params.get("pk") ?? "100600");
  const [field, setField] = useState(params.get("field") ?? "status");
  const [op, setOp] = useState<"eq" | "gte" | "lte">((params.get("op") as any) ?? "eq");
  const [value, setValue] = useState(params.get("value") ?? "COMPLETED");
  const [pkg, setPkg] = useState<ProofPackage | null>(null);

  useEffect(() => { if (!ref && log.data?.length) setRef(log.data[0].commit_id); }, [log.data, ref]);
  const rec = useQuery({ queryKey: ["record", ref, table, pk], queryFn: () => api.record(ref, `${table}:${pk}`), enabled: !!ref && !!pk, retry: false });
  const provable = rec.data?.provable ?? [];
  const numeric = provable.find((p) => p.field === field)?.numeric ?? false;
  useEffect(() => { if (!numeric && op !== "eq") setOp("eq"); }, [numeric, op]);
  useEffect(() => {
    if (rec.data && !provable.some((p) => p.field === field) && provable.length) setField(provable[0].field);
  }, [rec.data]); // eslint-disable-line

  const prove = useAction(() => api.prove({ ref, table, pk, field, op, value: numeric && /^\d+$/.test(value) ? Number(value) : value }),
    (p) => <>Proof generated in {p.proving_ms} ms</>);
  const proofs = useQuery({ queryKey: ["proofs"], queryFn: api.proofs });
  const hidden = useMemo(() => Object.keys(rec.data?.record ?? {}).filter((f) => f !== field), [rec.data, field]);

  return (
    <>
      <PageHeader title="Prove" icon={<KeyRound className="h-7 w-7" />}
        subtitle="Generate a Groth16 zero-knowledge proof that one field of one historical record satisfies a claim — revealing nothing else." />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card title="Claim">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="commit"><CommitPicker value={ref} onChange={setRef} /></Field></div>
            <Field label="table">
              <select className={inputCls} value={table} onChange={(e) => { setTable(e.target.value); setPk(DEFAULT_PK[e.target.value]); }}>
                {TABLES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="primary key"><input className={inputCls + " font-mono"} value={pk} onChange={(e) => setPk(e.target.value)} /></Field>
            <Field label="field" hint={rec.data?.folded.length ? `not individually provable (folded): ${rec.data.folded.join(", ")}` : undefined}>
              <select className={inputCls} value={field} onChange={(e) => setField(e.target.value)} disabled={!provable.length}>
                {provable.map((p) => <option key={p.field} value={p.field}>{p.field}{p.numeric ? " (numeric)" : ""}</option>)}
              </select>
            </Field>
            <Field label="operator" hint={numeric ? "range claims hide the exact value" : "range claims need a numeric field"}>
              <div className="flex gap-2">
                {(["eq", "gte", "lte"] as const).map((o) => (
                  <button key={o} disabled={o !== "eq" && !numeric} onClick={() => setOp(o)}
                    className={`flex-1 rounded-xl border py-2.5 text-lg font-semibold transition disabled:opacity-30 ${op === o ? "border-ok/60 bg-ok/15 text-ok shadow-[0_0_20px_-6px_rgba(52,211,153,0.6)]" : "border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]"}`}>{opText[o]}</button>
                ))}
              </div>
            </Field>
            <div className="md:col-span-2"><Field label="claimed value" hint={field.endsWith("_paise") ? "amounts are in paise (₹1 = 100 paise)" : undefined}>
              <input className={inputCls + " font-mono text-lg"} value={value} onChange={(e) => setValue(e.target.value)} />
            </Field></div>
          </div>
          {rec.error && <div className="mt-4"><ErrorBox error={rec.error} /></div>}
          <div className="mt-5 flex items-center gap-4">
            <Button variant="primary" className="px-6 py-3 text-base" busy={prove.isPending} disabled={!rec.data || !value}
              onClick={() => prove.mutate(undefined, { onSuccess: setPkg })}>
              <KeyRound className="h-5 w-5" /> Generate proof
            </Button>
            {prove.isPending && <span className="flex items-center gap-2 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> building witness & Groth16 proof (~1–2 s)…</span>}
          </div>
        </Card>

        <Card title="What the prover knows vs what the auditor will learn">
          {rec.data ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-ok/30 bg-gradient-to-br from-ok/[0.1] to-transparent p-4 shadow-[0_0_30px_-14px_rgba(52,211,153,0.6)]">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ok"><Eye className="h-4 w-4" /> revealed (the claim only)</div>
                <div className="font-mono text-lg text-white">{table} #{pk}: {field} {opText[op]} {field.endsWith("_paise") && /^\d+$/.test(value) ? cell(field, Number(value)) : value}</div>
                <div className="mt-1 text-sm text-slate-400">in commit {labels[ref]} <Hash value={ref} head={10} tail={0} /></div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-400"><EyeOff className="h-4 w-4" /> stays hidden</div>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[15px]">
                  {op !== "eq" && <li className="text-slate-500">exact <b>{field}</b> value: <span className="blur-sm">{cell(field, rec.data.record[field])}</span></li>}
                  {hidden.map((f) => <li key={f} className="text-slate-500">{f}: <span className="select-none blur-sm">{cell(f, rec.data.record[f])}</span></li>)}
                  <li className="text-slate-500">the random 248-bit salt</li>
                  <li className="text-slate-500">all {(log.data?.find((c) => c.commit_id === ref)?.record_count ?? 1) - 1} other records</li>
                </ul>
              </div>
            </div>
          ) : <p className="text-slate-400">Pick a record that exists in the commit.</p>}
        </Card>
      </div>

      {pkg && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
          <Card title="Proof package" glow className="overflow-hidden">
            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-ok/20 blur-3xl" />
            <div className="relative flex flex-wrap items-center gap-4">
              <motion.span initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-ok to-brand-cyan text-ink-950 shadow-glow"><KeyRound className="h-6 w-6" /></motion.span>
              <div className="font-display text-2xl font-semibold text-white">{pkg.claim_text}</div>
              <Badge tone="ok" dot>valid Groth16 proof</Badge>
            </div>
            <div className="mt-4 grid gap-4 text-[15px] md:grid-cols-4">
              <Metric k="proof size" v={`${new Blob([JSON.stringify(pkg.proof)]).size} bytes`} />
              <Metric k="proving time" v={`${pkg.proving_ms} ms`} />
              <Metric k="commit / anchor" v={<><Hash value={pkg.commit_id} head={8} tail={0} /> · #{pkg.anchor.seq}</>} />
              <Metric k="public signals" v={`${pkg.publicSignals.length} field elements`} />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => downloadJson(pkg, `proof-${pkg.proof_id}.json`)}><Download className="h-4 w-4" /> Download package (.json)</Button>
              <a href={`/audit?proof=${pkg.proof_id}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-gradient-to-r from-sky-400/15 to-brand-violet/10 px-4 py-2.5 text-[15px] text-sky-100 shadow-glow-cyan transition hover:brightness-125">
                <ExternalLink className="h-4 w-4" /> Open in auditor portal
              </a>
            </div>
          </Card>
        </motion.div>
      )}

      <Card className="mt-5" title="Issued proofs">
        <ul className="divide-y divide-ink-800">
          {proofs.data?.map((p) => (
            <li key={p.proof_id} className="flex items-center gap-4 py-2.5 text-[15px]">
              <span className="font-mono text-sm text-slate-500">{p.proof_id}</span>
              <span className="text-white">{p.claim_text}</span>
              <span className="text-sm text-slate-500">{labels[p.commit_id]} · {ago(p.created_at)}</span>
              <a href={`/audit?proof=${p.proof_id}`} target="_blank" rel="noreferrer" className="ml-auto text-sm text-sky-300 hover:underline">audit →</a>
            </li>
          ))}
          {!proofs.data?.length && <li className="py-2 text-slate-500">None yet.</li>}
        </ul>
      </Card>
    </>
  );
}

function Metric({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="relative rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"><div className="text-xs uppercase tracking-wide text-slate-500">{k}</div><div className="mt-1 font-display text-lg text-white">{v}</div></div>;
}
