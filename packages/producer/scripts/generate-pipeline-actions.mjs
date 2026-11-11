#!/usr/bin/env node
// Generate pipeline/actions.json and pipeline/manifest.json from the action registry
// (packages/<package>/actions/**) and the code bindings (src/pipeline/steps/bindings.ts, built to
// dist). The only writer of both files; check:step-standard fails when either is stale. Run after the
// build; `npm run generate:pipeline-graph` runs it before regenerating pipeline/graph.json.
//
//   node scripts/generate-pipeline-actions.mjs [--check]
//
// --check writes nothing and exits 1 when a generated file differs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { manifestOf, orderActions, PKG, readRegistry, snapshotOf, stableJson } from "./action-registry.mjs";

const DIST = join(PKG, "dist", "pipeline");
for (const file of ["define.js", "actions.js", "steps/bindings.js"]) if (!existsSync(join(DIST, file))) {
  console.error(`generate-pipeline-actions: dist/pipeline/${file} does not exist; build first`);
  process.exit(2);
}
const define = await import(pathToFileURL(join(DIST, "define.js")).href);
const actions = await import(pathToFileURL(join(DIST, "actions.js")).href);
const { BINDINGS } = await import(pathToFileURL(join(DIST, "steps", "bindings.js")).href);

const registry = readRegistry();
const unreadable = [...registry.problems, ...registry.actions.filter(action => !action.contract).map(action => ({ rule: "action.invalid", message: `${action.path} does not load` }))];
if (unreadable.length) {
  for (const problem of unreadable) console.error(`generate-pipeline-actions: ${problem.rule}: ${problem.message}`);
  process.exit(2);
}
const ordered = orderActions(registry.actions, registry.ia, define.STAGES);
const outputs = [
  [actions.ACTIONS_FILE, stableJson(snapshotOf(ordered, actions.ACTIONS_SCHEMA))],
  [actions.MANIFEST_FILE, stableJson(manifestOf(ordered, registry.exceptions, BINDINGS, actions.MANIFEST_SCHEMA))],
];
const check = process.argv.includes("--check");
let stale = 0;
for (const [file, text] of outputs) {
  const path = join(PKG, file);
  const same = existsSync(path) && readFileSync(path, "utf8") === text;
  if (check) { if (!same) { stale++; console.error(`generate-pipeline-actions: ${file} is stale; run npm run generate:pipeline-actions`); } }
  else if (!same) { writeFileSync(path, text); console.log(`wrote ${file} (${ordered.length} actions)`); }
  else console.log(`${file} is current (${ordered.length} actions)`);
}
process.exitCode = stale ? 1 : 0;
