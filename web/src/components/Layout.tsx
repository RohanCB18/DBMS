import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Table2, GitBranch, GitCompare, History, Route, ShieldCheck, Skull, KeyRound,
  GitMerge, Terminal, Network, ExternalLink, Database,
} from "lucide-react";
import { api } from "../lib/api";
import { Hash, cx } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/live", label: "Live data", icon: Table2 },
  { to: "/history", label: "History", icon: GitBranch },
  { to: "/diff", label: "Diff", icon: GitCompare },
  { to: "/time-travel", label: "Time travel", icon: History },
  { to: "/lineage", label: "Record lineage", icon: Route },
  { to: "/verify", label: "Verify", icon: ShieldCheck },
  { to: "/tamper", label: "Tamper lab", icon: Skull },
  { to: "/prove", label: "Prove", icon: KeyRound },
  { to: "/merge", label: "Merge", icon: GitMerge },
  { to: "/sql", label: "SQL console", icon: Terminal },
  { to: "/fraud", label: "Fraud rings", icon: Network },
];

export function Layout() {
  const { data: st } = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 5000 });
  const dirty = st ? st.added.length + st.modified.length + st.deleted.length : 0;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-ink-700 bg-ink-900/70 px-3 py-5">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-ok/15 text-ok"><Database className="h-5 w-5" /></div>
          <div>
            <div className="text-[17px] font-semibold leading-tight text-white">ZK-TemporalDB</div>
            <div className="text-xs text-slate-500">git for databases + ZK proofs</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition",
                isActive ? "bg-ok/10 text-ok" : "text-slate-300 hover:bg-ink-800 hover:text-white")}>
              <Icon className="h-[18px] w-[18px]" /> {label}
            </NavLink>
          ))}
        </nav>
        <a href="/audit" target="_blank" rel="noreferrer"
          className="mt-3 flex items-center justify-between rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2.5 text-[15px] text-sky-200 hover:bg-sky-400/20">
          Auditor portal <ExternalLink className="h-4 w-4" />
        </a>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-5 border-b border-ink-700 bg-ink-950/85 px-8 py-3 backdrop-blur">
          <span className="flex items-center gap-2 text-[15px]"><GitBranch className="h-4 w-4 text-slate-400" />
            <span className="font-semibold text-white">{st?.branch ?? "…"}</span></span>
          <span className="text-[15px] text-slate-400">HEAD <Hash value={st?.head} /></span>
          <span className={cx("rounded-full px-3 py-1 text-sm", dirty ? "bg-amber-400/15 text-amber-300" : "bg-ok/10 text-ok")}>
            {st ? (dirty ? `${dirty} uncommitted change${dirty > 1 ? "s" : ""}` : "clean") : "…"}
          </span>
        </header>
        <main className="mx-auto max-w-[1500px] px-8 py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
