/** Consumer-owned installed-position ledger validation. No provider I/O. */
import { readCanonicalRoleLoopContract, readInstalledPositionContract } from "./canonical.js";

export const POSITION_FIELDS = Object.freeze(["id", "package", "businessMetricPath", "causalHypothesis", "baseline", "setpoint", "operatingScope", "authority", "evidenceSource", "cadence", "budget", "guardrails", "escalationPath", "workerComponents", "stageBindings", "firstDayAssessment"] as const);
export const WORKER_COMPONENT_KINDS = Object.freeze(["deterministic", "model", "human", "vendor"] as const);
export const POSITION_RECOMMENDATIONS = Object.freeze(["install", "defer", "decline", "escalate"] as const);
export const ROLE_DISPOSITIONS = Object.freeze(["open", "not-applicable"] as const);
export const ROLE_DISPOSITION_RULE = "Every active role receives exactly one disposition. An open role cites one or more complete position records; a not-applicable role has no positions and states why.";
export const SETPOINT_VALUE_RULE = "Inherit the role charter metric direction: target-range uses an ordered two-number [minimum, maximum] value; increase, decrease, and maintain use one finite number.";
export const SETPOINT_VALUE_SHAPES = Object.freeze({ increase: "number", decrease: "number", maintain: "number", "target-range": "ordered two-number array" } as const);

export interface InstalledPositionFinding { readonly rule: string; readonly path: string; readonly message: string; }
export interface InstalledPositionLedgerReport { readonly ok: boolean; readonly findings: readonly InstalledPositionFinding[]; readonly openRoles: number; readonly positions: number; }

type RecordValue = Record<string, unknown>;
const universalStages = ["sense", "judge", "act", "verify", "learnOrEscalate"];
const metricDirections = ["increase", "decrease", "maintain", "target-range"];
const dispositionFields = ["package", "disposition", "reason", "positionIds"];
const firstDayFields = ["gaps", "target", "openQuestions", "criticalPath", "deferredWork", "recommendation", "evidenceRefs"];
const roleName = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

function record(value: unknown): value is RecordValue { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function keys(value: unknown, expected: readonly string[]): value is RecordValue { return record(value) && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0"); }
function strings(value: unknown, minimum = 0): value is string[] { return Array.isArray(value) && value.length >= minimum && value.every(text) && new Set(value).size === value.length; }
function fail(findings: InstalledPositionFinding[], rule: string, path: string, message: string): void { findings.push({ rule, path, message }); }

/**
 * Validates one complete consumer ledger against the role contract supplied by
 * the caller. It validates declarations only; it never infers installation,
 * adoption, independent grounding, or closure.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Validates the machine-readable position contract against this package's one code vocabulary. */
export function validateInstalledPositionContract(contract: unknown = readInstalledPositionContract()): readonly InstalledPositionFinding[] {
  const findings: InstalledPositionFinding[] = [];
  let snapshot: unknown;
  try { snapshot = readInstalledPositionContract(); }
  catch (error) { return [{ rule: "installed-position-contract-unavailable", path: "contracts/installed-position-contract.json", message: error instanceof Error ? error.message : String(error) }]; }
  if (canonical(contract) !== canonical(snapshot)) return [{ rule: "noncanonical-installed-position-contract", path: "installedPositionContract", message: "must exactly match the immutable installed-position-contract snapshot shipped by @vespeneventures/controller" }];
  if (!keys(contract, ["schemaVersion", "kind", "roleDisposition", "position"]) || contract.schemaVersion !== 1 || contract.kind !== "foundry-installed-position-ledger" || !keys(contract.roleDisposition, ["fields", "dispositions", "rule"]) || !keys(contract.position, ["fields", "workerComponentKinds", "stageBindingStages", "setpointValueShapes", "firstDayAssessmentFields", "recommendations", "setpointValueRule"])) return [{ rule: "invalid-installed-position-contract", path: "installedPositionContract", message: "must be the complete schemaVersion 1 installed-position contract" }];
  const position = contract.position;
  if (canonical(contract.roleDisposition.fields) !== canonical(dispositionFields) || canonical(contract.roleDisposition.dispositions) !== canonical(ROLE_DISPOSITIONS) || contract.roleDisposition.rule !== ROLE_DISPOSITION_RULE || canonical(position.fields) !== canonical(POSITION_FIELDS) || canonical(position.workerComponentKinds) !== canonical(WORKER_COMPONENT_KINDS) || canonical(position.stageBindingStages) !== canonical(universalStages) || canonical(position.setpointValueShapes) !== canonical(SETPOINT_VALUE_SHAPES) || canonical(position.firstDayAssessmentFields) !== canonical(firstDayFields) || canonical(position.recommendations) !== canonical(POSITION_RECOMMENDATIONS) || position.setpointValueRule !== SETPOINT_VALUE_RULE) findings.push({ rule: "installed-position-contract-vocabulary-drift", path: "installedPositionContract", message: "fields, dispositions, worker kinds, stage bindings, setpoint shapes and rule, first-day fields, and recommendations must match the validator constants" });
  return findings;
}

export function validateInstalledPositionLedger(ledger: unknown, roleContract: unknown = readCanonicalRoleLoopContract()): InstalledPositionLedgerReport {
  const findings: InstalledPositionFinding[] = [];
  findings.push(...validateInstalledPositionContract());
  if (findings.length > 0) return { ok: false, findings, openRoles: 0, positions: 0 };
  let canonicalContract: unknown;
  try { canonicalContract = readCanonicalRoleLoopContract(); }
  catch (error) { return { ok: false, findings: [{ rule: "canonical-role-contract-unavailable", path: "contracts/role-loop-archetypes.json", message: error instanceof Error ? error.message : String(error) }], openRoles: 0, positions: 0 }; }
  if (canonical(roleContract) !== canonical(canonicalContract)) return { ok: false, findings: [{ rule: "noncanonical-role-contract", path: "roleContract", message: "must exactly match the immutable role-loop-archetypes snapshot shipped by @vespeneventures/controller" }], openRoles: 0, positions: 0 };
  if (!record(roleContract) || roleContract.schemaVersion !== 4 || !keys(roleContract, ["schemaVersion", "universalStages", "consumerBindings", "modes", "metricVocabulary", "qualificationVerdicts", "roles"]) || !record(roleContract.roles)) return { ok: false, findings: [{ rule: "unreadable-role-contract", path: "roles", message: "must be the complete schemaVersion 4 role contract" }], openRoles: 0, positions: 0 };
  if (canonical(roleContract.universalStages) !== canonical(universalStages) || !record(roleContract.metricVocabulary) || canonical(roleContract.metricVocabulary.directions) !== canonical(metricDirections) || !record(roleContract.modes) || canonical(Object.keys(roleContract.modes).sort()) !== canonical(["assure", "fulfill", "interact", "optimize", "reconcile", "steward"])) return { ok: false, findings: [{ rule: "role-contract-vocabulary-drift", path: "roleContract", message: "stages, modes, and metric directions must match the shipped schemaVersion 4 contract" }], openRoles: 0, positions: 0 };
  const roles = new Set(Object.keys(roleContract.roles));
  const roleDirections = new Map<string, string>();
  for (const [name, declaration] of Object.entries(roleContract.roles)) {
    const direction = record(declaration) && record(declaration.metric) ? declaration.metric.direction : undefined;
    if (typeof direction === "string" && metricDirections.includes(direction)) roleDirections.set(name, direction);
    else fail(findings, "unreadable-role-direction", name, `role metric direction must be one of: ${metricDirections.join(", ")}`);
  }
  if (!record(ledger) || !keys(ledger, ["schemaVersion", "dispositions", "positions"]) || ledger.schemaVersion !== 1 || !Array.isArray(ledger.dispositions) || !Array.isArray(ledger.positions)) {
    return { ok: false, findings: [{ rule: "unreadable-position-ledger", path: "ledger", message: "must be schemaVersion 1 with dispositions and positions arrays" }], openRoles: 0, positions: 0 };
  }
  const document = ledger;
  const dispositions = new Map<string, { disposition: string; ids: string[] }>();
  const dispositionRecords = document.dispositions as unknown[];
  const positionRecords = document.positions as unknown[];
  for (const [index, item] of dispositionRecords.entries()) {
    const path = `dispositions[${index}]`;
    if (!keys(item, dispositionFields)) { fail(findings, "invalid-role-disposition", path, `must contain exactly: ${dispositionFields.join(", ")}`); continue; }
    const packageName = item.package;
    if (!text(packageName) || !roleName.test(packageName) || !roles.has(packageName)) { fail(findings, "unknown-disposition-role", path, "package must name an active role"); continue; }
    if (!ROLE_DISPOSITIONS.includes(item.disposition as never)) fail(findings, "invalid-role-disposition", path, "disposition must be open or not-applicable");
    if (!text(item.reason)) fail(findings, "missing-disposition-reason", path, "reason must be a nonempty decision rationale");
    if (!strings(item.positionIds, item.disposition === "open" ? 1 : 0)) fail(findings, "invalid-disposition-position-ids", path, "positionIds must be unique nonempty IDs; open requires one or more");
    if (item.disposition === "not-applicable" && Array.isArray(item.positionIds) && item.positionIds.length !== 0) fail(findings, "not-applicable-has-positions", path, "not-applicable must cite no positions");
    if (dispositions.has(packageName)) fail(findings, "duplicate-role-disposition", path, "each active role has exactly one disposition");
    else dispositions.set(packageName, { disposition: String(item.disposition), ids: Array.isArray(item.positionIds) ? item.positionIds.filter(text) : [] });
  }
  for (const name of roles) if (!dispositions.has(name)) fail(findings, "missing-role-disposition", name, "every active role must be explicitly open or not-applicable");
  for (const name of dispositions.keys()) if (!roles.has(name)) fail(findings, "unknown-disposition-role", name, "not an active role");

  const positionIds = new Set<string>();
  const positionPackages = new Map<string, string>();
  for (const [index, position] of positionRecords.entries()) {
    const path = `positions[${index}]`;
    if (!keys(position, POSITION_FIELDS)) { fail(findings, "incomplete-position", path, `must contain exactly: ${POSITION_FIELDS.join(", ")}`); continue; }
    if (!text(position.id)) fail(findings, "invalid-position-id", path, "id must be a nonempty string");
    else if (positionIds.has(position.id)) fail(findings, "duplicate-position-id", path, "id must be unique");
    else positionIds.add(position.id);
    if (!text(position.package) || !roles.has(position.package)) fail(findings, "unknown-position-role", path, "package must name an active role");
    else positionPackages.set(String(position.id), position.package);
    if (!keys(position.businessMetricPath, ["l1", "l2", "l3"]) || !text(position.businessMetricPath.l1) || !text(position.businessMetricPath.l2) || !text(position.businessMetricPath.l3)) fail(findings, "invalid-business-metric-path", path, "businessMetricPath needs nonempty l1, l2, and l3");
    if (!text(position.causalHypothesis)) fail(findings, "invalid-causal-hypothesis", path, "must be nonempty");
    const baseline = position.baseline;
    if (!keys(baseline, ["value", "observedAt", "evidenceRefs"]) || typeof baseline.value !== "number" || !Number.isFinite(baseline.value) || !text(baseline.observedAt) || !strings(baseline.evidenceRefs, 1)) fail(findings, "invalid-baseline", path, "baseline needs a finite value, observedAt, and evidence references");
    const setpoint = position.setpoint;
    const direction = text(position.package) ? roleDirections.get(position.package) : undefined;
    const setpointRecord = keys(setpoint, ["value", "evidenceRefs"]);
    if (!setpointRecord || !strings(setpoint.evidenceRefs, 1)) { fail(findings, "invalid-setpoint", path, "setpoint needs evidence references"); continue; }
    const targetValue = setpoint.value;
    const validRange = Array.isArray(targetValue) && targetValue.length === 2 && targetValue.every((value: unknown) => typeof value === "number" && Number.isFinite(value)) && (targetValue[0] as number) <= (targetValue[1] as number);
    const validScalar = typeof targetValue === "number" && Number.isFinite(targetValue);
    if (direction === "target-range" ? !validRange : !validScalar) fail(findings, "invalid-setpoint", path, direction === "target-range" ? "target-range setpoint needs an ordered two-number value and evidence references" : "setpoint needs a finite numeric value and evidence references");
    if (!keys(position.operatingScope, ["description", "included", "excluded"]) || !text(position.operatingScope.description) || !strings(position.operatingScope.included, 1) || !strings(position.operatingScope.excluded, 1)) fail(findings, "invalid-operating-scope", path, "operatingScope needs description, included, and excluded boundaries");
    if (!keys(position.authority, ["decisionOwner", "actionAuthority"]) || !text(position.authority.decisionOwner) || !text(position.authority.actionAuthority)) fail(findings, "invalid-authority", path, "authority needs decisionOwner and actionAuthority");
    if (!keys(position.evidenceSource, ["description", "locator"]) || !text(position.evidenceSource.description) || !text(position.evidenceSource.locator)) fail(findings, "invalid-evidence-source", path, "evidenceSource needs description and locator");
    if (!keys(position.cadence, ["measure", "review"]) || !text(position.cadence.measure) || !text(position.cadence.review)) fail(findings, "invalid-cadence", path, "cadence needs measure and review");
    if (!keys(position.budget, ["amount", "unit", "period"]) || typeof position.budget.amount !== "number" || position.budget.amount < 0 || !text(position.budget.unit) || !text(position.budget.period)) fail(findings, "invalid-budget", path, "budget needs non-negative amount, unit, and period");
    if (!strings(position.guardrails, 1) || !strings(position.escalationPath, 1)) fail(findings, "invalid-constraints", path, "guardrails and escalationPath need at least one item");
    if (!Array.isArray(position.workerComponents) || position.workerComponents.length === 0 || position.workerComponents.some((worker: unknown) => !keys(worker, ["kind", "responsibility"]) || !WORKER_COMPONENT_KINDS.includes(worker.kind as never) || !text(worker.responsibility)) || new Set(position.workerComponents.map((worker: unknown) => record(worker) ? worker.kind : "")).size !== position.workerComponents.length) fail(findings, "invalid-worker-components", path, "worker components need unique declared kinds and responsibilities");
    const stageBindings = position.stageBindings;
    if (!keys(stageBindings, universalStages)) fail(findings, "invalid-stage-bindings", path, "stageBindings needs one activity for sense, judge, act, verify, and learnOrEscalate");
    else if (universalStages.some((stage) => !text(stageBindings[stage]))) fail(findings, "invalid-stage-bindings", path, "stageBindings needs one nonempty consumer activity for sense, judge, act, verify, and learnOrEscalate");
    const assessment = position.firstDayAssessment;
    if (!keys(assessment, firstDayFields) || !strings(assessment.gaps) || !text(assessment.target) || !strings(assessment.openQuestions) || !strings(assessment.criticalPath, 1) || !strings(assessment.deferredWork) || !POSITION_RECOMMENDATIONS.includes(assessment.recommendation as never) || !strings(assessment.evidenceRefs, 1)) fail(findings, "invalid-first-day-assessment", path, "first-day assessment needs gaps, target, open questions, critical path, deferred work, recommendation, and evidence references; position.baseline is its single baseline");
  }
  const cited = new Set<string>();
  for (const [packageName, disposition] of dispositions) for (const id of disposition.ids) {
    if (cited.has(id)) fail(findings, "duplicate-position-citation", packageName, `${id} is cited by more than one disposition`);
    cited.add(id);
    if (!positionIds.has(id)) fail(findings, "missing-cited-position", packageName, `${id} is not a complete position record`);
    else if (positionPackages.get(id) !== packageName) fail(findings, "wrong-position-role", packageName, `${id} belongs to a different role`);
  }
  for (const id of positionIds) if (!cited.has(id)) fail(findings, "uncited-position", id, "every position must be owned by its open role disposition");
  return { ok: findings.length === 0, findings, openRoles: [...dispositions.values()].filter((item) => item.disposition === "open").length, positions: positionIds.size };
}
