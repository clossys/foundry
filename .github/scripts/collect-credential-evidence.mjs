#!/usr/bin/env node

// collect-credential-evidence — assembles real `CredentialEvidence`
// (@clossys/locksmith's `evaluateCredential`) for the automatic
// `GITHUB_TOKEN` this repository's own "dependency audit" job (in
// `.github/workflows/ci.yml`) used, from facts this run can already see.
//
// `evaluateCredential` and its ternary machinery shipped with no caller
// anywhere in this fleet -- a primitive that never operated. This script is
// the caller's own collection half; `.github/scripts/../workflows/ci.yml`'s
// "credential lifecycle" job feeds what this prints to
// `clossys-locksmith-credential`, the bin that judges it.
//
// EVERY FIELD BELOW IS READ, NEVER GUESSED
// -------------------------------------------
//   - jobStartedAt / jobEndedAt: this run's own Actions Jobs API record for
//     the "dependency audit" job. This script's own job `needs:
//     dependency-audit`, so that job has already reached a terminal
//     conclusion and both timestamps are real.
//   - scope: the "dependency audit" job declares no job-level `permissions:`
//     of its own, so it inherits this WORKFLOW's top-level block --
//     `contents: read`, and nothing else -- read directly from this
//     checkout's own `.github/workflows/ci.yml` at the commit this run
//     checked out, not asserted from memory of what the file is supposed to
//     say.
//   - expiresAtJobEnd: `true` is GitHub Actions' own documented platform
//     guarantee for the automatic `GITHUB_TOKEN` on every job, not something
//     this run measures itself -- there is no API that reports it per run.
//   - scopedUseObserved: computed, not assumed. This script re-reads the
//     "dependency audit" job's own YAML block from the SAME checkout and
//     confirms it contains no `secrets.` reference at all -- if it did, that
//     would be a second credential in play beyond the scoped GITHUB_TOKEN,
//     and this script would have no basis for asserting the token's use
//     stayed within its declared scope.
//
// A `dependency audit` job this script cannot find, or a ci.yml block it
// cannot parse, is reported as an evidence document `evaluateCredential`
// reads as `indeterminate` -- never guessed into a passing shape.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** `gh api`, matching this repository's existing `check-gate-efficacy.mjs` convention. */
function ghApi(path) {
  const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/** GitHub's Jobs API reports `2026-09-14T07:53:00Z` (no fractional seconds); the credential evidence contract requires exactly three digits. */
export function toCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return undefined;
  const millis = (match[2] ?? "").padEnd(3, "0").slice(0, 3);
  return `${match[1]}.${millis}Z`;
}

/** Extracts one top-level job's own YAML block from a workflow file's text, by its job id key. */
export function extractJobBlock(workflowText, jobId) {
  const lines = workflowText.split("\n");
  const startPattern = new RegExp(`^  ${jobId}:\\s*$`);
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  if (startIndex === -1) return undefined;
  const blockLines = [lines[startIndex]];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // The next job (or the end of `jobs:`) is any non-blank line indented by
    // exactly two spaces and not a comment continuation of this block.
    if (/^  \S/.test(line)) break;
    blockLines.push(line);
  }
  return blockLines.join("\n");
}

/** `true` when this workflow's top-level `permissions:` block declares exactly `contents: read` and nothing else — the only declared scope this evidence asserts. */
export function workflowGrantsOnlyContentsRead(workflowText) {
  const match = /^permissions:\n((?:  .+\n)+)/m.exec(workflowText);
  if (!match) return false;
  const entries = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return entries.length === 1 && entries[0] === "contents: read";
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const jobName = process.env.CREDENTIAL_AUDIT_JOB_NAME ?? "dependency audit";
  const jobId = process.env.CREDENTIAL_AUDIT_JOB_ID ?? "dependency-audit";

  if (typeof repository !== "string" || typeof runId !== "string") {
    process.stdout.write(`${JSON.stringify({})}\n`);
    return;
  }

  let jobsPage;
  try {
    jobsPage = ghApi(`repos/${repository}/actions/runs/${runId}/jobs`);
  } catch {
    process.stdout.write(`${JSON.stringify({})}\n`);
    return;
  }

  const jobs = Array.isArray(jobsPage?.jobs) ? jobsPage.jobs : [];
  const job = jobs.find((candidate) => candidate?.name === jobName);
  const jobStartedAt = toCanonicalUtcTimestamp(job?.started_at);
  const jobEndedAt = toCanonicalUtcTimestamp(job?.completed_at);

  let workflowText;
  try {
    workflowText = readFileSync(".github/workflows/ci.yml", "utf8");
  } catch {
    process.stdout.write(`${JSON.stringify({})}\n`);
    return;
  }

  const scopeIsContentsReadOnly = workflowGrantsOnlyContentsRead(workflowText);
  const jobBlock = extractJobBlock(workflowText, jobId);
  const scopedUseObserved = jobBlock !== undefined && !jobBlock.includes("secrets.");

  if (job === undefined || jobStartedAt === undefined || jobEndedAt === undefined || !scopeIsContentsReadOnly || jobBlock === undefined) {
    // An incomplete read is a document `evaluateCredential` scores as
    // indeterminate (missing required fields), never one built to look
    // satisfied on a partial read.
    process.stdout.write(`${JSON.stringify({})}\n`);
    return;
  }

  const evidence = {
    key: `GITHUB_TOKEN (${jobName} job, run ${runId})`,
    credentialClass: "ephemeral-job",
    provider: "github-actions",
    scope: ["contents:read"],
    jobStartedAt,
    jobEndedAt,
    expiresAtJobEnd: true,
    scopedUseObserved,
  };

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

import { fileURLToPath } from "node:url";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
