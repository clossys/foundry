/**
 * `classifyCleanupCandidate` — pure judgement over already-gathered
 * evidence. It performs no Git, filesystem, GitHub, scheduler, credential,
 * network, or deletion I/O of any kind; it reads only the plain
 * `CleanupCandidate` a caller hands in and returns a `CleanupProposal`.
 *
 * ## Precedence, and why it is fixed
 *
 * Two tiers, always evaluated in this order:
 *
 * 1. **"owned" — structural, checked first, but not unconditional.** A
 *    candidate that is the canonical clone, or a checkout of the default
 *    branch, is returned `"owned"` immediately, with only the structural
 *    reason(s) that made it so — none of the tier-2 checks below run, and
 *    their evidence never appears in the result. This is deliberate: an
 *    "owned" location is categorically not a cleanup candidate no matter
 *    what else is true about it, so the reasons a *worktree* would be
 *    blocked for are simply not relevant facts about it.
 *
 *    One exception, and it is load-bearing rather than a style choice: a
 *    **confirmed** origin mismatch — the origin was actually observed, and
 *    it does not match what was expected — is checked before tier 1 and
 *    suppresses it. "Looks structurally like the canonical clone" is not
 *    good enough evidence when the one signal that actually identifies the
 *    repository has been positively contradicted; a repurposed directory
 *    or a stray same-named fork should never be waved through as "never a
 *    cleanup candidate." An origin that was simply never observed does
 *    *not* suppress tier 1 — "we don't know" is not proof the location is
 *    wrong, unlike "we checked, and it doesn't match."
 *
 * 2. **"blocked" — every applicable check runs; none short-circuits the
 *    others.** Unlike tier 1, tier 2 does not stop at the first problem
 *    found: every check below always runs, and every one that fails
 *    contributes its own reason to the result, in the fixed order the
 *    checks are listed in. That order mirrors the issue's own enumeration
 *    of required inputs — repository identity/origin, canonical/worktree
 *    (working tree) observations, branch/tracking state, prune dry-run
 *    evidence, PR evidence, active-task ownership — so a caller reading the
 *    reasons in order sees them in the same order the contract itself
 *    lists the underlying inputs. Running every check (rather than
 *    stopping at the first) is itself deliberate: a caller deciding what to
 *    fix next, or building a report across many candidates, needs the full
 *    set of what is wrong, not just whichever problem happened to be
 *    checked first — a single missing-evidence field must never mask a
 *    second, independently-detectable problem.
 *
 * A candidate reaches `"safe-candidate"` only by falling through both
 * tiers with zero reasons collected — every check ran, on complete
 * evidence, and every one passed. See `CleanupStatus`'s own doc comment for
 * what that status does and does not mean.
 *
 * ## Missing vs. incomplete evidence
 *
 * Every check below treats "the caller never gathered this evidence" (e.g.
 * `origin.known: false`) and "the caller claims to have gathered it but the
 * value is unusable" (e.g. `origin.known: true` with `observed` left
 * `undefined`) identically: both block, with the same `*-evidence-missing`
 * reason code. A check that cannot actually be answered from what it was
 * given must fail closed, not pass — see this repository's own
 * contribution guide (../../CONTRIBUTING.md, "a check that cannot run must
 * fail, never pass"), and `../gates/types.ts`'s `FoundationReport.complete`
 * / `../catalog/build.ts`'s `skipped` array for the established precedent
 * this module follows: the decline case is always DATA (a reason code a
 * caller can act on), never silence.
 */

import type {
  CleanupBranchEvidence,
  CleanupCandidate,
  CleanupLocationEvidence,
  CleanupOriginEvidence,
  CleanupOwnershipEvidence,
  CleanupPruneEvidence,
  CleanupPullRequestEvidence,
  CleanupProposal,
  CleanupReason,
  CleanupReasonCode,
  CleanupStatus,
} from "./types.js";
import { CLEANUP_CLASSIFICATION_VERSION } from "./types.js";

function reason(code: CleanupReasonCode, message: string): CleanupReason {
  return { code, message };
}

function proposal(candidate: CleanupCandidate, status: CleanupStatus, reasons: readonly CleanupReason[]): CleanupProposal {
  return {
    schemaVersion: CLEANUP_CLASSIFICATION_VERSION,
    repositoryId: candidate.repositoryId,
    branch: candidate.branch.name,
    status,
    reasons,
  };
}

// ---------------------------------------------------------------- "owned" tier

function ownedReasons(candidate: CleanupCandidate): CleanupReason[] {
  const reasons: CleanupReason[] = [];
  if (candidate.location.kind === "canonical") {
    reasons.push(reason("canonical-repository", "This location is the repository's canonical clone, never a cleanup candidate."));
  }
  if (candidate.branch.isDefaultBranch === true) {
    reasons.push(reason("default-branch", "This location is a checkout of the repository's default branch, never a cleanup candidate."));
  }
  return reasons;
}

// ------------------------------------------------------------- "blocked" tier

/** repository identity/origin. */
function checkOrigin(origin: CleanupOriginEvidence): CleanupReason | undefined {
  if (!origin.known || typeof origin.observed !== "string" || origin.observed.length === 0) {
    return reason("origin-evidence-missing", "This repository's remote origin was not observed.");
  }
  if (origin.observed !== origin.expected) {
    return reason("origin-mismatch", `Observed origin "${origin.observed}" does not match the expected origin "${origin.expected}".`);
  }
  return undefined;
}

/** canonical and worktree observations — working tree clean/dirty state. */
function checkWorkingTree(location: CleanupLocationEvidence): CleanupReason | undefined {
  if (!location.workingTreeKnown || typeof location.workingTreeClean !== "boolean") {
    return reason("working-tree-evidence-missing", "This location's working tree clean/dirty state was not observed.");
  }
  if (location.workingTreeClean === false) {
    return reason("dirty-working-tree", "This location's working tree has uncommitted changes.");
  }
  return undefined;
}

/** branch/tracking state. */
function checkTracking(branch: CleanupBranchEvidence): CleanupReason | undefined {
  if (!branch.trackingKnown || typeof branch.hasUpstream !== "boolean") {
    return reason("tracking-evidence-missing", "This branch's upstream tracking state was not observed.");
  }
  if (branch.hasUpstream === false) {
    return reason("unpushed-commits", "This branch has no upstream tracking branch, so none of its work is confirmed pushed.");
  }
  if (typeof branch.aheadCount !== "number" || !Number.isFinite(branch.aheadCount) || branch.aheadCount < 0) {
    return reason("tracking-evidence-missing", "This branch has an upstream, but how far ahead of it was not observed.");
  }
  if (branch.aheadCount > 0) {
    return reason("unpushed-commits", `This branch is ${branch.aheadCount} commit(s) ahead of its upstream.`);
  }
  return undefined;
}

/** prune dry-run evidence. */
function checkPrune(prune: CleanupPruneEvidence): CleanupReason | undefined {
  if (!prune.known || typeof prune.safeWithoutForce !== "boolean") {
    return reason("prune-evidence-missing", "No non-destructive dry-run evidence was observed for this candidate.");
  }
  if (prune.safeWithoutForce === false) {
    return reason("prune-requires-force", "A non-destructive dry run reported this candidate would require a force flag to remove.");
  }
  return undefined;
}

/** PR merged/closed evidence. */
function checkPullRequest(pullRequest: CleanupPullRequestEvidence): CleanupReason | undefined {
  if (!pullRequest.known || pullRequest.state === undefined) {
    return reason("pull-request-evidence-missing", "No pull-request search evidence was observed for this branch.");
  }
  switch (pullRequest.state) {
    case "merged":
      return undefined;
    case "none-found":
      return reason("pull-request-not-found", "A pull-request search completed and found no associated pull request.");
    case "open":
      return reason("pull-request-open", "This branch has an open, not-yet-merged pull request.");
    case "closed-unmerged":
      return reason("pull-request-closed-unmerged", "This branch's pull request was closed without merging.");
    default:
      // Defensive: a caller (or anything upstream of TypeScript, e.g. a
      // deserialized value crossing a process boundary) could hand in a
      // state outside the declared union. Treated identically to "never
      // searched" — this function must fail closed on any value it does
      // not specifically recognize as a real, checked conclusion, never
      // assume the best about it.
      return reason("pull-request-evidence-missing", "This branch's pull-request state was not a recognized value.");
  }
}

/** active-task ownership. */
function checkOwnership(ownership: CleanupOwnershipEvidence): CleanupReason | undefined {
  if (!ownership.known || typeof ownership.ownedByActiveTask !== "boolean") {
    return reason("ownership-evidence-missing", "No active-task ownership evidence was observed for this candidate.");
  }
  if (ownership.ownedByActiveTask === true) {
    return reason("active-task-ownership", "This candidate is currently claimed by an active task.");
  }
  return undefined;
}

function blockedReasons(candidate: CleanupCandidate): CleanupReason[] {
  // Fixed order — mirrors the issue's own enumeration of required inputs.
  // See this file's top doc comment for why every check runs regardless of
  // whether an earlier one already failed.
  return [
    checkOrigin(candidate.origin),
    checkWorkingTree(candidate.location),
    checkTracking(candidate.branch),
    checkPrune(candidate.prune),
    checkPullRequest(candidate.pullRequest),
    checkOwnership(candidate.ownership),
  ].filter((entry): entry is CleanupReason => entry !== undefined);
}

/**
 * Classifies one caller-normalized `CleanupCandidate` into a
 * `CleanupProposal`. Pure and total: never throws, never performs I/O, and
 * always returns exactly one proposal for the candidate it was given. See
 * this file's top doc comment for the full precedence contract.
 */
export function classifyCleanupCandidate(candidate: CleanupCandidate): CleanupProposal {
  // A CONFIRMED origin mismatch — the origin was actually observed, and it
  // does not match what was expected — overrides the owned tier entirely.
  // Origin evidence that was simply never gathered does not: "we don't
  // know" is not proof the location is wrong, so an unknown origin still
  // lets a structurally canonical/default-branch location classify as
  // owned, exactly as before. But a *known*, mismatched origin is positive
  // evidence this location is not actually the repository it claims to be
  // — a repurposed directory, a stray clone of a similarly named fork, a
  // worktree pointed at the wrong remote. Trusting "this looks like the
  // canonical clone" over a confirmed contradiction in the one signal that
  // actually identifies the repository would be exactly the unverified-
  // claim failure this classifier exists to prevent, and it would violate
  // the issue's own explicit requirement that "origin mismatch... must
  // block." See `classify.test.ts`'s "confirmed origin mismatch overrides
  // the owned tier" cases for the regression this guards.
  const confirmedOriginMismatch =
    candidate.origin.known === true &&
    typeof candidate.origin.observed === "string" &&
    candidate.origin.observed.length > 0 &&
    candidate.origin.observed !== candidate.origin.expected;

  if (!confirmedOriginMismatch) {
    const owned = ownedReasons(candidate);
    if (owned.length > 0) return proposal(candidate, "owned", owned);
  }

  const blocked = blockedReasons(candidate);
  if (blocked.length > 0) return proposal(candidate, "blocked", blocked);

  return proposal(candidate, "safe-candidate", []);
}
