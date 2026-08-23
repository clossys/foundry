#!/usr/bin/env node
/**
 * Reproducible author-side staging evidence for Program C.
 *
 * Each case invokes one compiled role CLI through its dist path, first on a
 * synthetic consumer-shaped violation and then on its clean control. The
 * temporary records have no personal data. They demonstrate executable
 * discrimination only; real product wiring, adoption, and #507 are separate.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stageDir = mkdtempSync(join(tmpdir(), "foundry-program-c-stage-"));
const at = "2026-08-22T12:00:00.000Z";

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
  const bouncerCli = join(repoRoot, "packages/bouncer/dist/cli.js");
  const bouncerDir = fixtureDir("bouncer");
  const bouncerGrant = {
    grantId: "stage-grant-001", actorId: "stage-actor-001", subjectId: "stage-subject-001", providerId: "stage-provider-001",
    authority: "records.read", grantedAt: "2026-08-01T00:00:00.000Z", sessionId: "stage-session-001",
  };
  const bouncerBacking = { actorId: "stage-actor-001", subjectId: "stage-subject-001", authority: "records.read", confirmedAt: at };
  const bouncerRedGrants = writeJson(bouncerDir, "grants-red.json", [bouncerGrant]);
  const bouncerControlGrants = writeJson(bouncerDir, "grants-control.json", [bouncerGrant]);
  const bouncerRedProviders = writeJson(bouncerDir, "providers-red.json", [{ providerId: "stage-provider-001", reachability: "reachable", observedAt: at, backs: [{ ...bouncerBacking, status: "revoked" }] }]);
  const bouncerControlProviders = writeJson(bouncerDir, "providers-control.json", [{ providerId: "stage-provider-001", reachability: "reachable", observedAt: at, backs: [{ ...bouncerBacking, status: "active" }] }]);
  run("bouncer authority-reconciliation red", bouncerCli, ["authority-reconciliation", bouncerRedGrants, bouncerRedProviders, "--at", at], 1, "Authority reconciliation: violated.");
  run("bouncer authority-reconciliation control", bouncerCli, ["authority-reconciliation", bouncerControlGrants, bouncerControlProviders, "--at", at], 0, "Authority reconciliation: satisfied.");
  const bouncerBoundedActor = { agentIdentityId: "stage-agent-001", agentKind: "automation", displayName: "Stage automation", toolScope: ["records.read"], monetaryLimitAmount: 250, monetaryLimitCurrency: "USD", responsibleHumanId: "stage-operator-001", validFrom: null, validTo: null, revokedAt: null };
  const { monetaryLimitAmount: _stageAmount, monetaryLimitCurrency: _stageCurrency, ...bouncerUnboundedActor } = bouncerBoundedActor;
  const bouncerRedActors = writeJson(bouncerDir, "actors-red.json", [bouncerUnboundedActor]);
  const bouncerControlActors = writeJson(bouncerDir, "actors-control.json", [bouncerBoundedActor]);
  run("bouncer delegation-ceiling red", bouncerCli, ["delegation-ceiling", bouncerRedActors], 1, "Delegation ceiling: violated.");
  run("bouncer delegation-ceiling control", bouncerCli, ["delegation-ceiling", bouncerControlActors], 0, "Delegation ceiling: satisfied.");
  const bouncerMapping = { adapterId: "stage-adapter-001", providerId: "stage-provider-001", recognisedEvents: ["membership.created"], readsFields: [{ path: "data.id", required: true }] };
  const bouncerShape = { providerId: "stage-provider-001", declaredAt: at, emittedEvents: ["membership.created"], fields: [{ path: "data.id", presence: "always" }] };
  const bouncerRedMappings = writeJson(bouncerDir, "mappings-red.json", [{ ...bouncerMapping, readsFields: [{ path: "data.legacy_id", required: true }] }]);
  const bouncerControlMappings = writeJson(bouncerDir, "mappings-control.json", [bouncerMapping]);
  const bouncerShapes = writeJson(bouncerDir, "shapes.json", [bouncerShape]);
  run("bouncer provider-contract red", bouncerCli, ["provider-contract", bouncerRedMappings, bouncerShapes], 1, "Provider contract: violated.");
  run("bouncer provider-contract control", bouncerCli, ["provider-contract", bouncerControlMappings, bouncerShapes], 0, "Provider contract: satisfied.");

  const butlerCli = join(repoRoot, "packages/butler/dist/cli.js");
  const butlerDir = fixtureDir("butler");
  const butlerIntent = {
    intentId: "stage-intent-001", subjectId: "stage-subject-001", actorId: "stage-actor-001", interpretation: "reschedule",
    confidence: 0.95, observedAt: "2026-08-22T10:00:00.000Z", disposition: "acted",
  };
  const butlerConfirmation = { intentId: "stage-intent-001", subjectId: "stage-subject-001", verdict: "confirmed", confirmedAt: "2026-08-22T10:01:00.000Z" };
  const butlerIntents = writeJson(butlerDir, "intents.json", [butlerIntent]);
  const butlerRedConfirmations = writeJson(butlerDir, "confirmations-red.json", []);
  const butlerControlConfirmations = writeJson(butlerDir, "confirmations-control.json", [butlerConfirmation]);
  run("butler confirmation-completeness red", butlerCli, ["confirmation-completeness", butlerIntents, butlerRedConfirmations, "--floor", "0.8"], 1, "Confirmation completeness: violated.");
  run("butler confirmation-completeness control", butlerCli, ["confirmation-completeness", butlerIntents, butlerControlConfirmations, "--floor", "0.8"], 0, "Confirmation completeness: satisfied.");
  const butlerPolicyV3 = { policyId: "stage-preferences", version: "3" };
  const butlerPolicyV4 = { policyId: "stage-preferences", version: "4" };
  const butlerInstruction = { instructionId: "stage-instruction-001", subjectId: "stage-subject-001", topic: "contact-window", state: { kind: "granted", policyVersion: butlerPolicyV3, decidedAt: "2026-08-01T00:00:00.000Z" }, provenance: "stated", currency: { days: 90 } };
  const butlerControlUsage = { instructionId: "stage-instruction-001", actorId: "stage-actor-001", usedAt: "2026-08-02T00:00:00.000Z", currentPolicyVersion: butlerPolicyV3 };
  const butlerRedUsage = { ...butlerControlUsage, currentPolicyVersion: butlerPolicyV4 };
  const butlerInstructions = writeJson(butlerDir, "instructions.json", [butlerInstruction]);
  const butlerRedUsages = writeJson(butlerDir, "usages-red.json", [butlerRedUsage]);
  const butlerControlUsages = writeJson(butlerDir, "usages-control.json", [butlerControlUsage]);
  run("butler currency red", butlerCli, ["currency", butlerInstructions, butlerRedUsages, "--invalidate-denial-on-policy-bump", "true"], 1, "Currency: violated.");
  run("butler currency control", butlerCli, ["currency", butlerInstructions, butlerControlUsages, "--invalidate-denial-on-policy-bump", "true"], 0, "Currency: satisfied.");
  const butlerEasyCost = { steps: 2, requiresContact: false, requiresAccount: false };
  const butlerRedPaths = writeJson(butlerDir, "paths-red.json", [{ surfaceId: "stage-preferences", topic: "email", grant: butlerEasyCost, withdraw: { steps: 9, requiresContact: true, requiresAccount: false } }]);
  const butlerControlPaths = writeJson(butlerDir, "paths-control.json", [{ surfaceId: "stage-preferences", topic: "email", grant: butlerEasyCost, withdraw: butlerEasyCost }]);
  run("butler withdrawal-parity red", butlerCli, ["withdrawal-parity", butlerRedPaths], 1, "Withdrawal parity: violated.");
  run("butler withdrawal-parity control", butlerCli, ["withdrawal-parity", butlerControlPaths], 0, "Withdrawal parity: satisfied.");

  const giverCli = join(repoRoot, "packages/giver/dist/cli.js");
  const giverDir = fixtureDir("giver");
  const giverObligation = { obligationId: "stage-obligation-001", subjectId: "stage-subject-001", register: "statements", firedAt: "2026-08-22T10:00:00.000Z", window: { minutes: 60 } };
  const giverRedProofs = [{ obligationId: "stage-obligation-001", actorId: "stage-actor-001", state: "failed", observedAt: "2026-08-22T10:30:00.000Z", transportRef: "stage-transport-001" }];
  const giverControlProofs = [{ obligationId: "stage-obligation-001", actorId: "stage-actor-001", state: "delivered", observedAt: "2026-08-22T10:30:00.000Z", transportRef: "stage-transport-001" }];
  const giverObligations = writeJson(giverDir, "obligations.json", [giverObligation]);
  const giverRedProofsFile = writeJson(giverDir, "proofs-red.json", giverRedProofs);
  const giverControlProofsFile = writeJson(giverDir, "proofs-control.json", giverControlProofs);
  run("giver obligation-discharge red", giverCli, ["obligation-discharge", giverObligations, giverRedProofsFile, "--at", at], 1, "Obligation discharge: violated.");
  run("giver obligation-discharge control", giverCli, ["obligation-discharge", giverObligations, giverControlProofsFile, "--at", at], 0, "Obligation discharge: satisfied.");
  const giverHandoff = { handoffId: "stage-handoff-001", subjectId: "stage-subject-001", actorId: "stage-actor-001", raisedAt: "2026-08-22T10:00:00.000Z", sla: { minutes: 60 }, reason: "standing-indeterminate" };
  const giverPlacement = { handoffId: "stage-handoff-001", placedWithActorId: "stage-human-001", placedAt: "2026-08-22T10:30:00.000Z" };
  const giverHandoffs = writeJson(giverDir, "handoffs.json", [giverHandoff]);
  const giverRedPlacements = writeJson(giverDir, "placements-red.json", []);
  const giverControlPlacements = writeJson(giverDir, "placements-control.json", [giverPlacement]);
  run("giver handoff-placement red", giverCli, ["handoff-placement", giverHandoffs, giverRedPlacements, "--at", at], 1, "Hand-off placement: violated.");
  run("giver handoff-placement control", giverCli, ["handoff-placement", giverHandoffs, giverControlPlacements, "--at", at], 0, "Hand-off placement: satisfied.");
  const giverGround = { groundId: "stage-ground-001", subjectId: "stage-subject-001", retainedAt: "2026-08-22T09:00:00.000Z" };
  const giverAnswer = { requestId: "stage-request-001", subjectId: "stage-subject-001", actorId: "stage-actor-001", receivedAt: "2026-08-22T11:00:00.000Z", outcome: { kind: "delivered", at, cites: [{ groundId: "stage-ground-001", citedAt: at }] } };
  const giverRedAnswers = writeJson(giverDir, "answers-red.json", [{ ...giverAnswer, outcome: { ...giverAnswer.outcome, cites: [] } }]);
  const giverControlAnswers = writeJson(giverDir, "answers-control.json", [giverAnswer]);
  const giverGrounds = writeJson(giverDir, "retained-grounds.json", [giverGround]);
  run("giver grounding red", giverCli, ["grounding", giverRedAnswers, giverGrounds], 1, "Grounding: violated.");
  run("giver grounding control", giverCli, ["grounding", giverControlAnswers, giverGrounds], 0, "Grounding: satisfied.");

  const keeperCli = join(repoRoot, "packages/keeper/dist/cli.js");
  const keeperDir = fixtureDir("keeper");
  const keeperItem = {
    itemId: "stage-item-001", subjectId: "stage-subject-001", actorId: "stage-actor-001", heldSince: "2026-08-01T00:00:00.000Z",
    holdingClass: "authored-notes", origin: "authored", provenance: { kind: "event", sourceEventId: "stage-event-001" }, belief: null,
  };
  const keeperDisclosures = [{ itemId: "stage-item-001", subjectId: "stage-subject-001", surface: "stage-data-surface", reach: "visible", correctable: true, observedAt: "2026-08-02T00:00:00.000Z" }];
  const keeperGrounds = { schemaVersion: 1, producedAt: at, grounds: [] };
  const keeperItems = writeJson(keeperDir, "items.json", [keeperItem]);
  const keeperRedDisclosures = writeJson(keeperDir, "disclosures-red.json", []);
  const keeperControlDisclosures = writeJson(keeperDir, "disclosures-control.json", keeperDisclosures);
  const keeperGroundsFile = writeJson(keeperDir, "grounds.json", keeperGrounds);
  run("keeper visibility red", keeperCli, ["visibility", keeperItems, keeperRedDisclosures, keeperGroundsFile], 1, "Visibility: violated.");
  run("keeper visibility control", keeperCli, ["visibility", keeperItems, keeperControlDisclosures, keeperGroundsFile], 0, "Visibility: satisfied.");
  const keeperEvent = { eventId: "stage-event-001", subjectId: "stage-subject-001", actorId: "stage-actor-001", occurredAt: "2026-07-01T00:00:00.000Z", kind: "note-written" };
  const keeperRedItems = writeJson(keeperDir, "items-red.json", [{ ...keeperItem, provenance: { kind: "none", namedReason: "stage import omitted source" } }]);
  const keeperEvents = writeJson(keeperDir, "events.json", [keeperEvent]);
  run("keeper attribution red", keeperCli, ["attribution", keeperRedItems, keeperEvents], 1, "Attribution: violated.");
  run("keeper attribution control", keeperCli, ["attribution", keeperItems, keeperEvents], 0, "Attribution: satisfied.");
  const keeperRedSchedule = writeJson(keeperDir, "schedule-red.json", [{ holdingClass: "authored-notes", days: 10 }]);
  const keeperControlSchedule = writeJson(keeperDir, "schedule-control.json", [{ holdingClass: "authored-notes", days: 90 }]);
  const keeperDeletions = writeJson(keeperDir, "deletions.json", []);
  run("keeper disposal red", keeperCli, ["disposal", keeperItems, keeperRedSchedule, keeperDeletions, "--at", at], 1, "Disposal: violated (items-retained-past-schedule).");
  run("keeper disposal control", keeperCli, ["disposal", keeperItems, keeperControlSchedule, keeperDeletions, "--at", at], 0, "Disposal: satisfied.");

  console.log("Program C fixture evidence: all deliberate reds and controls behaved as expected.");
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
