#!/usr/bin/env node
/**
 * Regenerates the incident loop's recorded fixtures (src/loop/incidents/records): one record per seed
 * cause, as the repeats were seen on 2026-11-27 and 2026-11-28, each written by incidentRecord so its
 * signature is the code's own normalization of the failing output, never hand-typed.
 *
 * Usage: npm run generate:incident-records -w @clossys/controller   (after npm run build -w @clossys/controller)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { incidentRecord } = await import(pathToFileURL(join(here, "../dist/loop/incidents/signature.js")).href);
const dir = join(here, "../src/loop/incidents/records");
const seeds = [
  ["2026-11-27-orphan-test-child", { stage: "build", command: "npm run build -w @clossys/producer", exit: 1, at: "2026-11-27T21:14:00Z",
    output: "build slot is held by process 48121 (started 2026-11-27T19:02:11Z)\nthe holder is an orphaned test child: node /work/tree/node_modules/vitest/vitest.mjs run\nwaited 7200s; refusing to start a second build" }],
  ["2026-11-28-fixed-exit-root-check", { stage: "accept", command: "npm run check", exit: 1, at: "2026-11-28T01:40:00Z",
    output: "FAIL npm run check: head exit 1 (required exit 0)\nthe base 9f2c4e1a7 exits 1 on the same check\n3 steps failed: check:rules, check:dependency-audit, test" }],
  ["2026-11-28-load-noise-timeout", { stage: "test", command: "npm run test -w @clossys/producer", exit: 1, at: "2026-11-28T02:05:00Z",
    output: " FAIL  src/cli/craft.test.ts > craft runs the page brief\nError: Test timed out in 5000ms.\nTest Files  1 failed | 212 passed (213)" }],
  ["2026-11-28-stale-branch-ref", { stage: "fold", command: "git merge-tree --write-tree claude/r2f-int2 claude/r2f-0048-cp1-agentdef", exit: 1, at: "2026-11-28T03:10:00Z",
    output: "refusing to fold: local claude/r2f-0048-cp1-agentdef 5d9ada14e does not match origin a41c09e72\nthe local ref is stale" }],
  ["2026-11-28-contradictory-packet", { stage: "validate", command: "npm run test -w @clossys/designer", exit: 1, at: "2026-11-28T03:45:00Z",
    output: "packet lint: `npm run test -w @clossys/designer` has two expectations (exit 0 and same exit as base)" }],
];
for (const [name, input] of seeds) writeFileSync(join(dir, `${name}.json`), JSON.stringify(incidentRecord(input), null, 2) + "\n");
