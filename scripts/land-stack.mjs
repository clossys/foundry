#!/usr/bin/env node
// land-stack — local conductor for stacked pull requests on this repository.
//
//   node scripts/land-stack.mjs --status <pr>
//   node scripts/land-stack.mjs --merge <pr>
//   node scripts/land-stack.mjs --restack <pr> --worktree <path>
//
// Policy is pure and exported for tests; git/gh are injectable at the CLI edge.

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const PERMITTED_MERGE = "merge";

const NON_BLOCKING_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/** @returns {'merge'} */
export function permittedMergeMethod() {
  return PERMITTED_MERGE;
}

/**
 * Only the PR about to merge may leave draft; others stay draft.
 * @param {number|string} prNumber
 * @param {number|string|null|undefined} currentlyReadyNumber
 */
export function shouldReady(prNumber, currentlyReadyNumber) {
  if (currentlyReadyNumber === null || currentlyReadyNumber === undefined) return false;
  return String(prNumber) === String(currentlyReadyNumber);
}

/**
 * @param {{ status?: string, conclusion?: string|null }} check
 */
export function isCheckBlocking({ status, conclusion }) {
  if (status !== "COMPLETED") return true;
  if (conclusion == null || conclusion === "") return true;
  return !NON_BLOCKING_CONCLUSIONS.has(conclusion);
}

/**
 * @param {{
 *   mergeable?: string|null,
 *   mergeStateStatus?: string|null,
 *   isDraft?: boolean,
 *   checks?: Array<{ name?: string, status?: string, conclusion?: string|null }>,
 * }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function canMerge(input) {
  const mergeable = input.mergeable ?? "UNKNOWN";
  const mergeStateStatus = input.mergeStateStatus ?? "UNKNOWN";
  const isDraft = Boolean(input.isDraft);
  const checks = input.checks ?? [];

  if (isDraft) return { ok: false, reason: "pull request is draft" };
  if (mergeable === "CONFLICTING") return { ok: false, reason: "merge conflicts" };
  if (mergeable === "UNKNOWN") return { ok: false, reason: "mergeability unknown" };
  if (mergeStateStatus === "BEHIND") return { ok: false, reason: "head is behind main; restack first" };
  if (mergeStateStatus === "UNKNOWN") return { ok: false, reason: "merge state unknown" };
  if (mergeable !== "MERGEABLE") return { ok: false, reason: `mergeable=${mergeable}` };

  const blocking = checks.filter((check) => isCheckBlocking(check));
  if (blocking.length > 0) {
    const names = blocking.map((c) => c.name ?? "<unnamed>").join(", ");
    return { ok: false, reason: `blocking checks: ${names}` };
  }

  return { ok: true, reason: "ready to merge with --merge" };
}

/**
 * @param {{ branch: string, afterPr: number|string }} param0
 */
export function restackCommitMessage({ branch, afterPr }) {
  return `Restack ${branch} onto origin/main after PR #${afterPr}`;
}

function defaultGhPrView(pr, fields) {
  const out = execFileSync(
    "gh",
    ["pr", "view", String(pr), "--json", fields.join(",")],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function prViewToCanMergeInput(view) {
  const rollup = view.statusCheckRollup ?? [];
  const checks = rollup.map((entry) => ({
    name: entry.name ?? entry.context ?? "",
    status: entry.status,
    conclusion: entry.conclusion ?? null,
  }));
  return {
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    isDraft: view.isDraft,
    checks,
  };
}

function runStatus(pr, { ghPrView = defaultGhPrView } = {}) {
  const view = ghPrView(pr, ["mergeable", "mergeStateStatus", "isDraft", "statusCheckRollup", "headRefName"]);
  const verdict = canMerge(prViewToCanMergeInput(view));
  return { pr: Number(pr), headRefName: view.headRefName, ...verdict };
}

function runMerge(pr, { ghPrView = defaultGhPrView, ghExec = execFileSync } = {}) {
  const status = runStatus(pr, { ghPrView });
  if (!status.ok) {
    console.error(status.reason);
    process.exitCode = 1;
    return status;
  }
  ghExec("gh", ["pr", "merge", String(pr), "--merge"], { encoding: "utf8", stdio: "inherit" });
  return status;
}

function runRestack(pr, worktree, { gitExec = execFileSync } = {}) {
  const view = defaultGhPrView(pr, ["headRefName"]);
  const branch = view.headRefName;
  if (!branch) throw new Error(`could not resolve head branch for PR #${pr}`);
  const message = restackCommitMessage({ branch, afterPr: pr });
  gitExec("git", ["-C", worktree, "fetch", "origin", "main"], { encoding: "utf8", stdio: "inherit" });
  gitExec("git", ["-C", worktree, "checkout", branch], { encoding: "utf8", stdio: "inherit" });
  gitExec("git", ["-C", worktree, "merge", "origin/main", "-m", message], { encoding: "utf8", stdio: "inherit" });
  gitExec("git", ["-C", worktree, "push", "origin", branch], { encoding: "utf8", stdio: "inherit" });
  return { pr: Number(pr), branch, message };
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      status: { type: "boolean", default: false },
      merge: { type: "boolean", default: false },
      restack: { type: "boolean", default: false },
      worktree: { type: "string" },
    },
    allowPositionals: true,
  });

  const pr = positionals[0];
  if (!pr) {
    console.error("usage: land-stack.mjs --status|--merge|--restack <pr> [--worktree <path>]");
    process.exitCode = 2;
    return;
  }

  if (values.status) {
    console.log(JSON.stringify(runStatus(pr), null, 2));
    return;
  }
  if (values.merge) {
    const result = runMerge(pr);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (values.restack) {
    if (!values.worktree) {
      console.error("--restack requires --worktree <path>");
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(runRestack(pr, values.worktree), null, 2));
    return;
  }

  console.error("specify one of --status, --merge, --restack");
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
