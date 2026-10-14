/**
 * `checkTokenContrast` — the WCAG contrast gate: evaluates
 * `CONTRAST_PAIRS` (or a caller-supplied equivalent — see
 * `contrast-pairs.ts`'s own header, "HOW A CONSUMER ADDS A PAIR") against
 * a token registry, using `internal/resolve-token-value.ts` to follow
 * whole-value `var()` aliases to their real literal and `color.ts` to
 * compute the actual WCAG ratio. Pure (no I/O), mirrors `token-gate.ts`'s
 * `checkTokenPurity` shape deliberately: this package's OTHER gate checks
 * a completely different axis (does a styling literal in SOURCE CODE
 * trace back to a registered token?) — this one checks whether the
 * registry's OWN declared color pairs are legible at all. See the
 * `checkTokenPurity` doc comment for that axis; see this package's README
 * ("WCAG contrast gate") for the two side by side.
 *
 * ============================================================================
 * TWO BUCKETS, NOT ONE — `findings` vs. `unchecked`, mirroring
 * `TokenGateResult`'s own split
 * ============================================================================
 *
 * A pair that resolves cleanly but falls short of its `minimumRatio` is a
 * real, actionable WCAG violation: `findings`, rule `"below-threshold"`.
 *
 * A pair this function could not even EVALUATE — one of its tokens is
 * missing from the registry, resolving it hit an alias cycle, or the
 * resolved value is not a color `color.ts` can parse — is a DIFFERENT
 * kind of problem: not "this pair fails WCAG", but "this pair was never
 * actually checked". Collapsing that into `findings` would make a broken
 * registry indistinguishable from a real contrast failure; collapsing it
 * into silence would be exactly the "a gate that passes because it
 * checked nothing" defect this repository holds every gate CLI to account
 * for by name (see the "Gate CLIs exit 0/1/2" contract this package's own
 * `cli.ts` and `token-gate.ts` already follow). So it gets its own list,
 * `unchecked`, the same shape
 * `checkTokenPurity`'s own `unchecked` and `checkBrandFileCoverage`'s own
 * `unchecked` already use — and `contrast-cli.ts` gives it the same
 * weight: a non-empty `unchecked` always means exit `2`, never a silent
 * `0` or a same-severity `1` next to a real threshold failure.
 *
 * ============================================================================
 * A THIRD OUTCOME FOR A BELOW-THRESHOLD RATIO — `relieved`, and why a
 * relief that CLEARS is a finding too
 * ============================================================================
 *
 * A pair whose ratio falls short of `minimumRatio` is not automatically a
 * `"below-threshold"` finding: if the pair carries a valid `exception`
 * (see `contrast-pairs.ts`'s own header, "EXCEPTIONS" — a real WCAG
 * clause, a real compensating mechanism, and a real rationale, all
 * non-blank), the miss is legitimate, documented relief. That goes on
 * `relieved`, a THIRD bucket alongside `findings`/`unchecked` — visible in
 * every report (never silently hidden the way excluding the pair
 * entirely would hide it), but not a failure.
 *
 * The reverse direction is what keeps this from becoming a rubber stamp:
 * a pair that carries a valid `exception` but whose ratio actually
 * CLEARS `minimumRatio` anyway is a DIFFERENT real finding
 * (`"stale-exception"`) — the relief it claims is no longer needed, and a
 * stale claim left in the policy is exactly how an exception silently
 * outlives the condition that justified it: nothing else would ever
 * prompt its removal. This is the bidirectional check
 * `contrast.test.ts`'s own `WARN_SLOTS_BY_THEME` sweep already performs
 * (`toBeLessThan` for a WARN slot, `toBeGreaterThanOrEqual` for every
 * other), ported here as gate policy rather than left as a test-only
 * assertion.
 *
 * An `exception` present but missing/blank ANY of its three required
 * fields is ALSO a real finding (`"invalid-exception"`) — checked FIRST,
 * before the ratio comparison, and regardless of what the ratio turns out
 * to be: an unjustified exception is a defect in the POLICY DATA itself,
 * independent of whether this particular run happens to need the relief.
 *
 * ============================================================================
 * FAILS CLOSED ON AN EMPTY RUN
 * ============================================================================
 *
 * `ok` is `true` only when at least one pair was actually evaluated
 * (`pairsChecked > 0`) AND every pair resolved AND every resolved pair met
 * its threshold (directly, or via a valid, still-applicable exception).
 * `pairsChecked` is `pairs.length`, always populated — even when it's `0`
 * — so a caller can tell "checked nothing" apart from "checked everything
 * and it was clean" without inspecting `findings`/`unchecked` first, the
 * same discipline `checkBrandFileCoverage`'s `declarationsChecked` holds
 * to. An EMPTY `tokens` registry is treated as the same degenerate case as
 * an empty `pairs` list — see `reason: "nothing-to-check"` below — rather
 * than walking every pair only to report N identical "registry is empty"
 * `unchecked` entries.
 */

import type { TokenDefinition } from "./tokens.js";
import { TOKENS } from "./tokens.js";
import { colorAlpha, contrastRatio, contrastRatioEncodedBlend } from "./color.js";
import { resolveTokenValue } from "./internal/resolve-token-value.js";
import type { ContrastException, ContrastPair } from "./contrast-pairs.js";

export type ContrastGateFindingRule = "below-threshold" | "stale-exception" | "invalid-exception";

export interface ContrastGateFinding {
  rule: ContrastGateFindingRule;
  pairId: string;
  ratio: number;
  minimumRatio: number;
  message: string;
}

/**
 * A pair whose ratio stayed below `minimumRatio` under a valid, currently
 * applicable `exception` — legitimate, documented relief, not a finding.
 * See this file's header, "A THIRD OUTCOME FOR A BELOW-THRESHOLD RATIO".
 */
export interface ContrastGateRelieved {
  pairId: string;
  ratio: number;
  minimumRatio: number;
  exception: ContrastException;
}

/**
 * Why one pair could not be evaluated at all — see this file's header,
 * "TWO BUCKETS, NOT ONE".
 */
export type ContrastGateUncheckedReason = "unresolvable-token" | "cyclic-alias" | "unparseable-color-value";

export interface ContrastGateUnchecked {
  pairId: string;
  reason: ContrastGateUncheckedReason;
  detail: string;
}

export type ContrastGateFailureReason = "nothing-to-check" | "contrast-gap";

export interface ContrastGateResult {
  ok: boolean;
  /** `pairs.length` as handed to this function — always populated, including `0`. See this file's header, "FAILS CLOSED ON AN EMPTY RUN". */
  pairsChecked: number;
  findings: ContrastGateFinding[];
  /** See this file's header, "A THIRD OUTCOME FOR A BELOW-THRESHOLD RATIO" — legitimate, documented relief. Never affects `ok`. */
  relieved: ContrastGateRelieved[];
  unchecked: ContrastGateUnchecked[];
  /** Present exactly when `ok` is `false`. */
  reason?: ContrastGateFailureReason;
}

export interface ContrastGateCheckOptions {
  /**
   * The token registry to resolve pairs against. Defaults to this
   * package's own `TOKENS` (light-mode values only — see
   * `internal/registry-from-css.ts`'s header for how `contrast-cli.ts`
   * builds a dark-mode registry from the real shipped `styles/tokens.css`
   * to check both themes). Exposed as an option, not hardwired, for the
   * same reason `checkBrandFileCoverage`'s own `options.tokens` is: a test
   * can substitute a small fixture registry, and a caller checking a
   * forked or dark-mode registry is not blocked from doing so.
   */
  tokens?: Readonly<Record<string, TokenDefinition>>;
}

function resolveOrReport(
  property: string,
  tokens: Readonly<Record<string, TokenDefinition>>,
  pairId: string,
  role: string,
  unchecked: ContrastGateUnchecked[],
): string | undefined {
  const resolved = resolveTokenValue(property, tokens);
  if (resolved.cycle !== undefined) {
    unchecked.push({
      pairId,
      reason: "cyclic-alias",
      detail: `resolving ${role} "${property}" hit an alias cycle: ${resolved.chain.join(" -> ")} -> ${resolved.cycle} (repeats)`,
    });
    return undefined;
  }
  if (resolved.missingProperty !== undefined) {
    unchecked.push({
      pairId,
      reason: "unresolvable-token",
      detail: `resolving ${role} "${property}" reached "${resolved.missingProperty}", which has no entry in the checked registry: ${resolved.chain.join(" -> ")}`,
    });
    return undefined;
  }
  return resolved.value;
}

/**
 * `true` only when EVERY one of `ContrastException`'s three required
 * fields is present and non-blank. Checked at the STRING level, not just
 * "is the property set" — `exception: { wcagClause: "", ... }` is exactly
 * as unjustified as `exception` being absent, and a caller who trims a
 * field down to whitespace while editing should not get a silent pass.
 * See `contrast-pairs.ts`'s own header, "EXCEPTIONS", for why an
 * unjustified exception must itself be a finding rather than accepted or
 * silently ignored.
 */
function exceptionIsValid(exception: ContrastException | undefined): exception is ContrastException {
  if (exception === undefined) return false;
  return (
    exception.wcagClause.trim().length > 0 &&
    exception.compensatingMechanism.trim().length > 0 &&
    exception.rationale.trim().length > 0
  );
}

const BACKDROP_WHITE = "oklch(1 0 0)";
const BACKDROP_BLACK = "oklch(0 0 0)";

/**
 * Over a literal backdrop (arbitrary page content), whether SOME opaque
 * backdrop makes the opaque foreground `fg` and the plate `bg` composited
 * over it equally light, under either blend the gate scores: then the true
 * minimum contrast over all backdrops is 1:1, whatever the two extremes
 * measure.
 *
 * Why the extremes alone do not bound it: contrast against a fixed `fg` is
 * not monotonic in the backdrop. The plate composited over a backdrop `b`
 * has a luminance that rises with every channel of `b`, in linear light
 * (`a*plate + (1-a)*b`) and in the gamma-encoded blend alike, so over all
 * of sRGB it sweeps exactly the interval from the plate over black to the
 * plate over white. Contrast is `(Lmax + 0.05) / (Lmin + 0.05)`, so against
 * a fixed foreground luminance `Lf` it falls toward `Lf` and rises past it.
 * If `Lf` lies outside that interval, the minimum is at the nearer extreme,
 * which the white and black pairs already score. If `Lf` lies inside it,
 * some backdrop lands exactly on `Lf` and the minimum is 1:1. This is the
 * second case, detected as the foreground being lighter than the plate over
 * one extreme and not lighter over the other.
 *
 * Lightness is compared through each blend's ratio against opaque black:
 * black's luminance is 0, so `(L + 0.05) / 0.05` orders composited
 * luminances exactly, without reimplementing either blend here.
 */
function backdropCanMatchForeground(fg: string, bg: string): boolean {
  for (const ratioOf of [contrastRatio, contrastRatioEncodedBlend]) {
    const foreground = ratioOf(fg, BACKDROP_BLACK);
    const overWhite = foreground - ratioOf(bg, BACKDROP_BLACK, BACKDROP_WHITE);
    const overBlack = foreground - ratioOf(bg, BACKDROP_BLACK, BACKDROP_BLACK);
    if (overWhite * overBlack <= 0) return true;
  }
  return false;
}

/**
 * Evaluates `pairs` against `options.tokens` (defaults to this package's
 * real `TOKENS`). Never throws — every decline path (a missing token, a
 * cyclic alias, a color `color.ts` cannot parse) is reported on the
 * returned `ContrastGateResult.unchecked`, and a real threshold miss is
 * reported on `.findings` — UNLESS the pair carries a valid `exception`
 * AND the ratio still needs it, in which case it lands on `.relieved`
 * instead (see this file's header, "A THIRD OUTCOME FOR A BELOW-THRESHOLD
 * RATIO"). Nothing is ever silently skipped.
 */
export function checkTokenContrast(
  pairs: readonly ContrastPair[],
  options: ContrastGateCheckOptions = {},
): ContrastGateResult {
  const tokens = options.tokens ?? TOKENS;
  const pairsChecked = pairs.length;
  const findings: ContrastGateFinding[] = [];
  const relieved: ContrastGateRelieved[] = [];
  const unchecked: ContrastGateUnchecked[] = [];

  // Same degenerate case `checkBrandFileCoverage` names "nothing-to-check":
  // zero pairs, or a registry with nothing in it to resolve against. Return
  // early rather than walking every pair only to produce N identical
  // "registry is empty" unchecked entries that would bury the real signal
  // (there was nothing to check) under noise that looks like N separate
  // findings.
  if (pairsChecked === 0 || Object.keys(tokens).length === 0) {
    return { ok: false, pairsChecked, findings, relieved, unchecked, reason: "nothing-to-check" };
  }

  for (const pair of pairs) {
    const fg = resolveOrReport(pair.foreground, tokens, pair.id, "foreground", unchecked);
    const bg = resolveOrReport(pair.background, tokens, pair.id, "background", unchecked);
    // A `compositeOver` that is not a custom property is a literal backdrop
    // color (the white and black extremes a glass pair is checked over),
    // parsed here before any ratio is computed. A literal that does not
    // parse, or that is translucent (compositing reads a backdrop's color
    // and would silently drop its alpha), lands on `unchecked` as
    // "unparseable-color-value" rather than being scored.
    const literalBackdrop = pair.compositeOver !== undefined && !pair.compositeOver.startsWith("--");
    let literalRefused = false;
    if (literalBackdrop) {
      const alpha = colorAlpha(pair.compositeOver as string);
      if (alpha === undefined || alpha < 1) {
        literalRefused = true;
        unchecked.push({
          pairId: pair.id,
          reason: "unparseable-color-value",
          detail:
            alpha === undefined
              ? `literal compositeOver "${pair.compositeOver}" is neither oklch(...) nor a 6-digit hex color`
              : `literal compositeOver "${pair.compositeOver}" is translucent (alpha ${alpha}); a literal backdrop must be opaque`,
        });
      }
    }
    const over =
      pair.compositeOver === undefined
        ? undefined
        : pair.compositeOver.startsWith("--")
          ? resolveOrReport(pair.compositeOver, tokens, pair.id, "compositeOver", unchecked)
          : pair.compositeOver;
    if (
      fg === undefined ||
      bg === undefined ||
      (pair.compositeOver !== undefined && over === undefined) ||
      literalRefused
    ) {
      continue; // already reported to `unchecked` above
    }

    // Over a literal backdrop the foreground must be opaque: a translucent
    // ink would take on the backdrop's color too, and the extremes check
    // below (`backdropCanMatchForeground`) bounds every backdrop only for an
    // ink of fixed luminance. Refused as unchecked, never scored on the
    // extremes alone.
    if (literalBackdrop) {
      const fgAlpha = colorAlpha(fg);
      if (fgAlpha !== undefined && fgAlpha < 1) {
        unchecked.push({
          pairId: pair.id,
          reason: "unparseable-color-value",
          detail: `foreground "${pair.foreground}" resolves to translucent "${fg}" (alpha ${fgAlpha}); over a literal backdrop the foreground must be opaque`,
        });
        continue;
      }
    }

    let ratio: number;
    // Set when some backdrop between the literal extremes makes the plate
    // exactly as light as the ink: the pair's true minimum is then 1:1.
    let backdropMatchesForeground = false;
    try {
      // Over a literal backdrop (arbitrary page content), score the pair
      // with translucent values blended both in linear light and in
      // gamma-encoded sRGB (how browsers paint alpha) and keep the lower
      // ratio: neither space is stricter for every ink/plate polarity.
      // Token backdrops keep the linear blend alone.
      // A literal backdrop stands for any page content, so the pair also
      // fails at 1:1 when an intermediate backdrop can match the ink (see
      // `backdropCanMatchForeground`); otherwise the listed extreme's ratio
      // is reported unchanged.
      ratio = literalBackdrop
        ? Math.min(contrastRatio(fg, bg, over), contrastRatioEncodedBlend(fg, bg, over))
        : contrastRatio(fg, bg, over);
      if (literalBackdrop && backdropCanMatchForeground(fg, bg)) {
        backdropMatchesForeground = true;
        ratio = 1;
      }
    } catch (error) {
      unchecked.push({
        pairId: pair.id,
        reason: "unparseable-color-value",
        detail: `contrastRatio("${fg}", "${bg}"${over !== undefined ? `, "${over}"` : ""}) threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    // An exception is validated FIRST, and unconditionally — an
    // unjustified exception is a defect in the POLICY DATA itself, not
    // something the measured ratio can excuse either way. See this
    // file's header, "A THIRD OUTCOME FOR A BELOW-THRESHOLD RATIO".
    if (pair.exception !== undefined && !exceptionIsValid(pair.exception)) {
      findings.push({
        rule: "invalid-exception",
        pairId: pair.id,
        ratio,
        minimumRatio: pair.minimumRatio,
        message: `"${pair.id}" carries an exception missing a required justification field (wcagClause/compensatingMechanism/rationale must all be non-blank) — an unjustified exception is treated as a finding, not a silent pass. Measured ${ratio.toFixed(2)}:1 against a ${pair.minimumRatio}:1 minimum.`,
      });
      continue;
    }

    const hasValidException = exceptionIsValid(pair.exception);

    if (ratio < pair.minimumRatio) {
      if (hasValidException) {
        relieved.push({ pairId: pair.id, ratio, minimumRatio: pair.minimumRatio, exception: pair.exception as ContrastException });
      } else {
        findings.push({
          rule: "below-threshold",
          pairId: pair.id,
          ratio,
          minimumRatio: pair.minimumRatio,
          message: backdropMatchesForeground
            ? `"${pair.id}" measures 1.00:1 over an intermediate backdrop: the foreground's luminance lies between the plate over black and the plate over white, so some page content makes the plate exactly as light as the foreground. Below its ${pair.level} minimum of ${pair.minimumRatio}:1 — ${pair.description}`
            : `"${pair.id}" measures ${ratio.toFixed(2)}:1, below its ${pair.level} minimum of ${pair.minimumRatio}:1 — ${pair.description}`,
        });
      }
    } else if (hasValidException) {
      // The pair CLEARS its floor while still claiming relief it no
      // longer needs — a stale exception, and a real finding of its own
      // kind: see this file's header for why this direction matters as
      // much as the first.
      findings.push({
        rule: "stale-exception",
        pairId: pair.id,
        ratio,
        minimumRatio: pair.minimumRatio,
        message: `"${pair.id}" measures ${ratio.toFixed(2)}:1, which already meets its ${pair.level} minimum of ${pair.minimumRatio}:1 — its documented exception ("${(pair.exception as ContrastException).rationale}") is stale and should be removed from the policy.`,
      });
    }
  }

  const ok = findings.length === 0 && unchecked.length === 0;
  return { ok, pairsChecked, findings, relieved, unchecked, reason: ok ? undefined : "contrast-gap" };
}
