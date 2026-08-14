/**
 * Pure workspace-cleanup classification.
 *
 * Account-owned adapters discover repositories, inspect Git and provider
 * state, and normalize that evidence before calling this module. Nothing here
 * reads a filesystem, contacts a provider, renders a command, or authorizes a
 * mutation.
 */

export const WORKSPACE_CLEANUP_REASON_CODES = Object.freeze([
  "observation-invalid",
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
  "pull-request-tip-unverified",
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
export type PullRequestTipState =
  | "matches-current-tip"
  | "different-tip"
  | "unknown"
  | "not-applicable";
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
  /** Whether the observed pull request's head is the branch's current tip. */
  readonly pullRequestTip: PullRequestTipState;
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
export interface WorkspaceCleanupValidProposal {
  readonly repositoryId: string;
  readonly targetId: string;
  readonly action: WorkspaceCleanupAction;
  readonly status: WorkspaceCleanupStatus;
  readonly reasonCodes: readonly WorkspaceCleanupReasonCode[];
  readonly requiresOperatorConfirmation: true;
}

/** Fail-closed result for a runtime value outside the observation contract. */
export interface WorkspaceCleanupInvalidProposal {
  readonly repositoryId: string | null;
  readonly targetId: string | null;
  readonly action: WorkspaceCleanupAction | null;
  readonly status: "blocked";
  readonly reasonCodes: readonly ["observation-invalid"];
  readonly requiresOperatorConfirmation: true;
}

export type WorkspaceCleanupProposal =
  | WorkspaceCleanupValidProposal
  | WorkspaceCleanupInvalidProposal;

const ACTIONS = ["remove-worktree", "remove-branch", "prune-worktree-metadata"] as const;
const CANONICAL_CHECKOUT_STATES = ["clean", "dirty", "missing", "unknown"] as const;
const TARGET_OWNERSHIP_STATES = ["owned", "unowned", "unknown"] as const;
const WORKTREE_STATES = ["clean", "dirty", "missing", "unknown"] as const;
const BRANCH_WORKTREE_STATES = ["none", "clean", "dirty", "unknown"] as const;
const BRANCH_TRACKING_STATES = [
  "up-to-date",
  "behind",
  "ahead",
  "diverged",
  "gone",
  "untracked",
  "unknown",
] as const;
const PULL_REQUEST_STATES = ["merged", "open", "closed-unmerged", "none", "unknown"] as const;
const PULL_REQUEST_TIP_STATES = [
  "matches-current-tip",
  "different-tip",
  "unknown",
  "not-applicable",
] as const;
const PRUNE_DRY_RUN_STATES = ["candidate", "not-candidate", "not-run", "failed"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === "string" && members.includes(value as T);
}

function hasValidBranchDisposition(value: unknown): value is BranchDispositionObservation {
  return (
    isRecord(value) &&
    isMember(value.tracking, BRANCH_TRACKING_STATES) &&
    isMember(value.pullRequest, PULL_REQUEST_STATES) &&
    isMember(value.pullRequestTip, PULL_REQUEST_TIP_STATES)
  );
}

function isWorkspaceCleanupObservation(value: unknown): value is WorkspaceCleanupObservation {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.repositoryId) ||
    !isNonEmptyString(value.declaredOrigin) ||
    !(value.observedOrigin === null || isNonEmptyString(value.observedOrigin)) ||
    !isMember(value.canonicalCheckout, CANONICAL_CHECKOUT_STATES) ||
    !isMember(value.targetOwnership, TARGET_OWNERSHIP_STATES) ||
    typeof value.evidenceComplete !== "boolean" ||
    !isMember(value.action, ACTIONS) ||
    !isNonEmptyString(value.targetId)
  ) {
    return false;
  }

  if (value.action === "remove-worktree") {
    return isMember(value.worktree, WORKTREE_STATES) && hasValidBranchDisposition(value.branch);
  }
  if (value.action === "remove-branch") {
    return (
      isMember(value.checkedOutWorktree, BRANCH_WORKTREE_STATES) &&
      hasValidBranchDisposition(value.branch)
    );
  }
  return isMember(value.pruneDryRun, PRUNE_DRY_RUN_STATES);
}

function invalidProposal(observation: unknown): WorkspaceCleanupInvalidProposal {
  const record = isRecord(observation) ? observation : {};
  return Object.freeze({
    repositoryId: isNonEmptyString(record.repositoryId) ? record.repositoryId : null,
    targetId: isNonEmptyString(record.targetId) ? record.targetId : null,
    action: isMember(record.action, ACTIONS) ? record.action : null,
    status: "blocked" as const,
    reasonCodes: Object.freeze(["observation-invalid"] as const),
    requiresOperatorConfirmation: true as const,
  });
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

  if (
    observation.pullRequest === "merged" &&
    observation.pullRequestTip !== "matches-current-tip"
  ) {
    reasons.push("pull-request-tip-unverified");
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
): WorkspaceCleanupValidProposal;
export function classifyWorkspaceCleanup(observation: unknown): WorkspaceCleanupProposal;
export function classifyWorkspaceCleanup(observation: unknown): WorkspaceCleanupProposal {
  if (!isWorkspaceCleanupObservation(observation)) return invalidProposal(observation);

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
): readonly WorkspaceCleanupProposal[];
export function classifyWorkspaceCleanupSet(
  observations: unknown,
): readonly WorkspaceCleanupProposal[];
export function classifyWorkspaceCleanupSet(
  observations: unknown,
): readonly WorkspaceCleanupProposal[] {
  if (!Array.isArray(observations)) return Object.freeze([invalidProposal(observations)]);
  return Object.freeze(
    Array.from({ length: observations.length }, (_, index) =>
      classifyWorkspaceCleanup(observations[index]),
    ),
  );
}
