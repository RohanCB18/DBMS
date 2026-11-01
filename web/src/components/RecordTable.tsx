import { Fragment, useState } from "react";
import { cell } from "../lib/format";
import { cx } from "./ui";
import { JsonView } from "./JsonView";

const PILL: Record<string, string> = {
  COMPLETED: "bg-ok/12 text-ok border-ok/25", VERIFIED: "bg-ok/12 text-ok border-ok/25", ACTIVE: "bg-ok/12 text-ok border-ok/25",
  PENDING: "bg-amber-400/12 text-amber-300 border-amber-400/25",
  FAILED: "bg-bad/12 text-bad border-bad/25", REJECTED: "bg-bad/12 text-bad border-bad/25", CLOSED: "bg-bad/12 text-bad border-bad/25",
  REVERSED: "bg-brand-violet/12 text-violet-300 border-brand-violet/25",
  FROZEN: "bg-sky-400/12 text-sky-300 border-sky-400/25",
  true: "bg-ok/12 text-ok border-ok/25", false: "bg-white/[0.05] text-slate-400 border-white/10",
};
const PILL_COLS = new Set(["status", "kyc_status", "verified", "account_type", "channel"]);

/** Generic table for rows of records. Highlights rows whose key is in `highlight`. */
export function RecordTable({ rows, keyOf, highlight, onRowClick, maxHeight = "60vh" }: {
  rows: Record<string, any>[]; keyOf: (r: Record<string, any>) => string; highlight?: Map<string, "added" | "modified">;
  onRowClick?: (r: Record<string, any>) => void; maxHeight?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  const colSet = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => colSet.add(k)));
  const cols = [...colSet];
  const isNested = (v: any) => v && typeof v === "object";
  const render = (c: string, v: any) => {
    if (isNested(v)) return <span className="rounded bg-sky-400/10 px-1.5 py-0.5 font-mono text-xs text-sky-300">{"{…}"}</span>;
    const pill = PILL_COLS.has(c) ? PILL[String(v)] : undefined;
    if (pill) return <span className={cx("inline-flex rounded-full border px-2 py-0.5 text-[12px] font-medium", pill)}>{String(v)}</span>;
    if (PILL_COLS.has(c) && v != null) return <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[12px] text-slate-300">{String(v)}</span>;
    return cell(c, v);
  };
  return (
    <div className="overflow-auto rounded-xl border border-white/[0.07] bg-ink-950/40" style={{ maxHeight }}>
      <table className="w-full border-collapse text-left text-[14px]">
        <thead className="sticky top-0 z-10 bg-ink-850/95 text-[11px] uppercase tracking-[0.1em] text-slate-500 backdrop-blur">
          <tr>{cols.map((c) => <th key={c} className="whitespace-nowrap border-b border-white/[0.07] px-3.5 py-3 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = keyOf(r);
            const h = highlight?.get(k);
            return (
              <Fragment key={k}>
                <tr onClick={() => (onRowClick ? onRowClick(r) : setOpen(open === k ? null : k))}
                  className={cx("cursor-pointer border-t border-white/[0.04] transition-colors hover:bg-white/[0.04]",
                    h === "added" && "bg-ok/[0.08] shadow-[inset_3px_0_0_#34d399]", h === "modified" && "bg-amber-400/[0.08] shadow-[inset_3px_0_0_#fcd34d]")}>
                  {cols.map((c) => (
                    <td key={c} className={cx("whitespace-nowrap px-3.5 py-2.5", c.endsWith("_id") || c === "_id" || c === "key" ? "font-mono text-[13px] text-slate-300" : "text-slate-200")}>
                      {render(c, r[c])}
                    </td>
                  ))}
                </tr>
                {open === k && cols.some((c) => isNested(r[c])) && (
                  <tr className="bg-ink-900/80"><td colSpan={cols.length} className="px-4 py-3"><JsonView value={r} /></td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
