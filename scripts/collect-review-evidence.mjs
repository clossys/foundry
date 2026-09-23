#!/usr/bin/env node
// collect-review-evidence — the collection half of the review-evidence
// standards check (issue #403).
//
//   node scripts/collect-review-evidence.mjs --pr <number> --head <sha>
//     [--repo <owner>/<name>] [--branch <base-branch>]
//     [--policy <path>] [--merge <path>]
//     [--required-checks-from-ruleset] [--require-review-presence]
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

import { execFileSync } from "node:child_process";
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

/** Builds the `ReviewEvidenceOptions` half of the section this script emits. See this file's header for `headShaUnderTest`. */
export function buildReviewEvidenceOptions({ headShaUnderTest, requireReviewPresence }) {
  const options = { requireReviewPresence: requireReviewPresence === true };
  if (typeof headShaUnderTest === "string" && headShaUnderTest.length > 0) options.headShaUnderTest = headShaUnderTest;
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
  { fetchPullRequest = defaultFetchPullRequest, fetchBranchRules = defaultFetchBranchRules, repoFromGh = defaultRepoFromGh } = {},
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
    },
  });

  if (!values.pr) fail("--pr <number> is required");
  if (!values.head || !isSha(values.head)) fail("--head <40-lowercase-hex-sha> is required — the exact commit this run is testing");

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
    pullRequest = fetchPullRequest({ owner, name, number: Number(values.pr) });
  } catch (error) {
    fail(`could not fetch pull request #${values.pr}: ${error.message}`);
  }
  if (!pullRequest) fail(`pull request #${values.pr} was not found in ${owner}/${name}`);

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
  const evidence = buildReviewEvidenceBundle(pullRequest);
  const policy = buildReviewPolicy(policyRaw, { requiredChecksFromRuleset });
  const options = buildReviewEvidenceOptions({
    headShaUnderTest: values.head,
    requireReviewPresence: values["require-review-presence"],
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

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
