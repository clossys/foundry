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

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits — a short, deterministic id suffix, not a security hash. */
function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The shapes the recogniser accepts, and the geometry attributes each may carry. */
const FLAT_SHAPE_GEOMETRY: ReadonlyMap<string, readonly string[]> = new Map([
  ["path", ["d"]],
  ["rect", ["x", "y", "width", "height", "rx", "ry"]],
  ["circle", ["cx", "cy", "r"]],
  ["ellipse", ["cx", "cy", "rx", "ry"]],
  ["polygon", ["points"]],
  ["polyline", ["points"]],
  ["line", ["x1", "y1", "x2", "y2"]],
]);
/**
 * The only attributes a recognised root may carry (never paint, never a
 * reference), each mapped to its own constant so the root is re-emitted
 * from these names, never from text sliced out of the input.
 */
const FLAT_ROOT_ATTRIBUTE_NAMES: ReadonlyMap<string, string> = new Map([
  ["xmlns", "xmlns"],
  ["viewBox", "viewBox"],
  ["width", "width"],
  ["height", "height"],
  ["role", "role"],
  ["aria-label", "aria-label"],
  ["data-clear-space", "data-clear-space"],
]);

/**
 * Caps on what the recogniser will look at. The recogniser exists to
 * recognise a logo, and its cost must stay bounded on hostile input: an
 * input over any cap is simply not recognised, so it stays flat,
 * byte-identical to the previous release.
 *  - attributes on one tag,
 *  - elements in all (every `<g>` and every shape),
 *  - nesting depth (open `<g>` groups; also bounds the recursion in
 *    {@link renderFlatNodes}).
 */
const FLAT_MAX_ATTRIBUTES_PER_TAG = 32;
const FLAT_MAX_ELEMENTS = 2000;
const FLAT_MAX_DEPTH = 32;

const FLAT_HEX_RE = /^#(?:([0-9a-fA-F]{3})|([0-9a-fA-F]{6}))$/;
const FLAT_STROKE_ATTR_RE = /^stroke-[a-z]+(?:-[a-z]+)*$/;

type FlatAttrs = [name: string, value: string][];
interface FlatShape {
  kind: "shape";
  tag: string;
  attrs: FlatAttrs;
  tone: string;
}
interface FlatGroup {
  kind: "group";
  transform: string | undefined;
  children: FlatNode[];
}
type FlatNode = FlatShape | FlatGroup;

const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_DQUOTE = 34;
const CHAR_AMP = 38;
const CHAR_SQUOTE = 39;
const CHAR_HYPHEN = 45;
const CHAR_SLASH = 47;
const CHAR_COLON = 58;
const CHAR_LT = 60;
const CHAR_EQ = 61;
const CHAR_GT = 62;
const CHAR_UNDERSCORE = 95;

const isFlatSpace = (code: number): boolean => code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_LF || code === CHAR_CR;
const isLowerLetter = (code: number): boolean => code >= 97 && code <= 122;
const isAsciiLetter = (code: number): boolean => isLowerLetter(code) || (code >= 65 && code <= 90);
const isFlatNameChar = (code: number): boolean => isAsciiLetter(code) || (code >= 48 && code <= 57) || code === CHAR_COLON || code === CHAR_UNDERSCORE || code === CHAR_HYPHEN;

/** The index of the first non-whitespace character of `text` at or after `at`. */
function skipFlatSpace(text: string, at: number): number {
  let i = at;
  while (i < text.length && isFlatSpace(text.charCodeAt(i))) i++;
  return i;
}

/** The index just after `</name` + optional whitespace + `>` at `at`, or `-1` when `text` has no such closing tag there. */
function flatCloseTagEnd(text: string, at: number, name: string): number {
  if (!text.startsWith(`</${name}`, at)) return -1;
  const i = skipFlatSpace(text, at + 2 + name.length);
  return text.charCodeAt(i) === CHAR_GT ? i + 1 : -1;
}

interface FlatTag {
  name: string;
  attrs: FlatAttrs;
  selfClosing: boolean;
  /** The index just after the tag's `>`. */
  end: number;
}

/**
 * Scans one start tag at `at` (which must hold `<`): a lowercase name, then
 * attributes, then `>` or `/>`. Each attribute is leading whitespace, a
 * name, `=`, and a quoted value containing none of `"` `'` `<` `>` `&`; a
 * value that could close its own quote, open a tag or start an entity is
 * not accepted, so the recogniser rejects the whole document instead of
 * re-emitting it. Returns `null` on anything else, on a duplicate
 * attribute name, and on more than {@link FLAT_MAX_ATTRIBUTES_PER_TAG}
 * attributes.
 *
 * A single left-to-right pass with no backtracking: every character is
 * looked at a bounded number of times, so the cost is linear in the length
 * of the tag (and the attribute cap stops it after
 * {@link FLAT_MAX_ATTRIBUTES_PER_TAG} attributes). Duplicates are found with
 * a `Set`, not by comparing every pair.
 */
function scanFlatTag(text: string, at: number): FlatTag | null {
  if (text.charCodeAt(at) !== CHAR_LT) return null;
  let i = at + 1;
  while (i < text.length && isLowerLetter(text.charCodeAt(i))) i++;
  if (i === at + 1) return null;
  const name = text.slice(at + 1, i);
  const attrs: FlatAttrs = [];
  const seen = new Set<string>();
  for (;;) {
    const afterSpace = skipFlatSpace(text, i);
    const code = text.charCodeAt(afterSpace);
    if (code === CHAR_GT) return { name, attrs, selfClosing: false, end: afterSpace + 1 };
    if (code === CHAR_SLASH) return text.charCodeAt(afterSpace + 1) === CHAR_GT ? { name, attrs, selfClosing: true, end: afterSpace + 2 } : null;
    if (afterSpace === i || !isAsciiLetter(code)) return null; // an attribute needs leading whitespace and a letter to start its name
    if (attrs.length === FLAT_MAX_ATTRIBUTES_PER_TAG) return null;
    let nameEnd = afterSpace + 1;
    while (nameEnd < text.length && isFlatNameChar(text.charCodeAt(nameEnd))) nameEnd++;
    const attrName = text.slice(afterSpace, nameEnd);
    if (seen.has(attrName)) return null;
    seen.add(attrName);
    const eq = skipFlatSpace(text, nameEnd);
    if (text.charCodeAt(eq) !== CHAR_EQ) return null;
    const quoteAt = skipFlatSpace(text, eq + 1);
    const quote = text.charCodeAt(quoteAt);
    if (quote !== CHAR_DQUOTE && quote !== CHAR_SQUOTE) return null;
    let valueEnd = quoteAt + 1;
    for (;;) {
      if (valueEnd >= text.length) return null;
      const c = text.charCodeAt(valueEnd);
      if (c === quote) break;
      if (c === CHAR_DQUOTE || c === CHAR_SQUOTE || c === CHAR_LT || c === CHAR_GT || c === CHAR_AMP) return null;
      valueEnd++;
    }
    attrs.push([attrName, text.slice(quoteAt + 1, valueEnd)]);
    i = valueEnd + 1;
  }
}

/** A hex paint as six lowercase digits, or `undefined` when it is not a plain `#rgb`/`#rrggbb`. */
function normaliseHex(value: string): string | undefined {
  const match = FLAT_HEX_RE.exec(value);
  if (!match) return undefined;
  const digits = (match[1] ? [...match[1]].map((d) => d + d).join("") : match[2]!).toLowerCase();
  return `#${digits}`;
}

/** `attrs` are all allowed on `tag`, and its paint is one hex tone; returns that tone or `null`. */
function flatShapeTone(tag: string, attrs: FlatAttrs): string | null {
  const geometry = FLAT_SHAPE_GEOMETRY.get(tag);
  if (geometry === undefined) return null;
  const paint = new Map<string, string>();
  for (const [name, value] of attrs) {
    if (name === "fill" || name === "stroke") paint.set(name, value);
    else if (!(geometry.includes(name) || name === "transform" || name === "fill-rule" || name === "clip-rule" || FLAT_STROKE_ATTR_RE.test(name))) return null;
  }
  const tone = normaliseHex(paint.get("fill") ?? "");
  if (tone === undefined) return null;
  const stroke = paint.get("stroke");
  if (stroke !== undefined && stroke !== "none" && normaliseHex(stroke) !== tone) return null;
  return tone;
}

/**
 * The fail-closed recogniser behind {@link recolorSvg}'s knockout. Returns
 * the parsed mark only when the WHOLE document is a flat two-tone mark;
 * `null` for anything else, however close.
 *
 *  - root: `<svg>` with only `xmlns`, a parseable `viewBox`, `width`,
 *    `height`, `role`, `aria-label`, `data-clear-space` — no paint, no
 *    reference, no `id`. It is re-emitted from those constant names and
 *    the escaped values, double-quoted;
 *  - children: balanced `<g transform="…">` and self-closing `path`,
 *    `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`, carrying
 *    only geometry, `transform`, `fill`, `stroke`, `stroke-*`,
 *    `fill-rule`, `clip-rule`;
 *  - every attribute value free of `"` `'` `<` `>` `&`; only whitespace
 *    between tags (no text, comment, `<!`, `<?`, CDATA);
 *  - every shape has an explicit hex `fill` (`#rgb`/`#rrggbb`, alpha
 *    rejected) and its `stroke` is `none` or the same hex: one tone each;
 *  - exactly two tones, every first-tone shape before every second-tone one;
 *  - within the caps: at most {@link FLAT_MAX_ATTRIBUTES_PER_TAG}
 *    attributes on a tag, {@link FLAT_MAX_ELEMENTS} elements in all and
 *    {@link FLAT_MAX_DEPTH} groups deep. A document over a cap is not
 *    recognised, so it stays flat.
 *
 * Tags are read by {@link scanFlatTag}, a single non-backtracking pass, so
 * the whole recognition is linear in the input; its parse is iterative and
 * its render recursion is bounded by {@link FLAT_MAX_DEPTH}.
 */
function recogniseFlatTwoTone(svg: string): { root: string; box: NonNullable<ReturnType<typeof parseViewBoxBox>>; nodes: FlatNode[]; toneA: string } | null {
  const text = svg.trim();
  const rootTag = scanFlatTag(text, 0);
  if (rootTag === null || rootTag.name !== "svg" || rootTag.selfClosing) return null;
  // Re-emit the root from constant names and escaped values; never slice it out of the input.
  const rootAttrs: FlatAttrs = [];
  for (const [name, value] of rootTag.attrs) {
    const canonical = FLAT_ROOT_ATTRIBUTE_NAMES.get(name);
    if (canonical === undefined) return null;
    rootAttrs.push([canonical, value]);
  }
  const viewBox = rootAttrs.find(([name]) => name === "viewBox")?.[1];
  const box = viewBox === undefined ? undefined : parseViewBoxBox(viewBox);
  if (box === undefined) return null;
  const root = `<svg${rootAttrs.map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join("")}>`;

  const top: FlatNode[] = [];
  const open: FlatGroup[] = [];
  const siblings = (): FlatNode[] => (open.length > 0 ? open[open.length - 1]!.children : top);
  const tones: string[] = [];
  let seenSecondTone = false;
  let elements = 0;
  let at = rootTag.end;
  for (;;) {
    at = skipFlatSpace(text, at);
    const svgEnd = flatCloseTagEnd(text, at, "svg");
    if (svgEnd !== -1) return open.length === 0 && svgEnd === text.length && tones.length === 2 ? { root, box, nodes: top, toneA: tones[0]! } : null;
    const groupEnd = flatCloseTagEnd(text, at, "g");
    if (groupEnd !== -1) {
      if (open.length === 0) return null;
      open.pop();
      at = groupEnd;
      continue;
    }
    const tag = scanFlatTag(text, at);
    if (tag === null) return null;
    at = tag.end;
    elements++;
    if (elements > FLAT_MAX_ELEMENTS) return null;
    const { name, attrs, selfClosing } = tag;
    if (name === "g") {
      if (selfClosing || attrs.some(([attr]) => attr !== "transform") || open.length >= FLAT_MAX_DEPTH) return null;
      const group: FlatGroup = { kind: "group", transform: attrs[0]?.[1], children: [] };
      siblings().push(group);
      open.push(group);
      continue;
    }
    if (!selfClosing || !FLAT_SHAPE_GEOMETRY.has(name)) return null;
    const tone = flatShapeTone(name, attrs);
    if (tone === null) return null;
    if (!tones.includes(tone)) {
      if (tones.length === 2) return null;
      tones.push(tone);
    }
    if (tone === tones[1]) seenSecondTone = true;
    else if (seenSecondTone) return null;
    siblings().push({ kind: "shape", tag: name, attrs, tone });
  }
}

/**
 * One layer of the recognised mark as markup. `paintOf` gives the paint a
 * shape is drawn in for this layer, or `undefined` to leave the shape out;
 * a `stroke` of `none` stays `none`, every other stroke takes that paint.
 * Every other attribute is written back with its input value, which the
 * recogniser has already proved free of `"` `'` `<` `>` `&`. A group with
 * no shape left in this layer is dropped.
 */
function renderFlatNodes(nodes: readonly FlatNode[], paintOf: (shape: FlatShape) => string | undefined): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "group") {
      const inner = renderFlatNodes(node.children, paintOf);
      if (inner !== "") out += `<g${node.transform === undefined ? "" : ` transform="${escapeXml(node.transform)}"`}>${inner}</g>`;
      continue;
    }
    const paint = paintOf(node);
    if (paint === undefined) continue;
    const attrs = node.attrs
      .map(([name, value]) => ` ${escapeXml(name)}="${name === "fill" || (name === "stroke" && value !== "none") ? paint : escapeXml(value)}"`)
      .join("");
    out += `<${escapeXml(node.tag)}${attrs} />`;
  }
  return out;
}

/**
 * Best-effort structural recolour onto the single paint `color`.
 *
 * FLAT RECOLOUR (every input but one narrow kind, below): every
 * `fill`/`stroke` PAINT ATTRIBUTE value that is not
 * `none`/`transparent`/empty is replaced with `color`, and nothing else
 * changes. Deliberately narrow — it does not reach into a
 * `style="fill:#fff"` declaration or a `<style>` block, since either would
 * need a real CSS parser to rewrite safely; a mark that paints through
 * those, through paint inherited from an ancestor, or through `<use>` will
 * not recolour correctly. That limitation is why `adoptSuppliedMark`'s
 * derived variants are a starting point for review, not a guarantee.
 *
 * KNOCKOUT (#1537), only for a RECOGNISED FLAT TWO-TONE MARK. Flattening
 * a two-tone mark erases the contrast between its tones (a dark square
 * carrying a light figure becomes one flat square), so a mark that
 * `recogniseFlatTwoTone` accepts is instead recoloured as a knockout:
 * the first tone (A) and the second (B) are each painted in `color`, each
 * masked out wherever the other paints, so the surface (or `appIcon`'s
 * badge) shows through where they overlap. The contrast between the tones
 * becomes the contrast between `color` and what it sits on, the pair
 * `identity-checks.ts`'s contrast check already judges. The result is the
 * root start tag (re-emitted from its parsed attributes), a `<defs>` of two `<mask>`s (white coverage
 * over the root `viewBox`, the other tone painted `#000`), and two masked
 * `<g>` layers; `color` stays the only visible paint, so a `currentColor`
 * recolour keeps `mono`/`favicon` single-colour (mask paint is coverage,
 * not rendered colour, and `identity-checks.ts` skips the masks generated
 * here). Mask ids are `recolor-` plus a hash of `svg` and `color`. The
 * root is re-emitted from its parsed attributes (constant names, escaped
 * values, double-quoted), not sliced out of the input.
 *
 * WHAT IS RECOGNISED: the whole document is a flat mark: groups (with only
 * `transform`) and basic shapes (`path`, `rect`, `circle`, `ellipse`,
 * `polygon`, `polyline`, `line`) with an explicit hex `fill` (`#rgb` or
 * `#rrggbb`), every first-tone shape before every second-tone shape,
 * exactly two tones (`#fff` and `#FFFFFF` are one tone), and no ids,
 * references, styles, classes, text, comments or root paint. The root
 * carries only `xmlns`, a parseable `viewBox`, `width`, `height`, `role`,
 * `aria-label` and `data-clear-space`. Caps: at most 32 attributes on a
 * tag, 2000 elements in all and 32 groups deep.
 *
 * WHAT IS NOT: everything else stays FLAT, byte-identical to the previous
 * release: one tone, three or more tones, a tone order A-B-A, alpha or
 * named or `currentColor` paint, root or group paint, `<use>`, `<style>`,
 * `style=`, `class=`, any `id` or `url(#…)`, text, comments, and any
 * value containing a quote, `<` or `&`, and any input over a cap above. A
 * derived variant is therefore never broken by this function and never
 * gains an attribute its input lacked: the only names added are the
 * generated `mask`, `maskUnits`, `id`, `x`, `y`, `width` and `height`, no
 * id of the input is renamed, and no attribute value is rewritten beyond
 * its paint (a value is re-emitted double-quoted, which is safe because a
 * recognised value holds no quote). A mark outside the subset gets no
 * knockout, so its tone boundary is lost as it always was.
 */
export function recolorSvg(svg: string, color: string): string {
  const escapedColor = escapeXml(color);
  const mark = recogniseFlatTwoTone(svg);
  if (mark === null) {
    return svg.replace(PAINT_ATTR_RE, (match, attr: string, _quoted: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
      const value = doubleQuoted ?? singleQuoted ?? "";
      if (value === "none" || value === "transparent" || value === "") return match;
      return `${attr}="${escapedColor}"`;
    });
  }

  const { root, box, nodes, toneA } = mark;
  const id = `recolor-${fnv1a32Hex(`${svg}\u0000${color}`)}`;
  const region = `x="${round4(box.minX)}" y="${round4(box.minY)}" width="${round4(box.width)}" height="${round4(box.height)}"`;
  const mask = (suffix: string, hole: string): string => `<mask id="${id}-${suffix}" maskUnits="userSpaceOnUse" ${region}><rect ${region} fill="#fff" />${hole}</mask>`;
  const isA = (shape: FlatShape): boolean => shape.tone === toneA;
  const layerA = renderFlatNodes(nodes, (s) => (isA(s) ? escapedColor : undefined));
  const layerB = renderFlatNodes(nodes, (s) => (isA(s) ? undefined : escapedColor));
  const holesForA = renderFlatNodes(nodes, (s) => (isA(s) ? undefined : "#000"));
  const holesForB = renderFlatNodes(nodes, (s) => (isA(s) ? "#000" : undefined));
  return `${root}<defs>${mask("a", holesForA)}${mask("b", holesForB)}</defs><g mask="url(#${id}-a)">${layerA}</g><g mask="url(#${id}-b)">${layerB}</g></svg>`;
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
