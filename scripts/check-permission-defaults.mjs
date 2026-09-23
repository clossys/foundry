#!/usr/bin/env node
// check-permission-defaults — validate the permission-defaults contract
// (docs/contracts/permission-defaults-contract.json, #1225) and, if given,
// one repository's own permission-defaults record against it.
//
//   node scripts/check-permission-defaults.mjs [contractPath] [recordPath]
//
// The contract is the durable definition of what a Clossys-guided agent may
// do unasked, what always needs the client's approval, and what it never
// does in a staffed repository. This is validation only -- Launcher applying
// a repository's declaration at compose time (CODEOWNERS, branch-protection
// guidance) is not part of this gate; see docs/contracts/trust-statement.md
// and the pull request that introduced this contract for what is left out.
//
// Exit 0 = valid contract (and, if supplied, satisfied record).
// Exit 1 = readable contract or record violates the rule.
// Exit 2 = an input cannot be read or has an unusable top-level shape.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCheckOutputEnvelope } from "./check-package-framework.mjs";

export const TIERS = ["unasked", "approval", "never"];

// #1226: everything a client reads says Clossys, never Foundry (this
// repository's own internal name), and "voices" has retired in favor of
// "roles". Case-insensitive, word-boundary matched, and blind to HTML
// comments -- a maintainer note about the rule is not itself client-facing
// text.
export const RETIRED_CLIENT_FACING_WORDS = ["Foundry", "voices"];

const CAPABILITY_FIELDS = ["id", "description", "tier", "rationale"];
const RECORD_FIELDS = ["schemaVersion", "repository", "asOf", "capabilities"];

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

function toEnvelopeFinding({ rule, path, message, severity }) {
  return { rule, path, message, severity };
}

/** Pure validator for the contract's own vocabulary. */
export function evaluatePermissionDefaultsContract({ contract }) {
  const findings = [];
  if (!isRecord(contract)) {
    return { findings: [finding("unreadable-permission-defaults-contract", "docs/contracts/permission-defaults-contract.json", "the contract must be an object", true)] };
  }
  if (contract.schemaVersion !== 1 || contract.kind !== "foundry-permission-defaults") {
    findings.push(finding("unreadable-permission-defaults-contract", "schemaVersion/kind", "must declare schemaVersion 1 and kind foundry-permission-defaults", true));
    return { findings };
  }
  if (!sameArray(contract.tiers, TIERS)) {
    findings.push(finding("tier-vocabulary-mismatch", "tiers", `must be exactly: ${TIERS.join(", ")}`));
  }
  if (!Array.isArray(contract.requiredCapabilityIds) || contract.requiredCapabilityIds.some((id) => !isNonemptyString(id))) {
    findings.push(finding("invalid-required-capability-ids", "requiredCapabilityIds", "must be an array of nonempty strings", true));
    return { findings };
  }
  if (new Set(contract.requiredCapabilityIds).size !== contract.requiredCapabilityIds.length) {
    findings.push(finding("duplicate-required-capability-id", "requiredCapabilityIds", "may not contain duplicates"));
  }
  if (!Array.isArray(contract.alwaysHumanCapabilityIds) || contract.alwaysHumanCapabilityIds.some((id) => !isNonemptyString(id))) {
    findings.push(finding("invalid-always-human-capability-ids", "alwaysHumanCapabilityIds", "must be an array of nonempty strings", true));
    return { findings };
  }
  const requiredIds = new Set(contract.requiredCapabilityIds);
  for (const id of contract.alwaysHumanCapabilityIds) {
    if (!requiredIds.has(id)) {
      findings.push(finding("always-human-id-not-required", id, "every id in alwaysHumanCapabilityIds must also appear in requiredCapabilityIds"));
    }
  }
  return { findings };
}

/** Pure validator for one repository's permission-defaults record, judged against a validated contract. */
export function evaluatePermissionDefaultsRecord({ record, contract }) {
  const findings = [];
  if (!isRecord(record)) {
    return { verdict: "indeterminate", findings: [finding("unreadable-record", "record", "the record must be an object", true)] };
  }
  if (!sameKeys(record, RECORD_FIELDS)) {
    return { verdict: "indeterminate", findings: [finding("unreadable-record", "record", `must contain exactly: ${RECORD_FIELDS.join(", ")}`, true)] };
  }
  if (record.schemaVersion !== 1) findings.push(finding("invalid-schema-version", "schemaVersion", "must be 1"));
  if (!isNonemptyString(record.repository)) findings.push(finding("invalid-repository", "repository", "must be a nonempty string"));
  if (!isIsoInstant(record.asOf)) findings.push(finding("invalid-as-of", "asOf", "must be a known-offset RFC3339 instant"));

  if (!Array.isArray(record.capabilities)) {
    return { verdict: "indeterminate", findings: [...findings, finding("unreadable-capabilities", "capabilities", "must be an array", true)] };
  }

  const seenIds = new Map();
  for (const [index, capability] of record.capabilities.entries()) {
    const subject = `capabilities[${index}]`;
    if (!sameKeys(capability, CAPABILITY_FIELDS)) {
      findings.push(finding("unreadable-capability", subject, `must contain exactly: ${CAPABILITY_FIELDS.join(", ")}`));
      continue;
    }
    if (!isNonemptyString(capability.id)) {
      findings.push(finding("invalid-capability-id", subject, "id must be a nonempty string"));
      continue;
    }
    if (seenIds.has(capability.id)) {
      findings.push(finding("duplicate-capability-id", capability.id, `already declared at capabilities[${seenIds.get(capability.id)}]`));
    }
    seenIds.set(capability.id, index);
    if (!isNonemptyString(capability.description)) findings.push(finding("invalid-capability-description", `${subject}.description`, "must be a nonempty string"));
    if (!contract.tiers.includes(capability.tier)) findings.push(finding("invalid-capability-tier", `${subject}.tier`, `must name one of: ${contract.tiers.join(", ")}`));
    if (!isNonemptyString(capability.rationale)) findings.push(finding("missing-capability-rationale", `${subject}.rationale`, "must state a nonempty plain-language reason for this default"));
    if (contract.alwaysHumanCapabilityIds.includes(capability.id) && capability.tier === "unasked") {
      findings.push(finding("always-human-capability-set-unasked", capability.id, "this capability always needs the human -- it may not be declared \"unasked\""));
    }
  }

  for (const requiredId of contract.requiredCapabilityIds) {
    if (!seenIds.has(requiredId)) {
      findings.push(finding("missing-required-capability", requiredId, "every required capability id must be declared exactly once"));
    }
  }

  if (findings.some((item) => item.fatal)) return { verdict: "indeterminate", findings };
  return { verdict: findings.length > 0 ? "violated" : "satisfied", findings };
}

/**
 * Removes `<!-- ... -->` blocks by manual scanning rather than a regular
 * expression: a regex-based HTML-comment stripper is a known incomplete
 * pattern (flagged by CodeQL's bad-tag-filter query) even when, as here,
 * the result only feeds a word-list scan and is never rendered as HTML. An
 * unterminated `<!--` drops the remainder of the text rather than risk
 * treating unclosed maintainer prose as client-facing.
 */
function stripHtmlComments(text) {
  let result = "";
  let index = 0;
  for (;;) {
    const start = text.indexOf("<!--", index);
    if (start === -1) {
      result += text.slice(index);
      return result;
    }
    result += text.slice(index, start);
    const end = text.indexOf("-->", start + 4);
    if (end === -1) return result;
    index = end + 3;
  }
}

/**
 * Pure validator for client-facing text (#1225, #1226): no mention of
 * "Foundry" or retired vocabulary, outside an HTML comment aimed at a
 * maintainer rather than a client.
 */
export function evaluateClientFacingText({ text, label }) {
  const findings = [];
  if (typeof text !== "string") {
    return { findings: [finding("unreadable-client-facing-text", label, "the text must be a string", true)] };
  }
  const withoutComments = stripHtmlComments(text);
  for (const word of RETIRED_CLIENT_FACING_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(withoutComments)) {
      findings.push(finding("retired-client-facing-word", label, `client-facing text must not say "${word}"`));
    }
  }
  return { findings };
}

function die(message) {
  console.error(`check-permission-defaults: ${message}`);
  process.exit(2);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`could not read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function report({ verdict, summary, findings, nextAction }) {
  const envelope = {
    package: "foundry-permission-defaults-gate",
    version: "1.0.0",
    verdict,
    summary,
    findings: findings.map(toEnvelopeFinding),
    ...(nextAction ? { nextAction } : {}),
  };
  const envelopeFindings = validateCheckOutputEnvelope(envelope, "check-permission-defaults report");
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
  const contractPath = resolve(contractArg ?? join(repoRoot, "docs/contracts/permission-defaults-contract.json"));
  const contract = readJson(contractPath, "the permission-defaults contract");
  const contractResult = evaluatePermissionDefaultsContract({ contract });

  if (contractResult.findings.length > 0) {
    const fatal = contractResult.findings.some((item) => item.fatal);
    report({
      verdict: fatal ? "indeterminate" : "violated",
      summary: "The permission-defaults contract itself does not satisfy its own rule.",
      findings: contractResult.findings,
      nextAction: "Fix docs/contracts/permission-defaults-contract.json.",
    });
    process.exit(fatal ? 2 : 1);
  }

  const recordPath = resolve(recordArg ?? join(repoRoot, "docs/contracts/permission-defaults.fixture.json"));
  const record = readJson(recordPath, "the permission-defaults record");
  const recordResult = evaluatePermissionDefaultsRecord({ record, contract });
  const envelope = report({
    verdict: recordResult.verdict,
    summary: recordResult.verdict === "satisfied"
      ? "The permission-defaults record satisfies the contract."
      : "The permission-defaults record does not satisfy the contract.",
    findings: recordResult.findings,
    ...(recordResult.verdict !== "satisfied" ? { nextAction: `Fix the permission-defaults record at ${recordPath}.` } : {}),
  });
  if (envelope.verdict !== "satisfied") process.exit(envelope.verdict === "indeterminate" ? 2 : 1);

  const trustStatementPath = join(repoRoot, "docs/contracts/trust-statement.md");
  let trustStatementText;
  try {
    trustStatementText = readFileSync(trustStatementPath, "utf8");
  } catch (error) {
    die(`could not read the trust statement at ${trustStatementPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const textResult = evaluateClientFacingText({ text: trustStatementText, label: "docs/contracts/trust-statement.md" });
  const textEnvelope = report({
    verdict: textResult.findings.length > 0 ? "violated" : "satisfied",
    summary: textResult.findings.length > 0
      ? "docs/contracts/trust-statement.md uses retired client-facing vocabulary."
      : "docs/contracts/trust-statement.md uses only client vocabulary.",
    findings: textResult.findings,
    ...(textResult.findings.length > 0 ? { nextAction: "Rewrite the flagged text in docs/contracts/trust-statement.md using client vocabulary." } : {}),
  });
  if (textEnvelope.verdict !== "satisfied") process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
