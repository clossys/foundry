#!/usr/bin/env node
/**
 * check-heartbeat (issue #1221) — the lightweight, wired gate for the
 * heartbeat: validates the reference `controller-heartbeat` schedule
 * declaration (packages/controller/src/heartbeat/schedule.ts) against
 * THIS repository's own schedule registry, then runs
 * scripts/run-heartbeat.mjs in report mode (no --write) against this
 * repository's own clossys/ tree, so this is a real, wired, green check
 * rather than dead code -- Foundry is the package producer, not a client
 * repository with a populated clossys/<role>/ tree of its own, so the
 * check's own value today is proving the declaration and the artifact
 * both still compute cleanly, not that anything is actually waiting.
 *
 * Dynamically imports the compiled schedule module by dist path (mirrors
 * scripts/check-shared-vocabularies.mjs's own dynamic dist-import
 * pattern), so it needs packages/controller/dist/ and runs after
 * `npm run build`, never in check:gates.
 *
 * Exit 0 = the declaration validates AND the heartbeat artifact reports
 * satisfied. Exit 1 = the declaration has a finding. Exit 2 = the
 * heartbeat artifact itself could not run cleanly (indeterminate).
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

async function loadHeartbeatSchedule() {
  const distPath = resolve(repoRoot, "packages/controller/dist/heartbeat/schedule.js");
  return import(pathToFileURL(distPath).href);
}

// Foundry's own registry for this one declaration: the single repository
// this checkout governs, on the one execution host the reference
// declaration names.
const REGISTRY = { repositories: ["foundry"], hosts: ["github-actions"] };

export async function main() {
  const { controllerHeartbeatSchedule, validateHeartbeatSchedule } = await loadHeartbeatSchedule();
  const declaration = controllerHeartbeatSchedule(["foundry"]);
  const findings = validateHeartbeatSchedule(declaration, REGISTRY);

  console.log(`controller-heartbeat schedule declaration: ${findings.length === 0 ? "OK" : `${findings.length} finding(s)`}`);
  for (const finding of findings) console.log(`  [${finding.rule}] ${finding.message}`);

  const runHeartbeat = join(repoRoot, "scripts/run-heartbeat.mjs");
  const result = spawnSync(process.execPath, [runHeartbeat, repoRoot], { cwd: repoRoot, encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;

  if (findings.length > 0) return 1;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    });
}
