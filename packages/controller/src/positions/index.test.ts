import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCanonicalRoleLoopContract, readHistoricalInstalledPositionContracts, readHistoricalRoleLoopContracts, readInstalledPositionContract } from "./canonical.js";
import { POSITION_FIELDS, POSITION_RECOMMENDATIONS, ROLE_DISPOSITIONS, SETPOINT_VALUE_SHAPES, WORKER_COMPONENT_KINDS, validateInstalledPositionContract, validateInstalledPositionLedger } from "./index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const fixture = () => structuredClone(read(join(repoRoot, "docs/contracts/installed-position-ledger.fixture.json")) as object) as Record<string, unknown>;
const roleContract = () => structuredClone(read(join(repoRoot, "docs/contracts/role-loop-archetypes.json")) as object) as Record<string, unknown>;

// The real 0.9.10 shape of docs/contracts/installed-position-ledger.fixture.json,
// captured verbatim via `git show 62d9dc570c0af76cd89e49bc40002fb5b36da2ca:
// docs/contracts/installed-position-ledger.fixture.json` (the qualified 0.9.10
// baseline, see the compatibility audit). It differs from the current fixture
// in exactly the two ways #1394's audit found: no @clossys/customer
// disposition (that role shipped in 0.9.11) and `learnOrEscalate` instead of
// `learn` in stageBindings.
const legacyLedgerFixture090 = () => structuredClone({
  schemaVersion: 1,
  dispositions: [
    { package: "@clossys/advisor", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/controller", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/architect", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/inspector", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/builder", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/locksmith", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/integrator", disposition: "open", reason: "Synthetic schema fixture; exercises a complete open position.", positionIds: ["fixture-integrator"] },
    { package: "@clossys/observer", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/strategist", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/writer", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/designer", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/publisher", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/influencer", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/bouncer", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/butler", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/messenger", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/giver", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
    { package: "@clossys/keeper", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] },
  ],
  positions: [
    {
      id: "fixture-integrator",
      package: "@clossys/integrator",
      businessMetricPath: { l1: "synthetic value", l2: "synthetic northstar", l3: "synthetic operating metric" },
      causalHypothesis: "Synthetic fixture only; it establishes no consumer hypothesis.",
      baseline: { value: 0.5, observedAt: "2026-08-17T00:00:00.000Z", evidenceRefs: ["fixture-baseline"] },
      setpoint: { value: 1, evidenceRefs: ["fixture-setpoint"] },
      operatingScope: { description: "Synthetic fixture scope.", included: ["fixture input"], excluded: ["provider mutation"] },
      authority: { decisionOwner: "fixture owner", actionAuthority: "fixture automation" },
      evidenceSource: { description: "Synthetic fixture evidence.", locator: "fixture" },
      cadence: { measure: "fixture", review: "fixture" },
      budget: { amount: 0, unit: "currency", period: "fixture" },
      guardrails: ["No live action."],
      escalationPath: ["Fixture escalation only."],
      workerComponents: [{ kind: "deterministic", responsibility: "Validate fixture syntax." }],
      stageBindings: { sense: "Read fixture evidence.", judge: "Compare fixture values.", act: "Report fixture result.", verify: "Re-read fixture evidence.", learnOrEscalate: "Escalate fixture failure." },
      firstDayAssessment: { gaps: [], target: "Synthetic target state.", openQuestions: [], criticalPath: ["Validate the fixture."], deferredWork: [], recommendation: "install", evidenceRefs: ["fixture-baseline", "fixture-setpoint"] },
    },
  ],
}) as Record<string, unknown>;

// The real 0.9.10 role-loop-archetypes.json and installed-position-contract.json,
// shipped verbatim (captured via `git show 62d9dc570c0af76cd89e49bc40002fb5b36da2ca:
// packages/controller/contracts/<name>`) under contracts/historical/0.9.10/ so this
// package's own historical-contract table (canonical.ts) can recognize a caller's
// exact copy of either one (audit finding A3). Read through that same table here,
// rather than re-embedding the files a second time, so the test proves the table
// the validator actually uses.
const historicalRoleContract090 = () => structuredClone(readHistoricalRoleLoopContracts().find((entry) => entry.version === "0.9.10")!.contract as object) as Record<string, unknown>;
const historicalInstalledPositionContract090 = () => structuredClone(readHistoricalInstalledPositionContracts().find((entry) => entry.version === "0.9.10")!.contract as object) as Record<string, unknown>;

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
      (contract: Record<string, unknown>) => { delete (contract.roles as Record<string, unknown>)["@clossys/architect"]; },
      (contract: Record<string, unknown>) => { ((contract.roles as Record<string, Record<string, unknown>>)["@clossys/architect"] as Record<string, unknown>).closeCondition = ""; },
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
      `https:reader:reference${at}host.invalid/evidence`, `https:/reader:reference${at}host.invalid/evidence`, `https:\\\\reader:reference${at}host.invalid/evidence`, `ftp:reader:reference${at}host.invalid/evidence`,
      "https%3Areader%3Areference%40host.invalid/evidence", "https%253Areader%253Areference%2540host.invalid/evidence",
      `https://outer.invalid/?next=https://reader:reference${at}host.invalid/evidence`, `https://outer.invalid/?next=//reader:reference${at}host.invalid/evidence`, `https://outer.invalid/?https://reader:reference${at}host.invalid/evidence`, `https://outer.invalid/?a=1&next=https://reader:reference${at}host.invalid/evidence`, `https://outer.invalid/?next=https%253Areader%253Areference%2540host.invalid/evidence`, `audit, https://reader:reference${at}host.invalid/evidence`,
      `https://outer.invalid/#next=https://reader:reference${at}host.invalid/evidence`, `https://outer.invalid/#//reader:reference${at}host.invalid/evidence`,
      `https://safe.invalid then https://reader:reference${at}host.invalid/evidence`, `https://safe.invalid,https://reader:reference${at}host.invalid/evidence`, `https://safe.invalid //reader:reference${at}host.invalid/evidence`, `custom://safe.invalid then https://reader:reference${at}host.invalid/evidence`,
      `https://host.invalid/a https://reader:reference${at}host.invalid/evidence`, `https://host.invalid/a //reader:reference${at}host.invalid/evidence`,
      `https:///reader:reference${at}host.invalid/evidence`,
      `https://reader:\nreference${at}host.invalid/evidence`,
      `urn:example?next=https://reader:reference${at}host.invalid/evidence`, `urn:example#next=//reader:reference${at}host.invalid/evidence`, `mailto:reader${at}host.invalid?next=https://reader:reference${at}host.invalid/evidence`,
      `https://host.invalid/path\u2028https://reader:reference${at}host.invalid/evidence`, `/path\u2029//reader:reference${at}host.invalid/evidence`,
      `https%3a//reader:reference${at}host.invalid/evidence`, `https://reader:reference%40host.invalid/evidence`, `//reader:reference%40host.invalid/evidence`,
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
    const benignPath = `https%253A%252F%252Fhost.invalid%253Fpath%2540v1`;
    for (const [path, mutate] of [
      ["positions[0].baseline.evidenceRefs[0]", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string[]>>>)[0]!.baseline).evidenceRefs[0] = value; }],
      ["positions[0].setpoint.evidenceRefs[0]", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string[]>>>)[0]!.setpoint).evidenceRefs[0] = value; }],
      ["positions[0].evidenceSource.locator", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string>>>)[0]!.evidenceSource).locator = value; }],
      ["positions[0].firstDayAssessment.evidenceRefs[0]", (ledger: Record<string, unknown>, value: string) => { ((ledger.positions as Array<Record<string, Record<string, string[]>>>)[0]!.firstDayAssessment).evidenceRefs[0] = value; }],
    ] as const) {
      const ledger = fixture();
      mutate(ledger, benignPath);
      expect(validateInstalledPositionLedger(ledger).ok).toBe(true);
    }
    const tooLong = fixture();
    ((tooLong.positions as Array<Record<string, Record<string, string[]>>>)[0]!.baseline).evidenceRefs[0] = "a".repeat(65_537);
    expect(validateInstalledPositionLedger(tooLong).findings).toContainEqual({ rule: "reference-length-exceeded", path: "positions[0].baseline.evidenceRefs[0]", message: "must be at most 65,536 code units" });
  });

  describe("0.9.10 legacy ledger compatibility (#1394)", () => {
    it("accepts a real 0.9.10-shaped ledger, with advisories naming both migrations", () => {
      const result = validateInstalledPositionLedger(legacyLedgerFixture090());
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([]);
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "legacy-stage-name", path: "positions[0].stageBindings" }));
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "missing-disposition-for-new-role", path: "@clossys/customer", message: expect.stringContaining("0.9.11") }));
      expect(result.advisories).toHaveLength(2);
      expect(result.openRoles).toBe(1);
      expect(result.positions).toBe(1);
    });

    it("rejects stageBindings carrying both learn and learnOrEscalate", () => {
      const ledger = legacyLedgerFixture090();
      const positions = ledger.positions as Array<Record<string, unknown>>;
      const stageBindings = positions[0]!.stageBindings as Record<string, string>;
      stageBindings.learn = stageBindings.learnOrEscalate!;
      const result = validateInstalledPositionLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "invalid-stage-bindings", path: "positions[0]" }));
      expect((result.advisories ?? []).some((item) => item.rule === "legacy-stage-name")).toBe(false);
    });

    it("rejects stageBindings carrying neither learn nor learnOrEscalate", () => {
      const ledger = legacyLedgerFixture090();
      const positions = ledger.positions as Array<Record<string, unknown>>;
      const stageBindings = positions[0]!.stageBindings as Record<string, string>;
      delete stageBindings.learnOrEscalate;
      const result = validateInstalledPositionLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "invalid-stage-bindings", path: "positions[0]" }));
    });

    it("still fails a missing disposition for a role that existed in 0.9.10", () => {
      const ledger = legacyLedgerFixture090();
      ledger.dispositions = (ledger.dispositions as Array<Record<string, unknown>>).filter((item) => item.package !== "@clossys/advisor");
      const result = validateInstalledPositionLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "missing-role-disposition", path: "@clossys/advisor" }));
      // The unrelated new-role advisory still fires; advisories never mask a real failure.
      expect((result.advisories ?? []).some((item) => item.rule === "missing-disposition-for-new-role")).toBe(true);
    });

    it("never lets advisories change ok or findings on an otherwise-valid ledger", () => {
      const legacy = validateInstalledPositionLedger(legacyLedgerFixture090());
      const migrated = validateInstalledPositionLedger(fixture());
      expect(legacy.ok).toBe(migrated.ok);
      expect(legacy.openRoles).toBe(migrated.openRoles);
      expect(legacy.positions).toBe(migrated.positions);
      expect(migrated.advisories).toEqual([]);
    });

    it("fails, never advises, a current-format ledger (stageBindings.learn) missing the new-role disposition", () => {
      // Fixture F1: a ledger this shape could never have been written
      // against 0.9.10 -- it uses the post-rename `learn` key -- so the
      // new-role exemption must not apply, exactly like pre-PR main.
      const ledger = fixture();
      ledger.dispositions = (ledger.dispositions as Array<Record<string, unknown>>).filter((item) => item.package !== "@clossys/customer");
      const result = validateInstalledPositionLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "missing-role-disposition", path: "@clossys/customer" }));
      expect((result.advisories ?? []).some((item) => item.rule === "missing-disposition-for-new-role")).toBe(false);
    });

    it("fails a mixed-vocabulary ledger (one learn position, one learnOrEscalate position) missing the new-role disposition", () => {
      // A ledger with even one `learn` position could not have come from
      // 0.9.10, so the strict reading treats "mixed" as current-format:
      // the exemption still does not apply.
      const ledger = legacyLedgerFixture090();
      const positions = ledger.positions as Array<Record<string, unknown>>;
      const legacyPosition = positions[0]!;
      const currentPosition = structuredClone(legacyPosition) as Record<string, unknown>;
      currentPosition.id = "fixture-observer";
      currentPosition.package = "@clossys/observer";
      const currentStageBindings = currentPosition.stageBindings as Record<string, string>;
      currentStageBindings.learn = currentStageBindings.learnOrEscalate!;
      delete currentStageBindings.learnOrEscalate;
      positions.push(currentPosition);
      const dispositions = ledger.dispositions as Array<Record<string, unknown>>;
      const observerDisposition = dispositions.find((item) => item.package === "@clossys/observer")!;
      observerDisposition.disposition = "open";
      observerDisposition.reason = "Synthetic schema fixture; exercises a mixed-vocabulary ledger.";
      observerDisposition.positionIds = ["fixture-observer"];
      const result = validateInstalledPositionLedger(ledger);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(expect.objectContaining({ rule: "missing-role-disposition", path: "@clossys/customer" }));
      expect((result.advisories ?? []).some((item) => item.rule === "missing-disposition-for-new-role")).toBe(false);
    });

    it("still accepts a zero-position ledger missing the new-role disposition, the same way 0.9.10 did", () => {
      // No position exists to carry `learn` or `learnOrEscalate`, so this
      // ledger is indistinguishable from one 0.9.10 could have written
      // (an all-not-applicable ledger, per the audit's finding A2) -- the
      // exemption applies regardless.
      const ledger = legacyLedgerFixture090();
      const dispositions = ledger.dispositions as Array<Record<string, unknown>>;
      const integratorDisposition = dispositions.find((item) => item.package === "@clossys/integrator")!;
      integratorDisposition.disposition = "not-applicable";
      integratorDisposition.reason = "Synthetic schema fixture; no consumer decision.";
      integratorDisposition.positionIds = [];
      ledger.positions = [];
      const result = validateInstalledPositionLedger(ledger);
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([]);
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "missing-disposition-for-new-role", path: "@clossys/customer" }));
      expect(result.positions).toBe(0);
    });
  });

  describe("caller's copy of a prior-version contract (A3)", () => {
    it("accepts a caller's exact 0.9.10 role contract, validates a 0.9.10 ledger through it, and advises which version matched", () => {
      const result = validateInstalledPositionLedger(legacyLedgerFixture090(), historicalRoleContract090());
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([]);
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "legacy-contract-copy", path: "roleContract", message: expect.stringContaining("0.9.10") }));
      // The other two 0.9.10 migrations this ledger shape carries still advise, unaffected by which role contract was supplied.
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "legacy-stage-name" }));
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "missing-disposition-for-new-role" }));
      expect(result.advisories).toHaveLength(3);
      // Verdict and role/position counts match what 0.9.10 itself reported for this ledger.
      const withCurrentContract = validateInstalledPositionLedger(legacyLedgerFixture090());
      expect(result.ok).toBe(withCurrentContract.ok);
      expect(result.openRoles).toBe(withCurrentContract.openRoles);
      expect(result.positions).toBe(withCurrentContract.positions);
    });

    it("still rejects a 0.9.10 role contract with one field changed", () => {
      const contract = historicalRoleContract090();
      (contract.roles as Record<string, Record<string, unknown>>)["@clossys/architect"]!.closeCondition = "modified";
      const result = validateInstalledPositionLedger(legacyLedgerFixture090(), contract);
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([{ rule: "noncanonical-role-contract", path: "roleContract", message: "must exactly match the immutable role-loop-archetypes snapshot shipped by @clossys/controller" }]);
    });

    it("accepts a caller's exact 0.9.10 installed-position contract and advises which version matched", () => {
      const result = validateInstalledPositionContract(historicalInstalledPositionContract090());
      expect(result).toHaveLength(0);
      expect(result.advisories).toContainEqual(expect.objectContaining({ rule: "legacy-contract-copy", path: "installedPositionContract", message: expect.stringContaining("0.9.10") }));
    });

    it("still rejects a 0.9.10 installed-position contract with one field changed", () => {
      const contract = historicalInstalledPositionContract090();
      (contract.position as Record<string, unknown>).setpointValueRule = "modified";
      const result = validateInstalledPositionContract(contract);
      expect(result).toEqual([{ rule: "noncanonical-installed-position-contract", path: "installedPositionContract", message: "must exactly match the immutable installed-position-contract snapshot shipped by @clossys/controller" }]);
      expect(result.advisories).toBeUndefined();
    });

    it("still rejects an arbitrary, non-shipped contract exactly as before", () => {
      const role = validateInstalledPositionLedger(legacyLedgerFixture090(), { schemaVersion: 4, notTheCurrentContract: true });
      expect(role.findings).toEqual([{ rule: "noncanonical-role-contract", path: "roleContract", message: "must exactly match the immutable role-loop-archetypes snapshot shipped by @clossys/controller" }]);
      const position = validateInstalledPositionContract({ schemaVersion: 1, notTheCurrentContract: true });
      expect(position).toEqual([{ rule: "noncanonical-installed-position-contract", path: "installedPositionContract", message: "must exactly match the immutable installed-position-contract snapshot shipped by @clossys/controller" }]);
    });
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
