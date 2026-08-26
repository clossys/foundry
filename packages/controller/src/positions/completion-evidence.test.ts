import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCompletionEvidenceContract } from "./canonical.js";
import { COMPLETION_EVIDENCE_FIELDS, COMPLETION_EVIDENCE_INDETERMINATE_REASONS, COMPLETION_VERDICTS, DUPLICATE_STATES, INVOCATION_KINDS, PLACEMENT_MODES, validateCompletionEvidence, validateCompletionEvidenceContract } from "./completion-evidence.js";
import { validateInstalledPositionLedger } from "./index.js";
import { isValueSafeReference, MAX_REFERENCE_CODE_UNITS, referenceSafetyOperationCount } from "../internal/reference-safety.js";
import { ADVISOR_CHARTER } from "@vespeneventures/advisor";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const evidence = () => structuredClone(read(join(repoRoot, "docs/contracts/completion-evidence.fixture.json")) as object) as Record<string, unknown>;
const ledger = () => structuredClone(read(join(repoRoot, "docs/contracts/installed-position-ledger.fixture.json")) as object) as Record<string, unknown>;
const at = String.fromCharCode(64);
const unsafeRetainedReferences = [
  "audit credential:secret-value",
  "provider value: prod-api-key",
  "central adoption decision: approve all consumers",
  "locator/query token=credential-value",
  `custom+evidence://reader:reference${at}host.invalid/evidence`,
  `see custom+evidence://reader:reference${at}host.invalid/evidence`,
  `https://${at}host.invalid/evidence`,
  "https://%40host.invalid/evidence",
  `https://\u200b${at}host.invalid/evidence`,
  "https://ref%ZZ@host.invalid/evidence",
  "https://ref%@host.invalid/evidence",
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
const mutateRetainedReference = [
  ["artifact.manifestRef", (item: Record<string, unknown>, value: string) => { (item.artifact as Record<string, unknown>).manifestRef = value; }],
  ["artifact.lockfileRef", (item: Record<string, unknown>, value: string) => { (item.artifact as Record<string, unknown>).lockfileRef = value; }],
  ["artifact.cleanInstallRef", (item: Record<string, unknown>, value: string) => { (item.artifact as Record<string, unknown>).cleanInstallRef = value; }],
  ["invocation.runRef", (item: Record<string, unknown>, value: string) => { (item.invocation as Record<string, unknown>).runRef = value; }],
  ["placement.evidenceRefs[0]", (item: Record<string, unknown>, value: string) => { ((item.placement as Record<string, string[]>).evidenceRefs)[0] = value; }],
  ["control.red.caseRef", (item: Record<string, unknown>, value: string) => { ((item.control as Record<string, Record<string, unknown>>).red).caseRef = value; }],
  ["control.green.caseRef", (item: Record<string, unknown>, value: string) => { ((item.control as Record<string, Record<string, unknown>>).green).caseRef = value; }],
  ["control.red.runRef", (item: Record<string, unknown>, value: string) => { ((item.control as Record<string, Record<string, unknown>>).red).runRef = value; }],
  ["control.green.runRef", (item: Record<string, unknown>, value: string) => { ((item.control as Record<string, Record<string, unknown>>).green).runRef = value; }],
  ["maintenance.duplicate.evidenceRefs[0]", (item: Record<string, unknown>, value: string) => { ((item.maintenance as Record<string, Record<string, unknown>>).duplicate as Record<string, string[]>).evidenceRefs[0] = value; }],
  ["maintenance.rollback.procedureRef", (item: Record<string, unknown>, value: string) => { ((item.maintenance as Record<string, Record<string, unknown>>).rollback).procedureRef = value; }],
  ["maintenance.rollback.verificationRef", (item: Record<string, unknown>, value: string) => { ((item.maintenance as Record<string, Record<string, unknown>>).rollback).verificationRef = value; }],
  ["cadence.runs[0].reference", (item: Record<string, unknown>, value: string) => { (((item.cadence as Record<string, Array<Record<string, unknown>>>).runs)[0]!).reference = value; }],
  ["outcome.sourceRef", (item: Record<string, unknown>, value: string) => { (item.outcome as Record<string, unknown>).sourceRef = value; }],
  ["outcome.before.evidenceRefs[0]", (item: Record<string, unknown>, value: string) => { (((item.outcome as Record<string, Record<string, string[]>>).before).evidenceRefs)[0] = value; }],
  ["outcome.after.evidenceRefs[0]", (item: Record<string, unknown>, value: string) => { (((item.outcome as Record<string, Record<string, string[]>>).after).evidenceRefs)[0] = value; }],
  ["closeWindow.evidenceRefs[0]", (item: Record<string, unknown>, value: string) => { ((item.closeWindow as Record<string, string[]>).evidenceRefs)[0] = value; }],
] as const;

describe("completion evidence", () => {
  it("accepts complete consumer-owned evidence and shipped contract parity", () => {
    const report = validateCompletionEvidence(evidence(), ledger());
    expect(report.result).toEqual({ verdict: "satisfied", evaluated: 1 });
    assert.deepEqual(readCompletionEvidenceContract(), read(join(repoRoot, "docs/contracts/completion-evidence-contract.json")));
    assert.deepEqual(validateCompletionEvidenceContract(readCompletionEvidenceContract()), []);
  });

  it("accepts the published Advisor primaryMetric literal for an Advisor completion", () => {
    const advisorLedger = ledger();
    const advisorEvidence = evidence();
    const dispositions = advisorLedger.dispositions as Array<Record<string, unknown>>;
    const advisorDisposition = dispositions.find((item) => item.package === "@vespeneventures/advisor")!;
    const integratorDisposition = dispositions.find((item) => item.package === "@vespeneventures/integrator")!;
    advisorDisposition.disposition = "open";
    advisorDisposition.positionIds = ["fixture-advisor"];
    integratorDisposition.disposition = "not-applicable";
    integratorDisposition.positionIds = [];
    const position = (advisorLedger.positions as Array<Record<string, unknown>>)[0]!;
    position.id = "fixture-advisor";
    position.package = "@vespeneventures/advisor";
    advisorEvidence.positionId = "fixture-advisor";
    advisorEvidence.package = "@vespeneventures/advisor";
    (advisorEvidence.artifact as Record<string, unknown>).version = "0.1.2";
    (advisorEvidence.outcome as Record<string, unknown>).metric = ADVISOR_CHARTER.primaryMetric;
    expect(validateCompletionEvidence(advisorEvidence, advisorLedger).result).toEqual({ verdict: "satisfied", evaluated: 1 });
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

  it("requires a nonzero, ordered temporal proof for completion", () => {
    const zeroDuration = evidence();
    const t = "2026-08-24T00:00:00.000Z";
    const zeroOutcome = zeroDuration.outcome as Record<string, Record<string, unknown>>;
    (zeroDuration.closeWindow as Record<string, unknown>).startedAt = t;
    (zeroDuration.closeWindow as Record<string, unknown>).endedAt = t;
    zeroOutcome.before.observedAt = t;
    zeroOutcome.after.observedAt = t;
    ((zeroDuration.cadence as Record<string, Array<Record<string, unknown>>>).runs[0] as Record<string, unknown>).occurredAt = t;
    expect(validateCompletionEvidence(zeroDuration, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const equalObservations = evidence();
    const equalOutcome = equalObservations.outcome as Record<string, Record<string, unknown>>;
    equalOutcome.before.observedAt = "2026-08-20T00:00:00.000Z";
    equalOutcome.after.observedAt = "2026-08-20T00:00:00.000Z";
    expect(validateCompletionEvidence(equalObservations, ledger()).findings.some((finding) => finding.rule === "unordered-outcome-observations")).toBe(true);

    const reversed = evidence();
    const reversedOutcome = reversed.outcome as Record<string, Record<string, unknown>>;
    reversedOutcome.before.observedAt = "2026-08-23T00:00:00.000Z";
    reversedOutcome.after.observedAt = "2026-08-20T00:00:00.000Z";
    expect(validateCompletionEvidence(reversed, ledger()).findings.some((finding) => finding.rule === "unordered-outcome-observations")).toBe(true);
  });

  it("binds readable observations and cadence evidence to the close window", () => {
    const beforeOutside = evidence();
    ((beforeOutside.outcome as Record<string, Record<string, unknown>>).before).observedAt = "2026-08-24T00:00:00.000Z";
    expect(validateCompletionEvidence(beforeOutside, ledger()).findings.some((finding) => finding.rule === "outcome-before-not-prechange")).toBe(true);
    expect(validateCompletionEvidence(beforeOutside, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const afterOutside = evidence();
    ((afterOutside.outcome as Record<string, Record<string, unknown>>).after).observedAt = "2026-08-24T00:00:00.001Z";
    expect(validateCompletionEvidence(afterOutside, ledger()).findings.some((finding) => finding.rule === "outcome-after-after-close-start")).toBe(true);
    expect(validateCompletionEvidence(afterOutside, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const cadenceOutside = evidence();
    ((cadenceOutside.cadence as Record<string, Array<Record<string, unknown>>>).runs[0] as Record<string, unknown>).occurredAt = "2026-08-23T23:59:59.999Z";
    expect(validateCompletionEvidence(cadenceOutside, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "outcome-indeterminate" });

    const malformed = evidence();
    (malformed.closeWindow as Record<string, unknown>).startedAt = "not-an-instant";
    expect(validateCompletionEvidence(malformed, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const unreadableTimestamp = evidence();
    ((unreadableTimestamp.outcome as Record<string, Record<string, unknown>>).after).observedAt = "not-an-instant";
    expect(validateCompletionEvidence(unreadableTimestamp, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
  });

  it("accepts inclusive close-window boundaries with a positive duration", () => {
    const boundary = evidence();
    const cadence = boundary.cadence as Record<string, Array<Record<string, unknown>>>;
    cadence.runs.push({ occurredAt: "2026-08-24T00:00:00.000Z", reference: "fixture/initial-boundary-run.txt", verdict: "satisfied" });
    cadence.runs.push({ occurredAt: "2026-08-31T00:00:00.000Z", reference: "fixture/closing-boundary-run.txt", verdict: "satisfied" });
    expect(validateCompletionEvidence(boundary, ledger()).result).toEqual({ verdict: "satisfied", evaluated: 1 });

    const endpointCadenceOnly = evidence();
    (endpointCadenceOnly.cadence as Record<string, Array<Record<string, unknown>>>).runs = [
      { occurredAt: "2026-08-24T00:00:00.000Z", reference: "fixture/initial-boundary-run.txt", verdict: "satisfied" },
      { occurredAt: "2026-08-31T00:00:00.000Z", reference: "fixture/closing-boundary-run.txt", verdict: "satisfied" },
    ];
    expect(validateCompletionEvidence(endpointCadenceOnly, ledger()).result).toEqual({ verdict: "satisfied", evaluated: 1 });
  });

  it("binds completion evidence to its linked position and aggregates the close-window cadence", () => {
    const sameControlCase = evidence();
    ((sameControlCase.control as Record<string, Record<string, unknown>>).green).caseRef = `${String((sameControlCase.control as Record<string, Record<string, unknown>>).red.caseRef)} `;
    expect(validateCompletionEvidence(sameControlCase, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const malformedInstant = evidence();
    (malformedInstant.invocation as Record<string, unknown>).occurredAt = "0";
    expect(validateCompletionEvidence(malformedInstant, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const nonSemver = evidence();
    (nonSemver.artifact as Record<string, unknown>).version = "1.0.0-01";
    expect(validateCompletionEvidence(nonSemver, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const unrelatedSource = evidence();
    (unrelatedSource.outcome as Record<string, unknown>).sourceRef = "fixture/other-outcome.json";
    expect(validateCompletionEvidence(unrelatedSource, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const alteredBaseline = evidence();
    ((alteredBaseline.outcome as Record<string, Record<string, unknown>>).before).value = 0.4;
    expect(validateCompletionEvidence(alteredBaseline, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const reorderedBaselineRefs = evidence();
    const reorderedBaselineLedger = ledger();
    ((reorderedBaselineRefs.outcome as Record<string, Record<string, unknown>>).before).evidenceRefs = ["fixture-second-baseline", "fixture-baseline"];
    (((reorderedBaselineLedger.positions as Array<Record<string, Record<string, unknown>>>)[0]!.baseline).evidenceRefs) = ["fixture-baseline", "fixture-second-baseline"];
    expect(validateCompletionEvidence(reorderedBaselineRefs, reorderedBaselineLedger).result).toEqual({ verdict: "satisfied", evaluated: 1 });

    const violatedCadence = evidence();
    (violatedCadence.cadence as Record<string, Array<Record<string, unknown>>>).runs.push({ occurredAt: "2026-08-30T00:00:00.000Z", reference: "fixture/failed-recurring-run.txt", verdict: "violated" });
    expect(validateCompletionEvidence(violatedCadence, ledger()).result).toMatchObject({ verdict: "violated" });

    const indeterminateCadence = evidence();
    (indeterminateCadence.cadence as Record<string, Array<Record<string, unknown>>>).runs.push({ occurredAt: "2026-08-30T00:00:00.000Z", reference: "fixture/unreadable-recurring-run.txt", verdict: "indeterminate" });
    expect(validateCompletionEvidence(indeterminateCadence, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "outcome-indeterminate" });

    const alreadyAtSetpoint = evidence();
    const alreadyAtSetpointLedger = ledger();
    ((alreadyAtSetpoint.outcome as Record<string, Record<string, unknown>>).before).value = 1;
    (((alreadyAtSetpointLedger.positions as Array<Record<string, Record<string, unknown>>>)[0]!.baseline).value) = 1;
    expect(validateCompletionEvidence(alreadyAtSetpoint, alreadyAtSetpointLedger).result).toMatchObject({ verdict: "violated" });
  });

  it("holds phase and cadence boundaries fail-closed", () => {
    const startOnly = evidence();
    (startOnly.cadence as Record<string, Array<Record<string, unknown>>>).runs = [{ occurredAt: "2026-08-24T00:00:00.000Z", reference: "fixture/start-run.txt", verdict: "satisfied" }];
    expect(validateCompletionEvidence(startOnly, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "outcome-indeterminate" });

    const violatedAtStart = evidence();
    (violatedAtStart.cadence as Record<string, Array<Record<string, unknown>>>).runs = [
      { occurredAt: "2026-08-24T00:00:00.000Z", reference: "fixture/start-run.txt", verdict: "violated" },
      { occurredAt: "2026-08-31T00:00:00.000Z", reference: "fixture/end-run.txt", verdict: "satisfied" },
    ];
    expect(validateCompletionEvidence(violatedAtStart, ledger()).result).toMatchObject({ verdict: "violated" });

    const indeterminateAtStart = evidence();
    (indeterminateAtStart.cadence as Record<string, Array<Record<string, unknown>>>).runs = [
      { occurredAt: "2026-08-24T00:00:00.000Z", reference: "fixture/start-run.txt", verdict: "indeterminate" },
      { occurredAt: "2026-08-31T00:00:00.000Z", reference: "fixture/end-run.txt", verdict: "satisfied" },
    ];
    expect(validateCompletionEvidence(indeterminateAtStart, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "outcome-indeterminate" });

    for (const [field, at, rule] of [
      ["invocation", "2026-08-16T00:00:00.000Z", "outcome-before-not-prechange"],
      ["rollback", "2026-08-23T00:00:00.000Z", "rollback-before-control"],
      ["rollback", "2026-08-25T00:00:00.000Z", "outcome-after-before-rollback"],
    ] as const) {
      const phased = evidence();
      if (field === "invocation") (phased.invocation as Record<string, unknown>).occurredAt = at;
      else ((phased.maintenance as Record<string, Record<string, unknown>>).rollback).verifiedAt = at;
      expect(validateCompletionEvidence(phased, ledger()).findings.some((finding) => finding.rule === rule)).toBe(true);
    }

    for (const malformed of ["0", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-08-24T00:00:00.1234Z", "2026-08-24T00:00:00.000-00:00"]) {
      const malformedInstant = evidence();
      (malformedInstant.invocation as Record<string, unknown>).occurredAt = malformed;
      expect(validateCompletionEvidence(malformedInstant, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    }

    const plusZeroOffsetEvidence = JSON.parse(JSON.stringify(evidence()).replaceAll(".000Z", ".000+00:00")) as Record<string, unknown>;
    const plusZeroOffsetLedger = JSON.parse(JSON.stringify(ledger()).replaceAll(".000Z", ".000+00:00")) as Record<string, unknown>;
    expect(validateCompletionEvidence(plusZeroOffsetEvidence, plusZeroOffsetLedger).result).toEqual({ verdict: "satisfied", evaluated: 1 });

    for (const [controlAt, rollbackAt] of [["2026-08-24T00:00:00.0001Z", "2026-08-24T00:00:00.0009Z"], ["2026-08-24T00:00:00.0009Z", "2026-08-24T00:00:00.0001Z"]]) {
      const subMillisecond = evidence();
      (subMillisecond.invocation as Record<string, unknown>).occurredAt = controlAt;
      const control = subMillisecond.control as Record<string, Record<string, unknown>>;
      control.red.occurredAt = controlAt;
      control.green.occurredAt = controlAt;
      ((subMillisecond.maintenance as Record<string, Record<string, unknown>>).rollback).verifiedAt = rollbackAt;
      expect(validateCompletionEvidence(subMillisecond, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    }
  });

  it("does not let caller labels hide linked-source or cadence findings", () => {
    const paddedPosition = evidence();
    const paddedPositionLedger = ledger();
    const paddedId = " fixture-integrator ";
    (paddedPositionLedger.positions as Array<Record<string, unknown>>)[0]!.id = paddedId;
    ((paddedPositionLedger.dispositions as Array<Record<string, unknown>>).find((item) => item.package === "@vespeneventures/integrator")!).positionIds = [paddedId];
    paddedPosition.positionId = paddedId;
    (paddedPosition.outcome as Record<string, unknown>).sourceOwner = "fixture-integrator";
    expect(validateCompletionEvidence(paddedPosition, paddedPositionLedger).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    for (const invisible of ["\u034f", "\u061c", "\u200e", "\u200f", "\u202a", "\u2069"]) {
      const invisiblePosition = evidence();
      const invisiblePositionLedger = ledger();
      const invisibleId = `${invisible}fixture-integrator`;
      (invisiblePositionLedger.positions as Array<Record<string, unknown>>)[0]!.id = invisibleId;
      ((invisiblePositionLedger.dispositions as Array<Record<string, unknown>>).find((item) => item.package === "@vespeneventures/integrator")!).positionIds = [invisibleId];
      invisiblePosition.positionId = invisibleId;
      (invisiblePosition.outcome as Record<string, unknown>).sourceOwner = "fixture-integrator";
      expect(validateCompletionEvidence(invisiblePosition, invisiblePositionLedger).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    }

    const selfAuthority = evidence();
    (selfAuthority.outcome as Record<string, unknown>).sourceOwner = "fixture automation";
    const paddedAuthorityLedger = ledger();
    (((paddedAuthorityLedger.positions as Array<Record<string, Record<string, unknown>>>)[0]!.authority).actionAuthority) = " fixture automation ";
    expect(validateCompletionEvidence(selfAuthority, paddedAuthorityLedger).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    for (const invisible of ["\u034f", "\u061c", "\u200e", "\u200f", "\u202a", "\u2069"]) {
      const invisibleAuthority = evidence();
      (invisibleAuthority.outcome as Record<string, unknown>).sourceOwner = "fixture automation";
      const invisibleAuthorityLedger = ledger();
      (((invisibleAuthorityLedger.positions as Array<Record<string, Record<string, unknown>>>)[0]!.authority).actionAuthority) = `${invisible}fixture automation`;
      expect(validateCompletionEvidence(invisibleAuthority, invisibleAuthorityLedger).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    }

    const wrongSchedule = evidence();
    (wrongSchedule.cadence as Record<string, unknown>).schedule = "another review";
    expect(validateCompletionEvidence(wrongSchedule, ledger()).result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });

    const unreadableOutcomeWithCloseViolation = evidence();
    const outcome = unreadableOutcomeWithCloseViolation.outcome as Record<string, unknown>;
    outcome.verdict = "indeterminate";
    outcome.reason = "No independently readable outcome yet.";
    const after = outcome.after as Record<string, unknown>;
    after.state = "unreadable";
    after.value = null;
    after.observedAt = null;
    after.evidenceRefs = [];
    after.reason = "No after observation.";
    (unreadableOutcomeWithCloseViolation.closeWindow as Record<string, unknown>).verdict = "violated";
    expect(validateCompletionEvidence(unreadableOutcomeWithCloseViolation, ledger()).result).toMatchObject({ verdict: "violated" });

    const chronology = evidence();
    (chronology.cadence as Record<string, Array<Record<string, unknown>>>).runs.push({ occurredAt: "2026-08-30T00:00:00.000Z", reference: "fixture/fail.txt", verdict: "violated" });
    const reordered = structuredClone(chronology) as Record<string, unknown>;
    ((reordered.cadence as Record<string, Array<Record<string, unknown>>>).runs).reverse();
    expect(validateCompletionEvidence(chronology, ledger()).result).toEqual(validateCompletionEvidence(reordered, ledger()).result);
  });

  it("rejects value-bearing retained references and locators without resolving them", () => {
    for (const unsafe of unsafeRetainedReferences) expect(isValueSafeReference(unsafe), unsafe).toBe(false);
    const canonicalUnsafe = unsafeRetainedReferences[6]!;
    for (const [path, change] of mutateRetainedReference) {
      const item = evidence();
      change(item, canonicalUnsafe);
      const report = validateCompletionEvidence(item, ledger());
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
      expect(report.findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path }));
      expect(JSON.stringify(report.findings)).not.toContain(canonicalUnsafe);
    }

    const unsafeLocator = ledger();
    (((unsafeLocator.positions as Array<Record<string, Record<string, unknown>>>)[0]!.evidenceSource).locator) = unsafeRetainedReferences[3]!;
    expect(validateCompletionEvidence(evidence(), unsafeLocator).result).toMatchObject({ verdict: "indeterminate", reason: "invalid-position-ledger" });

    const overlongReference = evidence();
    (overlongReference.artifact as Record<string, unknown>).manifestRef = "a".repeat(MAX_REFERENCE_CODE_UNITS + 1);
    const overlongReport = validateCompletionEvidence(overlongReference, ledger());
    expect(overlongReport.findings).toContainEqual({ rule: "reference-length-exceeded", path: "artifact.manifestRef", message: "must be at most 65,536 code units" });

    const benignReferences = ["fixture/token-value-redaction.json", "fixture/provider-value-policy.json", "fixture/no-central-adoption-decision.json", "fixture/approve-all-consumers-negative-case.json", "fixture/credential-rotation.json", "urn:credential:policy", `urn:example://reader${at}v1`, `mailto:reader${at}host.invalid`, "https://example.invalid/docs/token:reference", "fixture/authorization:policy", "docs/credential:policy", "https://example.invalid:443/evidence", "ftp://example.invalid:21/evidence", "custom+evidence://example.invalid/evidence", `fixture/custom://reader${at}v1`, `https://host.invalid/release/custom://reader${at}v1`, `custom:///reader${at}v1`, `///reader${at}v1`, `custom:/\\reader:reference${at}v1`, "https:///host.invalid/evidence", "https:host.invalid/evidence", "https:/host.invalid/evidence", "https:\\\\host.invalid/evidence", "https://example.invalid/?note=credential:policy", "fixture/provider+value=policy", "https://example.invalid/docs/provider+value=policy", `fixture-//reader:reference${at}v1`, `https://host.invalid/release-//reader:reference${at}v1`, `urn:example:custom://reader${at}v1`, `référencehttps://reader:reference${at}host.invalid/evidence`, `https://host.invalid/files/(archive)//reader:reference${at}v1`, `https://host.invalid/files,//reader:reference${at}v1`, `https://host.invalid/files,custom://reader${at}v1`, `https://host.invalid/a,https://reader:reference${at}v1`, `https://host.invalid/a;custom://reader:reference${at}v1`, `https://host.invalid/a%20https%3A%2F%2Freader%3Areference%40v1`, `https://host.invalid/😀%20https%3A%2F%2Freader%3Areference%40v1`, `urn:example,(//reader:reference${at}v1)`, `urn:example,custom://reader:reference${at}v1`, `/files,custom://reader:reference${at}v1`, `fixture/a,https://reader:reference${at}v1`, "fixture/café-policy.json", "urn:example:東京", "https%3A%2F%2Fhost.invalid%2Fpath%40v1", "https%3A%2F%2Fhost.invalid%3Fpath%40v1", "https%3A%2F%2Fhost.invalid%23path%40v1", "https%253A%252F%252Fhost.invalid%252Fpath%2540v1", "https%253A%252F%252Fhost.invalid%253Fpath%2540v1", "https%253A%252F%252Fhost.invalid%2523path%2540v1", `files,custom://reader${at}v1`, `see,custom://reader${at}v1`, `“https://reader:reference${at}v1`, `𐐀https://reader:reference${at}v1`, `𐐀//reader:reference${at}v1`];
    const rootWrappedAuthority = `“https://reader:reference${at}v1`;
    // A curly quote is an explicit root wrapper, so this is not an opaque identifier.
    expect(isValueSafeReference(rootWrappedAuthority), rootWrappedAuthority).toBe(false);
    for (const benign of benignReferences.filter((reference) => reference !== rootWrappedAuthority)) {
      expect(isValueSafeReference(benign), benign).toBe(true);
    }
    for (const [path, change] of mutateRetainedReference) {
      const item = evidence();
      change(item, benignReferences[30]!);
      expect(validateCompletionEvidence(item, ledger()).findings.some((finding) => finding.rule === "unsafe-evidence-reference" && finding.path === path)).toBe(false);
    }
    for (const unsafe of [
      "access_token=example", "client_secret: example", "credential:value", "audit credential:secret-value", "central adoption decision:approve", "{\"token\":\"example\"}", "{\"credential\":\"example\"}", "{\"api_key\":\"example\"}", "credential%3Dexample", "credential%253Dvalue", "credential%3Dvalue&bad=%ZZ", "credential%3D%E0%A4value", "providerValue=example", "provider.value: example", "provider+value=foo", "https://example.invalid/?provider+value=foo", "fixture/provider value: prod-id", "note central adoption decision: adopted",
      `https://reader:reference${at}host.invalid/evidence`, `https://${at}host.invalid/evidence`, `//${at}host.invalid/evidence`, "https://%40host.invalid/evidence", `https://\u200b${at}host.invalid/evidence`, `https://ref%ZZ${at}host.invalid/evidence`, `https://ref%${at}host.invalid/evidence`, `https://ref ${at}host.invalid/evidence`, `https://credential:secret%2Fpart${at}host.invalid/evidence`, `custom://token:abc%3Fdef${at}host.invalid/evidence`, `ftp://authorization:abc%23def${at}host.invalid/evidence`, `https://credential:secret%20part${at}host.invalid/evidence`, `https://credential%20:secret${at}host.invalid/evidence`, `//reader:reference${at}host.invalid/evidence`, `see https://credential:secret-value${at}host.invalid/evidence`, `see //token:secret${at}host.invalid/evidence`, "https%3A%2F%2Fcredential%3Asecret%2Fpart%40host.invalid%2Fevidence", "https%253A%252F%252Fcredential%253Asecret%252Fpart%2540host.invalid%252Fevidence", `https://ｃｒｅｄｅｎｔｉａｌ:secret-value${at}host.invalid/evidence`, `https://cre\u200bdential:secret-value${at}host.invalid/evidence`,
      `https:///reader:reference${at}host.invalid/evidence`, `https:////reader:reference${at}host.invalid/evidence`, `https:/\\reader:reference${at}host.invalid/evidence`, `https:\\\\reader:reference${at}host.invalid/evidence`, `https://reader:\nreference${at}host.invalid/evidence`, `https://reader:\rreference${at}host.invalid/evidence`, `https://reader:\treference${at}host.invalid/evidence`, `prefix\n//reader:reference${at}host.invalid/evidence`, "https%3A%2F%2F%2Freader%3Areference%40host.invalid", "https%253A%252F%252F%252Freader%253Areference%2540host.invalid",
      `urn:example?next=https://reader:reference${at}host.invalid/evidence`, `urn:example#//reader:reference${at}host.invalid/evidence`, `urn:example?a=1&next=https://reader:reference${at}host.invalid/evidence`, `https://host.invalid/path\u2028https://reader:reference${at}host.invalid/evidence`, `https%3a//reader:reference${at}host.invalid/evidence`,
      "credential\u00ad=value", "to\u180eken=value", "to\u034fken=value", "to\u202aken=value", "to\u200bken=example", "to%E2%80%8Bken=example", "%EF%BD%94%EF%BD%8F%EF%BD%8B%EF%BD%85%EF%BD%8E%3Dexample",
    ].filter((unsafe) => unsafe !== `https://ref ${at}host.invalid/evidence`)) {
      expect(isValueSafeReference(unsafe), unsafe).toBe(false);
    }
    expect(isValueSafeReference(`https://ref ${at}host.invalid/evidence`)).toBe(true);
  });

  it("uses bounded layers, literal structure, and scoped authority candidates", () => {
    const rejects = [
      "%68ttps%3A%2F%2Freader%3Asecret%40host/e", "%2568ttps%253A%252F%252Freader%253Asecret%2540host/e",
      "https://reader:secret@host/e", "https:reader:secret@host/e", "https:///reader:secret@host/e", "https://reader:secret%2Fpart@host/e", "https://reader:secret%40host/e",
      "urn%3Aexample%3Fnext%3Dhttps%3A%2F%2Freader%3Asecret%40host/e", "urn%253Aexample%253Fnext%253Dhttps%253A%252F%252Freader%253Asecret%2540host/e",
      "mailto%3Areader%40host%3Fnext%3D%2F%2Freader%3Asecret%40host/e", "mailto%253Areader%2540host%253Fnext%253D%252F%252Freader%253Asecret%2540host/e",
      "https://outer.invalid/?next=(https://reader:secret@host/e)", "https://outer.invalid/?next=[//reader:secret@host/e]", "https://outer.invalid/#next={https://reader:secret@host/e}", "https://outer.invalid/?next=\"https://reader:secret@host/e\"", "https://outer.invalid/?next={\"url\":\"https://reader:secret@host/e\"}",
      "(https://reader:secret@host/e)", "[https://reader:secret@host/e]", "{https://reader:secret@host/e}", "\"https://reader:secret@host/e\"", "—https://reader:secret@host/e",
      "https://safe.invalid,https://reader:secret@host/e", "https://safe.invalid;https://reader:secret@host/e", "https://safe.invalid)https://reader:secret@host/e",
      "https://safe.invalid/path\u2028https://reader:secret@host/e", "prefix\u2029//reader:secret@host/e", "https://reader:sec\tret@host/e", "https://reader:sec\rret@host/e", "https://reader:sec\nret@host/e",
    ];
    const accepts = [
      "https%3A//host.invalid/path@v1", "https%253A%2F%2Fhost.invalid/path%40v1", "https:%2F%2Fhost.invalid/path@v1", "custom%3A//host.invalid/path@v1", "custom%253A%2F%2Fhost.invalid/path%40v1",
      "https%3A%2F%2Fhost.invalid%2Fpath%40v1", "https%253A%252F%252Fhost.invalid%253Fpath%2540v1", "https://host.invalid/files/(archive)//reader:reference@v1", "https://host.invalid/a%20https%3A%2F%2Freader%3Areference%40v1",
      "urn:example://reader@v1", "mailto:reader@host.invalid", "files,custom://reader@v1", "fixture‿https://reader:reference@v1", "fixture$https://reader:reference@v1", "𐐀https://reader:reference@v1", "https://host.invalid/?note=files,custom://reader@v1",
    ];
    for (const value of rejects) expect(isValueSafeReference(value), value).toBe(false);
    for (const value of accepts) expect(isValueSafeReference(value), value).toBe(true);
    // A path/opaque source atom stays protected in later percent-decoded layers.
    expect(isValueSafeReference("https://host.invalid/%68ttps%3A%2F%2Freader%3Asecret%40host/e")).toBe(true);
  });

  it("reopens opaque and stripped structural views only at real root atoms", () => {
    const rejects = [
      "urn:example https://reader:secret@host/e", "urn:example\thttps://reader:secret@host/e", "urn:example\nhttps://reader:secret@host/e", "urn:example\rhttps://reader:secret@host/e", "urn:example\u1680https://reader:secret@host/e", "urn:example\u2028https://reader:secret@host/e", "urn:example\u2029https://reader:secret@host/e",
      "urn:example%20https%3A%2F%2Freader%3Asecret%40host/e", "urn:example%2520https%253A%252F%252Freader%253Asecret%2540host/e",
      "prefix\n//reader:sec\rret@host", "https://safe.invalid\thttps://reader:sec\tret@host",
      "(https://reader:secret@host/e)", "prefix [https://reader:secret@host/e]",
    ];
    const accepts = [
      "urn:example,custom://reader:secret@host/e", "https://host.invalid/files/(https://reader:secret@host/e)", "fixture/(https://reader:secret@host/e)", "./files/[https://reader:secret@host/e]",
    ];
    for (const value of rejects) expect(isValueSafeReference(value), value).toBe(false);
    for (const value of accepts) expect(isValueSafeReference(value), value).toBe(true);
    for (const [path, change] of mutateRetainedReference) {
      const item = evidence();
      change(item, "prefix\n//reader:sec\rret@host");
      expect(validateCompletionEvidence(item, ledger()).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path }));
    }
  });

  it("defers unstable cross-depth structure without exposing established paths", () => {
    const rejects = [
      "https:%2F/u:p@host.invalid/e", "https:%252F/u:p@host.invalid/e", "https%3A:/%2Fu:p@host.invalid/e", "https:%5C\\u:p@host.invalid/e", "ftp:%2F/u:p@host.invalid/e", "custom:%2F/u:p@host.invalid/e",
      "https://host.invalid%3Fnext=https://reader:secret@host.invalid/e", "urn:example%3Fnext=https://reader:secret@host.invalid/e", "urn:example%253Fnext=https%253A%252F%252Freader%253Asecret%2540host.invalid/e",
    ];
    const accepts = [
      "https://host.invalid/%3Fnext=https%3A%2F%2Freader%3Asecret%40host.invalid/e", "fixture/path%20https%3A%2F%2Freader%3Aref%40v1", "/fixture/path%20https%3A%2F%2Freader%3Aref%40v1", "./fixture/path%20https%3A%2F%2Freader%3Aref%40v1",
      "https://outer.invalid/?next=[\"files,https://reader@v1\"]", "https://outer.invalid/?next={\"note\":\"fixture;https://reader@v1\"}",
    ];
    for (const value of rejects) expect(isValueSafeReference(value), value).toBe(false);
    for (const value of accepts) expect(isValueSafeReference(value), value).toBe(true);
    for (const [path, change] of mutateRetainedReference) {
      const item = evidence();
      change(item, rejects[0]!);
      expect(validateCompletionEvidence(item, ledger()).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path }));
    }
  });

  it("keeps deferred root paths, authority delimiters, and JSON strings scoped", () => {
    const rejects = [
      "%68ttps:/%2Fu:p@host.invalid/e", "https:%25%32%66/u:p@host.invalid/e",
      "https://outer.invalid/?json={\"u\":\"(https://reader:secret@host.invalid/e)\"}", "https://outer.invalid/?json={\"u\":\"https://safe.invalid/e https://reader:secret@host.invalid/e\"}",
    ];
    const accepts = [
      "https://host.invalid%3Fnext=/path@v1", "https://host.invalid%2F/path@v1", "https://host.invalid%3A443/path@v1",
    ];
    for (const value of rejects) expect(isValueSafeReference(value), value).toBe(false);
    for (const value of accepts) expect(isValueSafeReference(value), value).toBe(true);
    for (const [path, change] of mutateRetainedReference) {
      const item = evidence();
      change(item, rejects[0]!);
      expect(validateCompletionEvidence(item, ledger()).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path }));
    }
  });

  it("rejects sensitive authority assignments at every authority termination", () => {
    const literal = [
      "https://credential:secret-value", "https://credential:secret-value ", "https://credential:secret-value)",
      "https://credential:secret-value/path", "https://credential:secret-value?next=fixture", "https://credential:secret-value#fragment", "https://credential:secret-value\\path",
      "https://credential:secret-value%2fpath", "https://credential:secret-value%252fpath",
    ];
    const layerOne = [
      "https%3a%2f%2fcredential%3asecret-value", "https%3a%2f%2fcredential%3asecret-value%20", "https%3a%2f%2fcredential%3asecret-value%29",
      "https%3a%2f%2fcredential%3asecret-value%2fpath", "https%3a%2f%2fcredential%3asecret-value%3fnext", "https%3a%2f%2fcredential%3asecret-value%23fragment", "https%3a%2f%2fcredential%3asecret-value%5cpath",
    ];
    const layerTwo = ["https%253a%252f%252fcredential%253asecret-value", "https%253a%252f%252fcredential%253asecret-value%2520", "https%253a%252f%252fcredential%253asecret-value%252fpath"];
    for (const value of [...literal, ...layerOne, ...layerTwo]) expect(isValueSafeReference(value), value).toBe(false);
    for (const value of ["https://host:443", "https://host:443 ", "https://host:443)", "https://host:443/path", "urn:credential:policy", "fixture/credential:policy"]) expect(isValueSafeReference(value), value).toBe(true);

    const unsafeLedger = ledger();
    (((unsafeLedger.positions as Array<Record<string, Record<string, string>>>)[0]!.evidenceSource).locator) = literal[0]!;
    expect(validateInstalledPositionLedger(unsafeLedger).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path: "positions[0].evidenceSource.locator" }));
    const unsafeEvidence = evidence();
    (unsafeEvidence.artifact as Record<string, unknown>).manifestRef = layerTwo[0]!;
    const unsafeReport = validateCompletionEvidence(unsafeEvidence, ledger());
    expect(unsafeReport.result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    expect(unsafeReport.findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path: "artifact.manifestRef" }));
  });

  it("does not let wrapper boundaries hide authority userinfo or a second URL", () => {
    const openingWrappers = ["(", "[", "{", "<", "\"", "'", "“", "‘", "–", "—"];
    const postAuthority = [",", ";", ")", "]", "}", ">", "\"", "'", "”", "’", ...openingWrappers];
    const authorityPrefixes = ["https://", "custom://", "//"];
    const encodeLayers = (value: string): readonly string[] => [value, encodeURIComponent(value), encodeURIComponent(encodeURIComponent(value))];
    for (const wrapper of postAuthority) for (const prefix of authorityPrefixes) {
      const reference = `${prefix}reader${wrapper}${at}host.invalid/evidence`;
      for (const encoded of encodeLayers(reference)) expect(isValueSafeReference(encoded), encoded).toBe(false);
    }
    for (const wrapper of openingWrappers) {
      const reference = `https://safe.invalid${wrapper}https://reader:secret${at}host.invalid/evidence`;
      for (const encoded of encodeLayers(reference)) expect(isValueSafeReference(encoded), encoded).toBe(false);
    }
    for (const value of [
      "https://safe.invalid—https://host.invalid/evidence", "https://safe.invalid(https://host.invalid/evidence", `https://host.invalid/files/(archive)//reader${at}host.invalid`, `fixture/(reader)${at}host.invalid`, "urn:example,(//reader@v1)",
    ]) expect(isValueSafeReference(value), value).toBe(true);

    const unsafeLedger = ledger();
    (((unsafeLedger.positions as Array<Record<string, Record<string, string>>>)[0]!.evidenceSource).locator) = `https://reader)${at}host.invalid/evidence`;
    expect(validateInstalledPositionLedger(unsafeLedger).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path: "positions[0].evidenceSource.locator" }));
    const unsafeEvidence = evidence();
    (unsafeEvidence.artifact as Record<string, unknown>).manifestRef = `https://safe.invalid—https://reader:secret${at}host.invalid/evidence`;
    const unsafeReport = validateCompletionEvidence(unsafeEvidence, ledger());
    expect(unsafeReport.result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    expect(unsafeReport.findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path: "artifact.manifestRef" }));
  });

  it("stops deferring once the bounded final layer has actual structure", () => {
    const rejects = [
      "https://%25user@host.invalid/e", "https%253A%252F%252F%2525user%2540host.invalid%252Fe",
      "urn%253A%2525foo%253Fnext%253Dhttps%253A%252F%252Freader%253Asecret%2540host.invalid%252Fe",
    ];
    for (const value of rejects) expect(isValueSafeReference(value), value).toBe(false);
    for (const [path, change] of mutateRetainedReference) {
      const item = evidence();
      change(item, rejects[1]!);
      expect(validateCompletionEvidence(item, ledger()).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path }));
    }
  });

  it("bounds adversarial reference normalization near the length cap", () => {
    // The authority scanner makes one linear pass per bounded normalization
    // stage; long near-misses stay ordinary retained references.
    expect(isValueSafeReference("a".repeat(20_000))).toBe(true);
    expect(isValueSafeReference("a".repeat(MAX_REFERENCE_CODE_UNITS))).toBe(true);
    expect(isValueSafeReference("a".repeat(MAX_REFERENCE_CODE_UNITS + 1))).toBe(false);
    expect(isValueSafeReference(`https:${"/".repeat(20_000)}`)).toBe(true);
    expect(isValueSafeReference("https://safe.invalid then ".repeat(2_000))).toBe(true);
    const compactViewNearMiss = "https://x" + "\ta".repeat(16_000);
    expect(isValueSafeReference(compactViewNearMiss)).toBe(true);
    // Every fixed decoder/view pass may visit each scalar a constant number of
    // times. This exact compact-view shape used to rescan every later `a`.
    expect(referenceSafetyOperationCount(compactViewNearMiss)).toBeLessThanOrEqual(compactViewNearMiss.length * 64);
    expect(isValueSafeReference(`https://outer.invalid/?${"a=1&".repeat(13_000)}safe`)).toBe(true);
    let deepNestedQuery = "fixture/terminal.json";
    for (let depth = 0; depth < 2_400; depth += 1) deepNestedQuery = `https://safe.invalid/?next=${deepNestedQuery}`;
    expect(deepNestedQuery.length).toBeLessThanOrEqual(MAX_REFERENCE_CODE_UNITS);
    expect(isValueSafeReference(deepNestedQuery)).toBe(true);
    // Long malformed percent-encoded inputs must complete with a safe verdict.
    expect(isValueSafeReference("%FF".repeat(10_000))).toBe(true);
    expect(isValueSafeReference("%".repeat(10_000))).toBe(true);
  });

  it("iterates long source-atom authority chains without recursion", () => {
    const safeChain = "https://a" + "\thttps://a".repeat(6_000);
    const unsafeChain = `${safeChain}\thttps://reader:secret${at}host.invalid/evidence`;
    expect(safeChain.length).toBeLessThanOrEqual(MAX_REFERENCE_CODE_UNITS);
    expect(() => isValueSafeReference(safeChain)).not.toThrow();
    expect(isValueSafeReference(safeChain)).toBe(true);
    expect(referenceSafetyOperationCount(safeChain)).toBeLessThanOrEqual(safeChain.length * 64);
    expect(() => isValueSafeReference(unsafeChain)).not.toThrow();
    expect(isValueSafeReference(unsafeChain)).toBe(false);
    expect(referenceSafetyOperationCount(unsafeChain)).toBeLessThanOrEqual(unsafeChain.length * 64);

    const mixed = `https://a\tcustom://a\t//a\thttps://reader:secret${at}host.invalid/evidence`;
    expect(isValueSafeReference(mixed)).toBe(false);

    const safeLedger = ledger();
    (((safeLedger.positions as Array<Record<string, Record<string, string>>>)[0]!.evidenceSource).locator) = safeChain;
    expect(validateInstalledPositionLedger(safeLedger).ok).toBe(true);
    const unsafeLedger = ledger();
    (((unsafeLedger.positions as Array<Record<string, Record<string, string>>>)[0]!.evidenceSource).locator) = unsafeChain;
    expect(validateInstalledPositionLedger(unsafeLedger).findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path: "positions[0].evidenceSource.locator" }));

    const safeEvidence = evidence();
    (safeEvidence.artifact as Record<string, unknown>).manifestRef = safeChain;
    expect(validateCompletionEvidence(safeEvidence, ledger()).result).toEqual({ verdict: "satisfied", evaluated: 1 });
    const unsafeEvidence = evidence();
    (unsafeEvidence.artifact as Record<string, unknown>).manifestRef = unsafeChain;
    const unsafeReport = validateCompletionEvidence(unsafeEvidence, ledger());
    expect(unsafeReport.result).toMatchObject({ verdict: "indeterminate", reason: "unreadable-or-incomplete-evidence" });
    expect(unsafeReport.findings).toContainEqual(expect.objectContaining({ rule: "unsafe-evidence-reference", path: "artifact.manifestRef" }));
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
