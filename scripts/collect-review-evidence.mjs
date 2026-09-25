#!/usr/bin/env node
// collect-review-evidence — the collection half of the review-evidence
// standards check (issue #403).
//
//   node scripts/collect-review-evidence.mjs --pr <number> --head <sha>
//     [--repo <owner>/<name>] [--branch <base-branch>]
//     [--policy <path>] [--merge <path>]
//     [--required-checks-from-ruleset] [--require-review-presence]
//
//   node scripts/collect-review-evidence.mjs \
//     --merge-group-head-ref <refs/heads/gh-readonly-queue/base/pr-N-sha> \
//     --merge-group-head-sha <merge_group.head_sha> \
//     [--repo <owner>/<name>] [--branch <base-branch>] [--merge <path>] ...
//
// The second form is a merge-group run's own way of naming --pr/--head: a
// `merge_group` event carries no `pull_request` object at all, only its own
// synthetic `head_ref` and the group commit it built (`head_sha`). The ref
// names the queued PR's NUMBER; the sha embedded in it is the BASE the entry
// was queued onto, never the PR's head (see `parseMergeGroupQueueRef`'s own
// doc comment for the measurement). So the commit under test is resolved in
// two independent steps: the PR's current head is read from the pull
// request itself (a REST read, separate from the GraphQL query the evidence
// comes from), and that head is then PROVEN to be exactly the group commit's
// second parent (`git rev-parse --verify <group>^2`) -- what this entry
// merges under the ruleset's MERGE method, not merely some ancestor. Both
// facts are handed to the inspector (`options.headShaUnderTest`,
// `options.mergeGroup`), which fails closed on either one. A malformed ref, a malformed group sha, or a head
// that cannot be read refuses to collect evidence rather than guessing.
// `--merge-group-head-ref` always overrides `--pr`/`--head` when both are
// given.
//
// Prints a `VerifyStandardsInputs`-shaped JSON document (see
// packages/inspector/src/verify.ts) carrying a populated `reviewEvidence`
// section, ready to feed `packages/inspector/dist/bin.js --checks
// review-evidence`. Exit 0 = a document was produced (which does not mean
// the change PASSES review — that is `bin.js`'s decision, not this
// script's). Exit 1 = the document could not be assembled at all (bad
// arguments, unreadable policy file, an API call this script has no
// fallback for).
//
// WHY THIS EXISTS
// ---------------
// `packages/inspector/src/review-evidence.ts` (`checkReviewEvidence`) and
// `packages/controller/src/review/github.ts` (`normalizeGitHubReviewEvidence`)
// both shipped complete and untested-in-anger, because nothing in this
// repository ever called them (#403). This is that caller: it collects
// GitHub's own review records — approvals, requested changes, resolved and
// unresolved threads, required-check conclusions — at one exact head, and
// shapes them into the bundle `validateReviewEvidence` consumes. It invokes
// no model reviewer, waits on none, and does not decide whether the absence
// of a review is itself a failure (`--require-review-presence` defaults to
// off; see `checkReviewEvidenceOptions` below) — matching AGENTS.md's "Model-
// assisted code review is manually initiated. Do not add a background model
// reviewer or make repository workflows wait for provider-specific review
// evidence."
//
// WHY THIS DOES NOT IMPORT `@clossys/controller` OR `@clossys/inspector`
// ------------------------------------------------------------------------
// This file, and its test, are wired into `check:gates`, which runs BEFORE
// `npm run build` (see package.json's own comments on `check:gates` and
// `check:verify-inputs`). A script wired there cannot import a workspace
// package's compiled output, which does not exist yet at that point in the
// chain. So the normalization this file performs is its own — not a
// wrapper around `normalizeGitHubReviewEvidence` — kept deliberately
// narrow and mirrored field-for-field against
// `packages/controller/src/review/types.ts` and `.../github.ts` rather than
// re-derived from memory. `.github/scripts/assemble-verify-inputs.mjs` is
// the sibling collector that DOES import a built package, and it can
// because its own test runs in `check:verify-inputs`, after `npm run
// build` — this script intentionally stays out of that lane so its test
// can run earlier and everywhere `check:gates` does.
//
// WHY THIS LIVES IN scripts/, NOT .github/scripts/
// --------------------------------------------------
// `.github/scripts/` holds collectors that already assume a built package
// is on hand. Every dependency-free, `gh`-driven collector or conductor —
// land-stack.mjs, check-merge-policy.mjs, check-qualification-deferral-
// issues.mjs — lives in plain `scripts/`, importable by a contributor from
// their own machine with an authenticated `gh`, with no build step first.
// This script follows that precedent.
//
// REQUIRED CHECKS ARE DERIVED FROM THE RULESET, NEVER A LITERAL (#907)
// -----------------------------------------------------------------------
// `deriveRequiredChecksFromRuleset` reuses `extractRequiredContexts` from
// `scripts/land-stack.mjs` — the same function #1135 introduced so this
// repository's required-context set is read from
// `gh api repos/{owner}/{repo}/rules/branches/{branch}` exactly once. This
// script's OWN context (`verify-standards`, the job name in
// `.github/workflows/verify-standards.yml`) is always excluded from that
// derived set: at the moment this script runs, its own containing job has
// not concluded, so treating its own required-status-check entry as
// gradable evidence would either self-deadlock or grade a run against
// itself mid-flight. See `EXCLUDED_SELF_CONTEXTS`.
//
// WHY THE DEFAULT POLICY'S `requiredChecks` IS EMPTY, NOT THE FULL RULESET
// ----------------------------------------------------------------------------
// `--required-checks-from-ruleset` is a real, tested capability (the thing
// #403 asks a collector to have), but `.github/verify-standards-review-
// policy.json` does not turn it on yet. Measured against this repository's
// own live ruleset: several of the 14 sibling required contexts run in
// `ci.yml`, a SEPARATE workflow from `verify-standards.yml`, triggered by
// the same event but under no ordering guarantee relative to it. A sibling
// check that has not yet produced a run is graded `required-check-failed`
// (a VIOLATION, not `indeterminate` — see `ReviewFindingRule`'s own
// `"required-check-indeterminate"` doc comment: an unobserved name is
// `missing-required-check`; only a NAME THAT WAS OBSERVED but is unresolved
// between runs is `indeterminate`), so wiring the full set in today would
// make every fresh pull request's `review-evidence` row read VIOLATED for
// as long as its slower siblings are still queued — the exact "workflow
// waits for provider-specific review evidence" shape AGENTS.md's
// constraint warns against, just produced by CI timing instead of a model
// reviewer. Leaving it empty keeps today's rollout to what the evidence
// bundle's OWN unconditional rules already cover honestly — an unresolved
// thread or a changes-requested review at the current head — without
// inventing a race this script cannot itself resolve. Turning on
// `--required-checks-from-ruleset` (or a hand-picked subset) is a separate,
// later decision for whoever owns that call, once the ordering question
// above has an answer.
//
// THE HEAD-MISMATCH CHECK IS THE WHOLE POINT (#403's two-direction proof)
// -----------------------------------------------------------------------
// `headShaUnderTest` is read from `--head`, the CALLER's own claim about
// which commit this run is about (in the real workflow,
// `github.event.pull_request.head.sha` — the exact commit the triggering
// event named), never derived from whatever the live GraphQL query happens
// to return for `pullRequest.headRefOid`. Those two values are usually the
// same commit, but they are two INDEPENDENT reads, taken this way on
// purpose: a live query answers "what does GitHub say the head is RIGHT
// NOW", and `--head` answers "what commit is this specific CI run
// actually testing". A push landing between the triggering event and this
// script's own API call — or a stale, replayed workflow run — makes them
// disagree, and `checkReviewEvidence` (see its own `headShaUnderTest` doc
// comment) reports that disagreement as `indeterminate`, never `violated`:
// evidence about a different commit is not evidence AGAINST this one, it
// is simply not evidence about this one. See
// `scripts/collect-review-evidence.test.mjs`'s
// "evidence bound to a different head" cases for exactly this constructed
// both ways.
//
// A MECHANICAL MERGE FROM THE TARGET BRANCH IS THE ONE NAMED EXCEPTION (#1428)
// ------------------------------------------------------------------------------
// The head-mismatch check above is deliberately strict, but it used to make
// no exception at all for the one push that changes nothing a reviewer
// looked at: a merge of the target branch into an already-approved pull
// request, done cleanly. That case still needed a human to run `git show
// --remerge-diff` by hand and post a carry-forward comment. This file's own
// "MECHANICAL-MERGE CARRY" section (below, before the I/O boundary) proves
// that shape from git history — never assumed, never asked of the caller —
// and rebinds the carried approval's `headSha` before evidence ever reaches
// `checkReviewEvidence`. See that section's own header for the two-part
// proof and its threat model.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { extractRequiredContexts } from "./land-stack.mjs";

/** The only review-evidence schema this script emits (mirrors REVIEW_EVIDENCE_VERSION in packages/controller/src/review/types.ts). */
export const REVIEW_EVIDENCE_SCHEMA_VERSION = 3;
/** The only verify-standards inputs schema this script emits (mirrors VERIFY_STANDARDS_INPUTS_VERSION in packages/inspector/src/verify.ts). */
export const VERIFY_STANDARDS_INPUTS_VERSION = 1;

const SHA = /^[0-9a-f]{40}$/;

/** This script's own context, excluded from a ruleset-derived required-check set. See this file's own header. */
export const EXCLUDED_SELF_CONTEXTS = Object.freeze(["verify-standards"]);

function isSha(value) {
  return typeof value === "string" && SHA.test(value);
}

/**
 * A `merge_group` event names no PR directly — `pull_request.number` and
 * `pull_request.head.sha` simply do not exist on that payload. What it
 * carries instead is `head_ref`, the queue's own synthetic ref, shaped
 * `refs/heads/gh-readonly-queue/<base>/pr-<number>-<sha>`.
 *
 * `<sha>` there is the BASE this entry was queued onto (the base branch's
 * tip, or the entry ahead of it) — NOT the queued PR's own head. Measured on
 * run 35929488634 (#1253): head_ref `gh-readonly-queue/main/pr-1374-5784ce21…`,
 * group commit 141ba434 with parents [5784ce21 (main's tip), b7fb8925 (PR
 * #1374's head)]. An earlier version of this function read that sha as the
 * PR head, so every merge-group run reported `evidence-head-mismatch`
 * against main's own tip and the queue ejected every entry.
 *
 * So this returns the PR `number` and that `baseSha`, and deliberately
 * nothing that could be mistaken for a head: the head is resolved from the
 * pull request itself and proven to be the group commit's second parent (see
 * `resolvePrAndHead` and `main`).
 *
 * Returns `null` for anything that does not match the exact shape —
 * `refs/heads/` is optional (some contexts hand this value over without it)
 * but everything else is fixed — rather than guessing. A malformed or
 * unrecognized ref must refuse to collect evidence at all, never fall back
 * to reviewing the wrong commit, or no commit.
 */
export function parseMergeGroupQueueRef(headRef) {
  if (typeof headRef !== "string") return null;
  const match = /^(?:refs\/heads\/)?gh-readonly-queue\/[^/]+\/pr-(\d+)-([0-9a-f]{40})$/.exec(headRef.trim());
  if (!match) return null;
  return { number: Number(match[1]), baseSha: match[2] };
}

/**
 * Resolves the `--pr`/`--head` this run collects evidence for, folding in an
 * optional `--merge-group-head-ref`/`--merge-group-head-sha`. Pure — it
 * returns a result object rather than exiting the process — so every way a
 * merge-group run can arrive at (or fail to arrive at) a target is directly
 * testable without touching `gh` or `process.exit`. `main` is the only
 * caller that turns an `error` into a process exit.
 *
 * On the pull_request path it returns `{ pr, head }`, exactly as before.
 *
 * On the merge-group path it returns `{ pr, mergeGroup: { headSha, baseSha } }`
 * and NO `head`: the queue ref does not name the PR's head, so this refuses
 * to invent one. `main` reads the PR's current head and proves it is exactly
 * `mergeGroup.headSha`'s second parent before using it —
 * see `resolveMergeGroupHead`.
 *
 * `mergeGroupHeadRef`, when supplied, always wins over `pr`/`head` — a
 * merge-group run's own `--pr`/`--head` flags (if the caller passed them
 * too) would otherwise silently name a different commit than the one the
 * queue actually built.
 */
export function resolvePrAndHead({ pr, head, mergeGroupHeadRef, mergeGroupHeadSha } = {}) {
  if (typeof mergeGroupHeadRef === "string" && mergeGroupHeadRef.length > 0) {
    const resolved = parseMergeGroupQueueRef(mergeGroupHeadRef);
    if (!resolved) {
      return {
        error:
          `--merge-group-head-ref ${JSON.stringify(mergeGroupHeadRef)} does not match ` +
          "gh-readonly-queue/<base>/pr-<number>-<40-lowercase-hex-sha> — refusing to guess which PR or commit this run is about",
      };
    }
    if (!isSha(mergeGroupHeadSha)) {
      return {
        error:
          "--merge-group-head-sha <40-lowercase-hex-sha> is required with --merge-group-head-ref — the merge-group commit " +
          "the queued PR's head must be proven to be contained in",
      };
    }
    return { pr: String(resolved.number), mergeGroup: { headSha: mergeGroupHeadSha, baseSha: resolved.baseSha } };
  }
  if (!pr) return { error: "--pr <number> is required" };
  if (!head || !isSha(head)) return { error: "--head <40-lowercase-hex-sha> is required — the exact commit this run is testing" };
  return { pr, head };
}

/**
 * The merge-group half of head resolution. Pure over its two injected reads:
 *
 *   - `prHead` — the PR's CURRENT head, read from the pull request itself
 *     (in `main`, a REST read separate from the GraphQL query the evidence
 *     bundle comes from, so the inspector's own `evidence-head-mismatch`
 *     comparison stays a comparison between two reads, not a value compared
 *     with itself).
 *   - `readSecondParent(groupHeadSha)` — the group commit's second parent
 *     (`git rev-parse --verify <group>^2`), or throws when it cannot be read.
 *
 * WHY THE SECOND PARENT, NOT "AN ANCESTOR"
 * The ruleset's `merge_method` is MERGE, so each group commit is
 * merge(<previous group commit or base>, <this entry's PR head>): its second
 * parent is EXACTLY the commit this entry merges. "Is an ancestor of the
 * group commit" is weaker: every older commit on the PR branch is also an
 * ancestor, so a head read that raced a push after enqueue could bind
 * approved evidence at an older commit H0 while the group actually carries an
 * unreviewed H1. Equality with the second parent refuses that. Under SQUASH
 * or REBASE the group commit has no second parent; the read then fails and
 * this refuses, fail-closed, rather than guessing.
 *
 * Returns `{ headShaUnderTest, mergeGroup: { headSha, containsHeadShaUnderTest } }`
 * or `{ error }`. A PR head that is NOT the second parent is returned, not
 * refused, with `containsHeadShaUnderTest: false`, so the inspector reports
 * it as a named, auditable `merge-group-head-not-contained` rather than a
 * bare collector crash. A head or second parent that cannot be read is an
 * error: nothing is established, so nothing is emitted.
 */
export function resolveMergeGroupHead({ groupHeadSha, prHead, readSecondParent }) {
  if (!isSha(groupHeadSha)) return { error: `merge-group head sha ${JSON.stringify(groupHeadSha)} is not a 40-lowercase-hex sha` };
  const head = typeof prHead === "string" ? prHead.trim().toLowerCase() : prHead;
  if (!isSha(head)) return { error: `the pull request's current head ${JSON.stringify(prHead)} is not a 40-lowercase-hex sha` };
  let secondParent;
  try {
    secondParent = readSecondParent(groupHeadSha);
  } catch (error) {
    return { error: `could not read the second parent of merge-group commit ${groupHeadSha}: ${error.message}` };
  }
  secondParent = typeof secondParent === "string" ? secondParent.trim().toLowerCase() : secondParent;
  if (!isSha(secondParent)) {
    return { error: `the second parent of merge-group commit ${groupHeadSha} (${JSON.stringify(secondParent)}) is not a 40-lowercase-hex sha` };
  }
  return { headShaUnderTest: head, mergeGroup: { headSha: groupHeadSha, containsHeadShaUnderTest: secondParent === head } };
}

/**
 * `git rev-parse --verify <group>^2` in `cwd`. Any non-zero exit (no such
 * commit, or a commit with no second parent) throws — an unreadable parent is
 * never read as either answer. The workflow checks out with `fetch-depth: 0`.
 */
export function gitSecondParentReader(cwd) {
  return (groupHeadSha) => {
    const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${groupHeadSha}^2^{commit}`], { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git rev-parse --verify ${groupHeadSha}^2 exited ${result.status ?? result.signal}: ${String(result.stderr ?? "").trim() || "no second parent"}`);
    }
    return result.stdout.trim();
  };
}

// ---------------------------------------------------------------------------
// Pure normalization — no I/O below this line until `defaultFetch*`.
// ---------------------------------------------------------------------------

/**
 * GitHub Checks API conclusions (and the legacy "in flight" states GitHub's
 * GraphQL schema also reports) into `ReviewCheckConclusion`
 * (packages/controller/src/review/types.ts). Mirrors
 * `normalizeCheckConclusion` in packages/controller/src/review/github.ts
 * field-for-field; kept in sync by hand rather than imported (see this
 * file's own header for why).
 */
export function normalizeCheckConclusion(value) {
  switch (String(value ?? "").toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "STARTUP_FAILURE":
    case "STALE":
    case "ERROR":
      return "failure";
    case "NEUTRAL":
      return "neutral";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "TIMED_OUT":
      return "timed-out";
    case "ACTION_REQUIRED":
      return "action-required";
    case "PENDING":
    case "QUEUED":
    case "IN_PROGRESS":
    case "EXPECTED":
    case "":
      return "pending";
    default:
      return "unknown";
  }
}

/** GitHub review states into `ReviewDecision`. Mirrors `normalizeReviewDecision` in github.ts. */
export function normalizeReviewDecision(value) {
  switch (String(value ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes-requested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
      return "dismissed";
    case "":
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * Builds the `checks` half of the evidence bundle from one GraphQL
 * `statusCheckRollup.contexts` connection (a union of `CheckRun` and the
 * legacy `StatusContext`). Every entry is stamped with `headSha` — the
 * commit this script was told to collect for — because GitHub's rollup is
 * already scoped to one commit and carries no per-entry head identity of
 * its own; attaching it here is this collector's own decision, the same
 * one `GitHubCheckNode`'s doc comment in github.ts describes as the
 * caller's to make.
 *
 * `completedAt` is included only when the entry both reports one AND is no
 * longer pending — a `CheckRun` that has not finished yet reports `null`
 * for both fields, which is a true fact about the run, not a gap to fill
 * with an invented timestamp.
 */
export function buildChecksFromRollup(contexts, headSha) {
  const nodes = Array.isArray(contexts?.nodes) ? contexts.nodes : [];
  const complete = contexts?.pageInfo?.hasNextPage === false && contexts?.pageInfo?.hasPreviousPage === false;
  const checks = nodes.map((node) => {
    if (node?.__typename === "StatusContext") {
      const conclusion = normalizeStatusState(node?.state);
      const check = { name: String(node?.context ?? ""), conclusion, headSha };
      if (conclusion !== "pending" && typeof node?.createdAt === "string" && node.createdAt.length > 0) {
        check.completedAt = node.createdAt;
      }
      return check;
    }
    // CheckRun is the default shape: every context this repository's own
    // CI produces is a CheckRun (GitHub Actions jobs), and an unrecognized
    // or missing `__typename` is read the same way rather than dropped —
    // dropping it would silently shrink the evidence instead of reporting
    // an honestly-unrecognized entry for `validateReviewEvidence` to reject.
    const conclusion = normalizeCheckConclusion(node?.conclusion);
    const check = { name: String(node?.name ?? ""), conclusion, headSha };
    if (typeof node?.completedAt === "string" && node.completedAt.length > 0) check.completedAt = node.completedAt;
    return check;
  });
  return { checks, complete };
}

/** Legacy commit-status states (the `StatusContext` half of the rollup union) into `ReviewCheckConclusion`. */
export function normalizeStatusState(value) {
  switch (String(value ?? "").toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
    case "":
      return "pending";
    default:
      return "unknown";
  }
}

/**
 * Builds the `reviews` half of the bundle from one GraphQL `reviews`
 * connection. `PENDING` (an unsubmitted draft review) is dropped entirely,
 * matching `normalizeGitHubReviewEvidence` in github.ts — a draft is not
 * evidence of anything yet.
 *
 * `provider` and `depth` are not native GitHub concepts (see
 * `GitHubReviewNode`'s doc comment in github.ts): this collector states
 * both explicitly rather than leaving them for `validateReviewEvidence` to
 * reject as missing.
 *   - `provider` is the constant `"github"` for every record this
 *     connection can produce — a native PR review, whoever or whatever
 *     submitted it (human, bot, or GitHub App; GraphQL's `Actor` interface
 *     gives every kind of author the same `login` shape, so none of them
 *     needs special-casing) — because this collector has no way to tell
 *     a human reviewer from an automated one from this connection alone,
 *     and inventing a distinction it cannot observe would be worse than
 *     naming the one thing that IS true of all of them: they came through
 *     GitHub's own native review feature, not a model reviewer.
 *   - `instanceId` is the reviewer's own `login`. GitHub's native review
 *     model already treats every review submitted by one account on one
 *     pull request as ONE evolving decision (the platform's own
 *     `reviewDecision` field is computed by taking each author's LATEST
 *     review) — which is exactly what `instanceId`'s latest-wins-per-
 *     instance grouping in `validateReviewEvidence` is for. This is
 *     deliberately narrower than `ReviewRecord.instanceId`'s general
 *     contract (see its own doc comment: `reviewerId` alone cannot always
 *     stand in for a review session, because an account can run several
 *     independent audits under one login) — it holds specifically because
 *     `provider` is held constant at `"github"` above: within one
 *     provider's namespace, on one pull request, GitHub's own semantics
 *     already collapse one login to one ongoing session.
 *   - `depth` is always `"primary"`. Native GitHub reviews carry no notion
 *     of a "secondary, independent pass" a consuming repository's policy
 *     might define — reporting anything else would be inventing a fact
 *     this connection does not contain. `"primary"` is the depth
 *     `ReviewDepth`'s own doc comment defines as "an ordinary single-pass
 *     review; no secondary pass was attempted or required", which is an
 *     accurate description of what this collector actually observed, not
 *     a guess.
 */
export function buildReviewsFromConnection(connection, headSha) {
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  const complete = connection?.pageInfo?.hasNextPage === false && connection?.pageInfo?.hasPreviousPage === false;
  const reviews = nodes
    .filter((node) => node?.state !== "PENDING")
    .map((node) => {
      const login = typeof node?.author?.login === "string" ? node.author.login : "";
      return {
        id: String(node?.id ?? ""),
        reviewerId: login,
        instanceId: login,
        provider: "github",
        submittedAt: typeof node?.submittedAt === "string" ? node.submittedAt : "",
        state: normalizeReviewDecision(node?.state),
        depth: "primary",
        headSha: typeof node?.commit?.oid === "string" ? node.commit.oid : "",
      };
    });
  return { reviews, complete };
}

/**
 * Builds the `threads` half of the bundle from one GraphQL `reviewThreads`
 * connection. GitHub's review-thread object carries no per-thread head
 * identity (unlike a review, which names the commit it was submitted
 * against), so every thread is stamped with the bundle's own `headSha` —
 * the same choice `normalizeGitHubReviewEvidence` makes in github.ts. This
 * means a thread can never independently trigger `stale-evidence`; a
 * thread that predates a force-push is still read as belonging to the
 * current head. That is a real, named limitation of GitHub's own API
 * shape, not something this collector can see past.
 */
export function buildThreadsFromConnection(connection, headSha) {
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  const complete = connection?.pageInfo?.hasNextPage === false && connection?.pageInfo?.hasPreviousPage === false;
  const threads = nodes.map((node) => ({
    id: String(node?.id ?? ""),
    isResolved: node?.isResolved === true,
    headSha,
  }));
  return { threads, complete };
}

/**
 * Assembles the full `ReviewEvidenceBundle` (packages/controller/src/review/types.ts)
 * from one GraphQL response shaped like the query this script actually
 * sends (see `PULL_REQUEST_QUERY` below). `headSha` is the live value this
 * query returned for `pullRequest.headRefOid` — the head evidence was
 * actually collected AGAINST — which is deliberately independent from
 * `headShaUnderTest` in `buildReviewEvidenceOptions` below (see this file's
 * header, "THE HEAD-MISMATCH CHECK IS THE WHOLE POINT").
 */
export function buildReviewEvidenceBundle(pullRequest) {
  const headSha = typeof pullRequest?.headRefOid === "string" ? pullRequest.headRefOid.toLowerCase() : "";
  const baseSha = typeof pullRequest?.baseRefOid === "string" ? pullRequest.baseRefOid.toLowerCase() : "";
  const rollup = pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
  const { checks, complete: checksComplete } = buildChecksFromRollup(rollup, headSha);
  const { reviews, complete: reviewsComplete } = buildReviewsFromConnection(pullRequest?.reviews, headSha);
  const { threads, complete: threadsComplete } = buildThreadsFromConnection(pullRequest?.reviewThreads, headSha);
  return {
    schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    headSha,
    baseSha,
    paginationComplete: checksComplete && reviewsComplete && threadsComplete,
    checks,
    reviews,
    threads,
  };
}

/**
 * Derives a required-check-context list from one branch's live rule
 * evaluation (`gh api repos/{owner}/{repo}/rules/branches/{branch}`),
 * reusing `extractRequiredContexts` from `scripts/land-stack.mjs` rather
 * than re-deriving it (#907) — the set has grown from 9 contexts to 15
 * once already (#402) and will again without either script being told by
 * hand. This script's own context is always removed; see
 * `EXCLUDED_SELF_CONTEXTS` and this file's own header.
 */
export function deriveRequiredChecksFromRuleset(branchRules, excluded = EXCLUDED_SELF_CONTEXTS) {
  const exclude = new Set(excluded);
  return extractRequiredContexts(branchRules).filter((context) => !exclude.has(context));
}

/** Builds the `ReviewPolicy` half of the section this script emits, from `.github/verify-standards-review-policy.json`'s own values. */
export function buildReviewPolicy(raw, { requiredChecksFromRuleset } = {}) {
  const requiredChecks = Array.isArray(requiredChecksFromRuleset)
    ? requiredChecksFromRuleset
    : Array.isArray(raw?.requiredChecks)
      ? raw.requiredChecks
      : [];
  return {
    requiredChecks,
    requireApproval: raw?.requireApproval === true,
    requireSecondaryReview: raw?.requireSecondaryReview === true,
    decisionUse: raw?.decisionUse === "authoritative" ? "authoritative" : "advisory",
  };
}

/**
 * Builds the `ReviewEvidenceOptions` half of the section this script emits.
 * See this file's header for `headShaUnderTest`. `mergeGroup` is written only
 * on a merge-group run (see `resolveMergeGroupHead`); the pull_request path
 * never carries it. `carriedApproval` is written only when this run proved a
 * #1428 mechanical-merge carry (see `findMechanicalMergeCarry`) — reporting
 * only, since the carried review's own `headSha` is already rebound in the
 * evidence bundle by the time this runs (`applyMechanicalMergeCarry`).
 */
export function buildReviewEvidenceOptions({ headShaUnderTest, requireReviewPresence, mergeGroup, carriedApproval }) {
  const options = { requireReviewPresence: requireReviewPresence === true };
  if (typeof headShaUnderTest === "string" && headShaUnderTest.length > 0) options.headShaUnderTest = headShaUnderTest;
  if (mergeGroup !== undefined) {
    options.mergeGroup = { headSha: mergeGroup.headSha, containsHeadShaUnderTest: mergeGroup.containsHeadShaUnderTest };
  }
  if (carriedApproval !== undefined) {
    options.carriedApproval = { fromHeadSha: carriedApproval.fromHeadSha, toHeadSha: carriedApproval.toHeadSha };
  }
  return options;
}

/** Assembles the full `reviewEvidence` section of `VerifyStandardsInputs` (packages/inspector/src/verify.ts). */
export function buildReviewEvidenceSection({ evidence, policy, options }) {
  return { reviewEvidence: { evidence, policy, options } };
}

/**
 * Merges a `reviewEvidence` section into an existing (or absent)
 * `VerifyStandardsInputs` document, preserving every other section
 * untouched. `existingDocument` is expected to already be shaped like
 * `.github/scripts/assemble-verify-inputs.mjs`'s own output (a
 * `taskRecord` section, one schema version) — this never inspects it
 * beyond that, so a future section added there needs no change here.
 */
export function mergeReviewEvidenceIntoInputs(existingDocument, reviewEvidenceSection) {
  const base = existingDocument && typeof existingDocument === "object" && !Array.isArray(existingDocument) ? existingDocument : {};
  return { schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION, ...base, ...reviewEvidenceSection };
}

// ---------------------------------------------------------------------------
// MECHANICAL-MERGE CARRY (#1428)
// ---------------------------------------------------------------------------
//
// `validateReviews` (packages/controller/src/review/validate.ts) binds every
// review record to the EXACT head it was submitted against: the moment the
// head moves at all, an earlier approval is `stale-evidence` and is dropped
// before it can ever contribute to `hasApproval`. That is the right default —
// most pushes are real content a reviewer has not seen — but it is needlessly
// strict for exactly one shape of push: a MECHANICAL merge from the target
// branch, where nothing a reviewer looked at actually changed and only the
// base moved underneath it.
//
// A merge is "mechanical" here only when BOTH of the following hold, proven
// against this repository's own git history, never assumed:
//
//   1. Every commit strictly between the approved head and the current head,
//      walking STRICT FIRST PARENT from the current head, is a plain
//      two-parent merge commit whose SECOND parent is an ancestor of the
//      TARGET BRANCH's true tip, and whose `git show --remerge-diff` is
//      EMPTY.
//
// That single condition is sufficient on its own, and this is deliberately
// no longer a two-part proof (an earlier revision of this carry also
// compared `git patch-id` at both heads — see "WHY THERE IS NO PATCH-ID
// CHECK ANYMORE" below for why that was both a hole and a false-negative
// machine). Read the two halves of condition 1 together: the second parent
// being an ancestor of the target branch's tip means this merge commit can
// only be pulling in content that ALREADY EXISTS on the target branch — not
// a side branch, not a hand-crafted patch, nothing new. The empty
// remerge-diff means the merge itself did not ALTER that content on the way
// in — no manual conflict resolution, nothing tacked on inside the merge
// commit. Together, by construction, the only tree difference a chain of
// such merges can introduce is content that was already reviewable on the
// target branch before this pull request ever merged it — never the pull
// request's OWN reviewed change, which is exactly the thing `hasApproval`
// exists to protect. A merge whose second parent is NOT on the target
// branch (a side branch smuggling in a rewritten line, #1433's review
// round 1) fails condition 1 immediately, before its remerge-diff is even
// read — see `verifyChainIsMechanical`.
//
// WHY THERE IS NO PATCH-ID CHECK ANYMORE
// ---------------------------------------
// The original design also required `git patch-id --stable` (the pull
// request's own diff against its merge-base with the target branch) to be
// identical at the approved head and the current head, reasoning that this
// independently re-proved "nothing reviewed moved" from tree content rather
// than commit-graph shape. Round 1 of #1433's review found this was BOTH
// a hole and a false-negative machine, from real git history:
//   - A hole: `git patch-id` (even `--stable`) ignores whitespace. A
//     side-branch merge that only changes indentation or in-line spacing —
//     which can change behavior in a whitespace-significant file, or in a
//     shell command — kept an identical patch id while carrying an
//     unreviewed semantic change. `--verbatim` closes that one hole, but
//     the check as a whole was never doing anything the ancestry proof
//     above does not already do more directly.
//   - A false-negative machine: measured against this very repository's own
//     history, 5 of 5 recent clean merges from `main` failed the patch-id
//     check, because `main`'s own advances (changeset files, version
//     bump lines) sit close enough to this pull request's own diff context
//     to shift the merge-base-relative diff even though nothing reviewed
//     changed. The feature this issue exists to build would almost never
//     have fired here.
// Condition 1 above proves the same fact — nothing outside what the target
// branch already carries can enter through the chain — without either
// weakness, so the patch-id check is dropped rather than patched.
//
// Any doubt — an unreadable commit, a parent that cannot be resolved, an
// ancestry or remerge-diff check git cannot compute, an unresolvable target-
// branch tip — refuses rather than guesses. See this repository's PR for
// #1428 (and its round-1 review discussion) for the full charter and threat
// model.
//
// The functions below split the same way `resolveMergeGroupHead` and
// `gitSecondParentReader` already do: the DECISION is pure, over injected
// reader functions a test can stub with fixtures or a real temporary git
// repository; only the `git*Reader` factories in the I/O section below touch
// an actual repository. `main` wires the two together and, when a carry is
// proven, REBINDS the carried review's own `headSha` to the current head
// (`applyMechanicalMergeCarry`) — the ordinary validation path above then
// treats it as current-head evidence with no change to `@clossys/controller`
// or `@clossys/inspector`'s decision logic. Those two packages only gain an
// optional `carriedApproval` report field (see
// packages/inspector/src/review-evidence.ts) so the carried head is VISIBLE
// in the check's output, never silent.

/** Decisive `ReviewDecision` values, mirroring `validateReviews`' own filter in packages/controller/src/review/validate.ts. */
const DECISIVE_REVIEW_STATES = new Set(["approved", "changes-requested", "dismissed"]);

/**
 * The repository's own default branch, hardcoded rather than read from
 * `values.branch` / `base.ref` — see `main`'s own "Mechanical-merge carry"
 * comment for why: that field is exactly what a pull request author changes
 * by retargeting its base, so resolving the carry's ancestry check against
 * it would let a retarget defeat the very check meant to survive one.
 */
const MECHANICAL_MERGE_BASE_BRANCH = "main";

/**
 * Walks strictly by FIRST PARENT from `headSha`, collecting each commit
 * visited together with its own parent list, until `approvedHeadSha` is
 * reached or `maxSteps` is exhausted. A merge commit's SECOND (or later)
 * parent is never followed — exactly the one path the pull request's own
 * branch pointer actually took, so a commit reachable only through some
 * OTHER path (main's own history, say) can never be mistaken for part of
 * this chain. `readParents(sha)` returns that commit's ordered parent shas
 * and may throw when a commit is unreadable.
 *
 * Returns `{ chain }` — an array of `{ sha, parents }`, `headSha` first and
 * `approvedHeadSha` itself excluded — or `{ error }` when a parent could not
 * be read, the walk reaches a commit with no first parent (a root) before
 * reaching `approvedHeadSha`, or `maxSteps` is exhausted first. `headSha ===
 * approvedHeadSha` returns an empty chain: there is nothing to walk.
 */
export function walkFirstParentChain({ headSha, approvedHeadSha, readParents, maxSteps = 200 }) {
  if (headSha === approvedHeadSha) return { chain: [] };
  const chain = [];
  let cursor = headSha;
  for (let step = 0; step < maxSteps; step += 1) {
    let parents;
    try {
      parents = readParents(cursor);
    } catch (error) {
      return { error: `could not read the parents of ${cursor}: ${error.message}` };
    }
    const first = Array.isArray(parents) ? parents[0] : undefined;
    if (!isSha(first)) return { error: `${cursor} has no readable first parent before reaching ${approvedHeadSha}` };
    chain.push({ sha: cursor, parents });
    if (first === approvedHeadSha) return { chain };
    cursor = first;
  }
  return { error: `the first-parent chain from ${headSha} did not reach ${approvedHeadSha} within ${maxSteps} steps` };
}

/**
 * Whether every commit in `chain` (as `walkFirstParentChain` returns it) is a
 * plain two-parent merge whose SECOND parent is an ancestor of the target
 * branch's true tip AND whose `git show --remerge-diff` is EMPTY — see this
 * section's own header, condition 1. Fails closed at the FIRST commit that
 * is not: a non-merge commit (something landed on the branch after the
 * approved head), an octopus merge (more than two parents, a shape
 * `--remerge-diff` does not reliably cover), a merge whose second parent is
 * NOT reachable from the target branch (a side-branch merge smuggling in
 * unreviewed content — checked BEFORE the remerge-diff read, since a merge
 * that fails this can never be mechanical regardless of its diff), or a
 * merge whose remerge-diff is not empty. `secondParentIsOnBase(sha)` and
 * `remergeDiffIsEmpty(sha)` may each throw when they cannot be computed.
 */
export function verifyChainIsMechanical({ chain, secondParentIsOnBase, remergeDiffIsEmpty }) {
  for (const { sha, parents } of chain) {
    if (!Array.isArray(parents) || parents.length !== 2) {
      const count = Array.isArray(parents) ? parents.length : "an unknown number of";
      return {
        mechanical: false,
        reason: `${sha} is not a plain two-parent merge commit (${count} parent(s)) — a non-merge commit landed after the approved head, or the merge is an octopus this module will not grade`,
      };
    }
    const secondParent = parents[1];
    let onBase;
    try {
      onBase = secondParentIsOnBase(secondParent);
    } catch (error) {
      return { mechanical: false, reason: `could not verify that ${sha}'s second parent ${secondParent} is on the target branch: ${error.message}` };
    }
    if (onBase !== true) {
      return {
        mechanical: false,
        reason: `merge commit ${sha}'s second parent ${secondParent} is not an ancestor of the target branch's true tip — a side-branch merge, never carried`,
      };
    }
    let empty;
    try {
      empty = remergeDiffIsEmpty(sha);
    } catch (error) {
      return { mechanical: false, reason: `could not read the remerge-diff of ${sha}: ${error.message}` };
    }
    if (empty !== true) {
      return {
        mechanical: false,
        reason: `merge commit ${sha} has a non-empty remerge-diff — a hand-resolved conflict or content added on top of the merge, never carried`,
      };
    }
  }
  return { mechanical: true };
}

/**
 * The full decision for one candidate: does `approvedHeadSha`'s approval
 * carry forward to `currentHeadSha`? Combines the first-parent walk with the
 * per-merge ancestry-and-remerge-diff proof (see this section's own header —
 * there is no separate patch-id check). Every reader may throw; every throw
 * is caught here and turned into `{ carries: false, reason }`, never an
 * exception a caller has to guard against separately.
 */
export function assessMechanicalMergeCarry({ approvedHeadSha, currentHeadSha, readParents, secondParentIsOnBase, remergeDiffIsEmpty, maxSteps }) {
  if (!isSha(approvedHeadSha) || !isSha(currentHeadSha)) {
    return { carries: false, reason: "both the approved head and the current head must be 40-lowercase-hex shas" };
  }
  if (approvedHeadSha === currentHeadSha) {
    return { carries: false, reason: "the approved head already is the current head — there is no merge to prove mechanical" };
  }
  let walk;
  try {
    walk = walkFirstParentChain({ headSha: currentHeadSha, approvedHeadSha, readParents, maxSteps });
  } catch (error) {
    return { carries: false, reason: `could not walk the commit history: ${error.message}` };
  }
  if (walk.error) return { carries: false, reason: walk.error };
  let verified;
  try {
    verified = verifyChainIsMechanical({ chain: walk.chain, secondParentIsOnBase, remergeDiffIsEmpty });
  } catch (error) {
    return { carries: false, reason: `could not verify the merge chain: ${error.message}` };
  }
  if (!verified.mechanical) return { carries: false, reason: verified.reason };
  return { carries: true, approvedHeadSha, currentHeadSha };
}

/**
 * Every reviewer's own LATEST decisive review (by `submittedAt`, never array
 * order — the same rule `validateReviews` applies at one head, generalized
 * here across every head this bundle's reviews carry). Shared by
 * `latestDecisiveApprovedHeads` (which candidate heads to try) and
 * `latestDecisiveApprovedInstancesAt` (which exact records `
 * applyMechanicalMergeCarry` may rebind for a given head) so the two stay
 * mutually consistent by construction rather than by two hand-kept copies of
 * the same grouping rule.
 */
function groupLatestDecisiveReviews(reviews) {
  const latestByInstance = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (!review || !DECISIVE_REVIEW_STATES.has(review.state)) continue;
    const submittedAtMs = Date.parse(review.submittedAt);
    if (Number.isNaN(submittedAtMs)) continue;
    const previous = latestByInstance.get(review.instanceId);
    if (!previous || submittedAtMs > previous.submittedAtMs) {
      latestByInstance.set(review.instanceId, { submittedAtMs, state: review.state, headSha: review.headSha, ambiguous: false });
    } else if (submittedAtMs === previous.submittedAtMs && review.state !== previous.state) {
      latestByInstance.set(review.instanceId, { ...previous, ambiguous: true });
    }
  }
  return latestByInstance;
}

/**
 * Narrowed to the instances whose latest decisive review is `"approved"` and
 * NOT already at `currentHeadSha`. A tie (two decisive records for one
 * instance sharing a `submittedAt` and disagreeing on `state`) is excluded
 * outright — an ambiguous decision never carries, the same refusal
 * `validateReviews`' own `hasAmbiguousDecision` makes for the current head.
 * Returns distinct candidate head shas, most recently approved first, so
 * `findMechanicalMergeCarry` tries the freshest evidence first.
 */
export function latestDecisiveApprovedHeads(reviews, currentHeadSha) {
  const latestByInstance = groupLatestDecisiveReviews(reviews);
  const bestByHead = new Map();
  for (const entry of latestByInstance.values()) {
    if (entry.ambiguous || entry.state !== "approved") continue;
    if (!isSha(entry.headSha) || entry.headSha === currentHeadSha) continue;
    const existing = bestByHead.get(entry.headSha);
    if (existing === undefined || entry.submittedAtMs > existing) bestByHead.set(entry.headSha, entry.submittedAtMs);
  }
  return [...bestByHead.entries()].sort((a, b) => b[1] - a[1]).map(([sha]) => sha);
}

/**
 * Every reviewer `instanceId` whose own latest decisive review is
 * `"approved"` AND at exactly `headSha` — the precise set
 * `applyMechanicalMergeCarry` may rebind. Deliberately narrower than "every
 * `state: 'approved'` record at `headSha`": a reviewer who approved at
 * `headSha` and LATER, still at that same head, requested changes (or
 * re-approved) has a record here that is no longer their own decisive
 * answer, and must not be resurrected by a carry that only ever asked "was
 * there ever an approval here" (round 1 of #1433's review, non-blocking
 * note 1).
 */
export function latestDecisiveApprovedInstancesAt(reviews, headSha) {
  const latestByInstance = groupLatestDecisiveReviews(reviews);
  const instances = new Set();
  for (const [instanceId, entry] of latestByInstance) {
    if (!entry.ambiguous && entry.state === "approved" && entry.headSha === headSha) instances.add(instanceId);
  }
  return instances;
}

/**
 * Tries every carry-eligible earlier approval, most recently approved first,
 * returning the first `assessMechanicalMergeCarry` proves mechanical.
 * `{ carries: false }` when there is none — no eligible approval exists at
 * all, or none of them survived the proof. Never throws: every reader's own
 * exceptions are caught inside `assessMechanicalMergeCarry`.
 */
export function findMechanicalMergeCarry({ reviews, currentHeadSha, readParents, secondParentIsOnBase, remergeDiffIsEmpty, maxSteps }) {
  if (!isSha(currentHeadSha)) return { carries: false, reason: "the current head is not a 40-lowercase-hex sha" };
  const candidates = latestDecisiveApprovedHeads(reviews, currentHeadSha);
  if (candidates.length === 0) {
    return { carries: false, reason: "no approved review at an earlier head is this reviewer's own latest decisive record" };
  }
  for (const approvedHeadSha of candidates) {
    const assessment = assessMechanicalMergeCarry({ approvedHeadSha, currentHeadSha, readParents, secondParentIsOnBase, remergeDiffIsEmpty, maxSteps });
    if (assessment.carries) return assessment;
  }
  return { carries: false, reason: `no earlier approved head (${candidates.join(", ")}) was reachable by a provably mechanical merge` };
}

/**
 * Rebinds ONLY the review records `latestDecisiveApprovedInstancesAt`
 * selects at `carry.approvedHeadSha` to `carry.currentHeadSha`, so the
 * ordinary validation path (`validateReviewEvidence` → `validateReviews`)
 * treats them as current-head evidence — no change to that package is
 * needed. A no-op (returns `evidence` unchanged) unless `carry.carries` is
 * `true`. Deliberately NOT "every `'approved'` record at that head" — see
 * `latestDecisiveApprovedInstancesAt`'s own doc comment for why a superseded
 * approval must not be resurrected. Every other review, check, and thread is
 * untouched.
 */
export function applyMechanicalMergeCarry(evidence, carry) {
  if (!carry || carry.carries !== true) return evidence;
  const instances = latestDecisiveApprovedInstancesAt(evidence.reviews, carry.approvedHeadSha);
  return {
    ...evidence,
    reviews: evidence.reviews.map((review) =>
      review.state === "approved" && review.headSha === carry.approvedHeadSha && instances.has(review.instanceId)
        ? { ...review, headSha: carry.currentHeadSha }
        : review,
    ),
  };
}

// ---------------------------------------------------------------------------
// I/O — everything above this line is pure and independently testable.
// ---------------------------------------------------------------------------

const PULL_REQUEST_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      baseRefOid
      reviews(first: 100) {
        pageInfo { hasNextPage hasPreviousPage }
        nodes { id state submittedAt commit { oid } author { login } }
      }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage hasPreviousPage }
        nodes { id isResolved }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                pageInfo { hasNextPage hasPreviousPage }
                nodes {
                  __typename
                  ... on CheckRun { name conclusion completedAt }
                  ... on StatusContext { context state createdAt }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

function defaultFetchPullRequest({ owner, name, number }) {
  const out = execFileSync(
    "gh",
    ["api", "graphql", "-f", `query=${PULL_REQUEST_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed?.data?.repository?.pullRequest;
}

function defaultFetchBranchRules({ owner, name, branch }) {
  const out = execFileSync("gh", ["api", `repos/${owner}/${name}/rules/branches/${branch}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/** The PR's current head, read over REST — deliberately a separate read from `PULL_REQUEST_QUERY`'s `headRefOid`. */
function defaultFetchPullRequestHead({ owner, name, number }) {
  return execFileSync("gh", ["api", `repos/${owner}/${name}/pulls/${number}`, "--jq", ".head.sha"], { encoding: "utf8" }).trim();
}

/** `git rev-list --parents -n 1 <sha>` in `cwd`, returning that commit's own parent shas in order. Throws on any non-zero exit. */
export function gitParentsReader(cwd) {
  return (sha) => {
    const result = spawnSync("git", ["rev-list", "--parents", "-n", "1", sha], { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git rev-list --parents -n 1 ${sha} exited ${result.status ?? result.signal}: ${String(result.stderr ?? "").trim()}`);
    }
    const tokens = result.stdout.trim().split(/\s+/).filter(Boolean);
    return tokens.slice(1);
  };
}

/**
 * `git show --remerge-diff --pretty=format: <sha>` in `cwd`, true exactly
 * when the diff half of the output is empty — see the "MECHANICAL-MERGE
 * CARRY" section's own header. `--pretty=format:` suppresses the commit
 * message so only the diff itself is measured. Throws on any non-zero exit,
 * including when `sha` is not a merge commit — `--remerge-diff` refuses that
 * shape itself.
 */
export function gitRemergeDiffIsEmptyReader(cwd) {
  return (sha) => {
    const result = spawnSync("git", ["show", "--remerge-diff", "--pretty=format:", sha], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`git show --remerge-diff ${sha} exited ${result.status ?? result.signal}: ${String(result.stderr ?? "").trim()}`);
    }
    return result.stdout.trim().length === 0;
  };
}

/**
 * The TRUE current tip of the target branch, read fresh from this job's own
 * fetched history — `git rev-parse --verify refs/remotes/origin/<branch>` —
 * never trusted from a caller-supplied value. This is deliberate: on a
 * `pull_request` event, `baseRefOid` in the GraphQL payload is the pull
 * request's OWN claimed base, which its author can retarget at will (round 1
 * of #1433's review). Resolving it from `origin/<branch>` instead answers
 * "what does this repository's own fetched history say `<branch>` actually
 * is right now", independent of anything the pull request itself claims.
 * Throws when the ref cannot be read (an unfetched branch, a shallow clone,
 * or simply the wrong name) — this repository's checkout already runs with
 * `fetch-depth: 0`, so an unreadable ref here is refused rather than guessed
 * at with a stale or absent value.
 */
export function gitBranchTipReader(cwd) {
  return (branch) => {
    const result = spawnSync("git", ["rev-parse", "--verify", `refs/remotes/origin/${branch}`], { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `git rev-parse --verify refs/remotes/origin/${branch} exited ${result.status ?? result.signal}: ${String(result.stderr ?? "").trim()}`,
      );
    }
    return result.stdout.trim();
  };
}

/**
 * `git merge-base --is-ancestor <sha> <baseTip>` in `cwd`: `true` when `sha`
 * is an ancestor of (or equal to) `baseTip`, `false` when git can read both
 * commits and answers "no" (git's own documented exit code `1` for this
 * command), and a thrown error for anything else — an unknown object, a
 * corrupt repository, any exit code this command does not itself define as
 * "no". The distinction matters: "no" is a real, comparable fact this
 * module trusts; anything else is doubt, and doubt refuses (see this
 * section's own header).
 */
export function gitIsAncestorReader(cwd) {
  return (sha, baseTip) => {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", sha, baseTip], { cwd, encoding: "utf8" });
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    throw new Error(
      `git merge-base --is-ancestor ${sha} ${baseTip} exited ${result.status ?? result.signal}: ${String(result.stderr ?? "").trim()}`,
    );
  };
}

function defaultRepoFromGh() {
  return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`collect-review-evidence: ${message}`);
  process.exit(1);
}

function readPolicyFile(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

export function main(
  argv,
  {
    fetchPullRequest = defaultFetchPullRequest,
    fetchBranchRules = defaultFetchBranchRules,
    repoFromGh = defaultRepoFromGh,
    fetchPullRequestHead = defaultFetchPullRequestHead,
    readSecondParent = gitSecondParentReader(process.cwd()),
    readParents = gitParentsReader(process.cwd()),
    remergeDiffIsEmpty = gitRemergeDiffIsEmptyReader(process.cwd()),
    resolveBranchTip = gitBranchTipReader(process.cwd()),
    isAncestor = gitIsAncestorReader(process.cwd()),
    write = (text) => process.stdout.write(text),
  } = {},
) {
  const { values } = parseArgs({
    args: argv,
    options: {
      pr: { type: "string" },
      head: { type: "string" },
      repo: { type: "string" },
      branch: { type: "string", default: "main" },
      policy: { type: "string", default: ".github/verify-standards-review-policy.json" },
      merge: { type: "string" },
      "required-checks-from-ruleset": { type: "boolean", default: false },
      "require-review-presence": { type: "boolean", default: false },
      "merge-group-head-ref": { type: "string" },
      "merge-group-head-sha": { type: "string" },
    },
  });

  const resolved = resolvePrAndHead({
    pr: values.pr,
    head: values.head,
    mergeGroupHeadRef: values["merge-group-head-ref"],
    mergeGroupHeadSha: values["merge-group-head-sha"],
  });
  if (resolved.error) fail(resolved.error);
  const prNumber = resolved.pr;
  let headSha = resolved.head;
  let mergeGroup;

  let repo = values.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    try {
      repo = repoFromGh();
    } catch (error) {
      fail(`could not resolve owner/name (pass --repo or set GITHUB_REPOSITORY): ${error.message}`);
    }
  }
  const [owner, name] = repo.split("/");
  if (!owner || !name) fail(`--repo/GITHUB_REPOSITORY must be "owner/name", got ${JSON.stringify(repo)}`);

  let pullRequest;
  try {
    pullRequest = fetchPullRequest({ owner, name, number: Number(prNumber) });
  } catch (error) {
    fail(`could not fetch pull request #${prNumber}: ${error.message}`);
  }
  if (!pullRequest) fail(`pull request #${prNumber} was not found in ${owner}/${name}`);

  // Merge-group run: the commit under test is the queued PR's own head,
  // read from the pull request and proven to be exactly the group commit's
  // second parent -- what this entry merges (see `resolveMergeGroupHead`).
  // Never the sha embedded in the queue ref, which is the base (#1253).
  if (resolved.mergeGroup) {
    let prHead;
    try {
      prHead = fetchPullRequestHead({ owner, name, number: Number(prNumber) });
    } catch (error) {
      fail(`could not read pull request #${prNumber}'s current head: ${error.message}`);
    }
    const mg = resolveMergeGroupHead({ groupHeadSha: resolved.mergeGroup.headSha, prHead, readSecondParent });
    if (mg.error) fail(mg.error);
    headSha = mg.headShaUnderTest;
    mergeGroup = mg.mergeGroup;
  }

  let requiredChecksFromRuleset;
  if (values["required-checks-from-ruleset"]) {
    try {
      const branchRules = fetchBranchRules({ owner, name, branch: values.branch });
      requiredChecksFromRuleset = deriveRequiredChecksFromRuleset(branchRules);
    } catch (error) {
      fail(`could not resolve the required-check ruleset for ${values.branch}: ${error.message}`);
    }
  }

  const policyRaw = readPolicyFile(values.policy);
  let evidence = buildReviewEvidenceBundle(pullRequest);
  const policy = buildReviewPolicy(policyRaw, { requiredChecksFromRuleset });

  // Mechanical-merge carry (#1428): an approval at an earlier head still
  // counts here when this run's own git history PROVES the only difference
  // since is a chain of merge commits whose second parent is an ancestor of
  // the TARGET BRANCH's true tip and whose remerge-diff is empty. See this
  // file's "MECHANICAL-MERGE CARRY" section for the full design.
  //
  // The target branch's true tip is resolved two different ways depending on
  // the event, and NEITHER of them reads `values.branch` (`--branch`, fed
  // from `github.event.pull_request.base.ref` by the workflow):
  //   - `merge_group`: the PINNED base this queue entry was actually formed
  //     against (`resolved.mergeGroup.baseSha`, parsed straight out of
  //     GitHub's own synthetic queue ref by `parseMergeGroupQueueRef` --
  //     never re-resolved live), matching the trust model the rest of the
  //     merge-group path already uses for `--merge-group-head-sha`.
  //   - `pull_request`: `MECHANICAL_MERGE_BASE_BRANCH` below, a HARDCODED
  //     "main" resolved FRESH from this job's own fetched history via
  //     `resolveBranchTip`. `values.branch` is deliberately not used here,
  //     for the same reason `baseRefOid` is not: both are exactly the field
  //     that changes the moment a pull request author retargets its base in
  //     the GitHub UI (round 1 of #1433's review found the patch-id defense
  //     insufficient; this closes the retargeting angle specifically -- a
  //     retargeted pull request's merges are checked against ancestry of the
  //     repository's REAL default branch regardless of what it now claims
  //     its base is, so a merge from the new "base" no more carries than a
  //     merge from any other side branch would).
  // A base tip that cannot be resolved at all means the carry cannot be
  // assessed, not that it is skipped silently -- `carry.reason` says so.
  //
  // Fail-closed by construction: `findMechanicalMergeCarry` never throws,
  // and any doubt at all resolves to `carries: false`.
  let baseTipForCarry;
  if (resolved.mergeGroup) {
    baseTipForCarry = resolved.mergeGroup.baseSha;
  } else {
    try {
      baseTipForCarry = resolveBranchTip(MECHANICAL_MERGE_BASE_BRANCH);
    } catch (error) {
      baseTipForCarry = undefined;
      process.stderr.write(
        `collect-review-evidence: could not resolve ${MECHANICAL_MERGE_BASE_BRANCH}'s true tip, so no carry can be assessed: ${error.message}\n`,
      );
    }
  }
  let carry = { carries: false, reason: "the target branch's true tip could not be resolved" };
  if (isSha(baseTipForCarry)) {
    try {
      carry = findMechanicalMergeCarry({
        reviews: evidence.reviews,
        currentHeadSha: headSha,
        readParents,
        secondParentIsOnBase: (sha) => isAncestor(sha, baseTipForCarry),
        remergeDiffIsEmpty,
      });
    } catch (error) {
      carry = { carries: false, reason: `could not assess a mechanical-merge carry: ${error.message}` };
    }
  }
  if (carry.carries) {
    evidence = applyMechanicalMergeCarry(evidence, carry);
    process.stderr.write(
      `collect-review-evidence: carried approval from ${carry.approvedHeadSha} to ${headSha} (#1428 provably mechanical merge)\n`,
    );
  }

  const options = buildReviewEvidenceOptions({
    headShaUnderTest: headSha,
    requireReviewPresence: values["require-review-presence"],
    mergeGroup,
    carriedApproval: carry.carries ? { fromHeadSha: carry.approvedHeadSha, toHeadSha: headSha } : undefined,
  });
  const section = buildReviewEvidenceSection({ evidence, policy, options });

  let output;
  if (values.merge) {
    let existing;
    try {
      existing = JSON.parse(readFileSync(values.merge, "utf8"));
    } catch (error) {
      fail(`--merge ${values.merge} could not be read as JSON: ${error.message}`);
    }
    output = mergeReviewEvidenceIntoInputs(existing, section);
  } else {
    output = mergeReviewEvidenceIntoInputs(undefined, section);
  }

  write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
