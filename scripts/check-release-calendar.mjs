#!/usr/bin/env node
// check-release-calendar — is it currently a day an ordinary pull request
// may merge, per governance/release-calendar.json's weekly cadence (Mon-Fri
// merge window, Saturday release, Sunday consumer adoption -- docs/
// RELEASING.md, owner decision 2026-09-23)?
//
//   node scripts/check-release-calendar.mjs [--json] --head-ref <ref> [--labels <a,b,c>] [--now <ISO instant>]
//
// Exit 0 = the merge window is open, OR it is release/adoption day but this
// pull request is either the release PR itself (head ref matches
// scripts/lib/release-calendar.mjs's RELEASE_PR_BRANCH_PATTERN, the branch
// .github/workflows/release-pr.yml pushes) or carries the
// "release:out-of-band" label. Exit 1 = release or adoption day, and
// neither -- the next merge window is reported either way.
//
// --head-ref and --labels are supplied by the calling workflow
// (.github/workflows/release-calendar.yml), resolved differently per
// trigger:
//   - pull_request: github.event.pull_request.head.ref and
//     github.event.pull_request.labels (both present directly on the
//     payload).
//   - merge_group: there is no pull_request payload -- the workflow
//     extracts the PR number from github.event.merge_group.head_ref
//     (shaped like refs/heads/gh-readonly-queue/<base>/pr-<number>-<sha>)
//     and resolves the real head ref and labels via `gh api`. See that
//     workflow's own comments for exactly how.
//
// --now overrides "the current instant" for testing; defaults to real time.
// This script is intentionally NOT wired into the required-checks ruleset
// itself -- see governance policy in docs/RELEASING.md and this repository
// AGENTS.md's autonomous-review rules: making a check required is an owner
// action on the branch protection ruleset, not something a workflow file
// can do on its own.
//
// Pure logic lives in scripts/lib/release-calendar.mjs's
// evaluateReleaseCalendarGate() -- this file is only argv parsing and
// process exit-code plumbing around it, the same split every other check-*
// script in this repository uses.
import { fileURLToPath } from "node:url";
import { evaluateReleaseCalendarGate, loadReleaseCalendar } from "./lib/release-calendar.mjs";

function parseArgs(argv) {
  const json = argv.includes("--json");
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const headRef = get("--head-ref") ?? "";
  const labelsRaw = get("--labels") ?? "";
  const labels = labelsRaw
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const nowRaw = get("--now");
  const now = nowRaw ? new Date(nowRaw) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error(`check-release-calendar: --now "${nowRaw}" is not a parseable date`);
    process.exit(2);
  }
  return { json, headRef, labels, now };
}

function main() {
  const { json, headRef, labels, now } = parseArgs(process.argv.slice(2));

  let calendar;
  try {
    calendar = loadReleaseCalendar(process.cwd());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-release-calendar: ${message}`);
    process.exit(2);
    return;
  }

  const result = evaluateReleaseCalendarGate({ calendar, now, headRefName: headRef, labels });

  if (json) {
    console.log(JSON.stringify({ ...result, headRef, labels, now: now.toISOString(), timezone: calendar.timezone }, null, 2));
  } else if (result.status === "pass") {
    console.log(`check-release-calendar: OK -- ${result.reason}`);
  } else {
    console.error(`check-release-calendar: FAIL -- ${result.reason}`);
  }

  process.exit(result.status === "pass" ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
