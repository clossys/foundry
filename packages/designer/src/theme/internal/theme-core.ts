/**
 * The one place this package's THREE-STATE theme contract is expressed as
 * runtime logic — everything else under `theme/` (`ThemeProvider`,
 * `ThemeToggle`, `initScript.ts`) builds on the two functions below rather
 * than re-deciding the rule each has its own copy of. The rule itself lives
 * in `styles/tokens.css` (see that file's own header comment, "DARK · OS
 * PREFERENCE" and "DARK · EXPLICIT OVERRIDE" blocks) and this package's
 * README theming section:
 *
 *   - attribute ABSENT       -> the OS decides, via `prefers-color-scheme`
 *   - `data-theme="dark"`    -> forced dark, even on a light OS
 *   - `data-theme="light"`   -> forced light, even on a dark OS
 *
 * A stored value that is not one of the three states is malformed input,
 * not a fourth state — `readStoredPreference` below folds it into
 * `"system"`, the same safe fallback every other decline path
 * (storage unavailable, no storage at all) already resolves to.
 *
 * SELF-CONTAINED ON PURPOSE. Both `readStoredPreference` and
 * `applyThemeDom` reference nothing outside their own parameters — no
 * import, no closed-over module state, no call to any other function in
 * this file or package. That is what lets `initScript.ts` embed their own
 * `.toString()`'d source directly into the string it generates for a
 * consumer's `<head>`, where no bundler, module system, or import exists
 * yet: the function text has to run standalone. `ThemeProvider` imports
 * and calls these same two functions directly instead (no stringifying),
 * so the init script and the provider are never two independent
 * implementations of the rule, drifting apart silently — they are the
 * SAME implementation, used two different ways. `theme-script-parity.test.ts`
 * asserts this by literally executing the stringified form and comparing
 * its result to calling the function directly, across every input this
 * module's own `theme-core.test.ts` exercises.
 */

/** The three states a consumer's theme preference can hold. */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

/** `"system"` (follow the OS), or an explicit `"light"`/`"dark"` override. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What is actually on screen right now — never `"system"`, always resolved. */
export type ResolvedTheme = "light" | "dark";

/** The default `localStorage` key `ThemeProvider`, `ThemeToggle`, and `getThemeInitScript` all read/write unless a consumer overrides it. */
export const DEFAULT_STORAGE_KEY = "ui-theme";

/** Narrows an arbitrary value to `ThemePreference` — used to validate a stored string before trusting it. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Reads the stored preference for `storageKey`, falling back to
 * `"system"` — the safe default — on every decline path:
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
export function readStoredPreference(storageKey: string): ThemePreference {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "system" || stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Storage unavailable — fall through to the safe default below.
  }
  return "system";
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
