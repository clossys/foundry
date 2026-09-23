// collect-review-evidence.integration — proves the three verdicts FOR REAL.
//
// scripts/collect-review-evidence.test.mjs proves this collector's pure
// normalization is shaped the way validateReviewEvidence's own rules (read
// out of packages/controller/src/review/validate.ts) require, but it cannot
// import the built validator — it is wired into check:gates, which runs
// before `npm run build` (see collect-review-evidence.mjs's own header).
// This file closes that gap: it builds the exact same fixtures with this
// collector's own functions and then hands them to the REAL, compiled
// `checkReviewEvidence` (packages/inspector/src/review-evidence.ts) —
// the same function packages/inspector/dist/bin.js's `--checks
// review-evidence` calls — and asserts on the real `GateResult.verdict`.
//
// Needs `npm run build` first (imports @clossys/controller and
// @clossys/inspector by their published entry points, not a relative
// source path), so it runs in .github/workflows/ci.yml's post-build
// "build and test" job via a direct `node --test` step, the same pattern
// scripts/check-publication-map.test.mjs already uses for the same reason
// (see that file and its own step in ci.yml) — never in check:gates.

import assert from "node:assert/strict";
import test from "node:test";

import { checkReviewEvidence } from "@clossys/inspector";

import { buildReviewEvidenceBundle, buildReviewEvidenceOptions, buildReviewPolicy } from "./collect-review-evidence.mjs";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "c".repeat(40);
const BASE = "b".repeat(40);

function fullGraphQlPayload(overrides = {}) {
  return {
    headRefOid: HEAD,
    baseRefOid: BASE,
    reviews: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [] },
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
                nodes: [{ __typename: "CheckRun", name: "some-ci-check", conclusion: "SUCCESS", completedAt: "2026-09-14T07:53:00Z" }],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

test("SATISFIED — a clean bundle at the exact head under test, no policy requirements beyond the unconditional ones", () => {
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: HEAD }, author: { login: "a-reviewer" } }],
    },
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "T1", isResolved: true }] },
  });
  const evidence = buildReviewEvidenceBundle(payload);
  const policy = buildReviewPolicy({}); // this repository's real default: requiredChecks [], advisory, no presence requirement.
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  const report = checkReviewEvidence(evidence, policy, options);
  assert.equal(report.result.verdict, "satisfied", JSON.stringify(report.result));
  assert.deepEqual(report.providersObserved, ["github"]);
});

test("VIOLATED — a live unresolved review thread at the exact head under test", () => {
  const payload = fullGraphQlPayload({
    reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false }, nodes: [{ id: "T1", isResolved: false }] },
  });
  const evidence = buildReviewEvidenceBundle(payload);
  const policy = buildReviewPolicy({});
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  const report = checkReviewEvidence(evidence, policy, options);
  assert.equal(report.result.verdict, "violated", JSON.stringify(report.result));
  assert.ok(report.result.findings.some((finding) => finding.rule === "unresolved-thread"));
});

test("VIOLATED — a required check under the policy failed at the exact head under test", () => {
  const payload = fullGraphQlPayload({
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
                nodes: [{ __typename: "CheckRun", name: "release readiness (version bump vs. shipped content)", conclusion: "FAILURE", completedAt: "2026-09-14T07:53:00Z" }],
              },
            },
          },
        },
      ],
    },
  });
  const evidence = buildReviewEvidenceBundle(payload);
  // A concrete, real required-context name from this repository's own live
  // ruleset (measured 2026-09-22 via `gh api repos/clossys/foundry/rules/branches/main`),
  // not a fictional string — the "concrete, enumerable policy" #403 asks
  // this proof to use, given directly to buildReviewPolicy the same way a
  // caller passing `--required-checks-from-ruleset` would end up with it.
  const policy = buildReviewPolicy({}, { requiredChecksFromRuleset: ["release readiness (version bump vs. shipped content)"] });
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  const report = checkReviewEvidence(evidence, policy, options);
  assert.equal(report.result.verdict, "violated", JSON.stringify(report.result));
  assert.ok(report.result.findings.some((finding) => finding.rule === "required-check-failed"));
});

test("INDETERMINATE — evidence bound to a DIFFERENT head than the one under test, never folded into violated", () => {
  // The scenario #403's own two-direction proof names: a new commit landed
  // after review evidence was collected (or a stale/replayed run), so the
  // live query's head and the commit this CI run was told to test disagree.
  const payload = fullGraphQlPayload({
    headRefOid: OTHER_HEAD,
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: OTHER_HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const evidence = buildReviewEvidenceBundle(payload);
  const policy = buildReviewPolicy({});
  // --head, as the real workflow would pass it: the commit THIS run is
  // actually testing, independent of whatever the live query answered.
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  const report = checkReviewEvidence(evidence, policy, options);
  assert.equal(report.result.verdict, "indeterminate", JSON.stringify(report.result));
  assert.equal(report.result.reason, "evidence-head-mismatch");
  // The clean approval this bundle actually carries never leaks through as
  // a false pass, and — just as important — never gets misread as a
  // rejection either. It is treated as no evidence about this commit at all.
  assert.notEqual(report.result.verdict, "violated");
  assert.notEqual(report.result.verdict, "satisfied");
});

test("SATISFIED — a stale review inside an otherwise-current bundle (force-push after approval) is excluded, never folded into indeterminate", () => {
  // This is the merge-train incident (#1187, #1297, #1302): a rate-limited
  // bot leaves one review against an earlier push and cannot re-review. The
  // outer headShaUnderTest matches the bundle here (unlike the DIFFERENT-
  // head case above) — this is the INNER mismatch: one review's own headSha
  // disagrees with the bundle's. validateReviewEvidence still reports that
  // as "stale-evidence" (packages/controller/src/review/validate.ts is
  // unchanged), but review-evidence.ts's checkReviewEvidence now carves a
  // stale REVIEW finding out of its evaluability set before deciding a
  // verdict (see that file's own header, "ONE CARVE-OUT: A STALE REVIEW
  // RECORD IS NEITHER") rather than folding the whole check to
  // indeterminate over one record that could never have counted anyway.
  const payload = fullGraphQlPayload({
    reviews: {
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      nodes: [{ id: "R1", state: "APPROVED", submittedAt: "2026-09-14T07:53:00Z", commit: { oid: OTHER_HEAD }, author: { login: "a-reviewer" } }],
    },
  });
  const evidence = buildReviewEvidenceBundle(payload);
  const policy = buildReviewPolicy({});
  const options = buildReviewEvidenceOptions({ headShaUnderTest: HEAD, requireReviewPresence: false });

  const report = checkReviewEvidence(evidence, policy, options);
  assert.equal(report.result.verdict, "satisfied", JSON.stringify(report.result));
  assert.ok(evidence.reviews[0].headSha !== evidence.headSha);
  // Reported, not dropped: the stale record still shows up on its own field.
  assert.equal(report.staleReviews.length, 1);
  assert.equal(report.staleReviews[0].rule, "stale-evidence");
  // And it still never counts as a provider observed AT the current head.
  assert.deepEqual(report.providersObserved, []);
});
