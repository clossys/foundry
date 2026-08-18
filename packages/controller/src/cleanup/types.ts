/**
 * Types for the pure workspace-cleanup classifier: the deterministic
 * decision core shared by every account-plane cleanup skill (#215). This
 * module owns shapes only — no logic lives here, matching every other
 * subpath's own `types.ts` in this package (see `../catalog/types.ts`,
 * `../repository/types.ts`, `../review/types.ts`).
 *
 * BOUNDARY: nothing in this subpath performs Git, filesystem, GitHub,
 * scheduler, credential, network, or deletion I/O. Every field below is
 * something a caller already observed, gathered, or decided elsewhere and
 * is handing in as plain data. See `classify.ts`'s own doc comment for the
 * classification rules over this data, and the package README's `./cleanup`
 * section for the full contract and thin-adapter guidance.
 */

/** The only classification schema this package version produces. */
export const CLEANUP_CLASSIFICATION_VERSION = 1 as const;

/**
 * Whether the location being classified is the repository's one canonical
 * clone or one of its (potentially many) ephemeral worktrees. A canonical
 * clone is never a cleanup candidate — see `classifyCleanupCandidate`'s
 * "owned" tier.
 */
export type CleanupLocationKind = "canonical" | "worktree";

/**
 * The "canonical and worktree observations" input: which kind of location
 * this is, plus whatever the caller was able to observe about its working
 * tree's clean/dirty state.
 *
 * `workingTreeKnown: false` and `workingTreeKnown: true` with
 * `workingTreeClean` left `undefined` are treated identically by
 * `classifyCleanupCandidate` — both mean "this caller cannot vouch for the
 * working tree" and both block. A caller that successfully checked the
 * working tree must set both fields; there is no way to claim "known" and
 * supply no verdict.
 */
export interface CleanupLocationEvidence {
  readonly kind: CleanupLocationKind;
  /** Whether the caller actually determined the working tree's clean/dirty state. */
  readonly workingTreeKnown: boolean;
  /** The observed verdict, present only when `workingTreeKnown` is `true`. */
  readonly workingTreeClean?: boolean;
}

/**
 * The "repository identity/origin" input. `expected` is the origin this
 * repository is supposed to have — the caller's own registry value, never
 * looked up by this package. `observed` is what the caller actually read
 * from the repository, present only when `known` is `true`.
 */
export interface CleanupOriginEvidence {
  /** Whether the caller was able to read this repository's configured remote origin at all. */
  readonly known: boolean;
  /** The observed origin, present only when `known` is `true`. */
  readonly observed?: string;
  readonly expected: string;
}

/**
 * The "branch/tracking state" input for one branch. `isDefaultBranch` feeds
 * the "owned" tier directly (see `classifyCleanupCandidate`) — a default
 * branch is never a cleanup candidate regardless of location kind, because
 * some workspace layouts check the default branch out into its own
 * worktree rather than only the canonical clone.
 *
 * `behindCount` is informational only: how far behind its upstream a
 * branch sits has no bearing on whether removing it would lose local work,
 * so it does not participate in classification.
 */
export interface CleanupBranchEvidence {
  readonly name: string;
  readonly isDefaultBranch: boolean;
  /** Whether the caller actually determined this branch's upstream tracking state. */
  readonly trackingKnown: boolean;
  /** Whether an upstream tracking branch exists at all, present only when `trackingKnown` is `true`. */
  readonly hasUpstream?: boolean;
  /** Local commits not present on the upstream, present only when `trackingKnown` and `hasUpstream` are both `true`. */
  readonly aheadCount?: number;
  /** Informational only — see this interface's own doc comment. */
  readonly behindCount?: number;
}

/**
 * The "prune dry-run evidence" input: whether a caller-executed,
 * non-destructive dry run (e.g. a native "would this need a force flag to
 * remove" check for a worktree or branch) already agrees nothing would be
 * lost. This package never runs that dry run itself — it only classifies
 * the caller's own report of one.
 */
export interface CleanupPruneEvidence {
  /** Whether a dry run was actually executed for this candidate. */
  readonly known: boolean;
  /** Whether the dry run reported this candidate removable without a force flag, present only when `known` is `true`. */
  readonly safeWithoutForce?: boolean;
}

/**
 * Normalized states for whatever pull request the caller found associated
 * with this branch. `"none-found"` means a search was actually completed
 * and returned nothing — distinct from `CleanupPullRequestEvidence.known`
 * being `false`, which means no search evidence exists at all. Both block,
 * but with different reason codes, so a caller building a report can tell
 * "we looked and found nothing" apart from "we never looked."
 */
export type CleanupPullRequestState = "merged" | "closed-unmerged" | "open" | "none-found";

/** The "PR merged/closed evidence" input. */
export interface CleanupPullRequestEvidence {
  /** Whether the caller actually searched for an associated pull request. */
  readonly known: boolean;
  /** The search's conclusion, present only when `known` is `true`. */
  readonly state?: CleanupPullRequestState;
}

/** The "active-task ownership" input. */
export interface CleanupOwnershipEvidence {
  /** Whether the caller actually checked for active-task ownership. */
  readonly known: boolean;
  /** Whether some other active task currently claims this candidate, present only when `known` is `true`. */
  readonly ownedByActiveTask?: boolean;
}

/**
 * One classification input: caller-normalized inventory and observations
 * for a single repository location (a canonical clone or one worktree).
 * Every field is data the caller already gathered — `classifyCleanupCandidate`
 * performs no I/O of any kind to fill in what is missing.
 *
 * `repositoryId` is opaque to this package: never interpreted, only echoed
 * back onto the resulting `CleanupProposal` so a caller correlating a batch
 * of proposals against its own inventory does not have to rely on array
 * order or object identity.
 */
export interface CleanupCandidate {
  readonly repositoryId: string;
  readonly origin: CleanupOriginEvidence;
  readonly location: CleanupLocationEvidence;
  readonly branch: CleanupBranchEvidence;
  readonly prune: CleanupPruneEvidence;
  readonly pullRequest: CleanupPullRequestEvidence;
  readonly ownership: CleanupOwnershipEvidence;
}

/**
 * The three stable classification outcomes `classifyCleanupCandidate` can
 * return:
 *
 * - `"owned"` — a structural reason makes this candidate categorically not
 *   a cleanup candidate at all, independent of every other input (a
 *   canonical clone, or a checkout of the default branch). This is a
 *   terminal, unconditional classification: it is returned even when other
 *   evidence is dirty, missing, or would otherwise have blocked, because no
 *   amount of evidence could ever make an "owned" location eligible.
 * - `"blocked"` — at least one required check failed, or its evidence was
 *   missing or incomplete. A `"blocked"` result may become `"safe-candidate"`
 *   once the caller supplies complete, clean evidence; it is not terminal.
 * - `"safe-candidate"` — every check passed on complete evidence. **This is
 *   a PROPOSAL, never deletion authorization.** `classifyCleanupCandidate`
 *   performs no deletion, mutation, or any other I/O, and this package
 *   exports no deletion API at all. A `"safe-candidate"` result still must
 *   pass through the caller's own explicit operator confirmation and
 *   guarded application before anything is actually removed.
 */
export type CleanupStatus = "owned" | "safe-candidate" | "blocked";

/**
 * The machine-readable reason vocabulary `classifyCleanupCandidate` uses on
 * `CleanupReason.code`. Grouped by the input that produces each one — see
 * `classify.ts` for exactly which check produces which code and the fixed
 * order those checks run in.
 */
export type CleanupReasonCode =
  // "owned" tier
  | "canonical-repository"
  | "default-branch"
  // repository identity/origin
  | "origin-evidence-missing"
  | "origin-mismatch"
  // canonical and worktree observations (working tree)
  | "working-tree-evidence-missing"
  | "dirty-working-tree"
  // branch/tracking state
  | "tracking-evidence-missing"
  | "unpushed-commits"
  // prune dry-run evidence
  | "prune-evidence-missing"
  | "prune-requires-force"
  // PR merged/closed evidence
  | "pull-request-evidence-missing"
  | "pull-request-not-found"
  | "pull-request-open"
  | "pull-request-closed-unmerged"
  // active-task ownership
  | "ownership-evidence-missing"
  | "active-task-ownership";

/** One stable, deterministic reason a candidate reached its `CleanupProposal.status`. */
export interface CleanupReason {
  readonly code: CleanupReasonCode;
  readonly message: string;
}

/**
 * A typed action PROPOSAL — never a shell command, never anything this
 * package can execute itself. `classifyCleanupCandidate` returns exactly
 * one of these per candidate; a caller is free to batch them by mapping
 * over its own candidate list.
 *
 * `reasons` is:
 *   - non-empty for `"owned"` — always at least the structural reason(s)
 *     that made it owned;
 *   - non-empty for `"blocked"` — every applicable blocking reason, in the
 *     fixed precedence order documented on `classifyCleanupCandidate`, not
 *     just the first one found;
 *   - always empty for `"safe-candidate"` — there is nothing to cite
 *     because nothing blocked, and an empty array here is deliberate: it
 *     keeps a `"safe-candidate"` result from ever looking like it is
 *     citing evidence FOR an action, when it is only the absence of a
 *     reason not to propose one. See `CleanupStatus`'s own doc comment:
 *     this status is a proposal, never deletion authorization.
 */
export interface CleanupProposal {
  readonly schemaVersion: typeof CLEANUP_CLASSIFICATION_VERSION;
  readonly repositoryId: string;
  readonly branch: string;
  readonly status: CleanupStatus;
  readonly reasons: readonly CleanupReason[];
}
