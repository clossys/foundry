#!/usr/bin/env node
/**
 * run-heartbeat (issue #1221) — the heartbeat's own reference "artifact":
 * the repo-relative script `controllerHeartbeatSchedule`
 * (packages/controller/src/heartbeat/schedule.ts) names as
 * `artifact: "scripts/run-heartbeat.mjs"`. Invokes the compiled
 * controller heartbeat CLI by dist path (mirrors
 * scripts/check-strategist-subject.mjs's own thin-wrapper pattern),
 * forwarding every argument -- including --write -- unchanged.
 *
 * Foundry itself is the package producer here, not a client repository
 * with its own populated clossys/<role>/ tree, so running this without
 * --write is Foundry's own self-check that the artifact still computes
 * cleanly against whatever clossys/ this repository actually has (see
 * scripts/check-heartbeat.mjs, the wired CI gate). A repository that
 * installs @clossys/controller for real supplies its OWN artifact
 * (Launcher's job, per issue #1221's ownership table, not this script).
 *
 * Needs packages/controller/dist/; runs after `npm run build`, never in
 * check:gates.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const heartbeatCli = join(repoRoot, "packages/controller/dist/heartbeat/bin.js");

const args = process.argv.slice(2);
const hasRepoRoot = args.some((arg) => !arg.startsWith("--"));
const forwardedArgs = hasRepoRoot ? args : [repoRoot, ...args];

const result = spawnSync(process.execPath, [heartbeatCli, ...forwardedArgs], { cwd: repoRoot, encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
process.exit(result.status ?? 1);
