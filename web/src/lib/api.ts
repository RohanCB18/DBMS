// Typed client for the ZK-TemporalDB API. All paths are relative (/api/...): Vite proxies them
// in development and nginx in production.

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

const TOKEN_KEY = "ztdb.adminToken";
export function adminToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function setAdminToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ }
}

async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, any>): Promise<T> {
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]))
    : "";
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const tok = adminToken();
  if (tok) headers["X-Admin-Token"] = tok;
  const res = await fetch(`/api${path}${qs}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

// ------------------------------------------------------------------ types

export interface Status {
  branch: string; head: string | null; clean: boolean;
  added: string[]; modified: string[]; deleted: string[];
  change_log: { change_id: number; table_name: string; pk: string; op: string; changed_at: string; db_user: string }[];
}
export interface Commit {
  commit_id: string; branch_name: string; message: string; author: string; created_at: string;
  record_count: number; merkle_root: string; parents: string[]; anchor_seq: number; anchor_hash: string;
}
export interface CommitResult {
  commit_id: string; branch: string; root: string; parents: string[]; record_count: number;
  anchor: { seq: number; entry_hash: string }; external_anchor?: { mode: string; published: boolean };
  graph_synced: boolean; summary: { added: number; modified: number; deleted: number };
}
export interface Branch { name: string; head: string | null; current: boolean; created_at: string }
export interface FieldChange { field: string; old: any; new: any }
export interface Diff {
  from: string; to: string;
  added: { key: string; record: Record<string, any> }[];
  deleted: { key: string; record: Record<string, any> }[];
  modified: { key: string; changes: FieldChange[] }[];
  summary: { added: number; deleted: number; modified: number };
}
export interface Layer { layer: string; ok: boolean; issues: any[] }
export interface VerifyResult { commit_id: string; ok: boolean; root: string; layers: Layer[]; tampered_records: string[] }
export interface VerifyRun { run_id: number; commit_id: string; ok: boolean; details: any; ran_at: string }
export interface Anchor { seq: number; commit_id: string; merkle_root: string; prev_hash: string; entry_hash: string; anchored_at: string }
export interface Claim { table: string; pk: string | number; field: string; op: "eq" | "gte" | "lte"; value: any }
export interface ProofPackage {
  proof_id: string; commit_id: string; root: string;
  anchor: { seq: number; entry_hash: string; anchored_at: string };
  claim: Claim; claim_text: string; proof: any; publicSignals: string[];
  proving_ms: number; created_at: string; protocol: string;
}
export interface PackageCheck { valid: boolean; checks: { check: string; ok: boolean }[]; claim_text?: string; external_anchor?: any }
export interface GraphData {
  nodes: { id: string; message: string; author: string; branch: string; created_at: string; added: number; modified: number; deleted: number; proofs: number }[];
  edges: { from: string; to: string }[];
  branches: { branch: string; commit: string }[];
}
export interface Lineage {
  key: string;
  versions: { blob: string; kind: string; commit_id: string; message: string; created_at: string; proofs: string[] }[];
  deleted_in: { commit_id: string; created_at: string }[];
}
export interface Conflict { key: string; field: string | null; base: any; ours: any; theirs: any }
export interface MergeResult {
  result: "up-to-date" | "fast-forward" | "merged" | "clean" | "conflicts";
  branch: string; ours: string; theirs: string; base: string | null; commit_id?: string;
  conflicts?: Conflict[]; conflicts_resolved?: number; dry_run?: boolean; records_changed_on_ours?: number;
}
export interface SqlResult {
  commit_id: string; schema: string; columns: string[]; rows: any[][]; truncated: boolean;
  row_count: number; materialise_ms: number; query_ms: number; tables: string[];
}
export interface Ring {
  accounts: number[]; owners: string[]; statuses: string[];
  transfers: { txn_id: number; from: number; to: number; amount: number; at: string }[];
  total_amount: number; span_minutes: number;
}
export interface Stats {
  postgres: { live: Record<string, number>; commits: number; branches: number; anchors: number; verify_runs: number; verify_failures: number; uncommitted_changes: number; size_bytes: number };
  mongo: { kyc_documents: number; blobs: number; trees: number; proofs: number; record_versions_referenced: number; dedup_ratio: number | null };
  neo4j: { online: boolean; nodes?: Record<string, number>; relationships?: number; error?: string };
  records_live: number;
}

// ------------------------------------------------------------------ endpoints

export const api = {
  status: () => request<Status>("GET", "/status"),
  stats: () => request<Stats>("GET", "/stats"),
  commit: (message: string, author = "dashboard") => request<CommitResult>("POST", "/commit", { message, author }),
  log: (branch?: string, limit = 200) => request<Commit[]>("GET", "/log", undefined, { branch, limit }),
  diff: (a: string, b: string) => request<Diff>("GET", "/diff", undefined, { a, b }),
  records: (ref: string, table: string, offset: number, limit: number) =>
    request<{ commit_id: string; total: number; records: Record<string, any>[] }>("GET", `/commits/${ref}/records`, undefined, { table, offset, limit }),
  record: (ref: string, key: string) =>
    request<{ commit_id: string; key: string; blob: string; record: Record<string, any>; provable: { field: string; numeric: boolean }[]; folded: string[] }>(
      "GET", `/commits/${ref}/record/${encodeURIComponent(key)}`),
  branches: () => request<Branch[]>("GET", "/branches"),
  createBranch: (name: string, start?: string) => request<Branch>("POST", "/branches", { name, start }),
  checkout: (branch: string, force = false) => request<any>("POST", "/checkout", { branch, force }),
  restore: (ref: string, force = false, move_head = false) => request<any>("POST", "/restore", { ref, force, move_head }),
  merge: (source: string, resolutions?: Record<string, "ours" | "theirs">, dry_run = false) =>
    request<MergeResult>("POST", "/merge", { source, resolutions, dry_run }),
  verify: (ref: string) => request<VerifyResult>("POST", `/verify/${ref}`),
  verifyRuns: () => request<VerifyRun[]>("GET", "/verify-runs"),
  anchors: () => request<Anchor[]>("GET", "/anchors"),
  externalAnchors: () => request<{ mode: string; location?: string; recent: any[] }>("GET", "/anchors/external"),
  externalCheck: (seq: number, entry_hash: string) => request<any>("GET", `/anchors/external/${seq}`, undefined, { entry_hash }),
  prove: (body: { ref: string; table: string; pk: string; field: string; op: string; value: string | number }) =>
    request<ProofPackage>("POST", "/proofs", body),
  proofs: () => request<Omit<ProofPackage, "proof" | "publicSignals">[]>("GET", "/proofs"),
  proof: (id: string) => request<ProofPackage>("GET", `/proofs/${id}`),
  verifyPackage: (pkg: unknown) => request<PackageCheck>("POST", "/proofs/verify", pkg),
  graphCommits: () => request<GraphData>("GET", "/graph/commits"),
  lineage: (key: string) => request<Lineage>("GET", `/graph/records/${encodeURIComponent(key)}`),
  live: (table: string, limit = 100, offset = 0) => request<{ table: string; total: number; rows: Record<string, any>[] }>("GET", `/live/${table}`, undefined, { limit, offset }),
  sql: (ref: string, query: string) => request<SqlResult>("POST", "/sql", { ref, query }),
  rings: (ref = "HEAD", min_amount_inr = 100000, max_hours = 24) =>
    request<{ commit_id: string; rings: Ring[]; graph: any; cypher: string }>("GET", "/graph/fraud-rings", undefined, { ref, min_amount_inr, max_hours }),
  demoConfig: () => request<{ demo_mode: boolean; token_required: boolean }>("GET", "/demo/config"),
  reset: () => request<any>("POST", "/demo/reset"),
  businessDay: () => request<{ events: string[]; status: Status }>("POST", "/demo/business-day"),
  tamper: (mode: "blob" | "root" | "undo") => request<any>("POST", "/demo/tamper", { mode }),
  scenario: (mode: "clean" | "conflict") => request<any>("POST", "/demo/merge-scenario", { mode }),
  freeze: (account_ids: number[]) => request<any>("POST", "/demo/freeze", { account_ids }),
};

export const TABLES = ["transactions", "accounts", "customers", "bank_branches", "kyc_documents"] as const;
