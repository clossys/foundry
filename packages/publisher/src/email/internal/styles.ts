/**
 * Typography and color for each `ElementKind`, as LITERAL inline `style="
 * ..."` strings — the email-specific consumer of this package's shared
 * `internal/tokens.ts` (colour) and `internal/typography.ts` (font size and
 * family).
 *
 * WHY EVERY VALUE HERE MUST BE LITERAL
 * ---------------------------------------
 * No email client supports CSS custom properties, and none support
 * `oklch()` — see `internal/tokens.ts`'s own top comment, and this
 * package's README, "Shared internals". So this file never emits
 * `var(--...)` or `oklch(...)` anywhere; every color reaching an emitted
 * `style` attribute is first resolved through `flattenTokens`, which
 * returns literal `#rrggbb`/`#rrggbbaa` hex. `renderEmailDocument.test.ts`
 * asserts this with a regex over the whole rendered document — see that
 * file for why a golden test alone (which only proves ONE input produces
 * the right bytes) is not enough of a guarantee on its own.
 *
 * THE TOKENS THIS FILE READS
 * -------------------------------
 * A small, fixed subset of `@clossys/designer/tokens`' 154-entry registry —
 * just the roles an email needs: ink (heading/body/muted/on-accent text),
 * surface (page/card background), line (dividers), accent (buttons,
 * eyebrows), plus the `--spacing-*` scale (already literal, e.g. `"15px"`,
 * not `"var(...)"` or `"oklch(...)"`, in `TOKENS` itself, so `flattenTokens`
 * passes it through unchanged — see that function's own doc comment, step
 * 4, "a value with none [no `oklch(...)`] is returned unchanged"). Font
 * size and family are resolved separately, through `internal/
 * typography.ts` — see below.
 *
 * PER-ELEMENT-KIND STYLE, WITH A PER-SLOT TYPOGRAPHY OVERRIDE
 * -----------------------------------------------------------------
 * `SlotBinding` carries only a `copyId`/`value` string — no font, no
 * color, no size (see `@clossys/publisher/core`'s own README, "Only
 * plain text ever fills a slot", the same rule `./web`'s own
 * `renderWebDocument.ts` documents). A resolved slot's OTHER two pieces of
 * visual information are its `SlotSpec.element: ElementKind` — this file's
 * `ELEMENT_STYLES` fixed mapping, applied uniformly regardless of which
 * specific document is being rendered — and, optionally, its
 * `SlotSpec.style: StyleBinding`. Of `StyleBinding`'s fields, this file
 * resolves exactly one: `.typography`, via `../../internal/typography.ts`'s
 * `resolveElementTypography` — when present, it OVERRIDES `element`'s own
 * default `--text-*` size role (see that module's own doc comment for the
 * full resolution rule, including its `"unknown-style-role"` refusal for an
 * unknown or non-size role). `.color`/`.background`/`.border`/`.weight` are
 * not resolved here — this channel's own fixed `colorToken` per
 * `ElementKind` already covers color, and `.border`/`.weight` have the same
 * "no founded mapping exists yet" gap `../../print/internal/style.ts`
 * documents for itself.
 */

import type { ElementKind, StyleBinding } from "../../core/index.js";
import { flattenTokens } from "../../internal/tokens.js";
import { ELEMENT_FONT_FAMILY_ROLE, resolveElementTypography } from "../../internal/typography.js";

/** `flattenTokens`'s output, cached — every color/size/font this file (and `renderEmailDocument.ts`, for the body/wrapper chrome) reads is looked up from this single flattened map, built once per render via {@link buildEmailPalette}. */
export type EmailPalette = ReadonlyMap<string, string>;

/** Builds the flattened token palette a single `renderEmailDocument` call uses. `brand` is the same override map `flattenTokens` itself accepts — see `internal/tokens.ts` — passed straight through, so `RenderEmailOptions.brand` is exactly "a `flattenTokens` override object," nothing more. */
export function buildEmailPalette(brand?: Record<string, string>): EmailPalette {
  return flattenTokens(brand);
}

/**
 * Looks up a token by its `--name` in an {@link EmailPalette}, throwing
 * rather than silently falling back if this file names a token that
 * doesn't exist in `TOKENS` — a typo here should fail loudly in this
 * package's own tests, not ship a blank color.
 *
 * Every double quote in the resolved value is rewritten to a single quote
 * before it's returned. `TOKENS`' `--font-display`/`--font-body`/
 * `--font-mono` values quote multi-word family names the standard CSS way
 * (`"Segoe UI"`), which is exactly right inside a real `<style>` block or
 * a `.css` file — and exactly wrong once substituted into THIS file's
 * output, which lands inside an HTML `style="..."` attribute delimited by
 * DOUBLE quotes. An unrewritten `"Segoe UI"` would close that attribute
 * early, right after `-apple-system, `, and spill the rest of the
 * font-family list and every property after it into the element as
 * literal unquoted HTML — not a cosmetic bug, a broken document. CSS
 * treats single- and double-quoted strings identically, so
 * `'Segoe UI'` is not a lossy escape; it's the one quoting style that
 * survives being embedded in a double-quoted attribute.
 */
export function readEmailToken(palette: EmailPalette, name: string): string {
  const value = palette.get(name);
  if (value === undefined) {
    throw new Error(`email/internal/styles.ts: token "${name}" is not in the flattened palette — this is a bug in this file, not caller input.`);
  }
  return value.replace(/"/g, "'");
}

/** One `ElementKind`'s literal, email-safe presentation — everything EXCEPT font size (resolved per-slot via `../../internal/typography.ts`, since `style.typography` can override it) and font family (still fixed per `ElementKind`, via `ELEMENT_FONT_FAMILY_ROLE` — see this file's own top comment for why `StyleBinding` has no family-override field at all). */
interface EmailElementStyle {
  weight: string;
  colorToken: string;
  lineHeight: string;
  textAlign?: "left" | "center";
  textTransform?: "uppercase";
  letterSpacing?: string;
  /** When set, the `<td>` also gets this literal background color and horizontal padding/border-radius, for a button-like badge. */
  backgroundToken?: string;
}

const ELEMENT_STYLES: Record<ElementKind, EmailElementStyle> = {
  heading: { weight: "700", colorToken: "--color-ink-primary", lineHeight: "1.25" },
  subheading: { weight: "700", colorToken: "--color-ink-primary", lineHeight: "1.3" },
  stat: { weight: "700", colorToken: "--color-ink-primary", lineHeight: "1.2" },
  eyebrow: { weight: "700", colorToken: "--color-accent", lineHeight: "1.4", textTransform: "uppercase", letterSpacing: "0.08em" },
  label: { weight: "600", colorToken: "--color-ink-secondary", lineHeight: "1.4" },
  body: { weight: "400", colorToken: "--color-ink-secondary", lineHeight: "1.6" },
  list: { weight: "400", colorToken: "--color-ink-secondary", lineHeight: "1.6" },
  image: { weight: "400", colorToken: "--color-ink-muted", lineHeight: "1.4", textAlign: "center" },
  logo: { weight: "700", colorToken: "--color-ink-primary", lineHeight: "1.3", textAlign: "center" },
  button: { weight: "600", colorToken: "--color-ink-on-accent", lineHeight: "1.4", textAlign: "center", backgroundToken: "--color-accent" },
  divider: { weight: "400", colorToken: "--color-ink-muted", lineHeight: "1.4" },
  fill: { weight: "400", colorToken: "--color-ink-secondary", lineHeight: "1.6" },
};

/** The literal `style="..."` attribute VALUE (no surrounding quotes) for one resolved slot's `<td>`, built from `element`'s fixed presentation in {@link ELEMENT_STYLES}, `palette`, and (for font size only) `style?.typography`. Always includes `mso-line-height-rule:exactly` — Outlook's Word rendering engine otherwise applies its own line-height heuristic instead of the literal one this file sets, one of the `mso-` properties this channel's own task brief calls out by name. `"divider"` additionally gets a literal top border in `--color-line-base`; `"button"` additionally gets a literal background, horizontal padding, and border-radius, all resolved through `palette` the same as every color/size here. `ownerDescription` (e.g. `slot "headline"`) names what `style` belongs to, for `resolveElementTypography`'s own thrown message if `style.typography` names an unknown or non-size role. */
export function tdStyleForElement(
  element: ElementKind,
  palette: EmailPalette,
  style: StyleBinding | undefined,
  ownerDescription: string,
): string {
  const elementStyle = ELEMENT_STYLES[element];
  const spacingLg = readEmailToken(palette, "--spacing-lg");
  const spacingXl = readEmailToken(palette, "--spacing-xl");

  const typography = resolveElementTypography(element, style, ownerDescription, palette);
  const fontFamily = readEmailToken(palette, ELEMENT_FONT_FAMILY_ROLE[element]);

  const parts = [
    `font-family:${fontFamily}`,
    `font-size:${typography.css}`,
    `font-weight:${elementStyle.weight}`,
    `line-height:${elementStyle.lineHeight}`,
    `color:${readEmailToken(palette, elementStyle.colorToken)}`,
    `mso-line-height-rule:exactly`,
    `margin:0`,
  ];

  if (elementStyle.textAlign) parts.push(`text-align:${elementStyle.textAlign}`);
  if (elementStyle.textTransform) parts.push(`text-transform:${elementStyle.textTransform}`);
  if (elementStyle.letterSpacing) parts.push(`letter-spacing:${elementStyle.letterSpacing}`);

  if (element === "divider") {
    parts.push(`border-top:1px solid ${readEmailToken(palette, "--color-line-base")}`);
    parts.push(`padding:${spacingLg} ${spacingXl} 0 ${spacingXl}`);
  } else if (elementStyle.backgroundToken) {
    parts.push(`background-color:${readEmailToken(palette, elementStyle.backgroundToken)}`);
    parts.push(`border-radius:${readEmailToken(palette, "--radius-control")}`);
    parts.push(`padding:${readEmailToken(palette, "--spacing-md")} ${spacingXl}`);
  } else {
    parts.push(`padding:${spacingLg} ${spacingXl}`);
  }

  return parts.join(";") + ";";
}
