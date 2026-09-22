#!/usr/bin/env node
// check-package-framework — validates the extended `foundry` manifest block
// (docs/contracts/package-framework.json: `intake`, `outputs`, `status`,
// `fit`, alongside the existing `assessment`) and, separately, validates any
// check-output-envelope.json / role-assessment.json fixture a package
// declares (docs/contracts/check-output-envelope.json,
// docs/contracts/role-assessment.json — issue #1174).
//
//   node scripts/check-package-framework.mjs [--json] [--enforce] [<repoRoot>]
//
// REPORT MODE (default): prints a conformance table for every active role
// package and fails ONLY when a field a package DOES declare is malformed --
// wrong shape, an unmapped bin, a path that escapes the package directory or
// (for `outputs`) does not sit under the role's own `clossys/<role>/`
// folder, or a declared-but-missing shipped file. Absence of `intake`,
// `outputs`, `status`, or `fit` is never a failure here and is always
// printed and counted, the same discipline check-role-assessment-surfaces.mjs
// already applies to `assessment` (issue #435: a capability requiring zero
// targets must not grade identically to one fully covered).
//
// --enforce: for a later wave, once packages have had the chance to conform
// (issue #1172's own sequencing). Turns every absence of `intake`,
// `outputs`, `status`, or `fit` on an active role into a finding too.
//
// Exit 0 = no findings for the mode in effect. Exit 1 = at least one
// finding. Exit 2 = the question could not be answered (unreadable role
// contract, unreadable package-scope.json, unreadable workspace).
//
// This gate is manifest- and fixture-read only: no build, no install, no
// child process. It belongs in check:gates (dependency-free) alongside
// check-role-assessment-surfaces.mjs.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }
function isNonEmptyArray(value) { return Array.isArray(value) && value.length > 0; }

/** A package-relative path that stays inside the package directory: no leading '/', no '..' segment. */
function isSafeRelativePath(value) {
  if (!isText(value) || isAbsolute(value)) return false;
  return !value.split("/").includes("..");
}

const roleShortName = (role) => role.split("/").pop();

/**
 * Validates a `{ bin, invocation }` declaration (shared shape of `assessment`
 * and `status`) against the manifest's own `bin` map. Returns a finding rule
 * or null.
 */
function invalidBinDeclarationRule(declaration, manifest, fieldName) {
  if (!isRecord(declaration) || Object.keys(declaration).sort().join("\u0000") !== ["bin", "invocation"].join("\u0000") || !isText(declaration.bin) || declaration.invocation !== "single-json-input") {
    return `invalid-${fieldName}-declaration`;
  }
  const target = isRecord(manifest.bin) ? manifest.bin[declaration.bin] : undefined;
  if (!isText(target)) return `undeclared-${fieldName}-bin`;
  if (isAbsolute(target) || target.split("/").includes("..")) return `escaping-${fieldName}-bin`;
  return null;
}

/**
 * Pure evaluation over already-read manifests -- no filesystem access beyond
 * what the caller-supplied `manifestsByName` already carries, plus an
 * injected `readPackageFile(role, relativePath)` used only to check that a
 * declared `intake`/`fit` file actually exists and, when it parses as JSON,
 * to validate its shape. `readPackageFile` throws (or the caller passes one
 * that always throws) when nothing needs to be read from disk, which keeps
 * this function testable without a real repository tree — the same seam
 * `AssessmentInvoker` uses in packages/controller/src/onboarding/invoke.ts.
 */
export function evaluatePackageFramework(activeRoles, manifestsByName, options = {}) {
  const { requiredRoles = [], enforce = false, readPackageFile = () => { throw new Error("no reader supplied"); } } = options;
  const required = new Set(requiredRoles);
  const findings = [];
  const table = [];

  for (const role of [...activeRoles].sort()) {
    const manifest = manifestsByName.get(role);
    const row = { role, assessment: "absent", intake: "absent", outputs: "absent", status: "absent", fit: "absent" };
    if (manifest === undefined) {
      table.push(row);
      continue;
    }
    const foundry = isRecord(manifest.foundry) ? manifest.foundry : {};
    row.assessment = foundry.assessment === undefined ? "absent" : "declared";

    // intake: a package-relative path to one shipped JSON file.
    if (foundry.intake === undefined) {
      row.intake = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-intake-absent", role, message: "foundry.intake must name a shipped question-card file" });
    } else if (!isSafeRelativePath(foundry.intake)) {
      row.intake = "malformed";
      findings.push({ rule: "invalid-intake-declaration", role, message: "foundry.intake must be a package-relative path with no leading '/' and no '..' segment" });
    } else {
      const content = safeRead(readPackageFile, role, foundry.intake);
      if (content.missing) {
        row.intake = "malformed";
        findings.push({ rule: "intake-file-missing", role, message: `foundry.intake names "${foundry.intake}", which this package does not ship` });
      } else {
        const cardFindings = validateIntakeCardsShape(content.value, role);
        row.intake = cardFindings.length === 0 ? "declared" : "malformed";
        findings.push(...cardFindings);
      }
    }

    // outputs: a non-empty array of paths, all under clossys/<role>/.
    if (foundry.outputs === undefined) {
      row.outputs = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-outputs-absent", role, message: "foundry.outputs must declare this role's owned output paths" });
    } else if (!isNonEmptyArray(foundry.outputs) || !foundry.outputs.every((path) => typeof path === "string")) {
      row.outputs = "malformed";
      findings.push({ rule: "invalid-outputs-declaration", role, message: "foundry.outputs must be a non-empty array of path strings" });
    } else {
      const expectedPrefix = `clossys/${roleShortName(role)}/`;
      const outside = foundry.outputs.filter((path) => !isSafeRelativePath(path) || !path.startsWith(expectedPrefix));
      if (outside.length > 0) {
        row.outputs = "malformed";
        findings.push({ rule: "output-path-outside-role-folder", role, message: `every foundry.outputs path must start with "${expectedPrefix}" — found: ${outside.join(", ")}` });
      } else {
        row.outputs = "declared";
      }
    }

    // status: a { bin, invocation } read-only probe, same shape as assessment.
    if (foundry.status === undefined) {
      row.status = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-status-absent", role, message: "foundry.status must declare a read-only status probe" });
    } else {
      const rule = invalidBinDeclarationRule(foundry.status, manifest, "status");
      if (rule) { row.status = "malformed"; findings.push({ rule, role, message: `foundry.status ${rule.startsWith("invalid") ? "must be { bin, invocation: \"single-json-input\" }" : rule.startsWith("undeclared") ? "names a bin this package's own bin field does not map" : "names a bin target that escapes the package directory"}` }); }
      else row.status = "declared";
    }

    // fit: a package-relative path to one shipped JSON file.
    if (foundry.fit === undefined) {
      row.fit = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-fit-absent", role, message: "foundry.fit must name a shipped fit-signal declarations file" });
    } else if (!isSafeRelativePath(foundry.fit)) {
      row.fit = "malformed";
      findings.push({ rule: "invalid-fit-declaration", role, message: "foundry.fit must be a package-relative path with no leading '/' and no '..' segment" });
    } else {
      const content = safeRead(readPackageFile, role, foundry.fit);
      if (content.missing) {
        row.fit = "malformed";
        findings.push({ rule: "fit-file-missing", role, message: `foundry.fit names "${foundry.fit}", which this package does not ship` });
      } else {
        const signalFindings = validateFitSignalsShape(content.value, role);
        row.fit = signalFindings.length === 0 ? "declared" : "malformed";
        findings.push(...signalFindings);
      }
    }

    table.push(row);
  }

  return { findings, table };
}

function safeRead(readPackageFile, role, relativePath) {
  try { return { missing: false, value: JSON.parse(readPackageFile(role, relativePath)) }; }
  catch (error) { return error instanceof SyntaxError ? { missing: false, value: undefined, unparseable: true } : { missing: true }; }
}

/** docs/contracts/intake-question-cards.json, as a shape check. */
export function validateIntakeCardsShape(document, role) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, role, message });
  if (!isRecord(document) || document.schemaVersion !== 1 || !isNonEmptyArray(document.cards)) {
    fail("invalid-intake-cards-file", "must be { schemaVersion: 1, role, cards: [...] } with at least one card");
    return findings;
  }
  for (const card of document.cards) {
    if (!isRecord(card) || !isText(card.id) || !isText(card.prompt) || !isText(card.somethingElseFollowUp) || !Array.isArray(card.choices) || card.choices.length < 2) {
      fail("invalid-intake-card", `card is missing a required field or has fewer than two choices`);
      continue;
    }
    if (!card.choices.every((choice) => isRecord(choice) && isText(choice.id) && isText(choice.label))) {
      fail("invalid-intake-card-choice", `card "${card.id}" has a choice missing an id or label`);
      continue;
    }
    if (card.recommendedChoiceId !== card.choices[0].id) {
      fail("intake-card-recommendation-not-first", `card "${card.id}" must list its recommendedChoiceId as choices[0]`);
    }
  }
  return findings;
}

/** docs/contracts/fit-signal-declarations.json, as a shape check. */
export function validateFitSignalsShape(document, role) {
  const findings = [];
  const validKinds = new Set(["repository-structure", "declared-fact", "consumer-answer", "external-observation"]);
  if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.signals)) {
    findings.push({ rule: "invalid-fit-signals-file", role, message: "must be { schemaVersion: 1, role, signals: [...] } (signals may be empty)" });
    return findings;
  }
  for (const signal of document.signals) {
    if (!isRecord(signal) || !isText(signal.id) || !isText(signal.prompt) || !validKinds.has(signal.evidenceKind)) {
      findings.push({ rule: "invalid-fit-signal", role, message: `signal "${signal && signal.id}" must have an id, a prompt, and evidenceKind one of: ${[...validKinds].join(", ")}` });
    }
  }
  return findings;
}

/** docs/contracts/check-output-envelope.json, as a shape check. */
export function validateCheckOutputEnvelope(document, label) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, path: label, message });
  if (!isRecord(document)) { fail("invalid-envelope", "must be a JSON object"); return findings; }
  if (!isText(document.package)) fail("invalid-envelope-package", "package must be a nonempty string");
  if (!isText(document.version)) fail("invalid-envelope-version", "version must be a nonempty string");
  if (!["satisfied", "violated", "indeterminate"].includes(document.verdict)) fail("invalid-envelope-verdict", "verdict must be satisfied, violated, or indeterminate");
  if (!isText(document.summary) || document.summary.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1) fail("invalid-envelope-summary", "summary must be exactly one plain-language sentence");
  if (!Array.isArray(document.findings)) fail("invalid-envelope-findings", "findings must be an array");
  else if (document.verdict !== "satisfied" && document.findings.length === 0) fail("envelope-findings-empty-for-non-satisfied-verdict", "a non-satisfied verdict must carry at least one finding");
  return findings;
}

/** docs/contracts/role-assessment.json, as a shape check. */
export function validateRoleAssessmentDocument(document, label) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, path: label, message });
  const required = ["schemaVersion", "package", "version", "role", "asOf", "baseline", "target", "gaps", "unknowns", "criticalPath", "authority", "proposedPositions"];
  if (!isRecord(document)) { fail("invalid-role-assessment", "must be a JSON object"); return findings; }
  for (const field of required) {
    if (!(field in document)) fail("role-assessment-field-missing", `missing required field "${field}"`);
  }
  if (document.gaps !== undefined && !Array.isArray(document.gaps)) fail("invalid-role-assessment-gaps", "gaps must be an array (may be empty)");
  if (document.unknowns !== undefined && !Array.isArray(document.unknowns)) fail("invalid-role-assessment-unknowns", "unknowns must be an array (may be empty)");
  if (document.proposedPositions !== undefined && !Array.isArray(document.proposedPositions)) fail("invalid-role-assessment-proposed-positions", "proposedPositions must be an array");
  return findings;
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

function requiredRolesFromScope(root) {
  const scopePath = join(root, "package-scope.json");
  if (!existsSync(scopePath)) throw new Error(`package-scope.json not found at ${scopePath}`);
  const doc = readJson(scopePath);
  if (!isRecord(doc) || !isText(doc.scope)) throw new Error("package-scope.json declares no scope");
  return [];
}

function collect(root) {
  const contractPath = join(root, "packages/controller/contracts/role-loop-archetypes.json");
  if (!existsSync(contractPath)) throw new Error(`role contract not found at ${contractPath}`);
  const contract = readJson(contractPath);
  if (!isRecord(contract) || !isRecord(contract.roles)) throw new Error("role contract declares no roles");
  const manifestsByName = new Map();
  const packageDirByName = new Map();
  const packagesDir = join(root, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (isRecord(manifest) && isText(manifest.name)) {
      manifestsByName.set(manifest.name, manifest);
      packageDirByName.set(manifest.name, join(packagesDir, entry.name));
    }
  }
  const readPackageFile = (role, relativePath) => {
    const dir = packageDirByName.get(role);
    if (dir === undefined) throw new Error(`no package directory for ${role}`);
    return readFileSync(join(dir, relativePath), "utf8");
  };
  return { activeRoles: Object.keys(contract.roles), manifestsByName, requiredRoles: requiredRolesFromScope(root), readPackageFile };
}

function printTable(table) {
  const header = ["role", "assessment", "intake", "outputs", "status", "fit"];
  console.log(header.join("  |  "));
  for (const row of table) console.log(header.map((key) => row[key]).join("  |  "));
}

function main(argv) {
  const json = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const root = argv.find((value) => !value.startsWith("--")) ?? join(scriptDir, "..");
  let collected;
  try { collected = collect(root); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-package-framework: ${message}`);
    return 2;
  }
  const result = evaluatePackageFramework(collected.activeRoles, collected.manifestsByName, { requiredRoles: collected.requiredRoles, enforce, readPackageFile: collected.readPackageFile });
  if (json) { console.log(JSON.stringify(result, null, 2)); return result.findings.length === 0 ? 0 : 1; }
  printTable(result.table);
  for (const item of result.findings) console.log(`FAIL ${item.rule} ${item.role ?? item.path} — ${item.message}`);
  const declaredCounts = ["intake", "outputs", "status", "fit"].map((field) => `${field}: ${result.table.filter((row) => row[field] === "declared").length}/${result.table.length}`);
  console.log(`\n${declaredCounts.join(", ")} active role(s) declare each field.`);
  console.log(enforce ? "Running with --enforce: absence of a field on an active role is a finding." : "Report mode: absence of a field is printed and counted, never a failure. Pass --enforce for the enforcing mode.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
