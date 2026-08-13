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
 * FAILS CLOSED ON AN EMPTY RUN
 * ============================================================================
 *
 * `ok` is `true` only when at least one pair was actually evaluated
 * (`pairsChecked > 0`) AND every pair resolved AND every resolved pair met
 * its threshold. `pairsChecked` is `pairs.length`, always populated — even
 * when it's `0` — so a caller can tell "checked nothing" apart from
 * "checked everything and it was clean" without inspecting `findings`/
 * `unchecked` first, the same discipline `checkBrandFileCoverage`'s
 * `declarationsChecked` holds to. An EMPTY `tokens` registry is treated as
 * the same degenerate case as an empty `pairs` list — see `reason:
 * "nothing-to-check"` below — rather than walking every pair only to
 * report N identical "registry is empty" `unchecked` entries.
 */

import type { TokenDefinition } from "./tokens.js";
import { TOKENS } from "./tokens.js";
import { contrastRatio } from "./color.js";
import { resolveTokenValue } from "./internal/resolve-token-value.js";
import type { ContrastPair } from "./contrast-pairs.js";

export type ContrastGateFindingRule = "below-threshold";

export interface ContrastGateFinding {
  rule: ContrastGateFindingRule;
  pairId: string;
  ratio: number;
  minimumRatio: number;
  message: string;
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
 * Evaluates `pairs` against `options.tokens` (defaults to this package's
 * real `TOKENS`). Never throws — every decline path (a missing token, a
 * cyclic alias, a color `color.ts` cannot parse) is reported on the
 * returned `ContrastGateResult.unchecked`, and a real threshold miss is
 * reported on `.findings`; nothing is ever silently skipped. See this
 * file's header for the full split.
 */
export function checkTokenContrast(
  pairs: readonly ContrastPair[],
  options: ContrastGateCheckOptions = {},
): ContrastGateResult {
  const tokens = options.tokens ?? TOKENS;
  const pairsChecked = pairs.length;
  const findings: ContrastGateFinding[] = [];
  const unchecked: ContrastGateUnchecked[] = [];

  // Same degenerate case `checkBrandFileCoverage` names "nothing-to-check":
  // zero pairs, or a registry with nothing in it to resolve against. Return
  // early rather than walking every pair only to produce N identical
  // "registry is empty" unchecked entries that would bury the real signal
  // (there was nothing to check) under noise that looks like N separate
  // findings.
  if (pairsChecked === 0 || Object.keys(tokens).length === 0) {
    return { ok: false, pairsChecked, findings, unchecked, reason: "nothing-to-check" };
  }

  for (const pair of pairs) {
    const fg = resolveOrReport(pair.foreground, tokens, pair.id, "foreground", unchecked);
    const bg = resolveOrReport(pair.background, tokens, pair.id, "background", unchecked);
    const over =
      pair.compositeOver !== undefined ? resolveOrReport(pair.compositeOver, tokens, pair.id, "compositeOver", unchecked) : undefined;
    if (fg === undefined || bg === undefined || (pair.compositeOver !== undefined && over === undefined)) {
      continue; // already reported to `unchecked` above
    }

    let ratio: number;
    try {
      ratio = contrastRatio(fg, bg, over);
    } catch (error) {
      unchecked.push({
        pairId: pair.id,
        reason: "unparseable-color-value",
        detail: `contrastRatio("${fg}", "${bg}"${over !== undefined ? `, "${over}"` : ""}) threw: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (ratio < pair.minimumRatio) {
      findings.push({
        rule: "below-threshold",
        pairId: pair.id,
        ratio,
        minimumRatio: pair.minimumRatio,
        message: `"${pair.id}" measures ${ratio.toFixed(2)}:1, below its ${pair.level} minimum of ${pair.minimumRatio}:1 — ${pair.description}`,
      });
    }
  }

  const ok = findings.length === 0 && unchecked.length === 0;
  return { ok, pairsChecked, findings, unchecked, reason: ok ? undefined : "contrast-gap" };
}
