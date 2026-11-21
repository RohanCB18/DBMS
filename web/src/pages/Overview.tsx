import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight, CalendarClock, Database, GitCommitHorizontal, KeyRound, Layers3, Leaf, Network, RotateCcw, Share2, ShieldCheck, Sparkles,
} from "lucide-react";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import { AnimatedNumber, Badge, Button, Card, Hash, Spinner, StatusDot, cx, inputCls } from "../components/ui";
import { AnimatedGradientText, BorderBeam, DotPattern, NumberTicker, ShinyBadge, SpotlightCard } from "../components/magic";
import { FlowDiagram } from "../components/FlowDiagram";
import { MerkleTree } from "../components/MerkleTree";
import { ago, shortHash } from "../lib/format";

const STORY: [string, string, string][] = [
  ["Reset demo", "742 records across PostgreSQL + MongoDB fingerprinted into one Merkle root", "/"],
  ["Business day → Commit", "stored procedures settle txn #100600, KYC verified in MongoDB", "/"],
  ["Diff · Lineage · Time travel", "what changed, the history of one record (Neo4j), the past", "/diff"],
  ["Verify → Tamper lab", "an insider edits history — detected and pinpointed", "/tamper"],
  ["Prove → Auditor portal", "prove one fact about txn #100600, reveal nothing else", "/prove"],
  ["SQL console · Fraud rings", "SELECT on the past, graph analytics with Neo4j", "/sql"],
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
      {/* ---------------------------------------------------------------- hero */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="glass relative mb-6 overflow-hidden p-0">
        <BorderBeam size={260} duration={12} />
        <BorderBeam size={260} duration={12} delay={6} from="var(--cyan)" to="var(--violet)" />
        <DotPattern className="left-1/2" />
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-ok/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-10 h-72 w-72 rounded-full bg-brand-cyan/15 blur-3xl" />
        <div className="relative grid items-center gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="p-8 lg:p-10">
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <ShinyBadge className="mb-5"><Sparkles className="h-3.5 w-3.5 text-ok" /> Git for databases, with cryptographic proof</ShinyBadge>
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 10, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.18, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-[2.3rem] font-bold leading-[1.1] tracking-tight text-white xl:text-[2.6rem]">
              One number vouches for<br /><AnimatedGradientText>every record you ever stored.</AnimatedGradientText>
            </motion.h1>
            <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-slate-400">
              Each commit hashes PostgreSQL rows and MongoDB documents into a single Merkle root, chains it in a
              tamper-evident log, and lets you prove one historical fact in zero knowledge — revealing nothing else.
            </p>
            <div className="mt-7 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="live records" value={s?.records_live} i={0} />
              <Kpi label="commits" value={s?.postgres.commits} i={1} />
              <Kpi label="ZK proofs" value={s?.mongo.proofs} i={2} />
              <Kpi label="dedup" value={s?.mongo.dedup_ratio ?? undefined} prefix="×" i={3} />
            </div>
          </div>
          <div className="relative h-[320px] px-4 py-4 lg:h-[380px] lg:pl-0 lg:pr-6">
            <MerkleTree root={head?.merkle_root} />
          </div>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------------- controls + story */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Working database" className="lg:col-span-2" right={st && (
          <span className={cx("flex items-center gap-2 text-sm", dirty ? "text-amber-300" : "text-ok")}>
            <StatusDot tone={dirty ? "warn" : "ok"} /> {dirty ? "uncommitted changes" : "matches HEAD"}
          </span>)}>
          {!st ? <Spinner /> : (
            <div className="grid gap-7 2xl:grid-cols-[1.15fr_1fr] md:grid-cols-2">
              <dl className="min-w-0 space-y-3.5 text-[15px]">
                <Row k="Branch"><span className="rounded-md bg-indigo-400/15 px-2 py-0.5 font-semibold text-indigo-200">{st.branch}</span></Row>
                <Row k="HEAD commit">
                  <Hash value={st.head} head={16} tail={0} />
                  {head && <div className="mt-0.5 text-sm text-slate-400">“{head.message}”</div>}
                </Row>
                <Row k="Merkle root"><Hash value={head?.merkle_root} head={14} tail={6} /></Row>
                <Row k="Anchor">{head ? <span className="flex items-center gap-2"><Badge tone="info">#{head.anchor_seq}</Badge><Hash value={head.anchor_hash} /></span> : "—"}</Row>
                <Row k="Uncommitted">
                  {dirty ? (
                    <span className="flex flex-wrap gap-2">
                      <Badge tone="ok">+{st.added.length} added</Badge>
                      <Badge tone="warn">~{st.modified.length} modified</Badge>
                      <Badge tone="bad">−{st.deleted.length} deleted</Badge>
                    </span>
                  ) : <Badge tone="ok" dot>clean — matches HEAD</Badge>}
                </Row>
              </dl>
              <div className="min-w-0 space-y-3">
                <ActionTile icon={<CalendarClock className="h-5 w-5" />} tone="sky" title="Run a business day"
                  text="stored procedures settle, transfer, reverse, freeze" busy={day.isPending}
                  onClick={() => day.mutate(undefined, { onSuccess: (r) => setEvents(r.events) })} />
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex gap-2">
                    <input className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="commit message" />
                    <Button variant="primary" busy={commit.isPending} disabled={!dirty || !message.trim()} onClick={() => commit.mutate(undefined)}>
                      <GitCommitHorizontal className="h-5 w-5" /> Commit
                    </Button>
                  </div>
                  <p className="mt-2 px-1 text-xs text-slate-500">hash every record → new Merkle root → anchor it</p>
                </div>
                <ActionTile icon={<RotateCcw className="h-5 w-5" />} tone="amber" title="Reset demo"
                  text="wipe all three databases, reload ZTDB Bank, first commit" busy={reset.isPending}
                  onClick={() => { if (confirm("Wipe all three databases and reload the demo bank?")) { setEvents([]); reset.mutate(undefined); } }} />
              </div>
              <AnimatePresence>
                {events.length > 0 && (
                  <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 overflow-hidden rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-4 text-sm text-slate-300 md:col-span-2">
                    {events.map((e, i) => (
                      <motion.li key={e} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                        className="flex gap-2"><span className="text-sky-300">▸</span>{e}</motion.li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </Card>

        <Card title="Demo storyline">
          <ol className="relative space-y-1">
            <span className="absolute bottom-4 left-[19px] top-4 w-px bg-gradient-to-b from-ok/60 via-brand-cyan/30 to-brand-violet/50" />
            {STORY.map(([t, d, to], i) => (
              <motion.li key={t} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.05 }}>
                <Link to={to} className="group relative flex gap-3 rounded-xl p-2 transition hover:bg-white/[0.04]">
                  <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ok/40 bg-ink-900 text-xs font-semibold text-ok group-hover:bg-ok group-hover:text-ink-950">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[14.5px] font-medium text-white">{t}
                      <ArrowRight className="h-3.5 w-3.5 -translate-x-1 text-ok opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" /></span>
                    <span className="text-[13px] leading-snug text-slate-500">{d}</span>
                  </span>
                </Link>
              </motion.li>
            ))}
          </ol>
        </Card>
      </div>

      {/* ---------------------------------------------------------------- how a commit flows */}
      <Card className="mt-6" title="How one commit flows through the three databases" right={<span className="hidden text-xs text-slate-500 md:block">live data path</span>}>
        <FlowDiagram />
      </Card>

      {/* ---------------------------------------------------------------- three databases */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <DbCard name="PostgreSQL" role="live bank tables · commits · anchor chain" icon={<Database className="h-6 w-6" />} accent="sky" delay={0}
          rows={s ? [...Object.entries(s.postgres.live).map(([k, v]) => [k, v] as [string, number]),
            ["commits", s.postgres.commits], ["anchors", s.postgres.anchors], ["verify runs", s.postgres.verify_runs]] : []} />
        <DbCard name="MongoDB" role="KYC documents · content-addressed snapshots · proofs" icon={<Leaf className="h-6 w-6" />} accent="emerald" delay={0.08}
          rows={s ? [["kyc_documents", s.mongo.kyc_documents], ["blobs (record versions)", s.mongo.blobs], ["trees (manifests)", s.mongo.trees],
            ["proofs issued", s.mongo.proofs], ["dedup ratio", s.mongo.dedup_ratio ? `×${s.mongo.dedup_ratio}` : "—"]] : []} />
        <DbCard name="Neo4j" role="commit DAG · record lineage · money flow" icon={<Network className="h-6 w-6" />} accent="violet" delay={0.16}
          offline={s ? !s.neo4j.online : false}
          rows={s ? (s.neo4j.online ? [...Object.entries(s.neo4j.nodes ?? {}).map(([k, v]) => [`:${k}`, v] as [string, number]), ["relationships", s.neo4j.relationships ?? 0]]
            : [["status", "offline"]]) : []} />
      </div>

      {/* ---------------------------------------------------------------- activity */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Recent commits" right={<Link to="/history" className="flex items-center gap-1 text-sm text-ok hover:underline">open history <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <ol className="relative">
            <span className="absolute bottom-3 left-[11px] top-3 w-px bg-white/10" />
            {log.data?.slice(0, 6).map((c, i) => (
              <motion.li key={c.commit_id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="relative flex items-center gap-3 py-2 text-[14.5px]">
                <span className={cx("relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                  i === 0 ? "border-ok/50 bg-ok/15 text-ok" : c.parents.length > 1 ? "border-brand-violet/50 bg-ink-900 text-violet-300" : "border-white/15 bg-ink-900 text-slate-500")}>
                  {c.parents.length > 1 ? <Share2 className="h-3 w-3 rotate-90" /> : <GitCommitHorizontal className="h-3 w-3" />}
                </span>
                <Hash value={c.commit_id} head={8} tail={0} />
                <span className="truncate text-slate-200">{c.message}</span>
                <span className="ml-auto shrink-0 text-[13px] text-slate-500">{c.branch_name} · {ago(c.created_at)}</span>
              </motion.li>
            ))}
            {!log.data?.length && <li className="text-slate-500">No commits yet — click Reset demo.</li>}
          </ol>
        </Card>
        <Card title="Activity since HEAD" right={<span className="text-xs text-slate-500">trigger-fed change log</span>}>
          {st && st.change_log.length ? (
            <ul className="max-h-72 space-y-1 overflow-auto pr-1 font-mono text-[13px]">
              {st.change_log.map((c) => (
                <li key={c.change_id} className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-white/[0.03]">
                  <span className={cx("grid h-5 w-5 place-items-center rounded text-[11px] font-bold",
                    c.op === "I" ? "bg-ok/15 text-ok" : c.op === "D" ? "bg-bad/15 text-bad" : "bg-amber-400/15 text-amber-300")}>{c.op}</span>
                  <span className="text-slate-300">{c.table_name}:{c.pk}</span>
                  <span className="ml-auto text-slate-600">{c.db_user}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-slate-400">
              <ShieldCheck className="h-5 w-5 text-ok" /> No SQL changes since the last commit.
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <QuickLink to="/verify" icon={<ShieldCheck className="h-5 w-5" />} title="Verify history" text="4 independent tamper checks" />
        <QuickLink to="/prove" icon={<KeyRound className="h-5 w-5" />} title="Prove a fact" text="Groth16, ~1 s, ~700 bytes" />
        <QuickLink to="/history" icon={<Layers3 className="h-5 w-5" />} title="Explore the DAG" text="commit history and branches from Neo4j" />
      </div>
    </>
  );
}

function Kpi({ label, value, prefix, i }: { label: string; value?: number; prefix?: string; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className="lift rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 backdrop-blur">
      <div className="font-display text-2xl font-bold tracking-tight text-white">
        {prefix}{typeof value === "number" ? <NumberTicker value={value} delay={0.3 + i * 0.07} /> : "—"}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </motion.div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="w-28 shrink-0 text-[13px] uppercase tracking-wide text-slate-500">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const tileTone = {
  sky: "text-sky-300 bg-sky-400/10 border-sky-400/25 group-hover:border-sky-300/60",
  amber: "text-amber-300 bg-amber-400/10 border-amber-400/25 group-hover:border-amber-300/60",
};

function ActionTile({ icon, title, text, onClick, busy, tone }: {
  icon: React.ReactNode; title: string; text: string; onClick: () => void; busy?: boolean; tone: keyof typeof tileTone;
}) {
  return (
    <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.985 }} onClick={onClick} disabled={busy}
      className="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 text-left transition hover:bg-white/[0.05] disabled:opacity-60">
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition", tileTone[tone])}>
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-white">{title}</span>
        <span className="block truncate text-[13px] text-slate-500">{text}</span>
      </span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-300" />
    </motion.button>
  );
}

const accents = {
  sky: { bar: "from-sky-400 to-cyan-300", tile: "bg-sky-400/10 text-sky-300 border-sky-400/25", glow: "bg-sky-400/20", spot: "var(--sky-400)" },
  emerald: { bar: "from-emerald-400 to-teal-300", tile: "bg-ok/10 text-ok border-ok/25", glow: "bg-ok/20", spot: "var(--ok)" },
  violet: { bar: "from-indigo-400 to-sky-300", tile: "bg-indigo-400/10 text-indigo-300 border-indigo-400/25", glow: "bg-indigo-400/20", spot: "var(--indigo-400)" },
};

function DbCard({ name, role, icon, accent, rows, delay, offline }: {
  name: string; role: string; icon: React.ReactNode; accent: keyof typeof accents; rows: [string, string | number][]; delay: number; offline?: boolean;
}) {
  const a = accents[accent];
  const max = Math.max(1, ...rows.map(([, v]) => (typeof v === "number" ? v : 0)));
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + delay }}>
    <SpotlightCard className="lift h-full p-0" color={a.spot}>
      <div className={cx("h-1 w-full bg-gradient-to-r", a.bar)} />
      <div className={cx("pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-2xl transition group-hover:opacity-100", a.glow)} />
      <div className="relative p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className={cx("grid h-11 w-11 place-items-center rounded-xl border", a.tile)}>{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-display text-lg font-semibold text-white">{name}
              <StatusDot tone={offline ? "bad" : "ok"} pulse={!offline} /></div>
            <div className="truncate text-[13px] text-slate-500">{role}</div>
          </div>
        </div>
        {!rows.length ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-5" />)}</div> : (
          <dl className="space-y-2 text-[14px]">
            {rows.map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between gap-3">
                  <dt className="truncate text-slate-400">{k}</dt>
                  <dd className="font-mono text-white">{typeof v === "number" ? <AnimatedNumber value={v} /> : v}</dd>
                </div>
                {typeof v === "number" && (
                  <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.04]">
                    <motion.div className={cx("h-full rounded-full bg-gradient-to-r", a.bar)} initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, (v / max) * 100)}%` }} transition={{ duration: 1, delay: 0.2 + delay }} />
                  </div>
                )}
              </div>
            ))}
          </dl>
        )}
      </div>
    </SpotlightCard>
    </motion.div>
  );
}

function QuickLink({ to, icon, title, text }: { to: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link to={to} className="block">
      <SpotlightCard className="lift p-4">
        <div className="flex items-center gap-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-ok/20 bg-gradient-to-br from-ok/20 to-brand-cyan/10 text-ok">{icon}</span>
          <span>
            <span className="block font-medium text-white">{title}</span>
            <span className="block text-[13px] text-slate-500">{text}</span>
          </span>
          <ArrowRight className="ml-auto h-4 w-4 text-slate-500 transition group-hover:translate-x-1 group-hover:text-ok" />
        </div>
      </SpotlightCard>
    </Link>
  );
}
