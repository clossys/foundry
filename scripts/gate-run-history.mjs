#!/usr/bin/env node
// gate-run-history — a RunHistoryReader for @vespeneventures/observer, backed
// by this repository's own GitHub Actions history.
//
// @vespeneventures/observer ships ZERO implementations of `RunHistoryReader`,
// deliberately: "a caller wires up its own reader against whatever run-history
// source its plane actually has." This is that caller. It is the reason the
// package's own header gives for the port existing, supplied for the first
// time — before this file, `computeGateEfficacy` had no caller anywhere in
// this fleet, so every close condition that depends on observer reporting a
// number depended on a number nobody computed.
//
// WHAT A "GATE" IS HERE
// ---------------------
// One GitHub Actions JOB. The job's `name` is the gate id, its `conclusion`
// is the verdict, and the workflow run's `head_sha` is the change id. Those
// are facts this repository's CI already recorded and closed; nothing here
// re-runs a check, re-reads a tree, or forms an opinion about whether a rule
// was violated. That separation is the structural rule observer exists to
// keep: the measurer must not be the measured.
//
// A job that is `skipped` did not run. That is recorded as `ran: false`
// rather than as a verdict, because "the gate was skipped" and "the gate ran
// and passed" are the two states this whole programme keeps finding collapsed
// into one another.
//
// WHY THE FETCHER IS INJECTED
// ----------------------------
// Same discipline the package itself uses. `createGateRunHistoryReader` takes
// a `fetchJson` function; the CLI supplies one backed by `gh api`, and tests
// supply a fixture. Nothing in this module opens a socket, so a disputed
// report is re-checkable offline from the same recorded pages.
//
// FAIL CLOSED, WHICH HERE MEANS "could-not-read"
// -----------------------------------------------
// Run history is frequently unreadable without a credential. Every failure
// path -- no token, an API error, a rate limit, an unparseable page --
// returns `could-not-read` with a reason. It never returns an empty
// `observed` record set, because "I read the history and this gate never ran"
// and "I could not read the history" are different facts and only one of them
// is evidence.

/** One page of workflow runs is this many; GitHub caps `per_page` at 100. */
const RUNS_PER_PAGE = 100;

/**
 * The events that represent A CHANGE BEING GATED, and nothing else.
 *
 * Measured on this repository: of the last 100 workflow runs, 74 were
 * `issue_comment`, `issues`, `pull_request_review`, `pull_request_review_comment`
 * or `pull_request_target`. Those are real workflows doing real work, but they
 * are not gates on a change, and every one of them is attributed to the
 * DEFAULT BRANCH's head_sha -- so counting them collapses many runs onto one
 * change id and reports a denominator of 1 for a gate that ran ten times.
 * That was this reader's first result, and it is why the filter exists.
 *
 * `pull_request_target` is the deliberate exclusion worth naming: it does gate
 * a change, but it runs against the BASE commit, so its `head_sha` names the
 * thing being merged into rather than the thing being merged. Including it
 * with a wrong change id would be worse than excluding it -- a wrong
 * denominator that looks computed. Excluding it is recorded here rather than
 * silently applied.
 */
export const CHANGE_EVENTS = ["pull_request", "push"];

/** Actions conclusions that mean the job did not execute its steps. */
const DID_NOT_RUN = new Set(["skipped", "cancelled", null, undefined]);

// `Observation<TObserved>` SPREADS the observed payload onto the envelope --
// `{ state: "observed", records }`, not `{ state, value: { records } }` -- and
// names the failure field `note`, not `reason`. Both shapes are the package's,
// verified against observation.ts rather than assumed.
function observed(records) {
  return { state: "observed", records, source: "github-actions" };
}

function couldNotRead(note) {
  return { state: "could-not-read", note, source: "github-actions" };
}

/**
 * Collect every job across the most recent workflow runs on one branch.
 *
 * Returns `{ ok: true, jobs }` or `{ ok: false, reason }` -- never throws for
 * a transport or shape problem, because the caller turns those into
 * `could-not-read` rather than into an exception that would take down the
 * whole report.
 */
export async function collectJobs({ fetchJson, owner, repo, events = CHANGE_EVENTS, runLimit = RUNS_PER_PAGE }) {
  // One query PER EVENT rather than one unfiltered page. The API takes a
  // single `event` value, and an unfiltered page here is ~74% conversation
  // traffic -- so a single page would spend most of its budget on runs this
  // reader then discards, and silently shrink the window it reports on.
  const runs = [];
  for (const event of events) {
    let page;
    try {
      page = await fetchJson(`repos/${owner}/${repo}/actions/runs?event=${encodeURIComponent(event)}&per_page=${runLimit}`);
    } catch (error) {
      return { ok: false, reason: `could not list "${event}" workflow runs: ${error?.message ?? error}` };
    }
    if (!page || !Array.isArray(page.workflow_runs)) {
      return { ok: false, reason: `the "${event}" workflow-runs response had no \`workflow_runs\` array — a changed API shape, or an error body` };
    }
    runs.push(...page.workflow_runs);
  }

  const jobs = [];
  for (const run of runs) {
    if (typeof run?.id !== "number" || typeof run?.head_sha !== "string") continue;
    let jobsPage;
    try {
      jobsPage = await fetchJson(`repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=${RUNS_PER_PAGE}`);
    } catch (error) {
      // One unreadable run must not silently shrink the denominator for every
      // gate. Refuse the whole read instead of reporting a partial history as
      // if it were complete.
      return { ok: false, reason: `could not read jobs for run ${run.id}: ${error?.message ?? error}` };
    }
    if (!jobsPage || !Array.isArray(jobsPage.jobs)) {
      return { ok: false, reason: `the jobs response for run ${run.id} had no \`jobs\` array` };
    }
    for (const job of jobsPage.jobs) {
      if (typeof job?.name !== "string") continue;
      jobs.push({ gate: job.name, changeId: run.head_sha, conclusion: job.conclusion ?? null });
    }
  }
  return { ok: true, jobs };
}

/** Map collected jobs into observer's `GateRunRecord` shape. */
export function toRunRecords(jobs, gate) {
  return jobs
    .filter((job) => job.gate === gate)
    .map((job) => {
      const ran = !DID_NOT_RUN.has(job.conclusion);
      return ran ? { gate, changeId: job.changeId, ran: true, verdict: job.conclusion } : { gate, changeId: job.changeId, ran: false };
    });
}

/** Every distinct job name seen, which is every gate this repository actually ran. */
export function gatesSeen(jobs) {
  return [...new Set(jobs.map((job) => job.gate))].sort();
}

/**
 * Build a `RunHistoryReader` over an already-collected job list.
 *
 * Collection happens ONCE, ahead of the reader, so that reading N gates costs
 * one traversal rather than N. The reader itself is then pure.
 */
export function createGateRunHistoryReader(collected) {
  if (!collected?.ok) {
    const reason = collected?.reason ?? "run history was never collected";
    return { readRunHistory: () => couldNotRead(reason) };
  }
  return { readRunHistory: (gate) => observed(toRunRecords(collected.jobs, gate)) };
}

/**
 * Ground truth for the escape rate, which this repository does not have yet.
 *
 * `LandedChangeOutcome.violation` must be an INDEPENDENT judgment that a
 * landed change actually violated the rule -- from a later audit, an incident
 * report, or a downstream detector, and explicitly never the gate's own
 * recorded verdict. Feeding a gate's own "success" back in as "no violation"
 * would measure whether the gate agrees with itself.
 *
 * Nothing in this repository produces such a judgment today. So every landed
 * change is reported `could-not-read`, which makes `couldNotReadCount` equal
 * `landedCount` and the resulting rate a LOWER BOUND of zero -- not evidence
 * of a clean history. Reporting an unsourced zero as a real rate is the exact
 * defect this fleet has already found: a rate reading zero for the wrong
 * reason.
 */
export function unsourcedOutcomes(records, gate) {
  return [...new Set(records.filter((r) => r.gate === gate).map((r) => r.changeId))].map((changeId) => ({
    gate,
    changeId,
    violation: { state: "could-not-read", note: "no independent violation source is wired in this repository" },
  }));
}
