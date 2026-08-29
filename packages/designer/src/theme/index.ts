/**
 * @clossys/designer/theme — the JavaScript half of this package's
 * theming contract, whose CSS half (`data-theme`, `prefers-color-scheme`)
 * already ships from `tokens.css`/`theme.css`. A SIBLING domain, like
 * `charts` and `shell`: it sits beside `atoms -> blocks`, not above or
 * below it, and it may import `atoms` and `icons` (its `Button`/`Icon`
 * atoms and glyph data) and nothing else in this package — see
 * `src/ladder.test.ts`, and this package's README, "Package structure".
 *
 * Three pieces ship:
 *
 *   1. `getThemeInitScript()` — a self-contained script, as a string, for
 *      a consumer's `<head>`, so the correct `data-theme` is stamped
 *      before first paint (see `initScript.ts`'s own doc comment for why
 *      this can't be a React component).
 *   2. `ThemeProvider`/`useTheme()` — holds the three-state preference,
 *      persists it, keeps `<html data-theme>`/`color-scheme` in sync, and
 *      resolves `"system"` against a live `prefers-color-scheme`
 *      subscription (see `ThemeProvider.tsx`).
 *   3. `ThemeToggle` — an accessible control built from this package's own
 *      `Button`/`Icon` atoms (see `ThemeToggle.tsx` for the interaction
 *      design and why).
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` is one of this package's optional peers — see `atoms/index.ts`'s
 * own, longer version of this comment for the full #182 rationale.
 * `ThemeProvider.tsx` and `ThemeToggle.tsx` both import `react` directly
 * (and `ThemeToggle.tsx` composes this package's own `Button`/`Icon`
 * atoms, but never imports `react-aria-components` itself), so this
 * barrel only needs the `react` guard, independent of `atoms/index.ts`'s:
 * a consumer who imports only `@clossys/designer/theme` would otherwise
 * get no signal at all.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { getThemeInitScript, type ThemeInitScriptOptions } from "./initScript.js";
export {
  DEFAULT_STORAGE_KEY,
  THEME_PREFERENCES,
  ThemeProvider,
  useTheme,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemePreference,
  type ThemeProviderProps,
} from "./ThemeProvider.js";
export { ThemeToggle, type ThemeToggleProps } from "./ThemeToggle.js";
