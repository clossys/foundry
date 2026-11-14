#!/usr/bin/env node
/**
 * The synthetic test-fixtures consumer (SOURCE-MIGRATE step 0): a consumer root built only with
 * clossys verbs from the package IA, plus made-up decisions. It holds no content from any real
 * consumer. Package tests and the pack -> install -> `clossys check` proof run against it.
 *
 *   node scripts/generate-fixture-consumer.mjs [--out <dir>]   (default test-fixtures/consumer)
 *
 * It creates a missing fixture only. An existing one is refreshed from the package with
 * `clossys ia sync --root <dir>`, which keeps its decisions.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli", "index.js");
const at = process.argv.indexOf("--out");
const out = resolve(at > 0 ? process.argv[at + 1] : join(here, "..", "test-fixtures", "consumer"));

if (existsSync(join(out, "clossys"))) {
  console.log(`generate-fixture-consumer: ${out} exists; refresh it with clossys ia sync --root ${out}`);
  process.exit(0);
}
mkdirSync(out, { recursive: true });
const steps = [
  ["config", "--init"],
  ["ia", "director", "--adopt"],
  ["ia", "designer", "--adopt"],
  ["ia", "writer", "--adopt"],
  ["ia", "publisher", "--start"],
  // Made-up decisions: the example shop is a synthetic consumer, not a real one.
  ["pin", "writer/lexicon.currency-format", "--not-needed", "--reason", "synthetic fixture: the example shop lists no prices", "--by", "planner"],
];
for (const argv of steps) {
  const run = spawnSync(process.execPath, [cli, ...argv, "--root", out], { encoding: "utf8" });
  const line = (run.stdout || run.stderr).split("\n")[0];
  console.log(`clossys ${argv.join(" ")}: exit ${run.status}; ${line}`);
  if (run.status !== 0) process.exit(run.status ?? 1);
}
