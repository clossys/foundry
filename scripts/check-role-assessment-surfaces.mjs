#!/usr/bin/env node
// check-role-assessment-surfaces — every role that CLAIMS a first-day
// assessment entry point must actually have one, every role that does not
// claim one must be counted rather than quietly passed over, and Advisor
// (the engagement-gate role) must declare one.
//
//   node scripts/check-role-assessment-surfaces.mjs [--json] [<repoRoot>]
//
// Exit 0 = every declaration present resolves against its own manifest, and
//          every required first-day role (Advisor) has a valid declaration.
// Exit 1 = at least one declaration is malformed or names a bin the manifest
//          does not map, or a required first-day role has no declaration.
// Exit 2 = the question could not be answered.
//
// WHY THIS EXISTS
// ---------------
// `@clossys/controller/onboarding` discovers a role's assessment by reading
// that role's OWN manifest declaration:
//
//   "foundry": { "assessment": { "bin": "<binName>", "invocation": "single-json-input" } }
//
// It deliberately never infers one. A role that ships five gate CLIs and
// declares none has no assessment surface, because choosing which of the five
// "is the assessment" would be the orchestration deciding what a role's
// assessment is — the one thing it must not do.
//
// That design has a failure mode this gate closes: a declaration that names a
// bin the manifest does not map, or an invocation kind nothing implements,
// reads as a working surface to everyone except the discovery code, which
// silently returns an absence. The consumer then sees "this role has no
// assessment surface" for a role whose author believed they had wired one.
//
// The second half is the part that is easy to leave out. Roles with NO
// declaration are not a failure — most have none today — but they are also
// not nothing. A capability requiring zero targets must not grade identically
// to one fully covered (issue #435), so this gate always PRINTS the
// undeclared roles and their count, in both text and --json modes, whatever
// its exit code. A number that is allowed to stay invisible is a number that
// is allowed to stay wrong.
//
// Advisor is the exception that is a failure. It is the engagement-gate
// role: a first-wave consumer opens it before any operating position, and
// controller onboarding discovers its assessment only from foundry.assessment.
// An undeclared Advisor is therefore a missing first-day surface for the
// one role that must have one, not a counted gap. Other roles stay counted.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_INVOCATIONS = ["single-json-input"];
// Directory names under packages/, joined with package-scope.json at
// collect() time. The scope is never hardcoded here.
const REQUIRED_ASSESSMENT_DIRECTORIES = ["advisor"];
const scriptDir = dirname(fileURLToPath(import.meta.url));

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }

/** Pure evaluation over already-read manifests, so the regression test needs no repository on disk. */
export function evaluateRoleAssessmentSurfaces(activeRoles, manifestsByName, requiredRoles = []) {
  const findings = [];
  const declared = [];
  const undeclared = [];
  const required = new Set(requiredRoles);
  for (const role of [...activeRoles].sort()) {
    const manifest = manifestsByName.get(role);
    if (manifest === undefined) {
      if (required.has(role)) {
        findings.push({ rule: "required-assessment-undeclared", role, message: "this first-day role must declare foundry.assessment against a mapped bin; orchestration never infers one" });
      } else {
        undeclared.push({ role, reason: "no package in this repository ships this role" });
      }
      continue;
    }
    const foundry = manifest.foundry;
    const declaration = isRecord(foundry) ? foundry.assessment : undefined;
    if (declaration === undefined) {
      if (required.has(role)) {
        findings.push({ rule: "required-assessment-undeclared", role, message: "this first-day role must declare foundry.assessment against a mapped bin; orchestration never infers one" });
      } else {
        undeclared.push({ role, reason: "no foundry.assessment declaration" });
      }
      continue;
    }
    if (!isRecord(declaration) || !isText(declaration.bin) || !SUPPORTED_INVOCATIONS.includes(declaration.invocation)) {
      findings.push({ rule: "invalid-assessment-declaration", role, message: `foundry.assessment must be { bin, invocation } with invocation one of: ${SUPPORTED_INVOCATIONS.join(", ")}` });
      continue;
    }
    const target = isRecord(manifest.bin) ? manifest.bin[declaration.bin] : undefined;
    if (!isText(target)) {
      findings.push({ rule: "undeclared-assessment-bin", role, message: `foundry.assessment.bin "${declaration.bin}" is not mapped in this package's own bin field` });
      continue;
    }
    if (isAbsolute(target) || target.split("/").includes("..")) {
      findings.push({ rule: "escaping-assessment-bin", role, message: `the bin target for "${declaration.bin}" must stay inside the package directory` });
      continue;
    }
    declared.push({ role, bin: declaration.bin, invocation: declaration.invocation, target });
  }
  return { findings, declared, undeclared };
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

function collect(root) {
  const contractPath = join(root, "packages/controller/contracts/role-loop-archetypes.json");
  if (!existsSync(contractPath)) throw new Error(`role contract not found at ${contractPath}`);
  const contract = readJson(contractPath);
  if (!isRecord(contract) || !isRecord(contract.roles)) throw new Error("role contract declares no roles");
  const manifestsByName = new Map();
  const packagesDir = join(root, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (isRecord(manifest) && isText(manifest.name)) manifestsByName.set(manifest.name, manifest);
  }
  return { activeRoles: Object.keys(contract.roles), manifestsByName, requiredRoles: requiredRolesFromScope(root) };
}

function requiredRolesFromScope(root) {
  const scopePath = join(root, "package-scope.json");
  if (!existsSync(scopePath)) throw new Error(`package-scope.json not found at ${scopePath}`);
  const doc = readJson(scopePath);
  if (!isRecord(doc) || !isText(doc.scope)) throw new Error("package-scope.json declares no scope");
  return REQUIRED_ASSESSMENT_DIRECTORIES.map((dir) => `${doc.scope}/${dir}`);
}

function main(argv) {
  const json = argv.includes("--json");
  const root = argv.find((value) => !value.startsWith("--")) ?? join(scriptDir, "..");
  let collected;
  try { collected = collect(root); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-role-assessment-surfaces: ${message}`);
    return 2;
  }
  const result = evaluateRoleAssessmentSurfaces(collected.activeRoles, collected.manifestsByName, collected.requiredRoles);
  if (json) { console.log(JSON.stringify(result, null, 2)); return result.findings.length === 0 ? 0 : 1; }
  for (const item of result.declared) console.log(`DECLARED ${item.role} -> ${item.bin} (${item.invocation})`);
  for (const item of result.undeclared) console.log(`NO ASSESSMENT SURFACE ${item.role} — ${item.reason}`);
  for (const item of result.findings) console.log(`FAIL ${item.rule} ${item.role} — ${item.message}`);
  console.log(`\n${result.declared.length} of ${collected.activeRoles.length} active role(s) declare a first-day assessment surface; ${result.undeclared.length} declare none.`);
  console.log("A role with no declared surface is reported by the onboarding workflow as a determinate gap, never skipped.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
