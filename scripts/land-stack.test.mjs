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
  changedFilePathsForClassification,
  parseReviewRecordComments,
  isValidReviewRecord,
  selectCurrentReviewRecords,
  findSuspiciousRecordComments,
  findStickyRejections,
  evaluateTier1Independence,
  isOverbroadPathGlob,
  isAuthorizedCollaboratorPermission,
  encodeApiPath,
  evaluateTier2Decision,
  evaluateChangedDecisionRecords,
  verifyChangedFilesComplete,
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

test("classifyTier against the real governance/review-tiers.json: the enforcement surface is tier-2 (self-inclusion), decisions/ is tier-1 (not tier-0)", () => {
  const config = JSON.parse(readFileSync(join(repoRoot, "governance", "review-tiers.json"), "utf8"));
  const tierGlobs = {
    tier1: config.tier1.globs,
    tier1RecordExempt: config.tier1RecordExempt.globs,
    tier2: config.tier2.globs,
  };
  // Self-inclusion: the classifier config and the code that enforces it are
  // tier-2, not tier-1 (#1187 review at 8e6d97ea, should-fix 13) -- a tier-1
  // change must never be able to narrow tier2.globs itself.
  assert.equal(classifyTier(["governance/review-tiers.json"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["scripts/land-stack.mjs"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["scripts/check-decision-records.mjs"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["docs/contracts/decision-record.json"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["package-scope.json"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["scripts/lib/anything.mjs"], tierGlobs).tier, "tier-2");
  // governance/decisions/** is tier-1, not tier-0 (#1187 review at 8e6d97ea,
  // blocking finding 4) -- adding or changing a decision record needs real
  // independent review, not a free pass.
  assert.equal(classifyTier(["governance/decisions/some-decision.json"], tierGlobs).tier, "tier-1");
  // Ordinary governance record files stay exempt (tier-0).
  assert.equal(classifyTier(["governance/release-catalog.json"], tierGlobs).tier, "tier-0");
  assert.equal(classifyTier(["governance/model-qualifications/allowlist.json"], tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["scripts/check-foo.mjs"], tierGlobs).tier, "tier-1");
  assert.equal(classifyTier(["packages/controller/src/index.ts"], tierGlobs).tier, "tier-0");
});

test("changedFilePathsForClassification includes both the new and previous filename, so a rename out of a tier-1/tier-2 path is still classified (#1187 review at df15ab87, blocking finding 1)", () => {
  const config = JSON.parse(readFileSync(join(repoRoot, "governance", "review-tiers.json"), "utf8"));
  const tierGlobs = { tier1: config.tier1.globs, tier1RecordExempt: config.tier1RecordExempt.globs, tier2: config.tier2.globs };

  // scripts/land-stack.mjs moved to scripts/old/land-stack.mjs: the new path
  // alone is tier-0, but the union with the old path is tier-2.
  const renamedAway = changedFilePathsForClassification([{ filename: "scripts/old/land-stack.mjs", previousFilename: "scripts/land-stack.mjs" }]);
  assert.deepEqual(renamedAway.sort(), ["scripts/land-stack.mjs", "scripts/old/land-stack.mjs"].sort());
  assert.equal(classifyTier(renamedAway, tierGlobs).tier, "tier-2");
  assert.equal(classifyTier(["scripts/old/land-stack.mjs"], tierGlobs).tier, "tier-0", "sanity: the new path ALONE really is tier-0");

  // A workflow file disabled by renaming it out of .github/workflows/.
  const disabledWorkflow = changedFilePathsForClassification([
    { filename: ".github/conversation-safety.yml.off", previousFilename: ".github/workflows/conversation-safety.yml" },
  ]);
  assert.equal(classifyTier(disabledWorkflow, tierGlobs).tier, "tier-1");

  // An ordinary rename with no previousFilename (a plain add) only contributes one path.
  const plainAdd = changedFilePathsForClassification([{ filename: "README.md" }]);
  assert.deepEqual(plainAdd, ["README.md"]);
});

const SAMPLE_TIER_CONFIG = {
  tier2: ["governance/model-qualifications/**", ".github/rulesets/**"],
};

test("isOverbroadPathGlob (#1187 review at df15ab87, blocking finding 4): computed against the real tier config, not a canary list", () => {
  assert.equal(isOverbroadPathGlob("**", SAMPLE_TIER_CONFIG), true);
  assert.equal(isOverbroadPathGlob("*", SAMPLE_TIER_CONFIG), true);
  // Exactly one of tier2.globs, verbatim: accepted.
  assert.equal(isOverbroadPathGlob("governance/model-qualifications/**", SAMPLE_TIER_CONFIG), false);
  assert.equal(isOverbroadPathGlob(".github/rulesets/**", SAMPLE_TIER_CONFIG), false);
  // A literal path (no glob metacharacters) is never overbroad -- it can
  // authorize at most the one file it names.
  assert.equal(isOverbroadPathGlob("governance/model-qualifications/allowlist.json", SAMPLE_TIER_CONFIG), false);
  assert.equal(isOverbroadPathGlob("README.md", SAMPLE_TIER_CONFIG), false);
  // The specific holes the prior canary-based heuristic let through: none
  // of these equal a real tier2.globs entry, so all are rejected now, even
  // though none of them happens to match an old canary path either.
  assert.equal(isOverbroadPathGlob("governance/**", SAMPLE_TIER_CONFIG), true);
  assert.equal(isOverbroadPathGlob(".github/**", SAMPLE_TIER_CONFIG), true);
  assert.equal(isOverbroadPathGlob("scripts/lib/**", SAMPLE_TIER_CONFIG), true);
  assert.equal(isOverbroadPathGlob("*.yml", SAMPLE_TIER_CONFIG), true);
  // A glob that LOOKS narrower than a real tier-2 glob is still rejected --
  // only a literal path or an exact tier2.globs entry is accepted.
  assert.equal(isOverbroadPathGlob("governance/model-qualifications/allowlist-*.json", SAMPLE_TIER_CONFIG), true);
});


function recordComment(record, { createdAt = "2026-09-23T00:00:00Z", updatedAt = createdAt, authorized = true } = {}) {
  return { body: `<!-- foundry-review-record\n${JSON.stringify(record)}\n-->`, created_at: createdAt, updated_at: updatedAt, authorized };
}

const HEAD = "a".repeat(40);

// Direct-construction helpers below build a record as `parseReviewRecordComments`
// would have produced it -- including `_authorized: true` and a parseable
// `_commentCreatedAt` -- so tests that exercise evaluateTier1Independence /
// selectCurrentReviewRecords directly (bypassing the comment-parsing layer)
// still see a record `isValidReviewRecord` accepts by default. Tests that
// specifically probe authorization or comment-editing go through
// `recordComment` + `parseReviewRecordComments` instead (see below).
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
    _commentCreatedAt: "2026-09-23T00:00:00Z",
    _authorized: true,
    ...overrides,
  };
}

// Two-reviewer tests below pass `depth` explicitly for both records: the
// pairing rule requires one "primary" and one "secondary" (#1187 review at
// 8e6d97ea, blocking finding 2), so there is no single sensible default.
function reviewerRecord(
  instanceId,
  {
    model = "claude-opus-4-1",
    provider = "anthropic",
    state = "approved",
    depth = "primary",
    id = instanceId,
    submittedAt = "2026-09-23T01:00:00Z",
    commentCreatedAt = submittedAt,
    authorized = true,
  } = {},
) {
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
    _commentCreatedAt: commentCreatedAt,
    _authorized: authorized,
  };
}

/** A qualifying independent pair: distinct instanceId, primary+secondary, differing model, both approved. */
function qualifyingPair() {
  return [
    reviewerRecord("r1", { model: "claude-sonnet-5", depth: "primary" }),
    reviewerRecord("r2", { model: "claude-opus-4-1", depth: "secondary" }),
  ];
}

function decisionRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "d1",
    tier: "tier-2",
    question: "Should X happen?",
    options: ["yes", "no"],
    recommendation: "yes",
    reviews: [],
    status: "decided",
    decidedBy: "owner",
    decision: "Yes.",
    relaxesGateOrPolicy: false,
    sunset: null,
    expiry: null,
    supersedes: [],
    links: { pullRequests: [], issues: [], paths: [] },
    notes: "",
    ...overrides,
  };
}

test("parseReviewRecordComments extracts well-formed blocks, flags malformed JSON, and reads the authorized flag the caller set", () => {
  const comments = [
    recordComment(authorRecord("author-instance"), { authorized: true }),
    { body: "<!-- foundry-review-record\n{not json}\n-->", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z", authorized: true },
    { body: "just a normal comment, no marker" },
    recordComment(reviewerRecord("untrusted"), { authorized: false }),
  ];
  const records = parseReviewRecordComments(comments);
  assert.equal(records.length, 3);
  assert.equal(records[0].role, "author");
  assert.equal(records[0]._authorized, true);
  assert.equal(records[1]._parseError, true);
  assert.equal(records[2]._authorized, false);
});

test("parseReviewRecordComments treats a comment with no authorized field at all as unauthorized (fail closed)", () => {
  const bareComment = { body: `<!-- foundry-review-record\n${JSON.stringify(authorRecord("x"))}\n-->`, created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" };
  const [record] = parseReviewRecordComments([bareComment]);
  assert.equal(record._authorized, false);
});

test("isAuthorizedCollaboratorPermission accepts only admin/write (#1187 review at df15ab87, blocking finding 2)", () => {
  assert.equal(isAuthorizedCollaboratorPermission("admin"), true);
  assert.equal(isAuthorizedCollaboratorPermission("write"), true);
  assert.equal(isAuthorizedCollaboratorPermission("read"), false);
  assert.equal(isAuthorizedCollaboratorPermission("none"), false);
  assert.equal(isAuthorizedCollaboratorPermission("triage"), false);
  assert.equal(isAuthorizedCollaboratorPermission(undefined), false);
  assert.equal(isAuthorizedCollaboratorPermission(""), false);
});

test("encodeApiPath encodes each path segment but preserves the slash separators", () => {
  assert.equal(encodeApiPath("governance/decisions/d1.json"), "governance/decisions/d1.json");
  assert.equal(encodeApiPath("a b/c#d.json"), "a%20b/c%23d.json");
});

test("isValidReviewRecord requires the full field set per role, plus _authorized and a parseable _commentCreatedAt", () => {
  assert.equal(isValidReviewRecord(authorRecord("x")), true);
  assert.equal(isValidReviewRecord(reviewerRecord("y")), true);
  assert.equal(isValidReviewRecord({ role: "author" }), false);
  const missingModel = reviewerRecord("y");
  delete missingModel.model;
  assert.equal(isValidReviewRecord(missingModel), false);
  assert.equal(isValidReviewRecord({ ...reviewerRecord("y"), depth: "tertiary" }), false);
  assert.equal(isValidReviewRecord({ ...authorRecord("x"), _authorized: false }), false);
  assert.equal(isValidReviewRecord({ ...authorRecord("x"), _commentCreatedAt: "not a date" }), false);
});

test("isValidReviewRecord rejects an unparseable submittedAt (#1187 review at 8e6d97ea, should-fix 10)", () => {
  assert.equal(isValidReviewRecord(authorRecord("x", { submittedAt: "zzzz-not-a-date" })), false);
  assert.equal(isValidReviewRecord(reviewerRecord("y", { submittedAt: "not a date either" })), false);
  assert.equal(isValidReviewRecord(authorRecord("x", { submittedAt: "2026-09-23T00:00:00Z" })), true);
});

test("isValidReviewRecord rejects a record whose comment was edited after posting (#1187 review at 8e6d97ea, should-fix 11)", () => {
  const edited = { ...authorRecord("x"), _edited: true };
  assert.equal(isValidReviewRecord(edited), false);
  const notEdited = { ...authorRecord("x"), _edited: false };
  assert.equal(isValidReviewRecord(notEdited), true);
});

test("parseReviewRecordComments marks a record from an edited comment (created_at !== updated_at)", () => {
  const untouched = recordComment(authorRecord("a"), { createdAt: "2026-09-23T00:00:00Z" });
  const edited = recordComment(reviewerRecord("b"), { createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T05:00:00Z" });
  const [a, b] = parseReviewRecordComments([untouched, edited]);
  assert.equal(a._edited, false);
  assert.equal(b._edited, true);
  // And selectCurrentReviewRecords/evaluateTier1Independence therefore never
  // sees the edited one as valid, current evidence.
  assert.equal(selectCurrentReviewRecords([a, b], HEAD).length, 1);
});

test("findSuspiciousRecordComments: an unparseable block is always suspicious; an edited block only at the current head", () => {
  const parseError = { _parseError: true, _commentCreatedAt: "2026-09-23T00:00:00Z" };
  assert.deepEqual(findSuspiciousRecordComments([parseError], HEAD), [parseError]);
  assert.deepEqual(findSuspiciousRecordComments([parseError], "any-other-head"), [parseError]);

  const editedAtHead = { ...authorRecord("x"), _edited: true, headSha: HEAD };
  assert.deepEqual(findSuspiciousRecordComments([editedAtHead], HEAD), [editedAtHead]);
  const editedAtStaleHead = { ...authorRecord("x"), _edited: true, headSha: "stale" };
  assert.deepEqual(findSuspiciousRecordComments([editedAtStaleHead], HEAD), []);

  const untouched = authorRecord("x");
  assert.deepEqual(findSuspiciousRecordComments([untouched], HEAD), []);
});

test("findStickyRejections: authorized + current-head + reject/changes-requested, regardless of other missing fields", () => {
  const wellFormedReject = reviewerRecord("r1", { state: "reject" });
  assert.deepEqual(findStickyRejections([wellFormedReject], HEAD), [wellFormedReject]);

  // Malformed (missing depth/model) but authorized and at head: still sticky.
  const malformedReject = { role: "reviewer", instanceId: "r2", state: "changes-requested", headSha: HEAD, _authorized: true };
  assert.deepEqual(findStickyRejections([malformedReject], HEAD), [malformedReject]);

  // Unauthorized: excluded, even though everything else matches.
  const unauthorizedReject = reviewerRecord("r3", { state: "reject", authorized: false });
  assert.deepEqual(findStickyRejections([unauthorizedReject], HEAD), []);

  // Stale head: excluded.
  const staleReject = { ...reviewerRecord("r4", { state: "reject" }), headSha: "stale" };
  assert.deepEqual(findStickyRejections([staleReject], HEAD), []);

  // Approved: not a rejection at all.
  const approved = reviewerRecord("r5", { state: "approved" });
  assert.deepEqual(findStickyRejections([approved], HEAD), []);
});

test("selectCurrentReviewRecords drops stale (different head) records, keeps latest per (role, instanceId) by the COMMENT'S created_at, not the self-declared submittedAt", () => {
  const staleHead = "b".repeat(40);
  const records = [
    authorRecord("author-1"),
    reviewerRecord("r1", { commentCreatedAt: "2026-09-23T01:00:00Z", state: "commented" }),
    reviewerRecord("r1", { commentCreatedAt: "2026-09-23T02:00:00Z", state: "approved" }), // supersedes the one above
    { ...reviewerRecord("r2"), headSha: staleHead }, // stale: different head, dropped
  ];
  const current = selectCurrentReviewRecords(records, HEAD);
  assert.equal(current.length, 2);
  const r1 = current.find((r) => r.instanceId === "r1");
  assert.equal(r1.state, "approved");
  assert.equal(current.some((r) => r.instanceId === "r2"), false);
});

test("selectCurrentReviewRecords orders by _commentCreatedAt even when submittedAt disagrees (a self-declared submittedAt cannot win or lose a supersession race on its own)", () => {
  const earlierCommentLaterSubmittedAt = reviewerRecord("r1", {
    state: "commented",
    submittedAt: "2026-09-23T09:00:00Z", // self-declared as "later"
    commentCreatedAt: "2026-09-23T01:00:00Z", // but the comment itself is EARLIER
  });
  const laterCommentEarlierSubmittedAt = reviewerRecord("r1", {
    state: "approved",
    submittedAt: "2026-09-23T00:00:00Z", // self-declared as "earlier"
    commentCreatedAt: "2026-09-23T02:00:00Z", // but the comment itself is LATER
  });
  const current = selectCurrentReviewRecords([earlierCommentLaterSubmittedAt, laterCommentEarlierSubmittedAt], HEAD);
  assert.equal(current.length, 1);
  assert.equal(current[0].state, "approved"); // the record whose COMMENT is later wins, not the one whose submittedAt claims to be later
});

test("MUST REFUSE: the author reviewing their own PR is refused", () => {
  const records = [
    authorRecord("shared-instance"),
    reviewerRecord("shared-instance", { model: "claude-opus-4-1", depth: "primary" }),
    reviewerRecord("r2", { model: "claude-sonnet-5", depth: "secondary" }),
  ];
  // Only ONE independent reviewer remains once the author's own instance is
  // excluded -- not enough for the pair the rule requires.
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /found 1 independent approved record/);
});

test("MUST REFUSE: exactly one author record is required -- a second author-role record is never silently the first one found (#1187 review at 8e6d97ea, should-fix 9)", () => {
  const records = [
    authorRecord("author-1"),
    authorRecord("author-2"), // a reviewer trying to dodge the independence check by also declaring role:"author"
    ...qualifyingPair(),
  ];
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /tier-1 independence requires exactly one/);
});

test("MUST REFUSE: the same model (and provider) twice is refused", () => {
  const records = [
    authorRecord("author-1"),
    reviewerRecord("r1", { model: "claude-sonnet-5", provider: "anthropic", depth: "primary" }),
    reviewerRecord("r2", { model: "claude-sonnet-5", provider: "anthropic", depth: "secondary" }),
  ];
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /found 2 independent approved record/);
});

test("MUST REFUSE: two records at the same depth (two primary, or two secondary) never pair, even with different models (#1187 review at 8e6d97ea, blocking finding 2)", () => {
  const twoPrimary = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", depth: "primary" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", depth: "primary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(twoPrimary.ok, false);

  const twoSecondary = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", depth: "secondary" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", depth: "secondary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(twoSecondary.ok, false);
});

test('MUST REFUSE: "commented" never counts as approval, even paired correctly by depth and differing model (#1187 review at 8e6d97ea, blocking finding 2)', () => {
  const result = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", depth: "primary", state: "commented" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", depth: "secondary", state: "commented" }),
    ],
    headSha: HEAD,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /"commented" records never count/);
});

test("MUST REFUSE: an unauthorized reviewer's approval never counts toward the pair, even with everything else correct (#1187 review at df15ab87, blocking finding 2)", () => {
  const records = [
    authorRecord("author-1"),
    reviewerRecord("r1", { model: "claude-sonnet-5", depth: "primary" }),
    reviewerRecord("r2", { model: "claude-opus-4-1", depth: "secondary", authorized: false }),
  ];
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /found 1 independent approved record/);
});

test("MUST REFUSE end-to-end: two foundry-review-record comments from an unauthorized (non-collaborator) account never satisfy tier-1, even with a perfectly-formed pair", () => {
  const comments = [
    recordComment(authorRecord("author-1"), { authorized: true }),
    recordComment(reviewerRecord("r1", { model: "claude-sonnet-5", depth: "primary" }), { authorized: false }),
    recordComment(reviewerRecord("r2", { model: "claude-opus-4-1", depth: "secondary" }), { authorized: false }),
  ];
  const records = parseReviewRecordComments(comments);
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
});

test("MUST ALLOW: different model, or different provider, is accepted (with primary/secondary depth pairing and both approved)", () => {
  const byModel = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", provider: "anthropic", depth: "primary" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", provider: "anthropic", depth: "secondary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(byModel.ok, true);

  const byProvider = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "shared-model", provider: "anthropic", depth: "primary" }),
      reviewerRecord("r2", { model: "shared-model", provider: "fable", depth: "secondary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(byProvider.ok, true);
});

test("MUST REFUSE: a reject (or changes-requested) verdict is refused, and is NEVER outvoted by a third, approving reviewer reaching a clean pair (#1187 review at 8e6d97ea, blocking finding 1)", () => {
  const rejected = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", state: "approved", depth: "primary" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", state: "reject", depth: "secondary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /sticky/);

  const changesRequested = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("r1", { model: "claude-sonnet-5", state: "approved", depth: "primary" }),
      reviewerRecord("r2", { model: "claude-opus-4-1", state: "changes-requested", depth: "secondary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(changesRequested.ok, false);

  // The specific attack the review probed: author, B approved, C approved,
  // D (independent) rejects. A clean pair (B, C) exists, but D's reject must
  // still refuse the whole thing -- it is never outvoted.
  const outvoteAttempt = evaluateTier1Independence({
    records: [
      authorRecord("author-1"),
      reviewerRecord("b", { model: "claude-sonnet-5", state: "approved", depth: "primary" }),
      reviewerRecord("c", { model: "claude-opus-4-1", state: "approved", depth: "secondary" }),
      reviewerRecord("d", { model: "fable", state: "reject", depth: "secondary" }),
    ],
    headSha: HEAD,
  });
  assert.equal(outvoteAttempt.ok, false);
  assert.match(outvoteAttempt.reason, /sticky/);
});

test("MUST REFUSE: a reject in an EDITED comment still blocks (#1187 review at df15ab87, blocking finding 3, probe 11b)", () => {
  const comments = [
    recordComment(authorRecord("author-1"), { authorized: true }),
    recordComment(reviewerRecord("b", { model: "claude-sonnet-5", state: "approved", depth: "primary" }), { authorized: true }),
    recordComment(reviewerRecord("c", { model: "claude-opus-4-1", state: "approved", depth: "secondary" }), { authorized: true }),
    // D's reject, posted in a comment that was later edited (even just to
    // fix whitespace) -- the prior draft dropped this entirely via _edited,
    // leaving B+C looking like a clean, satisfying pair.
    recordComment(reviewerRecord("d", { model: "fable", state: "reject", depth: "secondary" }), {
      authorized: true,
      createdAt: "2026-09-23T01:00:00Z",
      updatedAt: "2026-09-23T01:05:00Z",
    }),
  ];
  const records = parseReviewRecordComments(comments);
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  // Refused at the "suspicious" stage (any edited-at-head block refuses the
  // whole gate), not merely at the sticky-rejection stage -- either is a
  // correct refusal, but the suspicious check runs first.
  assert.match(result.reason, /edited-at-head or unparseable/);
});

test("MUST REFUSE: a reject cannot be superseded by a LATER, same-instanceId 'approved' record (#1187 review at df15ab87, blocking finding 3, probe 10b)", () => {
  const initialReject = reviewerRecord("d", { model: "fable", state: "reject", depth: "secondary", commentCreatedAt: "2026-09-23T01:00:00Z" });
  const laterWithdrawal = reviewerRecord("d", {
    model: "fable",
    state: "approved",
    depth: "secondary",
    commentCreatedAt: "2026-09-23T09:00:00Z", // genuinely later, not edited -- a fresh comment
  });
  const records = [
    authorRecord("author-1"),
    reviewerRecord("b", { model: "claude-sonnet-5", state: "approved", depth: "primary" }),
    initialReject,
    laterWithdrawal,
  ];
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sticky/);
});

test("MUST REFUSE: a MALFORMED reject (missing depth/model) still blocks", () => {
  const comments = [
    recordComment(authorRecord("author-1"), { authorized: true }),
    recordComment(reviewerRecord("b", { model: "claude-sonnet-5", state: "approved", depth: "primary" }), { authorized: true }),
    recordComment(reviewerRecord("c", { model: "claude-opus-4-1", state: "approved", depth: "secondary" }), { authorized: true }),
    {
      body: `<!-- foundry-review-record\n${JSON.stringify({ schemaVersion: 1, role: "reviewer", instanceId: "d", state: "reject", headSha: HEAD })}\n-->`,
      created_at: "2026-09-23T01:00:00Z",
      updated_at: "2026-09-23T01:00:00Z",
      authorized: true,
    },
  ];
  const records = parseReviewRecordComments(comments);
  const result = evaluateTier1Independence({ records, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sticky/);
});

test("MUST REFUSE: no current-head author record at all is refused", () => {
  const result = evaluateTier1Independence({
    records: qualifyingPair(),
    headSha: HEAD,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no current-head role:"author"/);
});

test("MUST REFUSE: tier-2 without an owner decision record is refused", () => {
  const noDecisions = evaluateTier2Decision({ decisionRecords: [], prNumber: 42, tier2Paths: ["governance/model-qualifications/allowlist.json"], tierConfig: SAMPLE_TIER_CONFIG });
  assert.equal(noDecisions.ok, false);
  assert.match(noDecisions.reason, /requires an owner decision record/);

  const wrongDecider = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ decidedBy: "consensus", links: { pullRequests: ["42"] } })],
    prNumber: 42,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(wrongDecider.ok, false);

  const expired = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ expiry: "2000-01-01T00:00:00Z", links: { pullRequests: ["42"] } })],
    prNumber: 42,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(expired.ok, false);

  // A decision record linked to this exact PR authorizes it.
  const linkedByPr = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ id: "d1", links: { pullRequests: ["42"] } })],
    prNumber: 42,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(linkedByPr.ok, true);

  // A decision record whose path globs cover every tier-2 path also authorizes it.
  const linkedByPath = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ id: "d2", links: { paths: ["governance/model-qualifications/**"] } })],
    prNumber: 999,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(linkedByPath.ok, true);
});

test("MUST REFUSE: evaluateTier2Decision rejects an unparseable expiry, an expired record, a superseded record, and a tier-1 record used as tier-2 authority (#1187 review at 8e6d97ea, blocking finding 5)", () => {
  const unparseableExpiry = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ id: "d1", expiry: "not-a-date", links: { pullRequests: ["1"] } })],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(unparseableExpiry.ok, false);

  const superseded = decisionRecord({ id: "old", links: { pullRequests: ["1"] } });
  const superseder = decisionRecord({ id: "new", supersedes: ["old"], links: { pullRequests: ["999"] } });
  const supersededResult = evaluateTier2Decision({
    decisionRecords: [superseded, superseder],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(supersededResult.ok, false, "a superseded record must grant no authority, even if it would otherwise match");

  const tier1Record = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ id: "d1", tier: "tier-1", links: { pullRequests: ["1"] } })],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(tier1Record.ok, false, "a tier-1 record is never tier-2 authority");

  // A relaxation past its own sunset, with nothing superseding it, grants no authority.
  const pastSunset = evaluateTier2Decision({
    decisionRecords: [
      decisionRecord({ id: "d1", relaxesGateOrPolicy: true, sunset: "2000-01-01T00:00:00Z", expiry: "2099-01-01T00:00:00Z", links: { pullRequests: ["1"] } }),
    ],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
    now: new Date("2026-09-23T00:00:00Z"),
  });
  assert.equal(pastSunset.ok, false);

  // A malformed record (missing required fields) grants no authority even if status/decidedBy/links look right.
  const malformed = evaluateTier2Decision({
    decisionRecords: [{ id: "d1", status: "decided", decidedBy: "owner", tier: "tier-2", expiry: null, links: { pullRequests: ["1"] } }],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(malformed.ok, false, "a schema-invalid record (missing question/options/recommendation/relaxesGateOrPolicy/...) must never authorize a tier-2 change");
});

test("evaluateTier2Decision validates a record's id against _idFromFilename when present, not against itself (#1187 review at df15ab87, should-fix nit)", () => {
  const mismatched = evaluateTier2Decision({
    decisionRecords: [{ ...decisionRecord({ id: "d1" }), _idFromFilename: "some-other-filename", links: { pullRequests: ["1"] } }],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(mismatched.ok, false, "id (d1) not matching its real filename (some-other-filename) must be caught, not vacuously self-approved");

  const matched = evaluateTier2Decision({
    decisionRecords: [{ ...decisionRecord({ id: "d1" }), _idFromFilename: "d1", links: { pullRequests: ["1"] } }],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(matched.ok, true);
});

test("MUST REFUSE: an overbroad links.paths glob never authorizes a tier-2 change (#1187 review at 8e6d97ea, blocking finding 4)", () => {
  const result = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ id: "d1", links: { paths: ["**"] } })],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(result.ok, false);
});

test("MUST REFUSE: a links.paths glob broader than any declared tier-2 area never authorizes a tier-2 change (#1187 review at df15ab87, blocking finding 4)", () => {
  const result = evaluateTier2Decision({
    decisionRecords: [decisionRecord({ id: "d1", links: { paths: ["governance/**"] } })],
    prNumber: 1,
    tier2Paths: ["governance/model-qualifications/allowlist.json"],
    tierConfig: SAMPLE_TIER_CONFIG,
  });
  assert.equal(result.ok, false, "governance/** is not exactly a tier2.globs entry and is not a literal path, so it must never authorize anything");
});

test("evaluateChangedDecisionRecords refuses a malformed changed decision record, any tier", () => {
  const valid = evaluateChangedDecisionRecords([{ path: "governance/decisions/d1.json", record: decisionRecord({ id: "d1" }) }]);
  assert.equal(valid.ok, true);

  const invalid = evaluateChangedDecisionRecords([
    { path: "governance/decisions/d1.json", record: { id: "d1", status: "decided" } }, // missing everything else
  ]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /governance\/decisions\/d1\.json/);
});

test("evaluateChangedDecisionRecords refuses a decision record deleted, or renamed OUT of governance/decisions/ (#1187 review at df15ab87, blocking finding 1)", () => {
  const deleted = evaluateChangedDecisionRecords([{ path: "governance/decisions/revoked.json", record: { __deletedOrUnreadable: true } }]);
  assert.equal(deleted.ok, false);
  assert.match(deleted.reason, /no longer exists/);

  // A rename out: the caller feeds BOTH the old path (now unreadable at
  // head -- __deletedOrUnreadable) and the new path (readable, but at a
  // location evaluateChangedDecisionRecords was never even asked about,
  // since it's no longer under governance/decisions/). The old-path entry
  // alone must refuse.
  const renamedAway = evaluateChangedDecisionRecords([
    { path: "governance/decisions/revoked.json", record: { __deletedOrUnreadable: true } },
  ]);
  assert.equal(renamedAway.ok, false);
});

test("verifyChangedFilesComplete fails closed on an empty list, a non-number changedFiles, or a changedFiles mismatch (#1187 review at 8e6d97ea blocking finding 3; df15ab87 should-fix 8)", () => {
  assert.equal(verifyChangedFilesComplete([], 0).ok, false, "an empty list must never be read as tier-0 -- it must refuse to classify at all");
  assert.equal(verifyChangedFilesComplete(["a.txt"], 100).ok, false, "a paginated list shorter than changedFiles must refuse (truncated fetch)");
  assert.equal(verifyChangedFilesComplete(["a.txt", "b.txt"], 2).ok, true);
  // A non-number changedFiles -- including undefined, the shape a broken
  // fetch would actually produce -- now REFUSES rather than skipping the
  // cross-check (#1187 review at df15ab87, should-fix 8).
  assert.equal(verifyChangedFilesComplete(["a.txt"], undefined).ok, false);
  assert.equal(verifyChangedFilesComplete(["a.txt"], null).ok, false);
  assert.equal(verifyChangedFilesComplete(["a.txt"], "1").ok, false);
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
      records: [authorRecord("author-1"), ...qualifyingPair()],
      headSha: HEAD,
      decisionRecords: [],
      prNumber: 1,
    },
  );
  assert.equal(tier1Pass.ok, true);

  const tier2NoDecision = evaluateTierGate(
    { tier: "tier-2", tier1Paths: [], tier2Paths: ["governance/model-qualifications/allowlist.json"] },
    {
      records: [authorRecord("author-1"), ...qualifyingPair()],
      headSha: HEAD,
      decisionRecords: [],
      prNumber: 1,
      tierConfig: SAMPLE_TIER_CONFIG,
    },
  );
  assert.equal(tier2NoDecision.ok, false);
  assert.equal(tier2NoDecision.tier, "tier-2");

  const tier2Pass = evaluateTierGate(
    { tier: "tier-2", tier1Paths: [], tier2Paths: ["governance/model-qualifications/allowlist.json"] },
    {
      records: [authorRecord("author-1"), ...qualifyingPair()],
      headSha: HEAD,
      decisionRecords: [decisionRecord({ id: "d1", links: { pullRequests: ["1"] } })],
      prNumber: 1,
      tierConfig: SAMPLE_TIER_CONFIG,
    },
  );
  assert.equal(tier2Pass.ok, true);

  // evaluateChangedDecisionRecords runs regardless of tier, and regardless
  // of whether everything else about the PR would otherwise pass.
  const malformedDecisionRecordBlocksEvenTier0 = evaluateTierGate(
    { tier: "tier-0", tier1Paths: [], tier2Paths: [] },
    { changedDecisionRecords: [{ path: "governance/decisions/bad.json", record: { id: "bad" } }] },
  );
  assert.equal(malformedDecisionRecordBlocksEvenTier0.ok, false);
});
