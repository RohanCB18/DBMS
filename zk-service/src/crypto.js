// Cryptographic core shared by commit, verify and prove.
//
// Value encoding (a field element for every JSON value):
//   non-negative integer < 2^64  -> the integer itself (so range claims work)
//   anything else                -> sha256("<type>:<canonical text>") >> 8   (248 bits < BN254 prime)
//
// The same rules are implemented in the browser (web/src/lib/zk.ts) so an
// auditor can independently re-encode a human-readable claim.
import { createHash } from "node:crypto";
import { buildPoseidon } from "circomlibjs";

export const DEPTH = 13; // 8192 leaves
export const NFIELDS = 8;
const MAX_U64 = 2n ** 64n;

let poseidon;
let F;
export async function initCrypto() {
  poseidon = await buildPoseidon();
  F = poseidon.F;
  ZEROS = [0n];
  for (let i = 1; i <= DEPTH; i++) ZEROS.push(H([ZEROS[i - 1], ZEROS[i - 1]]));
}

export const H = (inputs) => F.toObject(poseidon(inputs));
let ZEROS = [];

const hashStr = (s) => BigInt("0x" + createHash("sha256").update(s, "utf8").digest("hex")) >> 8n;

export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

export function encodeValue(v) {
  if (typeof v === "bigint") return v >= 0n && v < MAX_U64 ? v : hashStr("i:" + v.toString());
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (v === null || v === undefined) return hashStr("null:");
  if (typeof v === "boolean") return hashStr("b:" + v);
  if (typeof v === "number") return hashStr("n:" + v);
  if (typeof v === "object") return hashStr("j:" + canonicalJson(v));
  return hashStr("s:" + String(v));
}

/** record = { table, pk, fields: [[name, value], ...] (<= NFIELDS), salt: "<decimal>" } */
export function recordWitness(record) {
  if (record.fields.length > NFIELDS) throw new Error(`record has more than ${NFIELDS} fields`);
  const names = [];
  const values = [];
  for (let i = 0; i < NFIELDS; i++) {
    const f = record.fields[i];
    names.push(f ? encodeValue(f[0]) : 0n);
    values.push(f ? encodeValue(f[1]) : 0n);
  }
  return { tableTag: encodeValue(record.table), pk: encodeValue(record.pk), names, values, salt: BigInt(record.salt) };
}

export function leafHash(record) {
  const w = recordWitness(record);
  const slots = w.names.map((n, i) => H([n, w.values[i]]));
  return H([w.tableTag, w.pk, ...slots, w.salt]);
}

/** Builds every level of a fixed-depth sparse Merkle tree. levels[0] = leaves. */
export function buildLevels(leaves) {
  if (leaves.length > 2 ** DEPTH) throw new Error(`more than ${2 ** DEPTH} records`);
  const levels = [leaves.map(BigInt)];
  for (let d = 0; d < DEPTH; d++) {
    const cur = levels[d];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(H([cur[i], i + 1 < cur.length ? cur[i + 1] : ZEROS[d]]));
    }
    levels.push(next);
  }
  return levels;
}

export const rootOf = (levels) => (levels[DEPTH].length ? levels[DEPTH][0] : ZEROS[DEPTH]);

export function merklePath(levels, index) {
  const pathElements = [];
  const pathIndices = [];
  let idx = index;
  for (let d = 0; d < DEPTH; d++) {
    const sib = idx ^ 1;
    pathElements.push(sib < levels[d].length ? levels[d][sib] : ZEROS[d]);
    pathIndices.push(idx & 1);
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

export const OPS = { eq: 0, gte: 1, lte: 2 };
