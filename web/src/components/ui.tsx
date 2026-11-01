import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { animate, motion } from "framer-motion";
import { Check, Copy, Loader2, AlertTriangle, Inbox } from "lucide-react";
import { shortHash } from "../lib/format";
import { navFor } from "../lib/nav";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Page title block: section eyebrow, glowing icon tile, gradient title, subtitle. */
export function PageHeader({ title, subtitle, icon, actions, eyebrow }: {
  title: string; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; eyebrow?: string;
}) {
  const { pathname } = useLocation();
  const section = eyebrow ?? navFor(pathname)?.section;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="flex items-start gap-4">
        {icon && (
          <div className="relative mt-1 shrink-0">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-ok/40 via-brand-cyan/20 to-brand-violet/40 blur-lg" />
            <div className="glow-border relative grid h-14 w-14 place-items-center rounded-2xl bg-ink-850 text-ok [&_svg]:h-7 [&_svg]:w-7">{icon}</div>
          </div>
        )}
        <div>
          {section && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-ok/80">{section}</div>}
          <h1 className="font-display text-[2.1rem] font-semibold leading-tight tracking-tight text-gradient">{title}</h1>
          {subtitle && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.div>
  );
}

export function Card({ children, className, title, right, glow }: {
  children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode; glow?: boolean;
}) {
  return (
    <section className={cx("glass p-6", glow && "glow-border", className)}>
      {(title || right) && (
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-ok to-brand-cyan" />{title}
          </h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "ghost" | "danger" | "subtle";
const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-ok to-brand-cyan text-ink-950 font-semibold shadow-glow hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(52,211,153,0.5),0_10px_40px_-6px_rgba(34,211,238,0.55)]",
  danger: "bg-gradient-to-r from-rose-500 to-bad text-white font-semibold shadow-glow-bad hover:brightness-110",
  ghost: "border border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.07]",
  subtle: "border border-white/[0.06] bg-ink-800/80 text-slate-200 hover:bg-ink-700",
};

export function Button({ children, onClick, variant = "ghost", busy, disabled, className, type = "button", title }: {
  children: ReactNode; onClick?: () => void; variant?: Variant; busy?: boolean; disabled?: boolean; className?: string; type?: "button" | "submit"; title?: string;
}) {
  return (
    <motion.button type={type} title={title} onClick={onClick} disabled={disabled || busy}
      whileTap={{ scale: disabled || busy ? 1 : 0.97 }}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[15px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100",
        variants[variant], className)}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  );
}

const toneCls = {
  ok: "bg-ok/10 text-ok border-ok/25",
  bad: "bg-bad/10 text-bad border-bad/30",
  warn: "bg-amber-400/10 text-amber-300 border-amber-400/25",
  info: "bg-sky-400/10 text-sky-300 border-sky-400/25",
  neutral: "bg-white/[0.04] text-slate-300 border-white/10",
};
const dotCls = { ok: "bg-ok", bad: "bg-bad", warn: "bg-amber-300", info: "bg-sky-300", neutral: "bg-slate-400" };

export function Badge({ children, tone = "neutral", className, dot }: {
  children: ReactNode; tone?: "ok" | "bad" | "warn" | "info" | "neutral"; className?: string; dot?: boolean;
}) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", toneCls[tone], className)}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", dotCls[tone])} />}
      {children}
    </span>
  );
}

/** A live indicator: solid dot with an expanding ring. */
export function StatusDot({ tone = "ok", pulse = true }: { tone?: "ok" | "bad" | "warn" | "neutral"; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse && <span className={cx("absolute inset-0 animate-pulse-ring rounded-full", dotCls[tone])} />}
      <span className={cx("relative h-2.5 w-2.5 rounded-full", dotCls[tone])} />
    </span>
  );
}

export function Hash({ value, head = 8, tail = 4, className }: { value?: string | null; head?: number; tail?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="font-mono text-slate-500">—</span>;
  return (
    <span className={cx("group inline-flex items-center gap-1.5 rounded-md font-mono text-[0.92em] text-amber-200/90", className)} title={value}>
      {shortHash(value, head, tail)}
      <button
        className="rounded p-0.5 text-slate-500 opacity-50 transition hover:bg-white/10 hover:text-slate-200 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
        }}
        aria-label="copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-slate-400">
      <span className="relative grid h-6 w-6 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-ok/20" />
        <Loader2 className="h-5 w-5 animate-spin text-ok" />
      </span>
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = (error as any)?.message ?? String(error);
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/[0.08] px-4 py-3 text-bad">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <span className="text-[15px]">{msg}</span>
    </motion.div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-12 text-center text-slate-400">
      <Inbox className="h-8 w-8 text-slate-600" />
      <div>{children}</div>
    </div>
  );
}

/** Counts up from the previous value whenever `value` changes. Non-numbers render as-is. */
export function AnimatedNumber({ value, className, format }: { value: number | string | null | undefined; className?: string; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const numeric = typeof value === "number" && Number.isFinite(value);
  useEffect(() => {
    if (!numeric) return;
    const controls = animate(from.current, value as number, {
      duration: 1.1, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { from.current = v; setShown(v); },
    });
    return () => controls.stop();
  }, [value, numeric]);
  if (!numeric) return <span className={className}>{value ?? "—"}</span>;
  const n = Number.isInteger(value) ? Math.round(shown) : Math.round(shown * 100) / 100;
  return <span className={cx("tabular-nums", className)}>{format ? format(n) : n.toLocaleString("en-IN")}</span>;
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between text-sm text-slate-400">
        {label}
        {icon}
      </div>
      <div className="mt-2 font-display text-3xl font-semibold text-white">
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </div>
      {sub && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{children}</kbd>;
}

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-ink-900/70 px-3.5 py-2.5 text-[15px] text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-white/20 focus:border-ok/60 focus:bg-ink-900 focus:ring-4 focus:ring-ok/10";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
