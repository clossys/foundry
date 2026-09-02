#!/usr/bin/env node
// check-qualification-record-present — does the candidate this run would
// publish already have its retained qualification record on the tree?
//
//   node scripts/check-qualification-record-present.mjs --package <key>
//
// Exit 0 = the record exists. Exit 1 = it does not. Exit 2 = the question
// could not be answered (an unreadable manifest or policy), the same
// three-way split every gate in this repo uses.
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
// the two cannot disagree about where a record lives.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { qualificationPath } from "./lib/candidate-qualification.mjs";

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
  console.log(`QUALIFICATION RECORD PRESENT — ${result.candidate.name}@${result.candidate.version} at ${result.path}`);
}
