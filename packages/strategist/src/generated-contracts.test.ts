import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { BRIEF_CONTRACTS } from "./generated/brief-contracts.generated.js";

/*
 * Issue #1173, #1475. Strategist packs its own copy of the shared brief
 * and engagement-context contracts, and of their one checker
 * implementation (packages/advisor/src/contract-schema.ts), at build time
 * (scripts/pack-brief-contract.mjs), so it validates against the same
 * definition @clossys/advisor and @clossys/launcher do with no runtime
 * dependency on either. These tests check that packing did what it
 * claims — the same corpus @clossys/launcher's own plan-digest.test.ts
 * checks for its own packed copies. Reading sibling source here is
 * test-only: nothing at runtime leaves this package.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

describe("packed brief and engagement-context contracts", () => {
  it("are the docs/contracts files, unchanged", () => {
    expect(Object.keys(BRIEF_CONTRACTS)).toEqual(["engagement-brief.json", "engagement-context.json"]);
    for (const [name, contract] of Object.entries(BRIEF_CONTRACTS)) expect(contract).toEqual(JSON.parse(read(`docs/contracts/${name}`)));
  });

  it("use only keywords the checker implements, in every subschema", () => {
    for (const contract of Object.values(BRIEF_CONTRACTS)) expect(() => assertImplementedContract(contract)).not.toThrow();
  });

  it("carry a byte-identical copy of Advisor's one contract checker, under a generated-file header", () => {
    const copy = readFileSync(new URL("./generated/contract-schema.generated.ts", import.meta.url), "utf8");
    const canonical = read("packages/advisor/src/contract-schema.ts");
    expect(copy.startsWith("// AUTO-GENERATED")).toBe(true);
    expect(copy.endsWith(canonical)).toBe(true);
    expect(copy.slice(0, copy.length - canonical.length).split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
  });
});
