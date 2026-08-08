/**
 * `@vespeneventures/tokens`'s `TOKENS` registry, flattened to literal,
 * email-and-SVG-safe values — the shared foundation every channel this
 * package grows (`./web`, `./email`, `./print`, `./image`, `./slides`)
 * needs, built once here rather than reinvented per channel and gotten
 * subtly wrong four different ways.
 *
 * THE PROBLEM
 * -----------
 * `TOKENS` (154 entries) declares color values as CSS `oklch(...)`
 * strings meant to be read through a CSS custom-property cascade in a
 * browser. That is unusable outside a browser:
 *
 *   - no email client supports `oklch()`, and none support CSS custom
 *     properties at all — every color has to land as a literal hex on
 *     the element itself;
 *   - `./image`/`./slides` emit SVG for a rasterizer, which has neither
 *     `oklch()` nor a `var()` cascade.
 *
 * So this module answers one question for every channel: given a token
 * slot and an optional set of brand overrides, what is the literal string
 * that slot resolves to?
 *
 * THREE EXPORTS
 * -------------
 *   1. `oklchToHex(css)` — a real OKLCH -> OKLab -> linear sRGB ->
 *      gamma-encoded sRGB -> `#rrggbb[aa]` conversion. See its own doc
 *      comment for the gamut-mapping approach.
 *   2. `flattenTokens(overrides?)` — every `TOKENS` entry, override
 *      applied where given, fully resolved (no `var()` left anywhere,
 *      including embedded inside a composite value like a box-shadow),
 *      every `oklch(...)` occurrence converted through `oklchToHex`.
 *   3. `resolveTokenRef(value, flat)` — resolves `var(--name)` /
 *      `var(--name, fallback)` references (including chains) inside an
 *      arbitrary string, against an already-flattened map. Exported
 *      standalone because a channel may need to resolve a *non-token*
 *      string (e.g. a `ComposeDocument` binding value) that happens to
 *      contain a `var()` reference into the token system, not just the
 *      token entries themselves — `flattenTokens` uses it internally for
 *      exactly that same reason.
 *
 * NEVER A SILENT FALLBACK COLOR
 * ------------------------------
 * Every failure mode below throws a `RenderError` (see `internal/errors.ts`
 * for the six reasons this module added to the closed set) rather than
 * returning a plausible-looking wrong color. A silently-clipped or
 * silently-defaulted color is exactly the failure this repository keeps
 * fighting: it looks like success until someone notices the brand's
 * signature blue rendered as black in an email client.
 */

import { TOKENS } from "@vespeneventures/tokens";

import { RenderError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────
// oklchToHex
// ─────────────────────────────────────────────────────────────────────────

/**
 * `oklchToHex` — parses a single `oklch(...)` CSS color function and
 * returns a literal `#rrggbb` (or `#rrggbbaa` when alpha < 1) string.
 *
 * ACCEPTED SYNTAX
 * ---------------
 *   `oklch(L C H)` or `oklch(L C H / A)`, arbitrary whitespace anywhere
 *   inside the parens. Each channel:
 *
 *     - `L` (lightness) — a bare number (`0.97`) or a percentage
 *       (`97%` == `0.97`; CSS's `100% == 1`).
 *     - `C` (chroma) — a bare number (`0.1`) or a percentage, where
 *       `100% == 0.4` (the value this task's own spec calls out, and the
 *       one real UAs use as chroma's reference range).
 *     - `H` (hue) — a bare number in degrees, or the keyword `none`
 *       (treated as `0`, matching CSS Color 4: a missing/`none` channel
 *       contributes as if it were `0`).
 *     - `A` (alpha), optional — a bare number `0`-`1` or a percentage.
 *       Omitted entirely means opaque (`A = 1`).
 *
 *   `L` is clamped into `[0, 1]` before conversion. This is NOT the
 *   out-of-gamut chroma clipping this function goes out of its way to
 *   avoid below — it is input hygiene for a channel that is not part of
 *   sRGB-gamut geometry at all (every real token in this repository's
 *   corpus keeps `L` inside `[0, 1]`; a wildly out-of-range value, e.g.
 *   `L = 5`, is normalized rather than left to produce `NaN`/nonsense).
 *
 * THE GAMUT PROBLEM — WHY THIS ISN'T A LOOKUP OR AN APPROXIMATION
 * -----------------------------------------------------------------
 * OKLab -> linear-sRGB is a fixed 3x3-ish matrix transform (the standard
 * Björn Ottosson matrices used below), but its output is not guaranteed
 * to land inside `[0, 1]` per channel — plenty of legal `oklch()` values
 * (especially high-chroma ones at extreme lightness) describe a color
 * outside what sRGB can display at all. The naive move — clamp each
 * channel to `[0, 1]` independently after the matrix multiply — silently
 * produces a DIFFERENT color, often a different hue entirely, with no
 * signal that anything went wrong. That is the exact failure this task
 * calls out: "a plausible-looking wrong colour."
 *
 * The fix here is CHROMA REDUCTION, not per-channel clamping: hold `L`
 * and `H` fixed (both are meaningful independent of gamut — perceived
 * lightness and hue survive gamut mapping; chroma is the axis that
 * doesn't), and binary-search the largest `C' <= C` whose resulting
 * linear-sRGB triple is actually inside `[0, 1]` on all three channels.
 * That keeps the hue and (as close as chroma reduction allows) the
 * lightness intact, and only desaturates exactly as much as the sRGB
 * gamut boundary requires — the same family of approach the CSS Color 4
 * spec's own gamut-mapping algorithm and most production oklch->sRGB
 * implementations use (a binary search on chroma is a simplification of
 * the full CSS4 algorithm, which also does a final small clip; this
 * function's 32-iteration binary search converges well past float
 * precision, so no further clip is needed in practice). Per-channel
 * `Math.min(1, Math.max(0, x))` is used ONLY as the final rounding step
 * on an already-in-gamut (or gamut-reduced) triple, to absorb residual
 * floating-point noise (~1e-10), never as the gamut-mapping strategy
 * itself.
 *
 * See this file's exported test suite for accuracy deltas checked
 * against independently-computed reference conversions.
 */
export function oklchToHex(css: string): string {
  const trimmed = css.trim();
  const whole = OKLCH_WHOLE_RE.exec(trimmed);
  if (!whole) {
    throw new RenderError(
      "invalid-oklch",
      `oklchToHex: not an oklch(...) color function: ${JSON.stringify(css)}`,
    );
  }

  const argsStr = whole[1]!.trim();
  const args = OKLCH_ARGS_RE.exec(argsStr);
  if (!args) {
    throw new RenderError(
      "invalid-oklch",
      `oklchToHex: could not parse "L C H" (or "L C H / A") arguments from ${JSON.stringify(css)}`,
    );
  }

  const [, lTok, cTok, hTok, aTok] = args as unknown as [string, string, string, string, string | undefined];

  const L = parseOklchChannel("oklchToHex", css, lTok, 1);
  const C = parseOklchChannel("oklchToHex", css, cTok, 0.4);
  if (C < 0) {
    throw new RenderError("invalid-oklch", `oklchToHex: chroma cannot be negative: ${JSON.stringify(css)}`);
  }
  const H = parseOklchChannel("oklchToHex", css, hTok, undefined);
  const A =
    aTok === undefined ? 1 : Math.min(1, Math.max(0, parseOklchChannel("oklchToHex", css, aTok, 1)));

  const linearRgb = mapToSrgbGamut(L, C, H);
  const r = linearToSrgbGamma(linearRgb[0]);
  const g = linearToSrgbGamma(linearRgb[1]);
  const b = linearToSrgbGamma(linearRgb[2]);

  const hex = `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
  return A < 1 ? `${hex}${toHexChannel(A)}` : hex;
}

const OKLCH_WHOLE_RE = /^oklch\(([\s\S]*)\)$/i;
const OKLCH_ARGS_RE = /^(\S+)\s+(\S+)\s+(\S+)(?:\s*\/\s*(\S+))?$/;
const NUMERIC_TOKEN_RE = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * Parses one `oklch()` channel token: `none` -> `0`; a percentage ->
 * `(n / 100) * percentOf` (only when this channel accepts a percentage —
 * `H` passes `percentOf: undefined` and rejects one); a bare number ->
 * itself. Throws `RenderError("invalid-oklch", ...)` for anything else,
 * naming the offending token and the full original input for context.
 */
function parseOklchChannel(
  fn: string,
  originalCss: string,
  token: string,
  percentOf: number | undefined,
): number {
  if (token.toLowerCase() === "none") return 0;

  const isPercent = token.endsWith("%");
  const numericPart = isPercent ? token.slice(0, -1) : token;
  if (!NUMERIC_TOKEN_RE.test(numericPart)) {
    throw new RenderError(
      "invalid-oklch",
      `${fn}: not a valid number "${token}" in ${JSON.stringify(originalCss)}`,
    );
  }

  const n = Number(numericPart);
  if (!isPercent) return n;

  if (percentOf === undefined) {
    throw new RenderError(
      "invalid-oklch",
      `${fn}: percentage "${token}" is not valid for the hue channel in ${JSON.stringify(originalCss)}`,
    );
  }
  return (n / 100) * percentOf;
}

/**
 * OKLab -> linear sRGB, via the standard Björn Ottosson matrices (the
 * same constants used throughout the OKLab/OKLCH reference material this
 * function was checked against — see the test file's "reference deltas").
 * Returns UNCLAMPED channels; a caller wanting a displayable color must
 * gamut-map first (`mapToSrgbGamut`, below) — this function alone makes
 * no attempt to stay inside `[0, 1]`.
 */
function oklabToLinearSrgb(L: number, a: number, b: number): readonly [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [r, g, bl];
}

/** A small tolerance for "is this linear-sRGB triple inside [0, 1]", absorbing float noise from the OKLab matrix multiply. */
const GAMUT_EPSILON = 1e-4;

function isInSrgbGamut(rgb: readonly [number, number, number]): boolean {
  return rgb.every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

function clampToUnit(rgb: readonly [number, number, number]): readonly [number, number, number] {
  return rgb.map((c) => Math.min(1, Math.max(0, c))) as [number, number, number];
}

/**
 * `L`/`C`/`H` (OKLCH) -> a linear-sRGB triple guaranteed inside `[0, 1]`,
 * via chroma reduction when the direct conversion falls outside the sRGB
 * gamut. See `oklchToHex`'s doc comment for why chroma (not a per-channel
 * clip) is the axis reduced. `L` is clamped into `[0, 1]` first — see
 * that same doc comment for why that clamp is not the gamut-mapping step
 * itself.
 */
function mapToSrgbGamut(rawL: number, C: number, H: number): readonly [number, number, number] {
  const L = Math.min(1, Math.max(0, rawL));
  const hRad = (H * Math.PI) / 180;
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);
  const compute = (chroma: number): readonly [number, number, number] =>
    oklabToLinearSrgb(L, chroma * cosH, chroma * sinH);

  const direct = compute(C);
  if (C <= 0 || isInSrgbGamut(direct)) {
    return clampToUnit(direct);
  }

  // Binary search: the achromatic point (chroma 0) is always in gamut for
  // an L already clamped to [0, 1] (it's a point on the sRGB gray axis),
  // and C (the original chroma) is out of gamut by the check above — so
  // the boundary lies strictly between them.
  let lo = 0;
  let hi = C;
  let best = compute(lo);
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const candidate = compute(mid);
    if (isInSrgbGamut(candidate)) {
      lo = mid;
      best = candidate;
    } else {
      hi = mid;
    }
  }
  return clampToUnit(best);
}

/** Linear sRGB channel [0, 1] -> gamma-encoded sRGB channel [0, 1] (the standard piecewise sRGB transfer function). */
function linearToSrgbGamma(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** A gamma-encoded channel [0, 1] -> two lowercase hex digits, rounding to the nearest of 256 levels. */
function toHexChannel(c: number): string {
  const clamped = Math.min(1, Math.max(0, c));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

// ─────────────────────────────────────────────────────────────────────────
// flattenTokens
// ─────────────────────────────────────────────────────────────────────────

/**
 * `flattenTokens` — every entry in `@vespeneventures/tokens`' `TOKENS`
 * registry, resolved to one literal string, ready to hand to a channel
 * that has no CSS cascade and no `oklch()` support (email, and the SVG
 * `./image`/`./slides` channels emit).
 *
 * RESOLUTION ORDER
 * -----------------
 *   1. VALIDATE `overrides` first, and reject before doing any work:
 *        - an override naming a slot absent from `TOKENS` throws
 *          `"unknown-token-override"` — almost always a typo, and
 *          silently ignoring it means the caller's brand silently never
 *          applies, with nothing said about it.
 *        - an override naming a slot whose `brandable` is `false` throws
 *          `"non-brandable-override"` — that token is structural
 *          (an internal alias, a fixed scale), and letting a consumer
 *          override it silently breaks the design system's own contract
 *          the same way it would if `tokens`' own brand-binding layer let
 *          it through.
 *      Both checks list EVERY offending slot in the thrown message, not
 *      just the first — a caller fixing a typo-laden override object
 *      should not have to run this four times to find every mistake.
 *   2. BUILD a raw map: every `TOKENS` property -> the override's value
 *      if one was given for that property, else the token's own default
 *      `value`.
 *   3. RESOLVE every `var(--name)` / `var(--name, fallback)` reference in
 *      every raw value, against that SAME raw map — so an alias like
 *      `--color-ink-on-accent: var(--color-ink-on-inverse, ...)` picks up
 *      an override supplied for `--color-ink-on-inverse`, and a chain of
 *      aliases (`--color-chart-diverging-positive` ->
 *      `--color-chart-categorical-1`, a literal) resolves end to end.
 *      Uses `resolveTokenRef`'s own cycle detection, seeded with the
 *      property currently being resolved, so a token that (directly or
 *      through a chain) references itself throws `"token-ref-cycle"`
 *      rather than looping forever.
 *   4. CONVERT every `oklch(...)` occurrence in the now-`var()`-free
 *      string through `oklchToHex` — "occurrence" rather than "the whole
 *      value", deliberately: most color tokens ARE just one bare
 *      `oklch(...)` call, but a few composite tokens (e.g.
 *      `--ui-elevation-raised`, after its embedded `var(--color-line-base)`
 *      resolves to a literal `oklch(...)`) carry that call embedded
 *      inside a larger shorthand value. Every `oklch(...)` substring
 *      anywhere in the string gets replaced with its hex form; a value
 *      with none is returned unchanged.
 *
 * `overrides` may itself use `var(--other-token)` syntax (it is not
 * required to be a literal) — it flows through the exact same raw-map
 * resolution as every default value, for free.
 */
export function flattenTokens(overrides: Record<string, string> = {}): Map<string, string> {
  const overrideSlots = Object.keys(overrides);

  const unknownSlots = overrideSlots.filter((slot) => !Object.prototype.hasOwnProperty.call(TOKENS, slot));
  if (unknownSlots.length > 0) {
    throw new RenderError(
      "unknown-token-override",
      `flattenTokens: override(s) target token slot(s) that do not exist in @vespeneventures/tokens' TOKENS registry: ${unknownSlots.join(", ")}`,
    );
  }

  const nonBrandableSlots = overrideSlots.filter((slot) => TOKENS[slot]?.brandable === false);
  if (nonBrandableSlots.length > 0) {
    throw new RenderError(
      "non-brandable-override",
      `flattenTokens: override(s) target non-brandable (structural) token slot(s), which is not allowed: ${nonBrandableSlots.join(", ")}`,
    );
  }

  const raw = new Map<string, string>();
  for (const [property, definition] of Object.entries(TOKENS)) {
    raw.set(property, overrides[property] ?? definition.value);
  }

  const flat = new Map<string, string>();
  for (const property of raw.keys()) {
    const varsResolved = resolveVarRefs(raw.get(property)!, raw, [property]);
    flat.set(property, replaceOklchOccurrences(varsResolved));
  }

  return flat;
}

const OKLCH_SCAN_RE = /oklch\([^()]*\)/gi;

/** Replaces every `oklch(...)` occurrence in `value` with its hex form; returns `value` unchanged when it contains none. */
function replaceOklchOccurrences(value: string): string {
  if (!/oklch\(/i.test(value)) return value;
  return value.replace(OKLCH_SCAN_RE, (match) => oklchToHex(match));
}

// ─────────────────────────────────────────────────────────────────────────
// resolveTokenRef
// ─────────────────────────────────────────────────────────────────────────

/**
 * `resolveTokenRef` — resolves every `var(--name)` / `var(--name,
 * fallback)` reference inside `value` against `flat` (typically
 * `flattenTokens`'s own output, but any `property -> value` map works —
 * see `flattenTokens`'s own internal use of this against its
 * not-yet-fully-resolved raw map, before any `TOKENS` entry has its
 * `var()` calls stripped).
 *
 * Handles, per the task this module was built against:
 *   - a bare reference: `var(--color-accent)`.
 *   - a reference with a fallback: `var(--color-accent, oklch(0.5 0 0))` —
 *     the fallback is used verbatim (itself recursively resolved for any
 *     `var()` it contains) whenever `--color-accent` is absent from
 *     `flat`.
 *   - CHAINS: `flat.get(name)`'s own value may itself contain `var()`
 *     calls; those are resolved recursively before substitution.
 *   - MULTIPLE references in one string (e.g. a shorthand value with two
 *     `var()` calls) — each is found and replaced independently.
 *   - nested `var()` inside a fallback (`var(--a, var(--b, red))`) — the
 *     fallback text is parsed with balanced-parenthesis matching, not a
 *     naive comma split, so a fallback containing its own commas/parens
 *     (another `var()` call, or `rgba(0, 0, 0, 0.5)`) is not mis-split.
 *
 * THROWS, NEVER RETURNS UNRESOLVED TEXT
 * ----------------------------------------
 *   - `"unknown-token-ref"` — `var(--name)` names a property absent from
 *     `flat`, with no fallback given.
 *   - `"token-ref-cycle"` — resolving a `var()` chain would revisit a
 *     property name already being resolved in the current chain (A -> B
 *     -> A, or a token that references itself directly). Detected with a
 *     call-stack of in-progress names, so independent chains that happen
 *     to converge on the same downstream token (a "diamond" — A and B
 *     both reference C) are NOT flagged as a cycle; only an actual loop
 *     is.
 *   - `"invalid-token-ref"` — malformed `var(...)` syntax: unbalanced
 *     parentheses, or a `var()` whose first argument isn't a
 *     `--custom-property` name.
 *
 * A `value` with no `var(` in it at all is returned unchanged, with no
 * lookups performed.
 */
export function resolveTokenRef(value: string, flat: ReadonlyMap<string, string>): string {
  return resolveVarRefs(value, flat, []);
}

interface ParsedVarCall {
  readonly name: string;
  readonly fallback: string | undefined;
  /** Index of the character immediately after this `var(...)` call's closing `)`. */
  readonly endIndex: number;
}

/** Parses one `var(...)` call starting at `value[startIndex]` (which must be `"var("`). Balanced-parenthesis aware, so a fallback containing its own `(`/`)` (a nested `var()`, an `rgba()`) is handled correctly. */
function parseVarCall(value: string, startIndex: number): ParsedVarCall {
  let depth = 1;
  let i = startIndex + 4; // past "var("
  for (; i < value.length && depth > 0; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  if (depth !== 0) {
    throw new RenderError(
      "invalid-token-ref",
      `resolveTokenRef: unbalanced parentheses in var(...) starting at index ${startIndex} of ${JSON.stringify(value)}`,
    );
  }
  const closeIndex = i - 1;
  const inner = value.slice(startIndex + 4, closeIndex);

  let commaIndex = -1;
  let innerDepth = 0;
  for (let j = 0; j < inner.length; j++) {
    const ch = inner[j];
    if (ch === "(") innerDepth++;
    else if (ch === ")") innerDepth--;
    else if (ch === "," && innerDepth === 0) {
      commaIndex = j;
      break;
    }
  }

  const namePart = (commaIndex === -1 ? inner : inner.slice(0, commaIndex)).trim();
  const fallbackPart = commaIndex === -1 ? undefined : inner.slice(commaIndex + 1).trim();

  if (!namePart.startsWith("--") || namePart.length <= 2) {
    throw new RenderError(
      "invalid-token-ref",
      `resolveTokenRef: var() does not name a custom property (expected "--name", got ${JSON.stringify(namePart)}) in ${JSON.stringify(value)}`,
    );
  }

  return { name: namePart, fallback: fallbackPart, endIndex: closeIndex + 1 };
}

/** Resolves one already-parsed `var(--name[, fallback])` call to literal text, recursing into `name`'s own value (or the fallback) for any further `var()` calls it contains. `stack` is the chain of property names currently being resolved, for cycle detection. */
function resolveVarCall(
  name: string,
  fallback: string | undefined,
  flat: ReadonlyMap<string, string>,
  stack: readonly string[],
): string {
  const known = flat.get(name);
  if (known !== undefined) {
    if (stack.includes(name)) {
      throw new RenderError(
        "token-ref-cycle",
        `resolveTokenRef: cycle detected resolving token reference chain: ${[...stack, name].join(" -> ")}`,
      );
    }
    return resolveVarRefs(known, flat, [...stack, name]);
  }
  if (fallback !== undefined) {
    return resolveVarRefs(fallback, flat, stack);
  }
  throw new RenderError(
    "unknown-token-ref",
    `resolveTokenRef: var(${name}) references a token that does not exist in the supplied map, and no fallback was given`,
  );
}

/** Scans `value` left to right for `var(` occurrences, replacing each with its resolved text; everything outside a `var()` call passes through unchanged. */
function resolveVarRefs(value: string, flat: ReadonlyMap<string, string>, stack: readonly string[]): string {
  if (!value.includes("var(")) return value;

  let result = "";
  let i = 0;
  while (i < value.length) {
    const idx = value.indexOf("var(", i);
    if (idx === -1) {
      result += value.slice(i);
      break;
    }
    result += value.slice(i, idx);
    const parsed = parseVarCall(value, idx);
    result += resolveVarCall(parsed.name, parsed.fallback, flat, stack);
    i = parsed.endIndex;
  }
  return result;
}
