#!/usr/bin/env node
/**
 * check-schema-versions (issue #1224) — invokes the compiled controller
 * migrate CLI by dist path (mirrors scripts/check-strategist-subject.mjs's
 * own thin-wrapper pattern, and gives package-evidence a
 * packages/controller/dist/migrate site) against THIS repository's own
 * clossys/ tree. Report-only (no --apply): a schema-version regression in
 * Foundry's own clossys/ records should be seen in the check's output,
 * never silently fixed by a CI run.
 *
 * Needs packages/controller/dist/; runs after `npm run build`, never in
 * check:gates.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrateCli = join(repoRoot, "packages/controller/dist/migrate/bin.js");

const result = spawnSync(process.execPath, [migrateCli, repoRoot], { cwd: repoRoot, encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
process.exit(result.status ?? 1);
