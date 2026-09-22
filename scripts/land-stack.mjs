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
 * Whether a single check, taken alone, would block a merge if it were
 * required. Unchanged in meaning from before #1135: incomplete, absent, or
 * anything other than SUCCESS/SKIPPED/NEUTRAL is blocking. What changed is
 * *which* checks this is asked about -- see `classifyRequiredContexts`.
 * @param {{ status?: string, conclusion?: string|null }} check
 */
export function isCheckBlocking({ status, conclusion }) {
  if (status !== "COMPLETED") return true;
  if (conclusion == null || conclusion === "") return true;
  return !NON_BLOCKING_CONCLUSIONS.has(conclusion);
}

/**
 * Derive the required-status-check context set from a branch's live rule
 * evaluation (the shape returned by
 * `gh api repos/{owner}/{repo}/rules/branches/{branch}`), never from a
 * hand-written literal (#907) -- the set has already grown from 9 contexts
 * to 15 (#402) and will grow again without this script being told.
 *
 * @param {Array<{type?: string, parameters?: {required_status_checks?: Array<{context?: string}>}}>} branchRules
 * @returns {string[]}
 */
export function extractRequiredContexts(branchRules) {
  const contexts = [];
  for (const rule of branchRules ?? []) {
    if (rule?.type !== "required_status_checks") continue;
    for (const check of rule.parameters?.required_status_checks ?? []) {
      if (check?.context) contexts.push(check.context);
    }
  }
  return contexts;
}

/**
 * Classify every required context against the FULL set of checks reported
 * for a pull request -- required and non-required alike. The full set is
 * needed, not just the required subset, to tell "no run recorded yet
 * because an upstream job this context depends on is still going" apart
 * from "no run recorded, and nothing will ever produce one".
 *
 * Concretely: `secret-scan (inspector judgment)` declares
 * `needs: [push-tree, safety]` in .github/workflows/ci.yml, so it does not
 * exist as a check run at all until those finish -- even though neither of
 * them is itself a required context. Scoping "is anything still running" to
 * only the required contexts would misclassify that as a permanent
 * blocker while push-tree/safety are mid-flight, reproducing the bug this
 * function exists to fix.
 *
 * @param {string[]} requiredContexts
 * @param {Array<{name?: string, status?: string, conclusion?: string|null}>} checks
 * @returns {{
 *   green: string[],
 *   red: Array<{ name: string, conclusion: string|null }>,
 *   pending: string[],
 *   missing: string[],
 * }}
 */
export function classifyRequiredContexts(requiredContexts, checks) {
  const byName = new Map();
  for (const check of checks) {
    const name = check.name ?? "";
    if (name) byName.set(name, check);
  }
  const anyIncomplete = checks.some((check) => check.status !== "COMPLETED");

  const green = [];
  const red = [];
  const pending = [];
  const missing = [];

  for (const context of requiredContexts) {
    const check = byName.get(context);
    if (!check) {
      // Three states, not two (#1135): an absent required context is never
      // treated as a pass. Whether it counts as "still coming" or "will
      // never come" depends on whether anything else on this pull request
      // is still in flight.
      if (anyIncomplete) pending.push(context);
      else missing.push(context);
      continue;
    }
    if (check.status !== "COMPLETED") {
      pending.push(context);
    } else if (isCheckBlocking(check)) {
      red.push({ name: context, conclusion: check.conclusion ?? null });
    } else {
      green.push(context);
    }
  }

  return { green, red, pending, missing };
}

/**
 * @param {{
 *   mergeable?: string|null,
 *   mergeStateStatus?: string|null,
 *   isDraft?: boolean,
 *   checks?: Array<{ name?: string, status?: string, conclusion?: string|null }>,
 *   requiredContexts?: string[],
 * }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function canMerge(input) {
  const mergeable = input.mergeable ?? "UNKNOWN";
  const mergeStateStatus = input.mergeStateStatus ?? "UNKNOWN";
  const isDraft = Boolean(input.isDraft);
  const checks = input.checks ?? [];
  const requiredContexts = input.requiredContexts ?? [];

  if (isDraft) return { ok: false, reason: "pull request is draft" };
  if (mergeable === "CONFLICTING") return { ok: false, reason: "merge conflicts" };
  if (mergeable === "UNKNOWN") return { ok: false, reason: "mergeability unknown" };
  if (mergeStateStatus === "BEHIND") return { ok: false, reason: "head is behind main; restack first" };
  if (mergeStateStatus === "UNKNOWN") return { ok: false, reason: "merge state unknown" };
  if (mergeable !== "MERGEABLE") return { ok: false, reason: `mergeable=${mergeable}` };

  if (requiredContexts.length === 0) {
    // Fail closed rather than silently falling back to "every check that
    // happened to run" -- that fallback is the exact defect #1135 exists to
    // remove. A caller that could not resolve the ruleset should say so,
    // not merge blind.
    return { ok: false, reason: "no required contexts supplied; refusing to evaluate merge readiness blind" };
  }

  const { red, pending, missing } = classifyRequiredContexts(requiredContexts, checks);

  if (red.length > 0 || missing.length > 0) {
    const names = [
      ...red.map((c) => `${c.name} (${c.conclusion ?? "no conclusion"})`),
      ...missing.map((name) => `${name} (no run recorded)`),
    ].join(", ");
    return { ok: false, reason: `blocking required checks: ${names}` };
  }

  if (pending.length > 0) {
    return { ok: false, reason: `pending required checks: ${pending.join(", ")}` };
  }

  // Non-required checks are reported as context, never as blockers (#1135):
  // a red or cancelled informational signal must stay visible without being
  // a wedge that can never clear.
  const requiredNames = new Set(requiredContexts);
  const nonRequiredRed = checks.filter((check) => !requiredNames.has(check.name ?? "") && isCheckBlocking(check));

  const base = "ready to merge with --merge";
  if (nonRequiredRed.length > 0) {
    const names = nonRequiredRed.map((c) => c.name ?? "<unnamed>").join(", ");
    return { ok: true, reason: `${base} (non-required checks red, not blocking: ${names})` };
  }
  return { ok: true, reason: base };
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

function defaultNameWithOwner() {
  return execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    { encoding: "utf8" },
  ).trim();
}

/**
 * Live network call, kept out of the pure policy above and injectable at
 * every call site, the same discipline check-gate-efficacy.mjs and
 * check-attestation-freshness.mjs already use for a live ruleset dependency.
 */
function defaultFetchRequiredContexts(branch, { nameWithOwner = defaultNameWithOwner } = {}) {
  const nwo = nameWithOwner();
  const out = execFileSync(
    "gh",
    ["api", `repos/${nwo}/rules/branches/${branch}`],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return extractRequiredContexts(JSON.parse(out));
}

function prViewToCanMergeInput(view, requiredContexts) {
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
    requiredContexts,
  };
}

function runStatus(pr, { ghPrView = defaultGhPrView, fetchRequiredContexts = defaultFetchRequiredContexts } = {}) {
  const view = ghPrView(pr, ["mergeable", "mergeStateStatus", "isDraft", "statusCheckRollup", "headRefName", "baseRefName"]);
  const requiredContexts = fetchRequiredContexts(view.baseRefName || "main");
  const verdict = canMerge(prViewToCanMergeInput(view, requiredContexts));
  return { pr: Number(pr), headRefName: view.headRefName, ...verdict };
}

function runMerge(pr, { ghPrView = defaultGhPrView, fetchRequiredContexts = defaultFetchRequiredContexts, ghExec = execFileSync } = {}) {
  const status = runStatus(pr, { ghPrView, fetchRequiredContexts });
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
