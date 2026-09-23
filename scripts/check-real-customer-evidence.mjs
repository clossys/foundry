#!/usr/bin/env node
// check-real-customer-evidence — validate the real-customer-evidence contract
// (docs/contracts/real-customer-evidence-contract.json, #1222) and, if given,
// one evidence record against it.
//
//   node scripts/check-real-customer-evidence.mjs [contractPath] [recordPath]
//
// The contract is the durable definition; a record is judged evidence, never
// treated as adopted or held anywhere merely because it is readable. Records
// hold redacted or summarized content plus a pointer, never the real
// interview, thread, call, or survey response -- see the contract's own
// `rule` for what that means.
//
// Exit 0 = valid contract (and, if supplied, satisfied record).
// Exit 1 = readable contract or record violates the rule.
// Exit 2 = an input cannot be read or has an unusable top-level shape.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCheckOutputEnvelope } from "./check-package-framework.mjs";

// States and conditions are never redeclared here -- they are read from
// docs/contracts/lifecycle.json (#1228), the one shared vocabulary every
// package specializes rather than re-declares. See that contract's own
// `governance.rule`.
export const EVIDENCE_KINDS = ["interview", "support-thread", "call-summary", "survey-response", "usage-signal"];
export const COLLECTORS = ["coding-agent", "human"];
export const CONSENT_BASES = ["explicit-recorded-consent", "existing-support-relationship-terms", "anonymized-aggregate-no-consent-required"];
export const WEIGHT_CLASSES = ["primary", "corroborating", "context-only"];

const RECORD_FIELDS = ["schemaVersion", "recordId", "kind", "source", "consent", "summary", "lifecycle", "weighting", "retention"];
const SOURCE_FIELDS = ["description", "collectedBy", "collectedAt", "pointer"];
const CONSENT_FIELDS = ["basis", "confirmedBy", "confirmedAt", "scope"];
const LIFECYCLE_FIELDS = ["state", "condition", "enteredAt", "reason"];
const WEIGHTING_FIELDS = ["appliesTo", "weightClass", "calibrationNote"];
const RETENTION_FIELDS = ["holder", "scheduleRef", "reviewBy"];

// Deliberately simple lexical PII markers -- a heuristic backstop, not a
// substitute for redacting before the record is written. See the contract's
// own `rule` for what belongs here instead: a pointer, not the content.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\s.-]?){3}\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d/;
const NATIONAL_ID_RE = /\b\d{9}\b/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isIsoInstant(value) {
  return isNonemptyString(value) && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value);
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameKeys(value, expected) {
  return isRecord(value) && sameArray(Object.keys(value).sort(), [...expected].sort());
}

function finding(rule, subject, message, fatal = false) {
  return { rule, path: subject, message, severity: "error", fatal };
}

/** Strip the internal `fatal` control-flow flag; emit docs/contracts/check-output-envelope.json's findingShape. */
function toEnvelopeFinding({ rule, path, message, severity }) {
  return { rule, path, message, severity };
}

/**
 * Pure validator for the contract's own vocabulary. `lifecycle` is
 * docs/contracts/lifecycle.json's own parsed document -- this contract does
 * not declare `states`/`conditions` itself, so the caller supplies the one
 * shared source instead of this function reading a second, local copy.
 */
export function evaluateRealCustomerEvidenceContract({ contract, lifecycle }) {
  const findings = [];
  if (!isRecord(contract)) {
    return { findings: [finding("unreadable-evidence-contract", "docs/contracts/real-customer-evidence-contract.json", "the contract must be an object", true)] };
  }
  if (contract.schemaVersion !== 1 || contract.kind !== "foundry-real-customer-evidence") {
    findings.push(finding("unreadable-evidence-contract", "schemaVersion/kind", "must declare schemaVersion 1 and kind foundry-real-customer-evidence", true));
    return { findings };
  }
  if (!isRecord(lifecycle) || lifecycle.kind !== "foundry-lifecycle" || !Array.isArray(lifecycle.states) || !Array.isArray(lifecycle.conditions)) {
    findings.push(finding("unreadable-shared-lifecycle", "docs/contracts/lifecycle.json", "must be readable and declare kind foundry-lifecycle with states and conditions", true));
    return { findings };
  }
  if (!sameArray(contract.evidenceKinds, EVIDENCE_KINDS)) {
    findings.push(finding("evidence-kind-vocabulary-mismatch", "evidenceKinds", `must be exactly: ${EVIDENCE_KINDS.join(", ")}`));
  }
  if (!sameArray(contract.collectors, COLLECTORS)) {
    findings.push(finding("collector-vocabulary-mismatch", "collectors", `must be exactly: ${COLLECTORS.join(", ")}`));
  }
  if (!sameArray(contract.consentBases, CONSENT_BASES)) {
    findings.push(finding("consent-basis-vocabulary-mismatch", "consentBases", `must be exactly: ${CONSENT_BASES.join(", ")}`));
  }
  if (!sameArray(contract.weightClasses, WEIGHT_CLASSES)) {
    findings.push(finding("weight-class-vocabulary-mismatch", "weightClasses", `must be exactly: ${WEIGHT_CLASSES.join(", ")}`));
  }
  if (!isRecord(contract.lifecycleTransitions) || !sameArray(Object.keys(contract.lifecycleTransitions).sort(), [...lifecycle.states].sort())) {
    findings.push(finding("lifecycle-transitions-mismatch", "lifecycleTransitions", `must declare a transition list for every shared lifecycle state: ${lifecycle.states.join(", ")}`));
  } else {
    for (const [state, nextStates] of Object.entries(contract.lifecycleTransitions)) {
      if (!Array.isArray(nextStates) || nextStates.some((next) => !lifecycle.states.includes(next))) {
        findings.push(finding("invalid-lifecycle-transition", state, "every declared next state must be a known shared lifecycle state"));
      }
    }
  }
  if (!Array.isArray(contract.forbiddenFieldNames) || contract.forbiddenFieldNames.some((name) => !isNonemptyString(name))) {
    findings.push(finding("invalid-forbidden-field-names", "forbiddenFieldNames", "must be an array of nonempty strings"));
  }
  return { findings };
}

function reachable(transitions, state) {
  const seen = new Set(["absent"]);
  const queue = ["absent"];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === state) return true;
    for (const next of transitions[current] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.has(state);
}

function collectForbiddenFieldNames(value, forbidden, path, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFieldNames(item, forbidden, `${path}[${index}]`, findings));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbidden.has(key.toLowerCase().replace(/[_-]/g, ""))) {
      findings.push(finding("forbidden-personal-data-field", `${path}.${key}`, `field name "${key}" is a forbidden personal-data-shaped field; hold it outside this repository and cite it only by source.pointer`));
    }
    collectForbiddenFieldNames(nested, forbidden, `${path}.${key}`, findings);
  }
}

function collectPersonalDataShapedValues(value, path, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPersonalDataShapedValues(item, `${path}[${index}]`, findings));
    return;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) collectPersonalDataShapedValues(nested, `${path}.${key}`, findings);
    return;
  }
  if (typeof value !== "string") return;
  if (EMAIL_RE.test(value)) findings.push(finding("personal-data-shaped-value", path, "value contains an email-address-shaped string; redact or summarize before recording"));
  if (PHONE_RE.test(value)) findings.push(finding("personal-data-shaped-value", path, "value contains a phone-number-shaped string; redact or summarize before recording"));
  if (NATIONAL_ID_RE.test(value)) findings.push(finding("personal-data-shaped-value", path, "value contains a nine-digit number shaped like a national identifier; redact or summarize before recording"));
}

/** Pure validator for one evidence record. Judged against a validated contract's vocabulary and the shared docs/contracts/lifecycle.json. */
export function evaluateRealCustomerEvidenceRecord({ record, contract, lifecycle }) {
  const findings = [];
  if (!isRecord(record)) {
    return { verdict: "indeterminate", findings: [finding("unreadable-record", "record", "the record must be an object", true)] };
  }
  if (!sameKeys(record, RECORD_FIELDS)) {
    return { verdict: "indeterminate", findings: [finding("unreadable-record", "record", `must contain exactly: ${RECORD_FIELDS.join(", ")}`, true)] };
  }
  if (record.schemaVersion !== 1) {
    findings.push(finding("invalid-schema-version", "schemaVersion", "must be 1"));
  }
  if (!isNonemptyString(record.recordId)) {
    findings.push(finding("invalid-record-id", "recordId", "must be a nonempty string"));
  }
  if (!contract.evidenceKinds.includes(record.kind)) {
    findings.push(finding("invalid-evidence-kind", "kind", `must name one of: ${contract.evidenceKinds.join(", ")}`));
  }

  const forbidden = new Set((contract.forbiddenFieldNames ?? []).map((name) => name.toLowerCase().replace(/[_-]/g, "")));
  collectForbiddenFieldNames(record, forbidden, "record", findings);
  collectPersonalDataShapedValues(record, "record", findings);

  if (!sameKeys(record.source, SOURCE_FIELDS)) {
    findings.push(finding("unreadable-source", "source", `must contain exactly: ${SOURCE_FIELDS.join(", ")}`, true));
  } else {
    if (!isNonemptyString(record.source.description)) findings.push(finding("invalid-source-description", "source.description", "must be a nonempty redacted or summarized description"));
    if (!contract.collectors.includes(record.source.collectedBy)) findings.push(finding("invalid-collector", "source.collectedBy", `must name one of: ${contract.collectors.join(", ")}`));
    if (!isIsoInstant(record.source.collectedAt)) findings.push(finding("invalid-collected-at", "source.collectedAt", "must be a known-offset RFC3339 instant"));
    if (!isNonemptyString(record.source.pointer)) findings.push(finding("invalid-pointer", "source.pointer", "must be a nonempty opaque pointer to where the real material is held"));
  }

  if (!sameKeys(record.consent, CONSENT_FIELDS)) {
    findings.push(finding("unreadable-consent", "consent", `must contain exactly: ${CONSENT_FIELDS.join(", ")}`, true));
  } else {
    if (!contract.consentBases.includes(record.consent.basis)) findings.push(finding("invalid-consent-basis", "consent.basis", `must name one of: ${contract.consentBases.join(", ")}`));
    if (!isNonemptyString(record.consent.confirmedBy)) findings.push(finding("invalid-consent-confirmer", "consent.confirmedBy", "must name who confirmed consent applies, even for the anonymized-aggregate basis"));
    if (!isIsoInstant(record.consent.confirmedAt)) findings.push(finding("invalid-consent-confirmed-at", "consent.confirmedAt", "must be a known-offset RFC3339 instant"));
    if (!isNonemptyString(record.consent.scope)) findings.push(finding("invalid-consent-scope", "consent.scope", "must state what the record may be used for"));
  }

  if (!isNonemptyString(record.summary)) {
    findings.push(finding("invalid-summary", "summary", "must be a nonempty redacted or summarized string"));
  }

  let lifecycleState;
  if (!sameKeys(record.lifecycle, LIFECYCLE_FIELDS)) {
    findings.push(finding("unreadable-lifecycle", "lifecycle", `must contain exactly: ${LIFECYCLE_FIELDS.join(", ")}`, true));
  } else {
    lifecycleState = record.lifecycle.state;
    if (!lifecycle.states.includes(lifecycleState)) {
      findings.push(finding("invalid-lifecycle-state", "lifecycle.state", `must name one of the shared lifecycle states: ${lifecycle.states.join(", ")}`));
    } else if (!reachable(contract.lifecycleTransitions, lifecycleState)) {
      findings.push(finding("unreachable-lifecycle-state", "lifecycle.state", `"${lifecycleState}" is not reachable from "absent" by the declared transitions`));
    }
    if (!lifecycle.conditions.includes(record.lifecycle.condition)) {
      findings.push(finding("invalid-condition", "lifecycle.condition", `must name one of the shared conditions: ${lifecycle.conditions.join(", ")}`));
    }
    if (!isIsoInstant(record.lifecycle.enteredAt)) {
      findings.push(finding("invalid-lifecycle-entered-at", "lifecycle.enteredAt", "must be a known-offset RFC3339 instant"));
    }
    if (typeof record.lifecycle.reason !== "string") {
      findings.push(finding("invalid-lifecycle-reason", "lifecycle.reason", "must be a string (empty when not required)"));
    } else {
      const reasonRequired = record.lifecycle.condition === "blocked" || lifecycleState === "retired";
      if (reasonRequired && record.lifecycle.reason.trim() === "") {
        findings.push(finding("missing-lifecycle-reason", "lifecycle.reason", "a blocked condition or a retired state needs a nonempty reason"));
      }
    }
  }

  if (!sameKeys(record.weighting, WEIGHTING_FIELDS)) {
    findings.push(finding("unreadable-weighting", "weighting", `must contain exactly: ${WEIGHTING_FIELDS.join(", ")}`, true));
  } else {
    if (!Array.isArray(record.weighting.appliesTo) || record.weighting.appliesTo.some((item) => !isNonemptyString(item))) {
      findings.push(finding("invalid-applies-to", "weighting.appliesTo", "must be an array of nonempty claim or persona ids"));
    }
    if (!contract.weightClasses.includes(record.weighting.weightClass)) {
      findings.push(finding("invalid-weight-class", "weighting.weightClass", `must name one of: ${contract.weightClasses.join(", ")}`));
    }
    if (typeof record.weighting.calibrationNote !== "string") {
      findings.push(finding("invalid-calibration-note", "weighting.calibrationNote", "must be a string (empty until judged)"));
    } else {
      const judged = lifecycleState === "approved" || lifecycleState === "verified";
      if (judged && record.weighting.calibrationNote.trim() === "") {
        findings.push(finding("missing-calibration-note", "weighting.calibrationNote", "an approved or verified record must state how it calibrates or corroborates a claim or persona"));
      }
      if (!judged && record.weighting.calibrationNote.trim() !== "") {
        findings.push(finding("premature-calibration-note", "weighting.calibrationNote", "a record that is not yet approved or verified has nothing judged to calibrate"));
      }
    }
  }

  if (!sameKeys(record.retention, RETENTION_FIELDS)) {
    findings.push(finding("unreadable-retention", "retention", `must contain exactly: ${RETENTION_FIELDS.join(", ")}`, true));
  } else {
    if (record.retention.holder !== "keeper") {
      findings.push(finding("invalid-retention-holder", "retention.holder", "must be \"keeper\" -- Strategist and Customer cite a record, they do not hold it"));
    }
    if (!isNonemptyString(record.retention.scheduleRef)) findings.push(finding("invalid-retention-schedule", "retention.scheduleRef", "must point at the governing Keeper retention schedule"));
    if (!isNonemptyString(record.retention.reviewBy)) findings.push(finding("invalid-retention-review-by", "retention.reviewBy", "must name the next retention review date"));
  }

  if (findings.some((item) => item.fatal)) return { verdict: "indeterminate", findings };
  return { verdict: findings.length > 0 ? "violated" : "satisfied", findings };
}

/**
 * Real evidence never outranks Strategist's or Customer's own judgment; this
 * only states how much of a claim's citation base is real rather than
 * synthetic-only, for a surface such as STATUS.md to report. `context-only`
 * evidence corroborates but is not counted toward the real share on its own.
 */
export function computeRealEvidenceShare({ records, claimId }) {
  const applicable = records.filter((record) => Array.isArray(record?.weighting?.appliesTo) && record.weighting.appliesTo.includes(claimId));
  if (applicable.length === 0) return { claimId, citedRecordCount: 0, realShare: 0, calibratedBy: "synthetic-only" };
  const real = applicable.filter((record) => {
    const judged = record?.lifecycle?.state === "approved" || record?.lifecycle?.state === "verified";
    const current = record?.lifecycle?.condition === "current";
    const weighted = record?.weighting?.weightClass !== "context-only";
    return judged && current && weighted;
  });
  return {
    claimId,
    citedRecordCount: applicable.length,
    realShare: real.length / applicable.length,
    calibratedBy: real.length > 0 ? "real-and-synthetic" : "synthetic-only",
  };
}

function die(message) {
  console.error(`check-real-customer-evidence: ${message}`);
  process.exit(2);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`could not read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Builds and validates docs/contracts/check-output-envelope.json's own shape before printing it. */
function report({ verdict, summary, findings, nextAction }) {
  const envelope = {
    package: "foundry-real-customer-evidence-gate",
    version: "1.0.0",
    verdict,
    summary,
    findings: findings.map(toEnvelopeFinding),
    ...(nextAction ? { nextAction } : {}),
  };
  const envelopeFindings = validateCheckOutputEnvelope(envelope, "check-real-customer-evidence report");
  if (envelopeFindings.length > 0) {
    for (const item of envelopeFindings) console.error(`  FAIL  ${item.rule}  ${item.path} — ${item.message}`);
    die("this gate's own report failed docs/contracts/check-output-envelope.json's shape check");
  }
  console.log(JSON.stringify(envelope, null, 2));
  return envelope;
}

async function main() {
  const [contractArg, recordArg, ...extra] = process.argv.slice(2);
  if (extra.length > 0) die("accepts at most a contract path and a record path");
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const contractPath = resolve(contractArg ?? join(repoRoot, "docs/contracts/real-customer-evidence-contract.json"));
  const contract = readJson(contractPath, "the real-customer-evidence contract");
  const lifecyclePath = join(repoRoot, "docs/contracts/lifecycle.json");
  const lifecycle = readJson(lifecyclePath, "the shared lifecycle contract");
  const contractResult = evaluateRealCustomerEvidenceContract({ contract, lifecycle });

  if (contractResult.findings.length > 0) {
    const fatal = contractResult.findings.some((item) => item.fatal);
    report({
      verdict: fatal ? "indeterminate" : "violated",
      summary: "The real-customer-evidence contract itself does not satisfy its own or the shared lifecycle vocabulary.",
      findings: contractResult.findings,
      nextAction: "Fix docs/contracts/real-customer-evidence-contract.json to match docs/contracts/lifecycle.json's shared vocabulary.",
    });
    process.exit(fatal ? 2 : 1);
  }

  const recordPath = resolve(recordArg ?? join(repoRoot, "docs/contracts/real-customer-evidence.fixture.json"));
  const record = readJson(recordPath, "the evidence record");
  const recordResult = evaluateRealCustomerEvidenceRecord({ record, contract, lifecycle });
  const envelope = report({
    verdict: recordResult.verdict,
    summary: recordResult.verdict === "satisfied"
      ? "The evidence record satisfies the real-customer-evidence contract."
      : "The evidence record does not satisfy the real-customer-evidence contract.",
    findings: recordResult.findings,
    ...(recordResult.verdict !== "satisfied" ? { nextAction: `Fix the evidence record at ${recordPath}.` } : {}),
  });
  if (envelope.verdict !== "satisfied") process.exit(envelope.verdict === "indeterminate" ? 2 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
