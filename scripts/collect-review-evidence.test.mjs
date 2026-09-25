import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyMechanicalMergeCarry,
  assessMechanicalMergeCarry,
  buildChecksFromRollup,
  buildReviewEvidenceBundle,
  buildReviewEvidenceOptions,
  buildReviewEvidenceSection,
  buildReviewPolicy,
  buildReviewsFromConnection,
  buildThreadsFromConnection,
  deriveRequiredChecksFromRuleset,
  EXCLUDED_SELF_CONTEXTS,
  findMechanicalMergeCarry,
  gitBranchTipReader,
  gitIsAncestorReader,
  gitParentsReader,
  gitRemergeDiffIsEmptyReader,
  latestDecisiveApprovedHeads,
  latestDecisiveApprovedInstancesAt,
  mergeReviewEvidenceIntoInputs,
  normalizeCheckConclusion,
  normalizeReviewDecision,
  normalizeStatusState,
  gitSecondParentReader,
  main,
  parseMergeGroupQueueRef,
  resolveMergeGroupHead,
  resolvePrAndHead,
  verifyChainIsMechanical,
  walkFirstParentChain,
} from "./collect-review-evidence.mjs";

// This suite proves the pure normalization layer only — no network, no `gh`.
// The same "policy is pure, network is injectable" discipline
// scripts/land-stack.mjs's canMerge() and scripts/check-merge-policy.mjs's
// evaluate() already use, which is what lets this run in the dependency-free
// check:gates lane (see collect-review-evidence.mjs's own header for why it
// cannot import a built package there).
//
// "Prove all three verdicts" (satisfied / violated / indeterminate) is read
// literally below: each of the three sections near the bottom builds a
// bundle with THIS script's own functions and then asserts, against the
// exact rules read out of packages/controller/src/review/validate.ts, that
// the bundle contains what would make `validateReviewEvidence` decide that
// way. This suite does not import `validateReviewEvidence` itself — it
// cannot, pre-build (see collect-review-evidence.mjs's header) — so it is
// not a substitute for packages/inspector/src/review-evidence.test.ts
// (which already proves checkReviewEvidence's own three verdicts against a
// hand-built bundle) or packages/controller/src/review/validate.test.ts.
// What it proves is narrower and just as necessary: that THIS repository's
// collector, given a realistic GitHub API payload, produces a bundle that
// hits each of the three cases rather than one that merely LOOKS plausible.
// scripts/collect-review-evidence.integration.test.mjs is the companion that
// closes the gap by running the real, built validator against fixtures built
// the same way — it needs `npm run build` first, so it runs in ci.yml's
// post-build job instead of here.

const HEAD = "a".repeat(40);
const OTHER_HEAD = "c".repeat(40);
const BASE = "b".repeat(40);

test("normalizeCheckConclusion maps every GitHub CheckRun conclusion, and null/unrecognized honestly", () => {
  assert.equal(normalizeCheckConclusion("SUCCESS"), "success");
  assert.equal(normalizeCheckConclusion("success"), "success");
  assert.equal(normalizeCheckConclusion("FAILURE"), "failure");
  assert.equal(normalizeCheckConclusion("STARTUP_FAILURE"), "failure");
  assert.equal(normalizeCheckConclusion("STALE"), "failure");
  assert.equal(normalizeCheckConclusion("NEUTRAL"), "neutral");
  assert.equal(normalizeCheckConclusion("SKIPPED"), "skipped");
  assert.equal(normalizeCheckConclusion("CANCELLED"), "cancelled");
  assert.equal(normalizeCheckConclusion("TIMED_OUT"), "timed-out");
  assert.equal(normalizeCheckConclusion("ACTION_REQUIRED"), "action-required");
  // A CheckRun that has not finished yet reports `conclusion: null` — a true
  // fact about the run, mapped to "pending", never invented as "failure".
  assert.equal(normalizeCheckConclusion(null), "pending");
  assert.equal(normalizeCheckConclusion(undefined), "pending");
  assert.equal(normalizeCheckConclusion(""), "pending");
  assert.equal(normalizeCheckConclusion("something-a-future-github-adds"), "unknown");
});

test("normalizeReviewDecision maps every GitHub review state GraphQL can report for a submitted review", () => {
  assert.equal(normalizeReviewDecision("APPROVED"), "approved");
  assert.equal(normalizeReviewDecision("CHANGES_REQUESTED"), "changes-requested");
  assert.equal(normalizeReviewDecision("COMMENTED"), "commented");
  assert.equal(normalizeReviewDecision("DISMISSED"), "dismissed");
  assert.equal(normalizeReviewDecision(null), "unknown");
  assert.equal(normalizeReviewDecision("PENDING"), "unknown"); // never reached in practice — PENDING is filtered before this runs.
});

test("normalizeStatusState maps the legacy commit-status vocabulary", () => {
  assert.equal(normalizeStatusState("SUCCESS"), "success");
  assert.equal(normalizeStatusState("FAILURE"), "failure");
  assert.equal(normalizeStatusState("ERROR"), "failure");
  assert.equal(normalizeStatusState("PENDING"), "pending");
  assert.equal(normalizeStatusState("EXPECTED"), "pending");
  assert.equal(normalizeStatusState(undefined), "pending");
  assert.equal(normalizeStatusState("something-else"), "unknown");
});

test("buildChecksFromRollup reads a completed CheckRun, stamping the caller's headSha onto every entry", () => {
  const { checks, complete } = buildChecksFromRollup(
    {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ __typename: "CheckRun", name: "verify-standards", conclusion: "SUCCESS", completedAt: "2026-09-14T07:53:00Z" }],
    },
    HEAD,
  );
  assert.equal(complete, true);
  assert.deepEqual(checks, [{ name: "verify-standards", conclusion: "success", headSha: HEAD, completedAt: "2026-09-14T07:53:00Z" }]);
});

test("buildChecksFromRollup reports no completedAt for a CheckRun that has not finished", () => {
  const { checks } = buildChecksFromRollup(
    { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ __typename: "CheckRun", name: "slow-job", conclusion: null, completedAt: null }] },
    HEAD,
  );
  assert.deepEqual(checks, [{ name: "slow-job", conclusion: "pending", headSha: HEAD }]);
  assert.equal("completedAt" in checks[0], false);
});

test("buildChecksFromRollup normalizes a legacy StatusContext entry too, omitting completedAt while pending", () => {
  const { checks } = buildChecksFromRollup(
    {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [
        { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", createdAt: "2026-09-14T07:53:00Z" },
        { __typename: "StatusContext", context: "ci/legacy-pending", state: "PENDING", createdAt: "2026-09-14T07:53:00Z" },
      ],
    },
    HEAD,
  );
  assert.deepEqual(checks[0], { name: "ci/legacy", conclusion: "success", headSha: HEAD, completedAt: "2026-09-14T07:53:00Z" });
  assert.deepEqual(checks[1], { name: "ci/legacy-pending", conclusion: "pending", headSha: HEAD });
});

test("buildChecksFromRollup reports incomplete when GraphQL says another page exists", () => {
  const { complete } = buildChecksFromRollup({ pageInfo: { hasNextPage: true, hasPreviousPage: false }, nodes: [] }, HEAD);
  assert.equal(complete, false);
});

test("buildReviewsFromConnection drops PENDING (unsubmitted draft) reviews entirely", () => {
  const { reviews } = buildReviewsFromConnection(
    {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "PENDING", submittedAt: null, commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
    HEAD,
  );
  assert.deepEqual(reviews, []);
});

test("buildReviewsFromConnection maps a submitted review: provider is the constant 'github', instanceId is the reviewer login, depth is 'primary'", () => {
  const { reviews, complete } = buildReviewsFromConnection(
    {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R2", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
    HEAD,
  );
  assert.equal(complete, true);
  assert.deepEqual(reviews, [
    {
      id: "R2",
      reviewerId: "a-reviewer",
      instanceId: "a-reviewer",
      provider: "github",
      submittedAt: "2026-09-14T07:53:00Z",
      state: "approved",
      depth: "primary",
      headSha: HEAD,
    },
  ]);
});

test("buildReviewsFromConnection reads each review's OWN commit.oid, not the connection's caller-supplied headSha — this is what lets a stale review differ from the bundle head", () => {
  const { reviews } = buildReviewsFromConnection(
    { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "R3", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: OTHER_HEAD }, author: { login: "a-reviewer" } }] },
    HEAD,
  );
  assert.equal(reviews[0].headSha, OTHER_HEAD);
  assert.notEqual(reviews[0].headSha, HEAD);
});

test("buildReviewsFromConnection reports an unresolvable author (a deleted account) as an empty reviewerId/instanceId rather than inventing one", () => {
  const { reviews } = buildReviewsFromConnection(
    { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "R4", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: HEAD }, author: null }] },
    HEAD,
  );
  assert.equal(reviews[0].reviewerId, "");
  assert.equal(reviews[0].instanceId, "");
});

test("buildThreadsFromConnection stamps every thread with the bundle's own headSha, and reads isResolved literally", () => {
  const { threads, complete } = buildThreadsFromConnection(
    { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "T1", isResolved: false }, { id: "T2", isResolved: true }] },
    HEAD,
  );
  assert.equal(complete, true);
  assert.deepEqual(threads, [
    { id: "T1", isResolved: false, headSha: HEAD },
    { id: "T2", isResolved: true, headSha: HEAD },
  ]);
});

test("deriveRequiredChecksFromRuleset reuses extractRequiredContexts and excludes this script's own context", () => {
  const branchRules = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [{ context: "build and test" }, { context: "verify-standards" }, { context: "scope drift" }],
      },
    },
    { type: "pull_request", parameters: {} },
  ];
  assert.deepEqual(deriveRequiredChecksFromRuleset(branchRules), ["build and test", "scope drift"]);
  assert.deepEqual(EXCLUDED_SELF_CONTEXTS, ["verify-standards"]);
});

test("deriveRequiredChecksFromRuleset returns an empty list for a ruleset with no required_status_checks rule, never throwing", () => {
  assert.deepEqual(deriveRequiredChecksFromRuleset([{ type: "pull_request", parameters: {} }]), []);
  assert.deepEqual(deriveRequiredChecksFromRuleset([]), []);
});

test("buildReviewPolicy defaults to advisory/no-requirement when the policy file is empty, and never invents a requiredChecks entry", () => {
  assert.deepEqual(buildReviewPolicy({}), { requiredChecks: [], requireApproval: false, requireSecondaryReview: false, decisionUse: "advisory" });
});

test("buildReviewPolicy reads explicit values from the policy file", () => {
  assert.deepEqual(buildReviewPolicy({ requiredChecks: ["ci"], requireApproval: true, requireSecondaryReview: true, decisionUse: "authoritative" }), {
    requiredChecks: ["ci"],
    requireApproval: true,
    requireSecondaryReview: true,
    decisionUse: "authoritative",
  });
});

test("buildReviewPolicy prefers a ruleset-derived requiredChecks list over the policy file's own value, when supplied", () => {
  const policy = buildReviewPolicy({ requiredChecks: ["from-file"] }, { requiredChecksFromRuleset: ["from-ruleset"] });
  assert.deepEqual(policy.requiredChecks, ["from-ruleset"]);
});

test("buildReviewEvidenceOptions requires an explicit requireReviewPresence, matching ReviewEvidenceOptions' own no-default contract", () => {
  assert.deepEqual(buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false }), {
    requireReviewPresence: false,
    headShaUnderTest: HEAD,
  });
  assert.equal(buildReviewEvidenceOptions({ requireReviewPresence: true }).requireReviewPresence, true);
});

test("buildReviewEvidenceOptions omits headShaUnderTest entirely when none was supplied, rather than writing an empty string", () => {
  const options = buildReviewEvidenceOptions({ requireReviewPresence: false });
  assert.equal("headShaUnderTest" in options, false);
});

test("mergeReviewEvidenceIntoInputs preserves an existing taskRecord section untouched and stamps the schema version", () => {
  const merged = mergeReviewEvidenceIntoInputs(
    { schemaVersion: 1, taskRecord: { observation: { eventKind: "pull_request" } } },
    { reviewEvidence: { evidence: "stand-in", policy: "stand-in", options: "stand-in" } },
  );
  assert.deepEqual(merged, {
    schemaVersion: 1,
    taskRecord: { observation: { eventKind: "pull_request" } },
    reviewEvidence: { evidence: "stand-in", policy: "stand-in", options: "stand-in" },
  });
});

test("mergeReviewEvidenceIntoInputs builds a standalone document when there is nothing to merge into", () => {
  const merged = mergeReviewEvidenceIntoInputs(undefined, { reviewEvidence: { evidence: "e", policy: "p", options: "o" } });
  assert.deepEqual(merged, { schemaVersion: 1, reviewEvidence: { evidence: "e", policy: "p", options: "o" } });
});

// ---------------------------------------------------------------------------
// The two-direction proof, plus satisfied — see this file's own header for
// what "prove" means at this pre-build layer.
// ---------------------------------------------------------------------------

function fullGraphQlPayload(overrides = {}) {
  return {
    headRefOid: HEAD,
    baseRefOid: BASE,
    reviews: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [] },
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [] } } } }] },
    ...overrides,
  };
}

test("SATISFIED shape: a clean bundle at the head under test, with real evidence and no live objection", () => {
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "T1", isResolved: true }] },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  // validateReviewEvidence's SATISFIED path (packages/controller/src/review/validate.ts):
  // pagination complete, every review/thread bound to the bundle's own head
  // (never "stale-evidence"), no changes-requested review, no unresolved
  // thread, and headShaUnderTest === bundle.headSha (never
  // "evidence-head-mismatch") — at least one item to evaluate.
  assert.equal(bundle.paginationComplete, true);
  assert.equal(bundle.reviews.every((review) => review.state !== "changes-requested"), true);
  assert.equal(bundle.threads.every((thread) => thread.isResolved === true), true);
  assert.equal(bundle.reviews.every((review) => review.headSha === bundle.headSha), true);
  assert.equal(bundle.threads.every((thread) => thread.headSha === bundle.headSha), true);
  assert.equal(options.headShaUnderTest, bundle.headSha);
  assert.equal(bundle.checks.length + bundle.reviews.length + bundle.threads.length > 0, true);
});

test("VIOLATED shape: a live unresolved thread at the head under test — unconditional, regardless of policy", () => {
  const payload = fullGraphQlPayload({
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "T1", isResolved: false }] },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  // validate.ts's validateThreads pushes "unresolved-thread" (a `"violation"`
  // rule per RULE_CLASS in review-evidence.ts) whenever a current-head
  // thread's isResolved is false — unconditionally, never opted out of by a
  // policy (see validateReviewEvidence's own comment: "This is the one
  // authority a policy can never opt out of").
  assert.equal(bundle.threads[0].isResolved, false);
  assert.equal(bundle.threads[0].headSha, bundle.headSha);
  assert.equal(options.headShaUnderTest, bundle.headSha);
});

test("VIOLATED shape: a live changes-requested review at the head under test", () => {
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "CHANGES_REQUESTED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  assert.equal(bundle.reviews[0].state, "changes-requested");
  assert.equal(bundle.reviews[0].headSha, bundle.headSha);
});

test("INDETERMINATE shape: evidence bound to a DIFFERENT head than the one under test (a new commit landed after collection)", () => {
  // The scenario #403 names explicitly: a review lands, then a new commit
  // pushes the head forward before this collector's own query runs (or a
  // stale workflow run is replayed). The live query still answers with
  // *some* head — just not the one this run was told to test.
  const payload = fullGraphQlPayload({
    headRefOid: OTHER_HEAD, // what GitHub reports as the live head right now
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: OTHER_HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  // headShaUnderTest is what THIS run was actually told to check — read
  // from --head, independent of whatever the live query returned.
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  // checkReviewEvidence's own headShaUnderTest check (packages/inspector/src/
  // review-evidence.ts): `options.headShaUnderTest !== bundle.headSha` is
  // reported "evidence-head-mismatch", indeterminate — never folded into
  // "violated". Everything about this bundle is otherwise well-formed (a
  // clean approval, at ITS OWN head) — this is not a bundle with a defect,
  // it is a bundle about the wrong commit.
  assert.notEqual(options.headShaUnderTest, bundle.headSha);
  assert.equal(bundle.headSha, OTHER_HEAD);
  assert.equal(options.headShaUnderTest, HEAD);
  // And the bundle is otherwise internally consistent — the review really
  // is clean evidence, just for a commit nobody asked about.
  assert.equal(bundle.reviews[0].headSha, bundle.headSha);
  assert.equal(bundle.reviews[0].state, "approved");
});

test("INDETERMINATE shape: a stale review, submitted against a commit that predates the current head (force-push / amended push)", () => {
  // The other way the SAME distinction shows up: the live head is what this
  // run expects, but one review inside the bundle names an EARLIER commit —
  // exactly what happens when a reviewer approves, and then a new commit is
  // pushed without anyone re-reviewing.
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: OTHER_HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  // validateReviews' "stale-evidence" rule (an `"evaluability"` rule) fires
  // when a review's own headSha does not match the bundle's headSha — this
  // is the SAME bundle-internal mechanism `normalizeGitHubReviewEvidence`
  // relies on in packages/controller/src/review/github.ts, proven here from
  // this collector's own output rather than assumed.
  assert.equal(options.headShaUnderTest, bundle.headSha); // the OUTER head matches — this is the inner, per-review mismatch.
  assert.notEqual(bundle.reviews[0].headSha, bundle.headSha);
});

test("buildReviewEvidenceSection assembles the exact VerifyStandardsInputs['reviewEvidence'] shape", () => {
  const bundle = buildReviewEvidenceBundle(fullGraphQlPayload());
  const policy = buildReviewPolicy({});
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });
  const section = buildReviewEvidenceSection({ evidence: bundle, policy, options });
  assert.deepEqual(Object.keys(section), ["reviewEvidence"]);
  assert.deepEqual(Object.keys(section.reviewEvidence).sort(), ["evidence", "options", "policy"]);
});

// ---------------------------------------------------------------------------
// merge_group support (#1253): a merge-group run names no PR directly, only
// its own synthetic head_ref and the group commit it built. The sha embedded
// in head_ref is the BASE the entry was queued onto, never the PR's head --
// reading it as the head is what made run 35929488634 (PR #1374 at b7fb8925,
// queued onto main at 5784ce21) report evidence-head-mismatch against main's
// own tip and eject every queue entry. These cases prove the collector now
// binds the commit under test to the PR's own head, proven to be contained
// in the group commit, and fails closed everywhere that cannot be shown.
// ---------------------------------------------------------------------------

const QUEUE_PR_NUMBER = 1234;
const QUEUE_BASE = "e".repeat(40);
const GROUP_HEAD = "d".repeat(40);

function queueRef(number, sha) {
  return `refs/heads/gh-readonly-queue/main/pr-${number}-${sha}`;
}

test("parseMergeGroupQueueRef reads the queued PR's number and the BASE sha (never a head) out of a merge_group head_ref", () => {
  assert.deepEqual(parseMergeGroupQueueRef(queueRef(QUEUE_PR_NUMBER, QUEUE_BASE)), { number: QUEUE_PR_NUMBER, baseSha: QUEUE_BASE });
  // The `refs/heads/` prefix is optional -- some contexts hand this value
  // over without it -- but nothing else about the shape bends.
  assert.deepEqual(parseMergeGroupQueueRef(`gh-readonly-queue/main/pr-${QUEUE_PR_NUMBER}-${QUEUE_BASE}`), {
    number: QUEUE_PR_NUMBER,
    baseSha: QUEUE_BASE,
  });
  // The measured #1253 shape: nothing named `headSha` comes out of the ref.
  const measured = parseMergeGroupQueueRef("gh-readonly-queue/main/pr-1374-5784ce21c11a5c01f0f75ec9d0a932faf5f16faa");
  assert.deepEqual(measured, { number: 1374, baseSha: "5784ce21c11a5c01f0f75ec9d0a932faf5f16faa" });
  assert.equal("headSha" in measured, false);
});

test("parseMergeGroupQueueRef refuses a malformed ref rather than guessing", () => {
  assert.equal(parseMergeGroupQueueRef(undefined), null);
  assert.equal(parseMergeGroupQueueRef(""), null);
  assert.equal(parseMergeGroupQueueRef("refs/heads/main"), null); // an ordinary branch, not a queue ref
  assert.equal(parseMergeGroupQueueRef("refs/heads/gh-readonly-queue/main/pr-not-a-number-" + QUEUE_BASE), null);
  assert.equal(parseMergeGroupQueueRef(`refs/heads/gh-readonly-queue/main/pr-${QUEUE_PR_NUMBER}-tooshort`), null); // sha not 40 hex chars
});

test("resolvePrAndHead refuses a malformed merge_group head_ref (this is the CLI's own refusal path, not process.exit)", () => {
  const result = resolvePrAndHead({ mergeGroupHeadRef: "not-a-queue-ref", mergeGroupHeadSha: GROUP_HEAD });
  assert.equal(typeof result.error, "string");
  assert.equal(result.pr, undefined);
  assert.equal(result.head, undefined);
});

test("resolvePrAndHead refuses a merge_group head_ref with no (or a malformed) group head sha", () => {
  assert.equal(typeof resolvePrAndHead({ mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, QUEUE_BASE) }).error, "string");
  assert.equal(
    typeof resolvePrAndHead({ mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, QUEUE_BASE), mergeGroupHeadSha: "nope" }).error,
    "string",
  );
});

test("resolvePrAndHead resolves a merge_group head_ref to the PR number and the group commit -- and names NO head, overriding any --pr/--head also passed", () => {
  const resolved = resolvePrAndHead({
    pr: "999",
    head: OTHER_HEAD,
    mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, QUEUE_BASE),
    mergeGroupHeadSha: GROUP_HEAD,
  });
  assert.deepEqual(resolved, { pr: String(QUEUE_PR_NUMBER), mergeGroup: { headSha: GROUP_HEAD, baseSha: QUEUE_BASE } });
  assert.equal(resolved.head, undefined);
});

test("resolvePrAndHead still requires --pr and a valid --head when no merge_group ref is supplied (the ordinary pull_request path, unchanged)", () => {
  assert.equal(typeof resolvePrAndHead({}).error, "string");
  assert.equal(typeof resolvePrAndHead({ pr: "1" }).error, "string");
  assert.equal(typeof resolvePrAndHead({ pr: "1", head: "not-a-sha" }).error, "string");
  assert.deepEqual(resolvePrAndHead({ pr: "1", head: HEAD }), { pr: "1", head: HEAD });
});

test("resolveMergeGroupHead: a PR head equal to the group commit's second parent becomes the commit under test", () => {
  const calls = [];
  const result = resolveMergeGroupHead({
    groupHeadSha: GROUP_HEAD,
    prHead: `${HEAD}\n`,
    readSecondParent: (group) => {
      calls.push(group);
      return `${HEAD}\n`;
    },
  });
  assert.deepEqual(result, { headShaUnderTest: HEAD, mergeGroup: { headSha: GROUP_HEAD, containsHeadShaUnderTest: true } });
  assert.deepEqual(calls, [GROUP_HEAD]); // the GROUP commit's parent, never the queue base
});

test("resolveMergeGroupHead: a PR head that is NOT the group commit's second parent is recorded as exactly that, for the inspector to refuse", () => {
  const result = resolveMergeGroupHead({ groupHeadSha: GROUP_HEAD, prHead: HEAD, readSecondParent: () => OTHER_HEAD });
  assert.deepEqual(result, { headShaUnderTest: HEAD, mergeGroup: { headSha: GROUP_HEAD, containsHeadShaUnderTest: false } });
});

test("resolveMergeGroupHead fails closed when the head or the group's second parent cannot be established", () => {
  const second = () => HEAD;
  assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: GROUP_HEAD, prHead: "", readSecondParent: second }).error, "string");
  assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: "x", prHead: HEAD, readSecondParent: second }).error, "string");
  const thrown = resolveMergeGroupHead({
    groupHeadSha: GROUP_HEAD,
    prHead: HEAD,
    readSecondParent: () => {
      throw new Error("no second parent");
    },
  });
  assert.equal(typeof thrown.error, "string");
  assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: GROUP_HEAD, prHead: HEAD, readSecondParent: () => undefined }).error, "string");
});

// A REAL git fixture, not a stub: base B on main, PR commits H0 then H1, and
// group commit G = merge(B2, H1) exactly as the MERGE-method queue builds it.
// H0 is an ancestor of G too -- the "contained somewhere" check accepted it,
// which let a head read that raced a push bind approved evidence at H0 while
// G carried an unreviewed H1. Only G's own second parent may pass.
function withGitFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "collect-review-evidence-git-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "B");
    git("checkout", "-q", "-b", "pr");
    git("commit", "-q", "--allow-empty", "-m", "H0");
    const h0 = git("rev-parse", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "H1");
    const h1 = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    git("commit", "-q", "--allow-empty", "-m", "B2");
    git("merge", "-q", "--no-ff", "--no-edit", "pr");
    const group = git("rev-parse", "HEAD");
    const single = git("rev-parse", "HEAD^1"); // B2: a commit with no second parent (the SQUASH/REBASE shape)
    return fn({ dir, h0, h1, group, single });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("real git: an OLDER PR commit H0 (an ancestor of the group, but not what it merges) is refused; the true second parent H1 passes", () => {
  withGitFixture(({ dir, h0, h1, group }) => {
    const readSecondParent = gitSecondParentReader(dir);
    assert.equal(execFileSync("git", ["merge-base", "--is-ancestor", h0, group], { cwd: dir }).length, 0); // H0 IS an ancestor
    assert.deepEqual(resolveMergeGroupHead({ groupHeadSha: group, prHead: h0, readSecondParent }), {
      headShaUnderTest: h0,
      mergeGroup: { headSha: group, containsHeadShaUnderTest: false },
    });
    assert.deepEqual(resolveMergeGroupHead({ groupHeadSha: group, prHead: h1, readSecondParent }), {
      headShaUnderTest: h1,
      mergeGroup: { headSha: group, containsHeadShaUnderTest: true },
    });
  });
});

test("real git: a group commit with no second parent (SQUASH/REBASE shape) or an unknown commit is an error, never an answer", () => {
  withGitFixture(({ dir, h1, single }) => {
    const readSecondParent = gitSecondParentReader(dir);
    assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: single, prHead: h1, readSecondParent }).error, "string");
    assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: "0".repeat(40), prHead: h1, readSecondParent }).error, "string");
  });
});

function runMergeGroupMain({ payload, prHead, contained }) {
  let written = "";
  const parentsRead = [];
  main(
    [
      "--merge-group-head-ref",
      queueRef(QUEUE_PR_NUMBER, QUEUE_BASE),
      "--merge-group-head-sha",
      GROUP_HEAD,
      "--repo",
      "an-owner/a-repo",
      "--policy",
      "does-not-exist.review-policy.json",
    ],
    {
      fetchPullRequest: ({ number }) => {
        assert.equal(number, QUEUE_PR_NUMBER);
        return payload;
      },
      fetchPullRequestHead: ({ number }) => {
        assert.equal(number, QUEUE_PR_NUMBER);
        return prHead;
      },
      readSecondParent: (group) => {
        parentsRead.push(group);
        return contained ? prHead : OTHER_HEAD;
      },
      fetchBranchRules: () => {
        throw new Error("not requested");
      },
      write: (text) => {
        written += text;
      },
    },
  );
  return { document: JSON.parse(written), parentsRead };
}

const approvedAtHead = {
  pageInfo: { hasNextPage: false, hasPreviousPage: false },
  nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
};

test("main on a merge group: the commit under test is the PR's own head (never the queue base), proven to be the group commit's second parent", () => {
  const { document, parentsRead } = runMergeGroupMain({
    payload: fullGraphQlPayload({ reviews: approvedAtHead }),
    prHead: HEAD,
    contained: true,
  });
  const { evidence, options } = document.reviewEvidence;
  assert.equal(evidence.headSha, HEAD);
  assert.equal(options.headShaUnderTest, HEAD);
  assert.notEqual(options.headShaUnderTest, QUEUE_BASE); // the #1253 defect
  assert.notEqual(options.headShaUnderTest, GROUP_HEAD); // the group commit was never reviewed
  assert.deepEqual(options.mergeGroup, { headSha: GROUP_HEAD, containsHeadShaUnderTest: true });
  assert.deepEqual(parentsRead, [GROUP_HEAD]);
});

test("main on a merge group: evidence bound to a different head than the PR's current head still mismatches (two independent reads)", () => {
  const { document } = runMergeGroupMain({
    payload: fullGraphQlPayload({ headRefOid: OTHER_HEAD }),
    prHead: HEAD,
    contained: true,
  });
  const { evidence, options } = document.reviewEvidence;
  assert.equal(evidence.headSha, OTHER_HEAD); // the GraphQL read the evidence came from
  assert.equal(options.headShaUnderTest, HEAD); // the separate PR-head read
  assert.notEqual(options.headShaUnderTest, evidence.headSha); // -> evidence-head-mismatch in the inspector
});

test("main on a merge group: a PR head that is not what the group merges is emitted as containsHeadShaUnderTest: false, never dropped", () => {
  const { document } = runMergeGroupMain({
    payload: fullGraphQlPayload({ reviews: approvedAtHead }),
    prHead: HEAD,
    contained: false,
  });
  assert.deepEqual(document.reviewEvidence.options.mergeGroup, { headSha: GROUP_HEAD, containsHeadShaUnderTest: false });
});

test("main on a pull_request: unchanged -- --head is the commit under test, no mergeGroup, no group parent read", () => {
  let written = "";
  main(["--pr", "7", "--head", HEAD, "--repo", "an-owner/a-repo", "--policy", "does-not-exist.review-policy.json"], {
    fetchPullRequest: () => fullGraphQlPayload(),
    fetchPullRequestHead: () => {
      throw new Error("must not be read on the pull_request path");
    },
    readSecondParent: () => {
      throw new Error("must not be read on the pull_request path");
    },
    write: (text) => {
      written += text;
    },
  });
  const { options } = JSON.parse(written).reviewEvidence;
  assert.deepEqual(options, { requireReviewPresence: false, headShaUnderTest: HEAD });
});

test("merge-group case: a BLOCKING (changes-requested) review at the contained PR head is still carried through for the inspector to refuse", () => {
  const { document } = runMergeGroupMain({
    payload: fullGraphQlPayload({
      reviews: {
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
        nodes: [
          { id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } },
          { id: "R2", state: "CHANGES_REQUESTED", submittedAt: "2026-09-23T01:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } },
        ],
      },
    }),
    prHead: HEAD,
    contained: true,
  });
  const { evidence, options } = document.reviewEvidence;
  assert.equal(options.headShaUnderTest, evidence.headSha); // right commit -- no mismatch to hide behind
  assert.deepEqual(
    evidence.reviews.map((review) => review.state),
    ["approved", "changes-requested"],
  );
});

// ---------------------------------------------------------------------------
// MECHANICAL-MERGE CARRY (#1428)
// ---------------------------------------------------------------------------
// Round 1 of the PR's own review (both blind reviewers) found the original
// design -- "empty remerge-diff" plus "unchanged git patch-id" -- had a real
// hole (patch-id ignores whitespace, so a side-branch merge that only
// dedents or respaces a line inherited approval for a genuine behavior
// change) and was also a false-negative machine against this repository's
// own real history (5 of 5 recent clean merges from main failed the
// patch-id check, because main's own changeset/version lines sit close
// enough to shift the diff context). The redesign below drops patch-id
// entirely and instead requires every chain merge's SECOND PARENT to be an
// ancestor of the TARGET BRANCH's true tip -- see
// scripts/collect-review-evidence.mjs's "MECHANICAL-MERGE CARRY" section for
// the full reasoning. Unit coverage first (stubbed readers), then a real-git
// fixture proving every required scenario against actual merge commits and
// an actual `git show --remerge-diff` / `git merge-base --is-ancestor`.

const APPROVED = "1".repeat(40);
const CURRENT = "2".repeat(40);
const MID = "3".repeat(40);

const boom = () => assert.fail("must not be called");

test("walkFirstParentChain: headSha === approvedHeadSha needs no walk at all", () => {
  assert.deepEqual(walkFirstParentChain({ headSha: APPROVED, approvedHeadSha: APPROVED, readParents: boom }), { chain: [] });
});

test("walkFirstParentChain: a single clean merge on top of the approved head is a one-entry chain", () => {
  const readParents = (sha) => {
    assert.equal(sha, CURRENT);
    return [APPROVED, MID];
  };
  assert.deepEqual(walkFirstParentChain({ headSha: CURRENT, approvedHeadSha: APPROVED, readParents }), {
    chain: [{ sha: CURRENT, parents: [APPROVED, MID] }],
  });
});

test("walkFirstParentChain fails closed on an unreadable parent, a root reached before the approved head, and a budget exceeded", () => {
  assert.equal(
    typeof walkFirstParentChain({
      headSha: CURRENT,
      approvedHeadSha: APPROVED,
      readParents: () => {
        throw new Error("boom");
      },
    }).error,
    "string",
  );
  assert.equal(
    typeof walkFirstParentChain({ headSha: CURRENT, approvedHeadSha: APPROVED, readParents: () => [] }).error, // a root: no parents at all
    "string",
  );
  let calls = 0;
  const neverArrives = () => {
    calls += 1;
    return [`${calls}`.padStart(40, "0")]; // a fresh sha every step -- APPROVED is never reached
  };
  const result = walkFirstParentChain({ headSha: CURRENT, approvedHeadSha: APPROVED, readParents: neverArrives, maxSteps: 5 });
  assert.equal(typeof result.error, "string");
  assert.equal(calls, 5);
});

test("verifyChainIsMechanical: an empty chain (already at the approved head) is trivially mechanical", () => {
  assert.deepEqual(verifyChainIsMechanical({ chain: [], secondParentIsOnBase: boom, remergeDiffIsEmpty: boom }), { mechanical: true });
});

test("verifyChainIsMechanical checks parent count, THEN second-parent ancestry, THEN remerge-diff -- never a later check when an earlier one already refused", () => {
  // Non-merge commit: neither reader is even consulted.
  assert.match(
    verifyChainIsMechanical({ chain: [{ sha: CURRENT, parents: [APPROVED] }], secondParentIsOnBase: boom, remergeDiffIsEmpty: boom }).reason,
    /not a plain two-parent merge commit/,
  );
  // Octopus merge: same -- refused on shape alone.
  assert.match(
    verifyChainIsMechanical({
      chain: [{ sha: CURRENT, parents: [APPROVED, MID, "4".repeat(40)] }],
      secondParentIsOnBase: boom,
      remergeDiffIsEmpty: boom,
    }).reason,
    /not a plain two-parent merge commit/,
  );
  // Second parent not on the target branch: remerge-diff is never read --
  // a side-branch merge is refused before its diff even matters.
  assert.match(
    verifyChainIsMechanical({
      chain: [{ sha: CURRENT, parents: [APPROVED, MID] }],
      secondParentIsOnBase: () => false,
      remergeDiffIsEmpty: boom,
    }).reason,
    /is not an ancestor of the target branch/,
  );
  // Second parent on base, but a non-empty remerge-diff -- refused at the last check.
  assert.match(
    verifyChainIsMechanical({
      chain: [{ sha: CURRENT, parents: [APPROVED, MID] }],
      secondParentIsOnBase: () => true,
      remergeDiffIsEmpty: () => false,
    }).reason,
    /non-empty remerge-diff/,
  );
  // Both readers may throw -- caught, never propagated.
  assert.match(
    verifyChainIsMechanical({
      chain: [{ sha: CURRENT, parents: [APPROVED, MID] }],
      secondParentIsOnBase: () => {
        throw new Error("git merge-base failed");
      },
      remergeDiffIsEmpty: boom,
    }).reason,
    /could not verify that/,
  );
  assert.match(
    verifyChainIsMechanical({
      chain: [{ sha: CURRENT, parents: [APPROVED, MID] }],
      secondParentIsOnBase: () => true,
      remergeDiffIsEmpty: () => {
        throw new Error("git show failed");
      },
    }).reason,
    /could not read the remerge-diff/,
  );
  // A clean, on-base, empty-diff chain is mechanical.
  assert.deepEqual(
    verifyChainIsMechanical({
      chain: [{ sha: CURRENT, parents: [APPROVED, MID] }],
      secondParentIsOnBase: () => true,
      remergeDiffIsEmpty: () => true,
    }),
    { mechanical: true },
  );
});

test("assessMechanicalMergeCarry refuses malformed shas and the no-op (approved head already current) case before touching any reader", () => {
  assert.equal(
    assessMechanicalMergeCarry({ approvedHeadSha: "not-a-sha", currentHeadSha: CURRENT, readParents: boom, secondParentIsOnBase: boom, remergeDiffIsEmpty: boom })
      .carries,
    false,
  );
  assert.equal(
    assessMechanicalMergeCarry({ approvedHeadSha: APPROVED, currentHeadSha: APPROVED, readParents: boom, secondParentIsOnBase: boom, remergeDiffIsEmpty: boom })
      .carries,
    false,
  );
});

test("assessMechanicalMergeCarry: no patch-id check anymore -- a mechanical chain (on-base, empty remerge-diff) carries regardless of tree content", () => {
  const result = assessMechanicalMergeCarry({
    approvedHeadSha: APPROVED,
    currentHeadSha: CURRENT,
    readParents: (sha) => (sha === CURRENT ? [APPROVED, MID] : []),
    secondParentIsOnBase: () => true,
    remergeDiffIsEmpty: () => true,
  });
  assert.deepEqual(result, { carries: true, approvedHeadSha: APPROVED, currentHeadSha: CURRENT });
});

test("latestDecisiveApprovedHeads: excludes reviews already at the current head, non-approved latest decisions, and ambiguous ties", () => {
  const reviews = [
    // Reviewer A: approved at an earlier head -- a genuine carry candidate.
    { instanceId: "A", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: APPROVED },
    // Reviewer B: approved, but already AT the current head -- nothing to carry.
    { instanceId: "B", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: CURRENT },
    // Reviewer C: approved at an earlier head, but LATER requested changes at that same head -- not a candidate.
    { instanceId: "C", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: MID },
    { instanceId: "C", state: "changes-requested", submittedAt: "2026-01-02T00:00:00Z", headSha: MID },
    // Reviewer D: two decisive records at the exact same instant that disagree -- ambiguous, excluded outright.
    { instanceId: "D", state: "approved", submittedAt: "2026-01-03T00:00:00Z", headSha: "4".repeat(40) },
    { instanceId: "D", state: "changes-requested", submittedAt: "2026-01-03T00:00:00Z", headSha: "4".repeat(40) },
    // Not decisive -- never enters the grouping at all.
    { instanceId: "E", state: "commented", submittedAt: "2026-01-04T00:00:00Z", headSha: "5".repeat(40) },
  ];
  assert.deepEqual(latestDecisiveApprovedHeads(reviews, CURRENT), [APPROVED]);
});

test("latestDecisiveApprovedHeads orders distinct candidate heads most-recently-approved first", () => {
  const older = "6".repeat(40);
  const newer = "7".repeat(40);
  const reviews = [
    { instanceId: "A", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: older },
    { instanceId: "B", state: "approved", submittedAt: "2026-01-05T00:00:00Z", headSha: newer },
  ];
  assert.deepEqual(latestDecisiveApprovedHeads(reviews, CURRENT), [newer, older]);
});

test("latestDecisiveApprovedInstancesAt: selects only the instances whose OWN latest decisive review is approved at exactly that head", () => {
  const reviews = [
    // Reviewer A: approved at APPROVED, nothing later -- selected.
    { instanceId: "A", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: APPROVED },
    // Reviewer B: approved at APPROVED, but LATER (same head) requested changes -- superseded, not selected.
    { instanceId: "B", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: APPROVED },
    { instanceId: "B", state: "changes-requested", submittedAt: "2026-01-02T00:00:00Z", headSha: APPROVED },
    // Reviewer C: approved, but at a DIFFERENT head -- not selected for APPROVED.
    { instanceId: "C", state: "approved", submittedAt: "2026-01-01T00:00:00Z", headSha: MID },
    // Reviewer D: ambiguous tie at APPROVED -- excluded outright.
    { instanceId: "D", state: "approved", submittedAt: "2026-01-03T00:00:00Z", headSha: APPROVED },
    { instanceId: "D", state: "changes-requested", submittedAt: "2026-01-03T00:00:00Z", headSha: APPROVED },
  ];
  assert.deepEqual(latestDecisiveApprovedInstancesAt(reviews, APPROVED), new Set(["A"]));
});

test("findMechanicalMergeCarry: no candidates at all short-circuits without calling any reader", () => {
  const result = findMechanicalMergeCarry({ reviews: [], currentHeadSha: CURRENT, readParents: boom, secondParentIsOnBase: boom, remergeDiffIsEmpty: boom });
  assert.equal(result.carries, false);
});

test("applyMechanicalMergeCarry rebinds only the carried approval's own headSha, leaving every other record untouched", () => {
  const evidence = {
    schemaVersion: 3,
    headSha: CURRENT,
    baseSha: BASE,
    paginationComplete: true,
    checks: [],
    threads: [],
    reviews: [
      { id: "R1", reviewerId: "a", instanceId: "a", provider: "github", submittedAt: "2026-01-01T00:00:00Z", state: "approved", depth: "primary", headSha: APPROVED },
      { id: "R2", reviewerId: "b", instanceId: "b", provider: "github", submittedAt: "2026-01-01T00:00:00Z", state: "commented", depth: "primary", headSha: APPROVED },
    ],
  };
  const carried = applyMechanicalMergeCarry(evidence, { carries: true, approvedHeadSha: APPROVED, currentHeadSha: CURRENT });
  assert.equal(carried.reviews[0].headSha, CURRENT); // the approval -- carried
  assert.equal(carried.reviews[1].headSha, APPROVED); // a non-approval at the same old head -- untouched
  assert.equal(applyMechanicalMergeCarry(evidence, { carries: false }), evidence); // no-op when nothing carries
});

test("applyMechanicalMergeCarry does NOT rebind a superseded approval (reviewer A's non-blocking note, round 1)", () => {
  const evidence = {
    schemaVersion: 3,
    headSha: CURRENT,
    baseSha: BASE,
    paginationComplete: true,
    checks: [],
    threads: [],
    reviews: [
      // This reviewer approved at APPROVED, then, still at that SAME head,
      // requested changes later. The approval is no longer their own
      // decisive answer and must not be resurrected by the carry.
      { id: "R1", reviewerId: "a", instanceId: "a", provider: "github", submittedAt: "2026-01-01T00:00:00Z", state: "approved", depth: "primary", headSha: APPROVED },
      { id: "R2", reviewerId: "a", instanceId: "a", provider: "github", submittedAt: "2026-01-02T00:00:00Z", state: "changes-requested", depth: "primary", headSha: APPROVED },
    ],
  };
  const carried = applyMechanicalMergeCarry(evidence, { carries: true, approvedHeadSha: APPROVED, currentHeadSha: CURRENT });
  assert.equal(carried.reviews[0].headSha, APPROVED); // NOT rebound -- superseded
  assert.equal(carried.reviews[1].headSha, APPROVED); // the changes-requested itself is not an approval -- untouched either way
});

// A REAL git fixture: main at `base` (touching shared.txt), PR branch
// approved at `approved` (adds pr.txt AND edits shared.txt's own line, so a
// later main edit to that SAME line can be made to conflict on purpose).
function withMechanicalMergeFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "collect-review-evidence-mmc-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    }).trim();
  const write = (name, content) => writeFileSync(join(dir, name), content);
  try {
    git("init", "-q", "-b", "main");
    // Three lines, not one: enough surrounding context that an edit to line
    // one and a LATER, separate edit to line three (see the "touches lines
    // near the pull request's own change" scenario below) merge cleanly,
    // while an edit to line one on both sides (the "resolved by hand"
    // scenario) still conflicts exactly as before.
    write("shared.txt", "line one\nline two\nline three\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");

    git("checkout", "-q", "-b", "pr");
    write("shared.txt", "line one, edited by the PR\nline two\nline three\n");
    write("pr.txt", "pr content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "PR change");
    const approved = git("rev-parse", "HEAD");

    return fn({ dir, git, write, base, approved });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The three real readers, all bound to one fixture directory. */
function fixtureReaders(dir) {
  return { readParents: gitParentsReader(dir), remergeDiffIsEmpty: gitRemergeDiffIsEmptyReader(dir), isAncestor: gitIsAncestorReader(dir) };
}

test("real git: a clean merge from the target branch -- empty remerge-diff, second parent on main -- carries", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    git("checkout", "-q", "main");
    write("main.txt", "main content\n"); // does not touch shared.txt -- no conflict
    git("add", "-A");
    git("commit", "-q", "-m", "main advance");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "main");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: approved,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: (sha) => isAncestor(sha, newBase),
      remergeDiffIsEmpty,
    });
    assert.deepEqual(assessment, { carries: true, approvedHeadSha: approved, currentHeadSha: current });
  });
});

test("real git: a clean merge from main that touches lines near the pull request's own change still carries -- the false-negative case reviewer B measured (5/5 real merges) is gone with patch-id", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    // shared.txt's line 1 is already the PR's own reviewed edit. main now
    // ALSO edits shared.txt -- line 3, close by in the same file but not
    // overlapping -- exactly the "changeset/version context line nearby"
    // shape that made the old patch-id check fail closed on 5 of 5 real
    // merges in this repository even though nothing reviewed had changed.
    git("checkout", "-q", "main");
    write("shared.txt", "line one\nline two\nline three, edited by main\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main advance touching the same file, a nearby line");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "main");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: approved,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: (sha) => isAncestor(sha, newBase),
      remergeDiffIsEmpty,
    });
    assert.deepEqual(assessment, { carries: true, approvedHeadSha: approved, currentHeadSha: current });
  });
});

test("real git: a side-branch merge (second parent NOT on main) is refused, even a clean whitespace-only rewrite -- both reviewers' round-1 repro", () => {
  withMechanicalMergeFixture(({ dir, git, write }) => {
    // A guarded call, reviewed and approved.
    write("guard.py", "if authorized:\n    delete_all()\n");
    git("add", "-A");
    git("commit", "-q", "-m", "add the guarded call");
    const guarded = git("rev-parse", "HEAD");

    // On a SIDE branch (never merged into main), dedent the call OUT of its
    // guard -- a real behavior change wearing a whitespace-only diff. The
    // merge below is perfectly clean: no conflict, empty remerge-diff, and
    // (under the OLD design) an unchanged `git patch-id --stable`. Only the
    // "second parent must be on the target branch" check catches it.
    git("checkout", "-q", "-b", "side");
    write("guard.py", "if authorized:\ndelete_all()\n");
    git("add", "-A");
    git("commit", "-q", "-m", "side: dedent (a behavior change disguised as whitespace)");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "side");
    const current = git("rev-parse", "HEAD");

    const mainTip = git("rev-parse", "main"); // `side` was never merged into main -- not an ancestor of it
    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: guarded,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: (sha) => isAncestor(sha, mainTip),
      remergeDiffIsEmpty,
    });
    assert.equal(assessment.carries, false);
    assert.match(assessment.reason, /is not an ancestor of the target branch/);
  });
});

test("real git: a conflict resolved by hand, even with the second parent genuinely on main, never carries (non-empty remerge-diff)", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    git("checkout", "-q", "main");
    write("shared.txt", "line one, edited by main\nline two\nline three\n"); // the SAME line the PR already edited -- a real conflict
    git("add", "-A");
    git("commit", "-q", "-m", "main edits the same line");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    assert.throws(() => git("merge", "-q", "--no-ff", "main")); // the conflict itself
    write("shared.txt", "line one, resolved by hand\nline two\nline three\n"); // a THIRD text -- an unmistakable hand resolution
    git("add", "-A");
    git("commit", "-q", "-m", "resolve conflict by hand");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: approved,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: (sha) => isAncestor(sha, newBase), // genuinely on main -- this check passes
      remergeDiffIsEmpty,
    });
    assert.equal(assessment.carries, false);
    assert.match(assessment.reason, /non-empty remerge-diff/);
  });
});

test("real git: a clean merge with an unrelated edit tacked on (non-empty remerge-diff) never carries", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    git("checkout", "-q", "main");
    write("main.txt", "main content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main advance");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-commit", "main"); // clean merge, staged but not committed
    write("extra.txt", "content nobody reviewed\n"); // tacked on inside the merge commit itself
    git("add", "-A");
    git("commit", "-q", "-m", "merge main, plus an unrelated edit");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: approved,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: (sha) => isAncestor(sha, newBase),
      remergeDiffIsEmpty,
    });
    assert.equal(assessment.carries, false);
    assert.match(assessment.reason, /non-empty remerge-diff/);
  });
});

test("real git: a genuine commit landing after the approved head (not a merge) never carries", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    write("pr2.txt", "a second, unreviewed PR commit\n");
    git("add", "-A");
    git("commit", "-q", "-m", "unreviewed follow-up commit"); // still on `pr`, straight past `approved`

    git("checkout", "-q", "main");
    write("main.txt", "main content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main advance");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "main");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: approved,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: (sha) => isAncestor(sha, newBase),
      remergeDiffIsEmpty,
    });
    assert.equal(assessment.carries, false);
    assert.match(assessment.reason, /not a plain two-parent merge commit/);
  });
});

test("real git: an unreadable history (a current head this repository never heard of) fails closed, never guesses", () => {
  withMechanicalMergeFixture(({ dir, approved }) => {
    const unknownCurrent = "f".repeat(40); // well-formed, but no such commit exists here -- `git rev-list` itself fails
    const { readParents, remergeDiffIsEmpty } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: approved,
      currentHeadSha: unknownCurrent,
      readParents,
      secondParentIsOnBase: boom, // never reached -- the walk fails before any chain is verified
      remergeDiffIsEmpty,
    });
    assert.equal(assessment.carries, false);
    assert.match(assessment.reason, /could not read the parents/);
  });
});

test("real git: a first-parent walk that reaches a root before the approved head fails closed, never guesses", () => {
  withMechanicalMergeFixture(({ dir, git, write }) => {
    git("checkout", "-q", "main");
    write("main.txt", "main content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main advance");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "main");
    const current = git("rev-parse", "HEAD");

    // An "approved" head this repository's PR history simply never contains
    // (well-formed, and `git rev-list` can read every commit it actually
    // walks through -- the walk just never reaches it, and refuses rather
    // than silently stopping at the root).
    const neverApproved = "f".repeat(40);
    const { readParents, remergeDiffIsEmpty } = fixtureReaders(dir);
    const assessment = assessMechanicalMergeCarry({
      approvedHeadSha: neverApproved,
      currentHeadSha: current,
      readParents,
      secondParentIsOnBase: boom, // never reached -- the walk fails first
      remergeDiffIsEmpty,
    });
    assert.equal(assessment.carries, false);
    assert.match(assessment.reason, /no readable first parent before reaching/);
  });
});

test("gitBranchTipReader resolves a remote-tracking ref and fails closed on an unknown branch", () => {
  withMechanicalMergeFixture(({ dir, git }) => {
    const mainTip = git("rev-parse", "main");
    // No real remote is needed -- a remote-tracking ref is just a ref;
    // creating it directly proves the reader reads exactly that namespace.
    git("update-ref", "refs/remotes/origin/main", mainTip);
    const resolveBranchTip = gitBranchTipReader(dir);
    assert.equal(resolveBranchTip("main"), mainTip);
    assert.throws(() => resolveBranchTip("does-not-exist"));
  });
});

test("gitIsAncestorReader answers true/false for real ancestry and throws for an unreadable object", () => {
  withMechanicalMergeFixture(({ dir, approved, base }) => {
    const isAncestor = gitIsAncestorReader(dir);
    assert.equal(isAncestor(base, approved), true); // base is an ancestor of approved
    assert.equal(isAncestor(approved, base), false); // not the other way around
    assert.throws(() => isAncestor("f".repeat(40), approved));
  });
});

test("real git, end to end through main(): a clean merge rebinds the approval's headSha and reports carriedApproval", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    git("checkout", "-q", "main");
    write("main.txt", "main content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main advance");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "main");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    let written = "";
    main(["--pr", "9", "--head", current, "--repo", "an-owner/a-repo", "--policy", "does-not-exist.review-policy.json"], {
      fetchPullRequest: () =>
        fullGraphQlPayload({
          headRefOid: current,
          baseRefOid: newBase,
          reviews: {
            pageInfo: { hasNextPage: false, hasPreviousPage: false },
            nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: approved }, author: { login: "a-reviewer" } }],
          },
        }),
      readParents,
      remergeDiffIsEmpty,
      resolveBranchTip: (branch) => {
        assert.equal(branch, "main"); // the hardcoded default branch, never `--branch`
        return newBase;
      },
      isAncestor,
      write: (text) => {
        written += text;
      },
    });
    const { evidence, options } = JSON.parse(written).reviewEvidence;
    assert.equal(evidence.reviews[0].headSha, current); // rebound -- no longer stale at `approved`
    assert.deepEqual(options.carriedApproval, { fromHeadSha: approved, toHeadSha: current });
  });
});

test("real git, end to end through main(): an unmechanical merge (extra commit) neither rebinds nor reports a carry", () => {
  withMechanicalMergeFixture(({ dir, git, write, approved }) => {
    write("pr2.txt", "a second, unreviewed PR commit\n");
    git("add", "-A");
    git("commit", "-q", "-m", "unreviewed follow-up commit");

    git("checkout", "-q", "main");
    write("main.txt", "main content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main advance");
    const newBase = git("rev-parse", "HEAD");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "main");
    const current = git("rev-parse", "HEAD");

    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    let written = "";
    main(["--pr", "9", "--head", current, "--repo", "an-owner/a-repo", "--policy", "does-not-exist.review-policy.json"], {
      fetchPullRequest: () =>
        fullGraphQlPayload({
          headRefOid: current,
          baseRefOid: newBase,
          reviews: {
            pageInfo: { hasNextPage: false, hasPreviousPage: false },
            nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: approved }, author: { login: "a-reviewer" } }],
          },
        }),
      readParents,
      remergeDiffIsEmpty,
      resolveBranchTip: () => newBase,
      isAncestor,
      write: (text) => {
        written += text;
      },
    });
    const { evidence, options } = JSON.parse(written).reviewEvidence;
    assert.equal(evidence.reviews[0].headSha, approved); // NOT rebound -- still stale, still excluded downstream
    assert.equal(options.carriedApproval, undefined);
  });
});

test("real git, end to end through main(): a pull request retargeted to a non-main base does not carry -- base-tip resolution ignores base.ref/--branch", () => {
  withMechanicalMergeFixture(({ dir, git, write, base, approved }) => {
    // A "decoy" branch, diverged from the fixture's own root -- not main,
    // and not an ancestor of main. Simulates an author retargeting the pull
    // request's base to a branch they also control, then merging THAT in.
    git("checkout", "-q", "-b", "decoy", base);
    write("decoy.txt", "decoy content\n");
    git("add", "-A");
    git("commit", "-q", "-m", "decoy advance");

    git("checkout", "-q", "pr");
    git("merge", "-q", "--no-ff", "--no-edit", "decoy");
    const current = git("rev-parse", "HEAD");

    const mainTip = git("rev-parse", "main");
    const { readParents, remergeDiffIsEmpty, isAncestor } = fixtureReaders(dir);
    let branchAskedFor;
    let written = "";
    main(
      ["--pr", "9", "--head", current, "--repo", "an-owner/a-repo", "--branch", "decoy", "--policy", "does-not-exist.review-policy.json"],
      {
        fetchPullRequest: () =>
          fullGraphQlPayload({
            headRefOid: current,
            baseRefOid: mainTip, // even a payload that still claims "main" is irrelevant -- baseRefOid is never read for the carry either
            reviews: {
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
              nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: approved }, author: { login: "a-reviewer" } }],
            },
          }),
        readParents,
        remergeDiffIsEmpty,
        resolveBranchTip: (branch) => {
          branchAskedFor = branch;
          return mainTip; // simulates the real default-branch resolution -- always "main", never "decoy"
        },
        isAncestor,
        write: (text) => {
          written += text;
        },
      },
    );
    assert.equal(branchAskedFor, "main"); // proves --branch ("decoy") was never consulted for this
    const { evidence, options } = JSON.parse(written).reviewEvidence;
    assert.equal(evidence.reviews[0].headSha, approved); // NOT rebound
    assert.equal(options.carriedApproval, undefined);
  });
});
