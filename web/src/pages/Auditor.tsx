// The auditor portal: deliberately a *different organisation's* page — minimal layout, light
// on the bank's branding. The two cryptographic checks run entirely in this browser:
//   1. snarkjs.groth16.verify(vkey, publicSignals, proof)       (pure maths)
//   2. re-encode the human-readable claim and compare with publicSignals (so the prover
//      cannot show one claim while the proof is about another)
// The anchor checks then ask the bank's public transparency log (and the external copy).
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, EyeOff, FileJson, Loader2, Scale, Upload, XCircle, PenLine, RotateCcw } from "lucide-react";
import { api, type ProofPackage } from "../lib/api";
import { bindClaim, groth16Verify, type ClaimCheck } from "../lib/zk";
import { cx } from "../components/ui";
import { cell, opText, shortHash } from "../lib/format";

type Step = { title: string; detail: string; state: "pending" | "running" | "ok" | "bad" | "skip"; extra?: React.ReactNode };

export default function Auditor() {
  const [pkg, setPkg] = useState<ProofPackage | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [claims, setClaims] = useState<ClaimCheck[]>([]);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(false);
  const runId = useRef(0);

  const load = useCallback((text: string) => {
    setError("");
    try {
      const p = JSON.parse(text);
      if (!p.proof || !p.publicSignals || !p.claim) throw new Error("not a ZK-TemporalDB proof package");
      setRaw(text);
      setPkg(p);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {   // ?proof=<id> — a link shared by the bank
    const id = new URLSearchParams(location.search).get("proof");
    if (id) api.proof(id).then((p) => load(JSON.stringify(p, null, 2))).catch((e) => setError(e.message));
  }, [load]);

  const run = useCallback(async (p: ProofPackage) => {
    const id = ++runId.current;          // a newer run (forged package, StrictMode re-run) supersedes this one
    const live = () => id === runId.current;
    const s: Step[] = [
      { title: "Groth16 proof is valid", detail: "snarkjs, in this browser, with the public verification key", state: "running" },
      { title: "Proof is about exactly this claim", detail: "claim re-encoded in this browser and compared with the public signals", state: "pending" },
      { title: "Root is anchored in the bank's transparency log", detail: "asks the bank's public ledger: was this root recorded for this commit?", state: "pending" },
    ];
    const set = (i: number, patch: Partial<Step>) => { s[i] = { ...s[i], ...patch }; if (live()) setSteps([...s]); };
    setSteps([...s]);
    setClaims([]);
    await new Promise((r) => setTimeout(r, 350));

    const g = await groth16Verify(p.proof, p.publicSignals);
    set(0, { state: g.ok ? "ok" : "bad", detail: `snarkjs.groth16.verify → ${g.ok} in ${g.ms} ms (no server involved)` });
    await new Promise((r) => setTimeout(r, 450));

    set(1, { state: "running" });
    const c = await bindClaim(p);
    if (live()) setClaims(c);
    await new Promise((r) => setTimeout(r, 450));
    set(1, { state: c.every((x) => x.ok) ? "ok" : "bad",
      detail: c.every((x) => x.ok) ? "all 6 public inputs match the stated claim" : `mismatch: ${c.filter((x) => !x.ok).map((x) => x.label).join(", ")}` });
    await new Promise((r) => setTimeout(r, 450));

    set(2, { state: "running" });
    try {
      const r = await api.verifyPackage(p);
      const anchored = r.checks.find((x) => x.check.startsWith("Root is the one anchored"));
      set(2, { state: anchored?.ok ? "ok" : "bad", detail: anchored?.ok ? `anchor #${p.anchor.seq} (${shortHash(p.anchor.entry_hash)}) holds this root; chain intact` : "the anchored root does not match (or the log is broken)" });
      const ext = r.checks.find((x) => x.check.startsWith("Anchor matches the externally"));
      if (ext) {
        s.push({ title: "Anchor matches the externally published copy", detail: r.external_anchor?.mode === "github" ? "published to a public GitHub repository" : "published outside the bank's database", state: ext.ok ? "ok" : "bad" });
        if (live()) setSteps([...s]);
      }
    } catch (e: any) {
      set(2, { state: "skip", detail: `bank ledger unreachable (${e.message}) — the cryptographic checks above still stand` });
    }
  }, []);

  useEffect(() => { if (pkg) run(pkg); }, [pkg, run]);

  const verdict = steps.length && steps.every((x) => x.state !== "running" && x.state !== "pending")
    ? (steps.every((x) => x.state === "ok" || x.state === "skip") && steps.slice(0, 2).every((x) => x.state === "ok") ? "valid" : "invalid") : null;

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-slate-900">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <Scale className="h-7 w-7 text-indigo-700" />
          <div>
            <div className="text-xl font-semibold">Independent Audit Office</div>
            <div className="text-sm text-slate-500">Zero-knowledge evidence verification · works without access to the bank's database</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {!pkg ? (
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) f.text().then(load); }}
            className={cx("rounded-3xl border-2 border-dashed bg-white p-14 text-center transition", drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300")}>
            <Upload className="mx-auto h-12 w-12 text-indigo-600" />
            <div className="mt-4 text-2xl font-semibold">Drop a proof package (.json)</div>
            <div className="mt-2 text-slate-500">…or choose a file, or paste the JSON below</div>
            <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 text-white hover:bg-indigo-800">
              <FileJson className="h-5 w-5" /> Choose file
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0]?.text().then(load)} />
            </label>
            <textarea className="mt-6 h-32 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" placeholder="{ ...proof package... }"
              onChange={(e) => e.target.value.trim().startsWith("{") && load(e.target.value)} />
            {error && <div className="mt-4 text-red-700">{error}</div>}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <section className="rounded-3xl bg-white p-7 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-wider text-slate-500">claim under review</div>
                {!editing ? (
                  <div className="mt-2 text-3xl font-semibold">
                    {pkg.claim.table} #{String(pkg.claim.pk)}: {pkg.claim.field} {opText[pkg.claim.op]} {String(pkg.claim.value)}
                    {pkg.claim.field.endsWith("_paise") && typeof pkg.claim.value === "number" && <span className="ml-2 text-xl text-slate-500">({cell(pkg.claim.field, pkg.claim.value)})</span>}
                  </div>
                ) : (
                  <ForgeEditor pkg={pkg} onApply={(p) => { setEditing(false); setPkg(p); }} onCancel={() => setEditing(false)} />
                )}
                <div className="mt-2 text-slate-500">as of commit <span className="font-mono">{pkg.commit_id}</span> · anchor #{pkg.anchor?.seq} · {pkg.protocol}</div>
                <div className="mt-4 flex gap-3">
                  {!editing && <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"><PenLine className="h-4 w-4" /> Try to forge the claim</button>}
                  <button onClick={() => raw && load(raw)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"><RotateCcw className="h-4 w-4" /> Original package</button>
                  <button onClick={() => { setPkg(null); setSteps([]); setClaims([]); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Load another</button>
                </div>
              </section>

              <section className="space-y-3">
                {steps.map((s, i) => (
                  <motion.div key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    className={cx("flex items-start gap-4 rounded-2xl border bg-white px-5 py-4 transition-colors",
                      s.state === "ok" && "border-emerald-400 bg-emerald-50", s.state === "bad" && "border-red-400 bg-red-50")}>
                    {s.state === "ok" ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" /> : s.state === "bad" ? <XCircle className="h-7 w-7 shrink-0 text-red-600" />
                      : s.state === "running" ? <Loader2 className="h-7 w-7 shrink-0 animate-spin text-indigo-600" /> : <span className="h-7 w-7 shrink-0 rounded-full border-2 border-slate-300" />}
                    <div><div className="text-lg font-semibold">{s.title}</div><div className="text-[15px] text-slate-600">{s.detail}</div></div>
                  </motion.div>
                ))}
              </section>

              <AnimatePresence>
                {verdict && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className={cx("rounded-3xl px-7 py-6 text-white shadow-lg", verdict === "valid" ? "bg-emerald-600" : "bg-red-600")}>
                    <div className="text-3xl font-bold">{verdict === "valid" ? "VERIFIED" : "REJECTED"}</div>
                    <div className="mt-1 text-lg opacity-90">{verdict === "valid"
                      ? "The bank has mathematically proven this statement about its historical records."
                      : "This package does not prove the stated claim."}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {claims.length > 0 && (
                <details className="rounded-2xl bg-white p-5 shadow-sm">
                  <summary className="cursor-pointer font-semibold">Public inputs: re-encoded claim vs proof</summary>
                  <table className="mt-3 w-full text-sm">
                    <tbody>
                      {claims.map((c) => (
                        <tr key={c.label} className="border-t border-slate-200">
                          <td className="py-1.5 pr-3 text-slate-500">{c.label}</td>
                          <td className="pr-3 font-mono">{shortHash(c.expected, 14, 6)}</td>
                          <td className="pr-3 font-mono">{shortHash(c.actual, 14, 6)}</td>
                          <td>{c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>

            <aside className="space-y-6">
              <section className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-wider text-emerald-700">what you learned</div>
                {verdict !== "valid" ? (
                  <div className="mt-2 text-lg text-slate-500">{verdict === "invalid" ? "Nothing — this package does not prove its claim." : "Checking…"}</div>
                ) : <div className="mt-2 text-lg">{pkg.claim.op === "eq"
                  ? <>Field <b>{pkg.claim.field}</b> of {pkg.claim.table} #{String(pkg.claim.pk)} was <b>{String(pkg.claim.value)}</b></>
                  : <>Field <b>{pkg.claim.field}</b> was {pkg.claim.op === "gte" ? "at least" : "at most"} <b>{String(pkg.claim.value)}</b> — not its exact value</>}
                  {" "}in the database state with root <span className="font-mono text-sm">{shortHash(pkg.root, 10, 4)}</span>.</div>}
              </section>
              <section className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500"><EyeOff className="h-4 w-4" /> what stayed hidden</div>
                <ul className="mt-3 space-y-1.5 text-slate-400">
                  {pkg.claim.op !== "eq" && <li className="line-through">the exact {pkg.claim.field}</li>}
                  <li className="line-through">every other field of this record</li>
                  <li className="line-through">the record's position in the database</li>
                  <li className="line-through">the random hiding salt</li>
                  <li className="line-through">all other customers, accounts and transactions</li>
                </ul>
                <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
                  The package is {new Blob([JSON.stringify(pkg.proof)]).size} bytes of proof + 6 public numbers. Verification needs only the public key at <span className="font-mono">/zk/verification_key.json</span>.
                </div>
              </section>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function ForgeEditor({ pkg, onApply, onCancel }: { pkg: ProofPackage; onApply: (p: ProofPackage) => void; onCancel: () => void }) {
  const [value, setValue] = useState(String(pkg.claim.value));
  const [pk, setPk] = useState(String(pkg.claim.pk));
  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <div className="text-sm text-amber-800">Change what the package <i>says</i> — the proof itself stays the same.</div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">primary key<input className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 font-mono" value={pk} onChange={(e) => setPk(e.target.value)} /></label>
        <label className="text-sm">value<input className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 font-mono" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      </div>
      <div className="flex gap-2">
        <button className="rounded-xl bg-amber-600 px-4 py-2 text-white hover:bg-amber-700"
          onClick={() => {
            const asNum = (orig: any, v: string) => (typeof orig === "number" && /^\d+$/.test(v) ? Number(v) : v);
            const claim = { ...pkg.claim, value: asNum(pkg.claim.value, value), pk: asNum(pkg.claim.pk, pk) };
            onApply({ ...pkg, claim, claim_text: `${claim.table} #${claim.pk}: ${claim.field} ${opText[claim.op]} ${claim.value}` });
          }}>Verify forged package</button>
        <button className="rounded-xl border border-slate-300 px-4 py-2" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
