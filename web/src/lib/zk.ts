// Browser-side verification for the auditor portal.
//
// encodeValue MUST match zk-service/src/crypto.js exactly — it turns the human-readable claim
// back into the field elements the proof commits to, so the auditor never has to trust the
// prover's `publicSignals`:
//   non-negative integer < 2^64  -> the integer itself
//   anything else                -> sha256("<type>:<canonical text>") >> 8
// publicSignals = [root, enc(table), enc(pk), enc(field), op, enc(value)]

const MAX_U64 = 2n ** 64n;
export const OPS = { eq: 0, gte: 1, lte: 2 } as const;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hashStr = async (s: string) => BigInt("0x" + (await sha256Hex(s))) >> 8n;

export function canonicalJson(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

export async function encodeValue(v: any): Promise<bigint> {
  if (typeof v === "bigint") return v >= 0n && v < MAX_U64 ? v : hashStr("i:" + v.toString());
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (v === null || v === undefined) return hashStr("null:");
  if (typeof v === "boolean") return hashStr("b:" + v);
  if (typeof v === "number") return hashStr("n:" + v);
  if (typeof v === "object") return hashStr("j:" + canonicalJson(v));
  return hashStr("s:" + String(v));
}

export interface ClaimCheck { label: string; expected: string; actual: string; ok: boolean }

/** Re-encode the claim in the browser and compare it with the proof's public signals. */
export async function bindClaim(pkg: { root: string; claim: { table: string; pk: any; field: string; op: string; value: any }; publicSignals: string[] }): Promise<ClaimCheck[]> {
  const c = pkg.claim;
  const sig = pkg.publicSignals ?? [];
  const op = (OPS as any)[c.op];
  const rows: [string, string][] = [
    ["Merkle root", pkg.root],
    ["table", (await encodeValue(c.table)).toString()],
    ["primary key", (await encodeValue(c.pk)).toString()],
    ["field", (await encodeValue(c.field)).toString()],
    ["operator", op === undefined ? "?" : String(op)],
    ["value", (await encodeValue(c.value)).toString()],
  ];
  return rows.map(([label, expected], i) => ({ label, expected, actual: sig[i] ?? "", ok: sig[i] === expected }));
}

let vkeyCache: any;
export async function loadVkey(): Promise<any> {
  if (!vkeyCache) {
    const r = await fetch("/zk/verification_key.json");
    if (!r.ok) throw new Error("verification key not found at /zk/verification_key.json");
    vkeyCache = await r.json();
  }
  return vkeyCache;
}

/** Pure-maths Groth16 check in the browser (no server involved). */
export async function groth16Verify(proof: any, publicSignals: string[]): Promise<{ ok: boolean; ms: number }> {
  const [{ groth16 }, vkey] = await Promise.all([import("snarkjs"), loadVkey()]);
  const t0 = performance.now();
  let ok = false;
  try {
    ok = await groth16.verify(vkey, publicSignals, proof);
  } catch {
    ok = false;
  }
  return { ok, ms: Math.round(performance.now() - t0) };
}
