/**
 * Adapts a pre-existing, non-`GateResult` check outcome onto this module's
 * own `GateResult` ternary (`./result.js`).
 *
 * A repository rarely adopts `GateResult` for every check on day one. More
 * often, one existing script already reports its own ad hoc pass/fail/
 * can't-tell shape — its own field names, its own finding shape, its own
 * severity vocabulary — and a caller further up (an observation transport,
 * a report aggregator, a CI summary) wants to fold that existing outcome in
 * next to every other `GateResult`-native check without rewriting the
 * original script's return type. Multiple independent consumers of this
 * package have hand-written exactly this adapter already: a short `switch`
 * translating their own check's three states into `gateSatisfied` /
 * `gateViolated` / `gateIndeterminate`, a per-finding severity remap
 * (because a legacy check's own severity words are almost never whatever
 * vocabulary the caller's own `Finding` shape expects), and a required
 * fallback finding for the case `gateViolated` itself refuses: reporting a
 * violation with nothing wrong in it.
 *
 * This module centralizes exactly that shape, and nothing about any one
 * legacy check's own upstream fields or any one caller's own severity
 * vocabulary. `GateResult<TFinding, TReason>` is already fully generic over
 * the finding type (see `./result.js`) — this adapter stays that way too,
 * rather than quietly picking one caller's severity words (e.g.
 * `"error"`/`"warning"`, or `"high"`/`"medium"`/`"low"`) as though it were
 * universal. `adaptLegacyCheckResult` takes a value already reduced to the
 * three verdict tags `GateResult` itself uses, plus findings in a small
 * structural shape almost any existing check's finding already satisfies
 * (`rule?`, `severity?`, `message`, `path?`), and a caller-supplied map from
 * that legacy severity vocabulary to whichever one the caller's own
 * `Finding` type actually uses. Reducing a genuinely bespoke result shape
 * (its own `status`/`ok` fields, its own nesting) down to that structural
 * input remains the caller's own translation, on purpose — that reduction
 * is the one part that is genuinely different for every legacy check, and
 * forcing it through a single generic reader here would mean either
 * guessing at field names or special-casing each caller inside a package
 * that is supposed to serve all of them equally.
 */

import { gateIndeterminate, gateSatisfied, gateViolated } from "./result.js";
import type { GateResult } from "./result.js";

/**
 * One legacy check's own finding, in the loose shape almost any existing
 * ad hoc check already produces. Every field beyond `message` is optional
 * because a legacy check frequently omits some of them — `rule` and
 * `severity` most commonly, since a script that has never needed to merge
 * its findings with anyone else's rarely bothered to assign either.
 */
export interface LegacyFinding {
  /** Stable identifier for what this finding reports. Falls back to `options.defaultRule` when absent. */
  readonly rule?: string;
  /**
   * The legacy check's OWN severity vocabulary — never assumed to already
   * match the caller's target vocabulary. Translated through
   * `options.severityMap`; an absent value, or one `severityMap` does not
   * cover, falls back to `options.defaultSeverity`.
   */
  readonly severity?: string;
  /** Human-readable description of the problem. */
  readonly message: string;
  /**
   * An optional structured location a legacy check's own finding shape
   * carries (e.g. a JSON pointer or file path) that the adapted finding
   * shape below has no separate field for. When present, folded into
   * `message` as `"<path>: <message>"` rather than silently dropped.
   */
  readonly path?: string;
}

/**
 * What one legacy finding becomes: the same `{rule, severity, message}`
 * shape `GateResult`'s own findings already take elsewhere in this package
 * (see `./types.js`'s `PolicyCheckResult`, which carries exactly this
 * triple), parameterized over `TSeverity` so this module never has to
 * assume which severity vocabulary a given caller's own `Finding` type
 * uses.
 */
export interface AdaptedFinding<TSeverity> {
  readonly rule: string;
  readonly severity: TSeverity;
  readonly message: string;
}

/**
 * A legacy check's own outcome, already reduced by the caller to the three
 * verdict tags `GateResult` itself uses. This is the one normalization
 * every caller must do for itself — see this module's own header comment
 * for why that reduction cannot be generalized further here — but once
 * done, everything from this type onward is common shape this function
 * assembles for every caller identically.
 */
export type LegacyCheckResult<TReason extends string, TFinding extends LegacyFinding = LegacyFinding> =
  | { readonly verdict: "satisfied"; readonly evaluated?: number }
  | { readonly verdict: "violated"; readonly findings?: readonly TFinding[] }
  | { readonly verdict: "indeterminate"; readonly reason: TReason; readonly detail?: string };

export interface AdaptLegacyCheckResultOptions<TSeverity> {
  /**
   * The legacy check's own severity vocabulary, mapped onto whichever
   * severity type the caller's own `Finding` uses. Required to be supplied
   * by the caller — this package has no way to know what a legacy check
   * calls its own severities, or which severity vocabulary the caller's own
   * findings are meant to carry, and guessing either would be exactly the
   * kind of per-caller special-casing this module exists to avoid. A
   * finding whose `severity` is absent, or not a key of this map, falls
   * back to `defaultSeverity`.
   */
  readonly severityMap?: Readonly<Record<string, TSeverity>>;
  /**
   * Used for a finding with no `severity`, or one `severityMap` does not
   * cover. Required, not defaulted to a guessed value like `"high"` or
   * `"error"` — there is no severity value this module could pick that is
   * valid across every caller's own `TSeverity`, so the caller must state
   * what an unclassified legacy finding means in its own vocabulary.
   */
  readonly defaultSeverity: TSeverity;
  /** Used for a finding with no `rule`. Defaults to `"legacy-check-violation"`. */
  readonly defaultRule?: string;
  /**
   * Required, not defaulted. Used only when the legacy result reports
   * `"violated"` but supplies no findings at all — `gateViolated` itself
   * refuses to construct a violation with nothing wrong in it (see
   * `./result.js`), so *something* must stand in for "the underlying check
   * says this failed, but did not tell us why." A caller supplying its own
   * message here, rather than this module inventing a generic one, mirrors
   * `foldGateResults`'s own `options.emptyReason`: "what does it mean for
   * THIS check to violate with nothing wrong" is a fact only the caller's
   * own legacy check can name.
   */
  readonly fallbackMessage: string;
}

/**
 * Folds one legacy check's result onto this package's own `GateResult`.
 *
 * `"satisfied"` becomes `gateSatisfied(evaluated ?? 1)` — a legacy check
 * that never tracked a finer-grained evaluated count still gets a valid
 * `GateResult`, matching the same `evaluated: 1` convention this package
 * already uses for an equivalent single-question gate (see
 * `gateResultFromRatchet`'s own doc comment: "`evaluated: 1` names the
 * ratchet comparison itself as the one thing evaluated").
 *
 * `"violated"` maps every legacy finding through `severityMap`/
 * `defaultSeverity`/`defaultRule`, folding a legacy `path` into `message`,
 * and falls back to one finding built from `fallbackMessage` when the
 * legacy result supplied none.
 *
 * `"indeterminate"` passes `reason`/`detail` straight through to
 * `gateIndeterminate` — a legacy check's own indeterminate reason is
 * already the caller's own declared vocabulary, exactly what
 * `gateIndeterminate` expects, with nothing left to adapt.
 */
export function adaptLegacyCheckResult<TReason extends string, TSeverity, TFinding extends LegacyFinding = LegacyFinding>(
  legacy: LegacyCheckResult<TReason, TFinding>,
  options: AdaptLegacyCheckResultOptions<TSeverity>,
): GateResult<AdaptedFinding<TSeverity>, TReason> {
  switch (legacy.verdict) {
    case "satisfied":
      return gateSatisfied(legacy.evaluated ?? 1);
    case "violated": {
      const findings = (legacy.findings ?? []).map((finding) => toAdaptedFinding(finding, options));
      return gateViolated(
        findings.length > 0
          ? findings
          : [
              {
                rule: options.defaultRule ?? "legacy-check-violation",
                severity: options.defaultSeverity,
                message: options.fallbackMessage,
              },
            ],
      );
    }
    case "indeterminate":
      return gateIndeterminate(legacy.reason, legacy.detail);
    default: {
      const unhandled: never = legacy;
      throw new Error(`adaptLegacyCheckResult: unknown legacy verdict ${JSON.stringify(unhandled)}`);
    }
  }
}

function toAdaptedFinding<TSeverity>(
  finding: LegacyFinding,
  options: AdaptLegacyCheckResultOptions<TSeverity>,
): AdaptedFinding<TSeverity> {
  const mapped = finding.severity !== undefined ? options.severityMap?.[finding.severity] : undefined;
  const severity = mapped ?? options.defaultSeverity;
  const message = finding.path ? `${finding.path}: ${finding.message}` : finding.message;
  return {
    rule: finding.rule ?? options.defaultRule ?? "legacy-check-violation",
    severity,
    message,
  };
}
