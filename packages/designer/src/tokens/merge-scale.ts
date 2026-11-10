// Component imports need token data, not the token tools' Node-only guards.
import { TOKENS } from "./tokens.js";

/** The suffixes of every token under one CSS custom-property namespace (`--spacing-` -> `xs`, `sm`, ...). */
function tokenSuffixes(cssPropertyPrefix: `--${string}-`): string[] {
  return Object.keys(TOKENS)
    .filter((property) => property.startsWith(cssPropertyPrefix))
    .map((property) => property.slice(cssPropertyPrefix.length));
}

/**
 * The Foundry theme's spacing and radius scale keys, in tailwind-merge's theme shape. The default
 * merge configuration only knows Tailwind's numeric spacing and t-shirt radius names, so `gap-lg`
 * and a consumer's `gap-sm` would both survive a stock `cn`. Derived from `TOKENS`, never listed by hand.
 */
export const MERGE_THEME_SCALE = {
  spacing: tokenSuffixes("--spacing-"),
  radius: tokenSuffixes("--radius-"),
} as const;
