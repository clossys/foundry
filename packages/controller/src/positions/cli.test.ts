import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readHistoricalRoleLoopContracts } from "./canonical.js";
import { main } from "./cli.js";

// The real 0.9.10 shape of docs/contracts/installed-position-ledger.fixture.json
// (see index.test.ts for provenance) and its matching 0.9.10 role contract
// shape (schemaVersion 4, `learnOrEscalate`, 18 roles, no @clossys/customer).
// Only what `keys()`/`canonical()` need to reject a caller-supplied 0.9.10
// snapshot is reproduced below -- the full 300+ line role-loop-archetypes.json
// is not needed to prove the noncanonical-role-contract refusal (#1394 audit
// finding A3).
const legacyLedger090 = {
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
};

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "position-check-cli-"));
});

function write(name: string, content: unknown): string {
  const full = join(root, name);
  writeFileSync(full, JSON.stringify(content));
  return full;
}

describe("foundry-position-check CLI (#1394)", () => {
  it("rejects incomplete or malformed arguments without reading anything", () => {
    expect(main([])).toBe(2);
    expect(main(["a", "b", "c"])).toBe(2);
    expect(main(["--help"])).toBe(2);
  });

  it("exits 0 on a real 0.9.10-shaped ledger and prints its advisories to stderr, not stdout", () => {
    const path = write("ledger.json", legacyLedger090);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([path])).toBe(0);
    const stdoutLines = log.mock.calls.map((call) => String(call[0]));
    const stderrLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(stderrLines.some((line) => line.startsWith("ADVISORY legacy-stage-name"))).toBe(true);
    expect(stderrLines.some((line) => line.startsWith("ADVISORY missing-disposition-for-new-role"))).toBe(true);
    expect(stdoutLines.some((line) => line.startsWith("FAIL"))).toBe(false);
    expect(stdoutLines.some((line) => line.startsWith("ADVISORY"))).toBe(false);
    expect(stdoutLines.some((line) => line.startsWith("INSTALLED POSITION LEDGER OK"))).toBe(true);
    log.mockRestore();
    errorSpy.mockRestore();
  });

  it("keeps stdout byte-identical to a plain, advisory-free pass: exactly one OK line", () => {
    // A fully-migrated ledger (current `learn` key, an explicit customer
    // disposition) has nothing to advise on -- this proves the OK line
    // itself is unchanged, on top of the previous test proving advisories
    // never join it on stdout.
    const migrated: Record<string, unknown> = JSON.parse(JSON.stringify(legacyLedger090));
    (migrated.dispositions as Array<Record<string, unknown>>).push({ package: "@clossys/customer", disposition: "not-applicable", reason: "Synthetic schema fixture; no consumer decision.", positionIds: [] });
    const stageBindings = ((migrated.positions as Array<Record<string, unknown>>)[0]!.stageBindings as Record<string, string>);
    stageBindings.learn = stageBindings.learnOrEscalate!;
    delete stageBindings.learnOrEscalate;
    const path = write("ledger.json", migrated);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([path])).toBe(0);
    expect(log.mock.calls).toEqual([["INSTALLED POSITION LEDGER OK — 1 open role(s), 1 complete position(s). No adoption, grounding, or closure is inferred."]]);
    expect(errorSpy.mock.calls).toEqual([]);
    log.mockRestore();
    errorSpy.mockRestore();
  });

  it("still exits 1 on a ledger missing a disposition for a role that existed in 0.9.10", () => {
    const broken = structuredClone(legacyLedger090);
    broken.dispositions = broken.dispositions.filter((item) => item.package !== "@clossys/advisor");
    const path = write("ledger.json", broken);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([path])).toBe(1);
    expect(log.mock.calls.some((call) => String(call[0]).startsWith("FAIL missing-role-disposition"))).toBe(true);
    log.mockRestore();
  });

  it("still refuses an arbitrary, non-shipped role contract", () => {
    const ledgerPath = write("ledger.json", legacyLedger090);
    const contractPath = write("role-contract.json", { schemaVersion: 4, notTheCurrentContract: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([ledgerPath, contractPath])).toBe(1);
    expect(log.mock.calls.some((call) => String(call[0]).startsWith("FAIL noncanonical-role-contract"))).toBe(true);
    log.mockRestore();
  });

  it("accepts a caller's exact 0.9.10 role contract file (A3): exit code and stdout still match a plain pass, advisory goes to stderr", () => {
    // The real 0.9.10 role-loop-archetypes.json, shipped verbatim by this
    // package under contracts/historical/0.9.10/ and read here through the
    // same historical-contract table canonical.ts exposes to index.ts --
    // proving the CLI's second argument now accepts a caller's own vendored
    // copy of that exact file instead of refusing it.
    const historicalRoleContract = readHistoricalRoleLoopContracts().find((entry) => entry.version === "0.9.10")!.contract;
    const ledgerPath = write("ledger.json", legacyLedger090);
    const contractPath = write("role-contract.json", historicalRoleContract);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([ledgerPath, contractPath])).toBe(0);
    const stdoutLines = log.mock.calls.map((call) => String(call[0]));
    const stderrLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(stdoutLines.some((line) => line.startsWith("FAIL"))).toBe(false);
    expect(stdoutLines.some((line) => line.startsWith("ADVISORY"))).toBe(false);
    expect(stdoutLines).toEqual(["INSTALLED POSITION LEDGER OK — 1 open role(s), 1 complete position(s). No adoption, grounding, or closure is inferred."]);
    expect(stderrLines.some((line) => line.startsWith("ADVISORY legacy-contract-copy") && line.includes("0.9.10"))).toBe(true);
    // The same migration advisories a default-contract run against this
    // ledger shape reports (see the earlier test) still fire alongside it.
    expect(stderrLines.some((line) => line.startsWith("ADVISORY legacy-stage-name"))).toBe(true);
    expect(stderrLines.some((line) => line.startsWith("ADVISORY missing-disposition-for-new-role"))).toBe(true);
    log.mockRestore();
    errorSpy.mockRestore();
  });
});
