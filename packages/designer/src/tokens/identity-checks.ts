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
import type { IdentityDirection, IdentityDirectionKind, IdentityTokenInput, IdentityVariantSet } from "./identity-kit.js";

export const IDENTITY_MIN_CONTRAST = 3; // WCAG 1.4.11 non-text contrast floor — a logo is a graphical object, not body text.
const MIN_STROKE_VIEWBOX_RATIO = 0.03;
const MIN_CLEAR_SPACE_RATIO = 0.15;

/**
 * The verdict vocabulary, machine for machine, the repository contract
 * docs/contracts/check-output-envelope.json's own `verdicts` (issue
 * #1174/#1190; that contract does not ship with this package). This module
 * does not declare a second, independently-invented ternary here — see this
 * package's own `check-output-envelope.test.ts` (also not shipped; a
 * dev-only test), whose contract-sync test reads that file directly and
 * fails if this union and its own `verdicts` array ever diverge.
 */
export type IdentityVerdict = "satisfied" | "violated" | "indeterminate";
export type IdentityCheckId = "contrast" | "minimum-size" | "clear-space" | "single-colour-legibility";

/**
 * One reportable problem, in exactly the shape the repository contract
 * docs/contracts/check-output-envelope.json's `findingShape` declares (that
 * contract does not ship with this package): `rule` (stable machine id,
 * here always the {@link IdentityCheckId} that produced it), `severity`,
 * `message` (human-readable), and an optional `path` naming the variant the
 * finding is about. Every finding this module produces is `severity:
 * "error"` — an identity kit is judged, not merely advised.
 */
export interface IdentityFinding {
  readonly rule: IdentityCheckId;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

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
 * Matches a `fill`/`stroke` PAINT ATTRIBUTE — double- or single-quoted,
 * with or without whitespace around `=` — while excluding a differently
 * named attribute that merely ends in "fill"/"stroke" (`data-fill`,
 * `overflow`) via the negative lookbehind: a real attribute name is
 * always preceded by whitespace, a quote, or the start of the tag, never
 * by a word character or hyphen. Shared, identically, by
 * `checkSingleColourLegibility` below and `identity-kit.ts`'s
 * `recolorSvg` — both used to match only the double-quoted, unspaced form
 * (`/\b(?:fill|stroke)="([^"]*)"/g`), which silently missed a
 * single-quoted or spaced attribute (`fill = '#fff'`) and could match
 * `data-fill` through `\b`'s hyphen-is-a-boundary behaviour.
 */
const PAINT_ATTR_RE = /(?<![\w-])(?:fill|stroke)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Every distinct, explicit `fill`/`stroke` colour literal `svg` actually
 * paints with — `none`/`transparent`/empty/`currentColor` excluded, since
 * none of those is an "actual rendered colour" a contrast ratio can be
 * computed against on their own. Scans the WHOLE document, not just the
 * root tag: unlike `viewBox`/`data-clear-space` (declared root metadata,
 * see `rootStartTag`), the colour that actually renders can come from any
 * nested element.
 */
function extractRenderedColors(svg: string): readonly string[] {
  const colors = new Set<string>();
  for (const match of svg.matchAll(PAINT_ATTR_RE)) {
    const value = match[2] ?? match[3] ?? "";
    if (value === "" || value === "none" || value === "transparent" || value === "currentColor") continue;
    colors.add(value);
  }
  return [...colors];
}

/**
 * Checks the four foreground/background pairs a shipped identity kit
 * actually composites: `primary`/`mark` (ink on the light surface),
 * `dark` (inverse ink on the dark surface), and `appIcon` (the badge
 * glyph on its own accent background). `light`/`mono`/`favicon` are not
 * separately checked here — they share `primary`'s ink-on-light pairing
 * (`mono`/`favicon` via `currentColor`, resolved by whatever surface a
 * consumer places them on, which this package cannot know in advance).
 *
 * For a GENERATED direction, `primary`/`mark` are drawn via `currentColor`
 * under a `color:` style set to `tokens.ink` — `tokens.ink` genuinely IS
 * their rendered colour, so checking it against `tokens.surfaceBase` is
 * correct. For an ADOPTED direction, `primary`/`mark` are the supplied
 * SVG's OWN colours, unchanged — `tokens.ink` is never even written into
 * that markup, so certifying contrast against it would certify the wrong
 * colour entirely. `variants`/`kind` (not just `tokens`) are therefore
 * required: an adopted `primary`/`mark`'s every distinct explicit
 * fill/stroke colour ({@link extractRenderedColors}) is checked against
 * `tokens.surfaceBase` instead, and a mark with no explicit colour at all
 * (paints only through inherited `currentColor`, so its real rendered
 * colour depends on wherever a consumer places it) is `indeterminate` —
 * fails closed, never silently `satisfied`.
 */
export function checkIdentityContrast(kind: IdentityDirectionKind, variants: IdentityVariantSet, tokens: IdentityTokenInput): IdentityContrastResult {
  const findings: IdentityContrastFinding[] = [];
  const checked: { variant: IdentityContrastVariant; ratio: number }[] = [];
  let unresolvable = 0;

  function checkPair(variant: IdentityContrastVariant, fg: string, bg: string): void {
    let ratio: number;
    try {
      ratio = contrastRatio(fg, bg);
    } catch (error) {
      unresolvable++;
      findings.push({ variant, ratio: Number.NaN, message: `could not compute contrast for "${variant}": ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    checked.push({ variant, ratio });
    if (ratio < IDENTITY_MIN_CONTRAST) {
      findings.push({ variant, ratio, message: `"${variant}" contrast ${ratio.toFixed(2)}:1 is below the ${IDENTITY_MIN_CONTRAST}:1 floor` });
    }
  }

  function checkAdoptedVariant(variant: "primary" | "mark", bg: string): void {
    const colors = extractRenderedColors(variants[variant]);
    if (colors.length === 0) {
      unresolvable++;
      findings.push({
        variant,
        ratio: Number.NaN,
        message: `could not determine "${variant}"'s actual rendered colour to check contrast — the adopted mark has no explicit fill/stroke colour literal (it may paint only through inherited currentColor)`,
      });
      return;
    }
    for (const color of colors) checkPair(variant, color, bg);
  }

  if (kind === "adopted") {
    checkAdoptedVariant("primary", tokens.surfaceBase);
    checkAdoptedVariant("mark", tokens.surfaceBase);
  } else {
    checkPair("primary", tokens.ink, tokens.surfaceBase);
    checkPair("mark", tokens.ink, tokens.surfaceBase);
  }
  checkPair("dark", tokens.onInverse, tokens.surfaceInverse);
  checkPair("appIcon", tokens.onAccent, tokens.accent);

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

/**
 * The root `<svg>` START TAG only — never the whole document — so a
 * nested `<svg viewBox="...">` or a descendant element's attribute cannot
 * be mistaken for the root's own declaration. Returns `undefined` when
 * `svg` does not even start with a root `<svg` tag (an already-invalid
 * document — `identity-kit.ts`'s `isSvgDocument` is what normally refuses
 * that before a variant is ever handed to this module, but this function
 * does not assume it was called).
 */
function rootStartTag(svg: string): string | undefined {
  const match = svg.trim().match(/^<svg\b[^>]*>/i);
  return match ? match[0] : undefined;
}

/**
 * `svg`'s root-declared `viewBox`'s shorter side — read from the root
 * `<svg>` start tag ONLY ({@link rootStartTag}), never a whole-document
 * search. A nested `<svg viewBox="...">` (or, before this fix, any
 * descendant carrying that string) can no longer satisfy this when the
 * root element itself declares no `viewBox`.
 */
function parseViewBoxMinSide(svg: string): number | undefined {
  const startTag = rootStartTag(svg);
  if (startTag === undefined) return undefined;
  const match = startTag.match(/viewBox\s*=\s*(?:"([-\d.]+\s+[-\d.]+\s+[\d.]+\s+[\d.]+)"|'([-\d.]+\s+[-\d.]+\s+[\d.]+\s+[\d.]+)')/i);
  const value = match ? (match[1] ?? match[2]) : undefined;
  if (value === undefined) return undefined;
  const parts = value.trim().split(/\s+/);
  const width = Number(parts[2]);
  const height = Number(parts[3]);
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

/**
 * Reads the `data-clear-space` ratio `identity-kit.ts` declares on every
 * root `<svg>` it emits — from the root `<svg>` START TAG only
 * ({@link rootStartTag}), never a whole-document search — and checks it
 * against `minRatio`. A nested `<svg>` or a descendant element carrying a
 * `data-clear-space` attribute can no longer satisfy this when the root
 * element itself declares none.
 */
export function checkClearSpace(svg: string, minRatio: number = MIN_CLEAR_SPACE_RATIO): ClearSpaceResult {
  const startTag = rootStartTag(svg);
  if (startTag === undefined) {
    return { ok: false, indeterminate: true, reason: "svg does not start with a root <svg> tag — could not evaluate" };
  }
  const match = startTag.match(/data-clear-space\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!match) {
    return { ok: false, indeterminate: true, reason: "no data-clear-space declared on the root <svg> — could not evaluate" };
  }
  const raw = match[1] ?? match[2] ?? "";
  const declared = Number(raw);
  if (!Number.isFinite(declared)) {
    return { ok: false, indeterminate: true, reason: `data-clear-space="${raw}" is not a finite number — could not evaluate` };
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

/** Checks that `svg` (the `mono` variant) paints only through `currentColor` — no explicit colour literal left over, single- or double-quoted, in any `fill`/`stroke` attribute ({@link PAINT_ATTR_RE}) — a `data-fill` or similarly-named attribute is never mistaken for one. */
export function checkSingleColourLegibility(svg: string): SingleColourLegibilityResult {
  const offending = new Set(extractRenderedColors(svg));
  if (offending.size > 0) {
    const offendingColors = [...offending];
    return { ok: false, offendingColors, reason: `mono variant references ${offendingColors.length} explicit colour(s) besides currentColor: ${offendingColors.join(", ")}` };
  }
  return { ok: true, offendingColors: [] };
}

// -----------------------------------------------------------------------
// Judgement
// -----------------------------------------------------------------------

/**
 * One check's verdict plus its findings, in exactly the repository
 * contract docs/contracts/check-output-envelope.json's `findingShape`
 * (that contract does not ship with this package) — `findings` is empty
 * only when `verdict` is `"satisfied"`, the same rule the contract itself
 * states.
 */
export interface IdentityCheckJudgement {
  verdict: IdentityVerdict;
  findings: readonly IdentityFinding[];
}

export interface IdentityKitJudgement {
  direction: string;
  checks: Record<IdentityCheckId, IdentityCheckJudgement>;
  verdict: IdentityVerdict;
  findings: readonly IdentityFinding[];
  ok: boolean;
}

/**
 * The full shape the repository contract docs/contracts/check-output-
 * envelope.json declares (it does not ship with this package) for one
 * judgement run: `{ package, version, verdict, summary, findings,
 * nextAction? }`. `identityKitReport` builds this from one direction; the
 * CLI/caller boundary that eventually emits it as this package's own
 * "check command['s] JSON report" is Publisher's own integration, not yet
 * built here (#1210 explicitly leaves file writing and registration to
 * callers).
 */
export interface IdentityKitReport {
  readonly package: "@clossys/designer";
  readonly version: string;
  readonly verdict: IdentityVerdict;
  readonly summary: string;
  readonly findings: readonly IdentityFinding[];
  readonly nextAction?: string;
}

function verdictOf(indeterminate: boolean, ok: boolean): IdentityVerdict {
  if (indeterminate) return "indeterminate";
  return ok ? "satisfied" : "violated";
}

function findingsFor(checkId: IdentityCheckId, verdict: IdentityVerdict, messages: readonly string[]): readonly IdentityFinding[] {
  if (verdict === "satisfied") return [];
  const path = checkId === "contrast" ? undefined : checkId;
  return messages.map((message) => Object.freeze({ rule: checkId, severity: "error" as const, message, ...(path === undefined ? {} : { path }) }));
}

/**
 * Runs all four checks against one {@link IdentityDirection} and returns
 * a per-check verdict/findings breakdown plus an overall `verdict` and
 * flattened `findings`, and `ok`, `true` only when every check is
 * `satisfied` — an `indeterminate` check never counts as a pass.
 */
export function judgeIdentityKit(direction: IdentityDirection, tokens: IdentityTokenInput): IdentityKitJudgement {
  const { variants } = direction;
  const contrast = checkIdentityContrast(direction.kind, variants, tokens);
  const minimumSize = checkMinimumSize(variants.mark);
  const clearSpace = checkClearSpace(variants.primary);
  const singleColour = checkSingleColourLegibility(variants.mono);

  const contrastVerdict = verdictOf(contrast.indeterminate, contrast.ok);
  const minimumSizeVerdict = verdictOf(minimumSize.indeterminate, minimumSize.ok);
  const clearSpaceVerdict = verdictOf(clearSpace.indeterminate, clearSpace.ok);
  const singleColourVerdict = verdictOf(false, singleColour.ok);

  const checkVerdicts: Record<IdentityCheckId, IdentityCheckJudgement> = {
    contrast: {
      verdict: contrastVerdict,
      findings:
        contrastVerdict === "satisfied"
          ? []
          : contrast.findings.map((f) => Object.freeze({ rule: "contrast" as const, severity: "error" as const, message: f.message, path: f.variant })),
    },
    "minimum-size": {
      verdict: minimumSizeVerdict,
      findings: findingsFor("minimum-size", minimumSizeVerdict, minimumSize.reason ? [minimumSize.reason] : []),
    },
    "clear-space": {
      verdict: clearSpaceVerdict,
      findings: findingsFor("clear-space", clearSpaceVerdict, clearSpace.reason ? [clearSpace.reason] : []),
    },
    "single-colour-legibility": {
      verdict: singleColourVerdict,
      findings: findingsFor("single-colour-legibility", singleColourVerdict, singleColour.reason ? [singleColour.reason] : []),
    },
  };

  const checkList = Object.values(checkVerdicts);
  const ok = checkList.every((c) => c.verdict === "satisfied");
  const verdict: IdentityVerdict = checkList.some((c) => c.verdict === "indeterminate")
    ? "indeterminate"
    : checkList.some((c) => c.verdict === "violated")
      ? "violated"
      : "satisfied";
  const findings = checkList.flatMap((c) => c.findings);
  return { direction: direction.id, checks: checkVerdicts, verdict, findings, ok };
}

/** One plain-language sentence for the envelope's required `summary` field — the ONLY field a non-technical reader may be shown without translation. */
function summaryFor(direction: string, judgement: IdentityKitJudgement): string {
  if (judgement.verdict === "satisfied") return `The "${direction}" identity kit satisfies all four checks (contrast, minimum size, clear space, single-colour legibility).`;
  if (judgement.verdict === "indeterminate") return `The "${direction}" identity kit could not be fully evaluated (${judgement.findings.length} finding(s)).`;
  return `The "${direction}" identity kit does not satisfy every check (${judgement.findings.length} finding(s)).`;
}

/** Builds the full report shape the repository contract docs/contracts/check-output-envelope.json declares (not shipped with this package) for one direction. `packageVersion` is caller-supplied (this package's own `package.json` `version`), never read from disk here. */
export function identityKitReport(direction: IdentityDirection, tokens: IdentityTokenInput, packageVersion: string): IdentityKitReport {
  const judgement = judgeIdentityKit(direction, tokens);
  const report: IdentityKitReport = {
    package: "@clossys/designer",
    version: packageVersion,
    verdict: judgement.verdict,
    summary: summaryFor(direction.id, judgement),
    findings: judgement.findings,
  };
  if (judgement.verdict === "satisfied") return Object.freeze(report);
  return Object.freeze({
    ...report,
    nextAction:
      judgement.verdict === "indeterminate"
        ? "Provide the missing viewBox/data-clear-space/colour declarations so every check can evaluate, then re-run this check."
        : "Resolve every listed finding in the generated or adopted identity kit, then re-run this check.",
  });
}

/** Exported for callers building a report over a variant set without a full {@link IdentityDirection} wrapper. */
export type { IdentityVariantSet };
