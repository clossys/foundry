/**
 * Runtime helpers for the three-state theme contract: system removes the
 * override, while light and dark force that register. The standalone literal
 * template in initScript.ts follows this rule; theme-script-parity.test.ts
 * checks its behavior against these helpers across storage and fallback cases.
 */

/** The three states a consumer's theme preference can hold. */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

/** `"system"` (follow the OS), or an explicit `"light"`/`"dark"` override. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What is actually on screen right now — never `"system"`, always resolved. */
export type ResolvedTheme = "light" | "dark";

/** The default `localStorage` key `ThemeProvider`, `ThemeToggle`, and `getStoredThemeInitScript` all read/write unless a consumer overrides it. */
export const DEFAULT_STORAGE_KEY = "ui-theme";

/** Authored day register stamped before first paint on public marketing surfaces. */
export const AUTHORED_THEME_REGISTER: ResolvedTheme = "light";

/** Narrows an arbitrary value to `ThemePreference` — used to validate a stored string before trusting it. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Reads the stored preference for `storageKey`, falling back to
 * the supplied fallback (default `"system"`) on every decline path:
 *
 *   - `localStorage` throws (private browsing in some browsers, blocked
 *     cookies/storage, a disabled-storage enterprise policy) — caught,
 *     never rethrown.
 *   - nothing stored yet (`getItem` returns `null`).
 *   - a stored value that isn't exactly `"system"`/`"light"`/`"dark"` —
 *     malformed input (a stale value from a since-removed fourth state, a
 *     hand-edited value, storage shared with an unrelated app writing the
 *     same key) is treated as absent, not trusted as some other state.
 *
 * Never throws, and never returns anything but one of the three valid
 * states — there is no undefined/null "we don't know yet" result to
 * forget to handle at a call site.
 */
export function readStoredPreference(storageKey: string, fallback: ThemePreference = "system"): ThemePreference {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "system" || stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Storage unavailable — fall through to the safe default below.
  }
  return fallback;
}

/**
 * Stamps (or removes) `data-theme` on `root` per the three-state contract
 * this file's own header describes, and keeps the native CSS
 * `color-scheme` property in sync so browser-drawn UI — form controls,
 * scrollbars, autofill — matches: `"light dark"` for `"system"` (telling
 * the browser to make the same OS-driven choice CSS itself is about to
 * make via `prefers-color-scheme`), or the literal preference string for
 * an explicit override. A theme toggle that only sets `data-theme` and
 * leaves `color-scheme` alone is the classic half-done version of this —
 * every native widget on the page stays in whichever theme it started in.
 */
/**
 * Stamps the authored light register — does not read `prefers-color-scheme`.
 * Use in marketing layouts via `getAuthoredThemeInitScript()`.
 */
export function stampAuthoredRegister(root: HTMLElement): void {
  root.setAttribute("data-theme", "light");
  root.style.colorScheme = "light";
}

export function applyThemeDom(root: HTMLElement, preference: ThemePreference): void {
  if (preference === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.setAttribute("data-theme", preference);
    root.style.colorScheme = preference;
  }
}

/**
 * Best-effort persistence: swallows every `localStorage.setItem` error
 * (quota exceeded, private browsing, storage disabled) instead of
 * throwing — the same decline-path contract `readStoredPreference` above
 * documents for reads. On failure the chosen preference still applies for
 * the rest of this page's lifetime (React state + `applyThemeDom` still
 * run); only cross-reload persistence is silently lost.
 */
export function writeStoredPreference(storageKey: string, preference: ThemePreference): void {
  try {
    window.localStorage.setItem(storageKey, preference);
  } catch {
    // Best-effort only — see doc comment above.
  }
}

/** Resolves a preference to what's actually displayed: the preference itself when explicit, or the OS's current choice when `"system"`. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}
