// Compiles the circuit and runs a local Groth16 trusted setup.
// Output artifacts are copied to zk-service/artifacts and web/public/zk.
//
//   npm install && npm run build
//
// Note: the setup ceremony here is local (single contributor), which is fine for
// a demo. Production would use a public multi-party Powers-of-Tau ceremony.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const POWER = 14;
const B = "build";
const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};
const snark = (args) => run(`npx snarkjs ${args}`);
const entropy = () => randomBytes(32).toString("hex");

mkdirSync(B, { recursive: true });

run(`npx circom2 record_claim.circom --r1cs --wasm --sym -l node_modules -o ${B}`);
snark(`r1cs info ${B}/record_claim.r1cs`);

const ptau = `${B}/pot${POWER}_final.ptau`;
if (!existsSync(ptau)) {
  snark(`powersoftau new bn128 ${POWER} ${B}/pot_0.ptau`);
  snark(`powersoftau contribute ${B}/pot_0.ptau ${B}/pot_1.ptau --name="ztdb-local" -e="${entropy()}"`);
  snark(`powersoftau prepare phase2 ${B}/pot_1.ptau ${ptau}`);
}

snark(`groth16 setup ${B}/record_claim.r1cs ${ptau} ${B}/record_claim_0.zkey`);
snark(`zkey contribute ${B}/record_claim_0.zkey ${B}/record_claim.zkey --name="ztdb-phase2" -e="${entropy()}"`);
snark(`zkey export verificationkey ${B}/record_claim.zkey ${B}/verification_key.json`);

const files = {
  "record_claim.wasm": `${B}/record_claim_js/record_claim.wasm`,
  "record_claim.zkey": `${B}/record_claim.zkey`,
  "verification_key.json": `${B}/verification_key.json`,
};
for (const dest of ["../zk-service/artifacts", "../web/public/zk"]) {
  mkdirSync(dest, { recursive: true });
  for (const [name, src] of Object.entries(files)) {
    if (dest.includes("web") && name.endsWith(".zkey")) continue; // browser only verifies
    if (dest.includes("web") && name.endsWith(".wasm")) continue;
    copyFileSync(src, path.join(dest, name));
  }
}
console.log("\nArtifacts copied to zk-service/artifacts and web/public/zk");
