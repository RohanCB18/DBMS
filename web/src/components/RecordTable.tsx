import { Fragment, useState } from "react";
import { cell } from "../lib/format";
import { cx } from "./ui";
import { JsonView } from "./JsonView";

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
  return (
    <div className="overflow-auto rounded-xl border border-ink-700" style={{ maxHeight }}>
      <table className="w-full border-collapse text-left text-[14px]">
        <thead className="sticky top-0 z-10 bg-ink-800 text-xs uppercase tracking-wide text-slate-400">
          <tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = keyOf(r);
            const h = highlight?.get(k);
            return (
              <Fragment key={k}>
                <tr onClick={() => (onRowClick ? onRowClick(r) : setOpen(open === k ? null : k))}
                  className={cx("cursor-pointer border-t border-ink-800 transition hover:bg-ink-800/60",
                    h === "added" && "bg-ok/10", h === "modified" && "bg-amber-400/10")}>
                  {cols.map((c) => (
                    <td key={c} className={cx("whitespace-nowrap px-3 py-2", c.endsWith("_id") || c === "_id" || c === "key" ? "font-mono text-slate-300" : "text-slate-200")}>
                      {isNested(r[c]) ? <span className="font-mono text-xs text-sky-300">{"{…}"}</span> : cell(c, r[c])}
                    </td>
                  ))}
                </tr>
                {open === k && cols.some((c) => isNested(r[c])) && (
                  <tr className="bg-ink-850"><td colSpan={cols.length} className="px-4 py-3"><JsonView value={r} /></td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
