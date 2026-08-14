import { describe, expect, it } from "vitest";
import { classifyCleanupCandidate } from "./classify.js";
import type { CleanupCandidate, CleanupPullRequestState, CleanupReasonCode } from "./types.js";

/**
 * A fully clean, complete-evidence baseline: a non-canonical, non-default
 * worktree with a clean working tree, matching origin, a fully-pushed
 * branch, a dry run that agrees no force is needed, a merged PR, and no
 * active-task ownership. Every fixture below starts from this and flips
 * exactly the field(s) needed to exercise one reason code, so a failing
 * assertion always isolates the one thing that changed.
 */
function baseline(): CleanupCandidate {
  return {
    repositoryId: "repo-1",
    origin: { known: true, observed: "https://example.invalid/origin.git", expected: "https://example.invalid/origin.git" },
    location: { kind: "worktree", workingTreeKnown: true, workingTreeClean: true },
    branch: { name: "feature/widgets", isDefaultBranch: false, trackingKnown: true, hasUpstream: true, aheadCount: 0, behindCount: 0 },
    prune: { known: true, safeWithoutForce: true },
    pullRequest: { known: true, state: "merged" },
    ownership: { known: true, ownedByActiveTask: false },
  };
}

describe("classifyCleanupCandidate — safe-candidate", () => {
  it("returns safe-candidate with zero reasons when every check passes on complete evidence", () => {
    const result = classifyCleanupCandidate(baseline());
    expect(result).toEqual({
      schemaVersion: 1,
      repositoryId: "repo-1",
      branch: "feature/widgets",
      status: "safe-candidate",
      reasons: [],
    });
  });
});

describe("classifyCleanupCandidate — owned tier", () => {
  it("classifies a canonical location as owned, regardless of anything else being dirty/missing", () => {
    const candidate = baseline();
    const dirty: CleanupCandidate = {
      ...candidate,
      location: { kind: "canonical", workingTreeKnown: true, workingTreeClean: false },
      origin: { known: false, expected: candidate.origin.expected },
    };
    const result = classifyCleanupCandidate(dirty);
    expect(result.status).toBe("owned");
    expect(result.reasons).toEqual([{ code: "canonical-repository", message: expect.any(String) }]);
  });

  it("classifies a default-branch worktree as owned, regardless of anything else being dirty/missing", () => {
    const candidate = baseline();
    const dirty: CleanupCandidate = {
      ...candidate,
      branch: { ...candidate.branch, isDefaultBranch: true },
      prune: { known: false },
    };
    const result = classifyCleanupCandidate(dirty);
    expect(result.status).toBe("owned");
    expect(result.reasons).toEqual([{ code: "default-branch", message: expect.any(String) }]);
  });

  it("reports both owned reasons, in fixed order, when both apply at once", () => {
    const candidate = baseline();
    const both: CleanupCandidate = {
      ...candidate,
      location: { kind: "canonical", workingTreeKnown: true, workingTreeClean: true },
      branch: { ...candidate.branch, isDefaultBranch: true },
    };
    const result = classifyCleanupCandidate(both);
    expect(result.status).toBe("owned");
    expect(result.reasons.map((r) => r.code)).toEqual(["canonical-repository", "default-branch"]);
  });

  it("owned never carries a blocked-status reason, even though other evidence was also broken", () => {
    const candidate = baseline();
    const canonicalButBroken: CleanupCandidate = {
      ...candidate,
      location: { kind: "canonical", workingTreeKnown: false },
      origin: { known: false, expected: candidate.origin.expected },
      pullRequest: { known: false },
    };
    const result = classifyCleanupCandidate(canonicalButBroken);
    expect(result.status).toBe("owned");
    expect(result.reasons.map((r) => r.code)).toEqual(["canonical-repository"]);
  });
});

describe("classifyCleanupCandidate — blocked tier: every reason code, in isolation", () => {
  type Case = { name: string; code: CleanupReasonCode; mutate: (c: CleanupCandidate) => CleanupCandidate };

  const cases: Case[] = [
    {
      name: "origin was never observed",
      code: "origin-evidence-missing",
      mutate: (c) => ({ ...c, origin: { known: false, expected: c.origin.expected } }),
    },
    {
      name: "origin claims known but observed is missing (incomplete evidence)",
      code: "origin-evidence-missing",
      mutate: (c) => ({ ...c, origin: { known: true, expected: c.origin.expected } }),
    },
    {
      name: "observed origin differs from expected",
      code: "origin-mismatch",
      mutate: (c) => ({ ...c, origin: { ...c.origin, observed: "https://example.invalid/other.git" } }),
    },
    {
      name: "working tree clean/dirty state was never observed",
      code: "working-tree-evidence-missing",
      mutate: (c) => ({ ...c, location: { kind: "worktree", workingTreeKnown: false } }),
    },
    {
      name: "working tree claims known but the verdict is missing (incomplete evidence)",
      code: "working-tree-evidence-missing",
      mutate: (c) => ({ ...c, location: { kind: "worktree", workingTreeKnown: true } }),
    },
    {
      name: "working tree is dirty",
      code: "dirty-working-tree",
      mutate: (c) => ({ ...c, location: { ...c.location, workingTreeClean: false } }),
    },
    {
      name: "tracking state was never observed",
      code: "tracking-evidence-missing",
      mutate: (c) => ({ ...c, branch: { ...c.branch, trackingKnown: false, hasUpstream: undefined, aheadCount: undefined } }),
    },
    {
      name: "tracking claims known but upstream presence is missing (incomplete evidence)",
      code: "tracking-evidence-missing",
      mutate: (c) => ({ ...c, branch: { ...c.branch, hasUpstream: undefined } }),
    },
    {
      name: "tracking claims an upstream exists but ahead count is missing (incomplete evidence)",
      code: "tracking-evidence-missing",
      mutate: (c) => ({ ...c, branch: { ...c.branch, aheadCount: undefined } }),
    },
    {
      name: "branch has no upstream at all",
      code: "unpushed-commits",
      mutate: (c) => ({ ...c, branch: { ...c.branch, hasUpstream: false, aheadCount: undefined } }),
    },
    {
      name: "branch is ahead of its upstream",
      code: "unpushed-commits",
      mutate: (c) => ({ ...c, branch: { ...c.branch, aheadCount: 3 } }),
    },
    {
      name: "no prune dry-run evidence was observed",
      code: "prune-evidence-missing",
      mutate: (c) => ({ ...c, prune: { known: false } }),
    },
    {
      name: "prune claims known but the verdict is missing (incomplete evidence)",
      code: "prune-evidence-missing",
      mutate: (c) => ({ ...c, prune: { known: true } }),
    },
    {
      name: "dry run reports a force flag would be required",
      code: "prune-requires-force",
      mutate: (c) => ({ ...c, prune: { known: true, safeWithoutForce: false } }),
    },
    {
      name: "no pull-request search evidence was observed",
      code: "pull-request-evidence-missing",
      mutate: (c) => ({ ...c, pullRequest: { known: false } }),
    },
    {
      name: "pull-request search claims known but state is missing (incomplete evidence)",
      code: "pull-request-evidence-missing",
      mutate: (c) => ({ ...c, pullRequest: { known: true } }),
    },
    {
      name: "pull-request state is an unrecognized value (defensive, outside the declared union)",
      code: "pull-request-evidence-missing",
      mutate: (c) => ({ ...c, pullRequest: { known: true, state: "merged-and-reverted" as unknown as CleanupPullRequestState } }),
    },
    {
      name: "pull-request search completed and found nothing",
      code: "pull-request-not-found",
      mutate: (c) => ({ ...c, pullRequest: { known: true, state: "none-found" } }),
    },
    {
      name: "pull request is still open",
      code: "pull-request-open",
      mutate: (c) => ({ ...c, pullRequest: { known: true, state: "open" } }),
    },
    {
      name: "pull request was closed without merging",
      code: "pull-request-closed-unmerged",
      mutate: (c) => ({ ...c, pullRequest: { known: true, state: "closed-unmerged" } }),
    },
    {
      name: "no active-task ownership evidence was observed",
      code: "ownership-evidence-missing",
      mutate: (c) => ({ ...c, ownership: { known: false } }),
    },
    {
      name: "ownership claims known but the verdict is missing (incomplete evidence)",
      code: "ownership-evidence-missing",
      mutate: (c) => ({ ...c, ownership: { known: true } }),
    },
    {
      name: "candidate is claimed by an active task",
      code: "active-task-ownership",
      mutate: (c) => ({ ...c, ownership: { known: true, ownedByActiveTask: true } }),
    },
  ];

  for (const { name, code, mutate } of cases) {
    it(`${name} -> blocked, reason "${code}"`, () => {
      const result = classifyCleanupCandidate(mutate(baseline()));
      expect(result.status).toBe("blocked");
      expect(result.reasons.map((r) => r.code)).toEqual([code]);
      expect(result.reasons[0]?.message.length).toBeGreaterThan(0);
    });
  }
});

describe("classifyCleanupCandidate — blocked tier: precedence when several conditions hold at once", () => {
  it("collects every applicable reason, in the fixed check order, not just the first one found", () => {
    const candidate = baseline();
    const brokenEverywhere: CleanupCandidate = {
      ...candidate,
      origin: { ...candidate.origin, observed: "https://example.invalid/other.git" },
      location: { ...candidate.location, workingTreeClean: false },
      branch: { ...candidate.branch, aheadCount: 2 },
      prune: { known: true, safeWithoutForce: false },
      pullRequest: { known: true, state: "closed-unmerged" },
      ownership: { known: true, ownedByActiveTask: true },
    };
    const result = classifyCleanupCandidate(brokenEverywhere);
    expect(result.status).toBe("blocked");
    expect(result.reasons.map((r) => r.code)).toEqual([
      "origin-mismatch",
      "dirty-working-tree",
      "unpushed-commits",
      "prune-requires-force",
      "pull-request-closed-unmerged",
      "active-task-ownership",
    ]);
  });

  it("order is stable regardless of which fields were mutated last (not incidental to object construction)", () => {
    const candidate = baseline();
    // Same broken set as above, but assembled via a different intermediate
    // shape/order to prove the RESULT order comes from the fixed check
    // order inside classifyCleanupCandidate, not from property insertion
    // order on the input object.
    const reordered: CleanupCandidate = {
      ownership: { known: true, ownedByActiveTask: true },
      pullRequest: { known: true, state: "closed-unmerged" },
      prune: { known: true, safeWithoutForce: false },
      branch: { ...candidate.branch, aheadCount: 2 },
      location: { ...candidate.location, workingTreeClean: false },
      origin: { ...candidate.origin, observed: "https://example.invalid/other.git" },
      repositoryId: candidate.repositoryId,
    };
    const result = classifyCleanupCandidate(reordered);
    expect(result.reasons.map((r) => r.code)).toEqual([
      "origin-mismatch",
      "dirty-working-tree",
      "unpushed-commits",
      "prune-requires-force",
      "pull-request-closed-unmerged",
      "active-task-ownership",
    ]);
  });

  it("a single missing-evidence field never masks other, independently-detectable problems", () => {
    const candidate = baseline();
    const missingOriginPlusDirty: CleanupCandidate = {
      ...candidate,
      origin: { known: false, expected: candidate.origin.expected },
      location: { ...candidate.location, workingTreeClean: false },
    };
    const result = classifyCleanupCandidate(missingOriginPlusDirty);
    expect(result.reasons.map((r) => r.code)).toEqual(["origin-evidence-missing", "dirty-working-tree"]);
  });
});

describe("classifyCleanupCandidate — purity and totality", () => {
  it("never mutates its input", () => {
    const candidate = baseline();
    const snapshot = JSON.parse(JSON.stringify(candidate));
    classifyCleanupCandidate(candidate);
    expect(candidate).toEqual(snapshot);
  });

  it("is deterministic — the same input always produces the same output", () => {
    const candidate = baseline();
    const first = classifyCleanupCandidate(candidate);
    const second = classifyCleanupCandidate(candidate);
    expect(first).toEqual(second);
  });

  it("echoes repositoryId and branch name back onto the proposal unchanged", () => {
    const candidate = baseline();
    const result = classifyCleanupCandidate(candidate);
    expect(result.repositoryId).toBe(candidate.repositoryId);
    expect(result.branch).toBe(candidate.branch.name);
  });
});
