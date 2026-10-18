import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Database, Leaf, ShieldCheck, Skull, Undo2, Ban } from "lucide-react";
import { api, type VerifyResult } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, Card, PageHeader } from "../components/ui";
import { Layers } from "../components/Layers";

export default function TamperLab() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const [attack, setAttack] = useState<any>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const tamper = useAction((mode: "blob" | "root" | "undo") => api.tamper(mode));
  const verify = useAction((ref: string) => api.verify(ref));

  const run = (mode: "blob" | "root" | "undo") =>
    tamper.mutate(mode, { onSuccess: (r) => { setAttack({ mode, ...r }); setResult(null); } });

  return (
    <>
      <PageHeader title="Tamper lab" icon={<Skull className="h-7 w-7" />}
        subtitle="Play the malicious insider with full database access. Then verify — the cryptography notices." />

      <div className="grid gap-5 md:grid-cols-3">
        <AttackButton icon={<Leaf className="h-8 w-8" />} title="Edit a committed record in MongoDB"
          text="Change txn #100600 in the snapshot store: ₹2,50,000 → ₹25,000." busy={tamper.isPending && tamper.variables === "blob"} onClick={() => run("blob")} />
        <AttackButton icon={<Database className="h-8 w-8" />} title="Rewrite a Merkle root in PostgreSQL"
          text="Try UPDATE vcs.commits — blocked by a trigger — then disable the trigger and do it anyway." busy={tamper.isPending && tamper.variables === "root"} onClick={() => run("root")} />
        <button onClick={() => run("undo")} disabled={tamper.isPending}
          className="flex flex-col items-start gap-3 rounded-2xl border border-ink-600 bg-ink-900 p-6 text-left transition hover:border-ok/50 hover:bg-ok/5 disabled:opacity-50">
          <Undo2 className="h-8 w-8 text-ok" />
          <span className="text-xl font-semibold text-white">Undo attacks</span>
          <span className="text-[15px] text-slate-400">Put the original blob and root back (for the next demo run).</span>
        </button>
      </div>

      {attack && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
          <Card title={attack.mode === "undo" ? "Undone" : "Attack performed"}>
            {attack.attack && <p className="text-xl text-bad">{attack.attack}</p>}
            {attack.first_attempt_blocked_by_trigger && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-amber-200">
                <Ban className="mt-0.5 h-5 w-5 shrink-0" />
                <div><div className="font-semibold">First attempt blocked by trigger</div><div className="font-mono text-sm">{attack.first_attempt_blocked_by_trigger}</div>
                  <div className="mt-1 text-sm text-amber-200/80">…so the attacker ran <span className="font-mono">ALTER TABLE vcs.commits DISABLE TRIGGER</span> and rewrote the root.</div></div>
              </div>
            )}
            {attack.undone && <ul className="text-ok">{attack.undone.length ? attack.undone.map((u: string) => <li key={u}>✓ {u}</li>) : <li>nothing to undo</li>}</ul>}
            {attack.hint && <p className="mt-3 text-slate-400">{attack.hint}</p>}
            <div className="mt-4">
              <Button variant="primary" className="px-6 py-3 text-base" busy={verify.isPending} disabled={!status.data?.head}
                onClick={() => verify.mutate(status.data!.head!, { onSuccess: setResult })}>
                <ShieldCheck className="h-5 w-5" /> Verify HEAD now
              </Button>
            </div>
          </Card>
        </motion.div>
      )}
      {result && <div className="mt-5"><Layers result={result} /></div>}
    </>
  );
}

function AttackButton({ icon, title, text, onClick, busy }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="flex flex-col items-start gap-3 rounded-2xl border border-bad/40 bg-bad/[0.06] p-6 text-left transition hover:border-bad hover:bg-bad/10 disabled:opacity-60">
      <span className="text-bad">{icon}</span>
      <span className="text-xl font-semibold text-white">{title}</span>
      <span className="text-[15px] text-slate-400">{text}</span>
      {busy && <span className="text-sm text-bad">attacking…</span>}
    </button>
  );
}
