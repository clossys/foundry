#!/usr/bin/env node
// check-role-loop-archetypes — keep the role-loop taxonomy complete,
// machine-readable, and closed-loop.
//
//   node scripts/check-role-loop-archetypes.mjs [roleContractPath] [programsContractPath]
//
// The role contract is deliberately a normalized declaration, not a claim
// that a package has adopted a loop in any particular consumer. Its grammar
// and archetypes make the control shape inspectable; the consumer supplies
// concrete subjects, setpoints, observations, and independent outcomes.
//
// Exit 0 = valid contract. Exit 1 = readable contract violates this taxonomy.
// Exit 2 = either input cannot be read or has an unusable structural shape.
// A malformed input must never be treated as an empty, passing declaration.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOOP_GRAMMAR = [
  "subjectOrAddressee",
  "authoritativeSetpoint",
  "actualObservation",
  "ternaryJudgment",
  "correctionOrHandoff",
  "independentOutcome",
  "cadenceAndCloseCondition",
];

export const ARCHETYPES = {
  "conformance-gate": ["load setpoint", "observe candidate", "judge", "block-or-allow", "sample outcomes", "revise setpoint"],
  reconciliation: ["declare desired", "observe actual", "diff", "correct-or-handoff", "reobserve", "close-on-zero-delta"],
  "actuation-provisioning": ["accept intent", "validate preconditions", "act", "confirm actual outcome", "compensate-retry-or-handoff", "close-on-observed-outcome"],
  "confirmation-interaction": ["receive actor/subject request", "authorize", "record intent", "act-or-refuse", "confirm/read-back", "reconcile change-or-withdrawal"],
  "custody-lifecycle": ["inventory", "justify", "protect", "disclose-or-correct", "dispose", "verify-disposal-or-reopen"],
  "observation-learning": ["declare coverage/question", "collect independent signals", "normalize", "measure", "report", "adjust-and-remeasure"],
};

export const ROLE_ARCHETYPES = {
  "@vespeneventures/controller": { primary: "reconciliation" },
  "@vespeneventures/inspector": { primary: "conformance-gate" },
  "@vespeneventures/builder": { primary: "actuation-provisioning", secondary: ["reconciliation"] },
  "@vespeneventures/locksmith": { primary: "custody-lifecycle" },
  "@vespeneventures/integrator": { primary: "reconciliation" },
  "@vespeneventures/observer": { primary: "observation-learning" },
  "@vespeneventures/strategist": { primary: "conformance-gate" },
  "@vespeneventures/writer": { primary: "conformance-gate" },
  "@vespeneventures/designer": { primary: "conformance-gate" },
  "@vespeneventures/publisher": { primary: "actuation-provisioning", secondary: ["reconciliation"] },
  "@vespeneventures/bouncer": { primary: "reconciliation", secondary: ["confirmation-interaction"] },
  "@vespeneventures/butler": { primary: "confirmation-interaction" },
  "@vespeneventures/giver": { primary: "actuation-provisioning", secondary: ["confirmation-interaction"] },
  "@vespeneventures/keeper": { primary: "custody-lifecycle" },
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameKeys(value, expected) {
  return sameArray(Object.keys(value).sort(), [...expected].sort());
}

function finding(rule, subject, message, fatal = false) {
  return { rule, subject, message, fatal };
}

/** Read role package names from exactly Programs A, B, and C, never donors. */
export function deriveRolePackages(programsContract) {
  if (!isRecord(programsContract) || !isRecord(programsContract.programs)) {
    return { packages: new Set(), findings: [finding("unreadable-package-programs", "docs/contracts/package-programs.json", "`programs` must be an object", true)] };
  }

  const packages = new Set();
  const findings = [];
  const requiredLetters = new Set(["A", "B", "C"]);
  const foundLetters = new Set();
  for (const [programId, program] of Object.entries(programsContract.programs)) {
    if (!isRecord(program) || typeof program.letter !== "string") {
      findings.push(finding("unreadable-package-programs", programId, "every program must be an object with a string `letter`", true));
      continue;
    }
    if (!requiredLetters.has(program.letter)) continue;
    if (!Array.isArray(program.packages)) {
      findings.push(finding("unreadable-package-programs", programId, `Program ${program.letter} must declare a packages array`, true));
      continue;
    }
    foundLetters.add(program.letter);
    for (const name of program.packages) {
      if (typeof name !== "string" || name.trim() === "") {
        findings.push(finding("unreadable-package-programs", programId, `Program ${program.letter} has a package name that is not a nonempty string`, true));
      } else if (packages.has(name)) {
        findings.push(finding("duplicate-program-role", name, "appears more than once across Programs A, B, and C", true));
      } else {
        packages.add(name);
      }
    }
  }
  for (const letter of requiredLetters) {
    if (!foundLetters.has(letter)) findings.push(finding("unreadable-package-programs", "docs/contracts/package-programs.json", `Program ${letter} is required to derive role coverage`, true));
  }
  if (packages.size === 0) findings.push(finding("unreadable-package-programs", "docs/contracts/package-programs.json", "Programs A, B, and C produced no role packages", true));
  return { packages, findings };
}

/** Pure validator so focused tests can exercise both data and the CLI separately. */
export function evaluateRoleLoopArchetypes({ contract, programsContract }) {
  const { packages: rolePackages, findings } = deriveRolePackages(programsContract);
  if (!isRecord(contract)) {
    return { findings: [...findings, finding("unreadable-role-loop-contract", "docs/contracts/role-loop-archetypes.json", "the contract must be an object", true)] };
  }
  if (!sameKeys(contract, ["schemaVersion", "loopGrammar", "archetypes", "roles"])) {
    findings.push(finding("unreadable-role-loop-contract", "docs/contracts/role-loop-archetypes.json", "the contract must contain exactly `schemaVersion`, `loopGrammar`, `archetypes`, and `roles`", true));
    return { findings };
  }
  if (contract.schemaVersion !== 1 || !Array.isArray(contract.loopGrammar) || !isRecord(contract.archetypes) || !isRecord(contract.roles)) {
    findings.push(finding("unreadable-role-loop-contract", "docs/contracts/role-loop-archetypes.json", "schema version 1 requires an array `loopGrammar` and object `archetypes` and `roles`", true));
    return { findings };
  }

  if (!sameArray(contract.loopGrammar, LOOP_GRAMMAR)) {
    findings.push(finding("loop-grammar-mismatch", "loopGrammar", `must be exactly: ${LOOP_GRAMMAR.join(", ")}`));
  }

  const expectedArchetypeNames = Object.keys(ARCHETYPES);
  if (!sameKeys(contract.archetypes, expectedArchetypeNames)) {
    findings.push(finding("archetype-coverage-mismatch", "archetypes", `must define exactly: ${expectedArchetypeNames.join(", ")}`));
  }
  for (const [name, expectedPhases] of Object.entries(ARCHETYPES)) {
    const archetype = contract.archetypes[name];
    if (!isRecord(archetype) || !sameKeys(archetype, ["purpose", "phases"]) || typeof archetype.purpose !== "string" || archetype.purpose.trim() === "" || !Array.isArray(archetype.phases)) {
      findings.push(finding("unreadable-archetype", name, "must contain exactly a nonempty string `purpose` and array `phases`", true));
      continue;
    }
    if (!sameArray(archetype.phases, expectedPhases)) {
      findings.push(finding("archetype-phases-mismatch", name, `phases must be exactly: ${expectedPhases.join(" -> ")}`));
    }
  }

  const roleNames = Object.keys(contract.roles);
  const missingRoles = [...rolePackages].filter((name) => !roleNames.includes(name));
  const extraRoles = roleNames.filter((name) => !rolePackages.has(name));
  if (missingRoles.length > 0 || extraRoles.length > 0) {
    findings.push(finding("role-coverage-mismatch", "roles", `must cover each Program A/B/C role once; missing: ${missingRoles.join(", ") || "none"}; unexpected: ${extraRoles.join(", ") || "none"}`));
  }

  const knownArchetypes = new Set(expectedArchetypeNames);
  for (const [role, declaration] of Object.entries(contract.roles)) {
    if (!isRecord(declaration) || ![1, 2].includes(Object.keys(declaration).length) || !Object.hasOwn(declaration, "primary") || Object.keys(declaration).some((key) => key !== "primary" && key !== "secondary")) {
      findings.push(finding("unreadable-role-declaration", role, "must contain `primary` and optional `secondary` only", true));
      continue;
    }
    if (!knownArchetypes.has(declaration.primary)) {
      findings.push(finding("invalid-primary-archetype", role, `primary must name one of: ${expectedArchetypeNames.join(", ")}`));
    }
    if (declaration.secondary !== undefined) {
      if (!Array.isArray(declaration.secondary)) {
        findings.push(finding("unreadable-secondary-archetypes", role, "secondary must be an array when present", true));
      } else {
        const duplicate = new Set(declaration.secondary).size !== declaration.secondary.length;
        if (declaration.secondary.some((name) => !knownArchetypes.has(name))) {
          findings.push(finding("invalid-secondary-archetype", role, "every secondary archetype must be declared"));
        }
        if (declaration.secondary.includes(declaration.primary)) {
          findings.push(finding("secondary-matches-primary", role, "secondary archetypes must be distinct from primary"));
        }
        if (duplicate) findings.push(finding("duplicate-secondary-archetype", role, "secondary archetypes may not repeat"));
      }
    }

    const expected = ROLE_ARCHETYPES[role];
    if (expected && declaration.primary !== expected.primary) {
      findings.push(finding("primary-mapping-mismatch", role, `primary must be ${expected.primary}`));
    }
    if (expected && !sameArray(declaration.secondary ?? [], expected.secondary ?? [])) {
      findings.push(finding("secondary-mapping-mismatch", role, `secondary must be ${expected.secondary?.join(", ") ?? "absent"}`));
    }
  }
  return { findings };
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
  const [roleContractArg, programsContractArg, ...extra] = process.argv.slice(2);
  if (extra.length > 0) die("accepts at most a role-loop contract path and package-programs contract path");
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const roleContractPath = resolve(roleContractArg ?? join(repoRoot, "docs/contracts/role-loop-archetypes.json"));
  const programsContractPath = resolve(programsContractArg ?? join(repoRoot, "docs/contracts/package-programs.json"));
  const { findings } = evaluateRoleLoopArchetypes({
    contract: readJson(roleContractPath, "the role-loop contract"),
    programsContract: readJson(programsContractPath, "the package-programs contract"),
  });

  for (const item of findings) console.log(`  FAIL  ${item.rule}  ${item.subject} — ${item.message}`);
  if (findings.length === 0) {
    console.log(`ROLE LOOP ARCHETYPES OK — ${Object.keys(ROLE_ARCHETYPES).length} role package(s) covered by one primary archetype.`);
    process.exit(0);
  }
  process.exit(findings.some((item) => item.fatal) ? 2 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
