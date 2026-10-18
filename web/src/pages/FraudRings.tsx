import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Network, Snowflake, Search, KeyRound } from "lucide-react";
import { api, type Ring } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Spinner, inputCls } from "../components/ui";
import { CommitPicker } from "../components/CommitPicker";
import { inr } from "../lib/format";

export default function FraudRings() {
  const [ref, setRef] = useState("HEAD");
  const [minInr, setMinInr] = useState(100000);
  const [hours, setHours] = useState(24);
  const [args, setArgs] = useState({ ref: "HEAD", minInr: 100000, hours: 24 });
  const q = useQuery({ queryKey: ["rings", args], queryFn: () => api.rings(args.ref, args.minInr, args.hours) });
  const freeze = useAction((ids: number[]) => api.freeze(ids), (r) => `Frozen: ${r.frozen.join(", ") || "already frozen"} — commit to record it`);

  return (
    <>
      <PageHeader title="Fraud rings" icon={<Network className="h-7 w-7" />}
        subtitle="Neo4j as a graph engine for the business data: money that goes round in a cycle of large transfers within hours is a classic layering pattern. One Cypher pattern finds it." />
      <Card>
        <div className="grid items-end gap-4 md:grid-cols-[1fr_12rem_10rem_auto]">
          <label><span className="mb-1.5 block text-sm text-slate-400">snapshot</span>
            <div className="flex gap-2">
              <select className={inputCls + " w-32"} value={ref === "HEAD" ? "HEAD" : "commit"} onChange={(e) => setRef(e.target.value === "HEAD" ? "HEAD" : "")}>
                <option value="HEAD">HEAD</option><option value="commit">commit…</option>
              </select>
              {ref !== "HEAD" && <CommitPicker value={ref} onChange={setRef} />}
            </div>
          </label>
          <Field label="min. per hop (₹)"><input type="number" className={inputCls} value={minInr} onChange={(e) => setMinInr(Number(e.target.value))} /></Field>
          <Field label="within (hours)"><input type="number" className={inputCls} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
          <Button variant="primary" disabled={!ref} onClick={() => setArgs({ ref, minInr, hours })}><Search className="h-4 w-4" /> Search</Button>
        </div>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-ink-950 p-3 font-mono text-[13px] text-violet-200">
{`MATCH p = (a:Account) (()-[r:SENT WHERE r.amount >= $min AND r.status = 'COMPLETED']->()){3,5} (a)
// quantified path pattern: only large COMPLETED transfers are expanded, 3-5 hops back to the start,
// first and last transfer at most $hours apart`}
        </pre>
      </Card>

      <div className="mt-5 space-y-5">
        {q.isLoading ? <Spinner label="building the money-flow graph in Neo4j…" /> : q.error ? <ErrorBox error={q.error} /> :
          !q.data?.rings.length ? <Empty>No rings found with these thresholds.</Empty> :
            q.data.rings.map((ring, i) => (
              <motion.div key={ring.accounts.join("-")} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Card className="border-bad/40">
                  <div className="grid gap-6 lg:grid-cols-[440px_1fr]">
                    <RingDiagram ring={ring} />
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge tone="bad" className="px-3 py-1 text-sm">suspected layering ring</Badge>
                        <span className="text-xl font-semibold text-white">{inr(ring.total_amount)} in {ring.span_minutes} minutes</span>
                      </div>
                      <table className="mt-4 w-full text-[15px]">
                        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">txn</th><th>from → to</th><th>amount</th><th>time</th></tr></thead>
                        <tbody>
                          {ring.transfers.map((t) => (
                            <tr key={t.txn_id} className="border-t border-ink-800">
                              <td className="py-1.5 font-mono text-slate-300">{t.txn_id}</td>
                              <td className="font-mono text-slate-300">{t.from} → {t.to}</td>
                              <td className="text-amber-200">{inr(t.amount)}</td>
                              <td className="text-slate-400">{new Date(t.at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button variant="danger" busy={freeze.isPending}
                          onClick={() => confirm(`Freeze accounts ${ring.accounts.join(", ")}?`) && freeze.mutate(ring.accounts)}>
                          <Snowflake className="h-4 w-4" /> Freeze ring accounts
                        </Button>
                        <Link to={`/prove?table=accounts&pk=${ring.accounts[0]}&field=status&value=FROZEN`}
                          className="inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 py-2.5 text-[15px] text-sky-200 hover:bg-sky-400/20">
                          <KeyRound className="h-4 w-4" /> Prove “account {ring.accounts[0]} status = FROZEN”
                        </Link>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">After freezing, commit on the Overview page — then the auditor can be given a ZK proof of the freeze without seeing any balances.</p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
        {q.data?.graph && (
          <Card title="Money-flow graph">
            <div className="text-[15px] text-slate-400">Built from commit <span className="font-mono text-slate-200">{q.data.commit_id}</span>: {q.data.graph.accounts} accounts, {q.data.graph.transfers} transfers as (:Account)-[:SENT]→(:Account).</div>
          </Card>
        )}
      </div>
    </>
  );
}

function RingDiagram({ ring }: { ring: Ring }) {
  const n = ring.accounts.length, R = 120, cx0 = 230, cy0 = 200;
  const ang = ring.accounts.map((_, i) => -Math.PI / 2 + (2 * Math.PI * i) / n);
  const pos = ang.map((a) => [cx0 + R * Math.cos(a), cy0 + R * Math.sin(a)]);
  const labelPos = ang.map((a) => [cx0 + (R + 62) * Math.cos(a), cy0 + (R + 50) * Math.sin(a) + 4]);
  const idx = Object.fromEntries(ring.accounts.map((a, i) => [a, i]));
  return (
    <svg viewBox="0 0 460 400" className="w-full">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#f87171" />
        </marker>
      </defs>
      {ring.transfers.map((t, k) => {
        const [x1, y1] = pos[idx[t.from]], [x2, y2] = pos[idx[t.to]];
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
        const sx = x1 + ux * 34, sy = y1 + uy * 34, ex = x2 - ux * 36, ey = y2 - uy * 36;
        const mx = (sx + ex) / 2 - uy * 18, my = (sy + ey) / 2 + ux * 18;
        return (
          <g key={t.txn_id}>
            <motion.path d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`} fill="none" stroke="#f87171" strokeWidth={2.5} markerEnd="url(#arr)"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3 + k * 0.35, duration: 0.5 }} />
            <text x={mx} y={my} textAnchor="middle" className="fill-amber-200" fontSize="12">{inr(t.amount)}</text>
          </g>
        );
      })}
      {ring.accounts.map((a, i) => (
        <g key={a}>
          <circle cx={pos[i][0]} cy={pos[i][1]} r={32} fill="#131c28" stroke={ring.statuses[i] === "FROZEN" ? "#38bdf8" : "#f87171"} strokeWidth={2.5} />
          <text x={pos[i][0]} y={pos[i][1] - 2} textAnchor="middle" fontSize="11" className="fill-slate-200 font-mono">…{String(a).slice(-4)}</text>
          <text x={pos[i][0]} y={pos[i][1] + 12} textAnchor="middle" fontSize="9" className="fill-slate-400">{ring.statuses[i]}</text>
          <text x={labelPos[i][0]} y={labelPos[i][1]} textAnchor="middle" fontSize="13" className="fill-slate-300">{ring.owners[i]}</text>
        </g>
      ))}
    </svg>
  );
}
