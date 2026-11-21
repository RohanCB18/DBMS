import { ReactNode, forwardRef, useRef } from "react";
import { motion } from "motion/react";
import { Database, FileCheck2, GitCommitHorizontal, KeyRound, Leaf, Network, ShieldCheck } from "lucide-react";
import { AnimatedBeam } from "./magic";
import { cx } from "./ui";

/**
 * The data path of one commit, drawn with animated beams:
 * PostgreSQL rows + MongoDB documents -> commit engine (SHA-256 blobs, Poseidon Merkle root, anchor)
 * -> Neo4j (commit DAG + lineage) and the zk-service (Groth16 proofs) -> the auditor.
 */
export function FlowDiagram() {
  const box = useRef<HTMLDivElement>(null);
  const pg = useRef<HTMLDivElement>(null), mg = useRef<HTMLDivElement>(null), core = useRef<HTMLDivElement>(null);
  const neo = useRef<HTMLDivElement>(null), zk = useRef<HTMLDivElement>(null), audit = useRef<HTMLDivElement>(null);

  return (
    <div ref={box} className="relative grid grid-cols-[1fr_auto_1fr_auto] items-center gap-y-10 px-2 py-6 sm:grid-cols-4 md:px-6">
      <div className="flex flex-col gap-10">
        <Node ref={pg} icon={<Database />} title="PostgreSQL" sub="bank rows · triggers" tone="sky" />
        <Node ref={mg} icon={<Leaf />} title="MongoDB" sub="KYC docs · blobs" tone="ok" />
      </div>
      <div className="flex justify-center">
        <Node ref={core} big icon={<GitCommitHorizontal />} title="Commit" sub="SHA-256 · Poseidon root · anchor" tone="ok" />
      </div>
      <div className="flex flex-col items-center gap-10">
        <Node ref={neo} icon={<Network />} title="Neo4j" sub="commit DAG · lineage" tone="indigo" />
        <Node ref={zk} icon={<KeyRound />} title="zk-service" sub="Groth16 proofs" tone="amber" />
      </div>
      <div className="flex justify-end">
        <Node ref={audit} icon={<ShieldCheck />} title="Auditor" sub="verifies in the browser" tone="sky" />
      </div>

      <AnimatedBeam container={box} from={pg} to={core} curvature={-30} duration={3.2} />
      <AnimatedBeam container={box} from={mg} to={core} curvature={30} duration={3.2} delay={0.4} />
      <AnimatedBeam container={box} from={core} to={neo} curvature={-30} duration={3.2} delay={1.2} color="var(--ok)" color2="var(--indigo-400)" />
      <AnimatedBeam container={box} from={core} to={zk} curvature={30} duration={3.2} delay={1.6} color="var(--ok)" color2="var(--amber-400)" />
      <AnimatedBeam container={box} from={zk} to={audit} curvature={20} duration={3.2} delay={2.4} color="var(--amber-400)" color2="var(--cyan)" />
      <div className="pointer-events-none absolute bottom-0 right-2 hidden items-center gap-1.5 text-[11px] text-slate-500 md:flex">
        <FileCheck2 className="h-3.5 w-3.5" /> proof package = Groth16 proof + public signals + anchored root
      </div>
    </div>
  );
}

const toneCls = {
  ok: "text-ok border-ok/30 bg-ok/10",
  sky: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  indigo: "text-indigo-300 border-indigo-400/30 bg-indigo-400/10",
  amber: "text-amber-300 border-amber-400/30 bg-amber-400/10",
};

const Node = forwardRef<HTMLDivElement, { icon: ReactNode; title: string; sub: string; tone: keyof typeof toneCls; big?: boolean }>(
  function Node({ icon, title, sub, tone, big }, ref) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="relative z-10 flex w-fit flex-col items-center text-center">
        <div ref={ref} className={cx("grid place-items-center rounded-2xl border bg-ink-850 shadow-panel",
          big ? "h-20 w-20 [&_svg]:h-9 [&_svg]:w-9" : "h-14 w-14 [&_svg]:h-6 [&_svg]:w-6")}>
          <span className={cx("grid h-full w-full place-items-center rounded-2xl border", toneCls[tone])}>{icon}</span>
        </div>
        <div className={cx("mt-2 font-semibold text-white", big ? "text-[15px]" : "text-[13.5px]")}>{title}</div>
        <div className="max-w-[10rem] text-[11.5px] leading-tight text-slate-500">{sub}</div>
      </motion.div>
    );
  },
);
