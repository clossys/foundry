#!/usr/bin/env node
// check-package-framework — validates the extended `foundry` manifest block
// (docs/contracts/package-framework.json: `intake`, `outputs`, `status`,
// `fit`, `solves`, `needs`, `feeds`, alongside the existing `assessment`)
// and, separately, validates any check-output-envelope.json /
// role-assessment.json fixture a package declares
// (docs/contracts/check-output-envelope.json,
// docs/contracts/role-assessment.json — issue #1174).
//
//   node scripts/check-package-framework.mjs [--json] [--enforce] [<repoRoot>]
//
// REPORT MODE (default): prints a conformance table for every active role
// package and fails ONLY when a field a package DOES declare is malformed --
// wrong shape, an unmapped bin, a path that escapes the package directory or
// (for `outputs`/`feeds`) does not sit under the role's own
// `clossys/<role>/` folder, a declared-but-missing shipped file, or (for
// `solves`) a missing field, an out-of-enum `evidence` value, or a
// malformed `problem` id. Absence of `intake`, `outputs`, `status`, `fit`,
// `solves`, `needs`, or `feeds` is never a failure here and is always
// printed and counted, the same discipline check-role-assessment-surfaces.mjs
// already applies to `assessment` (issue #435: a capability requiring zero
// targets must not grade identically to one fully covered).
//
// --enforce: for a later wave, once packages have had the chance to conform
// (issue #1172's own sequencing). Turns every absence of `intake`,
// `outputs`, `status`, `fit`, `solves`, `needs`, or `feeds` on an active
// role into a finding too, and additionally checks (schema version 2,
// issue #1172's "De-risking additions to `solves`" comment):
//   - a `solves.metric` names this role's own owned metric
//     (docs/contracts/role-loop-archetypes.json);
//   - a `solves.proofCase` exists in this role's own qualification adapter
//     (governance/release-qualification-adapters/<role>/current-direct.json);
//   - a `solves.problem` id resolves against docs/contracts/client-problems.json,
//     once that file exists (it does not yet — #1176's Advisor lane owns it);
//   - two roles whose `solves` entries claim the same `problem` id (a
//     boundary decision, the #504/#505 class);
//   - a `needs` entry matches some role's `feeds` entry, and the resulting
//     needs/feeds handoff graph across every active role has no cycle.
// A `solves.statement` is NOT lint-checked against @clossys/writer's own
// voice checker here: `checkCopy()` needs a built `dist/` and a
// consumer-owned `VoiceRecord`, neither available to this dependency-free,
// pre-build gate (see the module doc on @clossys/writer's `./voice`
// subpath). TODO(#1172): wire this once a repository-level voice record and
// a post-build gate slot both exist. Until then this prints a report-mode
// warning, in both modes, rather than silently skipping it.
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

const EVIDENCE_LEVELS = Object.freeze(["designed", "qualified", "proven"]);
const PROBLEM_ID_FORMAT = /^[a-z][a-z0-9-]*$/;

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
  const {
    requiredRoles = [],
    enforce = false,
    readPackageFile = () => { throw new Error("no reader supplied"); },
    roleMetricByRole = new Map(),
    readAdapterCases = () => null,
    clientProblemIds = null,
  } = options;
  const required = new Set(requiredRoles);
  const findings = [];
  const warnings = [];
  const table = [];
  const solvesByRole = new Map();
  const needsByRole = new Map();
  const feedsByRole = new Map();

  for (const role of [...activeRoles].sort()) {
    const manifest = manifestsByName.get(role);
    const row = { role, assessment: "absent", intake: "absent", outputs: "absent", status: "absent", fit: "absent", solves: "absent", needs: "absent", feeds: "absent" };
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

    // solves: verifiable claims about which client problems this role solves.
    if (foundry.solves === undefined) {
      row.solves = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-solves-absent", role, message: "foundry.solves must declare which client problems this role solves (may be an empty array)" });
    } else if (!Array.isArray(foundry.solves)) {
      row.solves = "malformed";
      findings.push({ rule: "invalid-solves-declaration", role, message: "foundry.solves must be an array (may be empty)" });
    } else {
      const entryFindings = [];
      const problemIds = [];
      let hasStatement = false;
      for (const entry of foundry.solves) {
        if (!isRecord(entry) || !isText(entry.problem) || !isText(entry.statement) || !isText(entry.metric) || !isText(entry.proofCase) || !EVIDENCE_LEVELS.includes(entry.evidence)) {
          entryFindings.push({ rule: "invalid-solves-entry", role, message: `every solves entry must have problem, statement, metric, proofCase (nonempty strings) and evidence one of: ${EVIDENCE_LEVELS.join(", ")}` });
          continue;
        }
        hasStatement = true;
        if (!PROBLEM_ID_FORMAT.test(entry.problem)) {
          entryFindings.push({ rule: "invalid-solves-problem-id-format", role, message: `solves.problem "${entry.problem}" must be lowercase kebab-case (matching ${PROBLEM_ID_FORMAT})` });
          continue;
        }
        problemIds.push(entry.problem);
        if (enforce) {
          const ownedMetric = roleMetricByRole.get(role);
          if (ownedMetric !== undefined && entry.metric !== ownedMetric) {
            entryFindings.push({ rule: "solves-metric-mismatch", role, message: `solves entry for problem "${entry.problem}" names metric "${entry.metric}", but this role's own owned metric is "${ownedMetric}"` });
          }
          const cases = readAdapterCases(role);
          if (cases === null || !cases.includes(entry.proofCase)) {
            entryFindings.push({ rule: "solves-proof-case-missing", role, message: `solves entry for problem "${entry.problem}" names proofCase "${entry.proofCase}", which is not a case id in this role's own qualification adapter` });
          }
          if (clientProblemIds !== null && !clientProblemIds.includes(entry.problem)) {
            entryFindings.push({ rule: "solves-problem-id-unresolved", role, message: `solves.problem "${entry.problem}" is not a declared id in docs/contracts/client-problems.json` });
          }
        }
      }
      row.solves = entryFindings.length === 0 ? "declared" : "malformed";
      findings.push(...entryFindings);
      if (hasStatement) {
        warnings.push({ rule: "solves-statement-voice-lint-skipped", role, message: "TODO(#1172): statement not lint-checked against @clossys/writer's voice checker — checkCopy() needs a built dist/ and a consumer-owned VoiceRecord, neither available to this dependency-free, pre-build gate." });
      }
      solvesByRole.set(role, problemIds);
    }

    // needs: artifacts this role consumes from another role's own feeds.
    if (foundry.needs === undefined) {
      row.needs = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-needs-absent", role, message: "foundry.needs must declare artifacts this role consumes (may be an empty array)" });
    } else if (!Array.isArray(foundry.needs) || !foundry.needs.every((item) => isRecord(item) && isText(item.producerRole) && isText(item.artifact))) {
      row.needs = "malformed";
      findings.push({ rule: "invalid-needs-declaration", role, message: "foundry.needs must be an array of { producerRole, artifact } (may be empty)" });
    } else {
      row.needs = "declared";
      needsByRole.set(role, foundry.needs);
    }

    // feeds: artifacts this role produces for other roles, under its own clossys/<role>/ folder.
    if (foundry.feeds === undefined) {
      row.feeds = "absent";
      if (enforce && required.has(role) === false) findings.push({ rule: "required-feeds-absent", role, message: "foundry.feeds must declare artifacts this role produces (may be an empty array)" });
    } else if (!Array.isArray(foundry.feeds) || !foundry.feeds.every((item) => isRecord(item) && isText(item.artifact) && isText(item.path))) {
      row.feeds = "malformed";
      findings.push({ rule: "invalid-feeds-declaration", role, message: "foundry.feeds must be an array of { artifact, path } (may be empty)" });
    } else {
      const expectedPrefix = `clossys/${roleShortName(role)}/`;
      const outside = foundry.feeds.filter((item) => !isSafeRelativePath(item.path) || !item.path.startsWith(expectedPrefix));
      if (outside.length > 0) {
        row.feeds = "malformed";
        findings.push({ rule: "feeds-path-outside-role-folder", role, message: `every foundry.feeds path must start with "${expectedPrefix}" — found: ${outside.map((item) => item.path).join(", ")}` });
      } else {
        row.feeds = "declared";
        feedsByRole.set(role, foundry.feeds);
      }
    }

    table.push(row);
  }

  if (enforce) {
    for (const [role, needsList] of needsByRole) {
      for (const need of needsList) {
        const producerFeeds = feedsByRole.get(need.producerRole);
        const matched = producerFeeds !== undefined && producerFeeds.some((item) => item.artifact === need.artifact);
        if (!matched) {
          findings.push({ rule: "unmatched-need", role, message: `needs { producerRole: "${need.producerRole}", artifact: "${need.artifact}" } does not match any feeds entry declared by "${need.producerRole}"` });
        }
      }
    }
    const cycle = detectHandoffCycle(needsByRole);
    if (cycle) findings.push({ rule: "needs-graph-cycle", role: cycle[0], message: `the needs/feeds handoff graph has a cycle: ${cycle.join(" -> ")}` });

    const rolesByProblem = new Map();
    for (const [role, ids] of solvesByRole) {
      for (const id of ids) {
        if (!rolesByProblem.has(id)) rolesByProblem.set(id, []);
        rolesByProblem.get(id).push(role);
      }
    }
    for (const [id, roles] of rolesByProblem) {
      if (roles.length > 1) findings.push({ rule: "solves-problem-claimed-by-multiple-roles", path: id, message: `problem id "${id}" is claimed by multiple roles (${roles.join(", ")}) — needs a boundary decision` });
    }
    if (clientProblemIds !== null) {
      for (const id of clientProblemIds) {
        if (!rolesByProblem.has(id)) findings.push({ rule: "unclaimed-client-problem", path: id, message: `problem id "${id}" in docs/contracts/client-problems.json is claimed by no role's foundry.solves` });
      }
    }
  }

  return { findings, warnings, table };
}

/**
 * Three-color DFS cycle detection over the directed `role -> need.producerRole`
 * graph. Returns the cycle as an ordered array of roles (the repeated role
 * appears at both ends), or null when the graph is acyclic.
 */
function detectHandoffCycle(needsByRole) {
  const color = new Map();
  const stack = [];
  function visit(role) {
    color.set(role, 1);
    stack.push(role);
    for (const need of needsByRole.get(role) ?? []) {
      const next = need.producerRole;
      const state = color.get(next) ?? 0;
      if (state === 1) return stack.slice(stack.indexOf(next)).concat(next);
      if (state === 0 && needsByRole.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(role, 2);
    return null;
  }
  for (const role of needsByRole.keys()) {
    if ((color.get(role) ?? 0) === 0) {
      const found = visit(role);
      if (found) return found;
    }
  }
  return null;
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

/** docs/contracts/client-problems.json, when it exists. Owned by the Advisor lane (#1176); null (never a finding) until it lands. */
function readClientProblemIds(root) {
  const path = join(root, "docs/contracts/client-problems.json");
  if (!existsSync(path)) return null;
  try {
    const document = readJson(path);
    if (!isRecord(document) || !Array.isArray(document.problems)) return null;
    const ids = document.problems.filter((item) => isRecord(item) && isText(item.id)).map((item) => item.id);
    return ids.length === document.problems.length ? ids : null;
  } catch { return null; }
}

function collect(root) {
  const contractPath = join(root, "packages/controller/contracts/role-loop-archetypes.json");
  if (!existsSync(contractPath)) throw new Error(`role contract not found at ${contractPath}`);
  const contract = readJson(contractPath);
  if (!isRecord(contract) || !isRecord(contract.roles)) throw new Error("role contract declares no roles");
  const roleMetricByRole = new Map();
  for (const [role, definition] of Object.entries(contract.roles)) {
    const metricName = isRecord(definition) && isRecord(definition.metric) ? definition.metric.name : undefined;
    if (isText(metricName)) roleMetricByRole.set(role, metricName);
  }
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
  const readAdapterCases = (role) => {
    const adapterPath = join(root, "governance/release-qualification-adapters", roleShortName(role), "current-direct.json");
    if (!existsSync(adapterPath)) return null;
    try {
      const adapter = readJson(adapterPath);
      if (!isRecord(adapter) || !Array.isArray(adapter.cases)) return null;
      return adapter.cases.filter((item) => isRecord(item) && isText(item.id)).map((item) => item.id);
    } catch { return null; }
  };
  return {
    activeRoles: Object.keys(contract.roles),
    manifestsByName,
    requiredRoles: requiredRolesFromScope(root),
    readPackageFile,
    roleMetricByRole,
    readAdapterCases,
    clientProblemIds: readClientProblemIds(root),
  };
}

function printTable(table) {
  const header = ["role", "assessment", "intake", "outputs", "status", "fit", "solves", "needs", "feeds"];
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
  const result = evaluatePackageFramework(collected.activeRoles, collected.manifestsByName, {
    requiredRoles: collected.requiredRoles,
    enforce,
    readPackageFile: collected.readPackageFile,
    roleMetricByRole: collected.roleMetricByRole,
    readAdapterCases: collected.readAdapterCases,
    clientProblemIds: collected.clientProblemIds,
  });
  if (json) { console.log(JSON.stringify(result, null, 2)); return result.findings.length === 0 ? 0 : 1; }
  printTable(result.table);
  for (const item of result.findings) console.log(`FAIL ${item.rule} ${item.role ?? item.path} — ${item.message}`);
  for (const item of result.warnings) console.log(`WARN ${item.rule} ${item.role ?? item.path} — ${item.message}`);
  const declaredCounts = ["intake", "outputs", "status", "fit", "solves", "needs", "feeds"].map((field) => `${field}: ${result.table.filter((row) => row[field] === "declared").length}/${result.table.length}`);
  console.log(`\n${declaredCounts.join(", ")} active role(s) declare each field.`);
  console.log(collected.clientProblemIds === null ? "docs/contracts/client-problems.json does not exist yet (#1176) — solves.problem is validated by id format only." : `docs/contracts/client-problems.json declares ${collected.clientProblemIds.length} problem id(s).`);
  console.log(enforce ? "Running with --enforce: absence of a field, and the deeper solves/needs/feeds checks, are findings." : "Report mode: absence of a field is printed and counted, never a failure. Pass --enforce for the enforcing mode.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
