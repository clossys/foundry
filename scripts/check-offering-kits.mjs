#!/usr/bin/env node
// Offering kit presets (issue #1176, owner redirect 2026-09-22).
//
//   node scripts/check-offering-kits.mjs [--json] [<repoRoot>]
//
// Exit 0 = every preset in docs/contracts/kit-presets.json names only real,
// current role packages, every `addOnTo` resolves to a real preset id, and
// every preset composes cleanly against the generated capability catalogue
// (scripts/lib/capability-catalogue.mjs#composeKit reports no unsatisfied
// need and no deadlock). Exit 1 = at least one finding. Exit 2 = the
// question could not be answered (a missing or unparseable input).
//
// A need is satisfied by the same rule scripts/check-package-framework.mjs
// applies under --enforce (`unmatched-need`): a manifest `needs` entry is
// met only when its producer is a role here AND that producer's own
// declared `feeds` names the artifact
// (scripts/lib/capability-catalogue.mjs#needIsMet). An unmet need is an
// `unsatisfied-need` finding. A fallback need (runtime dependency,
// non-runtime order) has no declared feed to match, so it is met whenever
// its producer role exists.
//
// Needs cycles follow issue #1382's decision in
// docs/contracts/package-framework.json (`fields.needs.cycleDecision`),
// the same rule scripts/check-package-framework.mjs applies: a cycle among
// capabilities is a deadlock and a finding (`preset-does-not-compose`); a
// role-level loop with no capability cycle behind it (the Customer/
// Publisher keep loop) is legitimate and passes, and is printed as a
// `roleLoops` note so it is never invisible; a cycle the capability graph
// cannot account for -- only visible through a role with no capability
// map, or a role loop closed by a catalogue fallback need that names no
// capability -- cannot be judged, so it is a warning
// (`needs-graph-cycle-unjudged`) -- never a finding, never silent.
//
// WHY THIS EXISTS
// ---------------
// The owner rejected a hand-maintained, mutually-exclusive kit partition
// (issue #1176 redirect, 2026-09-22): the package catalogue keeps growing
// and a fixed MECE table does not scale with it. Presets in
// docs/contracts/kit-presets.json are curated starting points Advisor can
// offer, never an exhaustive grouping -- so this gate does NOT require
// every packages/* directory to appear in some preset, unlike the earlier
// design it replaces. What it does still guarantee: a preset can never
// silently drift to name a package that no longer exists, or claim an
// addOnTo relationship to a preset id that was renamed or removed, or
// promise a composition that the engine itself cannot actually resolve.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCapabilityCatalogue, composeKit, isRecord, isText, presetEvidenceFindings, SCOPE_PREFIX } from "./lib/capability-catalogue.mjs";

const PRESETS_REL = "docs/contracts/kit-presets.json";

function isTextArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isText(item));
}

class OfferingKitsInputError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new OfferingKitsInputError(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new OfferingKitsInputError(`cannot parse ${path}: ${error.message}`);
  }
}

/** Pure evaluation over an already-read contract and an already-built catalogue. */
export function evaluateOfferingKits({ contract, catalogue }) {
  const findings = [];
  const warnings = [];
  const roleLoops = [];
  const note = (rule, message, extra = {}) => findings.push({ rule, message, ...extra });

  if (!isRecord(contract) || contract.schemaVersion !== 1) {
    note("invalid-contract", "kit presets contract must be schemaVersion 1");
    return { findings, warnings, roleLoops, presets: [] };
  }
  if (!Array.isArray(contract.presets) || contract.presets.length === 0) {
    note("invalid-contract", "presets must be a nonempty array");
    return { findings, warnings, roleLoops, presets: [] };
  }

  const knownRoles = new Set((catalogue?.roles ?? []).map((role) => role.role));
  const presetIds = new Set();
  const seenIds = new Set();

  for (const preset of contract.presets) {
    if (isRecord(preset) && isText(preset.id)) presetIds.add(preset.id);
  }

  for (const [index, preset] of contract.presets.entries()) {
    if (!isRecord(preset) || !isText(preset.id) || !isText(preset.label) || !isText(preset.problem) || !isTextArray(preset.roles)) {
      note("invalid-preset", `presets[${index}] must have id, label, problem, and a nonempty roles[]`);
      continue;
    }

    if (seenIds.has(preset.id)) {
      note("duplicate-preset-id", `preset id ${preset.id} appears more than once`, { preset: preset.id });
    }
    seenIds.add(preset.id);

    const seenRoles = new Set();
    for (const role of preset.roles) {
      if (seenRoles.has(role)) {
        note("duplicate-role-in-preset", `${role} appears more than once in preset ${preset.id}`, { preset: preset.id, role });
      }
      seenRoles.add(role);
      if (!knownRoles.has(role)) {
        note("unknown-role", `preset ${preset.id} names ${role}, which is not a current role package`, { preset: preset.id, role });
      }
    }

    if (preset.addOnTo !== undefined) {
      if (!isText(preset.addOnTo)) {
        note("invalid-add-on-to", `preset ${preset.id} addOnTo must be a non-empty string when present`, { preset: preset.id });
      } else if (preset.addOnTo === preset.id) {
        note("add-on-to-self", `preset ${preset.id} cannot be addOnTo itself`, { preset: preset.id });
      } else if (!presetIds.has(preset.addOnTo)) {
        note("unknown-add-on-to", `preset ${preset.id} addOnTo ${JSON.stringify(preset.addOnTo)} is not a preset id in this contract`, {
          preset: preset.id,
        });
      }
    }

    const validRoles = preset.roles.filter((role) => knownRoles.has(role));
    if (validRoles.length > 0) {
      const composed = composeKit({ selectedRoles: validRoles, catalogue });
      if (composed.state !== "composed") {
        note("preset-does-not-compose", `preset ${preset.id} does not compose: ${composed.reason}`, { preset: preset.id });
      } else {
        for (const cycle of composed.roleCycles) roleLoops.push({ preset: preset.id, cycle });
        if (composed.unjudgedCycle) {
          warnings.push({
            rule: "needs-graph-cycle-unjudged",
            message: `preset ${preset.id}: the capability graph cannot account for this needs cycle (a role with no capability map, or a loop closed by an inferred fallback need), so it cannot be told apart from a deadlock: ${composed.unjudgedCycle.join(" -> ")} (issue #1382)`,
            preset: preset.id,
          });
        }
        const byRole = new Map((catalogue?.roles ?? []).map((role) => [role.role, role]));
        for (const need of composed.unsatisfiedNeeds) {
          // `wantedRole` is the resolved producer role when the need edge
          // resolved to one, and the raw declared `producerRole` otherwise.
          // Only a resolved edge proves the producer exists: an unscoped
          // `producerRole: "publisher"` names a directory here by accident,
          // and the defect is then the consumer's own declaration.
          const resolved = (byRole.get(need.role)?.needs ?? []).some((edge) => edge.artifact === need.artifact && edge.role !== undefined && edge.role === need.wantedRole);
          const why = resolved && knownRoles.has(need.wantedRole)
            ? `role ${need.wantedRole} is in the catalogue but declares no feeds entry for it`
            : need.wantedRole === null
              ? "it names no producer role"
              : `no role here is ${need.wantedRole} (a producerRole must be the producer's scoped package name, ${SCOPE_PREFIX}<role>)`;
          note(
            "unsatisfied-need",
            `preset ${preset.id}: role ${need.role} needs ${need.artifact}, but ${why}`,
            { preset: preset.id, role: need.role, artifact: need.artifact },
          );
        }
      }
    }
  }

  return { findings, warnings, roleLoops, presets: contract.presets };
}

function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadAndEvaluate(repoRoot = defaultRoot()) {
  const presetsPath = join(repoRoot, PRESETS_REL);
  if (!existsSync(presetsPath)) {
    throw new OfferingKitsInputError(`missing ${PRESETS_REL}`);
  }
  const contract = readJson(presetsPath);
  const catalogue = buildCapabilityCatalogue(repoRoot);
  const result = evaluateOfferingKits({ contract, catalogue });
  // Advisory only -- see presetEvidenceFindings' own doc comment. Most
  // roles still carry only the `designed` fallback `solves`, so this is
  // expected to be nonempty today; it never affects the exit code.
  const evidenceAdvisories = presetEvidenceFindings({ presets: result.presets, catalogue });
  return { ...result, evidenceAdvisories };
}

function printText(result) {
  if (result.findings.length === 0) {
    console.log(`offering kits: PASS (${result.presets.length} preset(s))`);
  } else {
    console.error(`offering kits: FAIL (${result.findings.length} finding(s))`);
    for (const finding of result.findings) {
      console.error(`- ${finding.rule}: ${finding.message}`);
    }
  }
  for (const warning of result.warnings ?? []) {
    console.log(`offering kits: warning ${warning.rule}: ${warning.message}`);
  }
  for (const loop of result.roleLoops ?? []) {
    console.log(`offering kits: preset ${loop.preset} role loop (no capability cycle behind it): ${loop.cycle.join(" -> ")}`);
  }
  if (result.evidenceAdvisories?.length > 0) {
    console.log(
      `offering kits: ${result.evidenceAdvisories.length} preset role(s) below "qualified" evidence (advisory only, does not fail; see presetEvidenceFindings in scripts/lib/capability-catalogue.mjs)`,
    );
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const positional = argv.filter((arg) => arg !== "--json" && !arg.startsWith("--"));
  const repoRoot = positional[0] ? positional[0] : defaultRoot();
  const result = loadAndEvaluate(repoRoot);
  if (json) {
    console.log(JSON.stringify({ findings: result.findings, warnings: result.warnings, roleLoops: result.roleLoops, evidenceAdvisories: result.evidenceAdvisories }, null, 2));
  } else {
    printText(result);
  }
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const exitCode = error instanceof OfferingKitsInputError ? 2 : 1;
    console.error(`offering kits: ${error.message}`);
    process.exitCode = exitCode;
  }
}
