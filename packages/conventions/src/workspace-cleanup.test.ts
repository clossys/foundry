import { describe, expect, it } from "vitest";
import * as publicApi from "./index.js";
import {
  WORKSPACE_CLEANUP_REASON_CODES,
  classifyWorkspaceCleanup,
  classifyWorkspaceCleanupSet,
} from "./workspace-cleanup.js";
import type {
  BranchCleanupObservation,
  WorkspaceCleanupObservation,
  WorktreeCleanupObservation,
  WorktreeMetadataCleanupObservation,
} from "./workspace-cleanup.js";

const common = {
  repositoryId: "repo-one",
  declaredOrigin: "provider.example/org/repo-one",
  observedOrigin: "provider.example/org/repo-one",
  canonicalCheckout: "clean",
  targetOwnership: "unowned",
  evidenceComplete: true,
} as const;

const mergedBranch = {
  tracking: "gone",
  pullRequest: "merged",
  pullRequestTip: "matches-current-tip",
} as const;

const worktree: WorktreeCleanupObservation = {
  ...common,
  action: "remove-worktree",
  targetId: "review-fix",
  worktree: "clean",
  branch: mergedBranch,
};

const branch: BranchCleanupObservation = {
  ...common,
  action: "remove-branch",
  targetId: "review-fix",
  checkedOutWorktree: "none",
  branch: mergedBranch,
};

const metadata: WorktreeMetadataCleanupObservation = {
  ...common,
  action: "prune-worktree-metadata",
  targetId: "stale-record",
  pruneDryRun: "candidate",
};

function reasons(observation: WorkspaceCleanupObservation) {
  return classifyWorkspaceCleanup(observation).reasonCodes;
}

describe("classifyWorkspaceCleanup", () => {
  it("returns typed safe candidates without authorizing deletion", () => {
    expect(classifyWorkspaceCleanup(worktree)).toEqual({
      repositoryId: "repo-one",
      targetId: "review-fix",
      action: "remove-worktree",
      status: "safe-candidate",
      reasonCodes: ["merged-pull-request"],
      requiresOperatorConfirmation: true,
    });
    expect(classifyWorkspaceCleanup(branch).status).toBe("safe-candidate");
    expect(classifyWorkspaceCleanup(metadata)).toMatchObject({
      status: "safe-candidate",
      reasonCodes: ["prune-dry-run-candidate"],
      requiresOperatorConfirmation: true,
    });
  });

  it("applies boundary and completeness blockers before owned state", () => {
    expect(
      classifyWorkspaceCleanup({
        ...worktree,
        observedOrigin: "provider.example/other/repo-one",
        targetOwnership: "owned",
        worktree: "dirty",
      }),
    ).toMatchObject({ status: "blocked", reasonCodes: ["origin-mismatch"] });

    expect(
      classifyWorkspaceCleanup({
        ...worktree,
        evidenceComplete: false,
        targetOwnership: "owned",
      }),
    ).toMatchObject({ status: "blocked", reasonCodes: ["observation-incomplete"] });
  });

  it("orders multiple blockers deterministically within a precedence tier", () => {
    expect(
      classifyWorkspaceCleanup({
        ...worktree,
        observedOrigin: null,
        canonicalCheckout: "missing",
        evidenceComplete: false,
        targetOwnership: "unknown",
      }).reasonCodes,
    ).toEqual([
      "origin-unobserved",
      "canonical-checkout-missing",
      "observation-incomplete",
      "ownership-unknown",
    ]);

    expect(
      classifyWorkspaceCleanup({
        ...branch,
        branch: { tracking: "ahead", pullRequest: "none", pullRequestTip: "not-applicable" },
      }).reasonCodes,
    ).toEqual(["branch-unpushed", "pull-request-missing"]);
  });

  it("classifies active or dirty state as owned before branch disposition", () => {
    expect(
      classifyWorkspaceCleanup({
        ...worktree,
        targetOwnership: "owned",
        branch: { tracking: "ahead", pullRequest: "none", pullRequestTip: "not-applicable" },
      }),
    ).toMatchObject({ status: "owned", reasonCodes: ["active-owner"] });

    expect(
      classifyWorkspaceCleanup({
        ...worktree,
        canonicalCheckout: "dirty",
        worktree: "dirty",
      }),
    ).toMatchObject({
      status: "owned",
      reasonCodes: ["canonical-dirty", "worktree-dirty"],
    });
  });

  it.each([
    [{ ...worktree, observedOrigin: null }, "origin-unobserved"],
    [{ ...worktree, canonicalCheckout: "missing" }, "canonical-checkout-missing"],
    [{ ...worktree, canonicalCheckout: "unknown" }, "canonical-state-unknown"],
    [{ ...worktree, evidenceComplete: false }, "observation-incomplete"],
    [{ ...worktree, targetOwnership: "unknown" }, "ownership-unknown"],
    [{ ...worktree, worktree: "missing" }, "worktree-missing"],
    [{ ...worktree, worktree: "unknown" }, "worktree-state-unknown"],
    [{ ...branch, checkedOutWorktree: "clean" }, "branch-checked-out"],
    [{ ...branch, checkedOutWorktree: "unknown" }, "branch-worktree-state-unknown"],
    [
      {
        ...branch,
        branch: { tracking: "ahead", pullRequest: "merged", pullRequestTip: "matches-current-tip" },
      },
      "branch-unpushed",
    ],
    [
      {
        ...branch,
        branch: {
          tracking: "diverged",
          pullRequest: "merged",
          pullRequestTip: "matches-current-tip",
        },
      },
      "branch-unpushed",
    ],
    [
      {
        ...branch,
        branch: {
          tracking: "untracked",
          pullRequest: "merged",
          pullRequestTip: "matches-current-tip",
        },
      },
      "branch-unpushed",
    ],
    [
      {
        ...branch,
        branch: {
          tracking: "unknown",
          pullRequest: "merged",
          pullRequestTip: "matches-current-tip",
        },
      },
      "branch-tracking-unknown",
    ],
    [
      {
        ...branch,
        branch: { tracking: "gone", pullRequest: "open", pullRequestTip: "not-applicable" },
      },
      "pull-request-open",
    ],
    [
      {
        ...branch,
        branch: {
          tracking: "gone",
          pullRequest: "closed-unmerged",
          pullRequestTip: "not-applicable",
        },
      },
      "pull-request-closed-unmerged",
    ],
    [
      {
        ...branch,
        branch: { tracking: "gone", pullRequest: "none", pullRequestTip: "not-applicable" },
      },
      "pull-request-missing",
    ],
    [
      {
        ...branch,
        branch: { tracking: "gone", pullRequest: "unknown", pullRequestTip: "unknown" },
      },
      "pull-request-state-unknown",
    ],
    [
      {
        ...branch,
        branch: { tracking: "up-to-date", pullRequest: "merged", pullRequestTip: "different-tip" },
      },
      "pull-request-tip-unverified",
    ],
    [{ ...metadata, pruneDryRun: "not-run" }, "prune-dry-run-not-run"],
    [{ ...metadata, pruneDryRun: "failed" }, "prune-dry-run-failed"],
    [{ ...metadata, pruneDryRun: "not-candidate" }, "prune-not-candidate"],
  ] as const)("blocks with %s", (observation, reason) => {
    expect(classifyWorkspaceCleanup(observation).status).toBe("blocked");
    expect(reasons(observation)).toContain(reason);
  });

  it("keeps every reason code covered by the fixture matrix", () => {
    const covered = new Set<string>([
      "origin-mismatch",
      "observation-invalid",
      "active-owner",
      "canonical-dirty",
      "worktree-dirty",
      "merged-pull-request",
      "prune-dry-run-candidate",
    ]);

    const fixtureReasons: WorkspaceCleanupObservation[] = [
      { ...worktree, observedOrigin: null },
      { ...worktree, canonicalCheckout: "missing" },
      { ...worktree, canonicalCheckout: "unknown" },
      { ...worktree, evidenceComplete: false },
      { ...worktree, targetOwnership: "unknown" },
      { ...worktree, worktree: "missing" },
      { ...worktree, worktree: "unknown" },
      { ...branch, checkedOutWorktree: "clean" },
      { ...branch, checkedOutWorktree: "unknown" },
      {
        ...branch,
        branch: { tracking: "ahead", pullRequest: "merged", pullRequestTip: "matches-current-tip" },
      },
      {
        ...branch,
        branch: {
          tracking: "unknown",
          pullRequest: "merged",
          pullRequestTip: "matches-current-tip",
        },
      },
      {
        ...branch,
        branch: { tracking: "gone", pullRequest: "open", pullRequestTip: "not-applicable" },
      },
      {
        ...branch,
        branch: {
          tracking: "gone",
          pullRequest: "closed-unmerged",
          pullRequestTip: "not-applicable",
        },
      },
      {
        ...branch,
        branch: { tracking: "gone", pullRequest: "none", pullRequestTip: "not-applicable" },
      },
      {
        ...branch,
        branch: { tracking: "gone", pullRequest: "unknown", pullRequestTip: "unknown" },
      },
      {
        ...branch,
        branch: { tracking: "up-to-date", pullRequest: "merged", pullRequestTip: "different-tip" },
      },
      { ...metadata, pruneDryRun: "not-run" },
      { ...metadata, pruneDryRun: "failed" },
      { ...metadata, pruneDryRun: "not-candidate" },
    ];
    for (const fixture of fixtureReasons) {
      for (const reason of reasons(fixture)) covered.add(reason);
    }

    expect([...covered].sort()).toEqual([...WORKSPACE_CLEANUP_REASON_CODES].sort());
  });

  it("classifies equivalent evidence identically across caller-owned registries", () => {
    const first = classifyWorkspaceCleanup(worktree);
    const second = classifyWorkspaceCleanup({
      ...worktree,
      repositoryId: "repo-two",
      declaredOrigin: "provider.example/different/repo-two",
      observedOrigin: "provider.example/different/repo-two",
      targetId: "another-task",
    });

    expect({ status: second.status, reasonCodes: second.reasonCodes }).toEqual({
      status: first.status,
      reasonCodes: first.reasonCodes,
    });
  });

  it("blocks unrecognized runtime evidence instead of falling through safe", () => {
    expect(
      classifyWorkspaceCleanup({
        ...worktree,
        canonicalCheckout: "error",
        worktree: "error",
        branch: {
          tracking: "error",
          pullRequest: "merged",
          pullRequestTip: "matches-current-tip",
        },
      }),
    ).toEqual({
      repositoryId: "repo-one",
      targetId: "review-fix",
      action: "remove-worktree",
      status: "blocked",
      reasonCodes: ["observation-invalid"],
      requiresOperatorConfirmation: true,
    });

    expect(classifyWorkspaceCleanup({ action: "erase-everything" })).toMatchObject({
      repositoryId: null,
      targetId: null,
      action: null,
      status: "blocked",
      reasonCodes: ["observation-invalid"],
    });
  });

  it("requires a merged pull request to contain the branch's current tip", () => {
    expect(
      classifyWorkspaceCleanup({
        ...branch,
        branch: {
          tracking: "up-to-date",
          pullRequest: "merged",
          pullRequestTip: "different-tip",
        },
      }),
    ).toMatchObject({
      status: "blocked",
      reasonCodes: ["pull-request-tip-unverified"],
    });
  });

  it("preserves input order for a caller-owned observation set", () => {
    const proposals = classifyWorkspaceCleanupSet([metadata, worktree, branch]);
    expect(proposals.map((item) => item.action)).toEqual([
      "prune-worktree-metadata",
      "remove-worktree",
      "remove-branch",
    ]);
    expect(Object.isFrozen(proposals)).toBe(true);
    expect(classifyWorkspaceCleanupSet("not-an-observation-set")).toEqual([
      {
        repositoryId: null,
        targetId: null,
        action: null,
        status: "blocked",
        reasonCodes: ["observation-invalid"],
        requiresOperatorConfirmation: true,
      },
    ]);

    const sparse: WorkspaceCleanupObservation[] = new Array(3);
    sparse[0] = metadata;
    sparse[2] = branch;
    const sparseProposals = classifyWorkspaceCleanupSet(sparse);
    expect(sparseProposals).toHaveLength(3);
    expect(sparseProposals[1]).toEqual({
      repositoryId: null,
      targetId: null,
      action: null,
      status: "blocked",
      reasonCodes: ["observation-invalid"],
      requiresOperatorConfirmation: true,
    });
  });

  it("exports classification only, with no cleanup executor", () => {
    const workspaceCleanupExports = Object.keys(publicApi)
      .filter(
        (name) =>
          name === "WORKSPACE_CLEANUP_REASON_CODES" ||
          name.toLowerCase().includes("workspacecleanup"),
      )
      .sort();

    expect(workspaceCleanupExports).toEqual([
      "WORKSPACE_CLEANUP_REASON_CODES",
      "classifyWorkspaceCleanup",
      "classifyWorkspaceCleanupSet",
    ]);
  });
});
