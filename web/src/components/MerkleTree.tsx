import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { shortHash } from "../lib/format";

/**
 * Decorative but faithful picture of a commit: 8 record leaves (PostgreSQL rows + MongoDB
 * documents) hashed pairwise up to one root. Every couple of seconds one leaf "changes" and the
 * path to the root lights up — any edit changes the root.
 */
const W = 480, H = 300;
const LEVELS = [1, 2, 4, 8];
const Y = [40, 112, 184, 252];
const LEAVES = ["PG", "PG", "PG", "MG", "PG", "PG", "MG", "PG"];

const xOf = (level: number, i: number) => (W / LEVELS[level]) * (i + 0.5);

export function MerkleTree({ root }: { root?: string | null }) {
  const [hot, setHot] = useState(5);
  useEffect(() => {
    const t = setInterval(() => setHot((h) => (h * 5 + 3) % 8), 2600);
    return () => clearInterval(t);
  }, []);
  const onPath = (level: number, i: number) => (hot >> (3 - level)) === i;

  const edges: { x1: number; y1: number; x2: number; y2: number; hot: boolean; key: string }[] = [];
  for (let level = 1; level < LEVELS.length; level++) {
    for (let i = 0; i < LEVELS[level]; i++) {
      edges.push({ x1: xOf(level, i), y1: Y[level], x2: xOf(level - 1, i >> 1), y2: Y[level - 1],
        hot: onPath(level, i), key: `${level}-${i}` });
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Merkle tree: records hash pairwise up to one root">
      <defs>
        <linearGradient id="mt-hot" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <radialGradient id="mt-root" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.55" /><stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </radialGradient>
        <filter id="mt-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      {/* edges */}
      {edges.map((e) => (
        <g key={e.key}>
          <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="rgba(148,163,184,0.2)" strokeWidth={1.5} />
          {e.hot && (
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="url(#mt-hot)" strokeWidth={2.5}
              strokeDasharray="6 6" className="animate-flow" filter="url(#mt-glow)" />
          )}
        </g>
      ))}

      {/* root halo */}
      <circle cx={xOf(0, 0)} cy={Y[0]} r={46} fill="url(#mt-root)" className="animate-pulse" />

      {/* internal nodes */}
      {LEVELS.slice(0, 3).map((n, level) =>
        Array.from({ length: n }, (_, i) => {
          const hotNode = onPath(level, i);
          const r = level === 0 ? 20 : 12;
          return (
            <motion.g key={`n${level}-${i}`} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 + (3 - level) * 0.12 + i * 0.03 }} style={{ transformOrigin: `${xOf(level, i)}px ${Y[level]}px` }}>
              <circle cx={xOf(level, i)} cy={Y[level]} r={r}
                fill={hotNode ? "#0c2a26" : "#0c1221"} stroke={hotNode ? "#34d399" : "rgba(148,163,184,0.35)"} strokeWidth={hotNode ? 2 : 1.25}
                filter={hotNode ? "url(#mt-glow)" : undefined} style={{ transition: "all .4s" }} />
              <text x={xOf(level, i)} y={Y[level] + 4} textAnchor="middle" fontSize={level === 0 ? 10.5 : 9.5}
                fontFamily="JetBrains Mono, monospace" fill={hotNode ? "#a7f3d0" : "#64748b"}>
                {level === 0 ? "ROOT" : "H"}
              </text>
            </motion.g>
          );
        }),
      )}

      {/* leaves */}
      {LEAVES.map((db, i) => {
        const hotLeaf = i === hot;
        const x = xOf(3, i);
        const color = db === "PG" ? "#38bdf8" : "#34d399";
        return (
          <motion.g key={`leaf${i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}>
            <rect x={x - 25} y={Y[3] - 16} width={50} height={32} rx={8}
              fill={hotLeaf ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.03)"}
              stroke={hotLeaf ? "#22d3ee" : "rgba(148,163,184,0.25)"} strokeWidth={hotLeaf ? 1.75 : 1}
              filter={hotLeaf ? "url(#mt-glow)" : undefined} style={{ transition: "all .4s" }} />
            <circle cx={x - 13} cy={Y[3]} r={3.5} fill={color} />
            <text x={x + 4} y={Y[3] + 4} textAnchor="middle" fontSize={11.5} fontFamily="JetBrains Mono, monospace" fill="#e2e8f0">{db}</text>
            {hotLeaf && (
              <motion.text key={hot} x={Math.min(Math.max(x, 44), W - 44)} y={Y[3] + 33} textAnchor="middle" fontSize={11} fill="#67e8f9"
                initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 2.4 }}>
                record changed
              </motion.text>
            )}
          </motion.g>
        );
      })}

      {/* root label */}
      <text x={xOf(0, 0) + 30} y={Y[0] - 10} fontSize={11} fill="#94a3b8">Merkle root of HEAD</text>
      <text x={xOf(0, 0) + 30} y={Y[0] + 7} fontSize={12.5} fontFamily="JetBrains Mono, monospace" fill="#fde68a">
        {root ? shortHash(root, 12, 6) : "—"}
      </text>
    </svg>
  );
}
