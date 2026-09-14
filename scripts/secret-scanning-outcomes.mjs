#!/usr/bin/env node

// secret-scanning-outcomes — an independent `LandedChangeOutcome` source for
// @clossys/observer's escape-rate metric, for the "publish safety" gate
// (the CI job that runs gitleaks; see .github/workflows/ci.yml).
//
// #484 / .github/workflows/gate-efficacy.yml's own header name the gap this
// closes: `LandedChangeOutcome.violation` must be an INDEPENDENT judgment
// that a landed change actually violated a rule -- "a later audit, an
// incident report, a downstream detector, anything except the gate's own
// recorded verdict for that run" (see @clossys/observer's
// escape-rate.ts header). Before this file, nothing in this repository
// produced one, so `scripts/gate-run-history.mjs`'s `unsourcedOutcomes`
// reported `could-not-read` for every landed change, unconditionally.
//
// THE INDEPENDENT SOURCE: GitHub's OWN secret scanning
// -----------------------------------------------------
// This repository is public, and GitHub's native secret-scanning feature is
// enabled on it (verified empirically: `gh api repos/<owner>/<repo>/secret-
// scanning/alerts` returns a real, readable array -- an unavailable feature
// answers 404, not `[]`). That scanner is a genuine "downstream detector" in
// the sense escape-rate.ts requires: it is not invoked by this repository's
// own CI, does not share gitleaks' engine or ruleset, cannot be influenced
// by a pull request's own changes to this repository's workflows or scripts,
// and runs continuously against every push regardless of what any workflow
// here decides. Feeding its alerts in as ground truth does not measure
// whether the safety job agrees with itself -- it measures whether a
// SEPARATE system GitHub operates ever found something the safety job's own
// gitleaks step did not stop.
//
// WHY EXACT-SHA MATCHING WOULD HAVE BEEN WRONG
// -----------------------------------------------
// This repository merges pull requests as merge commits (squash merge is
// disabled repository-wide) — see AGENTS.md and every merge workflow's own
// comments. The commit that actually introduces a secret is therefore
// almost always one of the pull request's OWN commits, not the merge commit
// that lands on `main` and becomes the "push" event's `head_sha` (the
// `changeId` this module is asked to judge). Comparing a secret-scanning
// alert's location only against that merge commit's own SHA would silently
// MISS almost every real escape and report a rate that looks computed but
// is not — worse than admitting `could-not-read`. This module instead asks
// git itself which commits a landed change actually introduced:
// `git rev-list <changeId>^1..<changeId>` — every commit reachable from the
// landed merge commit but not from its own first parent (the previous tip
// of `main`), which is exactly the merge's own commit plus every commit
// unique to the branch it merged in, regardless of how many pull requests or
// commits that represents. This requires the calling job's checkout to have
// full history (`fetch-depth: 0`); a shallow checkout cannot resolve
// `<sha>^1` for a commit near the shallow boundary and this module reports
// `could-not-read` rather than guess when it cannot.
//
// A `changeId` this module cannot resolve locally at all (for example, a
// `pull_request`-event run's own head SHA -- the pre-merge branch tip, which
// a checkout of `main`'s history never contains) reports `could-not-read`
// for that entry specifically, honestly, rather than for the whole read.
//
// DISMISSALS THAT ARE NOT VIOLATIONS
// -------------------------------------
// An alert GitHub's own maintainers dismissed as `false_positive` or
// `used_in_tests` is not evidence that a real secret reached this
// repository -- counting it as an escape would manufacture a violation this
// repository never actually had. Every other alert (open, or resolved by
// revocation, or dismissed for any other reason) counts as a real, landed
// secret: reaching `main` at all is the fact the safety job exists to
// prevent, independent of whether it was later cleaned up.

import { execFileSync } from "node:child_process";

const ALERTS_PER_PAGE = 100;

/** Alert dismissal reasons that mean "this was never a real secret". Every other alert counts. */
const NON_VIOLATION_RESOLUTIONS = new Set(["false_positive", "used_in_tests"]);

function couldNotRead(gate, changeId, note) {
  return { gate, changeId, violation: { state: "could-not-read", note, source: "github-secret-scanning" } };
}

/** Fetches every secret-scanning alert this token can see, open and resolved alike. One page each, matching this repository's existing `gate-run-history.mjs` convention of a bounded single page rather than following `Link` headers. */
async function fetchAllAlerts(fetchJson, owner, repo) {
  const open = await fetchJson(`repos/${owner}/${repo}/secret-scanning/alerts?state=open&per_page=${ALERTS_PER_PAGE}`);
  const resolved = await fetchJson(`repos/${owner}/${repo}/secret-scanning/alerts?state=resolved&per_page=${ALERTS_PER_PAGE}`);
  if (!Array.isArray(open) || !Array.isArray(resolved)) {
    throw new Error("secret-scanning alerts response was not an array — a changed API shape, or an error body");
  }
  return [...open, ...resolved];
}

/** Every commit SHA any true-violation alert was ever located at. */
async function collectViolatingCommits(fetchJson, owner, repo, alerts) {
  const violating = new Set();
  for (const alert of alerts) {
    if (NON_VIOLATION_RESOLUTIONS.has(alert?.resolution)) continue;
    if (typeof alert?.number !== "number") continue;
    const locations = await fetchJson(
      `repos/${owner}/${repo}/secret-scanning/alerts/${alert.number}/locations?per_page=${ALERTS_PER_PAGE}`,
    );
    if (!Array.isArray(locations)) {
      throw new Error(`locations response for secret-scanning alert #${alert.number} was not an array`);
    }
    for (const location of locations) {
      const sha = location?.details?.commit_sha;
      if (typeof sha === "string" && sha !== "") violating.add(sha);
    }
  }
  return violating;
}

/**
 * Every commit SHA introduced by landing `changeId`, resolved from THIS
 * job's own local checkout — never a remote call. Throws (caller catches)
 * for a `changeId` this checkout cannot resolve at all: a shallow history
 * boundary, or a `changeId` that was never part of `main`'s own ancestry
 * (a `pull_request`-event run's pre-merge head SHA).
 *
 * `execFile` is injected — the real `git` binary by default, a fixture
 * function in tests — the same seam this repository's other scripts use
 * for every subprocess and network call (see `check-gate-efficacy.mjs`'s
 * own `ghFetchJson`).
 */
export function commitsIntroducedBy(changeId, execFile = execFileSync) {
  const out = execFile("git", ["rev-list", `${changeId}^1..${changeId}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Builds real `LandedChangeOutcome` rows for `gate` from GitHub's own
 * secret-scanning alerts, for every `changeId` in `records` matching `gate`.
 *
 * Never throws: a transport failure reading alerts or locations reports
 * `could-not-read` for every requested change (an unreadable alert list
 * must not silently shrink the denominator the way one unreadable run
 * already must not, per `gate-run-history.mjs`'s own `collectJobs`); a
 * `changeId` git cannot resolve reports `could-not-read` for that entry
 * alone.
 */
export async function secretScanningOutcomes({ fetchJson, owner, repo, records, gate, execFile = execFileSync }) {
  const changeIds = [...new Set(records.filter((r) => r.gate === gate).map((r) => r.changeId))];
  if (changeIds.length === 0) return [];

  let alerts;
  try {
    alerts = await fetchAllAlerts(fetchJson, owner, repo);
  } catch (error) {
    const note = `could not read secret-scanning alerts: ${error?.message ?? error}`;
    return changeIds.map((changeId) => couldNotRead(gate, changeId, note));
  }

  let violatingCommits;
  try {
    violatingCommits = await collectViolatingCommits(fetchJson, owner, repo, alerts);
  } catch (error) {
    const note = `could not read secret-scanning alert locations: ${error?.message ?? error}`;
    return changeIds.map((changeId) => couldNotRead(gate, changeId, note));
  }

  return changeIds.map((changeId) => {
    let introduced;
    try {
      introduced = commitsIntroducedBy(changeId, execFile);
    } catch (error) {
      return couldNotRead(
        gate,
        changeId,
        `could not resolve which commits ${changeId} introduced from this checkout's own history ` +
          `(needs full history and ${changeId} to be part of it): ${error?.message ?? error}`,
      );
    }
    const escaped = introduced.some((sha) => violatingCommits.has(sha)) || violatingCommits.has(changeId);
    return {
      gate,
      changeId,
      violation: escaped
        ? { state: "observed", source: "github-secret-scanning" }
        : { state: "unobserved", source: "github-secret-scanning" },
    };
  });
}
