/**
 * `evaluateRatchet` — a generic "warn-first with a checked-in baseline,
 * ratchet monotonically toward zero" primitive. Pure and deliberately
 * mechanism-neutral: it has no idea whether `current` counts lint
 * warnings, TODO comments, `any` usages, or anything else a caller wants to
 * track down to zero over time. A caller counts whatever it wants to
 * ratchet, reads its own checked-in baseline value (most plausibly from a
 * small JSON file it owns), and calls this function with both numbers.
 *
 * Contract:
 *   - `current <= baseline` never blocks — the count did not get worse.
 *   - `current > baseline` is a regression: `ok: false`, `status:
 *     "regression"`, with a `"ratchet/regression"` finding.
 *   - `current < baseline` is real, unclaimed progress. It is deliberately
 *     modeled as a FLAG (`improved: true`) on the passing result, not as a
 *     fourth top-level status, for two reasons. First, a ratchet's whole
 *     point is "warn first, never surprise" — a codebase that has already
 *     gotten better must not suddenly fail some caller's CI merely because
 *     nobody has yet edited a baseline file; `ok` staying `true` is what
 *     keeps that promise. Second, the improvement must never be silently
 *     dropped either, so `improved: true` always carries a
 *     `"ratchet/baseline-stale"` *warning* finding alongside it — a caller
 *     that wants a stricter "the baseline must always be current" policy
 *     can trivially turn that into a hard failure itself (`result.ok &&
 *     result.improved`), without this function forcing that choice on every
 *     caller by default.
 *   - Lowering the baseline is never automatic. This function only reports;
 *     nothing here writes to a baseline file or returns a "new baseline"
 *     value. Ratcheting the baseline down is an explicit, separate action a
 *     caller takes deliberately (e.g. its own follow-up commit), never a
 *     side effect of calling this function.
 *   - Nonsense input fails closed as `status: "invalid"`, not as a clean or
 *     regressed result. A missing baseline (`undefined`/`null` — the shape
 *     a caller gets from "the baseline file does not exist yet") is "could
 *     not run", never treated as "baseline of zero". A negative or
 *     non-integer `current`/`baseline` is equally invalid: both are counts,
 *     and a count that is negative or fractional cannot mean anything as a
 *     ratchet input.
 */

/** One thing wrong with `evaluateRatchet`'s inputs, or the outcome of a run that did run. */
export interface RatchetFinding {
  /** Stable identifier for what this finding reports. */
  rule:
    | "ratchet/current-invalid"
    | "ratchet/baseline-missing"
    | "ratchet/baseline-invalid"
    | "ratchet/regression"
    | "ratchet/baseline-stale";
  /** `"error"` blocks; `"warning"` (used only for `ratchet/baseline-stale`) does not. */
  severity: "error" | "warning";
  /** Human-readable description of the problem. */
  message: string;
  /** Which input this finding is about, when there is a single clear one. */
  path?: string;
}

/**
 * `evaluateRatchet`'s result. The three states map directly onto this
 * repository's three-state CLI exit contract (0 clean / 1 findings / 2
 * could not run), for a caller that wants to wire this into one:
 *   - `status: "clean"` -> exit 0 (even when `improved` is true — see the
 *     module doc comment for why that stays non-blocking by default).
 *   - `status: "regression"` -> exit 1.
 *   - `status: "invalid"` -> exit 2. Nothing was evaluated; `current` and
 *     `baseline` are not even echoed back, because neither could be trusted.
 */
export type RatchetResult =
  | {
      ok: true;
      status: "clean";
      current: number;
      baseline: number;
      /** `true` when `current < baseline` — real progress not yet captured in the baseline. */
      improved: boolean;
      findings: RatchetFinding[];
    }
  | {
      ok: false;
      status: "regression";
      current: number;
      baseline: number;
      findings: RatchetFinding[];
    }
  | {
      ok: false;
      status: "invalid";
      findings: RatchetFinding[];
    };

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Evaluates one ratchet step. See this module's doc comment for the full
 * contract. `current` and `baseline` are `unknown`, not `number`, on
 * purpose: both are exactly the kind of value a caller reads from the
 * outside world (a computed count, a parsed baseline file) rather than
 * something already known to be a well-formed number, and this function
 * validates rather than trusts either.
 */
export function evaluateRatchet(current: unknown, baseline: unknown): RatchetResult {
  const invalid: RatchetFinding[] = [];

  if (!isNonNegativeSafeInteger(current)) {
    invalid.push({
      rule: "ratchet/current-invalid",
      severity: "error",
      message:
        `current must be a non-negative integer, got ${JSON.stringify(current)}. Cannot evaluate the ratchet — ` +
        `this is "could not run", not a clean result.`,
      path: "current",
    });
  }

  if (baseline === undefined || baseline === null) {
    invalid.push({
      rule: "ratchet/baseline-missing",
      severity: "error",
      message:
        "baseline is missing (undefined/null) — most likely a checked-in baseline file that does not exist yet " +
        'or could not be read. This is "could not run", not a baseline of zero: create or fix the checked-in ' +
        "baseline before evaluating the ratchet.",
      path: "baseline",
    });
  } else if (!isNonNegativeSafeInteger(baseline)) {
    invalid.push({
      rule: "ratchet/baseline-invalid",
      severity: "error",
      message:
        `baseline must be a non-negative integer, got ${JSON.stringify(baseline)}. Cannot evaluate the ratchet ` +
        `— this is "could not run", not a clean result.`,
      path: "baseline",
    });
  }

  if (invalid.length > 0) {
    return { ok: false, status: "invalid", findings: invalid };
  }

  const currentValue = current as number;
  const baselineValue = baseline as number;

  if (currentValue > baselineValue) {
    return {
      ok: false,
      status: "regression",
      current: currentValue,
      baseline: baselineValue,
      findings: [
        {
          rule: "ratchet/regression",
          severity: "error",
          message:
            `current (${currentValue}) exceeds the checked-in baseline (${baselineValue}). Fix the regression; ` +
            "only a deliberate, explicit baseline update may raise the baseline — evaluateRatchet never does so " +
            "on your behalf.",
        },
      ],
    };
  }

  const improved = currentValue < baselineValue;
  return {
    ok: true,
    status: "clean",
    current: currentValue,
    baseline: baselineValue,
    improved,
    findings: improved
      ? [
          {
            rule: "ratchet/baseline-stale",
            severity: "warning",
            message:
              `current (${currentValue}) is below the checked-in baseline (${baselineValue}). The improvement is ` +
              `real but not yet captured: lower the baseline to ${currentValue} in its own explicit, separate ` +
              "change — evaluateRatchet never lowers it automatically.",
          },
        ]
      : [],
  };
}
