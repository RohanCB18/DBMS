import { describe, expect, it } from "vitest";
import { bindClaim, encodeValue } from "./zk";

// Reference values produced by zk-service/src/crypto.js (POST /encode). If the browser encoder
// drifts from the server's, auditors would reject every genuine proof — this pins them together.
const REFERENCE: [any, string][] = [
  ["transactions", "58477535402604458347662555615261174599100888597387358299063747452247204231"],
  [100600, "100600"],
  ["status", "401907018752038652771103642365355646336606620774336762584400384004536353343"],
  ["COMPLETED", "18136567804242463581786432256889679861125711601741923310370185662746182879"],
  ["KYC-0007", "236351334750531347118924900799742806202252953586875602075035253099788765797"],
  [true, "263742469834195778638983571387586101561790336684196998468438250558610740715"],
  [false, "26024082013112354243499754790986101236726625260762186385231989749357820358"],
  [null, "218889403399402185147872959808051220126423610987311587018225222009055597755"],
  [25000000, "25000000"],
  [{ b: 1, a: [1, "x"] }, "224213070196691728754058736715450605836880209209763727840733355454885247136"],
  [-5, "355833452092209134625815347434891521498391467513812683023280420924950232669"],
  [1.5, "281956744506015693904835535470118077353015401463901017993038728518542104697"],
];

describe("encodeValue matches the zk-service", () => {
  for (const [v, expected] of REFERENCE) {
    it(JSON.stringify(v), async () => {
      expect((await encodeValue(v)).toString()).toBe(expected);
    });
  }
});

describe("bindClaim", () => {
  const pkg = {
    root: "123",
    claim: { table: "transactions", pk: 100600, field: "status", op: "eq", value: "COMPLETED" },
    publicSignals: ["123", REFERENCE[0][1], "100600", REFERENCE[2][1], "0", REFERENCE[3][1]],
  };
  it("accepts a package whose claim matches its public signals", async () => {
    expect((await bindClaim(pkg)).every((c) => c.ok)).toBe(true);
  });
  it("rejects a package whose claim was edited", async () => {
    const forged = { ...pkg, claim: { ...pkg.claim, value: "FAILED" } };
    const checks = await bindClaim(forged);
    expect(checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(["value"]);
  });
});
