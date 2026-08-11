/**
 * The shared fixed-canvas engine behind BOTH `./image` and `./slides` — see
 * this package's task brief: "a slide deck is an ordered sequence of
 * canvases," so the geometry math, the text-wrapping heuristic, and the XML
 * escaping rules live here, ONE place, rather than being re-derived (and
 * re-drifted) twice.
 *
 * WHY THIS FILE LIVES DIRECTLY UNDER `src/image/`, NOT `src/image/internal/`
 * OR `src/internal/`
 * ---------------------------------------------------------------------------
 * `./slides` (a sibling channel, same package, built by the same task as
 * `./image`) imports this file directly by relative path. Two directories
 * were ruled out:
 *
 *   - `src/image/internal/` — this package's own convention (see the
 *     README's "Shared internals") is that a channel's `internal/` is
 *     off-limits to every OTHER channel. That rule exists to stop
 *     channel-specific plumbing leaking sideways; it is not a reason to stop
 *     two channels that are explicitly THE SAME rendering problem (a fixed
 *     canvas with absolutely-positioned slots) from sharing the one engine
 *     that solves it.
 *   - `src/internal/` — genuinely shared across every channel this package
 *     ships, but three OTHER agents (`./email`, `./print`, and whoever
 *     eventually revisits this file) are editing that directory in parallel,
 *     in separate worktrees, on the same package. A fourth set of edits
 *     landing there is exactly the merge-conflict risk this task's own scope
 *     rules call out.
 *
 * This is therefore a deliberate, flagged exception: one file, shared by
 * exactly the two channels that need it, living under one of them rather
 * than under a directory three unrelated agents are touching. Flagged again
 * in the PR description as a candidate for later extraction into its own
 * `src/internal/canvas.ts` once all channels have landed and a single
 * coordinated edit is safe.
 *
 * TYPOGRAPHY LIVES IN `../internal/typography.ts`, NOT HERE
 * -------------------------------------------------------------
 * This file used to carry its own `DEFAULT_FONT_SIZE_PX`/`DEFAULT_FONT_FAMILY`
 * placeholder table, with a doc comment claiming there was "no real
 * typography token to resolve instead." That claim was false —
 * `@vespeneventures/ui/tokens` ships a full `--text-*`/`--font-*` scale — and
 * the table has been deleted. `./renderSlots.ts` (this engine's other half)
 * now resolves real font size/family per slot via `../internal/
 * typography.ts`'s `resolveElementTypography`/`resolveElementFontFamily`,
 * the same shared resolver `./email` and `./print` use, built on top of
 * this same `flattenTokens`/`resolveTokenRef` re-exported below.
 */

import { frameToInches } from "../core/index.js";
import type { Frame } from "../core/index.js";
import { flattenTokens, resolveTokenRef } from "../internal/tokens.js";

// ─────────────────────────────────────────────────────────────────────────
// Canvas dimensions — logical viewBox vs. emitted (possibly scaled) attrs
// ─────────────────────────────────────────────────────────────────────────

/** A canvas's pixel dimensions — logical (unscaled) units. */
export interface CanvasPixelSize {
  width: number;
  height: number;
}

/**
 * What an `<svg>` root needs to emit for a given logical canvas size and
 * `scale`: the `viewBox` stays at LOGICAL units regardless of `scale` — the
 * standard retina-SVG shape, where `viewBox` describes the coordinate space
 * every child element is drawn in (so slot geometry never has to know about
 * `scale` at all) and `width`/`height` describe the OUTPUT pixel size a
 * rasterizer or an `<img>` tag actually allocates. Getting these backwards
 * (scaling the viewBox instead of the attributes, or scaling both) is the
 * standard retina-SVG mistake this function exists to get right exactly
 * once, in one place.
 */
export interface CanvasDimensions {
  /** `viewBox`'s width/height — always the logical (unscaled) canvas size. */
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** The emitted `width`/`height` ATTRIBUTES — `logical * scale`. */
  attrWidth: number;
  attrHeight: number;
  scale: 1 | 2;
}

export function computeCanvasDimensions(logical: CanvasPixelSize, scale: 1 | 2 = 1): CanvasDimensions {
  return {
    viewBoxWidth: logical.width,
    viewBoxHeight: logical.height,
    attrWidth: logical.width * scale,
    attrHeight: logical.height * scale,
    scale,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Frame -> canvas-pixel Rect
// ─────────────────────────────────────────────────────────────────────────

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A `SlotSpec.frame`'s 0..1 fractions -> absolute canvas-pixel coordinates,
 * in the canvas's LOGICAL (viewBox) units — never the scaled attribute
 * units, which slot geometry must never know about (see
 * `computeCanvasDimensions`'s own doc comment).
 *
 * Reuses `@vespeneventures/surface/core`'s `frameToInches` rather than
 * re-deriving the identical `fraction * dimension` multiplication by hand.
 * That function's `CanvasInches` argument is unit-agnostic in practice — it
 * is a plain `{ width, height }` multiplied straight through with no
 * inch-specific behavior anywhere in its implementation (see `frame.ts`).
 * The "Inches" in its name describes what `@vespeneventures/surface/core`'s own
 * `print` channel happens to measure that argument in; this module measures
 * the exact same shape in SVG user units (`px`-equivalent) instead, and the
 * function itself does not — and cannot — tell the difference.
 */
export function frameToCanvasRect(frame: Frame, canvas: CanvasPixelSize): PixelRect {
  return frameToInches(frame, canvas);
}

// ─────────────────────────────────────────────────────────────────────────
// XML escaping
// ─────────────────────────────────────────────────────────────────────────

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Escapes the five XML-significant characters (`&`, `<`, `>`, `"`, `'`) so
 * `text` is safe to embed as XML text content or a quoted attribute value.
 * `&` is matched by the same single-pass regex as the other four (not
 * replaced first in its own pass) — a single `String.replace` with one
 * character-class regex, so there is no risk of a naive "replace `&` first,
 * then replace the others" implementation accidentally double-escaping an
 * `&` that a prior step itself introduced.
 *
 * Escaping `>` as a byproduct also neutralizes the CDATA-close sequence
 * `]]>`: this module never emits a `<![CDATA[` section (every text node
 * here is plain escaped XML text), so `]]>` is not technically special in
 * the positions this function's output ever lands in — but escaping `>`
 * unconditionally means the literal three-byte sequence `]]>` can never
 * survive into the emitted document at all, which is the stronger,
 * position-independent guarantee this package's verification bar asks for.
 */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]!);
}

// ─────────────────────────────────────────────────────────────────────────
// Text wrapping — deterministic, character-width-approximation based
// ─────────────────────────────────────────────────────────────────────────

/**
 * SVG 1.1 has no automatic text wrapping or reflow: a long string placed in
 * a narrow slot runs straight past the slot's right edge (and, for multiple
 * lines, past its bottom edge) with no complaint from any renderer or
 * rasterizer. This module picks approach (a) from the task brief —
 * DETERMINISTIC LINE BREAKING within the slot's frame width, computed from a
 * fixed average-character-width-per-`em` constant — over approach (b)
 * (detect-and-report only, no wrapping at all), because a caller composing
 * an OG image or a slide wants the common case (a slightly-too-long
 * headline) to actually look right, not just to be told it didn't.
 * Overflow that survives wrapping (the wrapped text needs more LINES than
 * the slot's height allows at its font size) is still always reported, per
 * approach (b)'s spirit — see `wrapText`'s own doc comment.
 *
 * ACCURACY LIMITS — READ BEFORE TRUSTING THIS FOR PIXEL-PERFECT LAYOUT
 * -----------------------------------------------------------------------
 * `AVG_CHAR_WIDTH_EM` (0.55) is a single fixed average, not a per-glyph
 * lookup — deliberately: the task brief explicitly rules out a font-metrics
 * dependency. This is accurate enough to avoid gross overruns for ordinary
 * mixed-case Latin text in a generic sans-serif font, but it WILL
 * mis-measure:
 *   - narrow glyphs (`i`, `l`, `.`, `,`) — a string heavy with these wraps
 *     later than it visually could;
 *   - wide glyphs (`M`, `W`, `m`, `w`) or ALL-CAPS text — wraps earlier than
 *     it visually could;
 *   - any non-Latin script (CJK, Arabic, Devanagari, …) — this module's
 *     per-word whitespace-based breaking assumes Latin word-spacing
 *     conventions; a CJK string with no whitespace at all is treated as one
 *     unbreakable "word" and hard-broken by character count instead (see
 *     below), which is a reasonable fallback but not a script-aware line
 *     break;
 *   - kerning, ligatures, bold/italic weight, and letter-spacing are not
 *     modeled at all.
 * A caller with layout-critical text (a logo lockup, a legal disclaimer at a
 * fixed size) should treat this module's wrapping as a safety net, not a
 * design tool, and check the returned `overflowed` flag regardless.
 */
export interface TextWrapOptions {
  /** The font size, in the same canvas-pixel units as `widthPx`/`heightPx`. */
  fontSizePx: number;
  /** The slot's available width, in canvas-pixel units (a `PixelRect.w`). */
  widthPx: number;
  /** The slot's available height, in canvas-pixel units (a `PixelRect.h`) — bounds how many lines fit before this function reports overflow. */
  heightPx: number;
  /** Line-box height as a multiple of `fontSizePx`. Default `1.2`, a common sans-serif single-line-height convention. */
  lineHeightMultiplier?: number;
}

export interface TextWrapResult {
  /** The wrapped lines, already truncated (with a trailing ellipsis on the last visible line) when `overflowed` is `true`. Never longer than fits `heightPx` at this font size. */
  lines: string[];
  /** `true` when the input needed more lines than `heightPx` allows at this font size, and the tail was truncated — the caller MUST surface this, never render it silently. */
  overflowed: boolean;
}

/** Average glyph width as a fraction of `em` (font-size) for a generic sans-serif font — see this file's top comment for the accuracy limits this constant carries. */
const AVG_CHAR_WIDTH_EM = 0.55;
const DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.2;
const ELLIPSIS = "…";

export function wrapText(text: string, options: TextWrapOptions): TextWrapResult {
  const lineHeightMultiplier = options.lineHeightMultiplier ?? DEFAULT_LINE_HEIGHT_MULTIPLIER;
  const avgCharWidthPx = options.fontSizePx * AVG_CHAR_WIDTH_EM;
  const maxCharsPerLine = Math.max(1, Math.floor(options.widthPx / avgCharWidthPx));
  const lineHeightPx = options.fontSizePx * lineHeightMultiplier;
  const maxLines = Math.max(1, Math.floor(options.heightPx / lineHeightPx));

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const allLines: string[] = [];
  let current = "";

  const flushCurrent = (): void => {
    if (current.length > 0) {
      allLines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      // A single word longer than one whole line: hard-break it by
      // character. There is no shorter breakable unit, and letting it run
      // off the canvas unbroken is exactly the silent failure this module
      // exists to avoid.
      flushCurrent();
      let remainder = word;
      while (remainder.length > maxCharsPerLine) {
        allLines.push(remainder.slice(0, maxCharsPerLine));
        remainder = remainder.slice(maxCharsPerLine);
      }
      current = remainder;
      continue;
    }

    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      flushCurrent();
      current = word;
    }
  }
  flushCurrent();

  if (allLines.length === 0 || allLines.length <= maxLines) {
    return { lines: allLines, overflowed: false };
  }

  const visible = allLines.slice(0, maxLines);
  const lastIndex = visible.length - 1;
  const last = visible[lastIndex]!;
  visible[lastIndex] =
    last.length + ELLIPSIS.length <= maxCharsPerLine
      ? `${last}${ELLIPSIS}`
      : `${last.slice(0, Math.max(0, maxCharsPerLine - ELLIPSIS.length))}${ELLIPSIS}`;

  return { lines: visible, overflowed: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Token-role color resolution — always a literal hex, never oklch()/var()
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolves a `StyleBinding` color-ish field (`color`, `background`,
 * `border`) — a token ROLE NAME, e.g. `"--color-ink-primary"` — into a
 * literal hex string, via `internal/tokens.ts`'s `flattenTokens`/
 * `resolveTokenRef`. Wraps `role` as `var(${role})` and hands it to
 * `resolveTokenRef` rather than looking it up in `flat` directly: this
 * reuses `resolveTokenRef`'s own existing validation (unknown ref, cycle,
 * malformed syntax all throw the shared `RenderErrorReason`s already
 * defined in `internal/errors.ts`) instead of re-deriving a second,
 * possibly-drifting "is this a known token" check here.
 *
 * Returns `fallbackHex` when `role` itself is `undefined` — a `StyleBinding`
 * field is always optional; the caller decides what "no style given" should
 * default to per element (e.g. ink-primary-ish black for text, transparent
 * for an unset background).
 */
export function resolveColorRole(
  role: string | undefined,
  flat: ReadonlyMap<string, string>,
  fallbackHex: string,
): string {
  if (role === undefined) return fallbackHex;
  return resolveTokenRef(`var(${role})`, flat);
}

/** Re-exported so `./image`/`./slides` callers never need their own import of `internal/tokens.ts` directly — see this file's own top comment for why the engine lives here rather than in `internal/`. */
export function buildFlatTokenMap(overrides?: Record<string, string>): Map<string, string> {
  return flattenTokens(overrides);
}
