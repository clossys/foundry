#!/usr/bin/env node
/**
 * Reproducible author-side staging evidence for the architect role.
 *
 * The fixture invokes the compiled CLI through its dist path. It proves that
 * topology conformance and architecture-exception assessment discriminate a
 * consumer-shaped violation from an adjacent control. It does not establish
 * publication, consumer adoption, independent grounding, or provider access.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stageDir = mkdtempSync(join(tmpdir(), "foundry-architect-stage-"));
const cli = join(repoRoot, "packages/architect/dist/cli.js");

function writeJson(name, value) {
  const path = join(stageDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function run(label, args, expectedStatus, requiredOutput) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) throw new Error(`${label}: expected exit ${expectedStatus}, got ${result.status}\n${output}`);
  if (!output.includes(requiredOutput)) throw new Error(`${label}: expected output containing ${JSON.stringify(requiredOutput)}\n${output}`);
  console.log(`${label}: exit ${result.status} (${requiredOutput})`);
}

try {
  const topology = {
    id: "example",
    schemaVersion: "0.1.0",
    scope: { id: "example-business", kind: "business" },
    systems: [
      { id: "workspace", kind: "workspace", responsibilities: ["control-plane"], visibility: "private" },
      { id: "product", kind: "repository", responsibilities: ["product"], visibility: "private" },
    ],
    authorities: [
      { responsibility: "control-plane", owner: "business-owner", systemOfRecord: "workspace" },
      { responsibility: "product", owner: "product-owner", systemOfRecord: "product" },
    ],
    interfaces: [
      { id: "workspace-to-product", from: "workspace", to: "product", responsibilities: ["product"] },
    ],
  };
  const validTopology = writeJson("topology-control.json", topology);
  const invalidTopology = writeJson("topology-red.json", { ...topology, authorities: topology.authorities.slice(0, 1) });

  run("architect topology red", ["topology", invalidTopology], 1, '"state": "violated"');
  run("architect topology control", ["topology", validTopology], 0, '"state": "satisfied"');

  const baseObservation = {
    id: "change-1",
    observedAt: "2026-08-23T12:00:00Z",
    material: true,
  };
  const redObservations = writeJson("observations-red.json", [{
    ...baseObservation,
    crossings: [{ from: "product", to: "workspace", responsibility: "product", interface: "workspace-to-product" }],
  }]);
  const controlObservations = writeJson("observations-control.json", [{
    ...baseObservation,
    crossings: [{ from: "workspace", to: "product", responsibility: "product", interface: "workspace-to-product" }],
  }]);
  const unobserved = writeJson("observations-unobserved.json", []);

  const assessmentArgs = [validTopology];
  run("architect exception red", ["exceptions", ...assessmentArgs, redObservations, "--maximum-exception-rate", "0"], 1, '"state": "violated"');
  run("architect exception control", ["exceptions", ...assessmentArgs, controlObservations, "--maximum-exception-rate", "0"], 0, '"state": "satisfied"');
  run("architect exception unobserved", ["exceptions", ...assessmentArgs, unobserved, "--maximum-exception-rate", "0"], 2, '"state": "indeterminate"');

  console.log("Architect fixture evidence: topology and exception judgments discriminated, and absent evidence stayed indeterminate.");
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
