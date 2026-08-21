/**
 * `@vespeneventures/designer/tokens`'s WCAG colour math — a complete, zero-
 * dependency OKLCH/hex -> linear-sRGB -> relative-luminance -> contrast-
 * ratio pipeline, exported directly from `./tokens` alongside `TOKENS`
 * itself. Public, not incidental: this used to live at
 * `internal/color.ts`, undocumented and reachable only by
 * `contrast.test.ts` — a real, tested, WCAG-correct implementation sitting
 * behind this package's own "not part of the public API" line for no
 * reason grounded in the code itself (see `contrast-gate.ts` for the
 * gate now built on top of it, and this package's CHANGELOG for the
 * promotion).
 *
 * WHY THE REAL CONVERSION, NOT THE LIGHTNESS CHANNEL — two colors with a
 * higher/lower OKLCH `L` are not guaranteed to have a higher/lower
 * relative luminance once hue and chroma are involved (they happen to
 * correlate closely for this package's own tokens today, since every one
 * of them is achromatic — `C = 0` — but a chromatic brand override, or a
 * consumer's own token registry, has no reason to keep that property).
 * `oklchToLinearSRGB` does the real OKLab-based conversion instead of
 * relying on that coincidence, so a caller — this package's own
 * `checkTokenContrast`, or a consumer's own tooling — gets a real
 * contrast ratio for ANY `oklch()` value, chromatic or not.
 *
 * WHAT SHIPS FROM HERE: `parseOklch`/`oklchToLinearSRGB` (the `oklch()`
 * path), `hexToLinearSRGB` (the hex path, for this package's
 * `--color-chart-*` family), `relativeLuminance` (WCAG's own formula over
 * linear-sRGB channels), `luminanceOf` (parses either color shape,
 * compositing over a background when the color carries alpha < 1), and
 * `contrastRatio` (the full WCAG ratio between two CSS color values, each
 * optionally translucent). Every function is pure and throws on a value it
 * cannot parse — a caller (the contrast gate, a test, a consumer) decides
 * how to report that; this module never swallows a parse failure into a
 * wrong number.
 */

/** One parsed `oklch(L C H)` or `oklch(L C H / A)` value. `A` defaults to 1 (opaque) when omitted. */
export interface Oklch {
  readonly L: number;
  readonly C: number;
  readonly H: number;
  readonly A: number;
}

const OKLCH_RE = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/;

/** Parse the first `oklch(...)` function found in `value` (a token's declared CSS value, e.g. `oklch(0.6268 0 0 / 0.1)`). */
export function parseOklch(value: string): Oklch {
  const match = value.match(OKLCH_RE);
  if (!match) {
    throw new Error(`parseOklch: no oklch(...) function found in ${JSON.stringify(value)}`);
  }
  return {
    L: Number(match[1]),
    C: Number(match[2]),
    H: Number(match[3]),
    A: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

/**
 * OKLCH -> linear sRGB, via OKLab (the standard Björn Ottosson matrices).
 * Channels are clamped to `[0, 1]` — every token in this package stays
 * comfortably inside the sRGB gamut, but a future chromatic brand value
 * that overshoots it should not produce a nonsensical luminance instead
 * of a clamped one.
 */
export function oklchToLinearSRGB(color: Oklch): readonly [number, number, number] {
  const hRad = (color.H * Math.PI) / 180;
  const a = color.C * Math.cos(hRad);
  const b = color.C * Math.sin(hRad);

  const l_ = color.L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = color.L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = color.L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [r, g, bl].map((x) => Math.min(1, Math.max(0, x))) as [number, number, number];
}

/** WCAG relative luminance from LINEAR sRGB channels (already the output of `oklchToLinearSRGB` — no separate gamma step needed). */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** sRGB gamma-encoded channel [0,1] -> linear channel [0,1] (the inverse of the encode step `oklchToLinearSRGB` never needs, since it stays in linear space throughout). */
function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Parse a bare 6-digit hex color (`#2a78d6` or `2a78d6`) to LINEAR sRGB —
 * the same output shape `oklchToLinearSRGB` produces, so both feed the same
 * `relativeLuminance`/compositing path below. Added alongside the existing
 * `oklch()`-only path so this module can score the chart-color family
 * (`--color-chart-categorical-*`, `-sequential-*`, and the diverging poles
 * — all validated hex, per the dataviz skill's palette convention) with
 * the same real math as every other token, rather than eyeballing it or
 * standing up a second, parallel contrast module.
 */
export function hexToLinearSRGB(hex: string): readonly [number, number, number] {
  const match = hex.match(HEX_RE);
  if (!match) {
    throw new Error(`hexToLinearSRGB: not a 6-digit hex color: ${JSON.stringify(hex)}`);
  }
  const int = Number.parseInt(match[1]!, 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
}

/**
 * Parse either shape of color value this package ships: an `oklch(...)`
 * function (every non-chart token) or a bare 6-digit hex (the chart-color
 * family). Alpha is only expressible via `oklch(... / A)` today — no
 * chart token ships an alpha hex — so a hex match always reports `A: 1`.
 */
function parseColorToLinearSRGB(value: string): { readonly rgb: readonly [number, number, number]; readonly A: number } {
  if (value.includes("oklch(")) {
    const parsed = parseOklch(value);
    return { rgb: oklchToLinearSRGB(parsed), A: parsed.A };
  }
  const hexMatch = value.match(HEX_RE);
  if (hexMatch) {
    return { rgb: hexToLinearSRGB(hexMatch[0]), A: 1 };
  }
  throw new Error(`parseColorToLinearSRGB: value is neither oklch(...) nor a 6-digit hex: ${JSON.stringify(value)}`);
}

/**
 * The relative luminance of `value` (a CSS value containing either
 * `oklch(...)` or a bare 6-digit hex color), compositing it over
 * `backgroundValue` first if it carries an alpha < 1 (standard "source
 * over" alpha compositing, done in LINEAR space — the same space
 * `oklchToLinearSRGB`/`hexToLinearSRGB` both return). `backgroundValue` is
 * required whenever `value`'s alpha is not 1; omit it only for an opaque
 * color, where no compositing step is needed.
 */
export function luminanceOf(value: string, backgroundValue?: string): number {
  const fg = parseColorToLinearSRGB(value);
  if (fg.A >= 1) return relativeLuminance(fg.rgb);
  if (backgroundValue === undefined) {
    throw new Error(`luminanceOf: ${JSON.stringify(value)} has alpha < 1 and needs a backgroundValue to composite over`);
  }
  const bg = parseColorToLinearSRGB(backgroundValue);
  const composited: [number, number, number] = [0, 1, 2].map(
    (i) => fg.A * fg.rgb[i]! + (1 - fg.A) * bg.rgb[i]!,
  ) as [number, number, number];
  return relativeLuminance(composited);
}

/**
 * WCAG contrast ratio between two CSS values (each optionally translucent,
 * each composited over `compositeBackground` if so — pass the token both
 * would realistically sit on top of, e.g. `--color-surface-base`).
 */
export function contrastRatio(a: string, b: string, compositeBackground?: string): number {
  const l1 = luminanceOf(a, compositeBackground);
  const l2 = luminanceOf(b, compositeBackground);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
