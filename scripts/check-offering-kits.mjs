#!/usr/bin/env node
// Offering kit presets (issue #1176, owner redirect 2026-09-22).
//
//   node scripts/check-offering-kits.mjs [--json] [<repoRoot>]
//
// Exit 0 = every preset in docs/contracts/kit-presets.json names only real,
// current role packages, every `addOnTo` resolves to a real preset id, and
// every preset composes cleanly against the generated capability catalogue
// (scripts/lib/capability-catalogue.mjs#composeKit reports no unsatisfied
// need and no cycle). Exit 1 = at least one finding. Exit 2 = the question
// could not be answered (a missing or unparseable input).
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

import { buildCapabilityCatalogue, composeKit, isRecord, isText, presetEvidenceFindings } from "./lib/capability-catalogue.mjs";

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
  const note = (rule, message, extra = {}) => findings.push({ rule, message, ...extra });

  if (!isRecord(contract) || contract.schemaVersion !== 1) {
    note("invalid-contract", "kit presets contract must be schemaVersion 1");
    return { findings, presets: [] };
  }
  if (!Array.isArray(contract.presets) || contract.presets.length === 0) {
    note("invalid-contract", "presets must be a nonempty array");
    return { findings, presets: [] };
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
      } else if (composed.unsatisfiedNeeds.length > 0) {
        for (const need of composed.unsatisfiedNeeds) {
          note(
            "unsatisfied-need",
            `preset ${preset.id}: role ${need.role} needs ${need.artifact} which no resolvable role provides`,
            { preset: preset.id, role: need.role, artifact: need.artifact },
          );
        }
      }
    }
  }

  return { findings, presets: contract.presets };
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
  // Advisory only -- see presetEvidenceFindings' own doc comment. Every
  // current `solves` claim is the `designed`-only fallback (issue #1172
  // has not landed real evidence for any role), so this is expected to be
  // nonempty today; it never affects the exit code.
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
    console.log(JSON.stringify({ findings: result.findings, evidenceAdvisories: result.evidenceAdvisories }, null, 2));
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
