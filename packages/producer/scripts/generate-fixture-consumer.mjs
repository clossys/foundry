#!/usr/bin/env node
/**
 * The synthetic test-fixtures consumer (SOURCE-MIGRATE step 0): a consumer root built only with
 * clossys verbs from the package IA, plus made-up decisions. It holds no content from any real
 * consumer. Package tests and the pack -> install -> `clossys check` proof run against it.
 *
 *   node scripts/generate-fixture-consumer.mjs [--out <dir>]   (default test-fixtures/consumer)
 *
 * It creates a missing fixture only. The current package trees ship as clossys.slot/2, which only the recut writes,
 * so the fixture is replayed from test-fixtures/consumer-legacy-tree (the store that config --init, ia --adopt/--start,
 * ia sync and one not-needed pin built on the old trees, before foundry-build-0048 U2) on a fixed clock: `clossys migrate recut --apply`, then `clossys ia sync` for
 * the package changes since the recut. The made-up not-needed decision (writer/lexicon.currency-format, "the example
 * shop lists no prices") is carried by the recut into writer/_retired/, with its ledger. An existing fixture is
 * refreshed with `clossys ia sync --root <dir>`, which keeps its decisions.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli", "index.js");
const at = process.argv.indexOf("--out");
const out = resolve(at > 0 ? process.argv[at + 1] : join(here, "..", "test-fixtures", "consumer"));
const legacy = join(here, "..", "test-fixtures", "consumer-legacy-tree");
// The recut's clock: every createdAt and ledger event the replay writes carries it.
const RECUT_AT = "2026-11-17T00:00:00Z";

if (existsSync(join(out, "clossys"))) {
  console.log(`generate-fixture-consumer: ${out} exists; refresh it with clossys ia sync --root ${out}`);
  process.exit(0);
}
mkdirSync(out, { recursive: true });
cpSync(join(legacy, "clossys"), join(out, "clossys"), { recursive: true });
const steps = [
  ["migrate", "recut", "--apply", "--at", RECUT_AT],
  ["ia", "sync", "--at", RECUT_AT],
];
for (const argv of steps) {
  const run = spawnSync(process.execPath, [cli, ...argv, "--root", out], { encoding: "utf8" });
  const line = (run.stdout || run.stderr).split("\n")[0];
  console.log(`clossys ${argv.join(" ")}: exit ${run.status}; ${line}`);
  if (run.status !== 0) process.exit(run.status ?? 1);
}
