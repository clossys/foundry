/**
 * The decision rules every caller shares: what a stored record means now,
 * whether analytics is allowed, whether the notice opens by itself, and
 * whether a durable acknowledgement may apply. The lifecycle and any
 * pre-hydration caller use these functions and never re-implement them.
 *
 * Pure: arguments in, answer out. No storage, no clock, no browser global.
 */

import { isWithinWindow } from "../calendar-months.js";
import {
  normalizeRegime,
  parseStoredChoice,
  type ConsentPolicy,
  type ConsentSignals,
  type EffectiveChoice,
  type StoredChoice,
  type StoredInput,
} from "./record.js";

/**
 * True when a parsed record still speaks at `now` under `policy`: inside its
 * window (end instant outside), and under the current policy version unless
 * it is a denial and the policy keeps denials across a version bump. A
 * denial dated after `now` (the clock moved back) stays live until its
 * expiry; a grant dated after `now` is not live.
 */
export function isLiveChoice(choice: StoredChoice, policy: ConsentPolicy, now: Date): boolean {
  const versionHolds =
    choice.policyVersion === policy.version ||
    (choice.status === "denied" && !policy.invalidateDenialOnPolicyBump);
  if (!versionHolds) return false;
  const decidedAt = new Date(choice.decidedAt);
  const expiresAt = new Date(choice.expiresAt);
  if (choice.status === "denied" && decidedAt.getTime() > now.getTime()) {
    return now.getTime() < expiresAt.getTime();
  }
  return isWithinWindow(decidedAt, expiresAt, now);
}

/** The live record behind a stored input, or `null` when it reads as no choice. */
export function liveChoice(stored: StoredInput, policy: ConsentPolicy, now: Date): StoredChoice | null {
  if (stored === null || stored === "unreadable") return null;
  const parsed = parseStoredChoice(stored, policy);
  if (parsed === null) return null;
  return isLiveChoice(parsed, policy, now) ? parsed : null;
}

/** The choice in force. With GPC on it is never `none` or `unknown`. */
export function effectiveChoice(
  stored: StoredInput,
  signals: ConsentSignals,
  policy: ConsentPolicy,
  now: Date,
): EffectiveChoice {
  if (stored === "unreadable") {
    return signals.gpc ? "denied" : "unknown";
  }
  const live = liveChoice(stored, policy, now);
  if (signals.gpc) {
    const overrides =
      live !== null && live.status === "granted" && live.gpcOverride === true && policy.gpcOverridable === true;
    return overrides ? "granted" : "denied";
  }
  return live === null ? "none" : live.status;
}

/** Whether analytics may run: a grant, or no choice under `notice`. Never a denial, never unreadable storage. */
export function isAllowed(
  stored: StoredInput,
  signals: ConsentSignals,
  regime: unknown,
  policy: ConsentPolicy,
  now: Date,
): boolean {
  const effective = effectiveChoice(stored, signals, policy, now);
  if (effective === "granted") return true;
  return effective === "none" && normalizeRegime(regime) === "notice";
}

/** Whether the notice opens by itself: only for no choice under `prompt`. */
export function shouldPromptAutomatically(
  stored: StoredInput,
  signals: ConsentSignals,
  regime: unknown,
  policy: ConsentPolicy,
  now: Date,
): boolean {
  return effectiveChoice(stored, signals, policy, now) === "none" && normalizeRegime(regime) === "prompt";
}

/** A choice together with the per-lifecycle sequence it was decided under. */
export interface SequencedChoice {
  choice: StoredChoice;
  sequence: number;
}

/**
 * Whether a durable store should apply `incoming` over what it holds.
 * Ordering is asymmetric on purpose: a denial always applies; a grant
 * applies only when strictly newer (a later `decidedAt`, or the same
 * `decidedAt` and a higher `sequence`).
 */
export function shouldApplyEvidence(incoming: SequencedChoice, current: SequencedChoice | null): boolean {
  if (incoming.choice.status === "denied") return true;
  if (current === null) return true;
  const incomingAt = Date.parse(incoming.choice.decidedAt);
  const currentAt = Date.parse(current.choice.decidedAt);
  if (!Number.isFinite(incomingAt) || !Number.isFinite(currentAt)) return false;
  if (incomingAt !== currentAt) return incomingAt > currentAt;
  return incoming.sequence > current.sequence;
}
