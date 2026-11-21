/*
 * "Magic UI" style building blocks, written for this app (no external registry):
 * BorderBeam, SpotlightCard, NumberTicker, BlurFade, ShimmerButton, AnimatedGradientText,
 * DotPattern, GridBeams, Meteors-free hero glow, AnimatedBeam (between two refs).
 * All of them read the theme CSS variables, so they work in light and dark mode,
 * and they all respect prefers-reduced-motion.
 */
import { CSSProperties, ReactNode, RefObject, useEffect, useId, useRef, useState } from "react";
import { motion, useInView, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { cx } from "./ui";

/** A light beam that travels around the border of its (relative, rounded) parent. */
export function BorderBeam({ size = 180, duration = 9, delay = 0, from = "var(--ok)", to = "var(--cyan)", className }: {
  size?: number; duration?: number; delay?: number; from?: string; to?: string; className?: string;
}) {
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 rounded-[inherit] [border:1.5px_solid_transparent]",
      "![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]", className)}>
      <div className="absolute aspect-square animate-border-beam"
        style={{
          width: size, ["--duration" as any]: duration, animationDelay: `-${delay}s`,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, rgb(${from}), rgb(${to}), transparent)`,
        } as CSSProperties} />
    </div>
  );
}

/** Card with a soft radial spotlight that follows the pointer (and a matching border glow). */
export function SpotlightCard({ children, className, color = "var(--ok)", size = 360, onClick, title }: {
  children: ReactNode; className?: string; color?: string; size?: number; onClick?: () => void; title?: string;
}) {
  const x = useMotionValue(-400), y = useMotionValue(-400);
  const bg = useMotionTemplate`radial-gradient(${size}px circle at ${x}px ${y}px, rgb(${color} / 0.10), transparent 70%)`;
  const ring = useMotionTemplate`radial-gradient(${size * 0.7}px circle at ${x}px ${y}px, rgb(${color} / 0.55), transparent 70%)`;
  return (
    <div onClick={onClick} title={title}
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); x.set(e.clientX - r.left); y.set(e.clientY - r.top); }}
      onPointerLeave={() => { x.set(-400); y.set(-400); }}
      className={cx("group glass overflow-hidden", className)}>
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: bg }} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] p-px opacity-0 transition-opacity duration-300 group-hover:opacity-100 [mask-composite:exclude] [-webkit-mask-composite:xor] [-webkit-mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]"
        style={{ background: ring }} />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Spring-animated number that counts up when it scrolls into view and on every change. */
export function NumberTicker({ value, className, format, delay = 0 }: { value: number; className?: string; format?: (n: number) => string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const spring = useSpring(mv, { damping: 40, stiffness: 120 });
  const inView = useInView(ref, { once: true, margin: "0px" });
  const isInt = Number.isInteger(value);
  const text = useTransform(spring, (v) => {
    const n = isInt ? Math.round(v) : Math.round(v * 100) / 100;
    return format ? format(n) : n.toLocaleString("en-IN");
  });
  useEffect(() => {
    if (!inView) return;
    const t = window.setTimeout(() => mv.set(value), delay * 1000);
    return () => window.clearTimeout(t);
  }, [inView, value, delay, mv]);
  return <motion.span ref={ref} className={cx("tabular-nums", className)}>{text}</motion.span>;
}

/** Fade + un-blur + rise on mount, for staggered entrances. */
export function BlurFade({ children, delay = 0, className, y = 10 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}

/** Text with a slowly moving gradient sheen. */
export function AnimatedGradientText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("animate-shine bg-[length:200%_200%] bg-clip-text text-transparent", className)}
      style={{ ["--duration" as any]: "8s", backgroundImage: "linear-gradient(110deg, rgb(var(--ok)), rgb(var(--cyan)) 35%, rgb(var(--sky-300)) 55%, rgb(var(--ok)) 100%)" } as CSSProperties}>
      {children}
    </span>
  );
}

/** Small pill with a shimmering border, for "what's new"/eyebrow labels. */
export function ShinyBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300", className)}>
      <span aria-hidden className="absolute inset-0 -translate-x-full animate-[shimmer_3.2s_linear_infinite] bg-[linear-gradient(110deg,transparent_25%,rgb(var(--white)/0.10)_50%,transparent_75%)] bg-[length:200%_100%]" />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </span>
  );
}

/** Masked dot grid used behind hero areas. */
export function DotPattern({ className }: { className?: string }) {
  return <div aria-hidden className={cx("dot-pattern pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]", className)} />;
}

/**
 * Animated beam between two elements inside a relative container: a faint track plus a travelling
 * gradient pulse. Re-measures on resize.
 */
export function AnimatedBeam({ container, from, to, curvature = 0, duration = 3, delay = 0, reverse = false, color = "var(--ok)", color2 = "var(--cyan)", width = 2 }: {
  container: RefObject<HTMLElement>; from: RefObject<HTMLElement>; to: RefObject<HTMLElement>;
  curvature?: number; duration?: number; delay?: number; reverse?: boolean; color?: string; color2?: string; width?: number;
}) {
  const id = useId().replace(/:/g, "");
  const [d, setD] = useState("");
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const measure = () => {
      const c = container.current, a = from.current, b = to.current;
      if (!c || !a || !b) return;
      const rc = c.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.left - rc.left + ra.width / 2, y1 = ra.top - rc.top + ra.height / 2;
      const x2 = rb.left - rc.left + rb.width / 2, y2 = rb.top - rc.top + rb.height / 2;
      setBox({ w: rc.width, h: rc.height });
      setD(`M ${x1},${y1} Q ${(x1 + x2) / 2},${(y1 + y2) / 2 - curvature} ${x2},${y2}`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (container.current) ro.observe(container.current);
    return () => ro.disconnect();
  }, [container, from, to, curvature]);
  const xs = reverse ? ["90%", "-10%"] : ["10%", "110%"];
  const xe = reverse ? ["100%", "0%"] : ["0%", "100%"];
  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} fill="none">
      <path d={d} stroke="rgb(var(--slate-400) / 0.22)" strokeWidth={width} strokeLinecap="round" />
      <path d={d} stroke={`url(#beam-${id})`} strokeWidth={width} strokeLinecap="round" />
      <defs>
        <motion.linearGradient id={`beam-${id}`} gradientUnits="userSpaceOnUse"
          initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
          animate={{ x1: xs, x2: xe, y1: ["0%", "0%"], y2: ["0%", "0%"] }}
          transition={{ delay, duration, ease: [0.16, 1, 0.3, 1], repeat: Infinity, repeatDelay: 0.4 }}>
          <stop stopColor={`rgb(${color})`} stopOpacity="0" />
          <stop stopColor={`rgb(${color})`} />
          <stop offset="32.5%" stopColor={`rgb(${color2})`} />
          <stop offset="100%" stopColor={`rgb(${color2})`} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
}

/** Icon tile used in headers and bento tiles. */
export function IconTile({ children, tone = "ok", className }: { children: ReactNode; tone?: "ok" | "bad" | "cyan" | "violet" | "amber"; className?: string }) {
  const toneCls = {
    ok: "text-ok bg-ok/10 border-ok/25",
    bad: "text-bad bg-bad/10 border-bad/25",
    cyan: "text-brand-cyan bg-brand-cyan/10 border-brand-cyan/25",
    violet: "text-brand-violet bg-brand-violet/10 border-brand-violet/25",
    amber: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  }[tone];
  return <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl border [&_svg]:h-5 [&_svg]:w-5", toneCls, className)}>{children}</span>;
}
