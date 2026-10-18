/** Small, readable JSON renderer for nested MongoDB documents and proof packages. */
export function JsonView({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-slate-500">null</span>;
  if (typeof value === "string") return <span className="text-emerald-300">"{value}"</span>;
  if (typeof value === "number") return <span className="text-sky-300">{value}</span>;
  if (typeof value === "boolean") return <span className="text-violet-300">{String(value)}</span>;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const open = Array.isArray(value) ? "[" : "{";
  const close = Array.isArray(value) ? "]" : "}";
  if (!entries.length) return <span className="text-slate-400">{open + close}</span>;
  return (
    <span className="font-mono text-[13px] leading-relaxed">
      <span className="text-slate-500">{open}</span>
      <div style={{ paddingLeft: 18 }}>
        {entries.map(([k, v]) => (
          <div key={k}>
            {!Array.isArray(value) && <span className="text-slate-400">{k}: </span>}
            <JsonView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
      <span className="text-slate-500">{close}</span>
    </span>
  );
}
