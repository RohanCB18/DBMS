import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Boxes, CalendarClock, Database, GitCommitHorizontal, Leaf, Network, RotateCcw, Share2, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, Hash, PageHeader, Spinner, inputCls } from "../components/ui";
import { ago, shortHash } from "../lib/format";

const STORY = [
  ["Reset demo", "742 records across PostgreSQL + MongoDB fingerprinted into one Merkle root", "/"],
  ["Business day → Commit", "stored procedures settle txn #100600, KYC verified in MongoDB", "/"],
  ["Diff · Lineage · Time travel", "what changed, the history of one record (Neo4j), the past", "/diff"],
  ["Verify → Tamper lab", "an insider edits history — detected and pinpointed", "/tamper"],
  ["Prove → Auditor portal", "prove one fact about txn #100600, reveal nothing else", "/prove"],
  ["Merge · SQL · Fraud rings", "branches, SELECT on the past, graph analytics", "/merge"],
];

export default function Overview() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const [message, setMessage] = useState("End of business day");
  const [events, setEvents] = useState<string[]>([]);

  const day = useAction(() => api.businessDay(), (r) => `Business day done: ${r.events.length} events`);
  const commit = useAction(() => api.commit(message), (r) => <>Committed <b className="font-mono">{r.commit_id}</b> (+{r.summary.added} ~{r.summary.modified} −{r.summary.deleted})</>);
  const reset = useAction(() => api.reset(), (r) => <>Demo reset — {Object.values(r.seeded as Record<string, number>).reduce((a, b) => a + b, 0)} records, first commit <b className="font-mono">{shortHash(r.commit.commit_id)}</b></>);

  const st = status.data, s = stats.data;
  const dirty = st ? st.added.length + st.modified.length + st.deleted.length : 0;
  const head = log.data?.find((c) => c.commit_id === st?.head);

  return (
    <>
      <PageHeader title="Overview" icon={<Sparkles className="h-7 w-7" />}
        subtitle="Git for a multi-database bank: every commit is a Merkle root, anchored in a hash chain, provable in zero knowledge." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Working database" className="lg:col-span-2">
          {!st ? <Spinner /> : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3 text-[15px]">
                <Row k="Branch"><span className="font-semibold text-white">{st.branch}</span></Row>
                <Row k="HEAD commit"><Hash value={st.head} head={16} tail={0} /> {head && <span className="ml-2 text-slate-400">“{head.message}”</span>}</Row>
                <Row k="Merkle root"><Hash value={head?.merkle_root} head={14} tail={6} /></Row>
                <Row k="Anchor">{head ? <>#{head.anchor_seq} <Hash value={head.anchor_hash} /></> : "—"}</Row>
                <Row k="Uncommitted">
                  {dirty ? (
                    <span className="flex flex-wrap gap-2">
                      <Badge tone="ok">+{st.added.length} added</Badge>
                      <Badge tone="warn">~{st.modified.length} modified</Badge>
                      <Badge tone="bad">−{st.deleted.length} deleted</Badge>
                    </span>
                  ) : <Badge tone="ok">clean — matches HEAD</Badge>}
                </Row>
              </div>
              <div className="space-y-3">
                <Button variant="subtle" className="w-full justify-start" busy={day.isPending}
                  onClick={() => day.mutate(undefined, { onSuccess: (r) => setEvents(r.events) })}>
                  <CalendarClock className="h-5 w-5 text-sky-300" /> Run a business day
                </Button>
                <div className="flex gap-2">
                  <input className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="commit message" />
                  <Button variant="primary" busy={commit.isPending} disabled={!dirty || !message.trim()} onClick={() => commit.mutate(undefined)}>
                    <GitCommitHorizontal className="h-5 w-5" /> Commit
                  </Button>
                </div>
                <Button variant="ghost" className="w-full justify-start" busy={reset.isPending}
                  onClick={() => { if (confirm("Wipe all three databases and reload the demo bank?")) { setEvents([]); reset.mutate(undefined); } }}>
                  <RotateCcw className="h-5 w-5 text-amber-300" /> Reset demo
                </Button>
                {events.length > 0 && (
                  <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1 rounded-xl bg-ink-850 p-3 text-sm text-slate-300">
                    {events.map((e) => <li key={e}>• {e}</li>)}
                  </motion.ul>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Demo storyline">
          <ol className="space-y-2.5">
            {STORY.map(([t, d, to], i) => (
              <li key={t}>
                <Link to={to} className="flex gap-3 rounded-xl p-2 transition hover:bg-ink-800">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ok/15 text-sm font-semibold text-ok">{i + 1}</span>
                  <span><span className="block text-[15px] font-medium text-white">{t}</span><span className="text-sm text-slate-400">{d}</span></span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <DbCard name="PostgreSQL" role="live bank tables · commits · anchor chain" icon={<Database className="h-6 w-6" />} color="text-sky-300"
          rows={s ? [...Object.entries(s.postgres.live).map(([k, v]) => [k, v] as [string, number]),
            ["commits", s.postgres.commits], ["anchors", s.postgres.anchors], ["verify runs", s.postgres.verify_runs]] : []} />
        <DbCard name="MongoDB" role="KYC documents · content-addressed snapshots · proofs" icon={<Leaf className="h-6 w-6" />} color="text-ok"
          rows={s ? [["kyc_documents", s.mongo.kyc_documents], ["blobs (record versions)", s.mongo.blobs], ["trees (manifests)", s.mongo.trees],
            ["proofs issued", s.mongo.proofs], ["dedup ratio", s.mongo.dedup_ratio ? `×${s.mongo.dedup_ratio}` : "—"]] : []} />
        <DbCard name="Neo4j" role="commit DAG · record lineage · money flow" icon={<Network className="h-6 w-6" />} color="text-violet-300"
          rows={s ? (s.neo4j.online ? [...Object.entries(s.neo4j.nodes ?? {}).map(([k, v]) => [`:${k}`, v] as [string, number]), ["relationships", s.neo4j.relationships ?? 0]]
            : [["status", "offline"]]) : []} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Recent commits" right={<Link to="/history" className="text-sm text-ok hover:underline">open history →</Link>}>
          <ul className="divide-y divide-ink-800">
            {log.data?.slice(0, 6).map((c) => (
              <li key={c.commit_id} className="flex items-center gap-3 py-2.5 text-[15px]">
                {c.parents.length > 1 ? <Share2 className="h-4 w-4 rotate-90 text-violet-300" /> : <GitCommitHorizontal className="h-4 w-4 text-slate-500" />}
                <Hash value={c.commit_id} head={10} tail={0} />
                <span className="truncate text-slate-200">{c.message}</span>
                <span className="ml-auto shrink-0 text-sm text-slate-500">{c.branch_name} · {ago(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Activity since HEAD (trigger-fed change log)">
          {st && st.change_log.length ? (
            <ul className="max-h-72 space-y-1 overflow-auto font-mono text-sm">
              {st.change_log.map((c) => (
                <li key={c.change_id} className="flex gap-3">
                  <span className={c.op === "I" ? "text-ok" : c.op === "D" ? "text-bad" : "text-amber-300"}>{c.op}</span>
                  <span className="text-slate-300">{c.table_name}:{c.pk}</span>
                  <span className="ml-auto text-slate-500">{c.db_user}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-400">No SQL changes since the last commit.</p>}
        </Card>
      </div>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-baseline gap-4"><span className="w-32 shrink-0 text-slate-400">{k}</span><span className="min-w-0">{children}</span></div>;
}

function DbCard({ name, role, icon, color, rows }: { name: string; role: string; icon: React.ReactNode; color: string; rows: [string, string | number][] }) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-3">
        <span className={color}>{icon}</span>
        <div><div className="text-lg font-semibold text-white">{name}</div><div className="text-sm text-slate-400">{role}</div></div>
        <Boxes className="ml-auto h-5 w-5 text-slate-600" />
      </div>
      <dl className="space-y-1.5 text-[15px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between"><dt className="text-slate-400">{k}</dt><dd className="font-mono text-white">{v}</dd></div>
        ))}
      </dl>
    </Card>
  );
}
