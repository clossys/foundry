/**
 * Validation for `clossys/<role>/loop.json` (issue #1195): the per-role
 * machine state every loop run reads and writes. Pure -- no filesystem
 * access here; a caller reads the file and hands this the parsed value.
 */
import { LIFECYCLE_CONDITIONS, LIFECYCLE_STATES } from "./lifecycle.js";
import { BLOCKER_KINDS, LOOP_STAGES } from "./types.js";
import type { LoopCapabilityState, LoopState } from "./types.js";

export interface LoopStateFinding {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
function isIsoLike(value: unknown): value is string {
  if (!isText(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function findingsForNextAction(nextAction: unknown, path: string): LoopStateFinding[] {
  if (!isRecord(nextAction) || !isText(nextAction.who) || !isText(nextAction.how) || !isIsoLike(nextAction.byWhen)) {
    return [{ rule: "invalid-next-action", path, message: "nextAction must be { who, how, byWhen } with a readable byWhen date" }];
  }
  return [];
}

function findingsForBlocker(blocker: unknown, path: string): LoopStateFinding[] {
  if (!isRecord(blocker)) return [{ rule: "invalid-blocker", path, message: "blocker must be an object" }];
  const findings: LoopStateFinding[] = [];
  if (!isText(blocker.capabilityId)) findings.push({ rule: "invalid-blocker", path: `${path}.capabilityId`, message: "capabilityId must be a nonempty string" });
  if (typeof blocker.kind !== "string" || !(BLOCKER_KINDS as readonly string[]).includes(blocker.kind)) {
    findings.push({ rule: "invalid-blocker-kind", path: `${path}.kind`, message: `kind must be one of ${BLOCKER_KINDS.join(", ")}` });
  }
  if (!isText(blocker.owner)) findings.push({ rule: "invalid-blocker", path: `${path}.owner`, message: "owner must be a nonempty string" });
  if (!isIsoLike(blocker.since)) findings.push({ rule: "invalid-blocker", path: `${path}.since`, message: "since must be a readable ISO datetime" });
  findings.push(...findingsForNextAction(blocker.nextAction, `${path}.nextAction`));
  return findings;
}

function findingsForDecision(decision: unknown, path: string): LoopStateFinding[] {
  if (!isRecord(decision) || !isText(decision.recommended) || !isText(decision.chosen) || !isIsoLike(decision.when)) {
    return [{ rule: "invalid-decision", path, message: "decision must be { recommended, chosen, when } with a readable when datetime" }];
  }
  return [];
}

function findingsForFingerprint(value: unknown, path: string): LoopStateFinding[] {
  if (!isRecord(value)) return [{ rule: "invalid-fingerprint", path, message: "must be an object mapping path to digest" }];
  const findings: LoopStateFinding[] = [];
  for (const [key, digest] of Object.entries(value)) {
    if (!isText(digest)) findings.push({ rule: "invalid-fingerprint", path: `${path}.${key}`, message: "digest must be a nonempty string" });
  }
  return findings;
}

function findingsForCapability(capability: unknown, id: string): LoopStateFinding[] {
  const path = `capabilities.${id}`;
  if (!isRecord(capability)) return [{ rule: "invalid-capability", path, message: "capability must be an object" }];
  const findings: LoopStateFinding[] = [];
  if (capability.id !== id) findings.push({ rule: "capability-id-mismatch", path: `${path}.id`, message: `capability's own id must equal its key (${id})` });
  if (typeof capability.state !== "string" || !(LIFECYCLE_STATES as readonly string[]).includes(capability.state)) {
    findings.push({ rule: "invalid-lifecycle-state", path: `${path}.state`, message: `state must be one of ${LIFECYCLE_STATES.join(", ")}` });
  }
  if (typeof capability.condition !== "string" || !(LIFECYCLE_CONDITIONS as readonly string[]).includes(capability.condition)) {
    findings.push({ rule: "invalid-lifecycle-condition", path: `${path}.condition`, message: `condition must be one of ${LIFECYCLE_CONDITIONS.join(", ")}` });
  }
  const stage = (capability as Record<string, unknown>).stage;
  if (stage !== null && (typeof stage !== "string" || !(LOOP_STAGES as readonly string[]).includes(stage))) {
    findings.push({ rule: "invalid-stage", path: `${path}.stage`, message: `stage must be null or one of ${LOOP_STAGES.join(", ")}` });
  }
  if ((capability.state === "absent" || capability.state === "retired") && stage !== null) {
    findings.push({ rule: "stage-inconsistent-with-state", path: `${path}.stage`, message: `stage must be null when state is ${String(capability.state)} -- there is nothing to resume` });
  }
  findings.push(...findingsForFingerprint(capability.inputFingerprints, `${path}.inputFingerprints`));
  findings.push(...findingsForFingerprint(capability.lastWrittenFingerprints, `${path}.lastWrittenFingerprints`));
  if (!Array.isArray(capability.blockers)) findings.push({ rule: "invalid-blockers", path: `${path}.blockers`, message: "blockers must be an array" });
  else capability.blockers.forEach((blocker, index) => findings.push(...findingsForBlocker(blocker, `${path}.blockers[${index}]`)));
  if (!Array.isArray(capability.decisions)) findings.push({ rule: "invalid-decisions", path: `${path}.decisions`, message: "decisions must be an array" });
  else capability.decisions.forEach((decision, index) => findings.push(...findingsForDecision(decision, `${path}.decisions[${index}]`)));
  return findings;
}

/** Validates a parsed `clossys/<role>/loop.json` document. Returns every finding; an empty array means the document is well-formed. */
export function validateLoopState(value: unknown): readonly LoopStateFinding[] {
  if (!isRecord(value)) return [{ rule: "invalid-loop-state", path: "$", message: "must be an object" }];
  const findings: LoopStateFinding[] = [];
  if (value.schemaVersion !== 1) findings.push({ rule: "invalid-schema-version", path: "schemaVersion", message: "schemaVersion must be exactly 1" });
  if (!isText(value.role)) findings.push({ rule: "invalid-role", path: "role", message: "role must be a nonempty string" });
  if (!isRecord(value.capabilities)) {
    findings.push({ rule: "invalid-capabilities", path: "capabilities", message: "capabilities must be an object" });
  } else {
    for (const [id, capability] of Object.entries(value.capabilities)) findings.push(...findingsForCapability(capability, id));
  }
  return Object.freeze(findings);
}

/** Whether `value` is a well-formed `LoopState`. A type-narrowing convenience over `validateLoopState`. */
export function isValidLoopState(value: unknown): value is LoopState {
  return validateLoopState(value).length === 0;
}

/** The stage a capability's run resumes at: its own recorded `stage`, exactly as written -- never re-derived, never guessed. `null` when there is nothing to resume. */
export function resumeStage(capability: LoopCapabilityState): LoopCapabilityState["stage"] {
  return capability.stage;
}
