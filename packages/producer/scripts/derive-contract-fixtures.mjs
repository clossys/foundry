#!/usr/bin/env node
/**
 * derive contract-fixtures --dry-run: propose each Designer element slot's contract fixture
 * (slot.json `contract.fixture`) from its pinned candidate's `meta.preview`, and certify every
 * candidate, pinned or not, against the proposed contract (src/specimen/contract-fixture-derive.ts).
 * Deterministic and read-only: it writes no agent data. A slot.json change lands through the
 * Designer skill, never through this tool, so `--dry-run` is required.
 *
 * Usage: node packages/producer/scripts/derive-contract-fixtures.mjs --dry-run [--json] [--root DIR]
 *   --root DIR   the repository root holding clossys/agents (default: this checkout); needs a built Producer.
 *   --json       the whole report (proposals and every failing candidate) as JSON.
 * Exit 0 with the report, 2 on a usage error or an unbuilt Producer.
 *
 * --from-references --check|--write (foundry-build-0048 U27): the Designer package's component
 * `contract.fixture`, derived from each slot's adopted reference row in the Designer's selected style
 * (src/specimen/reference-fixtures.ts), and the gaps file naming every slot it cannot determine.
 * Package data, not agent data: consumers receive it through `clossys ia sync`. `--check` exits 1
 * when the catalog or the gaps file differs from what `--write` would write.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { consumerUnder } from "./consumer-root.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const usage = message => { process.stderr.write(`derive contract-fixtures: ${message}\nusage: derive-contract-fixtures.mjs --dry-run [--json] [--root DIR] | --from-references --check|--write [--root DIR]\n`); process.exit(2); };
let root = resolve(here, "../../.."), json = false, dryRun = false, fromReferences = false, check = false, write = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--dry-run") dryRun = true;
  else if (arg === "--from-references") fromReferences = true;
  else if (arg === "--check") check = true;
  else if (arg === "--write") write = true;
  else if (arg === "--json") json = true;
  else if (arg === "--root" && args[index + 1]) root = resolve(args[++index]);
  else usage(`unknown argument ${arg}`);
}
if (fromReferences) {
  if (check === write) usage("--from-references needs exactly one of --check or --write");
  const builtRefs = join(root, "packages/producer/dist/specimen/reference-fixtures.js");
  if (!existsSync(builtRefs)) usage(`the Producer is not built (${builtRefs})`);
  const { planReferenceFixtures } = await import(pathToFileURL(builtRefs).href);
  const studio = JSON.parse(readFileSync(join(root, "packages/producer/src/studio-defaults/designer-slots.json"), "utf8")).slots;
  const plan = planReferenceFixtures(join(root, "packages/designer"), studio);
  const stale = plan.files.filter(file => file.before !== file.after);
  const summary = `contract fixtures: ${plan.fixtures} derived from adopted references (${plan.kept} richer kept), ${plan.gaps.length} not determined, ${plan.composed.length} composed (judged against their own pinned, certified composition)`;
  if (check) {
    for (const file of stale) process.stderr.write(`contract fixtures stale: ${file.path} (run derive-contract-fixtures.mjs --from-references --write)\n`);
    process.stdout.write(`${summary}${stale.length ? `, ${stale.length} file(s) stale` : ""}\n`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const file of stale) writeFileSync(file.path, file.after);
  process.stdout.write(`${summary}; wrote ${stale.length} file(s)\n`);
  process.exit(0);
}
if (check || write) usage("--check and --write go with --from-references");
if (!dryRun) usage("only --dry-run: this tool writes no agent data (a slot.json change lands through the Designer skill)");
const built = join(root, "packages/producer/dist/specimen/contract-fixture-derive.js");
if (!existsSync(built)) usage(`the Producer is not built (${built})`);
const { deriveContractFixtures } = await import(pathToFileURL(built).href);
const report = deriveContractFixtures(consumerUnder(root, resolve(here, "../../..")));
if (json) { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exit(0); }

const { noSource, candidates } = report;
const lines = [
  `Designer element slots: ${report.slots}`,
  `  contract.fixture already declared: ${report.declared}`,
  `  proposed from the pinned preview: ${report.derived} (contract.props must also declare props in ${report.propsToDeclare})`,
  `  no source fixture: ${noSource.total} (unpinned ${noSource.unpinned}; pinned without a preview ${noSource.pinnedWithoutPreview}, of which ${noSource.pinnedWithoutPreviewMounting} mount a component; pinned preview without a fixture ${noSource.pinnedPreviewWithoutFixture})`,
  `Candidates certified against the proposed contracts: ${candidates.certified} of ${candidates.checked}`,
  `  failing: ${candidates.nonPinnedFailing} non-pinned, ${candidates.pinnedFailing} pinned`,
  `  by reason: ${Object.entries(report.reasonClasses).map(([cls, count]) => `${cls} ${count}`).join(", ") || "none"}`,
];
for (const row of report.failing.filter(row => !row.pinned)) lines.push(`  ${row.slot}/${row.candidate}: ${row.reasons.join("; ")}`);
process.stdout.write(`${lines.join("\n")}\n`);
