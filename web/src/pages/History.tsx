import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, GitCompare, KeyRound, RotateCcw, ShieldCheck, X, GitBranchPlus } from "lucide-react";
import { api, type GraphData } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Badge, Button, Card, ErrorBox, Hash, PageHeader, Spinner, inputCls } from "../components/ui";
import { useVersionLabels } from "../components/CommitPicker";
import { when } from "../lib/format";

const LANE_COLORS = ["#34d399", "#a78bfa", "#38bdf8", "#fbbf24", "#f472b6", "#fb923c"];

type CommitNodeData = GraphData["nodes"][number] & { heads: string[]; color: string; label: string; selected: boolean; isHead: boolean; merge: boolean };

function CommitNode({ data }: NodeProps<Node<CommitNodeData>>) {
  return (
    <div className="w-[300px] rounded-xl border bg-ink-850 px-3.5 py-2.5 text-left shadow-lg transition"
      style={{ borderColor: data.selected ? data.color : "#2a3848", boxShadow: data.selected ? `0 0 0 2px ${data.color}55` : undefined }}>
      <Handle type="target" position={Position.Bottom} className="!opacity-0" />
      <Handle type="source" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: data.color, outline: data.isHead ? `3px solid ${data.color}44` : undefined }} />
        <span className="font-mono text-[13px] text-amber-200/90">{data.id.slice(0, 10)}</span>
        <span className="text-xs text-slate-500">{data.label}</span>
        {data.merge && <span className="rounded bg-violet-400/15 px-1.5 text-[11px] text-violet-300">merge</span>}
        <span className="ml-auto flex gap-1">
          {data.heads.map((h) => <span key={h} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-ink-950" style={{ background: data.color }}>{h}</span>)}
        </span>
      </div>
      <div className="mt-1 truncate text-[14px] text-slate-100">{data.message}</div>
      <div className="mt-1 flex gap-2 text-[12px]">
        <span className="text-ok">+{data.added ?? 0}</span><span className="text-amber-300">~{data.modified ?? 0}</span><span className="text-bad">−{data.deleted ?? 0}</span>
        {data.proofs > 0 && <span className="ml-auto text-sky-300">{data.proofs} proof{data.proofs > 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}
const nodeTypes = { commit: CommitNode };

export default function HistoryPage() {
  const graph = useQuery({ queryKey: ["graph"], queryFn: api.graphCommits });
  const log = useQuery({ queryKey: ["log"], queryFn: () => api.log() });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const labels = useVersionLabels();
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const g = graph.data;
    if (!g) return { nodes: [] as Node<CommitNodeData>[], edges: [] as Edge[] };
    const lanes: string[] = ["main"];
    g.nodes.forEach((n) => { if (!lanes.includes(n.branch)) lanes.push(n.branch); });
    const heads: Record<string, string[]> = {};
    g.branches.forEach((b) => { (heads[b.commit] ??= []).push(b.branch); });
    const parentsOf: Record<string, number> = {};
    g.edges.forEach((e) => { parentsOf[e.from] = (parentsOf[e.from] ?? 0) + 1; });
    const total = g.nodes.length;
    const nodes: Node<CommitNodeData>[] = g.nodes.map((n, i) => {
      const lane = lanes.indexOf(n.branch);
      const color = LANE_COLORS[lane % LANE_COLORS.length];
      return {
        id: n.id, type: "commit", position: { x: lane * 340, y: (total - 1 - i) * 110 },
        data: { ...n, heads: heads[n.id] ?? [], color, label: labels[n.id] ?? "", selected: n.id === selected,
          isHead: n.id === status.data?.head, merge: (parentsOf[n.id] ?? 0) > 1 },
      };
    });
    const colorOf = Object.fromEntries(nodes.map((n) => [n.id, n.data.color]));
    const edges: Edge[] = g.edges.map((e) => ({
      id: `${e.from}-${e.to}`, source: e.to, target: e.from, type: "smoothstep",
      style: { stroke: colorOf[e.from], strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: colorOf[e.from] },
    }));
    return { nodes, edges };
  }, [graph.data, labels, selected, status.data?.head]);

  return (
    <>
      <PageHeader title="History" icon={<GitBranch className="h-7 w-7" />}
        subtitle="The commit DAG, read from Neo4j. Each lane is a branch; merge commits have two parents. Click a commit for details."
        actions={<BranchBar />} />
      {graph.error && <ErrorBox error={graph.error} />}
      <div className="relative">
        <Card className="h-[72vh] p-0 overflow-hidden">
          {graph.isLoading ? <div className="p-6"><Spinner /></div> : (
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
              minZoom={0.2} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}>
              <Background color="#1c2735" gap={22} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </Card>
        <AnimatePresence>
          {selected && <CommitPanel key={selected} id={selected} log={log.data ?? []} graph={graph.data} label={labels[selected]} onClose={() => setSelected(null)} />}
        </AnimatePresence>
      </div>
    </>
  );
}

function CommitPanel({ id, log, graph, label, onClose }: { id: string; log: any[]; graph?: GraphData; label?: string; onClose: () => void }) {
  const nav = useNavigate();
  const c = log.find((x) => x.commit_id === id);
  const n = graph?.nodes.find((x) => x.id === id);
  const [branchName, setBranchName] = useState("");
  const restore = useAction((hard: boolean) => api.restore(id, true, hard), (r) => `Restored ${r.records} records from ${r.restored.slice(0, 10)}${r.branch_moved ? ` — ${r.branch_moved} moved here` : ""}`);
  const branch = useAction(() => api.createBranch(branchName, id), (b) => `Branch ${b.name} created at ${id.slice(0, 10)}`);
  const verify = useQuery({ queryKey: ["verify", id], queryFn: () => api.verify(id), enabled: false });

  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
      className="absolute right-4 top-4 bottom-4 z-10 w-[420px] overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900/95 p-5 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">commit {label}</div>
          <div className="mt-1 text-lg font-semibold text-white">{c?.message ?? n?.message}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <dl className="mt-4 space-y-2.5 text-[14px]">
        <Item k="id"><Hash value={id} head={16} tail={0} /></Item>
        <Item k="branch">{c?.branch_name}</Item>
        <Item k="author">{c?.author}</Item>
        <Item k="time">{when(c?.created_at)}</Item>
        <Item k="records">{c?.record_count}</Item>
        <Item k="Merkle root"><Hash value={c?.merkle_root} head={12} tail={6} /></Item>
        <Item k="anchor">#{c?.anchor_seq} <Hash value={c?.anchor_hash} /></Item>
        <Item k="parents">{c?.parents.length ? c.parents.map((p: string) => <div key={p}><Hash value={p} head={10} tail={0} /></div>) : "— (root commit)"}</Item>
        <Item k="changes">
          <span className="flex gap-2"><Badge tone="ok">+{n?.added ?? 0}</Badge><Badge tone="warn">~{n?.modified ?? 0}</Badge><Badge tone="bad">−{n?.deleted ?? 0}</Badge></span>
        </Item>
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="primary" busy={verify.isFetching} onClick={() => verify.refetch()}><ShieldCheck className="h-4 w-4" /> Verify</Button>
        <Button variant="subtle" disabled={!c?.parents.length} onClick={() => nav(`/diff?a=${c.parents[0]}&b=${id}`)}><GitCompare className="h-4 w-4" /> Diff parent</Button>
        <Button variant="subtle" onClick={() => nav(`/time-travel?ref=${id}`)}>Browse snapshot</Button>
        <Button variant="subtle" onClick={() => nav(`/prove?ref=${id}`)}><KeyRound className="h-4 w-4" /> Prove</Button>
      </div>
      {verify.data && (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${verify.data.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {verify.data.ok ? "All integrity layers OK" : `TAMPERED: ${verify.data.tampered_records.join(", ") || verify.data.layers.filter((l) => !l.ok).map((l) => l.layer).join(", ")}`}
        </div>
      )}

      <div className="mt-5 space-y-2 border-t border-ink-700 pt-4">
        <div className="text-xs uppercase tracking-wider text-slate-500">restore</div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" busy={restore.isPending} title="overwrite the live databases with this commit (branch stays put)"
            onClick={() => confirm("Overwrite the live databases with this commit? Uncommitted changes are discarded.") && restore.mutate(false)}>
            <RotateCcw className="h-4 w-4" /> Restore
          </Button>
          <Button variant="danger" busy={restore.isPending} title="restore and move the current branch here (reset --hard)"
            onClick={() => confirm("Reset the current branch to this commit (reset --hard)?") && restore.mutate(true)}>
            Reset branch here
          </Button>
        </div>
        <div className="text-xs uppercase tracking-wider text-slate-500 pt-2">new branch from here</div>
        <div className="flex gap-2">
          <input className={inputCls} placeholder="branch-name" value={branchName} onChange={(e) => setBranchName(e.target.value.toLowerCase())} />
          <Button variant="subtle" disabled={!branchName} busy={branch.isPending} onClick={() => branch.mutate(undefined)}><GitBranchPlus className="h-4 w-4" /></Button>
        </div>
      </div>
    </motion.aside>
  );
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex gap-3"><dt className="w-24 shrink-0 text-slate-500">{k}</dt><dd className="min-w-0 text-slate-200">{children}</dd></div>;
}

function BranchBar() {
  const branches = useQuery({ queryKey: ["branches"], queryFn: api.branches });
  const checkout = useAction((b: string) => api.checkout(b, true), (r) => `Checked out ${r.branch} (${r.records} records restored)`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {branches.data?.map((b) => (
        <button key={b.name} disabled={b.current || checkout.isPending}
          onClick={() => confirm(`Switch the working databases to branch '${b.name}'? Uncommitted changes are discarded.`) && checkout.mutate(b.name)}
          className={`rounded-xl border px-3 py-1.5 text-sm transition ${b.current ? "border-ok/50 bg-ok/10 text-ok" : "border-ink-600 text-slate-300 hover:bg-ink-800"}`}
          title={b.current ? "checked out" : "checkout"}>
          {b.current ? "● " : ""}{b.name}
        </button>
      ))}
    </div>
  );
}
