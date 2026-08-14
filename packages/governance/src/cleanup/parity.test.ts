import { describe, expect, it } from "vitest";
import { classifyCleanupCandidate } from "./classify.js";
import type { CleanupCandidate } from "./types.js";

/**
 * Cross-plane parity: proves every account-plane cleanup skill gets the
 * SAME classification for the SAME underlying facts, without requiring any
 * of them to phrase their own evidence the same way. This package is the
 * one place classification logic is allowed to live (see the package
 * README's `./cleanup` section) — an account plane's own skill only
 * gathers evidence and maps it onto `CleanupCandidate`; if two differently
 * written adapters can map the same real-world facts onto two different
 * `CleanupCandidate` shapes and still land on the same `status` and
 * `reasons[].code`, that is exactly the guarantee a shared package is
 * supposed to provide.
 *
 * Deliberately generic: neither adapter below names any specific
 * consuming skill, account, or product — see AGENTS.md's identity-hygiene
 * rule. "Plane A" and "Plane B" stand in for any two independent callers.
 */

/**
 * A plane-neutral description of one real-world scenario, in whatever
 * vocabulary a hypothetical caller's own inventory step happens to use.
 * Deliberately terse and un-opinionated about field names — the two
 * adapters below each translate this into `CleanupCandidate` using their
 * own, DIFFERENT internal conventions, exactly as two independently
 * written skills would.
 */
interface ScenarioFacts {
  readonly id: string;
  readonly isMainCheckout: boolean;
  readonly branchName: string;
  readonly onDefaultBranch: boolean;
  readonly originMatches: boolean | "unknown";
  readonly clean: boolean | "unknown";
  readonly pushed: boolean | "unknown";
  readonly dryRunSafe: boolean | "unknown";
  readonly prStatus: "merged" | "closed-unmerged" | "open" | "not-found" | "unknown";
  readonly claimedByOtherTask: boolean | "unknown";
}

/**
 * Plane A's own adapter style: verbose field-by-field construction, ternary
 * plumbing for the tri-state ("unknown" vs a real verdict) facts, origin
 * comparison inlined.
 */
function toCandidatePlaneA(facts: ScenarioFacts): CleanupCandidate {
  const originKnown = facts.originMatches !== "unknown";
  const cleanKnown = facts.clean !== "unknown";
  const pushedKnown = facts.pushed !== "unknown";
  const dryRunKnown = facts.dryRunSafe !== "unknown";
  const prKnown = facts.prStatus !== "unknown";
  const ownershipKnown = facts.claimedByOtherTask !== "unknown";

  return {
    repositoryId: facts.id,
    origin: originKnown
      ? {
          known: true,
          observed: facts.originMatches ? "https://example.invalid/origin.git" : "https://example.invalid/fork.git",
          expected: "https://example.invalid/origin.git",
        }
      : { known: false, expected: "https://example.invalid/origin.git" },
    location: {
      kind: facts.isMainCheckout ? "canonical" : "worktree",
      workingTreeKnown: cleanKnown,
      workingTreeClean: cleanKnown ? (facts.clean as boolean) : undefined,
    },
    branch: {
      name: facts.branchName,
      isDefaultBranch: facts.onDefaultBranch,
      trackingKnown: pushedKnown,
      hasUpstream: pushedKnown ? true : undefined,
      aheadCount: pushedKnown ? (facts.pushed ? 0 : 1) : undefined,
    },
    prune: dryRunKnown ? { known: true, safeWithoutForce: facts.dryRunSafe as boolean } : { known: false },
    pullRequest: prKnown
      ? { known: true, state: facts.prStatus === "not-found" ? "none-found" : (facts.prStatus as "merged" | "closed-unmerged" | "open") }
      : { known: false },
    ownership: ownershipKnown ? { known: true, ownedByActiveTask: facts.claimedByOtherTask as boolean } : { known: false },
  };
}

/**
 * Plane B's own adapter style: a small lookup-table helper for the
 * tri-state fields, an object built via spread from a base template, and a
 * DIFFERENT (but equally valid) origin URL pair — proving parity does not
 * depend on the two planes even agreeing on what a "matching" origin
 * literally looks like, only on whether IT MATCHES.
 */
function tri<T>(value: boolean | "unknown", whenTrue: T, whenFalse: T): { known: boolean; value?: T } {
  if (value === "unknown") return { known: false };
  return { known: true, value: value ? whenTrue : whenFalse };
}

function toCandidatePlaneB(facts: ScenarioFacts): CleanupCandidate {
  const cleanTri = tri(facts.clean, true, false);
  const pushedTri = tri(facts.pushed, 0, 1);
  const dryRunTri = tri(facts.dryRunSafe, true, false);
  const ownershipTri = tri(facts.claimedByOtherTask, true, false);
  const originExpected = "different-scheme://another.invalid/canonical";

  const base: CleanupCandidate = {
    repositoryId: facts.id,
    origin: { known: false, expected: originExpected },
    location: { kind: "worktree", workingTreeKnown: false },
    branch: { name: facts.branchName, isDefaultBranch: facts.onDefaultBranch, trackingKnown: false },
    prune: { known: false },
    pullRequest: { known: false },
    ownership: { known: false },
  };

  return {
    ...base,
    origin:
      facts.originMatches === "unknown"
        ? base.origin
        : {
            known: true,
            observed: facts.originMatches ? originExpected : "different-scheme://another.invalid/elsewhere",
            expected: originExpected,
          },
    location: { kind: facts.isMainCheckout ? "canonical" : "worktree", workingTreeKnown: cleanTri.known, workingTreeClean: cleanTri.value },
    branch: {
      ...base.branch,
      trackingKnown: pushedTri.known,
      hasUpstream: pushedTri.known ? true : undefined,
      aheadCount: pushedTri.value,
    },
    prune: dryRunTri.known ? { known: true, safeWithoutForce: dryRunTri.value as boolean } : { known: false },
    pullRequest:
      facts.prStatus === "unknown" ? { known: false } : { known: true, state: facts.prStatus === "not-found" ? "none-found" : facts.prStatus },
    ownership: ownershipTri.known ? { known: true, ownedByActiveTask: ownershipTri.value as boolean } : { known: false },
  };
}

const CLEAN_FACTS: ScenarioFacts = {
  id: "scenario",
  isMainCheckout: false,
  branchName: "feature/parity",
  onDefaultBranch: false,
  originMatches: true,
  clean: true,
  pushed: true,
  dryRunSafe: true,
  prStatus: "merged",
  claimedByOtherTask: false,
};

const scenarios: { name: string; facts: ScenarioFacts }[] = [
  { name: "fully clean -> safe-candidate", facts: CLEAN_FACTS },
  { name: "canonical checkout -> owned", facts: { ...CLEAN_FACTS, isMainCheckout: true } },
  { name: "default branch -> owned", facts: { ...CLEAN_FACTS, onDefaultBranch: true } },
  { name: "dirty working tree -> blocked", facts: { ...CLEAN_FACTS, clean: false } },
  { name: "origin mismatch -> blocked", facts: { ...CLEAN_FACTS, originMatches: false } },
  { name: "unpushed commits -> blocked", facts: { ...CLEAN_FACTS, pushed: false } },
  { name: "dry run needs force -> blocked", facts: { ...CLEAN_FACTS, dryRunSafe: false } },
  { name: "PR closed unmerged -> blocked", facts: { ...CLEAN_FACTS, prStatus: "closed-unmerged" } },
  { name: "PR open -> blocked", facts: { ...CLEAN_FACTS, prStatus: "open" } },
  { name: "PR not found -> blocked", facts: { ...CLEAN_FACTS, prStatus: "not-found" } },
  { name: "no PR evidence at all -> blocked", facts: { ...CLEAN_FACTS, prStatus: "unknown" } },
  { name: "active task ownership -> blocked", facts: { ...CLEAN_FACTS, claimedByOtherTask: true } },
  { name: "missing origin evidence -> blocked", facts: { ...CLEAN_FACTS, originMatches: "unknown" } },
  { name: "missing working-tree evidence -> blocked", facts: { ...CLEAN_FACTS, clean: "unknown" } },
  { name: "missing tracking evidence -> blocked", facts: { ...CLEAN_FACTS, pushed: "unknown" } },
  { name: "missing prune evidence -> blocked", facts: { ...CLEAN_FACTS, dryRunSafe: "unknown" } },
  { name: "missing ownership evidence -> blocked", facts: { ...CLEAN_FACTS, claimedByOtherTask: "unknown" } },
  {
    name: "several blockers at once -> same reasons in the same order on both planes",
    facts: { ...CLEAN_FACTS, clean: false, pushed: false, prStatus: "closed-unmerged", claimedByOtherTask: true },
  },
];

describe("cross-plane parity — shared classification without identical caller prose", () => {
  for (const { name, facts } of scenarios) {
    it(name, () => {
      const resultA = classifyCleanupCandidate(toCandidatePlaneA(facts));
      const resultB = classifyCleanupCandidate(toCandidatePlaneB(facts));

      // The two adapters build genuinely different CleanupCandidate object
      // shapes (different origin URLs, different construction style) for
      // the same underlying facts, so the candidates themselves are not
      // expected to be equal — the PARITY GUARANTEE this package makes is
      // over the classification, not over caller-supplied literals: same
      // status, same reason CODES, in the same order.
      expect(resultA.status).toBe(resultB.status);
      expect(resultA.reasons.map((r) => r.code)).toEqual(resultB.reasons.map((r) => r.code));
      // Reason MESSAGES are generated by this package from whatever
      // evidence value it was given, so they match too whenever neither
      // adapter fed the classifier a plane-specific literal (an ahead
      // count, a boolean verdict) — which is every reason code except
      // origin-mismatch here, since these two adapters deliberately use
      // different origin URL strings for "matches" and "doesn't match" to
      // prove parity does not depend on agreeing on that literal.
      resultA.reasons.forEach((reasonA, index) => {
        const reasonB = resultB.reasons[index];
        if (reasonA.code === "origin-mismatch") return;
        expect(reasonB?.message).toBe(reasonA.message);
      });
    });
  }

  it("branch name and repositoryId still round-trip per-plane even though the rest of the shape differs", () => {
    const resultA = classifyCleanupCandidate(toCandidatePlaneA(CLEAN_FACTS));
    const resultB = classifyCleanupCandidate(toCandidatePlaneB(CLEAN_FACTS));
    expect(resultA.repositoryId).toBe(CLEAN_FACTS.id);
    expect(resultB.repositoryId).toBe(CLEAN_FACTS.id);
    expect(resultA.branch).toBe(CLEAN_FACTS.branchName);
    expect(resultB.branch).toBe(CLEAN_FACTS.branchName);
  });
});
