/**
 * @vespeneventures/ui/theme/server — the server-safe subset of
 * `@vespeneventures/ui/theme`. See `atoms/server.ts`'s own header for the
 * full #375 rationale this file shares: `theme/index.ts` re-exports every
 * member eagerly from one module, so `ThemeProvider` (a genuine client
 * context provider, `createContext` at module scope) and `ThemeToggle`
 * (built on this package's own `Button`, which needs `useContext`) drag
 * the whole barrel down under React's `react-server` condition even
 * though `getThemeInitScript` resolves cleanly on its own — it is a plain
 * function returning a string for a consumer's `<head>`, with no React
 * import at all (see `initScript.ts`'s own source).
 *
 * MEMBERSHIP IS EMPIRICAL — confirmed by resolving `dist/theme/initScript.js`
 * directly (never the barrel) under `node --conditions=react-server`. See
 * `src/render-environment.ts` for the recorded verdict and
 * `render-environment.test.ts` for the negative control proving
 * `theme/index.ts` still fails the identical probe.
 *
 * No `react` peer guard here, unlike this package's other server
 * subpaths (`atoms/server.ts`, `blocks/server.ts`, ...):
 * `getThemeInitScript` has no runtime dependency on `react` at
 * all (confirmed by grep against `initScript.ts`), so guarding it would
 * add a check this file has nothing to protect.
 *
 * ADDITIVE ONLY: `getThemeInitScript` already ships from
 * `theme/index.ts`. No wildcard subpath, no per-file deep export — see
 * `atoms/server.ts`'s header for why.
 */

export { getThemeInitScript, type ThemeInitScriptOptions } from "./initScript.js";
