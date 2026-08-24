#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("packages/influencer/dist/cli.js");
const fixtureRoot = mkdtempSync(join(tmpdir(), "stage-influencer-"));

function response(eventId) {
  return {
    eventId,
    experimentId: "experiment-one",
    contentId: "content-one",
    publicationId: "publication-one",
    actionKind: "qualified-reply",
    occurredAt: "2026-08-23T10:05:00.000Z",
  };
}

function evidence(events) {
  return {
    evaluatedAt: "2026-08-23T10:12:00.000Z",
    setpointPerThousand: 2,
    minimumExposureCount: 1_000,
    qualifiedActionKinds: ["qualified-reply"],
    records: [{
      intentId: "intent-one",
      subjectId: "product-one",
      actionKind: "publish",
      experimentId: "experiment-one",
      contentId: "content-one",
      publicationId: "publication-one",
      channelId: "channel-one",
      authority: {
        id: "authority-one",
        intentId: "intent-one",
        subjectId: "product-one",
        actorId: "agent-one",
        humanOwnerId: "owner-one",
        allowedActions: ["publish"],
        channelIds: ["channel-one"],
        issuedAt: "2026-08-23T09:00:00.000Z",
        expiresAt: "2026-08-23T11:00:00.000Z",
        paidSpendCeiling: 0,
      },
      windowOpensAt: "2026-08-23T10:00:00.000Z",
      windowClosesAt: "2026-08-23T10:10:00.000Z",
      exposures: {
        state: "observed",
        evidenceSource: "independent-channel-report",
        observedAt: "2026-08-23T10:11:00.000Z",
        count: 2_000,
      },
      responses: {
        state: "observed",
        evidenceSource: "independent-response-report",
        observedAt: "2026-08-23T10:11:00.000Z",
        events,
      },
    }],
  };
}

function run(label, value, expectedStatus, expectedState) {
  const path = join(fixtureRoot, `${label}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const result = spawnSync(process.execPath, [cli, "response-yield", path], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  process.stdout.write(`influencer ${label}: exit ${result.status}\n${output}`);
  if (result.status !== expectedStatus || !output.includes(`"state": "${expectedState}"`)) {
    throw new Error(`${label} did not produce exit ${expectedStatus} and state ${expectedState}`);
  }
}

try {
  run("response-yield-red", evidence([response("response-one")]), 1, "violated");
  run(
    "response-yield-control",
    evidence(Array.from({ length: 5 }, (_, index) => response(`response-${index + 1}`))),
    0,
    "satisfied",
  );
  const unreadable = evidence([]);
  unreadable.records[0].responses = {
    state: "could-not-read",
    evidenceSource: "independent-response-report",
    note: "fixture source unavailable",
  };
  run("response-yield-indeterminate", unreadable, 2, "indeterminate");
  console.log("Influencer fixture evidence: response yield discriminated, and unreadable outcome evidence stayed indeterminate.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
