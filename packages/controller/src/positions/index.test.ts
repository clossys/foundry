import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCanonicalRoleLoopContract, readInstalledPositionContract } from "./canonical.js";
import { POSITION_FIELDS, POSITION_RECOMMENDATIONS, ROLE_DISPOSITIONS, SETPOINT_VALUE_SHAPES, WORKER_COMPONENT_KINDS, validateInstalledPositionContract, validateInstalledPositionLedger } from "./index.js";

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

  it("rejects value-bearing evidence references and locators", () => {
    const at = String.fromCharCode(64);
    const unsafeReferences = [
      "audit credential:secret-value",
      "provider value: prod-api-key",
      "locator/query token=credential-value",
      "central adoption decision: approve all consumers",
      `custom+evidence://reader:reference${at}host.invalid/evidence`,
      `see custom+evidence://reader:reference${at}host.invalid/evidence`,
      `https://${at}host.invalid/evidence`,
      "https://%40host.invalid/evidence",
      `https://\u200b${at}host.invalid/evidence`,
      `https://ref%ZZ${at}host.invalid/evidence`,
      `https://ref%${at}host.invalid/evidence`,
      `https://ref ${at}host.invalid/evidence`,
      `https:reader:reference${at}host.invalid/evidence`, `https:/reader:reference${at}host.invalid/evidence`, `https:\\\\reader:reference${at}host.invalid/evidence`, `ftp:reader:reference${at}host.invalid/evidence`,
      "https%3Areader%3Areference%40host.invalid/evidence", "https%253Areader%253Areference%2540host.invalid/evidence",
      `https:///reader:reference${at}host.invalid/evidence`,
      `https://reader:\nreference${at}host.invalid/evidence`,
    ];
    for (const [path, mutate] of [
      ["positions[0].baseline.evidenceRefs[0]", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string[]>>>)[0]!.baseline).evidenceRefs[0] = value; }],
      ["positions[0].setpoint.evidenceRefs[0]", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string[]>>>)[0]!.setpoint).evidenceRefs[0] = value; }],
      ["positions[0].evidenceSource.locator", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string>>>)[0]!.evidenceSource).locator = value; }],
      ["positions[0].firstDayAssessment.evidenceRefs[0]", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string[]>>>)[0]!.firstDayAssessment).evidenceRefs[0] = value; }],
    ] as const) {
      for (const unsafe of unsafeReferences) {
        const ledger = fixture();
        mutate(ledger, unsafe);
        const report = validateInstalledPositionLedger(ledger);
        expect(report.ok).toBe(false);
        expect(report.findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path }));
      }
    }
    const tooLong = fixture();
    ((tooLong.positions as Array<Record<string, Record<string, string[]>>>)[0]!.baseline).evidenceRefs[0] = "a".repeat(65_537);
    expect(validateInstalledPositionLedger(tooLong).findings).toContainEqual({ rule: "reference-length-exceeded", path: "positions[0].baseline.evidenceRefs[0]", message: "must be at most 65,536 code units" });
  });

  it("keeps every installed-position contract vocabulary tied to the validator", () => {
    for (const collection of [POSITION_FIELDS, WORKER_COMPONENT_KINDS, POSITION_RECOMMENDATIONS, ROLE_DISPOSITIONS, SETPOINT_VALUE_SHAPES]) {
      expect(Object.isFrozen(collection)).toBe(true);
    }
    assert.deepEqual(validateInstalledPositionContract(readInstalledPositionContract()), []);
    const drifted = structuredClone(readInstalledPositionContract()) as Record<string, Record<string, unknown>>;
    ((drifted.position!.fields as string[]).pop());
    expect(validateInstalledPositionContract(drifted).some((finding) => finding.rule === "noncanonical-installed-position-contract")).toBe(true);

    const ruleDrift = structuredClone(readInstalledPositionContract()) as Record<string, Record<string, unknown>>;
    ruleDrift.roleDisposition!.rule = "another rule";
    expect(validateInstalledPositionContract(ruleDrift).some((finding) => finding.rule === "noncanonical-installed-position-contract")).toBe(true);
  });
});
