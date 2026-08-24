#!/usr/bin/env node
// check-role-loop-archetypes — keep the role-package qualification matrix
// complete, machine-readable, and closed-loop.
//
//   node scripts/check-role-loop-archetypes.mjs [roleContractPath] [candidateAssessmentPath]
//
// The contract is a durable job charter, not evidence that any consumer has
// installed or adopted a role. Optional candidate assessment is pure and
// no-write; its verdict never changes package-program or lifecycle records.
//
// Exit 0 = valid contract (and, if supplied, valid candidate assessment).
// Exit 1 = readable contract or candidate assessment violates the schema.
// Exit 2 = an input cannot be read or has an unusable top-level shape.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UNIVERSAL_STAGES = ["sense", "judge", "act", "verify", "learnOrEscalate"];

export const CONSUMER_BINDINGS = [
  "businessMetricPath",
  "causalHypothesis",
  "baseline",
  "setpoint",
  "operatingScope",
  "authority",
  "evidenceSource",
  "cadence",
  "budget",
  "guardrails",
  "escalationPath",
  "workerComponents",
  "stageBindings",
  "firstDayAssessment",
];

export const MODE_NAMES = [
  "assure",
  "reconcile",
  "fulfill",
  "interact",
  "steward",
  "optimize",
];

export const METRIC_UNITS = ["ratio", "count", "duration", "currency", "rate"];
export const METRIC_DIRECTIONS = ["increase", "decrease", "maintain", "target-range"];
export const QUALIFICATION_VERDICTS = ["create", "extend", "compose", "reject"];

const ROLE_FIELDS = ["jobQuestion", "metric", "primaryMode", "secondaryModes", "boundary", "closeCondition"];
const METRIC_FIELDS = ["name", "formula", "unit", "direction"];
const BOUNDARY_FIELDS = ["owns", "excludes"];
const COVERAGE_FIELDS = ["role", "jobEvidence", "metricEvidence", "loopClosureEvidence"];
const SCOPED_PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameKeys(value, expected) {
  return isRecord(value) && sameArray(Object.keys(value).sort(), [...expected].sort());
}

function finding(rule, subject, message, fatal = false) {
  return { rule, subject, message, fatal };
}

function validateUniqueNonemptyStrings(value, { rule, subject, label }, findings) {
  if (!Array.isArray(value) || value.some((item) => !isNonemptyString(item))) {
    findings.push(finding(rule, subject, `${label} must be an array of nonempty strings`, true));
    return false;
  }
  if (new Set(value).size !== value.length) findings.push(finding(rule, subject, `${label} may not contain duplicates`));
  return true;
}

function validateRoleDeclaration({ declaration, subject, modes, metricUnits, metricDirections }, findings) {
  if (!sameKeys(declaration, ROLE_FIELDS)) {
    findings.push(finding("unreadable-role-declaration", subject, `must contain exactly: ${ROLE_FIELDS.join(", ")}`, true));
    return;
  }

  if (!isNonemptyString(declaration.jobQuestion) || !declaration.jobQuestion.trim().endsWith("?")) {
    findings.push(finding("invalid-job-question", subject, "jobQuestion must be a nonempty question ending in `?`"));
  }
  if (!isNonemptyString(declaration.closeCondition)) {
    findings.push(finding("invalid-close-condition", subject, "closeCondition must name an external measurement that ends the role's loop"));
  }

  if (!sameKeys(declaration.metric, METRIC_FIELDS)) {
    findings.push(finding("unreadable-owned-metric", subject, `metric must contain exactly: ${METRIC_FIELDS.join(", ")}`, true));
  } else {
    if (!isNonemptyString(declaration.metric.name)) findings.push(finding("invalid-metric-name", subject, "metric.name must be a nonempty string"));
    if (!isNonemptyString(declaration.metric.formula)) findings.push(finding("invalid-metric-formula", subject, "metric.formula must be a nonempty string"));
    if (!metricUnits.has(declaration.metric.unit)) findings.push(finding("invalid-metric-unit", subject, `metric.unit must name one of: ${[...metricUnits].join(", ")}`));
    if (!metricDirections.has(declaration.metric.direction)) findings.push(finding("invalid-metric-direction", subject, `metric.direction must name one of: ${[...metricDirections].join(", ")}`));
  }

  if (!modes.has(declaration.primaryMode)) {
    findings.push(finding("invalid-primary-mode", subject, `primaryMode must name one of: ${[...modes].join(", ")}`));
  }
  if (validateUniqueNonemptyStrings(declaration.secondaryModes, {
    rule: "unreadable-secondary-modes",
    subject,
    label: "secondaryModes",
  }, findings)) {
    if (declaration.secondaryModes.some((mode) => !modes.has(mode))) {
      findings.push(finding("invalid-secondary-mode", subject, "every secondary mode must be declared in `modes`"));
    }
    if (declaration.secondaryModes.includes(declaration.primaryMode)) {
      findings.push(finding("secondary-matches-primary", subject, "secondaryModes must be distinct from primaryMode"));
    }
  }

  if (!sameKeys(declaration.boundary, BOUNDARY_FIELDS)) {
    findings.push(finding("unreadable-role-boundary", subject, `boundary must contain exactly: ${BOUNDARY_FIELDS.join(", ")}`, true));
  } else {
    if (!isNonemptyString(declaration.boundary.owns)) findings.push(finding("invalid-boundary-owner", subject, "boundary.owns must be a nonempty string"));
    if (validateUniqueNonemptyStrings(declaration.boundary.excludes, {
      rule: "invalid-boundary-exclusions",
      subject,
      label: "boundary.excludes",
    }, findings) && declaration.boundary.excludes.length === 0) {
      findings.push(finding("invalid-boundary-exclusions", subject, "boundary.excludes must name at least one excluded responsibility"));
    }
  }
}

/** Pure validator so focused tests can exercise both data and the CLI separately. */
export function evaluateRoleLoopArchetypes({ contract }) {
  const findings = [];
  if (!isRecord(contract)) {
    return { findings: [...findings, finding("unreadable-role-loop-contract", "docs/contracts/role-loop-archetypes.json", "the contract must be an object", true)] };
  }
  if (!sameKeys(contract, ["schemaVersion", "universalStages", "consumerBindings", "modes", "metricVocabulary", "qualificationVerdicts", "roles"])) {
    findings.push(finding("unreadable-role-loop-contract", "docs/contracts/role-loop-archetypes.json", "the contract must contain exactly `schemaVersion`, `universalStages`, `consumerBindings`, `modes`, `metricVocabulary`, `qualificationVerdicts`, and `roles`", true));
    return { findings };
  }
  if (contract.schemaVersion !== 4 || !Array.isArray(contract.universalStages) || !Array.isArray(contract.consumerBindings) || !isRecord(contract.modes) || !isRecord(contract.roles)) {
    findings.push(finding("unreadable-role-loop-contract", "docs/contracts/role-loop-archetypes.json", "schema version 4 requires arrays `universalStages` and `consumerBindings`, and objects `modes` and `roles`", true));
    return { findings };
  }

  if (!sameArray(contract.universalStages, UNIVERSAL_STAGES)) {
    findings.push(finding("universal-stages-mismatch", "universalStages", `must be exactly: ${UNIVERSAL_STAGES.join(", ")}`));
  }
  if (!sameArray(contract.consumerBindings, CONSUMER_BINDINGS)) {
    findings.push(finding("consumer-bindings-mismatch", "consumerBindings", `must be exactly: ${CONSUMER_BINDINGS.join(", ")}`));
  }

  if (!sameKeys(contract.modes, MODE_NAMES)) {
    findings.push(finding("mode-vocabulary-mismatch", "modes", `must define exactly: ${MODE_NAMES.join(", ")}`));
  }
  for (const [modeName, mode] of Object.entries(contract.modes)) {
    if (!sameKeys(mode, ["objective", "stageActivities"]) || !isNonemptyString(mode.objective) || !isRecord(mode.stageActivities)) {
      findings.push(finding("unreadable-mode", modeName, "must contain exactly a nonempty `objective` and object `stageActivities`", true));
      continue;
    }
    if (!sameKeys(mode.stageActivities, UNIVERSAL_STAGES) || Object.values(mode.stageActivities).some((activity) => !isNonemptyString(activity))) {
      findings.push(finding("mode-stage-coverage", modeName, `stageActivities must contain one nonempty activity for each universal stage: ${UNIVERSAL_STAGES.join(", ")}`));
    }
  }

  const vocabulary = contract.metricVocabulary;
  if (!sameKeys(vocabulary, ["units", "directions"]) || !sameArray(vocabulary.units, METRIC_UNITS) || !sameArray(vocabulary.directions, METRIC_DIRECTIONS)) {
    findings.push(finding("metric-vocabulary-mismatch", "metricVocabulary", `units must be ${METRIC_UNITS.join(", ")}; directions must be ${METRIC_DIRECTIONS.join(", ")}`));
  }
  const verdicts = contract.qualificationVerdicts;
  if (!sameKeys(verdicts, QUALIFICATION_VERDICTS) || Object.values(verdicts).some((meaning) => !isNonemptyString(meaning))) {
    findings.push(finding("qualification-vocabulary-mismatch", "qualificationVerdicts", `must define nonempty meanings for exactly: ${QUALIFICATION_VERDICTS.join(", ")}`));
  }
  if (!isRecord(contract.roles)) {
    findings.push(finding("unreadable-role-packages", "roles", "must be an object", true));
    return { findings };
  }

  const declaredRoleNames = Object.keys(contract.roles);
  const knownModes = new Set(Object.keys(contract.modes));
  const metricUnits = new Set(Array.isArray(vocabulary?.units) ? vocabulary.units : []);
  const metricDirections = new Set(Array.isArray(vocabulary?.directions) ? vocabulary.directions : []);
  const metricOwners = new Map();
  for (const [role, declaration] of Object.entries(contract.roles)) {
    validateRoleDeclaration({ declaration, subject: role, modes: knownModes, metricUnits, metricDirections }, findings);
    const metricName = declaration?.metric?.name;
    if (isNonemptyString(metricName)) {
      if (metricOwners.has(metricName)) {
        findings.push(finding("duplicate-owned-metric", role, `metric “${metricName}” is already owned by ${metricOwners.get(metricName)}`));
      } else {
        metricOwners.set(metricName, role);
      }
    }
  }
  return { findings, roleCount: declaredRoleNames.length };
}

/**
 * Qualify a proposed role without writing it into lifecycle or Program state.
 * `sameJobMetricLoopCoverage` is deliberately stronger than dependency or
 * adjacency: every cited role needs evidence that it already owns and closes
 * the candidate's same job, metric, and loop.
 */
export function qualifyRoleCandidate({ assessment, contract }) {
  const findings = [];
  if (!isRecord(assessment) || !sameKeys(assessment, ["schemaVersion", "candidate", "sameJobMetricLoopCoverage", "rejectionReasons"]) || assessment.schemaVersion !== 1) {
    return {
      verdict: "reject",
      validAssessment: false,
      relatedRoles: [],
      reasons: ["candidate assessment must be schemaVersion 1 with candidate, sameJobMetricLoopCoverage, and rejectionReasons"],
    };
  }
  const packages = contract?.roles;
  const vocabulary = contract?.metricVocabulary;
  const modes = contract?.modes;
  if (!isRecord(packages) || !isRecord(vocabulary) || !isRecord(modes)) {
    return { verdict: "reject", validAssessment: false, relatedRoles: [], reasons: ["role contract is not usable for qualification"] };
  }

  const candidate = assessment.candidate;
  if (!isRecord(candidate) || !sameKeys(candidate, ["name", ...ROLE_FIELDS]) || !isNonemptyString(candidate.name) || !SCOPED_PACKAGE_NAME.test(candidate.name)) {
    findings.push(finding("invalid-candidate", "candidate", "must contain a scoped package name and exactly one role charter"));
  } else {
    const declaration = Object.fromEntries(ROLE_FIELDS.map((field) => [field, candidate[field]]));
    validateRoleDeclaration({
      declaration,
      subject: candidate.name,
      modes: new Set(Object.keys(modes)),
      metricUnits: new Set(Array.isArray(vocabulary.units) ? vocabulary.units : []),
      metricDirections: new Set(Array.isArray(vocabulary.directions) ? vocabulary.directions : []),
    }, findings);
  }

  const coverage = assessment.sameJobMetricLoopCoverage;
  const relatedRoles = [];
  if (!Array.isArray(coverage)) {
    findings.push(finding("invalid-same-job-coverage", "sameJobMetricLoopCoverage", "must be an array", true));
  } else {
    for (const [index, item] of coverage.entries()) {
      const subject = `sameJobMetricLoopCoverage[${index}]`;
      if (!sameKeys(item, COVERAGE_FIELDS) || !isNonemptyString(item.role) || !isNonemptyString(item.jobEvidence) || !isNonemptyString(item.metricEvidence) || !isNonemptyString(item.loopClosureEvidence)) {
        findings.push(finding("invalid-same-job-coverage", subject, `must contain nonempty ${COVERAGE_FIELDS.join(", ")}`));
        continue;
      }
      if (!Object.hasOwn(packages, item.role)) {
        findings.push(finding("unknown-covered-role", subject, `${item.role} is not a current role in the contract`));
      }
      relatedRoles.push(item.role);
    }
    if (new Set(relatedRoles).size !== relatedRoles.length) findings.push(finding("duplicate-covered-role", "sameJobMetricLoopCoverage", "a current role may be cited only once"));
  }

  const rejectionReasons = assessment.rejectionReasons;
  if (!Array.isArray(rejectionReasons) || rejectionReasons.some((reason) => !isNonemptyString(reason))) {
    findings.push(finding("invalid-rejection-reasons", "rejectionReasons", "must be an array of nonempty strings"));
  }

  if (findings.length > 0) {
    return {
      verdict: "reject",
      validAssessment: false,
      relatedRoles,
      reasons: findings.map((item) => `${item.rule}: ${item.message}`),
    };
  }
  if (rejectionReasons.length > 0) {
    return { verdict: "reject", validAssessment: true, relatedRoles, reasons: [...rejectionReasons] };
  }
  if (relatedRoles.length === 0) return { verdict: "create", validAssessment: true, relatedRoles, reasons: [] };
  if (relatedRoles.length === 1) return { verdict: "extend", validAssessment: true, relatedRoles, reasons: [] };
  return { verdict: "compose", validAssessment: true, relatedRoles, reasons: [] };
}

function die(message) {
  console.error(`check-role-loop-archetypes: ${message}`);
  process.exit(2);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`could not read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const [roleContractArg, candidateAssessmentArg, ...extra] = process.argv.slice(2);
  if (extra.length > 0) die("accepts at most a role contract and candidate assessment path");
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const roleContractPath = resolve(roleContractArg ?? join(repoRoot, "docs/contracts/role-loop-archetypes.json"));
  const contract = readJson(roleContractPath, "the role contract");
  const result = evaluateRoleLoopArchetypes({
    contract,
  });

  for (const item of result.findings) console.log(`  FAIL  ${item.rule}  ${item.subject} — ${item.message}`);
  if (result.findings.length > 0) process.exit(result.findings.some((item) => item.fatal) ? 2 : 1);

  console.log(`ROLE PACKAGE QUALIFICATION OK — ${result.roleCount} role package(s), one owned metric and one primary loop mode each.`);
  if (candidateAssessmentArg !== undefined) {
    const qualification = qualifyRoleCandidate({
      assessment: readJson(resolve(candidateAssessmentArg), "the candidate assessment"),
      contract,
    });
    console.log(`ROLE CANDIDATE ${qualification.verdict.toUpperCase()}${qualification.relatedRoles.length > 0 ? ` — ${qualification.relatedRoles.join(", ")}` : ""}`);
    for (const reason of qualification.reasons) console.log(`  ${reason}`);
    if (!qualification.validAssessment) process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
