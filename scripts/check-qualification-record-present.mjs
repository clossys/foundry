#!/usr/bin/env node
// check-qualification-record-present — does the candidate this run would
// publish already have its retained qualification record on the tree, and
// does that record still describe the candidate as it stands right now?
//
//   node scripts/check-qualification-record-present.mjs --package <key>
//
// Exit 0 = the record exists and still matches. Exit 1 = it does not exist,
// or it exists but no longer matches (stale). Exit 2 = the question could
// not be answered (an unreadable manifest or policy), the same three-way
// split every gate in this repo uses.
//
// WHY THIS EXISTS
// ---------------
// Publishing requires three things in order: qualify the candidate, RETAIN
// its record on the default branch, then publish. `validate-candidate-publish`
// enforces that join — but it runs inside the `publish` job, which sits behind
// the `npm-publish` environment. By the time it spoke, a human had already
// approved the deployment, and a missing record surfaced as a raw ENOENT from
// `lstat` rather than a sentence saying what was wrong (issue #769).
//
// The cost of that ordering is not the wasted minutes, it is the spent
// approval: the operator must be asked a second time for the same release.
// This check answers the identical question from `discover`, which runs
// before the environment gate, so the run stops while it is still free.
//
// It deliberately duplicates no logic: the record path comes from
// `qualificationPath`, the same function the publish-time validator uses, so
// the two cannot disagree about where a record lives. Likewise, "does the
// record still match?" reuses `currentQualificationJoins()` — the same
// function `generate-qualification-record.mjs` calls to corroborate its own
// `reviewedCommit` — rather than inventing a second notion of freshness. A
// record binds a specific candidate via `candidate.packageManifestSha256`;
// a later merge to an unrelated file in that package can change the
// candidate's manifest digest without ever touching the record itself
// (designer 0.3.1 qualified at one manifest digest, then a routine
// dependabot bump landed 29 minutes later and changed it — the publish
// failed hours afterwards with a raw ENOENT, after a human approval had
// already been spent). Nothing short of recomputing the join would notice.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentQualificationJoins, qualificationPath } from "./lib/candidate-qualification.mjs";

export function qualificationRecordPresence({ root = process.cwd(), packageKey } = {}) {
  if (typeof packageKey !== "string" || packageKey === "") return { state: "indeterminate", reason: "no package key was given" };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(root, `packages/${packageKey}/package.json`), "utf8"));
  } catch {
    return { state: "indeterminate", reason: `packages/${packageKey}/package.json could not be read` };
  }
  const candidate = { name: manifest?.name, version: manifest?.version };
  if (typeof candidate.name !== "string" || typeof candidate.version !== "string") {
    return { state: "indeterminate", reason: `packages/${packageKey}/package.json declares no name/version pair` };
  }
  let path;
  try {
    path = qualificationPath(root, candidate);
  } catch (error) {
    return { state: "indeterminate", reason: error instanceof Error ? error.message : "qualification path could not be derived" };
  }
  if (!existsSync(resolve(root, path))) return { state: "missing", candidate, path };

  let record;
  try {
    record = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    return { state: "indeterminate", reason: `${path} could not be read as JSON: ${error instanceof Error ? error.message : "unknown error"}` };
  }
  const recordedDigest = record?.candidate?.packageManifestSha256;
  if (typeof recordedDigest !== "string" || recordedDigest === "") {
    return { state: "indeterminate", reason: `${path} carries no candidate.packageManifestSha256 to join against` };
  }

  let currentDigest;
  try {
    currentDigest = currentQualificationJoins(root, candidate).packageManifestSha256;
  } catch (error) {
    return { state: "indeterminate", reason: `current package manifest digest could not be recomputed: ${error instanceof Error ? error.message : "unknown error"}` };
  }

  if (recordedDigest !== currentDigest) return { state: "stale", candidate, path, recordedDigest, currentDigest };
  return { state: "present", candidate, path };
}

if (process.argv[1] && process.argv[1].endsWith("check-qualification-record-present.mjs")) {
  const index = process.argv.indexOf("--package");
  const packageKey = index === -1 ? undefined : process.argv[index + 1];
  const result = qualificationRecordPresence({ packageKey });
  if (result.state === "indeterminate") {
    console.error(`QUALIFICATION RECORD INDETERMINATE — ${result.reason}`);
    process.exit(2);
  }
  if (result.state === "missing") {
    console.error(`QUALIFICATION RECORD MISSING — ${result.candidate.name}@${result.candidate.version} has no retained record at ${result.path}.`);
    console.error("Qualify the candidate and retain its record on the default branch before dispatching a publish.");
    console.error("Stopping here rather than inside the publish job, so the npm-publish approval is not spent on a run that cannot succeed.");
    process.exit(1);
  }
  if (result.state === "stale") {
    console.error(`QUALIFICATION RECORD STALE — ${result.candidate.name}@${result.candidate.version} at ${result.path} was qualified against a manifest that has since changed (recorded candidate.packageManifestSha256 ${result.recordedDigest}, current ${result.currentDigest}).`);
    console.error("Re-qualify the candidate and retain a fresh record before dispatching a publish — this one no longer describes it.");
    console.error("Stopping here rather than inside the publish job, so the npm-publish approval is not spent on a run that cannot succeed.");
    process.exit(1);
  }
  console.log(`QUALIFICATION RECORD PRESENT — ${result.candidate.name}@${result.candidate.version} at ${result.path}`);
}
