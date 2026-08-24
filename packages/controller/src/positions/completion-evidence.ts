/**
 * Consumer completion evidence: validates one consumer-owned record without
 * reading a registry, CI provider, secret store, or outcome system. The
 * consumer retains those facts; this module only refuses to mistake their
 * absence for a completed position.
 */
import { createGateReasons, gateSatisfied, gateViolated, type GateResult } from "../gates/result.js";
import { readCompletionEvidenceContract } from "./canonical.js";
import { validateInstalledPositionLedger, type InstalledPositionFinding } from "./index.js";

export const COMPLETION_EVIDENCE_FIELDS = Object.freeze([
  "schemaVersion", "positionId", "package", "artifact", "invocation", "placement", "control", "maintenance", "cadence", "outcome", "closeWindow",
] as const);
export const COMPLETION_VERDICTS = Object.freeze(["satisfied", "violated", "indeterminate"] as const);
export const INVOCATION_KINDS = Object.freeze(["cli", "export"] as const);
export const PLACEMENT_MODES = Object.freeze(["blocking", "not-applicable"] as const);
export const DUPLICATE_STATES = Object.freeze(["removed", "not-applicable"] as const);
export const COMPLETION_EVIDENCE_INDETERMINATE_REASONS = Object.freeze([
  "unreadable-or-incomplete-evidence",
  "invalid-position-ledger",
  "outcome-indeterminate",
] as const);

export type CompletionEvidenceFinding = InstalledPositionFinding;
export type CompletionEvidenceIndeterminateReason = (typeof COMPLETION_EVIDENCE_INDETERMINATE_REASONS)[number];
export interface CompletionEvidenceReport {
  readonly result: GateResult<CompletionEvidenceFinding, CompletionEvidenceIndeterminateReason>;
  /** Structural findings are retained even when the public result is indeterminate. */
  readonly findings: readonly CompletionEvidenceFinding[];
  readonly positionId?: string;
  readonly package?: string;
}

type RecordValue = Record<string, unknown>;
const completionReasons = createGateReasons(COMPLETION_EVIDENCE_INDETERMINATE_REASONS);
const roleName = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function record(value: unknown): value is RecordValue { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function keys(value: unknown, expected: readonly string[]): value is RecordValue { return record(value) && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0"); }
function refs(value: unknown, minimum = 1): value is string[] { return Array.isArray(value) && value.length >= minimum && value.every(text) && new Set(value).size === value.length; }
function instant(value: unknown): value is string { return text(value) && Number.isFinite(Date.parse(value)); }
function fail(findings: CompletionEvidenceFinding[], rule: string, path: string, message: string): void { findings.push({ rule, path, message }); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Validates the immutable public contract shipped by this package. */
export function validateCompletionEvidenceContract(contract: unknown = readCompletionEvidenceContract()): readonly CompletionEvidenceFinding[] {
  let snapshot: unknown;
  try { snapshot = readCompletionEvidenceContract(); }
  catch (error) { return [{ rule: "completion-evidence-contract-unavailable", path: "contracts/completion-evidence-contract.json", message: error instanceof Error ? error.message : String(error) }]; }
  if (canonical(contract) !== canonical(snapshot)) return [{ rule: "noncanonical-completion-evidence-contract", path: "completionEvidenceContract", message: "must exactly match the immutable completion-evidence-contract snapshot shipped by @vespeneventures/controller" }];
  if (!keys(contract, ["schemaVersion", "kind", "fields", "verdicts", "invocationKinds", "placementModes", "duplicateStates", "rule"]) || contract.schemaVersion !== 1 || contract.kind !== "foundry-consumer-completion-evidence") {
    return [{ rule: "invalid-completion-evidence-contract", path: "completionEvidenceContract", message: "must be the complete schemaVersion 1 completion-evidence contract" }];
  }
  const findings: CompletionEvidenceFinding[] = [];
  if (canonical(contract.fields) !== canonical(COMPLETION_EVIDENCE_FIELDS) || canonical(contract.verdicts) !== canonical(COMPLETION_VERDICTS) || canonical(contract.invocationKinds) !== canonical(INVOCATION_KINDS) || canonical(contract.placementModes) !== canonical(PLACEMENT_MODES) || canonical(contract.duplicateStates) !== canonical(DUPLICATE_STATES) || !text(contract.rule)) {
    fail(findings, "completion-evidence-contract-vocabulary-drift", "completionEvidenceContract", "fields, verdicts, invocation kinds, placement modes, duplicate states, and rule must match the validator constants");
  }
  return findings;
}

function validateObservation(value: unknown, path: string, findings: CompletionEvidenceFinding[]): "observed" | "unreadable" | undefined {
  if (!keys(value, ["state", "value", "observedAt", "evidenceRefs", "reason"])) {
    fail(findings, "invalid-outcome-observation", path, "must contain exactly state, value, observedAt, evidenceRefs, and reason");
    return undefined;
  }
  if (value.state === "observed") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value) || !instant(value.observedAt) || !refs(value.evidenceRefs) || value.reason !== "") {
      fail(findings, "invalid-outcome-observation", path, "an observed outcome needs a finite value, ISO instant, evidence references, and an empty reason");
    }
    return "observed";
  }
  if (value.state === "unreadable") {
    if (value.value !== null || value.observedAt !== null || !refs(value.evidenceRefs, 0) || !text(value.reason)) {
      fail(findings, "invalid-outcome-observation", path, "an unreadable outcome needs null value/observedAt, optional unique references, and a nonempty reason");
    }
    return "unreadable";
  }
  fail(findings, "invalid-outcome-observation", path, "state must be observed or unreadable");
  return undefined;
}

/**
 * Validates a completion record and the consumer's own position ledger.
 * A valid record may still be `violated` or `indeterminate`; `satisfied` is
 * reachable only when the consumer retained every required evidence class.
 */
export function validateCompletionEvidence(evidence: unknown, ledger: unknown): CompletionEvidenceReport {
  const findings: CompletionEvidenceFinding[] = [...validateCompletionEvidenceContract()];
  const ledgerReport = validateInstalledPositionLedger(ledger);
  if (!ledgerReport.ok) {
    return { result: completionReasons.indeterminate("invalid-position-ledger", "The supplied consumer position ledger did not validate."), findings: ledgerReport.findings, positionId: record(evidence) && text(evidence.positionId) ? evidence.positionId : undefined, package: record(evidence) && text(evidence.package) ? evidence.package : undefined };
  }
  if (!keys(evidence, COMPLETION_EVIDENCE_FIELDS) || evidence.schemaVersion !== 1) {
    fail(findings, "unreadable-completion-evidence", "evidence", `must be schemaVersion 1 with exactly: ${COMPLETION_EVIDENCE_FIELDS.join(", ")}`);
    return { result: completionReasons.indeterminate("unreadable-or-incomplete-evidence", "The completion evidence record is unreadable or incomplete."), findings };
  }
  const positionId = text(evidence.positionId) ? evidence.positionId : undefined;
  const packageName = text(evidence.package) ? evidence.package : undefined;
  if (!positionId) fail(findings, "invalid-position-id", "positionId", "must be a nonempty consumer-owned position id");
  if (!packageName || !roleName.test(packageName)) fail(findings, "invalid-package", "package", "must name an active scoped role package");

  const positions = record(ledger) && Array.isArray(ledger.positions) ? ledger.positions : [];
  const linkedPosition = positions.find((position) => record(position) && position.id === positionId);
  if (!linkedPosition) fail(findings, "unknown-position", "positionId", "must identify a complete position in the supplied consumer ledger");
  else if (linkedPosition.package !== packageName) fail(findings, "position-package-mismatch", "package", "must equal the role package bound to positionId in the supplied consumer ledger");

  const artifact = evidence.artifact;
  if (!keys(artifact, ["version", "manifestRef", "lockfileRef", "cleanInstallRef"]) || !text(artifact.version) || !exactVersion.test(artifact.version) || !text(artifact.manifestRef) || !text(artifact.lockfileRef) || !text(artifact.cleanInstallRef)) {
    fail(findings, "invalid-artifact-proof", "artifact", "needs an exact semver version plus nonempty manifest, lockfile, and clean-install references");
  }

  const invocation = evidence.invocation;
  if (!keys(invocation, ["kind", "target", "runRef", "occurredAt"]) || !INVOCATION_KINDS.includes(invocation.kind as never) || !text(invocation.target) || !text(invocation.runRef) || !instant(invocation.occurredAt)) {
    fail(findings, "invalid-invocation", "invocation", "needs cli/export kind, target, run reference, and ISO instant");
  }

  const placement = evidence.placement;
  if (!keys(placement, ["mode", "reason", "evidenceRefs"]) || !PLACEMENT_MODES.includes(placement.mode as never) || !text(placement.reason) || !refs(placement.evidenceRefs)) {
    fail(findings, "invalid-placement", "placement", "needs blocking/not-applicable mode, a rationale, and evidence references");
  }

  const control = evidence.control;
  let controlRun: string | undefined;
  if (!keys(control, ["red", "green"])) {
    fail(findings, "invalid-deliberate-control", "control", "must contain adjacent red and green control records");
  } else {
    const validateControl = (value: unknown, path: string, expected: string): string | undefined => {
      if (!keys(value, ["caseRef", "runRef", "occurredAt", "verdict"]) || !text(value.caseRef) || !text(value.runRef) || !instant(value.occurredAt) || value.verdict !== expected) {
        fail(findings, "invalid-deliberate-control", path, `needs case reference, run reference, ISO instant, and verdict ${expected}`);
        return undefined;
      }
      return value.runRef;
    };
    const redRun = validateControl(control.red, "control.red", "violated");
    const greenRun = validateControl(control.green, "control.green", "satisfied");
    if (redRun !== undefined && greenRun !== undefined && redRun !== greenRun) fail(findings, "nonadjacent-control", "control", "red and green control must share one run reference");
    else controlRun = redRun;
  }
  if (controlRun !== undefined && keys(invocation, ["kind", "target", "runRef", "occurredAt"]) && invocation.runRef !== controlRun) fail(findings, "invocation-control-mismatch", "invocation.runRef", "the invoked export or CLI and deliberate red/green control must share one run reference");

  const maintenance = evidence.maintenance;
  if (!keys(maintenance, ["duplicate", "rollback"])) {
    fail(findings, "invalid-maintenance-evidence", "maintenance", "must contain duplicate-removal and rollback records");
  } else {
    const duplicate = maintenance.duplicate;
    if (!keys(duplicate, ["state", "reason", "evidenceRefs"]) || !DUPLICATE_STATES.includes(duplicate.state as never) || !text(duplicate.reason) || !refs(duplicate.evidenceRefs)) fail(findings, "invalid-duplicate-removal", "maintenance.duplicate", "needs removed/not-applicable state, rationale, and evidence references");
    const rollback = maintenance.rollback;
    if (!keys(rollback, ["procedureRef", "verifiedAt", "verificationRef"]) || !text(rollback.procedureRef) || !instant(rollback.verifiedAt) || !text(rollback.verificationRef)) fail(findings, "invalid-rollback", "maintenance.rollback", "needs a rollback procedure, ISO verification instant, and verification reference");
  }

  let hasSatisfiedCadenceRun = false;
  const cadence = evidence.cadence;
  if (!keys(cadence, ["schedule", "runs"]) || !text(cadence.schedule) || !Array.isArray(cadence.runs) || cadence.runs.length === 0) {
    fail(findings, "invalid-cadence-evidence", "cadence", "needs a declared cadence and at least one actual run");
  } else {
    cadence.runs.forEach((run, index) => {
      const path = `cadence.runs[${index}]`;
      if (!keys(run, ["occurredAt", "reference", "verdict"]) || !instant(run.occurredAt) || !text(run.reference) || !COMPLETION_VERDICTS.includes(run.verdict as never)) fail(findings, "invalid-cadence-run", path, "needs ISO instant, reference, and a ternary verdict");
      else if (run.verdict === "satisfied") hasSatisfiedCadenceRun = true;
    });
  }

  let outcomeVerdict: string | undefined;
  const outcome = evidence.outcome;
  if (!keys(outcome, ["metric", "sourceOwner", "sourceRef", "before", "after", "verdict", "reason"]) || !text(outcome.metric) || !text(outcome.sourceOwner) || !text(outcome.sourceRef) || !COMPLETION_VERDICTS.includes(outcome.verdict as never)) {
    fail(findings, "invalid-independent-outcome", "outcome", "needs metric, independent source owner/reference, before/after observations, verdict, and reason");
  } else {
    const before = validateObservation(outcome.before, "outcome.before", findings);
    const after = validateObservation(outcome.after, "outcome.after", findings);
    outcomeVerdict = outcome.verdict as string;
    if (outcome.verdict === "indeterminate") {
      if (!text(outcome.reason)) fail(findings, "missing-outcome-reason", "outcome.reason", "an indeterminate outcome needs a machine-retained reason");
    } else if (before !== "observed" || after !== "observed" || outcome.reason !== "") {
      fail(findings, "incomplete-independent-outcome", "outcome", "a satisfied or violated outcome needs readable independent before/after observations and an empty reason");
    }
  }

  let closeVerdict: string | undefined;
  const closeWindow = evidence.closeWindow;
  if (!keys(closeWindow, ["startedAt", "endedAt", "verdict", "evidenceRefs", "reason"]) || !instant(closeWindow.startedAt) || !instant(closeWindow.endedAt) || Date.parse(closeWindow.startedAt as string) > Date.parse(closeWindow.endedAt as string) || !COMPLETION_VERDICTS.includes(closeWindow.verdict as never) || !refs(closeWindow.evidenceRefs)) {
    fail(findings, "invalid-close-window", "closeWindow", "needs ordered ISO window bounds, ternary verdict, and evidence references");
  } else {
    closeVerdict = closeWindow.verdict as string;
    if (closeWindow.verdict === "indeterminate" ? !text(closeWindow.reason) : closeWindow.reason !== "") fail(findings, "invalid-close-window-reason", "closeWindow.reason", "indeterminate needs a reason; evaluated close-window verdicts need an empty reason");
    if (closeWindow.verdict === "satisfied" && outcomeVerdict !== "satisfied") fail(findings, "close-window-outcome-mismatch", "closeWindow.verdict", "cannot be satisfied unless the independent outcome is satisfied");
  }

  if (findings.length > 0) return { result: completionReasons.indeterminate("unreadable-or-incomplete-evidence", `${findings.length} completion-evidence requirement(s) could not be validated.`), findings, positionId, package: packageName };
  if (outcomeVerdict === "indeterminate" || closeVerdict === "indeterminate") return { result: completionReasons.indeterminate("outcome-indeterminate", "The independent outcome or close-window verdict is indeterminate."), findings, positionId, package: packageName };
  const violations: CompletionEvidenceFinding[] = [];
  if (!hasSatisfiedCadenceRun) violations.push({ rule: "no-satisfied-cadence-run", path: "cadence.runs", message: "no actual cadence run reached a satisfied verdict" });
  if (outcomeVerdict === "violated") violations.push({ rule: "outcome-violated", path: "outcome.verdict", message: "the independent before/after outcome did not meet its consumer-owned setpoint" });
  if (closeVerdict === "violated") violations.push({ rule: "close-window-violated", path: "closeWindow.verdict", message: "the close condition did not hold over the declared review window" });
  return violations.length > 0
    ? { result: gateViolated(violations), findings: violations, positionId, package: packageName }
    : { result: gateSatisfied(1), findings, positionId, package: packageName };
}
