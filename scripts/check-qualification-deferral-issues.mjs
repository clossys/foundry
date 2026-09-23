#!/usr/bin/env node
// check-qualification-deferral-issues — for every acknowledged deferral under
// governance/release-qualification-deferrals/, is the tracking issue it cites
// still OPEN?
//
//   node scripts/check-qualification-deferral-issues.mjs [--json]
//
// Exit 0 = every declared deferral cites an issue that is still open (or the
// file declares no deferrals at all). Exit 1 = at least one deferral cites a
// CLOSED issue. Exit 2 = the question could not be answered for at least one
// entry — the deferrals file could not be read, the GitHub API returned an
// error, or no credential was available. Same three-state contract every
// gate CLI in this repository uses (CONTRIBUTING.md's "Gate CLIs exit
// `0`/`1`/`2` — `2` is not a variant of failure"): a check that cannot run
// must fail, never silently pass. Per docs/LIFECYCLE.md's eighth value, an
// entry this script could not resolve is reported as its own
// `not-applicable` status, with a reason — never folded into a `pass`.
//
// WHY THIS EXISTS (issue #1136)
// ------------------------------
// governance/release-qualification-deferrals/README.md's own explanation says
// the store is "a countdown, not a standing exemption -- the gate refuses to
// let an entry outlive its reason." scripts/check-qualification-record-required.mjs
// enforces the RECORD half of that faithfully (a deferral goes stale once a
// retained, matching record exists — see its checkStaleDeferrals()) but never
// checks the ISSUE half: nothing anywhere confirms that the tracking issue a
// deferral cites is still open. Measured on this tree at the time #1136 was
// filed, three live entries cited already-CLOSED issues (controller@0.9.9
// and customer@0.1.0 -> #833, writer@0.3.14 -> #1063) — a standing exemption
// wearing a countdown's clothes, undetectable by reading a file that had
// grown to 59 entries. This script only detects that; it deliberately does
// not remove any entry (see .github/workflows/qualification-deferral-sweep.yml
// and the #1136 pull request for the three known findings on this tree).
//
// WHY THIS IS A SEPARATE SCRIPT, NOT A NEW CHECK INSIDE
// check-qualification-record-required.mjs
// -------------------------------------------------------
// That gate runs in ci.yml's dependency-free `safety` job — every one of its
// steps is a single `node scripts/...mjs` invocation with no network, no
// token, and no `npm ci` — and it must stay that way (see its own header,
// and scripts/check-gate-efficacy.mjs / check-merge-policy.mjs for the same
// discipline elsewhere in this repository). Resolving an issue's live state
// needs the GitHub API and a token, which that job does not have and should
// not be given just for this. This script is the "networked companion" #1136
// asks for, run separately in a lane that already holds one — the same
// reason check:conversation, check:package-visibility, check:merge-policy,
// and check:registry-parity all stay out of `check:gates` and `check` and
// run in their own scheduled workflow instead (see their own headers).
//
// WHY THIS IS A SCHEDULED SWEEP, NOT ONLY A PULL-REQUEST CHECK
// ---------------------------------------------------------------
// A deferral's cited issue can close days or weeks after the pull request
// that added the deferral has already merged with every check green — an
// event-time check cannot re-ask a question whose answer changed later. This
// is the structurally identical reason
// .github/workflows/conversation-safety-sweep.yml exists as a companion to
// conversation-safety.yml's event gate (see that workflow's own header): the
// only way to catch drift that happens after the triggering event is to
// re-ask on a cadence. This script is that re-ask for the deferral file's
// issue half; .github/workflows/qualification-deferral-sweep.yml is the
// cadence that calls it.
//
// DERIVED FROM THE FILE, NEVER A LITERAL LIST (#907)
// -----------------------------------------------------
// The entry set this script checks is whatever
// check-qualification-record-required.mjs's own loadDeferrals() returns for
// governance/release-qualification-deferrals/ at run time — reused
// rather than re-parsed, so the two scripts can never disagree about what a
// valid deferral entry looks like. Nothing here hard-codes a package name, a
// version, or an issue number.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDeferrals } from "./check-qualification-record-required.mjs";
import { ghFetchJson } from "./lib/gh-api.mjs";

/**
 * Pure evaluation: given the deferral entries already parsed from
 * governance/release-qualification-deferrals/ (loadDeferrals()'s own
 * `entries` output) and an injectable issue fetcher, decide each entry's
 * status. No network call lives in this function — `fetchIssue` is the only
 * IO, and the CLI edge below is the only place that wires it to the real
 * GitHub API — the same "policy is pure, network is injectable" discipline
 * scripts/land-stack.mjs and scripts/check-merge-policy.mjs already use.
 *
 * @param {Array<{package: string, version: string, reason: string, issue: number}>} entries
 * @param {(issueNumber: number) => {state?: string}} fetchIssue
 * @returns {Array<{
 *   package: string, version: string, issue: number,
 *   status: "pass"|"fail"|"not-applicable",
 *   detail: string,
 * }>}
 */
export function evaluateDeferralIssues(entries, fetchIssue) {
  const results = [];
  for (const entry of entries) {
    const label = `${entry.package}@${entry.version}`;
    let issue;
    try {
      issue = fetchIssue(entry.issue);
    } catch (error) {
      results.push({
        package: entry.package,
        version: entry.version,
        issue: entry.issue,
        status: "not-applicable",
        detail: `${label}: could not resolve issue #${entry.issue} (${error instanceof Error ? error.message : String(error)}) — the API could not be reached, so this entry's state is unknown, not clean`,
      });
      continue;
    }

    const rawState = typeof issue?.state === "string" ? issue.state.toLowerCase() : null;
    if (rawState === "closed") {
      results.push({
        package: entry.package,
        version: entry.version,
        issue: entry.issue,
        status: "fail",
        detail: `${label}: cites issue #${entry.issue}, which is CLOSED — the countdown has expired. Remove the deferral and produce the qualification record, or reopen the issue with a live reason.`,
      });
    } else if (rawState === "open") {
      results.push({
        package: entry.package,
        version: entry.version,
        issue: entry.issue,
        status: "pass",
        detail: `${label}: issue #${entry.issue} is open`,
      });
    } else {
      results.push({
        package: entry.package,
        version: entry.version,
        issue: entry.issue,
        status: "not-applicable",
        detail: `${label}: issue #${entry.issue} returned an unrecognized or missing state (${JSON.stringify(issue?.state ?? null)}) — treated as unresolved, never as a pass`,
      });
    }
  }
  return results;
}

function defaultFetchIssue(nameWithOwner) {
  return (issueNumber) => ghFetchJson(`repos/${nameWithOwner}/issues/${issueNumber}`);
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const root = process.cwd();

  const { entries, findings } = loadDeferrals(root);
  if (entries === null) {
    const message = `deferrals file could not be read: ${findings.map((f) => f.message).join("; ")}`;
    if (json) console.log(JSON.stringify({ status: "not-applicable", reason: message, results: [] }, null, 2));
    else console.error(`check-qualification-deferral-issues: NOT-APPLICABLE — ${message}`);
    process.exit(2);
  }

  if (entries.length === 0) {
    const message = "governance/release-qualification-deferrals/ declares no deferrals — nothing to check";
    if (json) console.log(JSON.stringify({ status: "pass", reason: message, results: [] }, null, 2));
    else console.log(`check-qualification-deferral-issues: OK — ${message}`);
    process.exit(0);
  }

  let nameWithOwner;
  try {
    nameWithOwner = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" }).trim();
  } catch (error) {
    const message = `could not resolve this repository's owner/name via \`gh repo view\`: ${error instanceof Error ? error.message : String(error)}`;
    if (json) console.log(JSON.stringify({ status: "not-applicable", reason: message, results: [] }, null, 2));
    else console.error(`check-qualification-deferral-issues: NOT-APPLICABLE — ${message}`);
    process.exit(2);
  }

  const results = evaluateDeferralIssues(entries, defaultFetchIssue(nameWithOwner));

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const labels = { pass: "OK  ", fail: "FAIL", "not-applicable": "N/A " };
    for (const r of results) console.log(`  [${labels[r.status]}] ${r.detail}`);
  }

  const anyFail = results.some((r) => r.status === "fail");
  const anyNotApplicable = results.some((r) => r.status === "not-applicable");
  // Same worst-of-three-way aggregation check-qualification-record-required.mjs
  // (this script's sibling) and check-release-readiness.mjs use: an entry
  // this script never resolved dominates a confirmed finding, which
  // dominates a clean pass — see docs/DECISIONS.md entry 23 for how a gate
  // picks between 1 and 2 when a single run holds both.
  const code = anyNotApplicable ? 2 : anyFail ? 1 : 0;

  if (!json) {
    console.log("");
    console.log(
      code === 0
        ? "QUALIFICATION DEFERRAL ISSUES — OK. Every declared deferral cites an issue that is still open."
        : code === 2
          ? "QUALIFICATION DEFERRAL ISSUES — NOT APPLICABLE (partial). At least one deferral's issue state could not be resolved — see the N/A lines above. This is not a pass."
          : "QUALIFICATION DEFERRAL ISSUES — FAIL. At least one deferral cites a CLOSED issue — see the FAIL lines above. The countdown has expired: remove the deferral and produce the record, or reopen the issue.",
    );
  }
  process.exit(code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
