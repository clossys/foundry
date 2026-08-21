/**
 * `StyleBinding` -> literal CSS. Colour (`.color`/`.background`) resolves
 * directly against the shared `internal/tokens.ts`'s `flattenTokens()`
 * output, i.e. a role name IS the exact `@vespeneventures/designer/tokens`
 * custom-property name (`"--color-ink-primary"`, not `"ink-primary"`) — the
 * same map `flattenTokens` itself is keyed by. Typography (font size and
 * family) resolves through the shared `../../internal/typography.ts`
 * resolver instead — see {@link resolveStyleTypography} below for why that
 * is a separate function from {@link resolveStyleColors}, not folded into
 * it.
 *
 * `StyleBinding.border` AND `.weight` ARE STILL DELIBERATELY NOT RESOLVED
 * -------------------------------------------------------------------------
 * `border` would need a width/style this frozen contract has no field for,
 * and `weight` names a font-weight this ecosystem's token registry has no
 * scale for at all (`TOKENS` ships a `text` size scale and a `font` family
 * scale — see `../../internal/typography.ts`'s own top comment — but no
 * `weight` family). Inventing an unfounded mapping for either risks the
 * exact failure `internal/tokens.ts`'s own doc comment warns against — "a
 * plausible-looking wrong colour" (or, here, a plausible-looking wrong
 * border/weight) is worse than leaving a field unhandled and saying so. See
 * this package's README, "Found but not fixed", and this file stays the one
 * place that remaining gap is documented in code. `.typography` USED to be
 * grouped with these two — it no longer is, now that `../../internal/
 * typography.ts` gives this package a real, tested mapping to resolve it
 * against (see this package's CHANGELOG for the change).
 */

import type { ElementKind, StyleBinding } from "../../core/index.js";
import { RenderError } from "../../internal/errors.js";
import { resolveElementFontFamily, resolveElementTypography } from "../../internal/typography.js";

/** The two CSS declarations this channel currently derives from a `StyleBinding` — `color`/`background`, resolved to literal hex, ready to drop straight into an inline `style="..."` attribute. */
export interface ResolvedStyleColors {
  color?: string;
  backgroundColor?: string;
}

/**
 * Looks `role` up in `flat` (an already-`flattenTokens()`-ed map). Throws
 * `RenderError("unknown-style-role", ...)` — never a silent fallback
 * colour — when `role` names no entry, naming `ownerDescription` (e.g. a
 * slot key, or `"<page>"` for `LayoutSpec.background`) and `field`
 * (`"color"`/`"background"`) so the error is actionable.
 */
function resolveRole(
  role: string | undefined,
  field: "color" | "background",
  ownerDescription: string,
  flat: ReadonlyMap<string, string>,
): string | undefined {
  if (role === undefined) return undefined;
  const value = flat.get(role);
  if (value === undefined) {
    throw new RenderError(
      "unknown-style-role",
      `renderPrintDocument: ${ownerDescription}'s style.${field} names token role "${role}", which is not a ` +
        `property in @vespeneventures/designer/tokens' TOKENS registry (checked after flattening — see the shared ` +
        `internal/tokens.ts's flattenTokens()). A role name here must be the exact token custom-property name, ` +
        `e.g. "--color-ink-primary".`,
    );
  }
  return value;
}

/** Resolves `style.color`/`style.background` (when present) against `flat`. `ownerDescription` names what `style` belongs to, for the thrown error's message. */
export function resolveStyleColors(
  style: StyleBinding | undefined,
  ownerDescription: string,
  flat: ReadonlyMap<string, string>,
): ResolvedStyleColors {
  if (style === undefined) return {};
  const color = resolveRole(style.color, "color", ownerDescription, flat);
  const backgroundColor = resolveRole(style.background, "background", ownerDescription, flat);
  return {
    ...(color !== undefined ? { color } : {}),
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Typography — font-size/font-family, resolved through internal/typography.ts
// ─────────────────────────────────────────────────────────────────────────

/** The literal `font-size`/`font-family` CSS values for one slot, ready to drop straight into an inline `style="..."` attribute. */
export interface ResolvedStyleTypography {
  fontSize: string;
  fontFamily: string;
}

/**
 * A browser's print pipeline DOES understand a real `<style>` block, so this
 * file COULD emit `font-family` as a bare CSS declaration with real double
 * quotes around a multi-word family name (`"Segoe UI"`) — the normal,
 * correct CSS quoting. It cannot here, because `internal/document.ts`
 * embeds this value inside a double-quoted HTML `style="..."` ATTRIBUTE, not
 * a `<style>` block: an unrewritten `"Segoe UI"` would close that attribute
 * early and spill the rest of the declaration list into the document as
 * literal unquoted HTML — not cosmetic, a broken document. This rewrite is
 * the exact same fix `../../email/internal/styles.ts`'s `readEmailToken`
 * applies for the identical reason (email's `<td style="...">` is the same
 * double-quoted-attribute shape); CSS treats single- and double-quoted
 * strings identically, so `'Segoe UI'` loses nothing.
 */
function toAttributeSafeCss(value: string): string {
  return value.replace(/"/g, "'");
}

/**
 * Resolves the font size and family for one slot of `ElementKind` `element`:
 * `style?.typography` (a token role name) overrides `element`'s own
 * `ELEMENT_TYPOGRAPHY_ROLE` default when present — see `../../internal/
 * typography.ts`'s `resolveElementTypography` for the full resolution rule,
 * including the `"unknown-style-role"` refusal for an unknown or non-size
 * role (never a silent fallback size). Font family has no `StyleBinding`
 * override field at all (see this file's own top comment) — it is always
 * `ELEMENT_FONT_FAMILY_ROLE[element]`, via `resolveElementFontFamily`.
 *
 * Both resolved literals are rewritten via {@link toAttributeSafeCss} before
 * being returned, since every caller of this function embeds the result
 * inside a double-quoted HTML `style="..."` attribute (`internal/slot.ts`) —
 * `font-size` values (`"28px"`) never need it, but this function applies it
 * uniformly rather than trusting each caller to remember which of the two
 * fields might contain a `"`.
 */
export function resolveStyleTypography(
  element: ElementKind,
  style: StyleBinding | undefined,
  ownerDescription: string,
  flat: ReadonlyMap<string, string>,
): ResolvedStyleTypography {
  const typography = resolveElementTypography(element, style, ownerDescription, flat);
  const fontFamily = resolveElementFontFamily(element, flat);
  return {
    fontSize: toAttributeSafeCss(typography.css),
    fontFamily: toAttributeSafeCss(fontFamily),
  };
}
