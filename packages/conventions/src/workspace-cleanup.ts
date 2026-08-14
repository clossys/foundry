/**
 * Pure workspace-cleanup classification.
 *
 * Account-owned adapters discover repositories, inspect Git and provider
 * state, and normalize that evidence before calling this module. Nothing here
 * reads a filesystem, contacts a provider, renders a command, or authorizes a
 * mutation.
 */

export const WORKSPACE_CLEANUP_REASON_CODES = Object.freeze([
  "origin-unobserved",
  "origin-mismatch",
  "canonical-checkout-missing",
  "canonical-state-unknown",
  "observation-incomplete",
  "ownership-unknown",
  "active-owner",
  "canonical-dirty",
  "worktree-dirty",
  "worktree-missing",
  "worktree-state-unknown",
  "branch-checked-out",
  "branch-worktree-state-unknown",
  "branch-unpushed",
  "branch-tracking-unknown",
  "pull-request-open",
  "pull-request-closed-unmerged",
  "pull-request-missing",
  "pull-request-state-unknown",
  "prune-dry-run-not-run",
  "prune-dry-run-failed",
  "prune-not-candidate",
  "merged-pull-request",
  "prune-dry-run-candidate",
] as const);

export type WorkspaceCleanupReasonCode = (typeof WORKSPACE_CLEANUP_REASON_CODES)[number];
export type WorkspaceCleanupStatus = "owned" | "safe-candidate" | "blocked";
export type WorkspaceCleanupAction =
  | "remove-worktree"
  | "remove-branch"
  | "prune-worktree-metadata";

export type CanonicalCheckoutState = "clean" | "dirty" | "missing" | "unknown";
export type TargetOwnershipState = "owned" | "unowned" | "unknown";
export type WorktreeState = "clean" | "dirty" | "missing" | "unknown";
export type BranchWorktreeState = "none" | "clean" | "dirty" | "unknown";
export type BranchTrackingState =
  | "up-to-date"
  | "behind"
  | "ahead"
  | "diverged"
  | "gone"
  | "untracked"
  | "unknown";
export type PullRequestState = "merged" | "open" | "closed-unmerged" | "none" | "unknown";
export type PruneDryRunState = "candidate" | "not-candidate" | "not-run" | "failed";

/** Caller-normalized evidence shared by every cleanup target. */
export interface WorkspaceCleanupCommonObservation {
  /** Opaque identity from the caller's own repository registry. */
  readonly repositoryId: string;
  /** Origin declared by that registry. Compared exactly after caller normalization. */
  readonly declaredOrigin: string;
  /** Observed origin, or null when the caller could not observe one. */
  readonly observedOrigin: string | null;
  readonly canonicalCheckout: CanonicalCheckoutState;
  /** Ownership of this target, not a claim about the whole repository. */
  readonly targetOwnership: TargetOwnershipState;
  /** False when any caller-required observation did not complete. */
  readonly evidenceComplete: boolean;
}

export interface BranchDispositionObservation {
  readonly tracking: BranchTrackingState;
  readonly pullRequest: PullRequestState;
}

export interface WorktreeCleanupObservation extends WorkspaceCleanupCommonObservation {
  readonly action: "remove-worktree";
  /** Opaque target identity. This is deliberately not a filesystem path. */
  readonly targetId: string;
  readonly worktree: WorktreeState;
  readonly branch: BranchDispositionObservation;
}

export interface BranchCleanupObservation extends WorkspaceCleanupCommonObservation {
  readonly action: "remove-branch";
  /** Opaque target identity. This is deliberately not a branch deletion command. */
  readonly targetId: string;
  readonly checkedOutWorktree: BranchWorktreeState;
  readonly branch: BranchDispositionObservation;
}

export interface WorktreeMetadataCleanupObservation extends WorkspaceCleanupCommonObservation {
  readonly action: "prune-worktree-metadata";
  /** Opaque identity from the caller's prune dry-run result. */
  readonly targetId: string;
  readonly pruneDryRun: PruneDryRunState;
}

export type WorkspaceCleanupObservation =
  | WorktreeCleanupObservation
  | BranchCleanupObservation
  | WorktreeMetadataCleanupObservation;

/**
 * A reviewable proposal, never authorization. Even a safe candidate remains
 * subject to the account skill's exact-target confirmation and guarded apply
 * path.
 */
export interface WorkspaceCleanupProposal {
  readonly repositoryId: string;
  readonly targetId: string;
  readonly action: WorkspaceCleanupAction;
  readonly status: WorkspaceCleanupStatus;
  readonly reasonCodes: readonly WorkspaceCleanupReasonCode[];
  readonly requiresOperatorConfirmation: true;
}

function commonBlockingReasons(
  observation: WorkspaceCleanupObservation,
): WorkspaceCleanupReasonCode[] {
  const reasons: WorkspaceCleanupReasonCode[] = [];

  if (observation.observedOrigin === null) {
    reasons.push("origin-unobserved");
  } else if (observation.observedOrigin !== observation.declaredOrigin) {
    reasons.push("origin-mismatch");
  }

  if (observation.canonicalCheckout === "missing") {
    reasons.push("canonical-checkout-missing");
  } else if (observation.canonicalCheckout === "unknown") {
    reasons.push("canonical-state-unknown");
  }

  if (!observation.evidenceComplete) reasons.push("observation-incomplete");
  if (observation.targetOwnership === "unknown") reasons.push("ownership-unknown");

  return reasons;
}

function ownedReasons(observation: WorkspaceCleanupObservation): WorkspaceCleanupReasonCode[] {
  const reasons: WorkspaceCleanupReasonCode[] = [];

  if (observation.targetOwnership === "owned") reasons.push("active-owner");
  if (observation.canonicalCheckout === "dirty") reasons.push("canonical-dirty");

  if (observation.action === "remove-worktree" && observation.worktree === "dirty") {
    reasons.push("worktree-dirty");
  }
  if (observation.action === "remove-branch" && observation.checkedOutWorktree === "dirty") {
    reasons.push("worktree-dirty");
  }

  return reasons;
}

function branchBlockingReasons(
  observation: BranchDispositionObservation,
): WorkspaceCleanupReasonCode[] {
  const reasons: WorkspaceCleanupReasonCode[] = [];

  if (["ahead", "diverged", "untracked"].includes(observation.tracking)) {
    reasons.push("branch-unpushed");
  } else if (observation.tracking === "unknown") {
    reasons.push("branch-tracking-unknown");
  }

  if (observation.pullRequest === "open") {
    reasons.push("pull-request-open");
  } else if (observation.pullRequest === "closed-unmerged") {
    reasons.push("pull-request-closed-unmerged");
  } else if (observation.pullRequest === "none") {
    reasons.push("pull-request-missing");
  } else if (observation.pullRequest === "unknown") {
    reasons.push("pull-request-state-unknown");
  }

  return reasons;
}

function actionBlockingReasons(
  observation: WorkspaceCleanupObservation,
): WorkspaceCleanupReasonCode[] {
  if (observation.action === "prune-worktree-metadata") {
    if (observation.pruneDryRun === "not-run") return ["prune-dry-run-not-run"];
    if (observation.pruneDryRun === "failed") return ["prune-dry-run-failed"];
    if (observation.pruneDryRun === "not-candidate") return ["prune-not-candidate"];
    return [];
  }

  const reasons: WorkspaceCleanupReasonCode[] = [];

  if (observation.action === "remove-worktree") {
    if (observation.worktree === "missing") reasons.push("worktree-missing");
    if (observation.worktree === "unknown") reasons.push("worktree-state-unknown");
  } else {
    if (observation.checkedOutWorktree === "clean") reasons.push("branch-checked-out");
    if (observation.checkedOutWorktree === "unknown") {
      reasons.push("branch-worktree-state-unknown");
    }
  }

  reasons.push(...branchBlockingReasons(observation.branch));
  return reasons;
}

function proposal(
  observation: WorkspaceCleanupObservation,
  status: WorkspaceCleanupStatus,
  reasonCodes: readonly WorkspaceCleanupReasonCode[],
): WorkspaceCleanupProposal {
  return Object.freeze({
    repositoryId: observation.repositoryId,
    targetId: observation.targetId,
    action: observation.action,
    status,
    reasonCodes: Object.freeze([...reasonCodes]),
    requiresOperatorConfirmation: true as const,
  });
}

/**
 * Classify one caller-normalized cleanup observation.
 *
 * Precedence is strict and fail-closed:
 * 1. repository-boundary or incomplete evidence is blocked;
 * 2. known active or dirty state is owned;
 * 3. action-specific uncertainty or unmerged work is blocked;
 * 4. only merged work or confirmed stale metadata is a safe candidate.
 */
export function classifyWorkspaceCleanup(
  observation: WorkspaceCleanupObservation,
): WorkspaceCleanupProposal {
  const commonBlockers = commonBlockingReasons(observation);
  if (commonBlockers.length > 0) return proposal(observation, "blocked", commonBlockers);

  const ownership = ownedReasons(observation);
  if (ownership.length > 0) return proposal(observation, "owned", ownership);

  const actionBlockers = actionBlockingReasons(observation);
  if (actionBlockers.length > 0) return proposal(observation, "blocked", actionBlockers);

  const safeReason: WorkspaceCleanupReasonCode =
    observation.action === "prune-worktree-metadata"
      ? "prune-dry-run-candidate"
      : "merged-pull-request";
  return proposal(observation, "safe-candidate", [safeReason]);
}

/** Classify a complete caller-owned observation set without reading anything. */
export function classifyWorkspaceCleanupSet(
  observations: readonly WorkspaceCleanupObservation[],
): readonly WorkspaceCleanupProposal[] {
  return Object.freeze(observations.map((observation) => classifyWorkspaceCleanup(observation)));
}
