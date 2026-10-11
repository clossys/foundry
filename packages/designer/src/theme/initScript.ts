import { DEFAULT_STORAGE_KEY, type ThemePreference } from "./internal/theme-core.js";

export interface ThemeInitScriptOptions {
  /** @default "ui-theme" */
  storageKey?: string;
  /** Used when storage is absent, invalid or unavailable. @default "system" */
  defaultTheme?: ThemePreference;
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
 * // Your Next.js app's root layout (the "layout.tsx" file in the App
 * // Router's "app" directory) — first child of <head>, before any
 * // stylesheet or other script that might paint.
 * import { getThemeInitScript } from "@clossys/designer/theme";
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
 * LITERAL TEMPLATES. The standalone script uses literal source so host
 * minifiers can rename bundled functions without breaking its execution.
 * `theme-script-parity.test.ts` pins this template to the provider's
 * `readStoredPreference` and `applyThemeDom` behavior.
 *
 * SSR SAFETY. This function itself never touches `window`/`document` —
 * it only builds and returns a STRING. Nothing in this module runs during
 * a React render; the string it produces runs once, standalone, in the
 * browser, before React (or any bundle) has loaded at all.
 *
 * STORAGE FALLBACK. Storage errors, missing values and invalid preferences
 * use `defaultTheme` ("system" unless configured). Valid stored preferences,
 * including "system", take precedence over that fallback.
 */
/**
 * Public marketing default: stamp the authored day register. OS preference
 * is not the brand — do not use this for product chrome that should follow
 * the visitor's stored or OS-driven choice; use `getStoredThemeInitScript`.
 */
export function getAuthoredThemeInitScript(): string {
  return `(function(){
    var root = document.documentElement;
    root.setAttribute("data-theme", "light");
    root.style.colorScheme = "light";
  })();`;
}

/** Quote an inline-script string without HTML delimiters or line separators. */
function quoteScriptString(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Product-app path: valid stored preferences take precedence over the default. */
export function getStoredThemeInitScript(options: ThemeInitScriptOptions = {}): string {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const defaultTheme = options.defaultTheme ?? "system";
  return `(function(){
    var preference = ${quoteScriptString(defaultTheme)};
    try {
      var stored = window.localStorage.getItem(${quoteScriptString(storageKey)});
      if (stored === "system" || stored === "light" || stored === "dark") {
        preference = stored;
      }
    } catch {}
    var root = document.documentElement;
    if (preference === "system") {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "light dark";
    } else {
      root.setAttribute("data-theme", preference);
      root.style.colorScheme = preference;
    }
  })();`;
}

/** @deprecated Use `getAuthoredThemeInitScript` for marketing or `getStoredThemeInitScript` for apps. */
export function getThemeInitScript(options: ThemeInitScriptOptions = {}): string {
  return getStoredThemeInitScript(options);
}
