import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ExternalLink, GitBranch, Search, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { NAV, NAV_ITEMS, navFor } from "../lib/nav";
import { Hash, Kbd, StatusDot, cx } from "./ui";

export function Layout() {
  const { pathname } = useLocation();
  const { data: st } = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 5000 });
  const dirty = st ? st.added.length + st.modified.length + st.deleted.length : 0;
  const [palette, setPalette] = useState(false);
  const here = navFor(pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <Backdrop />
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
          <div className="flex items-center gap-4 px-8 py-3.5">
            <div className="hidden items-center gap-2 text-sm text-slate-500 md:flex">
              <span>{here?.section ?? "ZK-TemporalDB"}</span>
              <span className="text-slate-700">/</span>
              <span className="font-medium text-slate-200">{here?.label ?? ""}</span>
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm">
                <GitBranch className="h-4 w-4 text-brand-violet" />
                <span className="font-semibold text-white">{st?.branch ?? "…"}</span>
              </span>
              <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-400 lg:flex">
                HEAD <Hash value={st?.head} />
              </span>
              <span className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
                dirty ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-ok/25 bg-ok/10 text-ok")}>
                <StatusDot tone={dirty ? "warn" : "ok"} pulse={!!dirty} />
                {st ? (dirty ? `${dirty} uncommitted` : "clean") : "…"}
              </span>
              <button onClick={() => setPalette(true)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-3 pr-2 text-sm text-slate-400 transition hover:border-white/20 hover:text-slate-200">
                <Search className="h-4 w-4" /> Jump to <Kbd>Ctrl K</Kbd>
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-8 py-8">
          <motion.div key={pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
      <AnimatePresence>{palette && <Palette onClose={() => setPalette(false)} />}</AnimatePresence>
    </div>
  );
}

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="blob animate-aurora-a" style={{ width: 620, height: 620, top: -220, right: -120, background: "radial-gradient(circle, rgba(52,211,153,0.35), transparent 65%)" }} />
      <div className="blob animate-aurora-b" style={{ width: 560, height: 560, top: 160, left: 180, background: "radial-gradient(circle, rgba(34,211,238,0.18), transparent 65%)" }} />
      <div className="blob animate-aurora-a" style={{ width: 700, height: 700, bottom: -320, right: 200, background: "radial-gradient(circle, rgba(167,139,250,0.22), transparent 65%)" }} />
      <div className="grid-lines" />
      <div className="noise" />
    </div>
  );
}

function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="sticky top-0 z-20 flex h-screen w-[17rem] shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/60 px-3 py-5 backdrop-blur-xl">
      <div className="mb-5 flex items-center gap-3 px-3">
        <Logo />
        <div>
          <div className="font-display text-[18px] font-semibold leading-tight tracking-tight text-white">ZK-TemporalDB</div>
          <div className="text-xs text-slate-500">git for databases · ZK proofs</div>
        </div>
      </div>
      <nav className="flex-1 space-y-3.5 overflow-y-auto pr-1">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-600">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, end }) => {
                const active = end ? pathname === to : pathname.startsWith(to);
                return (
                  <NavLink key={to} to={to} end={end}
                    className={cx("relative flex items-center gap-3 rounded-xl px-3 py-[7px] text-[14.5px] transition-colors",
                      active ? "text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100")}>
                    {active && (
                      <motion.span layoutId="nav-active" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        className="absolute inset-0 rounded-xl border border-ok/20 bg-gradient-to-r from-ok/[0.16] via-brand-cyan/[0.06] to-transparent">
                        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-ok to-brand-cyan shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                      </motion.span>
                    )}
                    <Icon className={cx("relative h-[18px] w-[18px]", active ? "text-ok" : "")} />
                    <span className="relative">{label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <Health />
      <a href="/audit" target="_blank" rel="noreferrer"
        className="group mt-2 flex items-center gap-3 rounded-xl border border-sky-400/25 bg-gradient-to-r from-sky-400/[0.12] to-brand-violet/[0.08] px-3 py-2.5 text-[14.5px] text-sky-100 transition hover:border-sky-300/50">
        <ShieldCheck className="h-[18px] w-[18px] text-sky-300" />
        Auditor portal
        <ExternalLink className="ml-auto h-4 w-4 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </a>
    </aside>
  );
}

function Health() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 15000 });
  const zk = useQuery({ queryKey: ["zk-health"], queryFn: api.zkHealth, refetchInterval: 15000, retry: false });
  const apiUp = !!stats.data;
  const rows: [string, boolean | undefined][] = [
    ["PostgreSQL", stats.isLoading ? undefined : apiUp],
    ["MongoDB", stats.isLoading ? undefined : apiUp],
    ["Neo4j", stats.isLoading ? undefined : !!stats.data?.neo4j.online],
    ["zk-service", zk.isLoading ? undefined : !!zk.data],
  ];
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
      title="Live health of the services behind the dashboard">
      {rows.map(([name, up]) => (
        <div key={name} className="flex items-center gap-2 text-[11.5px] text-slate-400">
          <StatusDot tone={up === undefined ? "neutral" : up ? "ok" : "bad"} pulse={up === true} />
          {name}
        </div>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <div className="relative">
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-ok to-brand-violet opacity-60 blur-md" />
      <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-ok via-brand-cyan to-brand-violet">
        {/* a tiny Merkle tree: root → 2 → 4 */}
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#04060c" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v4M12 9l-5 4M12 9l5 4M7 13l-2.5 5M7 13l2.5 5M17 13l-2.5 5M17 13l2.5 5" />
          <circle cx="12" cy="4.5" r="2" fill="#04060c" />
        </svg>
      </div>
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = [...NAV_ITEMS, { to: "/audit", label: "Auditor portal", section: "Zero knowledge", blurb: "verify a proof package in the browser", icon: ShieldCheck }];
    return t ? all.filter((i) => `${i.label} ${i.section} ${i.blurb}`.toLowerCase().includes(t)) : all;
  }, [q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setSel(0), [q]);
  const go = (to: string) => { onClose(); if (to === "/audit") window.open("/audit", "_blank"); else navigate(to); };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/70 px-4 pt-[14vh] backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.18 }} onClick={(e) => e.stopPropagation()}
        className="glass glow-border w-full max-w-xl overflow-hidden bg-ink-900/95">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <Search className="h-5 w-5 text-slate-500" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page…"
            className="flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-slate-500"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && items[sel]) go(items[sel].to);
            }} />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <li key={it.to}>
                <button onMouseEnter={() => setSel(i)} onClick={() => go(it.to)}
                  className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", i === sel ? "bg-ok/10" : "")}>
                  <span className={cx("grid h-9 w-9 place-items-center rounded-lg border", i === sel ? "border-ok/30 bg-ok/10 text-ok" : "border-white/10 bg-white/[0.03] text-slate-400")}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-white">{it.label}</span>
                    <span className="block truncate text-sm text-slate-500">{it.section} · {it.blurb}</span>
                  </span>
                  {i === sel && <ArrowRight className="h-4 w-4 text-ok" />}
                </button>
              </li>
            );
          })}
          {!items.length && <li className="px-3 py-6 text-center text-slate-500">No page matches “{q}”.</li>}
        </ul>
      </motion.div>
    </motion.div>
  );
}
