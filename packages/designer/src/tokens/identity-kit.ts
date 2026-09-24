/**
 * Identity kit — #1210's generative half: deterministic wordmark and
 * monogram DIRECTIONS, and the variant set (`primary`, `mark`, `mono`,
 * `light`, `dark`, `favicon`, `appIcon`) every direction ships, built
 * from a brand name plus already-resolved token literals. This package
 * ships no product logo of its own — same discipline `master-mark.ts`
 * already holds to — only the deterministic generator and the adoption
 * path a real brand name and real token values run through.
 *
 * WHO DOES WHAT — this file is the "define what good looks like" half.
 * `identity-checks.ts` is the "judge whether it is met" half. Neither
 * one draws free-hand art: every SVG this module returns is assembled
 * from the same small set of primitives (a monogram glyph, a wordmark
 * glyph, a badge wrapper), so two runs with the same input always
 * produce the same output — the "deterministic mechanics" this
 * package's role is scoped to, not the generative drawing a human
 * designer or an image model would do instead (see #1210 and #1187's
 * "who does what" table).
 *
 * TWO WAYS A DIRECTION IS BORN:
 *
 *   1. `generateIdentityDirections` — three candidates (one wordmark, two
 *      monogram shapes) built entirely from `IdentityBrandInput` (a name,
 *      optionally explicit initials) and `IdentityTokenInput` (resolved
 *      ink/inverse/accent colours and a font-family). Offered as one
 *      multiple-choice decision, per #1210.
 *   2. `adoptSuppliedMark` — a consumer- or human-designer-supplied SVG
 *      is validated and the same seven-role variant set is derived from
 *      it structurally (`recolorSvg`), rather than regenerated from
 *      scratch. A custom pictorial mark never blocks v0: this is the
 *      `found` -> adopted path #1210 names.
 *
 * THE SEVEN VARIANT ROLES, what each is FOR, and why `light`/`dark` are
 * not just `primary` again:
 *
 *   - `primary` — the flagship lockup (wordmark + monogram, or the
 *     monogram alone when there's no wordmark direction), ink-coloured,
 *     for light surfaces. The one a consumer reaches for by default.
 *   - `mark` — the monogram/icon alone, no wordmark, ink-coloured. For
 *     placements too small or too square for the full lockup.
 *   - `mono` — `mark`, recoloured to `currentColor` so a single CSS
 *     `color` declaration governs it: the single-colour-legibility
 *     variant `identity-checks.ts` judges.
 *   - `light` — `primary` again, kept as its own named file: a consumer
 *     placing a logo on a light surface should not have to reason about
 *     which of two identically-shaped exports is "the light one".
 *   - `dark` — `primary`, recoloured to the inverse-ink token, for dark
 *     surfaces.
 *   - `favicon` — `mark`, recoloured to `currentColor` (identical
 *     construction to `mono`): a favicon is rendered at sizes where a
 *     second ink colour buys nothing and single-colour legibility is
 *     exactly the property that matters.
 *   - `appIcon` — `mark` composed onto an accent-filled rounded-square
 *     badge, the shape app-icon surfaces (OS launchers, PWA manifests)
 *     expect.
 *
 * Every SVG this module returns declares `data-clear-space` on its root
 * element — `identity-checks.ts`'s `checkClearSpace` reads it. This
 * package does not rasterize or lay out a real page, so clear space is a
 * DECLARED minimum ratio of the mark's own size, not a measured one; see
 * that check's own header for why a declared obligation is still a real,
 * auditable one.
 */

const MARK_VIEW_BOX = "0 0 48 48";
const WORDMARK_VIEW_BOX = "0 0 200 48";
const CLEAR_SPACE_RATIO = 0.2;
const BADGE_SIZE = 48;

export const IDENTITY_VARIANT_ROLES = ["primary", "mark", "mono", "light", "dark", "favicon", "appIcon"] as const;
export type IdentityVariantRole = (typeof IDENTITY_VARIANT_ROLES)[number];

/** One direction's complete set of shipped SVG documents, one per {@link IdentityVariantRole}. */
export interface IdentityVariantSet {
  primary: string;
  mark: string;
  mono: string;
  light: string;
  dark: string;
  favicon: string;
  appIcon: string;
}

export interface IdentityBrandInput {
  /** The brand's display name, used verbatim in a wordmark direction. */
  name: string;
  /** Explicit monogram initials. Derived from `name` (see `deriveInitials`) when omitted. */
  initials?: string;
}

/**
 * Already-resolved CSS colour literals (`oklch(...)`, hex, or any value
 * `contrastRatio` in `color.ts` can parse) and a `font-family` value.
 * Deliberately literal, not `var(--token, ...)`-wrapped: these assets
 * ship as static files (`clossys/designer/assets/`), not live-themed
 * markup, and `identity-checks.ts`'s contrast check needs a real,
 * parseable colour to compute a ratio against.
 */
export interface IdentityTokenInput {
  /** Ink colour used against `surfaceBase` — the `primary`/`mark`/`light` colour. */
  ink: string;
  /** Ink colour used against `surfaceInverse` — the `dark` variant's colour. */
  onInverse: string;
  /** The light surface `ink`/`mark`/`light` are checked for contrast against. */
  surfaceBase: string;
  /** The dark surface `dark` is checked for contrast against. */
  surfaceInverse: string;
  /** The app-icon badge's background colour. */
  accent: string;
  /** The glyph colour composed onto the accent badge. */
  onAccent: string;
  /** CSS `font-family` value for wordmark/monogram text. */
  fontFamily: string;
}

export type IdentityDirectionKind = "wordmark" | "monogram" | "adopted";

export interface IdentityDirection {
  id: string;
  label: string;
  kind: IdentityDirectionKind;
  variants: IdentityVariantSet;
}

export class IdentityKitValidationError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(reasons.join("; "));
    this.name = "IdentityKitValidationError";
    this.reasons = reasons;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// -----------------------------------------------------------------------
// Token-value validation - a plain `string`-typed public export, and
// #1210's own design anticipates IdentityTokenInput values eventually
// flowing from Strategist's brand attributes (client-influenced), not
// only this repository's own trusted resolution path. `name`/`initials`
// were already run through `escapeXml` before this fix;
// `fontFamily`/`ink`/`onInverse`/`accent`/`onAccent` were interpolated
// into `font-family="..."`, `style="color:..."`, and `fill="..."`
// attribute values with no escaping and no runtime validation at all - an
// attacker-controlled token value could break out of the attribute
// boundary and inject an event handler or a new element. Fixed two ways,
// applied together, not as alternatives:
//
//   1. FAIL CLOSED on the colour tokens. `ink`/`onInverse`/`accent`/
//      `onAccent` are validated against `isValidCssColor` - a strict
//      allowlist grammar (hex, `rgb()`/`hsl()`/`oklch()`/`oklab()`/
//      `lab()`/`lch()`/`hwb()` with only numeric/percent/comma/slash
//      arguments, or the `currentColor`/`transparent` keywords) - before
//      `generateIdentityDirections`/`adoptSuppliedMark` generate anything.
//      A value that isn't real colour syntax is refused outright
//      (`IdentityKitValidationError`), never silently accepted or
//      stripped.
//   2. ESCAPE at every interpolation site regardless - `fontFamily`
//      (freer syntax: comma-separated names, some quoted, so it is
//      escaped rather than grammar-validated) and the already-validated
//      colour tokens both go through `escapeXml` immediately before they
//      are written into an attribute value, in every function that
//      builds SVG text (`buildMonogramGlyph`, `buildWordmarkGlyph`,
//      `wrapGlyph`, `wrapBadge`, and `recolorSvg`'s own `color`
//      parameter). Escaping a colour that already passed
//      `isValidCssColor` is a no-op - none of the allowed characters
//      need escaping - so this is pure defense in depth, not a second,
//      looser gate that could paper over a validation bug.
// -----------------------------------------------------------------------

const CSS_COLOR_KEYWORD_RE = /^(?:currentColor|transparent)$/i;
const CSS_HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}){1,2}$/;
const CSS_COLOR_FUNCTION_RE = /^(?:rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch)\(\s*[0-9eE.%+\-\s,/]*\)$/;

/**
 * A strict allowlist, not a denylist: `true` only for the `currentColor`/
 * `transparent` keywords, a `#`-prefixed hex colour, or one of the
 * numeric-argument CSS colour functions this codebase's own tokens
 * already use (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `oklch`, `oklab`,
 * `lab`, `lch`). No letters are permitted inside a function's
 * parentheses, which is what keeps this grammar closed against
 * injection - every accepted string is built only from digits, `.`,
 * `%`, `+`, `-`, `,`, `/`, whitespace, `#`, and the function's own fixed
 * name, none of which can close an XML attribute or open a new element.
 */
export function isValidCssColor(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  return CSS_COLOR_KEYWORD_RE.test(trimmed) || CSS_HEX_COLOR_RE.test(trimmed) || CSS_COLOR_FUNCTION_RE.test(trimmed);
}

const CSS_FONT_FAMILY_RE = /^[\p{L}\p{N}\s,\-_'".]+$/u;

/**
 * A permissive but still closed allowlist for a `font-family` value: a
 * non-empty, reasonably short string built only from letters, digits,
 * whitespace, comma, hyphen, underscore, single/double quotes, and
 * periods - enough to accept a real font stack such as `system-ui,
 * ui-sans-serif, -apple-system, "Segoe UI", sans-serif`, but excluding
 * every character an attribute-breakout or element-injection payload
 * needs (`<`, `>`, `&`, `(`, `)`, `;`, `{`, `}`, backslash). This is
 * looser than {@link isValidCssColor} on purpose - real font names are
 * far less structured than colour syntax - but it is still a refusal,
 * not just an escape: a `fontFamily` outside this charset is rejected
 * before generation, the same fail-closed discipline as the colour
 * tokens above.
 */
export function isValidCssFontFamily(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return false;
  return CSS_FONT_FAMILY_RE.test(trimmed);
}

/**
 * Throws {@link IdentityKitValidationError} (one reason per invalid
 * field, never just the first) when any of `ink`/`onInverse`/`accent`/
 * `onAccent` is not a valid CSS colour ({@link isValidCssColor}) or
 * `fontFamily` is not a valid CSS font-family value
 * ({@link isValidCssFontFamily}). Called at the top of both
 * `generateIdentityDirections` and `adoptSuppliedMark` - no generated or
 * adopted SVG is ever built from an unvalidated token.
 */
export function validateIdentityTokenInput(tokens: IdentityTokenInput): void {
  const reasons: string[] = [];
  const colorFields: (keyof IdentityTokenInput)[] = ["ink", "onInverse", "accent", "onAccent"];
  for (const field of colorFields) {
    if (!isValidCssColor(tokens[field])) {
      reasons.push(`${field} is not a valid CSS colour (hex, currentColor/transparent, or an rgb/hsl/hwb/oklch/oklab/lab/lch function)`);
    }
  }
  if (!isValidCssFontFamily(tokens.fontFamily)) {
    reasons.push("fontFamily contains a character outside the allowed font-family charset (letters, digits, whitespace, comma, hyphen, underscore, quotes, period)");
  }
  if (reasons.length > 0) {
    throw new IdentityKitValidationError(reasons);
  }
}

/**
 * Pure, deterministic initials derivation: the first letter of each of
 * the first two words, or the first two letters of a single-word name.
 * Explicit `IdentityBrandInput.initials` always wins over this — it is
 * only the fallback a caller gets by omitting it.
 *
 * Iterates by Unicode CODE POINT (`Array.from(word)`, which splits on
 * `Symbol.iterator`'s code-point-aware behaviour), never by UTF-16 code
 * unit (`.charAt`/`.slice`, which would split a surrogate pair in half).
 * A name containing an astral character — most emoji, for one — still
 * produces a whole, valid initial instead of a broken lone surrogate.
 * This does not go as far as full grapheme-cluster segmentation (a
 * multi-code-point sequence like a ZWJ emoji or a skin-tone modifier is
 * still more than one "initial" here); code-point iteration is what fixes
 * the concrete defect (a broken surrogate half) without requiring
 * `Intl.Segmenter`.
 */
export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    const codePoints = Array.from(words[0]!);
    return (codePoints.length >= 2 ? codePoints.slice(0, 2) : codePoints).join("").toUpperCase();
  }
  const firstCodePoint = Array.from(words[0]!)[0] ?? "";
  const secondCodePoint = Array.from(words[1]!)[0] ?? "";
  return (firstCodePoint + secondCodePoint).toUpperCase();
}

function buildMonogramGlyph(initials: string, shape: "circle" | "square", fontFamily: string): string {
  const escaped = escapeXml(initials);
  const escapedFontFamily = escapeXml(fontFamily);
  const shapeMarkup =
    shape === "circle"
      ? `<circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="2" />`
      : `<rect x="2" y="2" width="44" height="44" rx="10" fill="none" stroke="currentColor" stroke-width="2" />`;
  return `${shapeMarkup}<text x="24" y="30" text-anchor="middle" font-family="${escapedFontFamily}" font-size="18" font-weight="600" fill="currentColor">${escaped}</text>`;
}

function buildWordmarkGlyph(name: string, initials: string, fontFamily: string): string {
  const escapedName = escapeXml(name);
  const escapedFontFamily = escapeXml(fontFamily);
  const roundel = buildMonogramGlyph(initials, "circle", fontFamily);
  return `<g>${roundel}</g><text x="56" y="30" font-family="${escapedFontFamily}" font-size="22" font-weight="600" fill="currentColor">${escapedName}</text>`;
}

function wrapGlyph(glyph: string, viewBox: string, color: string): string {
  const escapedColor = escapeXml(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" aria-hidden="true" style="color:${escapedColor}" data-clear-space="${CLEAR_SPACE_RATIO}">${glyph}</svg>`;
}

/** Parses a `viewBox="minX minY width height"` value into its four numbers, or `undefined` if it isn't one. */
function parseViewBoxBox(viewBox: string): { minX: number; minY: number; width: number; height: number } | undefined {
  const match = viewBox.trim().match(/^([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)$/);
  if (!match) return undefined;
  const minX = Number(match[1]);
  const minY = Number(match[2]);
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (![minX, minY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return { minX, minY, width, height };
}

/** Rounds to 4 decimal places and drops trailing zeros — enough precision for a 48-unit badge, without long float tails in the emitted SVG. */
function round4(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * The `transform` that fits `sourceViewBox`'s own coordinate box into the
 * fixed `${BADGE_SIZE}x${BADGE_SIZE}` badge canvas, scaled uniformly
 * (never stretched) to the larger dimension and centred. For a mark whose
 * own viewBox already equals the badge's (every generated mark: they are
 * drawn directly in `MARK_VIEW_BOX`), this resolves to `translate(0,0)
 * scale(1)` — a no-op, byte-different from before only in carrying an
 * explicit identity transform. For a supplied mark with a smaller or
 * differently-proportioned viewBox (`0 0 24 24`, say), this is what makes
 * it fill and centre the badge instead of remaining a quarter-sized
 * fragment pinned to the top-left corner — the defect `wrapBadge` had
 * before this fix, since it dropped the supplied mark's inner markup
 * straight into the fixed badge coordinate system with no reconciliation
 * at all. Falls back to an identity transform (never throws) when
 * `sourceViewBox` cannot be parsed — a badge that cannot be perfectly
 * scaled is still a badge, not a generation failure.
 */
function badgeContentTransform(sourceViewBox: string): string {
  const box = parseViewBoxBox(sourceViewBox);
  if (!box) return "translate(0,0) scale(1)";
  const scale = Math.min(BADGE_SIZE / box.width, BADGE_SIZE / box.height);
  const tx = round4((BADGE_SIZE - box.width * scale) / 2 - box.minX * scale);
  const ty = round4((BADGE_SIZE - box.height * scale) / 2 - box.minY * scale);
  return `translate(${tx},${ty}) scale(${round4(scale)})`;
}

function wrapBadge(innerContent: string, accent: string, onAccent: string, sourceViewBox: string = MARK_VIEW_BOX): string {
  const escapedAccent = escapeXml(accent);
  const escapedOnAccent = escapeXml(onAccent);
  const transform = badgeContentTransform(sourceViewBox);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEW_BOX}" aria-hidden="true" data-clear-space="${CLEAR_SPACE_RATIO}"><rect width="${BADGE_SIZE}" height="${BADGE_SIZE}" rx="10" fill="${escapedAccent}" /><g style="color:${escapedOnAccent}" transform="${transform}">${innerContent}</g></svg>`;
}

function buildVariantSet(input: {
  lockupGlyph: string;
  markGlyph: string;
  lockupViewBox: string;
  tokens: IdentityTokenInput;
}): IdentityVariantSet {
  const { lockupGlyph, markGlyph, lockupViewBox, tokens } = input;
  return {
    primary: wrapGlyph(lockupGlyph, lockupViewBox, tokens.ink),
    mark: wrapGlyph(markGlyph, MARK_VIEW_BOX, tokens.ink),
    mono: wrapGlyph(markGlyph, MARK_VIEW_BOX, "currentColor"),
    light: wrapGlyph(lockupGlyph, lockupViewBox, tokens.ink),
    dark: wrapGlyph(lockupGlyph, lockupViewBox, tokens.onInverse),
    favicon: wrapGlyph(markGlyph, MARK_VIEW_BOX, "currentColor"),
    appIcon: wrapBadge(markGlyph, tokens.accent, tokens.onAccent),
  };
}

/**
 * Three deterministic directions from a brand name and resolved tokens:
 * a wordmark (roundel monogram + name) and two monogram-only shapes
 * (circle, rounded square). Same input, same three directions, every
 * time — offered to the client as one multiple-choice decision, per
 * #1210.
 */
export function generateIdentityDirections(brand: IdentityBrandInput, tokens: IdentityTokenInput): [IdentityDirection, IdentityDirection, IdentityDirection] {
  validateIdentityTokenInput(tokens);
  const initials = (brand.initials ?? deriveInitials(brand.name)).toUpperCase();
  const wordmarkGlyph = buildWordmarkGlyph(brand.name, initials, tokens.fontFamily);
  const circleGlyph = buildMonogramGlyph(initials, "circle", tokens.fontFamily);
  const squareGlyph = buildMonogramGlyph(initials, "square", tokens.fontFamily);

  return [
    {
      id: "wordmark",
      label: `${brand.name} — wordmark with roundel monogram`,
      kind: "wordmark",
      variants: buildVariantSet({ lockupGlyph: wordmarkGlyph, markGlyph: circleGlyph, lockupViewBox: WORDMARK_VIEW_BOX, tokens }),
    },
    {
      id: "monogram-circle",
      label: `${brand.name} — circular monogram`,
      kind: "monogram",
      variants: buildVariantSet({ lockupGlyph: circleGlyph, markGlyph: circleGlyph, lockupViewBox: MARK_VIEW_BOX, tokens }),
    },
    {
      id: "monogram-square",
      label: `${brand.name} — rounded-square monogram`,
      kind: "monogram",
      variants: buildVariantSet({ lockupGlyph: squareGlyph, markGlyph: squareGlyph, lockupViewBox: MARK_VIEW_BOX, tokens }),
    },
  ];
}

const SVG_DOCUMENT_RE = /^[\s﻿]*<svg(?:\s|>)/i;

/**
 * `value` is a COMPLETE svg document: starts with a root `<svg` tag (after
 * leading whitespace/BOM) and its closing `</svg>` is the final
 * non-whitespace content — not merely present somewhere in the string.
 * `trimmed` already has no trailing whitespace, so anchoring the closing
 * tag at `$` is exactly "final non-whitespace content": a payload such as
 * `<svg>...</svg><script>...</script>` no longer passes, because the
 * string's actual end (`</script>`) is not `</svg>`.
 */
function isSvgDocument(value: string): boolean {
  const trimmed = value.trim();
  if (!SVG_DOCUMENT_RE.test(trimmed)) return false;
  return /<\/svg\s*>$/i.test(trimmed);
}

/**
 * Matches a `fill`/`stroke` PAINT ATTRIBUTE — double- or single-quoted,
 * with or without whitespace around `=` — while excluding a differently
 * named attribute that merely ends in "fill"/"stroke" (`data-fill`,
 * `overflow`) via the negative lookbehind: a real attribute name is
 * always preceded by whitespace, a quote, or the start of the tag, never
 * by a word character or hyphen. Shared, identically, by `recolorSvg`
 * here and `identity-checks.ts`'s `checkSingleColourLegibility` — both
 * used to match only the double-quoted, unspaced form
 * (`/\b(fill|stroke)="([^"]*)"/g`), which silently missed a single-quoted
 * or spaced attribute (`fill = '#fff'`) and could match `data-fill`
 * through `\b`'s hyphen-is-a-boundary behaviour.
 */
const PAINT_ATTR_RE = /(?<![\w-])(fill|stroke)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Best-effort structural recolour: every `fill`/`stroke` PAINT ATTRIBUTE
 * value that is not `none`/`transparent`/empty is replaced with `color`.
 * Deliberately narrow — it does not reach into a `style="fill:#fff"` CSS
 * declaration or a `<style>` block, since either would require a real CSS
 * parser to rewrite safely. A supplied mark that paints exclusively
 * through inline `style` attributes will not recolour correctly here;
 * that limitation is why `adoptSuppliedMark`'s derived variants are a
 * starting point for review, not a guarantee.
 */
export function recolorSvg(svg: string, color: string): string {
  const escapedColor = escapeXml(color);
  return svg.replace(PAINT_ATTR_RE, (match, attr: string, _quoted: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
    const value = doubleQuoted ?? singleQuoted ?? "";
    if (value === "none" || value === "transparent" || value === "") return match;
    return `${attr}="${escapedColor}"`;
  });
}

function innerMarkupOf(svg: string): string {
  const trimmed = svg.trim();
  return trimmed.replace(/^<svg\b[^>]*>/i, "").replace(/<\/svg\s*>\s*$/i, "");
}

/**
 * The root `<svg>` START TAG only — never the whole document — so a
 * nested `<svg viewBox="...">` or a descendant element cannot be mistaken
 * for the root's own declaration. `svg` is assumed already validated by
 * {@link isSvgDocument} (trimmed, starts with a root `<svg` tag).
 */
function rootStartTag(svg: string): string {
  const trimmed = svg.trim();
  const match = trimmed.match(/^<svg\b[^>]*>/i);
  return match ? match[0] : trimmed;
}

/**
 * The supplied mark's own root `viewBox`, read from the root `<svg>`
 * start tag only (double- or single-quoted) — never a nested element's.
 * Falls back to `MARK_VIEW_BOX` when the root declares none or it cannot
 * be parsed, the same "badge still renders, never throws" fallback
 * {@link badgeContentTransform} itself falls back to.
 */
function sourceViewBoxOf(svg: string): string {
  const match = rootStartTag(svg).match(/\bviewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const value = match ? (match[1] ?? match[2]) : undefined;
  return value ?? MARK_VIEW_BOX;
}

export interface AdoptSuppliedMarkInput {
  brand: IdentityBrandInput;
  /** A complete `<svg>...</svg>` document — the client's existing logo, or a human designer's/image model's output. */
  suppliedSvg: string;
  tokens: IdentityTokenInput;
}

/**
 * Adopts an already-drawn mark (`found` -> adopted, per #1210) instead of
 * generating one, and derives the same seven-role variant set from it via
 * {@link recolorSvg}. `primary`/`mark` are the supplied SVG unchanged —
 * this function does not attempt to separate a wordmark from an icon
 * inside arbitrary supplied art. Throws {@link IdentityKitValidationError}
 * when `suppliedSvg` is not a complete `<svg>` document.
 */
export function adoptSuppliedMark(input: AdoptSuppliedMarkInput): IdentityDirection {
  const { brand, suppliedSvg, tokens } = input;
  validateIdentityTokenInput(tokens);
  if (!isSvgDocument(suppliedSvg)) {
    throw new IdentityKitValidationError(["supplied mark must be a complete <svg>...</svg> document"]);
  }
  const trimmed = suppliedSvg.trim();
  const onAccentGlyph = innerMarkupOf(recolorSvg(trimmed, tokens.onAccent));
  const sourceViewBox = sourceViewBoxOf(trimmed);

  return {
    id: "adopted",
    label: `${brand.name} — adopted mark`,
    kind: "adopted",
    variants: {
      primary: trimmed,
      mark: trimmed,
      mono: recolorSvg(trimmed, "currentColor"),
      light: recolorSvg(trimmed, tokens.ink),
      dark: recolorSvg(trimmed, tokens.onInverse),
      favicon: recolorSvg(trimmed, "currentColor"),
      appIcon: wrapBadge(onAccentGlyph, tokens.accent, tokens.onAccent, sourceViewBox),
    },
  };
}
