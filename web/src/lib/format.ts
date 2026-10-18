export const shortHash = (h?: string | null, head = 8, tail = 4) =>
  !h ? "—" : h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${tail > 0 ? h.slice(-tail) : ""}`;

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const inr = (paise: number) => inrFmt.format(paise / 100);

export const when = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

export const ago = (iso?: string) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** Values for display: money columns in rupees, objects as compact JSON. */
export function cell(column: string, v: any): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number" && column.endsWith("_paise")) return inr(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const opText = { eq: "=", gte: "≥", lte: "≤" } as const;
