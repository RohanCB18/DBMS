// zk-service: Poseidon Merkle commitments + Groth16 proving/verification.
// The Python API calls this service; it never touches the databases itself.
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import {
  initCrypto, leafHash, buildLevels, rootOf, merklePath,
  recordWitness, encodeValue, OPS, DEPTH, NFIELDS,
} from "./crypto.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ART = process.env.ZK_ARTIFACTS || path.join(here, "..", "artifacts");
const WASM = path.join(ART, "record_claim.wasm");
const ZKEY = path.join(ART, "record_claim.zkey");
const VKEY = JSON.parse(readFileSync(path.join(ART, "verification_key.json"), "utf8"));

const str = (x) => x.toString();
const app = express();
app.use(express.json({ limit: "100mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, depth: DEPTH, nfields: NFIELDS }));
app.get("/vkey", (_req, res) => res.json(VKEY));

// Hash every record into a leaf and compute the Merkle root.
app.post("/merkle/commit", (req, res) => {
  const leaves = req.body.records.map(leafHash);
  const root = rootOf(buildLevels(leaves));
  res.json({ root: str(root), leaves: leaves.map(str) });
});

// Root from already-computed leaves (used by `verify`).
app.post("/merkle/root", (req, res) => {
  res.json({ root: str(rootOf(buildLevels(req.body.leaves))) });
});

// Recompute leaves for records without building a tree (tamper pinpointing).
app.post("/merkle/leaves", (req, res) => {
  res.json({ leaves: req.body.records.map((r) => str(leafHash(r))) });
});

// Plain (non-ZK) Merkle inclusion proof: reveals the full record.
app.post("/merkle/path", (req, res) => {
  const levels = buildLevels(req.body.leaves);
  const { pathElements, pathIndices } = merklePath(levels, req.body.leafIndex);
  res.json({ root: str(rootOf(levels)), pathElements: pathElements.map(str), pathIndices });
});

app.post("/encode", (req, res) => {
  res.json({ encoded: req.body.values.map((v) => str(encodeValue(v))) });
});

/**
 * body: { record, leaves, leafIndex, field, op: "eq"|"gte"|"lte", value }
 */
app.post("/prove", async (req, res) => {
  try {
    const { record, leaves, leafIndex, field, op, value } = req.body;
    const leaf = leafHash(record);
    if (str(leaf) !== leaves[leafIndex]) {
      return res.status(409).json({ error: "record does not match the committed leaf (tampered snapshot?)" });
    }
    const fieldIdx = record.fields.findIndex((f) => f[0] === field);
    if (fieldIdx < 0) return res.status(400).json({ error: `field '${field}' not in record` });
    if (!(op in OPS)) return res.status(400).json({ error: `unknown op '${op}'` });

    const w = recordWitness(record);
    const levels = buildLevels(leaves);
    const { pathElements, pathIndices } = merklePath(levels, leafIndex);
    const input = {
      root: rootOf(levels), tableTag: w.tableTag, pk: w.pk,
      fieldName: encodeValue(field), op: OPS[op], claimValue: encodeValue(value),
      names: w.names, values: w.values, salt: w.salt, fieldIdx,
      pathElements, pathIndices,
    };
    const toStrings = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    const t0 = Date.now();
    let proof, publicSignals;
    try {
      ({ proof, publicSignals } = await snarkjs.groth16.fullProve(toStrings(input), WASM, ZKEY));
    } catch (e) {
      // The witness generator rejects unsatisfiable inputs: the claim is false.
      return res.status(422).json({ error: "claim is false for this record — no proof can exist", detail: String(e.message || e).slice(0, 200) });
    }
    res.json({ proof, publicSignals, provingMs: Date.now() - t0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/verify", async (req, res) => {
  try {
    const ok = await snarkjs.groth16.verify(VKEY, req.body.publicSignals, req.body.proof);
    res.json({ valid: ok });
  } catch (e) {
    res.json({ valid: false, error: String(e.message || e) });
  }
});

const port = Number(process.env.PORT || 7000);
await initCrypto();
app.listen(port, () => console.log(`zk-service listening on :${port}`));
