#!/usr/bin/env node
/**
 * Generate pipeline/seats.json, the Producer seat tree and the package seat defaults, from the
 * pipeline steps (src/pipeline/seat-defaults.ts, built to dist). The L1 and L2 labels are kept
 * from the current file; every other byte is derived. Run after the build.
 *
 *   node scripts/generate-pipeline-seats.mjs [--check]
 *
 * --check writes nothing and exits 1 when the file is stale or a sample seat fails seat.schema.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const PKG = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(PKG, "dist");
const need = ["pipeline/seat-defaults.js", "pipeline/steps/index.js", "pipeline/schema.js", "records/slot-model/pipeline-seats.js"];
for (const file of need) if (!existsSync(join(DIST, file))) { console.error(`generate-pipeline-seats: dist/${file} does not exist; build first`); process.exit(2); }
const load = file => import(pathToFileURL(join(DIST, file)).href);
const { pipelineSeatsDoc, seatLabels } = await load("pipeline/seat-defaults.js");
const { STEPS } = await load("pipeline/steps/index.js");
const { loadSchema, validateValue } = await load("pipeline/schema.js");
const { PIPELINE_SEATS_FILE } = await load("records/slot-model/pipeline-seats.js");

const file = join(PKG, PIPELINE_SEATS_FILE);
const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
let doc;
try { doc = pipelineSeatsDoc(STEPS, seatLabels(current ? JSON.parse(current) : undefined)); }
catch (error) { console.error(`generate-pipeline-seats: ${error.message}`); process.exit(1); }
const issues = Object.entries(doc.seats).flatMap(([step, seat]) => validateValue(seat, loadSchema("seat")).map(issue => `${step}${issue.path} ${issue.message}`));
if (issues.length) { for (const issue of issues) console.error(`generate-pipeline-seats: sample seat ${issue}`); process.exit(1); }
const bytes = `${JSON.stringify(doc, null, 2)}\n`;
const seats = Object.keys(doc.seats).length;
if (process.argv.includes("--check")) {
  if (current !== bytes) { console.error(`generate-pipeline-seats --check: ${PIPELINE_SEATS_FILE} is stale; run npm run generate:pipeline-seats`); process.exit(1); }
  console.log(`generate-pipeline-seats --check: ${PIPELINE_SEATS_FILE} matches the steps (${seats} seats)`);
  process.exit(0);
}
if (current === bytes) console.log(`generate-pipeline-seats: ${PIPELINE_SEATS_FILE} unchanged (${seats} seats)`);
else { writeFileSync(file, bytes); console.log(`generate-pipeline-seats: wrote ${PIPELINE_SEATS_FILE} (${seats} seats)`); }
