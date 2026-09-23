import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChecksFromRollup,
  buildReviewEvidenceBundle,
  buildReviewEvidenceOptions,
  buildReviewEvidenceSection,
  buildReviewPolicy,
  buildReviewsFromConnection,
  buildThreadsFromConnection,
  deriveRequiredChecksFromRuleset,
  EXCLUDED_SELF_CONTEXTS,
  mergeReviewEvidenceIntoInputs,
  normalizeCheckConclusion,
  normalizeReviewDecision,
  normalizeStatusState,
  parseMergeGroupQueueRef,
  resolvePrAndHead,
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
// its own synthetic head_ref. These four cases are the ones #1253's own
// brief calls out by name -- an approved head, a head reviewed at a
// different sha, a BLOCKING (changes-requested) review, and a malformed
// ref -- proven the same way as the pull_request-triggered SATISFIED/
// VIOLATED/INDETERMINATE cases above: by asserting on the bundle and
// options this collector actually produces, not by importing the real
// validator (see this file's own header for why it cannot).
// ---------------------------------------------------------------------------

const QUEUE_PR_NUMBER = 1234;

function queueRef(number, sha) {
  return `refs/heads/gh-readonly-queue/main/pr-${number}-${sha}`;
}

test("parseMergeGroupQueueRef reads the queued PR's number and head sha out of a merge_group head_ref", () => {
  assert.deepEqual(parseMergeGroupQueueRef(queueRef(QUEUE_PR_NUMBER, HEAD)), { number: QUEUE_PR_NUMBER, headSha: HEAD });
  // The `refs/heads/` prefix is optional -- some contexts hand this value
  // over without it -- but nothing else about the shape bends.
  assert.deepEqual(parseMergeGroupQueueRef(`gh-readonly-queue/main/pr-${QUEUE_PR_NUMBER}-${HEAD}`), {
    number: QUEUE_PR_NUMBER,
    headSha: HEAD,
  });
});

test("parseMergeGroupQueueRef refuses a malformed ref rather than guessing", () => {
  assert.equal(parseMergeGroupQueueRef(undefined), null);
  assert.equal(parseMergeGroupQueueRef(""), null);
  assert.equal(parseMergeGroupQueueRef("refs/heads/main"), null); // an ordinary branch, not a queue ref
  assert.equal(parseMergeGroupQueueRef("refs/heads/gh-readonly-queue/main/pr-not-a-number-" + HEAD), null);
  assert.equal(parseMergeGroupQueueRef(`refs/heads/gh-readonly-queue/main/pr-${QUEUE_PR_NUMBER}-tooshort`), null); // sha not 40 hex chars
});

test("resolvePrAndHead refuses a malformed merge_group head_ref (this is the CLI's own refusal path, not process.exit)", () => {
  const result = resolvePrAndHead({ mergeGroupHeadRef: "not-a-queue-ref" });
  assert.equal(typeof result.error, "string");
  assert.equal(result.pr, undefined);
  assert.equal(result.head, undefined);
});

test("resolvePrAndHead resolves a well-formed merge_group head_ref to the queued PR's own number and head sha, overriding any --pr/--head also passed", () => {
  const resolved = resolvePrAndHead({ pr: "999", head: OTHER_HEAD, mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, HEAD) });
  assert.deepEqual(resolved, { pr: String(QUEUE_PR_NUMBER), head: HEAD });
});

test("resolvePrAndHead still requires --pr and a valid --head when no merge_group ref is supplied (the ordinary pull_request path, unchanged)", () => {
  assert.equal(typeof resolvePrAndHead({}).error, "string");
  assert.equal(typeof resolvePrAndHead({ pr: "1" }).error, "string");
  assert.equal(typeof resolvePrAndHead({ pr: "1", head: "not-a-sha" }).error, "string");
  assert.deepEqual(resolvePrAndHead({ pr: "1", head: HEAD }), { pr: "1", head: HEAD });
});

test("merge-group case: an approved head -- resolved head sha matches an APPROVED review at that exact commit", () => {
  const resolved = resolvePrAndHead({ mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, HEAD) });
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [] },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: resolved.head, requireReviewPresence: false });

  // Same shape as the pull_request SATISFIED case above, built from the
  // merge-group-resolved head instead of a directly-supplied --head: no
  // mismatch, an approval at the exact resolved commit, nothing blocking.
  assert.equal(options.headShaUnderTest, bundle.headSha);
  assert.equal(bundle.reviews[0].state, "approved");
  assert.equal(bundle.reviews[0].headSha, bundle.headSha);
});

test("merge-group case: a head reviewed at a different sha is refused (evidence-head-mismatch), never silently accepted", () => {
  const resolved = resolvePrAndHead({ mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, HEAD) });
  // The live query answers for a DIFFERENT commit than the one the queue ref
  // actually named -- the same "stale replay / push landed in between"
  // shape as the pull_request INDETERMINATE case above, reached this time
  // through the merge-group resolution path instead of a directly-supplied
  // --head.
  const payload = fullGraphQlPayload({
    headRefOid: OTHER_HEAD,
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: OTHER_HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: resolved.head, requireReviewPresence: false });

  assert.notEqual(options.headShaUnderTest, bundle.headSha);
  assert.equal(options.headShaUnderTest, HEAD); // what the queue ref actually named
  assert.equal(bundle.headSha, OTHER_HEAD); // what the live query answered instead
});

test("merge-group case: a BLOCKING (changes-requested) review at the resolved head is refused", () => {
  const resolved = resolvePrAndHead({ mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, HEAD) });
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "CHANGES_REQUESTED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: resolved.head, requireReviewPresence: false });

  assert.equal(options.headShaUnderTest, bundle.headSha); // right commit -- no mismatch to hide behind
  assert.equal(bundle.reviews[0].state, "changes-requested"); // BLOCKING, unconditional per validate.ts
  assert.equal(bundle.reviews[0].headSha, bundle.headSha);
});

test("merge-group case: an approval followed by a LATER blocking review at the same head is still refused -- 'no later BLOCKING' is evaluated by validateReviewEvidence's latest-per-reviewer rule, not by this collector reordering anything", () => {
  const resolved = resolvePrAndHead({ mergeGroupHeadRef: queueRef(QUEUE_PR_NUMBER, HEAD) });
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [
        { id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } },
        { id: "R2", state: "CHANGES_REQUESTED", submittedAt: "2026-09-23T01:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } },
      ],
    },
  });
  const bundle = buildReviewEvidenceBundle(payload);
  const options = buildReviewEvidenceOptions({ headShaUnderTest: resolved.head, requireReviewPresence: false });

  // This collector passes BOTH submissions through untouched, in the order
  // GitHub returned them, each stamped with its own submittedAt --
  // packages/controller/src/review/validate.ts's validateReviews is what
  // groups by instanceId and keeps the latest submittedAt per reviewer (see
  // that file's own "latestByInstance" comment), which is what makes the
  // later CHANGES_REQUESTED the one that counts. Asserted here at the level
  // this file can prove without importing the real validator.
  assert.equal(bundle.reviews.length, 2);
  assert.equal(bundle.reviews[0].state, "approved");
  assert.equal(bundle.reviews[1].state, "changes-requested");
  assert.ok(bundle.reviews[1].submittedAt > bundle.reviews[0].submittedAt);
  assert.equal(options.headShaUnderTest, bundle.headSha);
});
