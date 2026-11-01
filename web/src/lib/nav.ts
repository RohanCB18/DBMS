import {
  LayoutDashboard, Table2, GitBranch, GitCompare, History, Route, ShieldCheck, Skull, KeyRound,
  GitMerge, Terminal, Network, type LucideIcon,
} from "lucide-react";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; blurb: string }
export interface NavSection { title: string; items: NavItem[] }

/** Sidebar structure — also used for page eyebrows and the Ctrl+K palette. */
export const NAV: NavSection[] = [
  { title: "Workspace", items: [
    { to: "/", label: "Overview", icon: LayoutDashboard, end: true, blurb: "status, demo controls, the three databases" },
    { to: "/live", label: "Live data", icon: Table2, blurb: "current rows and KYC documents" },
  ] },
  { title: "Version control", items: [
    { to: "/history", label: "History", icon: GitBranch, blurb: "commit graph from Neo4j" },
    { to: "/diff", label: "Diff", icon: GitCompare, blurb: "record and field changes between commits" },
    { to: "/time-travel", label: "Time travel", icon: History, blurb: "browse or restore any past state" },
    { to: "/lineage", label: "Record lineage", icon: Route, blurb: "every version of one record" },
    { to: "/merge", label: "Merge", icon: GitMerge, blurb: "three-way merge with conflicts" },
  ] },
  { title: "Integrity", items: [
    { to: "/verify", label: "Verify", icon: ShieldCheck, blurb: "four independent tamper checks" },
    { to: "/tamper", label: "Tamper lab", icon: Skull, blurb: "play the malicious insider" },
  ] },
  { title: "Zero knowledge", items: [
    { to: "/prove", label: "Prove", icon: KeyRound, blurb: "Groth16 proof of one historical fact" },
  ] },
  { title: "Analytics", items: [
    { to: "/sql", label: "SQL console", icon: Terminal, blurb: "SELECT on any past commit" },
    { to: "/fraud", label: "Fraud rings", icon: Network, blurb: "money cycles found with Cypher" },
  ] },
];

export const NAV_ITEMS = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));

export function navFor(pathname: string) {
  return NAV_ITEMS.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
}
