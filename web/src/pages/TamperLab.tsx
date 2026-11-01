import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, Database, Leaf, ShieldCheck, Skull, Terminal, Undo2 } from "lucide-react";
import { api, type VerifyResult } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, PageHeader, cx } from "../components/ui";
import { Layers } from "../components/Layers";

export default function TamperLab() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const [attack, setAttack] = useState<any>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const tamper = useAction((mode: "blob" | "root" | "undo") => api.tamper(mode));
  const verify = useAction((ref: string) => api.verify(ref));

  const run = (mode: "blob" | "root" | "undo") =>
    tamper.mutate(mode, { onSuccess: (r) => { setAttack({ mode, ...r }); setResult(null); } });
  const undo = attack?.mode === "undo";

  return (
    <>
      <PageHeader title="Tamper lab" icon={<Skull />}
        subtitle="Play the malicious insider with full database access. Then verify — the cryptography notices." />

      <div className="grid gap-5 md:grid-cols-3">
        <AttackCard n={1} icon={<Leaf className="h-7 w-7" />} db="MongoDB" title="Edit a committed record"
          text="Change txn #100600 in the snapshot store: ₹2,50,000 → ₹25,000."
          busy={tamper.isPending && tamper.variables === "blob"} onClick={() => run("blob")} />
        <AttackCard n={2} icon={<Database className="h-7 w-7" />} db="PostgreSQL" title="Rewrite a Merkle root"
          text="Try UPDATE vcs.commits — blocked by a trigger — then disable the trigger and do it anyway."
          busy={tamper.isPending && tamper.variables === "root"} onClick={() => run("root")} />
        <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} onClick={() => run("undo")} disabled={tamper.isPending}
          className="glass group flex flex-col items-start gap-3 p-6 text-left transition hover:border-ok/40 disabled:opacity-50">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-ok/30 bg-ok/10 text-ok"><Undo2 className="h-6 w-6" /></span>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ok/80">Reset</span>
          <span className="font-display text-xl font-semibold text-white">Undo attacks</span>
          <span className="text-[14.5px] text-slate-400">Put the original blob and root back (for the next demo run).</span>
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        {attack && (
          <motion.div key={attack.mode + (attack.attack ?? "")} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cx("mt-6 overflow-hidden rounded-2xl border", undo ? "border-ok/30 bg-ok/[0.04]" : "border-bad/40 bg-ink-950/80 shadow-[0_0_60px_-20px_rgba(251,113,133,0.55)]")}>
            <div className={cx("flex items-center gap-2 border-b px-5 py-2.5 font-mono text-xs", undo ? "border-ok/20 text-ok" : "border-bad/30 bg-bad/[0.08] text-rose-300")}>
              <Terminal className="h-4 w-4" /> {undo ? "restore.log" : "intrusion.log"}
              <span className="ml-auto flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-bad/70" /><i className="h-2.5 w-2.5 rounded-full bg-amber-300/70" /><i className="h-2.5 w-2.5 rounded-full bg-ok/70" /></span>
            </div>
            <div className="space-y-3 p-5 font-mono text-[14.5px]">
              {attack.attack && <p className="text-rose-200"><span className="text-bad">$ </span>{attack.attack}</p>}
              {attack.first_attempt_blocked_by_trigger && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-4 py-3 text-amber-200">
                  <Ban className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <div className="font-sans font-semibold">First attempt blocked by trigger</div>
                    <div className="text-sm">{attack.first_attempt_blocked_by_trigger}</div>
                    <div className="mt-1 font-sans text-sm text-amber-200/80">…so the attacker ran <span className="font-mono">ALTER TABLE vcs.commits DISABLE TRIGGER</span> and rewrote the root.</div>
                  </div>
                </div>
              )}
              {attack.undone && (
                <ul className="text-ok">{attack.undone.length ? attack.undone.map((u: string) => <li key={u}>✓ {u}</li>) : <li>nothing to undo</li>}</ul>
              )}
              {attack.hint && <p className="font-sans text-slate-400">{attack.hint}</p>}
              <div className="pt-1 font-sans">
                <Button variant={undo ? "primary" : "danger"} className="px-6 py-3 text-base" busy={verify.isPending} disabled={!status.data?.head}
                  onClick={() => verify.mutate(status.data!.head!, { onSuccess: setResult })}>
                  <ShieldCheck className="h-5 w-5" /> Verify HEAD now
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {result && <div className="mt-6"><Layers result={result} /></div>}
    </>
  );
}

function AttackCard({ n, icon, db, title, text, onClick, busy }: {
  n: number; icon: React.ReactNode; db: string; title: string; text: string; onClick: () => void; busy?: boolean;
}) {
  return (
    <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} onClick={onClick} disabled={busy}
      className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-bad/30 bg-gradient-to-b from-bad/[0.08] to-bad/[0.02] p-6 text-left transition hover:border-bad/70 hover:shadow-glow-bad disabled:opacity-60">
      <div className="hazard absolute inset-x-0 top-0 h-1.5 opacity-80" />
      <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-bad/20 opacity-0 blur-2xl transition group-hover:opacity-100" />
      <div className="relative flex w-full items-center justify-between">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-bad/40 bg-bad/10 text-bad">{icon}</span>
        <span className="rounded-full border border-bad/30 px-2.5 py-0.5 font-mono text-[11px] text-rose-300">ATTACK #{n}</span>
      </div>
      <span className="relative text-xs font-semibold uppercase tracking-[0.16em] text-rose-300/80">{db}</span>
      <span className="relative font-display text-xl font-semibold text-white">{title}</span>
      <span className="relative text-[14.5px] text-slate-400">{text}</span>
      {busy && <span className="relative flex items-center gap-2 text-sm text-bad"><Skull className="h-4 w-4 animate-pulse" /> attacking…</span>}
    </motion.button>
  );
}
