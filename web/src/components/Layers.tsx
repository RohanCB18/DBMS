import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import type { VerifyResult } from "../lib/api";
import { cx } from "./ui";

const EXPLAIN: Record<string, string> = {
  "1": "Each stored record still hashes (SHA-256) to its content address.",
  "2": "Each Merkle leaf recomputes (Poseidon) from the record + its hiding salt.",
  "3": "The leaves rebuild the Merkle root that PostgreSQL recorded for the commit.",
  "4": "The transparency log is an unbroken hash chain and holds the same root.",
  "5": "The anchor entry matches the copy published outside our infrastructure.",
};

/** The verification layers, revealed one by one for the projector (OK = green, BAD = red). */
export function Layers({ result, stagger = 550 }: { result: VerifyResult; stagger?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const timers = result.layers.map((_, i) => setTimeout(() => setShown(i + 1), (i + 1) * stagger));
    return () => timers.forEach(clearTimeout);
  }, [result, stagger]);
  const done = shown >= result.layers.length;

  return (
    <div className="space-y-3">
      {result.layers.map((l, i) => {
        const visible = i < shown;
        const n = l.layer.split(".")[0];
        return (
          <motion.div key={l.layer} layout
            className={cx("rounded-2xl border px-5 py-4 transition-colors duration-500",
              !visible ? "border-ink-700 bg-ink-900" : l.ok ? "border-ok/40 bg-ok/[0.07]" : "border-bad/60 bg-bad/[0.10]")}>
            <div className="flex items-center gap-4">
              {!visible ? <Loader2 className="h-7 w-7 animate-spin text-slate-500" />
                : l.ok ? <CheckCircle2 className="h-7 w-7 text-ok" /> : <XCircle className="h-7 w-7 text-bad" />}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-white">{l.layer}</div>
                <div className="text-sm text-slate-400">{EXPLAIN[n]}</div>
              </div>
              {visible && <span className={cx("text-lg font-bold", l.ok ? "text-ok" : "text-bad")}>{l.ok ? "OK" : "BAD"}</span>}
            </div>
            <AnimatePresence>
              {visible && !l.ok && l.issues.length > 0 && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-3 space-y-1 overflow-hidden pl-11 font-mono text-sm text-bad">
                  {l.issues.slice(0, 8).map((x, j) => (
                    <li key={j}>{x.key ? <b>{x.key}</b> : null}{x.key ? " — " : ""}{x.problem}{x.seq ? ` (anchor #${x.seq})` : ""}</li>
                  ))}
                  {l.issues.length > 8 && <li>… {l.issues.length - 8} more</li>}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            className={cx("flex items-center gap-4 rounded-2xl border-2 px-6 py-5",
              result.ok ? "border-ok/60 bg-ok/10 text-ok" : "border-bad/70 bg-bad/15 text-bad")}>
            {result.ok ? <ShieldCheck className="h-10 w-10" /> : <ShieldAlert className="h-10 w-10" />}
            <div>
              <div className="text-2xl font-bold">{result.ok ? "History is intact" : "TAMPERING DETECTED"}</div>
              <div className="text-[15px] opacity-90">
                {result.ok ? `commit ${result.commit_id} verifies on every layer`
                  : result.tampered_records.length ? `pinpointed: ${result.tampered_records.join(", ")}` : "the commit metadata / anchor log was rewritten"}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
