import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCompletionEvidenceContract } from "./canonical.js";
import { COMPLETION_EVIDENCE_FIELDS, COMPLETION_EVIDENCE_INDETERMINATE_REASONS, COMPLETION_VERDICTS, DUPLICATE_STATES, INVOCATION_KINDS, PLACEMENT_MODES, validateCompletionEvidence, validateCompletionEvidenceContract } from "./completion-evidence.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const evidence = () => structuredClone(read(join(repoRoot, "docs/contracts/completion-evidence.fixture.json")) as object) as Record<string, unknown>;
const ledger = () => structuredClone(read(join(repoRoot, "docs/contracts/installed-position-ledger.fixture.json")) as object) as Record<string, unknown>;

describe("completion evidence", () => {
  it("accepts complete consumer-owned evidence and shipped contract parity", () => {
    const report = validateCompletionEvidence(evidence(), ledger());
    expect(report.result).toEqual({ verdict: "satisfied", evaluated: 1 });
    assert.deepEqual(readCompletionEvidenceContract(), read(join(repoRoot, "docs/contracts/completion-evidence-contract.json")));
    assert.deepEqual(validateCompletionEvidenceContract(readCompletionEvidenceContract()), []);
  });

  it("keeps its vocabulary tied to the immutable contract", () => {
    for (const collection of [COMPLETION_EVIDENCE_FIELDS, COMPLETION_VERDICTS, INVOCATION_KINDS, PLACEMENT_MODES, DUPLICATE_STATES, COMPLETION_EVIDENCE_INDETERMINATE_REASONS]) expect(Object.isFrozen(collection)).toBe(true);
    const drifted = structuredClone(readCompletionEvidenceContract()) as Record<string, unknown>;
    (drifted.fields as string[]).pop();
    expect(validateCompletionEvidenceContract(drifted).some((finding) => finding.rule === "noncanonical-completion-evidence-contract")).toBe(true);
  });

  it("never turns missing, malformed, or unrelated position evidence into a pass", () => {
    const malformed = evidence();
    delete malformed.outcome;
    expect(validateCompletionEvidence(malformed, ledger()).result.verdict).toBe("indeterminate");

    const unrelated = evidence();
    unrelated.positionId = "not-in-ledger";
    expect(validateCompletionEvidence(unrelated, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const invalidLedger = ledger();
    invalidLedger.positions = [];
    expect(validateCompletionEvidence(evidence(), invalidLedger).result).toMatchObject({ verdict: "indeterminate", reason: "invalid-position-ledger" });
  });

  it("requires exact artifact, one adjacent deliberate red/green control, and maintained rollback evidence", () => {
    const range = evidence();
    ((range.artifact as Record<string, unknown>).version) = "^0.6.1";
    expect(validateCompletionEvidence(range, ledger()).result.verdict).toBe("indeterminate");

    const separated = evidence();
    (((separated.control as Record<string, Record<string, unknown>>).green).runRef) = "fixture/another-run";
    expect(validateCompletionEvidence(separated, ledger()).result.verdict).toBe("indeterminate");

    const unlinkedInvocation = evidence();
    ((unlinkedInvocation.invocation as Record<string, unknown>).runRef) = "fixture/another-run";
    expect(validateCompletionEvidence(unlinkedInvocation, ledger()).result.verdict).toBe("indeterminate");

    const absentRollback = evidence();
    delete ((absentRollback.maintenance as Record<string, unknown>).rollback as Record<string, unknown>).verificationRef;
    expect(validateCompletionEvidence(absentRollback, ledger()).result.verdict).toBe("indeterminate");
  });

  it("preserves independent outcome and close-window ternaries", () => {
    const indeterminate = evidence();
    const outcome = indeterminate.outcome as Record<string, unknown>;
    outcome.verdict = "indeterminate";
    outcome.reason = "The independent source has not produced the after observation.";
    const after = outcome.after as Record<string, unknown>;
    after.state = "unreadable";
    after.value = null;
    after.observedAt = null;
    after.evidenceRefs = [];
    after.reason = "No independent after observation yet.";
    (indeterminate.closeWindow as Record<string, unknown>).verdict = "indeterminate";
    (indeterminate.closeWindow as Record<string, unknown>).reason = "The review window is still open.";
    expect(validateCompletionEvidence(indeterminate, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "outcome-indeterminate" });

    const violated = evidence();
    (violated.outcome as Record<string, unknown>).verdict = "violated";
    (violated.closeWindow as Record<string, unknown>).verdict = "violated";
    expect(validateCompletionEvidence(violated, ledger()).result).toMatchObject({ verdict: "violated" });
  });

  it("derives the outcome from the linked role metric direction and position setpoint", () => {
    const selfCertifiedMiss = evidence();
    ((selfCertifiedMiss.outcome as Record<string, Record<string, unknown>>).after).value = 0;
    const missReport = validateCompletionEvidence(selfCertifiedMiss, ledger());
    expect(missReport.result).toMatchObject({ verdict: "violated" });
    expect(missReport.findings.some((finding) => finding.rule === "outcome-verdict-setpoint-mismatch")).toBe(true);

    const wrongMetric = evidence();
    (wrongMetric.outcome as Record<string, unknown>).metric = "a caller-selected metric";
    expect(validateCompletionEvidence(wrongMetric, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const selfMeasured = evidence();
    (selfMeasured.outcome as Record<string, unknown>).sourceOwner = selfMeasured.package;
    expect(validateCompletionEvidence(selfMeasured, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    for (const paddedOwner of [` ${String(selfMeasured.package)} `, " fixture-integrator "]) {
      const paddedSelfMeasurement = evidence();
      (paddedSelfMeasurement.outcome as Record<string, unknown>).sourceOwner = paddedOwner;
      expect(validateCompletionEvidence(paddedSelfMeasurement, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    }

    for (const disguisedOwner of [`\u200B${String(selfMeasured.package)}`, String(selfMeasured.package).toUpperCase()]) {
      const disguisedSelfMeasurement = evidence();
      (disguisedSelfMeasurement.outcome as Record<string, unknown>).sourceOwner = disguisedOwner;
      expect(validateCompletionEvidence(disguisedSelfMeasurement, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    }

    const hiddenMeasuredMiss = evidence();
    ((hiddenMeasuredMiss.outcome as Record<string, Record<string, unknown>>).after).value = 0;
    (hiddenMeasuredMiss.outcome as Record<string, unknown>).verdict = "indeterminate";
    (hiddenMeasuredMiss.outcome as Record<string, unknown>).reason = "Caller says the readable outcome is unknown.";
    const hiddenMissReport = validateCompletionEvidence(hiddenMeasuredMiss, ledger());
    expect(hiddenMissReport.result).toMatchObject({ verdict: "violated" });
    expect(hiddenMissReport.findings.some((finding) => finding.rule === "outcome-verdict-setpoint-mismatch")).toBe(true);

    const selfCertifiedFailure = evidence();
    (selfCertifiedFailure.outcome as Record<string, unknown>).verdict = "violated";
    expect(validateCompletionEvidence(selfCertifiedFailure, ledger()).result).toMatchObject({ verdict: "violated" });
  });
});
