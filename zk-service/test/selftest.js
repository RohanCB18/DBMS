// End-to-end check of the circuit: build a tree, prove true claims, reject false ones.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { initCrypto, leafHash, buildLevels, rootOf, merklePath, recordWitness, encodeValue, OPS } from "../src/crypto.js";

const ART = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");
const vkey = JSON.parse(readFileSync(path.join(ART, "verification_key.json"), "utf8"));
await initCrypto();

const records = Array.from({ length: 50 }, (_, i) => ({
  table: "transactions",
  pk: 1000 + i,
  fields: [["amount_paise", 500000 + i * 1000], ["status", i % 2 ? "COMPLETED" : "PENDING"], ["from_account", 7]],
  salt: String(123456789n * BigInt(i + 1)),
}));
const leaves = records.map(leafHash);
const levels = buildLevels(leaves);

async function claim(i, field, op, value) {
  const r = records[i];
  const w = recordWitness(r);
  const { pathElements, pathIndices } = merklePath(levels, i);
  const input = {
    root: rootOf(levels), tableTag: w.tableTag, pk: w.pk, fieldName: encodeValue(field), op: OPS[op],
    claimValue: encodeValue(value), names: w.names, values: w.values, salt: w.salt,
    fieldIdx: r.fields.findIndex((f) => f[0] === field), pathElements, pathIndices,
  };
  const s = JSON.parse(JSON.stringify(input, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  try {
    const t = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(s, path.join(ART, "record_claim.wasm"), path.join(ART, "record_claim.zkey"));
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    return `${ok ? "VALID" : "INVALID"} (${Date.now() - t} ms)`;
  } catch {
    return "NO PROOF (claim false)";
  }
}

console.log("txn 1003 status = COMPLETED ->", await claim(3, "status", "eq", "COMPLETED"));
console.log("txn 1003 status = PENDING   ->", await claim(3, "status", "eq", "PENDING"));
console.log("txn 1010 amount >= 505000   ->", await claim(10, "amount_paise", "gte", 505000));
console.log("txn 1010 amount >= 999999   ->", await claim(10, "amount_paise", "gte", 999999));
console.log("txn 1010 amount <= 600000   ->", await claim(10, "amount_paise", "lte", 600000));
process.exit(0);
