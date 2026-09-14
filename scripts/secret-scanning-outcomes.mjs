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
// ONLY "push" EVENTS ARE LANDINGS
// ---------------------------------
// `gate-run-history.mjs`'s `collectJobs` gathers run history across BOTH
// `pull_request` and `push` events for the same gate. A merged pull request
// produces one row of EACH for the same real change: a `pull_request`-event
// row keyed by the PR branch's own pre-merge head SHA, and a `push`-event
// row keyed by whatever actually landed. Only the second is a landing.
// Treating both as distinct landed changes would not just inflate
// `landedCount` -- the PR head SHA is normally still resolvable via this
// checkout's own git ancestry too, so the SAME real secret could resolve as
// `observed` under both changeIds, double-counting one real escape as two.
// `unsourcedOutcomes` never surfaced this because every entry reported
// `could-not-read` regardless, so a doubled denominator was arithmetically
// invisible; it stops being invisible the moment a real per-changeId verdict
// exists. This module only ever considers `event === "push"` rows.
//
// WHY THIS COMPARES AGAINST THE PREVIOUS LANDED PUSH, NEVER A COMMIT'S OWN
// `^1` PARENT
// -------------------------------------------------------------------------
// `governance/merge-policy.json` permits BOTH "merge" and "rebase" as this
// repository's landing methods (squash is excluded, for an unrelated
// identity-leak reason stated in that file). The two have different git
// shapes, and a fixed scheme keyed off one commit's own immediate parent is
// only correct for one of them:
//
//   - A "merge" landing is a two-parent commit. Its own first parent IS the
//     previous tip of `main`, so `git rev-list <sha>^1..<sha>` correctly
//     recovers every commit the merge introduced.
//   - A "rebase" landing replays every commit in the pull request as an
//     ordinary run of single-parent commits, pushed to `main` in one
//     operation with one `head_sha` (the last replayed commit). That
//     commit's own `^1` is only the SECOND-TO-LAST replayed commit, not the
//     tip of `main` before the whole pull request landed -- so diffing
//     against `^1` examines only the final commit of a multi-commit rebase
//     landing and silently misses every earlier one. A secret introduced in
//     the first of three rebased commits would report `unobserved` -- a
//     false clean on the exact metric this module exists to keep honest.
//
// Diffing each landed push against the PREVIOUS landed push's own head SHA
// (`git rev-list <previous>..<changeId>`) is correct for both shapes,
// because it asks "what changed between the two states of `main` this
// gate's own run history already recorded", not "what does this one
// commit's git parentage imply". Ordering is derived from this checkout's
// own `git rev-list --first-parent HEAD` -- real ancestry, never the order
// `records` happened to arrive in. The OLDEST landing inside the collection
// window has no recorded predecessor to diff against; rather than fall back
// to its own `^1` (which reopens the exact rebase gap above for that one
// entry), this module reports it `could-not-read`, honestly, and the window
// heals itself on every later run as the boundary moves.
//
// A `changeId` this module cannot place in `main`'s own first-parent history
// at all (a shallow checkout boundary, or a `pull_request`-event row that
// slipped through some other caller's filtering) reports `could-not-read`
// for that entry specifically, rather than for the whole read.
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
//
// KNOWN REMAINING LIMITATION: single-page alert fetching
// ---------------------------------------------------------
// `fetchAllAlerts` and each alert's own locations page read one page (100
// items) each, matching `gate-run-history.mjs`'s own existing convention of
// a bounded page rather than following `Link` headers. A repository with
// more than 100 open-or-resolved secret-scanning alerts, or a single alert
// found at more than 100 distinct locations, would silently under-read here
// -- the same class of limitation `gate-run-history.mjs`'s `collectJobs`
// already carries for workflow runs, not newly introduced by this module.
// Not fixed here; worth fixing together with that one if it ever binds.

import { execFileSync } from "node:child_process";

const ALERTS_PER_PAGE = 100;

/** Alert dismissal reasons that mean "this was never a real secret". Every other alert counts. */
const NON_VIOLATION_RESOLUTIONS = new Set(["false_positive", "used_in_tests"]);

function couldNotRead(gate, changeId, note) {
  return { gate, changeId, violation: { state: "could-not-read", note, source: "github-secret-scanning" } };
}

/** Fetches every secret-scanning alert this token can see, open and resolved alike. One page each; see this module's header on the pagination limitation. */
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
 * Orders `changeIds` oldest-first, using THIS checkout's own first-parent
 * history from `HEAD` as ground truth — never the order `records` happened
 * to arrive in. Returns the ones it could place, in order, plus the ones it
 * could not (not part of `HEAD`'s first-parent chain at all: a shallow
 * boundary, or a row this module's caller should not have handed it).
 *
 * `execFile` is injected — the real `git` binary by default, a fixture
 * function in tests.
 */
export function orderLandedChangesChronologically(changeIds, execFile = execFileSync) {
  const out = execFile("git", ["rev-list", "--first-parent", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const position = new Map();
  out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .forEach((sha, index) => {
      if (!position.has(sha)) position.set(sha, index);
    });
  const placed = changeIds.filter((id) => position.has(id));
  const unplaced = changeIds.filter((id) => !position.has(id));
  // `git rev-list` prints newest-first; a LARGER index is therefore OLDER.
  placed.sort((a, b) => position.get(b) - position.get(a));
  return { ordered: placed, unplaced };
}

/**
 * Every commit SHA introduced between two landed pushes:
 * `git rev-list <previousChangeId>..<changeId>`. See this module's own
 * header for why this is the diff base, never a commit's own `^1`.
 */
export function commitsIntroducedSince(previousChangeId, changeId, execFile = execFileSync) {
  const out = execFile("git", ["rev-list", `${previousChangeId}..${changeId}`], {
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
 * secret-scanning alerts, for every `push`-event `changeId` in `records`
 * matching `gate`.
 *
 * Never throws: a transport failure reading alerts or locations reports
 * `could-not-read` for every requested change (an unreadable alert list
 * must not silently shrink the denominator the way one unreadable run
 * already must not, per `gate-run-history.mjs`'s own `collectJobs`); a
 * `changeId` git cannot place in history reports `could-not-read` for that
 * entry alone; the oldest placed entry in the window reports
 * `could-not-read` because it has no recorded predecessor to diff against.
 */
export async function secretScanningOutcomes({ fetchJson, owner, repo, records, gate, execFile = execFileSync }) {
  const changeIds = [
    ...new Set(records.filter((r) => r.gate === gate && r.event === "push").map((r) => r.changeId)),
  ];
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

  let ordered;
  let unplaced;
  try {
    ({ ordered, unplaced } = orderLandedChangesChronologically(changeIds, execFile));
  } catch (error) {
    const note = `could not read this checkout's own first-parent history to order landed changes: ${error?.message ?? error}`;
    return changeIds.map((changeId) => couldNotRead(gate, changeId, note));
  }

  const outcomes = [];
  for (const changeId of unplaced) {
    outcomes.push(
      couldNotRead(
        gate,
        changeId,
        `${changeId} is not part of this checkout's own first-parent history from HEAD (a shallow boundary, ` +
          "or a row that was not actually a landing on the default branch)",
      ),
    );
  }
  ordered.forEach((changeId, index) => {
    if (index === 0) {
      outcomes.push(
        couldNotRead(
          gate,
          changeId,
          "this is the oldest landing in the current collection window; this checkout cannot tell what changed " +
            "since before it without walking past the window, and guessing its own git parent would silently " +
            "miss earlier commits of a rebase-merged landing (governance/merge-policy.json permits rebase)",
        ),
      );
      return;
    }
    const previousChangeId = ordered[index - 1];
    let introduced;
    try {
      introduced = commitsIntroducedSince(previousChangeId, changeId, execFile);
    } catch (error) {
      outcomes.push(
        couldNotRead(
          gate,
          changeId,
          `could not resolve which commits landed between ${previousChangeId} and ${changeId}: ` +
            `${error?.message ?? error}`,
        ),
      );
      return;
    }
    const escaped = introduced.some((sha) => violatingCommits.has(sha)) || violatingCommits.has(changeId);
    outcomes.push({
      gate,
      changeId,
      violation: escaped
        ? { state: "observed", source: "github-secret-scanning" }
        : { state: "unobserved", source: "github-secret-scanning" },
    });
  });

  return outcomes;
}
