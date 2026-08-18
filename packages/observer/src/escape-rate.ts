/**
 * Escape rate: changes that reached the default branch and violated a rule,
 * divided by changes that landed.
 *
 * This is the number that closes the gate's loop, and computing it here —
 * never inside the gate package itself — is the whole reason `observer`
 * exists as a separate package. See this repository's decision record for
 * the full argument; the short version is in this package's README.
 *
 * GROUND TRUTH IS NOT THE GATE'S OWN VERDICT
 * --------------------------------------------
 * `LandedChangeOutcome.violation` is the caller's own, independently-
 * sourced judgment of whether a landed change actually violated a rule —
 * from a later audit, an incident report, a downstream detector, anything
 * except the gate's own recorded verdict for that run. Feeding a gate's own
 * "satisfied" back in as "no violation" would make this module measure
 * whether the gate agrees with itself, which is exactly the grading-its-own-
 * homework failure this package exists to refuse. This module has no way to
 * enforce that a caller sources `violation` independently — it can only
 * document the requirement and keep the field structurally distinct from
 * `GateRunRecord.verdict` in `gate-efficacy.ts`, which it does: the two
 * types share no field name, so nothing here can compare a verdict to
 * itself by accident.
 */
import type { Observation } from "./observation.js";

/** One landed change's ground-truth rule-violation status for one gate. */
export interface LandedChangeOutcome {
  readonly gate: string;
  readonly changeId: string;
  /**
   * Whether this landed change actually violated the rule the gate exists
   * to enforce — caller-sourced, never the gate's own verdict. See this
   * module's header.
   */
  readonly violation: Observation<Record<string, never>>;
}

/**
 * The escape-rate metric for one gate. Deliberately its own shape, sharing
 * no field name with `UnobservedSurfaceMetric` (`unobserved-surface.ts`) —
 * see `metrics.check.ts` for the compiled proof that the two cannot be
 * blended into one score.
 */
export interface EscapeRateMetric {
  readonly kind: "escape-rate";
  readonly gate: string;
  /** Every change counted as landed for this gate — the denominator, regardless of whether its violation status could be read. */
  readonly landedCount: number;
  /** Landed changes confirmed to have violated the rule. */
  readonly escapedCount: number;
  /** Landed changes confirmed clean. */
  readonly cleanCount: number;
  /**
   * Landed changes whose violation status could not be read. Reported
   * alongside the rate, never folded into `cleanCount` — an unreadable
   * outcome is not evidence of a clean one. A non-zero count here means
   * `rate` is a lower bound, not the true rate.
   */
  readonly couldNotReadCount: number;
  /** `escapedCount / landedCount`, or `null` when no changes landed for this gate (nothing to divide by). */
  readonly rate: number | null;
}

/** Computes the escape-rate metric for `gate` from `outcomes`, filtering to rows matching `gate`. */
export function computeEscapeRate(
  gate: string,
  outcomes: readonly LandedChangeOutcome[],
): EscapeRateMetric {
  let escapedCount = 0;
  let cleanCount = 0;
  let couldNotReadCount = 0;
  let landedCount = 0;

  for (const outcome of outcomes) {
    if (outcome.gate !== gate) continue;
    landedCount += 1;
    if (outcome.violation.state === "observed") escapedCount += 1;
    else if (outcome.violation.state === "unobserved") cleanCount += 1;
    else couldNotReadCount += 1;
  }

  return {
    kind: "escape-rate",
    gate,
    landedCount,
    escapedCount,
    cleanCount,
    couldNotReadCount,
    rate: landedCount === 0 ? null : escapedCount / landedCount,
  };
}
