/**
 * A minimal, test-only OKLCH -> WCAG relative-luminance/contrast module —
 * NOT part of this package's public API (see the note atop
 * `internal/parse-css.ts`). It exists so `src/contrast.test.ts` can
 * compute real contrast ratios for this package's `oklch()` token values
 * instead of eyeballing the lightness channel, which the task this module
 * was written for explicitly calls out as not good enough: two colors
 * with a higher/lower OKLCH `L` are not guaranteed to have a
 * higher/lower relative luminance once hue and chroma are involved (they
 * happen to correlate closely for this package's tokens today, since
 * every one of them is achromatic — `C = 0` — but this module does the
 * real conversion rather than relying on that coincidence).
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

/**
 * The relative luminance of `value` (a CSS value containing `oklch(...)`),
 * compositing it over `backgroundValue` first if it carries an alpha < 1
 * (standard "source over" alpha compositing, done in LINEAR space — the
 * same space `oklchToLinearSRGB` already returns). `backgroundValue` is
 * required whenever `value`'s alpha is not 1; omit it only for an opaque
 * color, where no compositing step is needed.
 */
export function luminanceOf(value: string, backgroundValue?: string): number {
  const fg = parseOklch(value);
  const fgRgb = oklchToLinearSRGB(fg);
  if (fg.A >= 1) return relativeLuminance(fgRgb);
  if (backgroundValue === undefined) {
    throw new Error(`luminanceOf: ${JSON.stringify(value)} has alpha < 1 and needs a backgroundValue to composite over`);
  }
  const bg = parseOklch(backgroundValue);
  const bgRgb = oklchToLinearSRGB(bg);
  const composited: [number, number, number] = [0, 1, 2].map(
    (i) => fg.A * fgRgb[i]! + (1 - fg.A) * bgRgb[i]!,
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
