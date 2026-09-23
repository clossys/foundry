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
  main,
  parseMergeGroupQueueRef,
  resolveMergeGroupHead,
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

test("resolveMergeGroupHead: a PR head contained in the group becomes the commit under test", () => {
  const calls = [];
  const result = resolveMergeGroupHead({
    groupHeadSha: GROUP_HEAD,
    prHead: `${HEAD}\n`,
    isAncestor: (ancestor, descendant) => {
      calls.push([ancestor, descendant]);
      return true;
    },
  });
  assert.deepEqual(result, { headShaUnderTest: HEAD, mergeGroup: { headSha: GROUP_HEAD, containsHeadShaUnderTest: true } });
  assert.deepEqual(calls, [[HEAD, GROUP_HEAD]]); // ancestry asked of the PR head against the GROUP commit, never the base
});

test("resolveMergeGroupHead: a PR head NOT contained in the group is recorded as exactly that, for the inspector to refuse", () => {
  const result = resolveMergeGroupHead({ groupHeadSha: GROUP_HEAD, prHead: HEAD, isAncestor: () => false });
  assert.deepEqual(result, { headShaUnderTest: HEAD, mergeGroup: { headSha: GROUP_HEAD, containsHeadShaUnderTest: false } });
});

test("resolveMergeGroupHead fails closed when the head or its ancestry cannot be established", () => {
  assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: GROUP_HEAD, prHead: "", isAncestor: () => true }).error, "string");
  assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: "x", prHead: HEAD, isAncestor: () => true }).error, "string");
  const thrown = resolveMergeGroupHead({
    groupHeadSha: GROUP_HEAD,
    prHead: HEAD,
    isAncestor: () => {
      throw new Error("fatal: Not a valid commit name");
    },
  });
  assert.equal(typeof thrown.error, "string");
  assert.equal(typeof resolveMergeGroupHead({ groupHeadSha: GROUP_HEAD, prHead: HEAD, isAncestor: () => undefined }).error, "string");
});

function runMergeGroupMain({ payload, prHead, contained }) {
  let written = "";
  const ancestryAsked = [];
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
      isAncestor: (ancestor, descendant) => {
        ancestryAsked.push([ancestor, descendant]);
        return contained;
      },
      fetchBranchRules: () => {
        throw new Error("not requested");
      },
      write: (text) => {
        written += text;
      },
    },
  );
  return { document: JSON.parse(written), ancestryAsked };
}

const approvedAtHead = {
  pageInfo: { hasNextPage: false, hasPreviousPage: false },
  nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-23T00:00:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
};

test("main on a merge group: the commit under test is the PR's own head (never the queue base), proven contained in the group commit", () => {
  const { document, ancestryAsked } = runMergeGroupMain({
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
  assert.deepEqual(ancestryAsked, [[HEAD, GROUP_HEAD]]);
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

test("main on a merge group: a PR head the group does not contain is emitted as containsHeadShaUnderTest: false, never dropped", () => {
  const { document } = runMergeGroupMain({
    payload: fullGraphQlPayload({ reviews: approvedAtHead }),
    prHead: HEAD,
    contained: false,
  });
  assert.deepEqual(document.reviewEvidence.options.mergeGroup, { headSha: GROUP_HEAD, containsHeadShaUnderTest: false });
});

test("main on a pull_request: unchanged -- --head is the commit under test, no mergeGroup, no ancestry question asked", () => {
  let written = "";
  main(["--pr", "7", "--head", HEAD, "--repo", "an-owner/a-repo", "--policy", "does-not-exist.review-policy.json"], {
    fetchPullRequest: () => fullGraphQlPayload(),
    fetchPullRequestHead: () => {
      throw new Error("must not be read on the pull_request path");
    },
    isAncestor: () => {
      throw new Error("must not be asked on the pull_request path");
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
