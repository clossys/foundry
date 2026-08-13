import { applyThemeDom, DEFAULT_STORAGE_KEY, readStoredPreference } from "./internal/theme-core.js";

export interface ThemeInitScriptOptions {
  /** @default "ui-theme" */
  storageKey?: string;
}

/**
 * THE FLASH-OF-WRONG-THEME PROBLEM, and why this exists.
 *
 * `ThemeProvider` applies the stored preference from a `useEffect` — it
 * has to, since reading `localStorage` during render is unsafe for SSR
 * (see this file's own "SSR SAFETY" note below, and `ThemeProvider.tsx`'s
 * own doc comment). But an effect only runs AFTER React commits the tree
 * and the browser paints it. A server-rendered page whose `<html>` carries
 * no `data-theme` yet — because `ThemeProvider` hasn't had a chance to set
 * it — renders one full frame in whatever `tokens.css`'s own OS-only
 * default resolves to (light, absent a dark `prefers-color-scheme` match)
 * before that effect fires and (maybe) flips it to dark. On a dark-OS
 * visitor who chose "dark" last time, that is a real, visible flash on
 * every single page load — a React component fundamentally cannot prevent
 * it, because a React component cannot run before the document paints.
 *
 * The fix has to run OUTSIDE React, before first paint: a plain
 * `<script>` in `<head>`, executed synchronously as the document streams
 * in, stamping `data-theme` before the browser has painted anything to
 * flash. `getThemeInitScript()` returns that script's source as a string
 * for a consumer to inject:
 *
 * ```tsx
 * // app/layout.tsx (Next.js App Router) — first child of <head>, before
 * // any stylesheet or other script that might paint.
 * import { getThemeInitScript } from "@vespeneventures/ui/theme";
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <html>
 *       <head>
 *         <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
 *       </head>
 *       <body>{children}</body>
 *     </html>
 *   );
 * }
 * ```
 *
 * NOT TWO IMPLEMENTATIONS OF ONE RULE. The generated script does not
 * reimplement `readStoredPreference`/`applyThemeDom`'s logic in a second,
 * hand-written string — it embeds those two functions' own compiled
 * source (`.toString()`) verbatim, then calls them. `ThemeProvider` calls
 * the SAME two functions directly (imported, not stringified) to
 * (re-)apply the identical rule once React mounts. One implementation,
 * two call sites — see `theme-core.ts`'s own header comment for why both
 * functions are written to be self-contained (no reference to anything
 * outside their own parameters), which is what makes stringifying either
 * one alone, and running it with no bundler or module system present,
 * actually work. `theme-script-parity.test.ts` asserts the two call sites
 * agree, for every input, so they can't silently drift apart even though
 * nothing in the type system enforces it.
 *
 * SSR SAFETY. This function itself never touches `window`/`document` —
 * it only builds and returns a STRING. Nothing in this module runs during
 * a React render; the string it produces runs once, standalone, in the
 * browser, before React (or any bundle) has loaded at all.
 *
 * NEVER THROWS AT RUNTIME. The embedded `readStoredPreference` swallows
 * every storage error (private browsing, blocked cookies, a disabled-
 * storage policy) and falls back to `"system"` — the safe default. A page
 * with storage unavailable still renders correctly; it just always
 * follows the OS.
 */
export function getThemeInitScript(options: ThemeInitScriptOptions = {}): string {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  return (
    "(function(){" +
    `${readStoredPreference.toString()}` +
    `${applyThemeDom.toString()}` +
    `applyThemeDom(document.documentElement,readStoredPreference(${JSON.stringify(storageKey)}));` +
    "})();"
  );
}
