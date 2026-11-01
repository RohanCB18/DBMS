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
      <div className="relative space-y-3">
      <span className="absolute bottom-8 left-[27px] top-8 w-0.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.span className={cx("block h-full w-full origin-top", result.ok ? "bg-gradient-to-b from-ok to-brand-cyan" : "bg-gradient-to-b from-ok via-amber-300 to-bad")}
          initial={{ scaleY: 0 }} animate={{ scaleY: Math.max(0, shown - 1) / Math.max(1, result.layers.length - 1) }} transition={{ duration: 0.45 }} />
      </span>
      {result.layers.map((l, i) => {
        const visible = i < shown;
        const [n, ...rest] = l.layer.split(". ");
        const name = rest.join(". ") || l.layer;
        return (
          <motion.div key={l.layer} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className={cx("relative rounded-2xl border px-4 py-4 backdrop-blur transition-all duration-500",
              !visible ? "border-white/[0.06] bg-white/[0.02]"
                : l.ok ? "border-ok/30 bg-ok/[0.06] shadow-[0_0_30px_-12px_rgba(52,211,153,0.5)]"
                  : "border-bad/50 bg-bad/[0.09] shadow-[0_0_40px_-10px_rgba(251,113,133,0.6)]")}>
            <div className="flex items-center gap-4">
              <span className={cx("relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold ml-[3px]",
                !visible ? "border-white/15 bg-ink-900 text-slate-500" : l.ok ? "border-ok bg-ok text-ink-950" : "border-bad bg-bad text-white")}>{n}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold text-white">{name}</div>
                <div className="text-sm text-slate-400">{EXPLAIN[n]}</div>
              </div>
              <AnimatePresence mode="wait">
                {!visible ? (
                  <motion.span key="wait" exit={{ opacity: 0 }}><Loader2 className="h-7 w-7 animate-spin text-slate-600" /></motion.span>
                ) : (
                  <motion.span key="done" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    className={cx("flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold", l.ok ? "bg-ok/15 text-ok" : "bg-bad/20 text-bad")}>
                    {l.ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}{l.ok ? "OK" : "BAD"}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {visible && !l.ok && l.issues.length > 0 && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-3 space-y-1 overflow-hidden pl-[46px] font-mono text-sm text-rose-200">
                  {l.issues.slice(0, 8).map((x, j) => (
                    <li key={j} className="flex gap-2"><span className="text-bad">✕</span><span>{x.key ? <b className="text-white">{x.key}</b> : null}{x.key ? " — " : ""}{x.problem}{x.seq ? ` (anchor #${x.seq})` : ""}</span></li>
                  ))}
                  {l.issues.length > 8 && <li>… {l.issues.length - 8} more</li>}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
      </div>
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className={cx("relative overflow-hidden rounded-2xl border px-6 py-6",
              result.ok ? "border-ok/50 bg-gradient-to-r from-ok/[0.16] via-ok/[0.06] to-brand-cyan/[0.08]"
                : "hazard border-bad/60 bg-bad/[0.12]")}>
            <div className={cx("pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full blur-3xl", result.ok ? "bg-ok/30" : "bg-bad/40")} />
            <div className="relative flex items-center gap-5">
              <motion.div initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}
                className={cx("grid h-16 w-16 shrink-0 place-items-center rounded-2xl", result.ok ? "bg-ok text-ink-950 shadow-glow" : "bg-bad text-white shadow-glow-bad")}>
                {result.ok ? <ShieldCheck className="h-9 w-9" /> : <ShieldAlert className="h-9 w-9" />}
              </motion.div>
              <div className="min-w-0">
                <div className={cx("font-display text-[1.75rem] font-bold tracking-tight", result.ok ? "text-white" : "text-rose-100")}>
                  {result.ok ? "History is intact" : "Tampering detected"}
                </div>
                <div className={cx("text-[15px]", result.ok ? "text-emerald-200/90" : "text-rose-200")}>
                  {result.ok ? <>commit <span className="font-mono">{result.commit_id}</span> verifies on every layer</>
                    : result.tampered_records.length ? <>pinpointed: <span className="font-mono font-semibold text-white">{result.tampered_records.join(", ")}</span></>
                      : "the commit metadata / anchor log was rewritten"}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
