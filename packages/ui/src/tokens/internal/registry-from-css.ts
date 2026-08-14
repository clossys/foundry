/**
 * `registryFromDeclarations` — wraps a `Map<string, string>` of already-
 * parsed CSS custom-property declarations (from `parse-css.ts`'s
 * `parseRootDeclarations`/`parseDeclarationsForSelector`) into the
 * `Record<string, TokenDefinition>` shape `resolveTokenValue` and
 * `checkTokenContrast` both operate on.
 *
 * WHY THIS EXISTS: `TOKENS` (`tokens.ts`) carries exactly one value per
 * property — the LIGHT default — because that is the shape a JS/TS
 * consumer wants for "what does this token mean". `styles/tokens.css`
 * carries THREE: the light `:root` block, and two dark blocks
 * (`@media (prefers-color-scheme: dark) { :root:not(...) }` and
 * `:root[data-theme="dark"]`, kept identical by `theme-parity.test.ts`).
 * `contrast-cli.ts` needs to check BOTH themes against the same
 * `CONTRAST_PAIRS` — the same two-theme sweep `contrast.test.ts` already
 * performs by hand — so it parses `styles/tokens.css` itself (via
 * `parse-css.ts`) into two declaration maps and turns each into its own
 * registry with this function, rather than the CLI running only against
 * `TOKENS`'s light-only values and silently never checking dark mode.
 *
 * The `TokenDefinition` fields beyond `property`/`value` — `family`,
 * `brandable`, `themeDependent` — are metadata `resolveTokenValue`/
 * `checkTokenContrast` never read; they exist on `TokenDefinition` for
 * `TOKENS`'s own real, hand-curated purpose (see `tokens.ts`), not for a
 * registry synthesized purely to answer "what literal value does this
 * property resolve to in THIS theme". This function fills them with a
 * fixed placeholder rather than omitting them, so the result is a real,
 * fully-typed `TokenDefinition` a caller can pass anywhere one is
 * expected — never a parallel, narrower type that would need its own
 * seam through every function that already accepts a token registry.
 */

import type { TokenDefinition, TokenFamily } from "../tokens.js";

/**
 * Unused by anything this registry is built for (see this file's header) —
 * picked arbitrarily from the real `TokenFamily` union rather than adding
 * a new "unknown" member to that type just for a placeholder no caller
 * ever inspects.
 */
const PLACEHOLDER_FAMILY: TokenFamily = "surface";

export function registryFromDeclarations(
  declarations: ReadonlyMap<string, string>,
): Readonly<Record<string, TokenDefinition>> {
  const registry: Record<string, TokenDefinition> = {};
  for (const [property, value] of declarations) {
    registry[property] = {
      property,
      family: PLACEHOLDER_FAMILY,
      value,
      brandable: false,
      themeDependent: false,
    };
  }
  return registry;
}

/**
 * Layers `overrides` on top of `base`, the same way a REAL browser cascade
 * layers `:root[data-theme="dark"]` on top of `:root` — both selectors
 * match the same `<html>` element, so a custom property the dark block
 * does not redeclare keeps whatever `:root` already gave it, rather than
 * disappearing.
 *
 * WHY THIS MATTERS HERE SPECIFICALLY: `styles/tokens.css`'s own header
 * comment documents exactly this for a handful of color tokens that are
 * themselves `var(--other, ...)` ALIASES (`--color-chart-surface`,
 * `--color-chart-axis`, `--color-chart-axis-label`, `--color-ink-on-
 * accent`, `--color-overlay-surface`, `--color-overlay-border`,
 * `--color-skeleton-fill`, `--ui-elevation-raised`): "An alias's specified
 * value never changes between themes — only the token it POINTS to does —
 * so re-declaring the alias in the dark blocks would be a no-op at best
 * and a drift hazard at worst." Building a dark-theme registry from
 * `parseDeclarationsForSelector(css, ':root[data-theme="dark"]')` ALONE —
 * without this merge — silently loses every one of those aliases: they
 * have no entry in `:root[data-theme="dark"]`'s own declaration block at
 * all, so `resolveTokenValue` would report them as `unresolvable-token`
 * findings in dark mode, a false "could not check" for tokens that
 * resolve perfectly well in a real browser. `contrast.test.ts`'s own
 * `themeFrom()` works around the identical gap by hand, one alias at a
 * time (reading `--color-surface-raised` from the dark map in place of
 * `--color-chart-surface`, etc.) — this function is the general version
 * of that same fix, so `contrast-cli.ts` does not need to hand-list every
 * alias itself.
 */
export function mergeDeclarations(
  base: ReadonlyMap<string, string>,
  overrides: ReadonlyMap<string, string>,
): Map<string, string> {
  const merged = new Map(base);
  for (const [property, value] of overrides) {
    merged.set(property, value);
  }
  return merged;
}
