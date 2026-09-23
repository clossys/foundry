import type { AdvisorFinding, EngagementMode } from "./types.js";

/**
 * Self-serve and managed are grant shapes, not separate distributions
 * (issue #1044, owner decision on #1220: managed engagements are the
 * entry path now, self-serve next). Omitting `engagementMode` means
 * self-serve, so every existing assessment input stays valid unchanged.
 * `managed` requires an `operatorRef` naming the operator preparing the
 * next action for the sponsor to approve — never this package's own
 * name, and never a private consumer identity or tier list; this
 * package does not record who that operator is beyond the one reference
 * string the caller supplies. Managed mode never bypasses
 * `ExecutionAuthorization`: a next action is ready only when both this
 * validation and the authorization validation are satisfied.
 */
const SELF_REFERENCE_PATTERN = /^(@clossys\/)?advisor$/i;

export interface ManagedEngagementInput {
  engagementMode?: EngagementMode;
  operatorRef?: string;
}

/** Validates only the managed-mode shape; self-serve (the default) always returns no findings. */
export function validateManagedEngagement(input: ManagedEngagementInput): AdvisorFinding[] {
  const mode = input.engagementMode ?? "self-serve";
  if (mode === "self-serve") return [];
  const operatorRef = input.operatorRef?.trim();
  if (!operatorRef) {
    return [{ rule: "managed-engagement-missing-operator", severity: "error", message: "managed engagement mode requires a nonempty operatorRef naming who is preparing the next action" }];
  }
  if (SELF_REFERENCE_PATTERN.test(operatorRef)) {
    return [{ rule: "managed-engagement-operator-is-advisor", severity: "error", message: `operatorRef ${JSON.stringify(operatorRef)} names this package; a managed engagement's operator must be a party other than Advisor` }];
  }
  return [];
}

/**
 * One operator's disposition on a proposed kit or plan, recorded before a
 * managed-mode client sees it (owner comment on #1220: "a managed-mode
 * operator reviews Advisor's proposed kit before the client sees it").
 * This is data the caller supplies and retains; this package neither
 * stores it nor infers a disposition on its own.
 */
export interface OperatorReview {
  operatorRef: string;
  reviewedAt: string;
  disposition: "approved" | "revise";
  note?: string;
}

/**
 * The operator-review hook: whether a proposal is ready to show the
 * client. Self-serve is always ready (there is no operator step).
 * Managed mode is ready only once an `approved` review from the engaged
 * operator is on record; anything else — no review yet, `revise`, or a
 * review from someone other than the engagement's own operator — holds
 * the proposal back.
 */
export function proposalReadyForClient(engagement: ManagedEngagementInput, review?: OperatorReview): boolean {
  const mode = engagement.engagementMode ?? "self-serve";
  if (mode === "self-serve") return true;
  if (!review || review.disposition !== "approved") return false;
  return review.operatorRef === engagement.operatorRef;
}
