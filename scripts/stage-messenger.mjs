#!/usr/bin/env node
/**
 * Reproducible author-side staging evidence for the messenger role.
 *
 * The fixture invokes the compiled CLI through its dist path. It proves that
 * timely verified delivery closure distinguishes a delivery shortfall from an
 * adjacent satisfied control, and keeps a not-yet-due sample indeterminate.
 * It does not establish publication, consumer adoption, independent grounding,
 * provider access, or live delivery.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stageDir = mkdtempSync(join(tmpdir(), "foundry-messenger-stage-"));
const cli = join(repoRoot, "packages/messenger/dist/cli.js");

function writeJson(name, value) {
  const path = join(stageDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function run(label, evidence, expectedStatus, requiredState) {
  const result = spawnSync(process.execPath, [cli, "delivery-closure", evidence], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) {
    throw new Error(`${label}: expected exit ${expectedStatus}, got ${result.status}\n${output}`);
  }
  if (!output.includes(`"state": "${requiredState}"`) || !output.includes('"metric": "timely-verified-delivery-rate"')) {
    throw new Error(`${label}: output did not carry ${requiredState} timely-delivery evidence\n${output}`);
  }
  console.log(`${label}: exit ${result.status} (${requiredState})`);
}

function record(intentId, observation) {
  return {
    intentId,
    authorization: {
      id: `authorization-${intentId}`,
      intentId,
      policy: "transactional-v1",
      authorizedAt: "2026-08-23T11:55:00.000Z",
    },
    windowOpensAt: "2026-08-23T12:00:00.000Z",
    windowClosesAt: "2026-08-23T13:00:00.000Z",
    observation,
  };
}

function delivered(intentId) {
  return {
    eventId: `delivery-${intentId}`,
    evidenceSource: "signed-provider-delivery-event",
    outcome: "delivered",
    observedAt: "2026-08-23T13:10:00.000Z",
    deliveredAt: "2026-08-23T12:30:00.000Z",
  };
}

try {
  const red = writeJson("delivery-red.json", {
    evaluatedAt: "2026-08-23T14:00:00.000Z",
    setpoint: 1,
    records: [record("one", delivered("one")), record("two")],
  });
  const control = writeJson("delivery-control.json", {
    evaluatedAt: "2026-08-23T14:00:00.000Z",
    setpoint: 1,
    records: [record("one", delivered("one")), record("two", delivered("two"))],
  });
  const notDue = writeJson("delivery-not-due.json", {
    evaluatedAt: "2026-08-23T11:56:00.000Z",
    setpoint: 1,
    records: [record("one")],
  });

  run("messenger delivery red", red, 1, "violated");
  run("messenger delivery control", control, 0, "satisfied");
  run("messenger delivery not due", notDue, 2, "indeterminate");
  console.log("Messenger fixture evidence: delivery closure discriminated, and no due intent stayed indeterminate.");
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
