import { ReactNode, useState } from "react";
import { Check, Copy, Loader2, AlertTriangle } from "lucide-react";
import { shortHash } from "../lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight text-white">
          {icon && <span className="text-ok">{icon}</span>}
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-base text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-ink-700 bg-ink-900/80 p-5 shadow-lg shadow-black/20", className)}>
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "ghost" | "danger" | "subtle";
const variants: Record<Variant, string> = {
  primary: "bg-ok text-ink-950 hover:bg-emerald-300 font-semibold",
  danger: "bg-bad/90 text-white hover:bg-bad font-semibold",
  ghost: "border border-ink-600 text-slate-200 hover:bg-ink-800",
  subtle: "bg-ink-800 text-slate-200 hover:bg-ink-700",
};

export function Button({ children, onClick, variant = "ghost", busy, disabled, className, type = "button", title }: {
  children: ReactNode; onClick?: () => void; variant?: Variant; busy?: boolean; disabled?: boolean; className?: string; type?: "button" | "submit"; title?: string;
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[15px] transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], className)}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "ok" | "bad" | "warn" | "info" | "neutral"; className?: string }) {
  const tones = {
    ok: "bg-ok/15 text-ok border-ok/30",
    bad: "bg-bad/15 text-bad border-bad/30",
    warn: "bg-amber-400/15 text-amber-300 border-amber-400/30",
    info: "bg-sky-400/15 text-sky-300 border-sky-400/30",
    neutral: "bg-ink-800 text-slate-300 border-ink-600",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Hash({ value, head = 8, tail = 4, className }: { value?: string | null; head?: number; tail?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="font-mono text-slate-500">—</span>;
  return (
    <span className={cx("group inline-flex items-center gap-1.5 font-mono text-[0.92em] text-amber-200/90", className)} title={value}>
      {shortHash(value, head, tail)}
      <button
        className="text-slate-500 opacity-60 transition hover:text-slate-200 group-hover:opacity-100"
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
      <Loader2 className="h-5 w-5 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = (error as any)?.message ?? String(error);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-bad">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <span className="text-[15px]">{msg}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-600 px-6 py-10 text-center text-slate-400">{children}</div>;
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/80 p-5">
      <div className="flex items-center justify-between text-sm text-slate-400">
        {label}
        {icon}
      </div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-ink-600 bg-ink-850 px-3.5 py-2.5 text-[15px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-ok/70 focus:ring-2 focus:ring-ok/20";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
