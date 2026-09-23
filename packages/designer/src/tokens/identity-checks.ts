/**
 * Identity kit checks — #1210's judgment half. `identity-kit.ts` defines
 * what a direction's seven variants ARE; this module judges whether each
 * one is fit to ship, the same "package owns judgment, every check's
 * satisfied/violated/indeterminate verdict" split #1187's "who does
 * what" table draws for every role in this repository.
 *
 * FOUR CHECKS, per #1210's own list ("Checks: contrast, minimum size,
 * clear space, and single-colour legibility"):
 *
 *   - `checkIdentityContrast` — reuses `color.ts`'s real WCAG contrast
 *     math (`contrastRatio`), the same implementation `contrast-gate.ts`
 *     is built on, against the ink/surface and accent/onAccent pairs a
 *     shipped identity kit actually composites.
 *   - `checkMinimumSize` — a declared-geometry PROXY, not a rendered
 *     measurement: this package does not rasterize, so "minimum size"
 *     is approximated as the finest `stroke-width` in a variant's markup
 *     relative to its own `viewBox`. A mark whose finest stroke is too
 *     thin a sliver of its own bounding box will visibly disappear once
 *     scaled down to favicon size; this is the auditable signal that
 *     stands in for actually rendering it at 16px and looking.
 *   - `checkClearSpace` — reads the `data-clear-space` ratio
 *     `identity-kit.ts` declares on every root `<svg>` it emits. Same
 *     "declared, not measured" honesty as minimum size.
 *   - `checkSingleColourLegibility` — a structural check that the `mono`
 *     variant paints through `currentColor` alone, with no other
 *     explicit `fill`/`stroke` colour literal left over from generation
 *     or adoption.
 *
 * THREE-STATE VERDICTS, EVERYWHERE — mirroring every other gate in this
 * repository (`checkTokenContrast`'s `unchecked`, `checkFactsTraceability`'s
 * exit code 2): a check that could not actually evaluate its input
 * (no `viewBox` found, no `data-clear-space` declared at all) reports
 * `indeterminate`, never a silent `satisfied`. Passing because nothing
 * was checked is exactly the failure mode this repository's other gates
 * are built to refuse, and this one is no different.
 */

import { contrastRatio } from "./color.js";
import type { IdentityDirection, IdentityTokenInput, IdentityVariantSet } from "./identity-kit.js";

export const IDENTITY_MIN_CONTRAST = 3; // WCAG 1.4.11 non-text contrast floor — a logo is a graphical object, not body text.
const MIN_STROKE_VIEWBOX_RATIO = 0.03;
const MIN_CLEAR_SPACE_RATIO = 0.15;

export type IdentityVerdict = "satisfied" | "violated" | "indeterminate";
export type IdentityCheckId = "contrast" | "minimum-size" | "clear-space" | "single-colour-legibility";

// -----------------------------------------------------------------------
// Contrast
// -----------------------------------------------------------------------

export type IdentityContrastVariant = "primary" | "mark" | "dark" | "appIcon";

export interface IdentityContrastFinding {
  variant: IdentityContrastVariant;
  ratio: number;
  message: string;
}

export interface IdentityContrastResult {
  ok: boolean;
  indeterminate: boolean;
  findings: IdentityContrastFinding[];
  checked: { variant: IdentityContrastVariant; ratio: number }[];
}

/**
 * Checks the four foreground/background pairs a shipped identity kit
 * actually composites: `primary`/`mark` (ink on the light surface),
 * `dark` (inverse ink on the dark surface), and `appIcon` (the badge
 * glyph on its own accent background). `light`/`mono`/`favicon` are not
 * separately checked here — they share `primary`'s ink-on-light pairing
 * (`mono`/`favicon` via `currentColor`, resolved by whatever surface a
 * consumer places them on, which this package cannot know in advance).
 */
export function checkIdentityContrast(tokens: IdentityTokenInput): IdentityContrastResult {
  const pairs: [IdentityContrastVariant, string, string][] = [
    ["primary", tokens.ink, tokens.surfaceBase],
    ["mark", tokens.ink, tokens.surfaceBase],
    ["dark", tokens.onInverse, tokens.surfaceInverse],
    ["appIcon", tokens.onAccent, tokens.accent],
  ];

  const findings: IdentityContrastFinding[] = [];
  const checked: { variant: IdentityContrastVariant; ratio: number }[] = [];
  let unresolvable = 0;

  for (const [variant, fg, bg] of pairs) {
    let ratio: number;
    try {
      ratio = contrastRatio(fg, bg);
    } catch (error) {
      unresolvable++;
      findings.push({ variant, ratio: Number.NaN, message: `could not compute contrast for "${variant}": ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    checked.push({ variant, ratio });
    if (ratio < IDENTITY_MIN_CONTRAST) {
      findings.push({ variant, ratio, message: `"${variant}" contrast ${ratio.toFixed(2)}:1 is below the ${IDENTITY_MIN_CONTRAST}:1 floor` });
    }
  }

  const indeterminate = unresolvable > 0 || checked.length === 0;
  return { ok: !indeterminate && findings.length === 0, indeterminate, findings, checked };
}

// -----------------------------------------------------------------------
// Minimum size
// -----------------------------------------------------------------------

export interface MinimumSizeResult {
  ok: boolean;
  indeterminate: boolean;
  reason?: string;
  ratio?: number;
}

function parseViewBoxMinSide(svg: string): number | undefined {
  const match = svg.match(/viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return Math.min(width, height);
}

function smallestStrokeWidth(svg: string): number | undefined {
  const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  if (widths.length === 0) return undefined;
  return Math.min(...widths);
}

/**
 * `svg`'s finest declared `stroke-width` as a fraction of its own
 * `viewBox`'s shorter side, checked against `minRatio`. See this
 * module's header for why this is a declared-geometry proxy, not a
 * rendered measurement.
 */
export function checkMinimumSize(svg: string, minRatio: number = MIN_STROKE_VIEWBOX_RATIO): MinimumSizeResult {
  const viewBoxSide = parseViewBoxMinSide(svg);
  if (viewBoxSide === undefined || viewBoxSide <= 0) {
    return { ok: false, indeterminate: true, reason: "no usable viewBox found on the root <svg> — could not evaluate" };
  }
  const stroke = smallestStrokeWidth(svg);
  if (stroke === undefined) {
    return { ok: false, indeterminate: true, reason: "no stroke-width found to measure against the viewBox — could not evaluate" };
  }
  const ratio = stroke / viewBoxSide;
  if (ratio < minRatio) {
    return {
      ok: false,
      indeterminate: false,
      reason: `finest stroke-width ${stroke} is ${(ratio * 100).toFixed(1)}% of the ${viewBoxSide} viewBox side, below the ${(minRatio * 100).toFixed(0)}% legibility floor`,
      ratio,
    };
  }
  return { ok: true, indeterminate: false, ratio };
}

// -----------------------------------------------------------------------
// Clear space
// -----------------------------------------------------------------------

export interface ClearSpaceResult {
  ok: boolean;
  indeterminate: boolean;
  reason?: string;
  declared?: number;
}

/** Reads the `data-clear-space` ratio `identity-kit.ts` declares on every root `<svg>` it emits, and checks it against `minRatio`. */
export function checkClearSpace(svg: string, minRatio: number = MIN_CLEAR_SPACE_RATIO): ClearSpaceResult {
  const match = svg.match(/data-clear-space="([^"]*)"/);
  if (!match) {
    return { ok: false, indeterminate: true, reason: "no data-clear-space declared on the root <svg> — could not evaluate" };
  }
  const declared = Number(match[1]);
  if (!Number.isFinite(declared)) {
    return { ok: false, indeterminate: true, reason: `data-clear-space="${match[1]}" is not a finite number — could not evaluate` };
  }
  if (declared < minRatio) {
    return { ok: false, indeterminate: false, reason: `declared clear space ${declared} is below the ${minRatio} minimum`, declared };
  }
  return { ok: true, indeterminate: false, declared };
}

// -----------------------------------------------------------------------
// Single-colour legibility
// -----------------------------------------------------------------------

export interface SingleColourLegibilityResult {
  ok: boolean;
  offendingColors: string[];
  reason?: string;
}

const FILL_STROKE_ATTR_RE = /\b(?:fill|stroke)="([^"]*)"/g;

/** Checks that `svg` (the `mono` variant) paints only through `currentColor` — no explicit colour literal left over. */
export function checkSingleColourLegibility(svg: string): SingleColourLegibilityResult {
  const offending = new Set<string>();
  for (const match of svg.matchAll(FILL_STROKE_ATTR_RE)) {
    const value = match[1] ?? "";
    if (value === "" || value === "none" || value === "transparent" || value === "currentColor") continue;
    offending.add(value);
  }
  if (offending.size > 0) {
    const offendingColors = [...offending];
    return { ok: false, offendingColors, reason: `mono variant references ${offendingColors.length} explicit colour(s) besides currentColor: ${offendingColors.join(", ")}` };
  }
  return { ok: true, offendingColors: [] };
}

// -----------------------------------------------------------------------
// Judgement
// -----------------------------------------------------------------------

export interface IdentityCheckJudgement {
  verdict: IdentityVerdict;
  detail: string;
}

export interface IdentityKitJudgement {
  direction: string;
  checks: Record<IdentityCheckId, IdentityCheckJudgement>;
  ok: boolean;
}

function verdictOf(indeterminate: boolean, ok: boolean): IdentityVerdict {
  if (indeterminate) return "indeterminate";
  return ok ? "satisfied" : "violated";
}

/**
 * Runs all four checks against one {@link IdentityDirection} and returns
 * a per-check verdict plus an overall `ok`, `true` only when every check
 * is `satisfied` — an `indeterminate` check never counts as a pass.
 */
export function judgeIdentityKit(direction: IdentityDirection, tokens: IdentityTokenInput): IdentityKitJudgement {
  const { variants } = direction;
  const contrast = checkIdentityContrast(tokens);
  const minimumSize = checkMinimumSize(variants.mark);
  const clearSpace = checkClearSpace(variants.primary);
  const singleColour = checkSingleColourLegibility(variants.mono);

  const checkVerdicts: Record<IdentityCheckId, IdentityCheckJudgement> = {
    contrast: {
      verdict: verdictOf(contrast.indeterminate, contrast.ok),
      detail: contrast.findings.length > 0 ? contrast.findings.map((f) => f.message).join("; ") : `${contrast.checked.length} pair(s) checked, all >= ${IDENTITY_MIN_CONTRAST}:1`,
    },
    "minimum-size": {
      verdict: verdictOf(minimumSize.indeterminate, minimumSize.ok),
      detail: minimumSize.reason ?? `finest stroke is ${((minimumSize.ratio ?? 0) * 100).toFixed(1)}% of the viewBox`,
    },
    "clear-space": {
      verdict: verdictOf(clearSpace.indeterminate, clearSpace.ok),
      detail: clearSpace.reason ?? `declared clear space ${clearSpace.declared}`,
    },
    "single-colour-legibility": {
      verdict: verdictOf(false, singleColour.ok),
      detail: singleColour.reason ?? "mono variant uses currentColor only",
    },
  };

  const ok = Object.values(checkVerdicts).every((c) => c.verdict === "satisfied");
  return { direction: direction.id, checks: checkVerdicts, ok };
}

/** Exported for callers building a report over a variant set without a full {@link IdentityDirection} wrapper. */
export type { IdentityVariantSet };
