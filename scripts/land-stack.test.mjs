import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  permittedMergeMethod,
  shouldReady,
  isCheckBlocking,
  extractRequiredContexts,
  classifyRequiredContexts,
  canMerge,
  restackCommitMessage,
  globToRegExp,
  classifyTier,
  parseReviewRecordComments,
  isValidReviewRecord,
  selectCurrentReviewRecords,
  evaluateTier1Independence,
  evaluateTier2Decision,
  evaluateTierGate,
} from "./land-stack.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

// The 15 required contexts named by the `main-required-checks` ruleset, as
// of the #1135 fix (gh api repos/clossys/foundry/rules/branches/main). Used
// only as fixture data for these tests -- production code never hard-codes
// this list; it derives it at runtime via extractRequiredContexts.
const REQUIRED_CONTEXTS = [
  "publish safety",
  "scope drift",
  "build and test",
  "artifact safety (tarball)",
  "prose quality (README parity, contamination classes)",
  "release readiness (version bump vs. shipped content)",
  "workspace link integrity",
  "registry drift",
  "controller gates (catalog, neutrality, repository-profile)",
  "WCAG contrast gate (designer-contrast-check)",
  "qualification record required (version bump vs. retained record)",
  "package state (declared vs. evidence)",
  "secret-scan (inspector judgment)",
  "prepublish hook drift",
  "verify-standards",
];

function greenCheck(name) {
  return { name, status: "COMPLETED", conclusion: "SUCCESS" };
}

function allRequiredGreen(extra = []) {
  return [...REQUIRED_CONTEXTS.map(greenCheck), ...extra];
}

test("permittedMergeMethod is merge only", () => {
  assert.equal(permittedMergeMethod(), "merge");
});

test("shouldReady is true only for the tip PR", () => {
  assert.equal(shouldReady(5, 5), true);
  assert.equal(shouldReady(4, 5), false);
  assert.equal(shouldReady(5, null), false);
});

test("isCheckBlocking treats incomplete or failed conclusions as blocking", () => {
  assert.equal(isCheckBlocking({ status: "IN_PROGRESS", conclusion: null }), true);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "FAILURE" }), true);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "CANCELLED" }), true);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "SUCCESS" }), false);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "SKIPPED" }), false);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "NEUTRAL" }), false);
});

test("extractRequiredContexts derives the context list from rule evaluation output, not a literal", () => {
  // Shape of `gh api repos/{owner}/{repo}/rules/branches/{branch}`.
  const branchRules = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [
          { context: "publish safety" },
          { context: "verify-standards", integration_id: 15368 },
        ],
      },
    },
    { type: "deletion" },
    { type: "non_fast_forward" },
  ];
  assert.deepEqual(extractRequiredContexts(branchRules), ["publish safety", "verify-standards"]);
  assert.deepEqual(extractRequiredContexts([]), []);
  assert.deepEqual(extractRequiredContexts(null), []);
});

test("classifyRequiredContexts distinguishes green, red, pending, and missing", () => {
  const checks = [
    { name: "publish safety", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "build and test", status: "COMPLETED", conclusion: "FAILURE" },
    { name: "push-tree identity", status: "IN_PROGRESS", conclusion: null },
  ];
  const result = classifyRequiredContexts(
    ["publish safety", "build and test", "secret-scan (inspector judgment)"],
    checks,
  );
  assert.deepEqual(result.green, ["publish safety"]);
  assert.deepEqual(result.red, [{ name: "build and test", conclusion: "FAILURE" }]);
  // "secret-scan (inspector judgment)" has no run recorded, but
  // "push-tree identity" is still IN_PROGRESS on the same pull request, so
  // it must read as pending, not as a permanent blocker (#1135's critical
  // correctness detail: secret-scan needs push-tree + safety and has no
  // check run at all until they finish).
  assert.deepEqual(result.pending, ["secret-scan (inspector judgment)"]);
  assert.deepEqual(result.missing, []);
});

test("classifyRequiredContexts reports a required context as missing once nothing else is in flight", () => {
  const checks = [{ name: "publish safety", status: "COMPLETED", conclusion: "SUCCESS" }];
  const result = classifyRequiredContexts(["publish safety", "secret-scan (inspector judgment)"], checks);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.missing, ["secret-scan (inspector judgment)"]);
});

test("canMerge fails closed on draft, unknown mergeability, and behind", () => {
  const green = {
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    requiredContexts: ["safety"],
    checks: [{ name: "safety", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  assert.deepEqual(canMerge(green), { ok: true, reason: "ready to merge with --merge" });

  assert.equal(canMerge({ ...green, isDraft: true }).ok, false);
  assert.equal(canMerge({ ...green, mergeable: "UNKNOWN" }).ok, false);
  assert.equal(canMerge({ ...green, mergeable: "CONFLICTING" }).ok, false);
  assert.equal(canMerge({ ...green, mergeStateStatus: "BEHIND" }).ok, false);
});

test("canMerge refuses to evaluate blind when no required contexts are supplied", () => {
  const result = canMerge({
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    requiredContexts: [],
    checks: [{ name: "anything", status: "COMPLETED", conclusion: "SUCCESS" }],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no required contexts supplied/);
});

// --- Two-direction proof (#1135) -------------------------------------------

test("MUST REFUSE: a red required context blocks the merge", () => {
  const checks = allRequiredGreen().map((check) =>
    check.name === "build and test" ? { ...check, conclusion: "FAILURE" } : check,
  );
  const result = canMerge({
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    requiredContexts: REQUIRED_CONTEXTS,
    checks,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /build and test \(FAILURE\)/);
});

test("MUST REFUSE: an unrun required context whose upstream has completed blocks the merge", () => {
  // Every required context except secret-scan is green, and nothing else on
  // the pull request is still running -- so the absent secret-scan run is
  // not "still coming", it is a real, permanent gap.
  const checks = REQUIRED_CONTEXTS.filter((name) => name !== "secret-scan (inspector judgment)").map(greenCheck);
  checks.push({ name: "push-tree", status: "COMPLETED", conclusion: "SUCCESS" });
  checks.push({ name: "safety", status: "COMPLETED", conclusion: "SUCCESS" });

  const result = canMerge({
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    requiredContexts: REQUIRED_CONTEXTS,
    checks,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /secret-scan \(inspector judgment\) \(no run recorded\)/);
});

test("MUST REFUSE (not a permanent blocker either): an unrun required context whose upstream is still going reads as pending, and still cannot merge", () => {
  const checks = REQUIRED_CONTEXTS.filter((name) => name !== "secret-scan (inspector judgment)").map(greenCheck);
  checks.push({ name: "push-tree", status: "IN_PROGRESS", conclusion: null });

  const result = canMerge({
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    requiredContexts: REQUIRED_CONTEXTS,
    checks,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /pending required checks: secret-scan \(inspector judgment\)/);
  // Critically, this must NOT be worded as a permanent "blocking" gap --
  // that is the exact bug this fix removes.
  assert.doesNotMatch(result.reason, /no run recorded/);
});

test("MUST ALLOW: all required contexts green while a non-required check is FAILURE or CANCELLED", () => {
  // This is the case that was broken before #1135: `CodeQL` and
  // `portfolio-merge-signal`-style informational checks are not in the
  // ruleset's 15 required contexts, so a red or cancelled run of either
  // must not wedge the merge train.
  const checks = allRequiredGreen([
    { name: "CodeQL", status: "COMPLETED", conclusion: "FAILURE" },
    { name: "portfolio-merge-signal", status: "COMPLETED", conclusion: "CANCELLED" },
  ]);
  const result = canMerge({
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    requiredContexts: REQUIRED_CONTEXTS,
    checks,
  });
  assert.equal(result.ok, true);
  assert.match(result.reason, /^ready to merge with --merge/);
  assert.match(result.reason, /non-required checks red, not blocking: CodeQL, portfolio-merge-signal/);
});

test("restackCommitMessage names branch and PR", () => {
  assert.equal(
    restackCommitMessage({ branch: "feat/stack", afterPr: 42 }),
    "Restack feat/stack onto origin/main after PR #42",
  );
});

// ---------------------------------------------------------------------------
// Tier gate (HITL escalation, first slice -- issue #1187)
// ---------------------------------------------------------------------------

test("globToRegExp: ** crosses path separators, * stays within one segment", () => {
  assert.equal(globToRegExp("governance/**").test("governance/decisions/x.json"), true);
  assert.equal(globToRegExp("governance/**").test("governance/x.json"), true);
  assert.equal(globToRegExp("governance/**").test("other/x.json"), false);
  assert.equal(globToRegExp("scripts/check-*.mjs").test("scripts/check-decision-records.mjs"), true);
  // A single "*" stays within one path segment -- it does not stop a nested
  // path from matching (scripts/check-*.mjs matches anything under
  // scripts/check-... ending in .mjs, dotted filename or not), but it does
  // refuse to cross a "/" at all.
  assert.equal(globToRegExp("scripts/check-*.mjs").test("scripts/lib/check-foo.mjs"), false);
  assert.equal(globToRegExp("AGENTS.md").test("AGENTS.md"), true);
  assert.equal(globToRegExp("AGENTS.md").test("packages/foo/AGENTS.md"), false);
});

test("classifyTier: union over paths, max over tiers, exemption carve-out applies only to tier1", () => {
  const globs = {
    tier1: ["governance/**", "scripts/check-*.mjs"],
    tier1RecordExempt: ["governance/decisions/**"],
    tier2: ["governance/model-qualifications/**"],
  };

  assert.equal(classifyTier(["README.md"], globs).tier, "tier-0");
  assert.equal(classifyTier(["scripts/check-foo.mjs"], globs).tier, "tier-1");
  // A pure record file carved out of tier1 stays tier-0 on its own.
  assert.equal(classifyTier(["governance/decisions/x.json"], globs).tier, "tier-0");
  // One tier-1 path and one unrelated path: still tier-1 (union).
  assert.equal(classifyTier(["README.md", "scripts/check-foo.mjs"], globs).tier, "tier-1");
  // A tier-2 path anywhere in the set wins over a tier-1 path elsewhere (max).
  const mixed = classifyTier(["scripts/check-foo.mjs", "governance/model-qualifications/allowlist.json"], globs);
  assert.equal(mixed.tier, "tier-2");
  assert.deepEqual(mixed.tier2Paths, ["governance/model-qualifications/allowlist.json"]);
});

test("classifyTier against the real governance/review-tiers.json is self-referential (tier-1) and exempts decisions/", () => {
  const config = JSON.parse(readFileSync(join(repoRoot, "governance", "review-tiers.json"), "utf8"));
  const tierGlobs = {
    tier1: config.tier1.globs,
    tier1RecordExempt: config.tier1RecordExempt.globs,
    tier2: config.tier2.globs,
  };
  assert.equal(classifyTier(["governance/review-tiers.json"], tierGlobs).tier, "tier-1");
  assert.equal(classifyTier(["scripts/land-stack.mjs"], tierGlobs).tier, "tier-1");
  assert.equal(classifyTier(["governance/decisions/some-decision.json"], tierGlobs).tier, "tier-0");
  assert.equal(classifyTier(["governance/model-qualifications/allowlist.json"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["packages/controller/src/index.ts"], tierGlobs).tier, "tier-0");
});

function recordComment(record, createdAt = "2026-09-23T00:00:00Z") {
  return { body: `<!-- foundry-review-record\n${JSON.stringify(record)}\n-->`, createdAt };
}

const HEAD = "a".repeat(40);

function authorRecord(instanceId, overrides = {}) {
  return {
    schemaVersion: 1,
    role: "author",
    id: "author-1",
    reviewerId: "repository-owner-account",
    instanceId,
    provider: "anthropic",
    submittedAt: "2026-09-23T00:00:00Z",
    state: "declared",
    headSha: HEAD,
    ...overrides,
  };
}

function reviewerRecord(instanceId, { model = "claude-opus-4-1", provider = "anthropic", state = "approved", depth = "secondary", id = instanceId, submittedAt = "2026-09-23T01:00:00Z" } = {}) {
  return {
    schemaVersion: 1,
    role: "reviewer",
    id,
    reviewerId: "repository-owner-account",
    instanceId,
    provider,
    model,
    submittedAt,
    state,
    depth,
    headSha: HEAD,
  };
}

test("parseReviewRecordComments extracts well-formed blocks and flags malformed JSON", () => {
  const comments = [
    recordComment(authorRecord("author-instance")),
    { body: "<!-- foundry-review-record\n{not json}\n-->" },
    { body: "just a normal comment, no marker" },
  ];
  const records = parseReviewRecordComments(comments);
  assert.equal(records.length, 2);
  assert.equal(records[0].role, "author");
  assert.equal(records[1]._parseError, true);
});

test("isValidReviewRecord requires the full field set per role", () => {
  assert.equal(isValidReviewRecord(authorRecord("x")), true);
  assert.equal(isValidReviewRecord(reviewerRecord("y")), true);
  assert.equal(isValidReviewRecord({ role: "author" }), false);
  const missingModel = reviewerRecord("y");
  delete missingModel.model;
  assert.equal(isValidReviewRecord(missingModel), false);
  assert.equal(isValidReviewRecord({ ...reviewerRecord("y"), depth: "tertiary" }), false);
});

test("selectCurrentReviewRecords drops stale (different head) records and keeps latest per (role, instanceId)", () => {
  const staleHead = "b".repeat(40);
  const records = [
    authorRecord("author-1"),
    reviewerRecord("r1", { submittedAt: "2026-09-23T01:00:00Z", state: "commented" }),
    reviewerRecord("r1", { submittedAt: "2026-09-23T02:00:00Z", state: "approved" }), // supersedes the one above
    { ...reviewerRecord("r2"), headSha: staleHead }, // stale: different head, dropped
  ];
  const current = selectCurrentReviewRecords(records, HEAD);
  assert.equal(current.length, 2);
  const r1 = current.find((r) => r.instanceId === "r1");
  assert.equal(r1.state, "approved");
  assert.equal(current.some((r) => r.instanceId === "r2"), false);
});

test("MUST REFUSE: the author reviewing their own PR is refused", () => {
  const records = [
    authorRecord("shared-instance"),
    reviewerRecord("shared-instance", { model: "claude-opus-4-1" }),
    reviewerRecord("r2", { model: "claude-sonnet-5" }),
  ];
  // Only ONE independent reviewer remains once the author's own instance is
  // excluded -- not enough for the pair the rule requires.
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /at least 2 independent reviewer records/);
});

test("MUST REFUSE: the same model (and provider) twice is refused", () => {
  const records = [
    authorRecord("author-1"),
    reviewerRecord("r1", { model: "claude-sonnet-5", provider: "anthropic" }),
    reviewerRecord("r2", { model: "claude-sonnet-5", provider: "anthropic" }),
  ];
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /at least 2 independent reviewer records/);
});

test("MUST ALLOW: different model, or different provider, is accepted", () => {
  const byModel = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", provider: "anthropic" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", provider: "anthropic" }),
    ],
    headSha: HEAD,
  });
  assert.equal(byModel.ok, true);

  const byProvider = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "shared-model", provider: "anthropic" }),
      reviewerRecord("r2", { model: "shared-model", provider: "fable" }),
    ],
    headSha: HEAD,
  });
  assert.equal(byProvider.ok, true);
});

test("MUST REFUSE: a reject (or changes-requested) verdict is refused", () => {
  const rejected = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", state: "approved" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", state: "reject" }),
    ],
    headSha: HEAD,
  });
  assert.equal(rejected.ok, false);

  const changesRequested = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", state: "approved" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", state: "changes-requested" }),
    ],
    headSha: HEAD,
  });
  assert.equal(changesRequested.ok, false);
});

test("MUST REFUSE: no current-head author record at all is refused", () => {
  const result = evaluateTier1Independence({
    records: [
      reviewerRecord("r1", { model: "claude-sonnet-5" }),
      reviewerRecord("r2", { model: "claude-opus-4-1" }),
    ],
    headSha: HEAD,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no current-head role:"author"/);
});

test("MUST REFUSE: tier-2 without an owner decision record is refused", () => {
  const independentEvidence = {
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5" }),
      reviewerRecord("r2", { model: "claude-opus-4-1" }),
    ],
    headSha: HEAD,
  };
  const noDecisions = evaluateTier2Decision({ decisionRecords: [], prNumber: 42, tier2Paths: ["governance/model-qualifications/allowlist.json"] });
  assert.equal(noDecisions.ok, false);
  assert.match(noDecisions.reason, /requires an owner decision record/);

  const wrongDecider = evaluateTier2Decision({
    decisionRecords: [{ status: "decided", decidedBy: "consensus", expiry: null, links: { pullRequests: ["42"] } }],
    prNumber: 42,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
  });
  assert.equal(wrongDecider.ok, false);

  const expired = evaluateTier2Decision({
    decisionRecords: [{ status: "decided", decidedBy: "owner", expiry: "2000-01-01T00:00:00Z", links: { pullRequests: ["42"] } }],
    prNumber: 42,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
  });
  assert.equal(expired.ok, false);

  // A decision record linked to this exact PR authorizes it.
  const linkedByPr = evaluateTier2Decision({
    decisionRecords: [{ id: "d1", status: "decided", decidedBy: "owner", expiry: null, links: { pullRequests: ["42"] } }],
    prNumber: 42,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
  });
  assert.equal(linkedByPr.ok, true);

  // A decision record whose path globs cover every tier-2 path also authorizes it.
  const linkedByPath = evaluateTier2Decision({
    decisionRecords: [{ id: "d2", status: "decided", decidedBy: "owner", expiry: null, links: { paths: ["governance/model-qualifications/**"] } }],
    prNumber: 999,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
  });
  assert.equal(linkedByPath.ok, true);

  assert.deepEqual(independentEvidence.records.length, 3); // sanity: fixture used above
});

test("evaluateTierGate: tier-0 passes without any review evidence; tier-1 and tier-2 route through the checks above", () => {
  const tier0 = evaluateTierGate({ tier: "tier-0", tier1Paths: [], tier2Paths: [] }, {});
  assert.equal(tier0.ok, true);

  const tier1Fail = evaluateTierGate(
    { tier: "tier-1", tier1Paths: ["scripts/check-foo.mjs"], tier2Paths: [] },
    { records: [], headSha: HEAD, decisionRecords: [], prNumber: 1 },
  );
  assert.equal(tier1Fail.ok, false);
  assert.equal(tier1Fail.tier, "tier-1");

  const tier1Pass = evaluateTierGate(
    { tier: "tier-1", tier1Paths: ["scripts/check-foo.mjs"], tier2Paths: [] },
    {
      records: [
        authorRecord("author-1"),
        reviewerRecord("r1", { model: "claude-sonnet-5" }),
        reviewerRecord("r2", { model: "claude-opus-4-1" }),
      ],
      headSha: HEAD,
      decisionRecords: [],
      prNumber: 1,
    },
  );
  assert.equal(tier1Pass.ok, true);

  const tier2NoDecision = evaluateTierGate(
    { tier: "tier-2", tier1Paths: [], tier2Paths: ["governance/model-qualifications/allowlist.json"] },
    {
      records: [
        authorRecord("author-1"),
        reviewerRecord("r1", { model: "claude-sonnet-5" }),
        reviewerRecord("r2", { model: "claude-opus-4-1" }),
      ],
      headSha: HEAD,
      decisionRecords: [],
      prNumber: 1,
    },
  );
  assert.equal(tier2NoDecision.ok, false);
  assert.equal(tier2NoDecision.tier, "tier-2");

  const tier2Pass = evaluateTierGate(
    { tier: "tier-2", tier1Paths: [], tier2Paths: ["governance/model-qualifications/allowlist.json"] },
    {
      records: [
        authorRecord("author-1"),
        reviewerRecord("r1", { model: "claude-sonnet-5" }),
        reviewerRecord("r2", { model: "claude-opus-4-1" }),
      ],
      headSha: HEAD,
      decisionRecords: [{ id: "d1", status: "decided", decidedBy: "owner", expiry: null, links: { pullRequests: ["1"] } }],
      prNumber: 1,
    },
  );
  assert.equal(tier2Pass.ok, true);
});
