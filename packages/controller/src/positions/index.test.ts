import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCanonicalRoleLoopContract, readInstalledPositionContract } from "./canonical.js";
import { validateInstalledPositionContract, validateInstalledPositionLedger } from "./index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const fixture = () => structuredClone(read(join(repoRoot, "docs/contracts/installed-position-ledger.fixture.json")) as object) as Record<string, unknown>;
const roleContract = () => structuredClone(read(join(repoRoot, "docs/contracts/role-loop-archetypes.json")) as object) as Record<string, unknown>;

describe("installed positions", () => {
  it("accepts the complete fixture and proves shipped snapshot parity", () => {
    const result = validateInstalledPositionLedger(fixture(), roleContract());
    assert.equal(result.ok, true);
    assert.deepEqual(readCanonicalRoleLoopContract(), roleContract());
    assert.deepEqual(readInstalledPositionContract(), read(join(repoRoot, "docs/contracts/installed-position-contract.json")));
  });

  it("rejects schema, role, declaration, and vocabulary drift in a supplied contract", () => {
    for (const mutate of [
      (contract: Record<string, unknown>) => { contract.schemaVersion = 3; },
      (contract: Record<string, unknown>) => { delete (contract.roles as Record<string, unknown>)["@vespeneventures/architect"]; },
      (contract: Record<string, unknown>) => { ((contract.roles as Record<string, Record<string, unknown>>)["@vespeneventures/architect"] as Record<string, unknown>).closeCondition = ""; },
      (contract: Record<string, unknown>) => { ((contract.metricVocabulary as Record<string, unknown>).directions as string[]).pop(); },
    ]) {
      const contract = roleContract();
      mutate(contract);
      const result = validateInstalledPositionLedger(fixture(), contract);
      expect(result.findings.some((finding) => finding.rule === "noncanonical-role-contract")).toBe(true);
    }
  });

  it("rejects a range shape for a scalar-direction setpoint", () => {
    const ledger = fixture();
    const positions = ledger.positions as Array<Record<string, unknown>>;
    (positions[0]!.setpoint as Record<string, unknown>).value = [0, 1];
    const result = validateInstalledPositionLedger(ledger);
    expect(result.findings.some((finding) => finding.rule === "invalid-setpoint")).toBe(true);
  });

  it("keeps every installed-position contract vocabulary tied to the validator", () => {
    assert.deepEqual(validateInstalledPositionContract(readInstalledPositionContract()), []);
    const drifted = structuredClone(readInstalledPositionContract()) as Record<string, Record<string, unknown>>;
    ((drifted.position!.fields as string[]).pop());
    expect(validateInstalledPositionContract(drifted).some((finding) => finding.rule === "noncanonical-installed-position-contract")).toBe(true);

    const ruleDrift = structuredClone(readInstalledPositionContract()) as Record<string, Record<string, unknown>>;
    ruleDrift.roleDisposition!.rule = "another rule";
    expect(validateInstalledPositionContract(ruleDrift).some((finding) => finding.rule === "noncanonical-installed-position-contract")).toBe(true);
  });
});
