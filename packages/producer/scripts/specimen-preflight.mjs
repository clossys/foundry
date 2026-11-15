#!/usr/bin/env node
// Specimen preflight: certify every Designer candidate of every slot, pinned or not, by the rules a
// candidate submitted today passes, and mount each one's specimen with its slot contract fixture in jsdom
// (src/specimen/preflight.ts). No browser; it finds in minutes what capture:studio finds after
// mounting every option card. Built Producer required (dist/).
//
// Usage: node scripts/specimen-preflight.mjs [--root <consumer>] [--slot <id or prefix>]... [--concurrency N]
//          [--json <file>] [--no-ref-verbatim]
// Prints the certification table (slot, candidate, pinned, contract fixture, not-renderable, failing
// rules) for every candidate that fails, then a summary with the runtime. No fixture is borrowed: a
// candidate mounts its slot's contract fixture (slot.json contract.fixture), else its own preview.
// Exit 0 when every candidate is certified, 1 when any rule fails, 2 on a usage error or a rule that could not run.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { consumerPath } from "./consumer-root.mjs";

const producerDir = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(producerDir, "../..");

export function parseArgs(argv) {
  const options = { root: consumerPath(), slots: [], concurrency: 4, json: undefined, refVerbatim: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined) throw new Error(`${arg} needs a value`); return next; };
    if (arg === "--root") options.root = resolve(value());
    else if (arg === "--slot") options.slots.push(value());
    else if (arg === "--concurrency") options.concurrency = Number(value());
    else if (arg === "--json") options.json = resolve(value());
    else if (arg === "--no-ref-verbatim") options.refVerbatim = false;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  return options;
}

const cell = value => String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ");

export function formatTable(table) {
  const failing = table.filter(row => row.failing.length);
  const lines = ["| slot | candidate | pinned | mounts-contract-fixture | renders-only-as-not-renderable | failing rules |", "| --- | --- | --- | --- | --- | --- |"];
  for (const row of failing) lines.push(`| ${row.slot} | ${row.candidate} | ${row.pinned ? "yes" : "no"} | ${row.contractFixture ? "yes" : "no"} | ${row.notRenderable ? "yes" : "no"} | ${row.failing.map(cell).join("<br>")} |`);
  return lines.join("\n");
}

/** Failing candidates per rule (`<rule>` before the first colon), each candidate counted once per rule. */
export function byRule(table) {
  const counts = new Map();
  for (const row of table) for (const rule of new Set(row.failing.map(reason => reason.split(":")[0]))) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`specimen-preflight: ${error.message}`); return 2; }
  const started = Date.now();
  const { specimenPreflight } = await import(pathToFileURL(resolve(producerDir, "dist/specimen/preflight.js")).href);
  const require = createRequire(import.meta.url);
  const registryBase = dirname(require.resolve("@clossys/designer-ui"));
  let done = 0;
  const result = await specimenPreflight({
    root: options.root, workspace: repoRoot, registryBase, concurrency: options.concurrency, refVerbatim: options.refVerbatim,
    ...(options.slots.length ? { slots: options.slots } : {}),
    onCandidate: row => { done += 1; if (done % 50 === 0) process.stderr.write(`specimen-preflight: ${done} candidates certified\n`); if (row.failing.length) process.stderr.write(`  FAIL ${row.slot}/${row.candidate}\n`); },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const failing = result.table.filter(row => row.failing.length);
  const summary = {
    candidates: result.table.length, mounted: result.mounted, certified: result.table.length - failing.length, failing: failing.length,
    failingPinned: failing.filter(row => row.pinned).length, contractFixture: result.table.filter(row => row.contractFixture).length,
    notRenderable: result.table.filter(row => row.notRenderable).length, rows: result.rows.length, seconds: Number(seconds),
    byRule: byRule(result.table),
  };
  if (options.json) writeFileSync(options.json, `${JSON.stringify({ schema: "clossys.specimen-preflight/1", summary, limits: result.limits, table: result.table }, null, 2)}\n`);
  console.log(formatTable(result.table));
  for (const limit of result.limits) console.log(`Limit: ${limit}`);
  console.log(`specimen-preflight: ${summary.candidates} candidates (${summary.mounted} mounted), ${summary.certified} certified, ${summary.failing} failing (${summary.failingPinned} pinned), ${summary.rows} failing rules; ${summary.contractFixture} mount the slot contract fixture, ${summary.notRenderable} render only as not-renderable; ${seconds}s`);
  return result.limits.length ? 2 : failing.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The esbuild service and jsdom timers keep the loop alive: exit with the verdict.
  main().then(code => process.exit(code), error => { console.error(`specimen-preflight: ${error instanceof Error ? error.stack : error}`); process.exit(2); });
}
