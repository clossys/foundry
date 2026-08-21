/**
 * `ElementKind` -> real `@vespeneventures/designer/tokens` typography, resolved to
 * literal values — the shared foundation every non-web channel this
 * package ships (`./email`, `./print`, `./image`, `./slides`) reads from,
 * built once here rather than reinvented (and re-drifted) four times.
 *
 * THE PROBLEM THIS FILE FIXES
 * ---------------------------
 * `@vespeneventures/designer/tokens` DOES ship a full typography scale — 13 `text`
 * tokens (a size scale, `--text-caption` through `--text-display-xl`), 3
 * `font` tokens (font-family stacks), 4 `tracking` tokens (letter-spacing)
 * — see `TOKENS` and this file's own test, which asserts every role this
 * file names actually exists there. Before this file existed, two of this
 * package's four non-web channels ignored that scale entirely: `./print`
 * emitted no `font-size`/`font-family` at all (relying on whatever default
 * the receiving browser or print pipeline happened to pick), and
 * `./image`/`./slides` used a hand-picked, undocumented pixel table
 * (`DEFAULT_FONT_SIZE_PX`, now deleted from `../image/engine.ts`) whose own
 * doc comment falsely claimed "no real typography token to resolve
 * instead." `./email` was the one channel already doing this right (see
 * its own `internal/styles.ts`, pre-existing `ELEMENT_STYLES` table) — its
 * size/family mapping is exactly what {@link ELEMENT_TYPOGRAPHY_ROLE}/
 * {@link ELEMENT_FONT_FAMILY_ROLE} below now centralize, so every channel
 * (including `./email` itself) reads the SAME defensible mapping rather
 * than four independently-drifting copies of it.
 *
 * THE MAPPING — ONE ROLE PER ElementKind, DOCUMENTED, TESTED
 * -------------------------------------------------------------
 * `StyleBinding` (`@vespeneventures/publisher/core`'s frozen contract) carries no
 * font information beyond a `typography` token-role-name field — no
 * numeric size, no family. A resolved slot's only OTHER visual hint is its
 * `SlotSpec.element: ElementKind`, a closed 12-member vocabulary. So this
 * file's whole job is two fixed, one-role-per-`ElementKind` maps:
 *
 *   - {@link ELEMENT_TYPOGRAPHY_ROLE} — which `--text-*` SIZE role a slot
 *     of this `ElementKind` uses by default. The scale-position choice
 *     mirrors typical editorial hierarchy: `heading`/`logo` sit at
 *     `--text-h1`/`--text-h2` (a page-level headline and a wordmark are
 *     both "the biggest thing on the canvas that isn't a hero stat"),
 *     `stat` gets its own `--text-display-m` (a callout number is
 *     deliberately louder than a heading), `eyebrow`/`label`/`image`/
 *     `divider` sit at the small end (`--text-caption`/`--text-body-s` —
 *     supporting/meta text), and `body`/`list`/`button`/`fill` share
 *     `--text-body` (ordinary running text and anything with no more
 *     specific role).
 *   - {@link ELEMENT_FONT_FAMILY_ROLE} — which `--font-*` FAMILY role a
 *     slot of this `ElementKind` uses: `--font-display` for the four kinds
 *     that read as a headline/wordmark (`heading`, `subheading`, `stat`,
 *     `logo`), `--font-body` for everything else. `--font-mono` has no
 *     `ElementKind` mapped to it — nothing in this closed vocabulary
 *     represents code/monospace content, so mapping any kind to it would
 *     be an unfounded guess, not a documented decision; a caller with a
 *     genuine code-sample slot can still reach `--font-mono` explicitly via
 *     `StyleBinding.typography` overriding the SIZE role only (this
 *     ecosystem's `StyleBinding` has no separate family-override field —
 *     see `@vespeneventures/publisher/core`'s own `types.ts`).
 *
 * Every value in both maps is asserted, in this file's own test, to be a
 * REAL key in `@vespeneventures/designer/tokens`' `TOKENS` registry — see
 * `typography.test.ts`, "the mapping cannot rot silently." A token rename
 * that isn't mirrored here fails that test loudly, at build/CI time,
 * rather than shipping every non-web channel a font-size of `undefined`.
 *
 * `StyleBinding.typography` OVERRIDES THE DEFAULT — NEVER A SILENT FALLBACK
 * ---------------------------------------------------------------------------
 * {@link resolveElementTypography} is every channel's one entry point:
 * `style?.typography` (a token ROLE NAME, e.g. `"--text-display-l"`) wins
 * when present; the `ElementKind` default above is used otherwise. Either
 * way, the role is resolved against an already-`flattenTokens()`-ed map —
 * never a second, parallel token-reading path (this file adds none; it
 * reuses `../internal/tokens.ts`'s `resolveTokenRef` exactly). A role that
 * names no entry in `flat` — whether it's THIS FILE'S OWN default mapping
 * gone stale (should never happen; see the test above) or a caller-supplied
 * override that is a typo or a genuinely non-existent token — throws
 * `RenderError("unknown-style-role", ...)`. That reason already exists
 * (`internal/errors.ts`, added alongside `./print`'s own `internal/
 * style.ts`, which does the identical thing for `.color`/`.background`) and
 * is reused here rather than adding a new one, per this file's own
 * discipline: never a plausible-looking wrong font size, exactly the same
 * "never a silent fallback" bar `internal/tokens.ts` holds for color.
 *
 * A role that DOES exist in `flat` but is not a pixel size (e.g. a caller
 * mistakenly points `StyleBinding.typography` at a color role like
 * `"--color-accent"`) is caught too: every real `--text-*` token's value is
 * a literal `"<number>px"` string (see `TOKENS`), so
 * {@link resolveElementTypography} additionally validates that shape and
 * throws the same `"unknown-style-role"` when it doesn't match — "resolves
 * to SOME string" is not the same guarantee as "resolves to a usable font
 * size," and this file holds itself to the latter.
 */

import type { ElementKind } from "../core/index.js";
import { RenderError } from "./errors.js";
import { resolveTokenRef } from "./tokens.js";

// ─────────────────────────────────────────────────────────────────────────
// The default ElementKind -> token-role maps
// ─────────────────────────────────────────────────────────────────────────

/**
 * `ElementKind` -> the `--text-*` SIZE token role a slot of that kind uses
 * when `StyleBinding.typography` gives no override. See this file's own
 * top comment for the reasoning behind each choice; see `typography.test.ts`
 * for the assertion that every value here is a real `TOKENS` entry.
 */
export const ELEMENT_TYPOGRAPHY_ROLE: Readonly<Record<ElementKind, string>> = {
  heading: "--text-h1",
  subheading: "--text-h2",
  stat: "--text-display-m",
  eyebrow: "--text-caption",
  label: "--text-body-s",
  body: "--text-body",
  list: "--text-body",
  image: "--text-body-s",
  logo: "--text-h2",
  button: "--text-body",
  divider: "--text-body-s",
  fill: "--text-body",
};

/**
 * `ElementKind` -> the `--font-*` FAMILY token role a slot of that kind
 * uses. There is no `StyleBinding` field to override this per slot (see
 * this file's own top comment) — it is always exactly this fixed mapping.
 */
export const ELEMENT_FONT_FAMILY_ROLE: Readonly<Record<ElementKind, string>> = {
  heading: "--font-display",
  subheading: "--font-display",
  stat: "--font-display",
  eyebrow: "--font-body",
  label: "--font-body",
  body: "--font-body",
  list: "--font-body",
  image: "--font-body",
  logo: "--font-display",
  button: "--font-body",
  divider: "--font-body",
  fill: "--font-body",
};

// ─────────────────────────────────────────────────────────────────────────
// resolveElementTypography — the one entry point every channel calls
// ─────────────────────────────────────────────────────────────────────────

/** Every real `--text-*` token in `TOKENS` is a literal `"<number>px"` string — see this file's top comment, "not a usable font size." */
const FONT_SIZE_PX_RE = /^(-?\d+(?:\.\d+)?)px$/;

export interface ResolvedTypography {
  /** The token role actually used — `style.typography` when given, else `ELEMENT_TYPOGRAPHY_ROLE[element]`. */
  role: string;
  /** The literal resolved value, exactly as `TOKENS` stores it (e.g. `"28px"`) — ready to drop straight into a CSS `font-size` declaration. */
  css: string;
  /** `css`, parsed to a bare number (e.g. `28`) — what `./image`/`./slides`' SVG `font-size` attribute and `wrapText`'s geometry math need. */
  px: number;
}

/**
 * Resolves the font SIZE for one slot: `style?.typography` (a token role
 * name) when present, else `ELEMENT_TYPOGRAPHY_ROLE[element]`, looked up
 * against `flat` (an already-`flattenTokens()`-ed map — see
 * `../internal/tokens.ts`). Uses `resolveTokenRef` for the actual lookup
 * (wrapping the role as `var(${role})`, the same trick `../image/
 * engine.ts`'s `resolveColorRole` uses) — never a second, hand-rolled
 * `Map.get`, so a role that is itself an alias chain resolves exactly like
 * every other token reference in this package does.
 *
 * `ownerDescription` names what `style` belongs to (e.g. `slot "headline"`,
 * or `"<page>"` for a channel-level default) — threaded straight into the
 * thrown message, the same convention `../print/internal/style.ts`'s own
 * `resolveRole` already established for `.color`/`.background`.
 *
 * THROWS, NEVER FALLS BACK
 * -------------------------
 *   - `RenderError("unknown-style-role", ...)` — the role (default OR
 *     override) names no entry in `flat` at all.
 *   - `RenderError("unknown-style-role", ...)` — the role resolves to a
 *     real value that is not a `"<number>px"` string (see `FONT_SIZE_PX_RE`
 *     above) — a role that exists but isn't usable as a font size is just
 *     as much a caller error as one that doesn't exist, and gets the same
 *     reason rather than a new one.
 */
export function resolveElementTypography(
  element: ElementKind,
  style: { typography?: string } | undefined,
  ownerDescription: string,
  flat: ReadonlyMap<string, string>,
): ResolvedTypography {
  const role = style?.typography ?? ELEMENT_TYPOGRAPHY_ROLE[element];

  if (!flat.has(role)) {
    throw new RenderError(
      "unknown-style-role",
      `resolveElementTypography: ${ownerDescription}'s ${style?.typography !== undefined ? "style.typography" : `ElementKind ("${element}") default typography role`} names token role "${role}", which is not a property in @vespeneventures/designer/tokens' TOKENS registry (checked after flattening — see the shared internal/tokens.ts's flattenTokens()). A role name here must be the exact token custom-property name, e.g. "--text-h1".`,
    );
  }

  const css = resolveTokenRef(`var(${role})`, flat);
  const match = FONT_SIZE_PX_RE.exec(css);
  if (!match) {
    throw new RenderError(
      "unknown-style-role",
      `resolveElementTypography: ${ownerDescription}'s ${style?.typography !== undefined ? "style.typography" : `ElementKind ("${element}") default typography role`} names token role "${role}", which resolves to ${JSON.stringify(css)} — not a pixel font-size ("<number>px"). Only a --text-* size role is valid here.`,
    );
  }

  return { role, css, px: Number(match[1]) };
}

/**
 * Resolves the font FAMILY for one `ElementKind`, via
 * {@link ELEMENT_FONT_FAMILY_ROLE} — always the default; no `StyleBinding`
 * field overrides this (see this file's top comment). Returns the RAW
 * literal token value exactly as `TOKENS` stores it (e.g.
 * `system-ui, ui-sans-serif, -apple-system, "Segoe UI", sans-serif`,
 * embedded double quotes and all) — embedding that safely into a
 * double-quoted HTML `style="..."` attribute or an XML attribute is each
 * CALLER's job (see `../email/internal/styles.ts`'s `readEmailToken` for
 * the HTML-attribute quote-rewrite, and `../image/engine.ts`'s `escapeXml`
 * for the XML-attribute entity-escape) — this file stays agnostic about
 * which embedding context a given channel uses, the same way `../internal/
 * tokens.ts`'s own `flattenTokens` never assumes one either.
 *
 * Throws `RenderError("unknown-style-role", ...)` if `ELEMENT_FONT_FAMILY_ROLE[element]`
 * itself names no entry in `flat` — should never happen given this file's
 * own test, but this function holds to the same "never silently fall back"
 * discipline as {@link resolveElementTypography} rather than assuming its
 * own mapping can't be wrong.
 */
export function resolveElementFontFamily(element: ElementKind, flat: ReadonlyMap<string, string>): string {
  const role = ELEMENT_FONT_FAMILY_ROLE[element];
  if (!flat.has(role)) {
    throw new RenderError(
      "unknown-style-role",
      `resolveElementFontFamily: ElementKind ("${element}") default font-family role names token role "${role}", which is not a property in @vespeneventures/designer/tokens' TOKENS registry (checked after flattening) — this is a bug in this file's own mapping, not caller input.`,
    );
  }
  return resolveTokenRef(`var(${role})`, flat);
}
