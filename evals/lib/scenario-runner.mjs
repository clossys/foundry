// scenario-runner — loads evals/scenarios/*.json and runs each through the
// real, deterministic Advisor composition engine. Issue #1185.
//
// Imports `buildCapabilityCatalogue` and `composeKitFromProblems` from
// scripts/lib/capability-catalogue.mjs -- this repository's own
// dependency-free mirror of packages/advisor/src/composition.ts (see that
// module's own header for why two copies exist and why they must stay in
// step). Using the shared repository-root copy, exactly as
// scripts/check-offering-kits.mjs already does, means this harness needs no
// build step and exercises the SAME real, generated catalogue built from
// the current tree's packages/*\/package.json `foundry` manifests -- so a
// drift in any package's declared `solves`/`needs`/`feeds`, or in the
// problem list or presets, is caught here exactly as #1176's own scope
// addition requires ("any regression blocks a change to the problem list,
// to any package's solves/needs/feeds, or to the Advisor skill").
//
// No model calls, no network, no randomness: this is the fully
// deterministic half of #1185. See evals/manual/ for the separate,
// human-run, model-in-the-loop half.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCapabilityCatalogue, composeKitFromProblems } from "../../scripts/lib/capability-catalogue.mjs";
import { precisionRecall, scoreScenario } from "./accuracy.mjs";
import { checkRepeatability } from "./repeatability.mjs";

// fileURLToPath, not `new URL(".", import.meta.url).pathname` -- the latter
// is percent-encoded, so a checkout path containing a space (or any other
// character `encodeURIComponent` escapes) resolves to a directory that does
// not exist (review #1413, reviewer A's N3).
export const SCENARIOS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios");

/**
 * Reads every `evals/scenarios/*.json` fixture, sorted by file name for a
 * deterministic run order. Throws when the directory is missing OR holds no
 * `*.json` fixture at all -- a zero-scenario run is not a pass (review
 * #1413 item 7): an empty scenario set would otherwise report `satisfied`
 * with a pass rate of 1, exactly like a real, still-covered gate.
 */
export function loadScenarios(scenariosDir = SCENARIOS_DIR) {
  if (!existsSync(scenariosDir)) throw new Error(`scenarios directory not found: ${scenariosDir}`);
  const files = readdirSync(scenariosDir).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`no scenario fixtures (*.json) found in ${scenariosDir} -- a zero-scenario run cannot report a pass`);
  return files.map((name) => {
    const raw = readFileSync(join(scenariosDir, name), "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`evals/scenarios/${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed.id || `${parsed.id}.json` !== name) {
      throw new Error(`evals/scenarios/${name}: fixture "id" must equal its file name without the .json extension (got ${JSON.stringify(parsed.id)})`);
    }
    return parsed;
  });
}

/**
 * Runs every loaded scenario's accuracy score and repeatability check
 * against the real catalogue built from `repoRoot`. Returns
 * `{ results, findings, passed, meanPrecision, meanRecall }`; `findings`
 * concatenates every scenario's accuracy and repeatability findings, in
 * docs/contracts/check-output-envelope.json's findingShape.
 */
export function runCompositionScenarios(repoRoot, { scenariosDir = SCENARIOS_DIR, repeatabilityRuns = 5 } = {}) {
  const catalogue = buildCapabilityCatalogue(repoRoot);
  const scenarios = loadScenarios(scenariosDir);
  const compose = (confirmedProblems) => composeKitFromProblems({ confirmedProblems, catalogue });

  const results = scenarios.map((scenario) => {
    const result = compose(scenario.confirmedProblems);
    const accuracy = scoreScenario(scenario, result);
    const repeatability = checkRepeatability({ scenario, confirmedProblems: scenario.confirmedProblems, compose, runs: repeatabilityRuns });
    return { scenario, result, accuracy, repeatability };
  });

  const findings = results.flatMap((entry) => [...entry.accuracy.findings, ...entry.repeatability.findings]);
  const passed = findings.length === 0;
  const precisions = results.map((entry) => entry.accuracy.precision);
  const recalls = results.map((entry) => entry.accuracy.recall);
  const mean = (values) => (values.length === 0 ? 1 : values.reduce((a, b) => a + b, 0) / values.length);

  return { catalogue, results, findings, passed, meanPrecision: mean(precisions), meanRecall: mean(recalls) };
}

export { precisionRecall };
