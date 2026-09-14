#!/usr/bin/env node
/**
 * Reproducible author-side staging evidence for builder, inspector,
 * integrator, observer, and locksmith.
 *
 * Each case invokes one compiled role CLI through its dist path, first on a
 * genuine consumer-shaped violation (exit 1) and then on its clean control
 * (exit 0). Fixtures are temporary and value-free: no credential, no real
 * secret name beyond what this repository already declares in
 * governance/locksmith-catalog.json, no personal data. This is fixture
 * evidence only — it does not establish publication, consumer adoption,
 * independent grounding, or provider access.
 *
 * LOCKSMITH NOTE: `infisical catalog`'s exit 2 is NOT a violated channel.
 * Reading packages/locksmith/src/infisical/cli.ts and catalog.ts shows the
 * `catalog` subcommand has exactly two outcomes — 0 (the document parses as
 * value-free v1 metadata with unique keys) or 2 (it does not, including a
 * duplicated key, which is exactly the "red" a first pass at this package
 * assumed) — because a shape failure is thrown as CliInputError/
 * InfisicalError and caught by the CLI's own outer handler, which always
 * maps to 2. There is no exit 1 for `catalog` at all. Its genuine violated
 * path is `qualify`: comparing the catalog's own required keys against an
 * offline snapshot of what secret names are actually available discriminates
 * a real deployment gap (a required key nothing has provisioned yet) from a
 * satisfied one, entirely offline. That is the case exercised below.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stageDir = mkdtempSync(join(tmpdir(), "foundry-builder-inspector-integrator-observer-locksmith-stage-"));

function fixtureDir(name) {
  const path = join(stageDir, name);
  mkdirSync(path, { recursive: true });
  return path;
}

function writeJson(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function run(label, cli, args, expectedStatus, requiredOutput) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) throw new Error(`${label}: expected exit ${expectedStatus}, got ${result.status}\n${output}`);
  if (!output.includes(requiredOutput)) throw new Error(`${label}: expected output containing ${JSON.stringify(requiredOutput)}\n${output}`);
  console.log(`${label}: exit ${result.status} (${requiredOutput})`);
}

try {
  // --- builder: deployment-health --------------------------------------
  const builderCli = join(repoRoot, "packages/builder/dist/ci/bin.js");
  const builderDir = fixtureDir("builder");
  const builderRedInputs = writeJson(builderDir, "deployment-health-red.json", {
    observations: [
      { surfaceId: "stage-surface-one", status: "healthy" },
      { surfaceId: "stage-surface-two", status: "unhealthy" },
    ],
  });
  const builderControlInputs = writeJson(builderDir, "deployment-health-control.json", {
    observations: [
      { surfaceId: "stage-surface-one", status: "healthy" },
      { surfaceId: "stage-surface-two", status: "healthy" },
    ],
  });
  run("builder deployment-health red", builderCli, ["deployment-health", "--inputs", builderRedInputs], 1, "Overall: UNHEALTHY (exit 1)");
  run("builder deployment-health control", builderCli, ["deployment-health", "--inputs", builderControlInputs], 0, "Overall: HEALTHY (exit 0)");

  // --- inspector: secret-scan --------------------------------------------
  const inspectorCli = join(repoRoot, "packages/inspector/dist/bin.js");
  const inspectorDir = fixtureDir("inspector");
  const inspectorRedInputs = writeJson(inspectorDir, "secret-scan-red.json", {
    schemaVersion: 1,
    secretScan: {
      observation: {
        attempted: true,
        toolName: "stage-scanner",
        toolVersion: "1.0.0",
        exitCode: 1,
        scope: "working-tree",
        unitsScanned: 12,
        hits: [{ ruleId: "aws-access-key-id", path: "stage/fixture.env" }],
      },
    },
  });
  const inspectorControlInputs = writeJson(inspectorDir, "secret-scan-control.json", {
    schemaVersion: 1,
    secretScan: {
      observation: {
        attempted: true,
        toolName: "stage-scanner",
        toolVersion: "1.0.0",
        exitCode: 0,
        scope: "working-tree",
        unitsScanned: 12,
        hits: [],
      },
    },
  });
  run("inspector secret-scan red", inspectorCli, ["--inputs", inspectorRedInputs, "--checks", "secret-scan"], 1, "Overall: VIOLATED (exit 1)");
  run("inspector secret-scan control", inspectorCli, ["--inputs", inspectorControlInputs, "--checks", "secret-scan"], 0, "Overall: SATISFIED (exit 0)");

  // --- integrator: supersession -------------------------------------------
  const integratorCli = join(repoRoot, "packages/integrator/dist/cli.js");
  const integratorDir = fixtureDir("integrator");
  const integratorRedManifest = writeJson(integratorDir, "manifest-red.json", {
    name: "stage-fixture-consumer",
    version: "1.0.0",
    dependencies: {
      "@example/auth": "1.0.0",
      "@clossys/bouncer": "0.1.0",
    },
  });
  const integratorSupersessionMap = resolve(repoRoot, "governance/foundry-supersession-map.json");
  const integratorControlManifest = resolve(repoRoot, "package.json");
  run(
    "integrator supersession red",
    integratorCli,
    [integratorRedManifest, integratorSupersessionMap, "--block"],
    1,
    "conflicting pair installed together",
  );
  run(
    "integrator supersession control",
    integratorCli,
    [integratorControlManifest, integratorSupersessionMap, "--block"],
    0,
    "No conflicting pairs installed.",
  );

  // --- observer: fleet coverage --------------------------------------------
  const observerCli = join(repoRoot, "packages/observer/dist/bin.js");
  const observerDir = fixtureDir("observer");
  const observerDeclaredAbsent = {
    schemaVersion: 1,
    repository: "stage-fixture-repo",
    declaredAbsences: [{ package: "@clossys/bouncer", reason: "Stage fixture: no lane for authority reconciliation yet." }],
  };
  const observerInstalled = { packages: [{ name: "@clossys/bouncer", installedVersion: "0.1.0" }] };
  const observerRedInput = writeJson(observerDir, "coverage-red.json", {
    schemaVersion: 1,
    packages: ["@clossys/bouncer"],
    repositories: [{ repository: "stage-fixture-repo", declaration: observerDeclaredAbsent, installed: observerInstalled }],
  });
  const observerControlInput = writeJson(observerDir, "coverage-control.json", {
    schemaVersion: 1,
    packages: ["@clossys/bouncer"],
    repositories: [
      {
        repository: "stage-fixture-repo",
        declaration: { schemaVersion: 1, repository: "stage-fixture-repo", declaredAbsences: [] },
        installed: observerInstalled,
      },
    ],
  });
  run("observer coverage red", observerCli, ["--input", observerRedInput], 1, "Overall: VIOLATED (exit 1)");
  run("observer coverage control", observerCli, ["--input", observerControlInput], 0, "Overall: SATISFIED (exit 0)");

  // --- locksmith: qualify (see the module header for why not `catalog`) ---
  const locksmithCli = join(repoRoot, "packages/locksmith/dist/infisical/cli.js");
  const locksmithDir = fixtureDir("locksmith");
  const locksmithCatalog = writeJson(locksmithDir, "catalog.json", {
    version: 1,
    entries: [
      { key: "STAGE_REQUIRED_TOKEN", required: true, description: "Stage fixture required secret.", group: "stage" },
      { key: "STAGE_OPTIONAL_TOKEN", required: false, description: "Stage fixture optional secret.", group: "stage" },
    ],
  });
  const locksmithAvailableRed = writeJson(locksmithDir, "available-red.json", { version: 1, names: ["STAGE_OPTIONAL_TOKEN"] });
  const locksmithAvailableControl = writeJson(locksmithDir, "available-control.json", {
    version: 1,
    names: ["STAGE_REQUIRED_TOKEN", "STAGE_OPTIONAL_TOKEN"],
  });
  run(
    "locksmith qualify red",
    locksmithCli,
    ["qualify", "--catalog", locksmithCatalog, "--available", locksmithAvailableRed],
    1,
    '"ok": false',
  );
  run(
    "locksmith qualify control",
    locksmithCli,
    ["qualify", "--catalog", locksmithCatalog, "--available", locksmithAvailableControl],
    0,
    '"ok": true',
  );

  console.log(
    "Builder, inspector, integrator, observer, and locksmith fixture evidence: all deliberate reds and controls behaved as expected.",
  );
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
