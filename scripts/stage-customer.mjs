#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("packages/customer/dist/cli.js");
const fixtureRoot = mkdtempSync(join(tmpdir(), "stage-customer-"));

const audience = {
  id: "audience-one",
  name: "Jordan",
  description: "A person evaluating a first landing.",
  painPoints: ["unclear offer"],
};

function keep(overrides = {}) {
  return {
    speaker: "customer",
    inhabitedAs: "target-audience",
    audienceId: "audience-one",
    persona: { name: "Jordan" },
    stance: "The unclear offer is why I opened this at all.",
    topic: "the candidate in front of me",
    familiarity: "fresh",
    intent: "keep",
    impressions: {
      firstSeconds: "I immediately see who this is for.",
      isThisForMe: "yes",
      doIBelieve: "yes",
      wouldIStay: "yes",
      wouldITellAPeer: "yes",
    },
    visual: { impression: "The layout feels calm." },
    verbal: { impression: "The words sound like a person." },
    verdict: "keep",
    ...overrides,
  };
}

function run(label, record, expectedStatus, expectedState) {
  const recordPath = join(fixtureRoot, `${label}.json`);
  const audiencePath = join(fixtureRoot, `${label}-audience.json`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(audiencePath, `${JSON.stringify(audience, null, 2)}\n`);
  const result = spawnSync(process.execPath, [cli, recordPath, audiencePath], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  process.stdout.write(`customer ${label}: exit ${result.status}\n${output}`);
  if (result.status !== expectedStatus || !output.includes(`"state": "${expectedState}"`)) {
    throw new Error(`${label} did not produce exit ${expectedStatus} and state ${expectedState}`);
  }
}

try {
  run("keep-red", keep({ speaker: "designer" }), 1, "violated");
  run("keep-control", keep(), 0, "satisfied");
  const unreadablePath = join(fixtureRoot, "keep-indeterminate.json");
  const audiencePath = join(fixtureRoot, "keep-indeterminate-audience.json");
  writeFileSync(unreadablePath, "[]\n");
  writeFileSync(audiencePath, `${JSON.stringify(audience, null, 2)}\n`);
  const indeterminate = spawnSync(process.execPath, [cli, unreadablePath, audiencePath], { encoding: "utf8" });
  const indeterminateOutput = `${indeterminate.stdout}${indeterminate.stderr}`;
  process.stdout.write(`customer keep-indeterminate: exit ${indeterminate.status}\n${indeterminateOutput}`);
  if (indeterminate.status !== 2 || !indeterminateOutput.includes(`"state": "indeterminate"`)) {
    throw new Error("keep-indeterminate did not produce exit 2 and state indeterminate");
  }
  console.log("Customer fixture evidence: inhabit form discriminated red/control, and unreadable JSON stayed indeterminate.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
