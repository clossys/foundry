import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_STORAGE_KEY,
  applyThemeDom,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./internal/theme-core.js";

export { DEFAULT_STORAGE_KEY, THEME_PREFERENCES, type ResolvedTheme, type ThemePreference } from "./internal/theme-core.js";

export interface ThemeContextValue {
  /** The stored, three-state preference: `"system" | "light" | "dark"`. */
  preference: ThemePreference;
  /**
   * What is actually on screen right now — never `"system"`: for an
   * explicit preference this equals `preference`; for `"system"` it's the
   * OS's current choice, read live from `prefers-color-scheme` and kept up
   * to date for as long as this provider is mounted.
   */
  resolvedTheme: ResolvedTheme;
  /** Sets a new preference: persists it (best-effort), stamps `data-theme` on `<html>`, and re-renders every `useTheme()` consumer. */
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * The `localStorage` key this provider reads/writes. Must match the key
   * passed to `getThemeInitScript({ storageKey })` in the `<head>` script —
   * `theme-script-parity.test.ts` in this package asserts the shared
   * default stays in sync between them, but a consumer overriding one and
   * not the other is a real way to defeat the whole flash-prevention
   * scheme, since the head script would then be reading a different key
   * than this provider persists to.
   * @default "ui-theme"
   */
  storageKey?: string;
  /**
   * The preference this provider renders with before it has had a chance
   * to read `localStorage` — see this component's own doc comment,
   * "SSR safety and the one-tick correction", for why that read can't
   * happen during render. `"system"` (the default) is the same safe
   * fallback every other decline path in this module resolves to.
   * @default "system"
   */
  defaultPreference?: ThemePreference;
}

function subscribeToPrefersDark(onStoreChange: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getPrefersDarkSnapshot(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// No OS signal exists on the server, and React's `useSyncExternalStore`
// contract is built exactly for this: `getServerSnapshot`'s value is what
// BOTH the server and React's first client render use (so there is no
// hydration mismatch to warn about), and React schedules a corrected
// client-only re-render immediately after hydration completes, at which
// point `getPrefersDarkSnapshot` above starts being read instead. `false`
// (light) is the right server value because it's what `tokens.css` itself
// falls back to absent any dark signal — see that file's own header
// comment: light is the plain `:root` default, dark is the thing that has
// to be turned on, by media query or explicit override.
function getPrefersDarkServerSnapshot(): boolean {
  return false;
}

/**
 * Holds the three-state theme PREFERENCE (`"system" | "light" | "dark"`),
 * persists it, and keeps `<html data-theme>` plus the native `color-scheme`
 * CSS property in sync with it — the JavaScript half of the theming
 * contract `tokens.css` defines in CSS (see that file's own header comment
 * and this package's README, "CSS layers, fallbacks, and themes"). Wrap
 * your tree once, near the root, typically as a sibling of `<Shell>`:
 *
 * ```tsx
 * import { ThemeProvider } from "@vespeneventures/ui/theme";
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return <ThemeProvider>{children}</ThemeProvider>;
 * }
 * ```
 *
 * PAIR THIS WITH THE HEAD SCRIPT. This provider corrects `<html
 * data-theme>` from an effect, which only runs after React commits and the
 * browser paints — one frame too late to prevent a flash of the wrong
 * theme on first load. `getThemeInitScript()` (from this same subpath)
 * covers that gap by running synchronously in `<head>`, before any paint —
 * see that function's own doc comment for the full explanation and a
 * usage example. This provider is not a substitute for it; use both.
 *
 * SSR SAFETY AND THE ONE-TICK CORRECTION. Reading `localStorage` during
 * render would make React's client render diverge from what the server
 * rendered (the server has no `localStorage` at all), which is exactly
 * what produces a hydration mismatch — so this component never does that
 * during render. Instead: both the server and React's FIRST client render
 * use `defaultPreference` (`"system"` unless overridden); a `useEffect` —
 * which only ever runs client-side, after hydration — then reads the real
 * stored value and corrects local state if it differs. This is the same
 * "read the server-safe default first, correct it right after mount"
 * pattern `useSyncExternalStore`'s `getServerSnapshot` codifies for the
 * OS-preference subscription below; it's applied by hand here because the
 * value being corrected (a `localStorage` read) isn't a subscribable
 * external store in the same sense the media query is. Note what this
 * does NOT affect: the page's actual rendered THEME never flashes wrong,
 * because the head script above already stamped the correct `data-theme`
 * before this component's first paint. Only this hook's own reported
 * `preference` value — and anything that visibly depends on it, like
 * `ThemeToggle`'s icon — settles into its correct state one tick after
 * mount, the same tradeoff every SSR-safe theme provider makes.
 */
export function ThemeProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  defaultPreference = "system",
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(defaultPreference);

  // The one-tick correction described in this component's own doc comment
  // above — client-only, runs once per (mount, storageKey) pair.
  useEffect(() => {
    setPreferenceState(readStoredPreference(storageKey));
  }, [storageKey]);

  // Keeps `<html data-theme>`/`color-scheme` in sync with React state on
  // every change, including the one-tick correction effect above and any
  // later `setPreference` call. Idempotent against what the head script
  // already applied, so this never produces a visible change on its own.
  useEffect(() => {
    applyThemeDom(document.documentElement, preference);
  }, [preference]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      writeStoredPreference(storageKey, next);
      setPreferenceState(next);
    },
    [storageKey],
  );

  const prefersDark = useSyncExternalStore(
    subscribeToPrefersDark,
    getPrefersDarkSnapshot,
    getPrefersDarkServerSnapshot,
  );
  const resolvedTheme = resolveTheme(preference, prefersDark);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Reads the current theme preference and resolved theme from the nearest
 * `ThemeProvider`. `preference` and `resolvedTheme` are deliberately
 * distinct values, not one collapsed into the other: `preference` is what
 * the consumer CHOSE (possibly `"system"`, which is not itself a
 * displayable theme); `resolvedTheme` is what is actually being
 * DISPLAYED right now (`"light"` or `"dark"`, always one of the two,
 * even when the preference is `"system"`). A component picking a sun/moon
 * icon needs `resolvedTheme`; a component showing which of three radio
 * options is selected needs `preference` — conflating them would leave
 * one of those two cases with no correct value to read. Throws outside a
 * `ThemeProvider`, the same fail-loud contract React context consumers
 * conventionally use, rather than silently returning a made-up default
 * that would mask a missing provider.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme() must be called within a <ThemeProvider>.");
  }
  return context;
}
