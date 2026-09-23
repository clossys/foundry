#!/usr/bin/env node
// check-capability-maps — validates the `foundry.capabilities` manifest
// field (docs/contracts/package-framework.json version 3, issue #1196): a
// MECE (mutually exclusive, collectively exhaustive) definition of each
// role's craft.
//
//   node scripts/check-capability-maps.mjs [--json] [--enforce] [--allowlist <file>] [<repoRoot>]
//
// REPORT MODE (default): prints a conformance table for every active role
// package and fails ONLY when a role's own declared `capabilities` is
// malformed -- a missing or wrong-typed field on one entry, an id repeated
// within the same role, an output path outside the role's own
// `clossys/<role>/` folder, a `proofCase` that is non-null while `maturity`
// is `planned` (or null while `maturity` is `built`/`partial`), a
// `proofCase` that does not name a case in this role's own retained
// qualification adapter (governance/release-qualification-adapters/<role>/
// current-direct.json, when that file exists), or two capabilities in the
// SAME role's own array claiming the same output path. Absence of
// `capabilities` is never a failure here, the same discipline
// check-package-framework.mjs already applies to
// `intake`/`outputs`/`status`/`fit`/`solves`/`needs`/`feeds` (issue #435: a
// capability requiring zero targets must not grade identically to one fully
// covered).
//
// CAPABILITY-INPUT RESOLUTION runs in BOTH modes, not just --enforce: every
// capability's own `inputs` entry -- `{ producerRole, artifact }` -- must
// name a capability whose own `id` is `artifact`, declared among
// `producerRole`'s own well-formed `capabilities`, whenever `producerRole`
// itself has a declared map. A `producerRole` that is itself allowlisted
// (its own map has not landed yet) is forgiven, the same way absence is
// forgiven for that role directly -- a consuming role cannot be blamed for
// a producer that hasn't drafted yet. This runs unconditionally (not only
// under --enforce) because CI's default check runs in report mode, and an
// unresolved input is exactly the kind of structural defect report mode
// already catches for everything else a role's own manifest can answer by
// itself plus one already-declared producer -- it needs no global
// "is every role finished" judgment the way the cross-role checks below
// do.
//
// --enforce: for a later wave, once the per-role maps (#1198-#1202) have
// landed for every active role. Turns absence of `capabilities` on an
// active role into a finding, and additionally checks the two MECE
// properties that need EVERY role's own manifest to answer at once (unlike
// input resolution above, which only needs the one named producer):
//   - ACROSS roles: no output path is claimed by more than one capability,
//     of any role -- every capability and every output has exactly one
//     owner;
//   - ACROSS roles: every top-level `feeds` entry's path is claimed by
//     exactly one capability's own `outputs` (the mechanism behind "every
//     needs is fed by exactly one capability" -- a top-level `needs` entry
//     already resolves to one `feeds` entry under
//     check-package-framework.mjs's own --enforce; this pushes that
//     resolution one level further, to the one capability that actually
//     produces it). This is a SEPARATE mechanism from capability-input
//     resolution above: a capability's own `inputs` entry resolves
//     directly against a producer's capability `id`, never against a
//     top-level `feeds` path.
// --allowlist <file> (or --no-allowlist, the default when omitted): a
// JSON array of role names exempt from the "capabilities required" finding
// under --enforce, AND from unresolved-input findings that name them as
// `producerRole` in either mode -- for roles whose own map has not landed
// yet. Until #1198-#1202 land, every active role is effectively
// allowlisted by the absence-is-never-a-failure rule already in report
// mode; --allowlist only matters once some roles have adopted and
// --enforce is turned on for the rest.
//
// A capability's own `inputs` MAY form a cycle with another role's own
// `inputs` (for example Customer's `keep-verdict` needing Publisher's
// `surface-documents`, while Publisher's `sealing-and-the-publication-
// record` needs Customer's `keep-verdict` back) -- a real production
// workflow (judge a draft surface, seal only after a keep), not a defect.
// This gate does not check for cycles at the capability-input layer, and
// deliberately: the no-cycle rule check-package-framework.mjs enforces is
// scoped to the TOP-LEVEL `needs`/`feeds` handoff graph (issue #1172,
// Stage C), never to capability-level `inputs`.
//
// WHOLE-ROLE-QUESTION COVERAGE IS NOT CHECKED HERE. "The sub-questions
// jointly answer the role's job question" is a judgment call -- whether a
// declared set of sub-questions is actually complete cannot be decided by
// string comparison, the same reason check-package-framework.mjs does not
// lint-check `solves.statement` against a voice record. This gate DOES
// check the one structural proxy that IS mechanical: two capabilities in
// the same role must not declare the identical subQuestion (an exact
// duplicate cannot be jointly exhaustive of anything). The completeness
// judgment itself is the role package's own, made when the map is
// authored and reviewed -- this gate reports how many capabilities a role
// declares and leaves the judgment to the reviewer, the same way it
// reports `maturity` without judging whether the split is honest.
//
// Exit 0 = no findings for the mode in effect. Exit 1 = at least one
// finding. Exit 2 = the question could not be answered (unreadable role
// contract, unreadable workspace).
//
// This gate is manifest-read only: no build, no install, no child process.
// Resolving `proofCase` reads this role's own retained qualification
// adapter file (a small, already-committed governance JSON document, the
// same kind of read scripts/check-qualification-record-required.mjs
// already does) -- never a build, an install, or a child process. It
// belongs in check:gates (dependency-free) alongside
// check-package-framework.mjs, kept separate from it because the MECE
// checks here (cross-role output ownership, needs/capability-output
// matching, capability-input resolution) are their own concern, the same
// way check-role-assessment-surfaces.mjs is kept separate from
// check-package-framework.mjs.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const BUSINESS_LIFECYCLE_STAGES = Object.freeze([
  "found",
  "define",
  "build",
  "launch",
  "acquire",
  "convert",
  "deliver",
  "operate",
  "learn",
]);

export const CAPABILITY_MATURITIES = Object.freeze(["built", "partial", "planned"]);

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value) { return typeof value === "string" && value.trim() !== ""; }
function isNonEmptyArray(value) { return Array.isArray(value) && value.length > 0; }
function isSafeRelativePath(value) {
  if (!isText(value) || isAbsolute(value)) return false;
  return !value.split("/").includes("..");
}
const roleShortName = (role) => role.split("/").pop();

function isCapabilityInputEntry(value) {
  return isRecord(value) && isText(value.producerRole) && isText(value.artifact);
}

/**
 * Validates one `foundry.capabilities[]` entry's own shape. Pure -- no
 * cross-role, no cross-capability knowledge; that is `evaluateCapabilityMaps`'s
 * job, once every role's shape has already been read. `knownProofCaseIds`
 * (optional `Set<string>`) is this role's own retained qualification
 * adapter's case ids -- pass it to also check that a non-null `proofCase`
 * actually resolves; omit it (as every existing caller that doesn't care
 * about resolution does) to skip that one check and keep this function
 * usable with a hand-built fixture that names no real adapter.
 */
export function validateCapabilityShape(capability, role, knownProofCaseIds) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, role, message });
  if (!isRecord(capability)) { fail("invalid-capability", "must be an object"); return findings; }
  if (!isText(capability.id)) fail("invalid-capability-id", "capability.id must be a nonempty string");
  if (!isText(capability.subQuestion)) fail("invalid-capability-sub-question", `capability "${capability.id}" subQuestion must be a nonempty string`);
  if (!isText(capability.worldClass)) fail("invalid-capability-world-class", `capability "${capability.id}" worldClass must be a nonempty string`);
  if (!Array.isArray(capability.inputs) || !capability.inputs.every(isCapabilityInputEntry)) {
    fail("invalid-capability-inputs", `capability "${capability.id}" inputs must be an array of { producerRole, artifact } (may be empty)`);
  }
  const expectedPrefix = `clossys/${roleShortName(role)}/`;
  if (!isNonEmptyArray(capability.outputs) || !capability.outputs.every((path) => typeof path === "string")) {
    fail("invalid-capability-outputs", `capability "${capability.id}" outputs must be a non-empty array of path strings`);
  } else {
    const outside = capability.outputs.filter((path) => !isSafeRelativePath(path) || !path.startsWith(expectedPrefix));
    if (outside.length > 0) fail("capability-output-outside-role-folder", `capability "${capability.id}" every output must start with "${expectedPrefix}" — found: ${outside.join(", ")}`);
  }
  const maturityIsPlanned = capability.maturity === "planned";
  if (typeof capability.maturity !== "string" || !CAPABILITY_MATURITIES.includes(capability.maturity)) {
    fail("invalid-capability-maturity", `capability "${capability.id}" maturity must be one of: ${CAPABILITY_MATURITIES.join(", ")}`);
  }
  // proofCase and maturity are a joint field (issue #1258's independent
  // review): a capability that is not yet real has nothing a qualification
  // case could prove, so `planned` MUST carry `proofCase: null`; `built`
  // and `partial` (everything else, including an invalid maturity value)
  // MUST carry a real, nonempty proofCase string. This is stricter than
  // "some string" -- a `built`/`partial` capability with no dedicated case
  // yet is not yet evidenced and should not claim `built`/`partial` until
  // it has one.
  if (maturityIsPlanned) {
    if (capability.proofCase !== null) {
      fail("invalid-capability-proof-case", `capability "${capability.id}" proofCase must be null — maturity is "planned", and a planned capability has no case that proves it works yet`);
    }
  } else if (!isText(capability.proofCase)) {
    fail("invalid-capability-proof-case", `capability "${capability.id}" proofCase must be a nonempty string when maturity is "built" or "partial"`);
  } else if (knownProofCaseIds !== undefined && !knownProofCaseIds.has(capability.proofCase)) {
    fail("unresolved-capability-proof-case", `capability "${capability.id}" proofCase "${capability.proofCase}" is not a case id in this role's own retained qualification adapter`);
  }
  if (typeof capability.v0 !== "boolean") fail("invalid-capability-v0", `capability "${capability.id}" v0 must be a boolean`);
  if (capability.businessLifecycleStage !== undefined && !BUSINESS_LIFECYCLE_STAGES.includes(capability.businessLifecycleStage)) {
    fail("invalid-capability-business-lifecycle-stage", `capability "${capability.id}" businessLifecycleStage must be one of: ${BUSINESS_LIFECYCLE_STAGES.join(", ")} (or omitted)`);
  }
  return findings;
}

/**
 * Evaluates `foundry.capabilities` across every active role.
 *
 * `manifestsByName`: Map<role, parsed package.json>.
 * `options.requiredRoles`/`options.allowlistedRoles`: role names exempt
 * from the "capabilities required" finding under `--enforce` (the
 * allowlist is the mechanism issue #1196 itself asks for -- "run the gate
 * ... with an empty or allowlisted set, until they land"). The same
 * allowlist also forgives an unresolved capability `input` naming one of
 * these roles as `producerRole`, in EITHER mode -- see the input-resolution
 * check below (it runs unconditionally, not only under `--enforce`).
 * `options.proofCaseIdsByRole`: optional `Map<role, Set<string> | undefined>`
 * of each role's own retained qualification adapter case ids, threaded
 * into `validateCapabilityShape` per role. Omit entirely (as every
 * existing caller that doesn't care about resolution does) to skip that
 * check for every role.
 */
export function evaluateCapabilityMaps(activeRoles, manifestsByName, options = {}) {
  const { enforce = false, allowlistedRoles = [], proofCaseIdsByRole } = options;
  const allowlisted = new Set(allowlistedRoles);
  const findings = [];
  const warnings = [];
  const table = [];
  const capabilitiesByRole = new Map();
  const feedsByRole = new Map();

  for (const role of [...activeRoles].sort()) {
    const manifest = manifestsByName.get(role);
    const row = { role, capabilities: "absent", count: 0 };
    if (manifest === undefined) { table.push(row); continue; }
    const foundry = isRecord(manifest.foundry) ? manifest.foundry : {};

    if (Array.isArray(foundry.feeds)) feedsByRole.set(role, foundry.feeds.filter((item) => isRecord(item) && isText(item.artifact) && isText(item.path)));

    if (foundry.capabilities === undefined) {
      row.capabilities = "absent";
      if (enforce && !allowlisted.has(role)) findings.push({ rule: "required-capabilities-absent", role, message: "foundry.capabilities must declare this role's own MECE capability map" });
      table.push(row);
      continue;
    }
    if (!isNonEmptyArray(foundry.capabilities)) {
      row.capabilities = "malformed";
      findings.push({ rule: "invalid-capabilities-declaration", role, message: "foundry.capabilities must be a non-empty array — a declared-but-empty array has nothing to check and is malformed, not an absence" });
      table.push(row);
      continue;
    }

    const knownProofCaseIds = proofCaseIdsByRole?.get(role);
    const entryFindings = [];
    const ids = [];
    const subQuestions = [];
    const outputPaths = [];
    for (const capability of foundry.capabilities) {
      entryFindings.push(...validateCapabilityShape(capability, role, knownProofCaseIds));
      if (isRecord(capability)) {
        if (isText(capability.id)) ids.push(capability.id);
        if (isText(capability.subQuestion)) subQuestions.push(capability.subQuestion);
        if (Array.isArray(capability.outputs)) {
          for (const path of capability.outputs) {
            if (typeof path === "string") outputPaths.push({ path, capabilityId: capability.id });
          }
        }
      }
    }

    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    for (const id of new Set(duplicateIds)) entryFindings.push({ rule: "duplicate-capability-id", role, message: `capability id "${id}" is declared more than once within this role's own capabilities` });

    const duplicateSubQuestions = subQuestions.filter((value, index) => subQuestions.indexOf(value) !== index);
    for (const value of new Set(duplicateSubQuestions)) entryFindings.push({ rule: "duplicate-capability-sub-question", role, message: `subQuestion "${value}" is declared by more than one capability — it cannot be jointly exhaustive of anything if it is not distinct` });

    const seenPaths = new Map();
    for (const { path, capabilityId } of outputPaths) {
      const owner = seenPaths.get(path);
      if (owner !== undefined && owner !== capabilityId) {
        entryFindings.push({ rule: "duplicate-capability-output", role, message: `output "${path}" is declared by both capability "${owner}" and capability "${capabilityId}" — no two capabilities may produce the same output` });
      } else {
        seenPaths.set(path, capabilityId);
      }
    }

    row.capabilities = entryFindings.length === 0 ? "declared" : "malformed";
    row.count = foundry.capabilities.length;
    findings.push(...entryFindings);
    capabilitiesByRole.set(role, foundry.capabilities.filter(isRecord));
    if (subQuestions.length > 0) {
      warnings.push({ rule: "capability-coverage-not-verified", role, message: `${subQuestions.length} sub-question(s) declared — whether they jointly answer this role's own job question is a reviewer judgment, not checked here` });
    }
    table.push(row);
  }

  if (enforce) {
    const ownersByOutput = new Map();
    for (const [role, capabilities] of capabilitiesByRole) {
      for (const capability of capabilities) {
        if (!Array.isArray(capability.outputs)) continue;
        for (const path of capability.outputs) {
          if (typeof path !== "string") continue;
          if (!ownersByOutput.has(path)) ownersByOutput.set(path, []);
          ownersByOutput.get(path).push({ role, capabilityId: capability.id });
        }
      }
    }
    // The outputs pathRule already namespaces every path under
    // clossys/<role-short-name>/, so a genuine cross-role collision can only
    // happen when two differently-scoped packages resolve to the same short
    // name (e.g. @fixture-old-scope/alpha and @fixture-new-scope/alpha both deriving "alpha").
    // That is a real, if rare, scenario this check still exists to catch --
    // the within-role duplicate-capability-output finding above cannot see
    // across roles at all.
    for (const [path, owners] of ownersByOutput) {
      const distinctRoles = new Set(owners.map((owner) => owner.role));
      if (distinctRoles.size > 1) {
        findings.push({ rule: "capability-output-multiple-owners", path, message: `output "${path}" is claimed by capabilities in more than one role (${[...distinctRoles].join(", ")}) — every output has exactly one owner` });
      }
    }

    for (const [role, feedsList] of feedsByRole) {
      const capabilities = capabilitiesByRole.get(role) ?? [];
      for (const feed of feedsList) {
        const producers = capabilities.filter((capability) => Array.isArray(capability.outputs) && capability.outputs.includes(feed.path));
        if (producers.length === 0) {
          findings.push({ rule: "feed-not-fed-by-any-capability", role, message: `feeds entry { artifact: "${feed.artifact}", path: "${feed.path}" } is not produced by any of this role's own declared capabilities` });
        } else if (producers.length > 1) {
          findings.push({ rule: "feed-fed-by-multiple-capabilities", role, message: `feeds entry { artifact: "${feed.artifact}", path: "${feed.path}" } is produced by more than one capability (${producers.map((item) => item.id).join(", ")}) — every needs is fed by exactly one capability` });
        }
      }
    }

  }

  // Capability-input resolution runs in BOTH modes (see the header comment
  // on why this one cross-role check is not gated behind --enforce): every
  // capability's own `inputs` entry should resolve to a real producer --
  // `{ producerRole, artifact }` names a capability whose own `id` is
  // `artifact`, declared among `producerRole`'s own well-formed
  // capabilities. A `producerRole` that is itself allowlisted (its map has
  // not landed yet) is forgiven outright -- the consuming role cannot be
  // faulted for a producer that hasn't drafted yet, the same forgiveness
  // `required-capabilities-absent` already extends to that producer
  // directly.
  for (const [role, capabilities] of capabilitiesByRole) {
    for (const capability of capabilities) {
      if (!Array.isArray(capability.inputs)) continue;
      for (const input of capability.inputs) {
        if (!isCapabilityInputEntry(input)) continue; // already reported by validateCapabilityShape
        const { producerRole, artifact } = input;
        if (allowlisted.has(producerRole)) continue;
        const producerCapabilities = capabilitiesByRole.get(producerRole) ?? [];
        const resolved = producerCapabilities.some((candidate) => candidate.id === artifact);
        if (!resolved) {
          findings.push({
            rule: "unresolved-capability-input",
            role,
            message: `capability "${capability.id}" input { producerRole: "${producerRole}", artifact: "${artifact}" } does not resolve to any capability "${producerRole}" itself declares (artifact must name one of that role's own capability ids)`,
          });
        }
      }
    }
  }

  return { findings, warnings, table };
}

/**
 * Lays every declared capability along the business lifecycle (issue
 * #1196's "catalogue view"), so gaps and overlaps are visible at a glance.
 * A capability with no declared `businessLifecycleStage` lands in its own
 * `unassigned` bucket rather than being silently dropped.
 */
export function buildCapabilityCatalogue(activeRoles, manifestsByName) {
  const byStage = new Map(BUSINESS_LIFECYCLE_STAGES.map((stage) => [stage, []]));
  const unassigned = [];
  for (const role of [...activeRoles].sort()) {
    const manifest = manifestsByName.get(role);
    const foundry = manifest !== undefined && isRecord(manifest.foundry) ? manifest.foundry : {};
    if (!Array.isArray(foundry.capabilities)) continue;
    for (const capability of foundry.capabilities) {
      if (!isRecord(capability) || !isText(capability.id)) continue;
      const entry = { role, id: capability.id };
      if (typeof capability.businessLifecycleStage === "string" && byStage.has(capability.businessLifecycleStage)) {
        byStage.get(capability.businessLifecycleStage).push(entry);
      } else {
        unassigned.push(entry);
      }
    }
  }
  return { byStage, unassigned };
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

function loadAllowlist(argv, root) {
  if (argv.includes("--no-allowlist")) return [];
  const index = argv.indexOf("--allowlist");
  if (index === -1) return [];
  const path = argv[index + 1];
  if (path === undefined) throw new Error("--allowlist requires a file path");
  const resolved = isAbsolute(path) ? path : join(root, path);
  if (!existsSync(resolved)) throw new Error(`no such allowlist: ${resolved}`);
  const parsed = readJson(resolved);
  if (!Array.isArray(parsed) || !parsed.every(isText)) throw new Error(`allowlist ${resolved} must be a JSON array of role names`);
  return parsed;
}

/**
 * This role's own retained qualification adapter case ids
 * (governance/release-qualification-adapters/<role-short-name>/current-direct.json,
 * `cases[].id`), or `undefined` when the adapter file does not exist, is
 * unreadable, or does not declare a `cases` array -- treated the same as
 * "cannot resolve yet", never a crash: a role without a retained adapter
 * simply gets no proofCase-resolution check, the same "absence is not a
 * failure" discipline this whole gate already applies elsewhere.
 */
function loadProofCaseIds(root, role) {
  const adapterPath = join(root, "governance", "release-qualification-adapters", roleShortName(role), "current-direct.json");
  if (!existsSync(adapterPath)) return undefined;
  try {
    const adapter = readJson(adapterPath);
    if (!isRecord(adapter) || !Array.isArray(adapter.cases)) return undefined;
    return new Set(adapter.cases.filter((entry) => isRecord(entry) && isText(entry.id)).map((entry) => entry.id));
  } catch {
    return undefined;
  }
}

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
  const activeRoles = Object.keys(contract.roles);
  const proofCaseIdsByRole = new Map(activeRoles.map((role) => [role, loadProofCaseIds(root, role)]));
  return { activeRoles, manifestsByName, proofCaseIdsByRole };
}

function printTable(table) {
  console.log(["role", "capabilities", "count"].join("  |  "));
  for (const row of table) console.log([row.role, row.capabilities, row.count].join("  |  "));
}

function printCatalogue(catalogue) {
  console.log("\nCatalogue view (business lifecycle):");
  for (const stage of BUSINESS_LIFECYCLE_STAGES) {
    const entries = catalogue.byStage.get(stage) ?? [];
    console.log(`  ${stage}: ${entries.length === 0 ? "(none)" : entries.map((entry) => `${entry.role}/${entry.id}`).join(", ")}`);
  }
  if (catalogue.unassigned.length > 0) {
    console.log(`  unassigned: ${catalogue.unassigned.map((entry) => `${entry.role}/${entry.id}`).join(", ")}`);
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const root = argv.find((value, index) => !value.startsWith("--") && argv[index - 1] !== "--allowlist") ?? join(scriptDir, "..");
  let collected;
  let allowlistedRoles;
  try {
    collected = collect(root);
    allowlistedRoles = loadAllowlist(argv, root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-capability-maps: ${message}`);
    return 2;
  }
  const result = evaluateCapabilityMaps(collected.activeRoles, collected.manifestsByName, { enforce, allowlistedRoles, proofCaseIdsByRole: collected.proofCaseIdsByRole });
  const catalogue = buildCapabilityCatalogue(collected.activeRoles, collected.manifestsByName);
  if (json) {
    console.log(JSON.stringify({ ...result, catalogue: { byStage: Object.fromEntries(catalogue.byStage), unassigned: catalogue.unassigned } }, null, 2));
    return result.findings.length === 0 ? 0 : 1;
  }
  printTable(result.table);
  for (const item of result.findings) console.log(`FAIL ${item.rule} ${item.role ?? item.path} — ${item.message}`);
  for (const item of result.warnings) console.log(`WARN ${item.rule} ${item.role} — ${item.message}`);
  printCatalogue(catalogue);
  const declaredCount = result.table.filter((row) => row.capabilities === "declared").length;
  console.log(`\ncapabilities: ${declaredCount}/${result.table.length} active role(s) declare a well-formed map.`);
  console.log(enforce ? `Running with --enforce: absence of capabilities (outside ${allowlistedRoles.length} allowlisted role(s)), cross-role output ownership, needs/capability-output matching, and capability-input resolution are all findings.` : "Report mode: absence of capabilities is printed and counted, never a failure. Pass --enforce for the enforcing mode.");
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
