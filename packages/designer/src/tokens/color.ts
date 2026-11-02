/**
 * `@clossys/designer/tokens`'s WCAG colour math — a complete, zero-
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

function isWhitespaceCode(code: number): boolean {
  return code === 0x0009 || code === 0x000a || code === 0x000b || code === 0x000c || code === 0x000d ||
    code === 0x0020 || code === 0x00a0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function skipWhitespace(value: string, from: number): number {
  let index = from;
  while (index < value.length && isWhitespaceCode(value.charCodeAt(index))) index++;
  return index;
}

function numberEnd(value: string, from: number): number {
  let index = from;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if ((code < 0x30 || code > 0x39) && code !== 0x2e) break;
    index++;
  }
  return index === from ? -1 : index;
}

interface OklchParseAttempt {
  readonly color?: Oklch;
  readonly resumeAt: number;
}

/** Parse one candidate without backtracking. Every successful scan advances its caller's search cursor. */
function parseOklchAt(value: string, afterOpen: number): OklchParseAttempt {
  let index = skipWhitespace(value, afterOpen);
  const lStart = index;
  index = numberEnd(value, index);
  if (index === -1) return { resumeAt: lStart };
  const lEnd = index;

  if (index >= value.length || !isWhitespaceCode(value.charCodeAt(index))) return { resumeAt: index };
  index = skipWhitespace(value, index);
  const cStart = index;
  index = numberEnd(value, index);
  if (index === -1) return { resumeAt: cStart };
  const cEnd = index;

  if (index >= value.length || !isWhitespaceCode(value.charCodeAt(index))) return { resumeAt: index };
  index = skipWhitespace(value, index);
  const hStart = index;
  index = numberEnd(value, index);
  if (index === -1) return { resumeAt: hStart };
  const hEnd = index;

  index = skipWhitespace(value, index);
  let alphaStart = -1;
  let alphaEnd = -1;
  if (value[index] === "/") {
    index = skipWhitespace(value, index + 1);
    alphaStart = index;
    index = numberEnd(value, index);
    if (index === -1) return { resumeAt: alphaStart };
    alphaEnd = index;
    index = skipWhitespace(value, index);
  }
  if (value[index] !== ")") return { resumeAt: index };

  return {
    color: {
      L: Number(value.slice(lStart, lEnd)),
      C: Number(value.slice(cStart, cEnd)),
      H: Number(value.slice(hStart, hEnd)),
      A: alphaStart === -1 ? 1 : Number(value.slice(alphaStart, alphaEnd)),
    },
    resumeAt: index + 1,
  };
}

/** Parse the first `oklch(...)` function found in `value` (a token's declared CSS value, e.g. `oklch(0.6268 0 0 / 0.1)`). */
export function parseOklch(value: string): Oklch {
  let searchFrom = 0;
  for (;;) {
    const start = value.indexOf("oklch(", searchFrom);
    if (start === -1) {
      throw new Error(`parseOklch: no oklch(...) function found in ${JSON.stringify(value)}`);
    }
    const attempt = parseOklchAt(value, start + "oklch(".length);
    if (attempt.color !== undefined) return attempt.color;
    // The failed attempt traversed only whitespace, digits, dots, or a slash,
    // so none of those characters can begin the next literal
    // `oklch(`. Resuming at the first failing character makes the whole
    // search linear even when hostile input contains many near-matches.
    searchFrom = Math.max(start + 1, attempt.resumeAt);
  }
}

/**
 * OKLCH -> linear sRGB, via OKLab (the standard Björn Ottosson matrices).
 * Channels are clamped to `[0, 1]` — every token in this package stays
 * comfortably inside the sRGB gamut, but a future chromatic brand value
 * that overshoots it should not produce a nonsensical luminance instead
 * of a clamped one.
 */
export function oklchToLinearSRGB(color: Oklch): readonly [number, number, number] {
  return oklchLinearSRGB(color).map(x => Math.min(1, Math.max(0, x))) as [number, number, number];
}
/** Unclipped conversion for CSS interpolation; the exported conversion retains its historical clamping. */
function oklchLinearSRGB(color: Oklch): readonly [number, number, number] {
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

  return [r, g, bl];
}

/** WCAG relative luminance from LINEAR sRGB channels (already the output of `oklchToLinearSRGB` — no separate gamma step needed). */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** sRGB gamma-encoded channel [0,1] -> linear channel [0,1] (the inverse of the encode step `oklchToLinearSRGB` never needs, since it stays in linear space throughout). */
function srgbChannelToLinear(c: number): number {
  const magnitude = Math.abs(c);
  return Math.sign(c) * (magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4);
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

/** Color math retains extended channels through mixing; clipping occurs only at the paint stage. */
type RGB = readonly [number, number, number];
interface Color { readonly rgb: RGB; readonly A: number }
const channels = (fn: (index: number) => number): RGB => [fn(0), fn(1), fn(2)];
const clamp = (value: number): number => Math.min(1, Math.max(0, value));
function toLab(rgb: RGB): RGB {
  const [r, g, b] = rgb;
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [.2104542553*l + .793617785*m - .0040720468*s, 1.9779984951*l - 2.428592205*m + .4505937099*s, .0259040371*l + .7827717662*m - .808675766*s];
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + .3963377774*a + .2158037573*b)**3;
  const m = (L - .1055613458*a - .0638541728*b)**3;
  const s = (L - .0894841775*a - 1.291485548*b)**3;
  return [4.0767416621*l - 3.3077115913*m + .2309699292*s, -1.2684380046*l + 2.6097574011*m - .3413193965*s, -.0041960863*l - .7034186147*m + 1.707614701*s];
}
/** Closed, bounded CSS color grammar: never extract a supported literal from an unsupported wrapper. */
function parseColorToLinearSRGB(input: string, depth = 0): Color {
  const value = input.trim();
  if (depth > 8 || value.length > 4096) throw new Error("Color expression exceeds limits");
  if (depth > 0 && /^[0-9a-fA-F]{6}$/.test(value)) throw new Error("Nested color stops require CSS hex syntax");
  if (value === "transparent") return { rgb: [0, 0, 0], A: 0 };
  if (value.startsWith("color-mix(")) {
    if (!value.endsWith(")")) throw new Error("Malformed color-mix");
    const body = value.slice(10, -1), parts: string[] = [];
    let nesting = 0, start = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "(") nesting++;
      if (body[i] === ")" && --nesting < 0) throw new Error("Malformed color-mix");
      if (body[i] === "," && nesting === 0) { parts.push(body.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(body.slice(start).trim());
    const space = /^in (srgb|srgb-linear|oklab)$/.exec(parts[0] ?? "")?.[1];
    if (nesting !== 0 || parts.length !== 3 || !space) throw new Error("Unsupported color-mix space or syntax");
    const stop = (text: string) => {
      const weight = /\s+((?:\d+(?:\.\d*)?|\.\d+))%$/.exec(text);
      const amount = weight ? Number(weight[1]) / 100 : undefined;
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0 || amount > 1)) throw new Error("Invalid color-mix weight");
      return { color: parseColorToLinearSRGB(weight ? text.slice(0, weight.index) : text, depth + 1), amount };
    };
    const a = stop(parts[1]!), b = stop(parts[2]!);
    const wa = a.amount ?? (b.amount === undefined ? .5 : 1 - b.amount);
    const wb = b.amount ?? (a.amount === undefined ? .5 : 1 - a.amount);
    const total = wa + wb;
    if (total <= 0) throw new Error("Zero color-mix weight");
    const alpha = (wa*a.color.A + wb*b.color.A) / total;
    const convert = (rgb: RGB): RGB => space === "oklab" ? toLab(rgb) : space === "srgb" ? channels(i => linearChannelToSrgb(rgb[i]!)) : rgb;
    const ca = convert(a.color.rgb), cb = convert(b.color.rgb);
    const mixed = channels(i => alpha === 0 ? 0 : (wa*a.color.A*ca[i]! + wb*b.color.A*cb[i]!) / (total*alpha));
    const rgb = space === "oklab" ? fromLab(mixed) : space === "srgb" ? channels(i => srgbChannelToLinear(mixed[i]!)) : mixed;
    return { rgb, A: alpha * Math.min(total, 1) };
  }
  if (/^oklch\([^()]*\)$/.test(value)) {
    const parsed = parseOklch(value);
    if (![parsed.L, parsed.C, parsed.H, parsed.A].every(Number.isFinite) || parsed.L < 0 || parsed.L > 1 || parsed.C < 0 || parsed.A < 0 || parsed.A > 1) throw new Error("Invalid oklch channels");
    return { rgb: oklchLinearSRGB(parsed), A: parsed.A };
  }
  const hexMatch = value.match(HEX_RE);
  if (hexMatch) {
    return { rgb: hexToLinearSRGB(hexMatch[0]), A: 1 };
  }
  throw new Error(`parseColorToLinearSRGB: value is neither oklch(...) nor a 6-digit hex: ${JSON.stringify(value)}`);
}

/**
 * The relative luminance of a supported whole color expression, compositing it over
 * `backgroundValue` first if it carries an alpha < 1 (standard "source
 * over" alpha compositing, done in LINEAR space — the same space
 * `oklchToLinearSRGB`/`hexToLinearSRGB` both return). `backgroundValue` is
 * required whenever `value`'s alpha is not 1; omit it only for an opaque
 * color, where no compositing step is needed.
 */
export function luminanceOf(value: string, backgroundValue?: string): number {
  const fg = parseColorToLinearSRGB(value);
  if (fg.A >= 1) return relativeLuminance(channels(i => clamp(fg.rgb[i]!)));
  if (backgroundValue === undefined) {
    throw new Error(`luminanceOf: ${JSON.stringify(value)} has alpha < 1 and needs a backgroundValue to composite over`);
  }
  const bg = parseColorToLinearSRGB(backgroundValue);
  if (bg.A !== 1) throw new Error("Compositing needs an opaque ground");
  const composited: [number, number, number] = [0, 1, 2].map(
    (i) => fg.A * fg.rgb[i]! + (1 - fg.A) * bg.rgb[i]!,
  ) as [number, number, number];
  return relativeLuminance(channels(i => clamp(composited[i]!)));
}

/** Linear channel -> sRGB gamma-encoded channel, sign-preserving (the inverse of `srgbChannelToLinear`). */
function linearChannelToSrgb(c: number): number {
  const magnitude = Math.abs(c);
  const encoded = magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return Math.sign(c) * encoded;
}

/**
 * Alpha of a supported whole color expression, or undefined for unsupported syntax.
 * Contrast checks use it to require an opaque explicit ground.
 */
export function colorAlpha(value: string): number | undefined {
  try {
    return parseColorToLinearSRGB(value).A;
  } catch {
    return undefined;
  }
}

/**
 * `contrastRatio` with translucent values composited in gamma-encoded sRGB,
 * the way a browser paints them, rather than in linear light. Neither space
 * is uniformly stricter: linear blending is stricter for light ink but more
 * lenient for dark ink on a light translucent plate over a dark backdrop.
 * Internal: the contrast gate scores a pair over a literal backdrop both
 * ways and keeps the lower ratio.
 */
export function contrastRatioEncodedBlend(a: string, b: string, compositeBackground?: string): number {
  return layeredContrast(a, b, compositeBackground, true);
}

/** Ink is painted over the background, which is painted over the explicit opaque ground. */
function layeredContrast(ink: string, background: string, ground: string | undefined, encoded: boolean): number {
  const fg = parseColorToLinearSRGB(ink), bg = parseColorToLinearSRGB(background);
  const base = ground === undefined ? undefined : parseColorToLinearSRGB(ground);
  if (base && base.A !== 1) throw new Error("Compositing needs an opaque ground");
  if (bg.A < 1 && !base) throw new Error("Transparent background needs an explicit opaque ground");
  const over = (color: Color, lower: RGB): RGB => channels(i => encoded
    ? srgbChannelToLinear(color.A*linearChannelToSrgb(color.rgb[i]!) + (1-color.A)*linearChannelToSrgb(lower[i]!))
    : color.A*color.rgb[i]! + (1-color.A)*lower[i]!);
  const backgroundRGB = bg.A === 1 ? bg.rgb : over(bg, base!.rgb);
  const paintedBackground = channels(i => clamp(backgroundRGB[i]!));
  const inkRGB = fg.A === 1 ? fg.rgb : over(fg, paintedBackground);
  const paintedInk = channels(i => clamp(inkRGB[i]!));
  const l1 = relativeLuminance(paintedInk), l2 = relativeLuminance(paintedBackground);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}

/**
 * WCAG contrast for ink on its background. A transparent background requires
 * an explicit opaque ground; translucent ink is painted over that actual background.
 */
export function contrastRatio(a: string, b: string, compositeBackground?: string): number {
  return layeredContrast(a, b, compositeBackground, false);
}
