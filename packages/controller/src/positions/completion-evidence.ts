/**
 * Consumer completion evidence: validates one consumer-owned record without
 * reading a registry, CI provider, secret store, or outcome system. The
 * consumer retains those facts; this module only refuses to mistake their
 * absence for a completed position.
 */
import { createGateReasons, gateSatisfied, gateViolated, type GateResult } from "../gates/result.js";
import { readCanonicalRoleLoopContract, readCompletionEvidenceContract } from "./canonical.js";
import { validateInstalledPositionLedger, type InstalledPositionFinding } from "./index.js";
import { isValueSafeReference, referenceSafetyIssue, stripDefaultIgnorables } from "../internal/reference-safety.js";

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
const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const canonicalOwner = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;
const rfc3339Instant = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function record(value: unknown): value is RecordValue { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function reference(value: unknown): value is string { return text(value) && isValueSafeReference(value); }
function keys(value: unknown, expected: readonly string[]): value is RecordValue { return record(value) && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0"); }
function refs(value: unknown, minimum = 1): value is string[] { return Array.isArray(value) && value.length >= minimum && value.every(reference) && new Set(value).size === value.length; }
function rejectUnsafeReference(value: unknown, path: string, findings: CompletionEvidenceFinding[]): void {
  if (typeof value !== "string") return;
  const issue = referenceSafetyIssue(value);
  if (issue === "reference-length-exceeded") fail(findings, issue, path, "must be at most 65,536 code units");
  else if (issue) fail(findings, issue, path, "must not use explicit inline sensitive-payload syntax or URL authority userinfo");
}
function rejectUnsafeReferences(value: unknown, path: string, findings: CompletionEvidenceFinding[]): void {
  if (Array.isArray(value)) value.forEach((item, index) => rejectUnsafeReference(item, `${path}[${index}]`, findings));
}
function instantMillis(value: unknown): number | undefined {
  if (!text(value)) return undefined;
  const parts = rfc3339Instant.exec(value);
  if (!parts) return undefined;
  const yearText = parts[1]!;
  const monthText = parts[2]!;
  const dayText = parts[3]!;
  const hourText = parts[4]!;
  const minuteText = parts[5]!;
  const secondText = parts[6]!;
  const zone = parts[7]!;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const zoneHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const zoneMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (zone === "-00:00" || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function canonicalIdentity(value: unknown): string | undefined { return typeof value === "string" ? stripDefaultIgnorables(value).trim().toLowerCase() : undefined; }
function instant(value: unknown): value is string { return instantMillis(value) !== undefined; }
function fail(findings: CompletionEvidenceFinding[], rule: string, path: string, message: string): void { findings.push({ rule, path, message }); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sameReferenceSet(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right) && canonical([...left].sort()) === canonical([...right].sort());
}

function meetsSetpoint(direction: unknown, value: number, setpoint: unknown): boolean | undefined {
  if (direction === "increase" && typeof setpoint === "number") return value >= setpoint;
  if (direction === "decrease" && typeof setpoint === "number") return value <= setpoint;
  if (direction === "maintain" && typeof setpoint === "number") return value === setpoint;
  if (direction === "target-range" && Array.isArray(setpoint) && setpoint.length === 2) {
    const [minimum, maximum] = setpoint;
    if (typeof minimum === "number" && typeof maximum === "number") return value >= minimum && value <= maximum;
  }
  return undefined;
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
  const semanticViolations: CompletionEvidenceFinding[] = [];
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

  let linkedMetricName: unknown;
  let linkedMetricDirection: unknown;
  let linkedSetpoint: unknown;
  let linkedBaseline: RecordValue | undefined;
  let linkedEvidenceLocator: unknown;
  let linkedCadenceReview: unknown;
  let linkedActionAuthority: unknown;
  if (record(linkedPosition) && packageName) {
    linkedSetpoint = record(linkedPosition.setpoint) ? linkedPosition.setpoint.value : undefined;
    linkedBaseline = record(linkedPosition.baseline) ? linkedPosition.baseline : undefined;
    linkedEvidenceLocator = record(linkedPosition.evidenceSource) ? linkedPosition.evidenceSource.locator : undefined;
    linkedCadenceReview = record(linkedPosition.cadence) ? linkedPosition.cadence.review : undefined;
    linkedActionAuthority = record(linkedPosition.authority) ? linkedPosition.authority.actionAuthority : undefined;
    try {
      const roleContract = readCanonicalRoleLoopContract();
      const roles = record(roleContract) && record(roleContract.roles) ? roleContract.roles : undefined;
      const declaration = roles && record(roles[packageName]) ? roles[packageName] : undefined;
      const metric = declaration && record(declaration.metric) ? declaration.metric : undefined;
      linkedMetricName = metric?.name;
      linkedMetricDirection = metric?.direction;
    } catch (error) {
      fail(findings, "canonical-role-contract-unavailable", "contracts/role-loop-archetypes.json", error instanceof Error ? error.message : String(error));
    }
  }

  const artifact = evidence.artifact;
  if (record(artifact)) {
    rejectUnsafeReference(artifact.manifestRef, "artifact.manifestRef", findings);
    rejectUnsafeReference(artifact.lockfileRef, "artifact.lockfileRef", findings);
    rejectUnsafeReference(artifact.cleanInstallRef, "artifact.cleanInstallRef", findings);
  }
  if (!keys(artifact, ["version", "manifestRef", "lockfileRef", "cleanInstallRef"]) || !text(artifact.version) || !exactVersion.test(artifact.version) || !reference(artifact.manifestRef) || !reference(artifact.lockfileRef) || !reference(artifact.cleanInstallRef)) {
    fail(findings, "invalid-artifact-proof", "artifact", "needs an exact semver version plus nonempty manifest, lockfile, and clean-install references");
  }

  const invocation = evidence.invocation;
  if (record(invocation)) rejectUnsafeReference(invocation.runRef, "invocation.runRef", findings);
  let invocationAt: number | undefined;
  if (!keys(invocation, ["kind", "target", "runRef", "occurredAt"]) || !INVOCATION_KINDS.includes(invocation.kind as never) || !text(invocation.target) || !reference(invocation.runRef) || !instant(invocation.occurredAt)) {
    fail(findings, "invalid-invocation", "invocation", "needs cli/export kind, target, run reference, and ISO instant");
  } else invocationAt = instantMillis(invocation.occurredAt);

  const placement = evidence.placement;
  if (record(placement)) rejectUnsafeReferences(placement.evidenceRefs, "placement.evidenceRefs", findings);
  if (!keys(placement, ["mode", "reason", "evidenceRefs"]) || !PLACEMENT_MODES.includes(placement.mode as never) || !text(placement.reason) || !refs(placement.evidenceRefs)) {
    fail(findings, "invalid-placement", "placement", "needs blocking/not-applicable mode, a rationale, and evidence references");
  }

  const control = evidence.control;
  let controlRun: string | undefined;
  let controlRedAt: number | undefined;
  let controlGreenAt: number | undefined;
  if (!keys(control, ["red", "green"])) {
    fail(findings, "invalid-deliberate-control", "control", "must contain adjacent red and green control records");
  } else {
    if (record(control.red)) {
      rejectUnsafeReference(control.red.caseRef, "control.red.caseRef", findings);
      rejectUnsafeReference(control.red.runRef, "control.red.runRef", findings);
    }
    if (record(control.green)) {
      rejectUnsafeReference(control.green.caseRef, "control.green.caseRef", findings);
      rejectUnsafeReference(control.green.runRef, "control.green.runRef", findings);
    }
    const validateControl = (value: unknown, path: string, expected: string): { readonly caseRef: string; readonly runRef: string; readonly occurredAt: number } | undefined => {
      if (!keys(value, ["caseRef", "runRef", "occurredAt", "verdict"]) || !reference(value.caseRef) || !reference(value.runRef) || !instant(value.occurredAt) || value.verdict !== expected) {
        fail(findings, "invalid-deliberate-control", path, `needs case reference, run reference, ISO instant, and verdict ${expected}`);
        return undefined;
      }
      return { caseRef: value.caseRef, runRef: value.runRef, occurredAt: instantMillis(value.occurredAt)! };
    };
    const redRun = validateControl(control.red, "control.red", "violated");
    const greenRun = validateControl(control.green, "control.green", "satisfied");
    if (redRun !== undefined && greenRun !== undefined && redRun.runRef !== greenRun.runRef) fail(findings, "nonadjacent-control", "control", "red and green control must share one run reference");
    else if (redRun !== undefined && greenRun !== undefined && redRun.caseRef.trim() === greenRun.caseRef.trim()) fail(findings, "non-distinct-control-cases", "control", "red and green control must use distinct case references");
    else if (redRun !== undefined) {
      controlRun = redRun.runRef;
      controlRedAt = redRun.occurredAt;
      controlGreenAt = greenRun?.occurredAt;
    }
  }
  if (controlRun !== undefined && keys(invocation, ["kind", "target", "runRef", "occurredAt"]) && invocation.runRef !== controlRun) fail(findings, "invocation-control-mismatch", "invocation.runRef", "the invoked export or CLI and deliberate red/green control must share one run reference");

  const maintenance = evidence.maintenance;
  let rollbackAt: number | undefined;
  if (!keys(maintenance, ["duplicate", "rollback"])) {
    fail(findings, "invalid-maintenance-evidence", "maintenance", "must contain duplicate-removal and rollback records");
  } else {
    const duplicate = maintenance.duplicate;
    if (record(duplicate)) rejectUnsafeReferences(duplicate.evidenceRefs, "maintenance.duplicate.evidenceRefs", findings);
    if (!keys(duplicate, ["state", "reason", "evidenceRefs"]) || !DUPLICATE_STATES.includes(duplicate.state as never) || !text(duplicate.reason) || !refs(duplicate.evidenceRefs)) fail(findings, "invalid-duplicate-removal", "maintenance.duplicate", "needs removed/not-applicable state, rationale, and evidence references");
    const rollback = maintenance.rollback;
    if (record(rollback)) {
      rejectUnsafeReference(rollback.procedureRef, "maintenance.rollback.procedureRef", findings);
      rejectUnsafeReference(rollback.verificationRef, "maintenance.rollback.verificationRef", findings);
    }
    if (!keys(rollback, ["procedureRef", "verifiedAt", "verificationRef"]) || !reference(rollback.procedureRef) || !instant(rollback.verifiedAt) || !reference(rollback.verificationRef)) fail(findings, "invalid-rollback", "maintenance.rollback", "needs a rollback procedure, ISO verification instant, and verification reference");
    else rollbackAt = instantMillis(rollback.verifiedAt);
  }

  let hasSatisfiedCadenceRun = false;
  let hasViolatedCadenceRun = false;
  let hasIndeterminateCadenceRun = false;
  const cadenceInstants: Array<{ readonly path: string; readonly occurredAt: number; readonly verdict: string }> = [];
  const cadence = evidence.cadence;
  if (!keys(cadence, ["schedule", "runs"]) || !text(cadence.schedule) || !Array.isArray(cadence.runs) || cadence.runs.length === 0) {
    fail(findings, "invalid-cadence-evidence", "cadence", "needs a declared cadence and at least one actual run");
  } else {
    if (cadence.schedule !== linkedCadenceReview) fail(findings, "cadence-schedule-mismatch", "cadence.schedule", "must equal the linked position review cadence");
    cadence.runs.forEach((run, index) => {
      const path = `cadence.runs[${index}]`;
      if (record(run)) rejectUnsafeReference(run.reference, `${path}.reference`, findings);
      if (!keys(run, ["occurredAt", "reference", "verdict"]) || !instant(run.occurredAt) || !reference(run.reference) || !COMPLETION_VERDICTS.includes(run.verdict as never)) fail(findings, "invalid-cadence-run", path, "needs ISO instant, value-safe reference, and a ternary verdict");
      else {
        const occurredAt = instantMillis(run.occurredAt);
        if (occurredAt !== undefined) cadenceInstants.push({ path, occurredAt, verdict: run.verdict as string });
      }
    });
  }

  let outcomeVerdict: string | undefined;
  const outcome = evidence.outcome;
  if (record(outcome)) {
    rejectUnsafeReference(outcome.sourceRef, "outcome.sourceRef", findings);
    if (record(outcome.before)) rejectUnsafeReferences(outcome.before.evidenceRefs, "outcome.before.evidenceRefs", findings);
    if (record(outcome.after)) rejectUnsafeReferences(outcome.after.evidenceRefs, "outcome.after.evidenceRefs", findings);
  }
  if (!keys(outcome, ["metric", "sourceOwner", "sourceRef", "before", "after", "verdict", "reason"]) || !text(outcome.metric) || !text(outcome.sourceOwner) || !reference(outcome.sourceRef) || !COMPLETION_VERDICTS.includes(outcome.verdict as never)) {
    fail(findings, "invalid-independent-outcome", "outcome", "needs metric, independent source owner/reference, before/after observations, verdict, and reason");
  } else {
    const before = validateObservation(outcome.before, "outcome.before", findings);
    const after = validateObservation(outcome.after, "outcome.after", findings);
    outcomeVerdict = outcome.verdict as string;
    const normalizedSourceOwner = typeof outcome.sourceOwner === "string" ? outcome.sourceOwner.trim() : "";
    if (normalizedSourceOwner !== outcome.sourceOwner || !canonicalOwner.test(normalizedSourceOwner)) {
      fail(findings, "noncanonical-outcome-owner", "outcome.sourceOwner", "must be a printable ASCII identifier with no surrounding whitespace");
    }
    const ownerIdentity = normalizedSourceOwner.toLowerCase();
    if (ownerIdentity === packageName?.toLowerCase() || ownerIdentity === canonicalIdentity(positionId)) {
      fail(findings, "non-independent-outcome-owner", "outcome.sourceOwner", "must identify an outcome owner other than the measured package or position");
    }
    if (ownerIdentity === canonicalIdentity(linkedActionAuthority)) {
      fail(findings, "non-independent-outcome-owner", "outcome.sourceOwner", "must identify an outcome owner other than the linked position action authority");
    }
    if (outcome.metric !== linkedMetricName) {
      fail(findings, "outcome-metric-mismatch", "outcome.metric", "must equal the owned metric in the linked role charter");
    }
    if (outcome.sourceRef !== linkedEvidenceLocator) {
      fail(findings, "outcome-source-mismatch", "outcome.sourceRef", "must equal the linked position evidence-source locator");
    }
    if (outcome.verdict === "indeterminate" && (before !== "observed" || after !== "observed")) {
      if (!text(outcome.reason)) fail(findings, "missing-outcome-reason", "outcome.reason", "an unreadable indeterminate outcome needs a machine-retained reason");
    } else if (outcome.verdict !== "indeterminate" && (before !== "observed" || after !== "observed" || outcome.reason !== "")) {
      fail(findings, "incomplete-independent-outcome", "outcome", "a satisfied or violated outcome needs readable independent before/after observations and an empty reason");
    }
    if (before === "observed" && after === "observed" && record(outcome.after) && typeof outcome.after.value === "number") {
      if (!record(linkedBaseline) || !record(outcome.before) || outcome.before.value !== linkedBaseline.value || outcome.before.observedAt !== linkedBaseline.observedAt || !sameReferenceSet(outcome.before.evidenceRefs, linkedBaseline.evidenceRefs)) {
        fail(findings, "outcome-baseline-mismatch", "outcome.before", "must exactly retain the linked position baseline value, observedAt, and evidence references");
      }
      const reachedSetpoint = meetsSetpoint(linkedMetricDirection, outcome.after.value, linkedSetpoint);
      const beforeReachedSetpoint = record(outcome.before) && typeof outcome.before.value === "number" ? meetsSetpoint(linkedMetricDirection, outcome.before.value, linkedSetpoint) : undefined;
      if (reachedSetpoint === undefined) {
        fail(findings, "unreadable-linked-setpoint", "outcome.after.value", "the linked role direction and position setpoint must support an independent comparison");
      } else {
        const derivedVerdict = reachedSetpoint ? "satisfied" : "violated";
        if (outcome.verdict !== derivedVerdict) {
          semanticViolations.push({ rule: "outcome-verdict-setpoint-mismatch", path: "outcome.verdict", message: `the caller-supplied ${String(outcome.verdict)} verdict disagrees with the linked role direction and position setpoint` });
        }
        outcomeVerdict = derivedVerdict;
      }
      if (beforeReachedSetpoint === undefined) fail(findings, "unreadable-linked-setpoint", "outcome.before.value", "the linked role direction and position setpoint must support an independent comparison");
      else if (beforeReachedSetpoint) semanticViolations.push({ rule: "outcome-not-a-transition", path: "outcome.before.value", message: "the linked baseline already met the consumer-owned setpoint" });
    }
  }

  let closeVerdict: string | undefined;
  let closeWindowBounds: { readonly startedAt: number; readonly endedAt: number } | undefined;
  const closeWindow = evidence.closeWindow;
  if (record(closeWindow)) rejectUnsafeReferences(closeWindow.evidenceRefs, "closeWindow.evidenceRefs", findings);
  const closeWindowStartedAt = keys(closeWindow, ["startedAt", "endedAt", "verdict", "evidenceRefs", "reason"]) ? instantMillis(closeWindow.startedAt) : undefined;
  const closeWindowEndedAt = keys(closeWindow, ["startedAt", "endedAt", "verdict", "evidenceRefs", "reason"]) ? instantMillis(closeWindow.endedAt) : undefined;
  if (!keys(closeWindow, ["startedAt", "endedAt", "verdict", "evidenceRefs", "reason"]) || closeWindowStartedAt === undefined || closeWindowEndedAt === undefined || closeWindowStartedAt >= closeWindowEndedAt || !COMPLETION_VERDICTS.includes(closeWindow.verdict as never) || !refs(closeWindow.evidenceRefs)) {
    fail(findings, "invalid-close-window", "closeWindow", "needs strictly increasing ISO window bounds, ternary verdict, and evidence references");
  } else {
    closeWindowBounds = { startedAt: closeWindowStartedAt, endedAt: closeWindowEndedAt };
    closeVerdict = closeWindow.verdict as string;
    if (closeWindow.verdict === "indeterminate" ? !text(closeWindow.reason) : closeWindow.reason !== "") fail(findings, "invalid-close-window-reason", "closeWindow.reason", "indeterminate needs a reason; evaluated close-window verdicts need an empty reason");
    if (closeWindow.verdict === "satisfied" && outcomeVerdict !== "satisfied") semanticViolations.push({ rule: "close-window-outcome-mismatch", path: "closeWindow.verdict", message: "cannot be satisfied unless the independently derived outcome is satisfied" });
  }

  if (closeWindowBounds !== undefined) {
    const beforeAt = record(outcome) && record(outcome.before) ? instantMillis(outcome.before.observedAt) : undefined;
    const afterAt = record(outcome) && record(outcome.after) ? instantMillis(outcome.after.observedAt) : undefined;
    if (beforeAt !== undefined && afterAt !== undefined) {
      if (beforeAt >= afterAt) fail(findings, "unordered-outcome-observations", "outcome", "before.observedAt must strictly precede after.observedAt");
      const initialInstants = [invocationAt, controlRedAt, controlGreenAt];
      if (initialInstants.every((value): value is number => value !== undefined) && rollbackAt !== undefined) {
        const firstInitial = Math.min(...initialInstants);
        const lastInitial = Math.max(...initialInstants);
        if (beforeAt >= firstInitial) fail(findings, "outcome-before-not-prechange", "outcome.before.observedAt", "must strictly precede the invocation and deliberate controls");
        if (rollbackAt < lastInitial) fail(findings, "rollback-before-control", "maintenance.rollback.verifiedAt", "must not precede the invocation and deliberate controls");
        if (afterAt < rollbackAt) fail(findings, "outcome-after-before-rollback", "outcome.after.observedAt", "must not precede rollback verification");
        if (afterAt > closeWindowBounds.startedAt) fail(findings, "outcome-after-after-close-start", "outcome.after.observedAt", "must not follow the declared close-window start");
      }
    }
    for (const run of cadenceInstants) {
      if (run.occurredAt < closeWindowBounds.startedAt || run.occurredAt > closeWindowBounds.endedAt) continue;
      if (run.verdict === "violated") hasViolatedCadenceRun = true;
      else if (run.verdict === "indeterminate") hasIndeterminateCadenceRun = true;
      else if (run.occurredAt > closeWindowBounds.startedAt) hasSatisfiedCadenceRun = true;
    }
  }

  if (findings.length > 0) return { result: completionReasons.indeterminate("unreadable-or-incomplete-evidence", `${findings.length} completion-evidence requirement(s) could not be validated.`), findings, positionId, package: packageName };
  const violations: CompletionEvidenceFinding[] = [...semanticViolations];
  if (hasViolatedCadenceRun) violations.push({ rule: "cadence-run-violated", path: "cadence.runs", message: "a cadence run within the declared close window was violated" });
  if (outcomeVerdict === "violated") violations.push({ rule: "outcome-violated", path: "outcome.verdict", message: "the independent before/after outcome did not meet its consumer-owned setpoint" });
  if (closeVerdict === "violated") violations.push({ rule: "close-window-violated", path: "closeWindow.verdict", message: "the close condition did not hold over the declared review window" });
  if (violations.length > 0) return { result: gateViolated(violations), findings: violations, positionId, package: packageName };
  if (outcomeVerdict === "indeterminate" || closeVerdict === "indeterminate" || hasIndeterminateCadenceRun || !hasSatisfiedCadenceRun) {
    return { result: completionReasons.indeterminate("outcome-indeterminate", hasIndeterminateCadenceRun || !hasSatisfiedCadenceRun ? "The close window has no fully satisfied in-window cadence evidence." : "The independent outcome or close-window verdict is indeterminate."), findings, positionId, package: packageName };
  }
  return { result: gateSatisfied(1), findings, positionId, package: packageName };
}
