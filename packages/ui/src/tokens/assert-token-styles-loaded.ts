/**
 * `assertTokenStylesLoaded` — the runtime half of this package's
 * documented "silent unstyled render" gap (see the README: "Without the
 * token CSS imported, those class names don't correspond to anything and
 * every component renders unstyled, with no error anywhere to explain
 * why"). Every class this package's components render (`bg-accent`,
 * `text-ink-primary`, `rounded-control`, ...) is a Tailwind utility
 * generated from `styles/tokens.css`'s tokens; a consumer who forgets to
 * import that file gets no signal at all today. This closes that gap —
 * see issue #182.
 *
 * HOW IT DETECTS PRESENCE. `styles/tokens.css` appends its own trailing
 * `:root { --ui-tokens-loaded: 1; }` rule (see that file's "TOKEN CSS
 * PRESENCE SENTINEL" section) purely so this function can read the
 * property back via `getComputedStyle` and tell whether the stylesheet
 * was actually loaded. `TOKEN_STYLES_SENTINEL_PROPERTY` below is the
 * single source of truth for that property's name — nothing here
 * hardcodes a second copy of the string for comparison.
 *
 * NO RENDERED UI, EVER. #148 shipped a `z-index: 99999` banner injected
 * into every page on every load, with no opt-out, including the moment
 * before a consumer's own brand-binding script ran — and was removed for
 * exactly that reason. #182 explicitly forbids reintroducing it in any
 * form. This function never creates a DOM node, never sets `innerHTML`,
 * and never writes CSS content — its only output is `console.error` (or
 * a caller-supplied `onMissing`). Contrast with `styles/tokens.css`'s
 * own PRE-EXISTING (and unrelated) brand-binding `::before` badge, a
 * deliberate, different, CSS-only mechanism this function does not
 * touch and is not a variant of.
 *
 * OPT-IN, NOT AN IMPORT SIDE EFFECT. Importing this module — or this
 * package at all — never runs a check by itself; a package that logs on
 * import is its own defect. Call `assertTokenStylesLoaded()` yourself,
 * once, near your app's root. See the README's Setup section.
 *
 * DEV-ONLY, SSR-SAFE, REPORTS ONCE. A no-op in a production build
 * (`process.env.NODE_ENV === "production"`, the same convention React's
 * own dev-only warnings use) and a no-op wherever `document` does not
 * exist (server rendering, an edge runtime, a non-DOM test environment)
 * — there is no computed style to read in either case, so there is
 * nothing this function could safely report. Reports at most once per
 * page load / module instance, not once per component instance that
 * happens to call it.
 */

/**
 * The exact custom-property name `styles/tokens.css` declares as its
 * presence sentinel — public contract: a consumer's own tooling may read
 * this property directly instead of going through this function.
 */
export const TOKEN_STYLES_SENTINEL_PROPERTY = "--ui-tokens-loaded";

const EXPECTED_SENTINEL_VALUE = "1";

export interface AssertTokenStylesLoadedOptions {
  /** Element to read the sentinel from. Defaults to `document.documentElement`. */
  target?: Element;
  /**
   * Called once, at most, when the sentinel is missing or does not match
   * the expected value. Defaults to a single `console.error` naming the
   * property and pointing at the README's Setup section.
   */
  onMissing?: (detail: { marker: string }) => void;
}

let hasReported = false;

function isProductionBuild(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env["NODE_ENV"] === "production"
  );
}

/**
 * Dev-only, SSR-safe, reports at most once. Returns nothing on purpose:
 * this is a side-channel signal (console output, or a caller-supplied
 * `onMissing`), not a status a caller could check-and-ignore.
 */
export function assertTokenStylesLoaded(options: AssertTokenStylesLoadedOptions = {}): void {
  if (isProductionBuild()) return;
  if (typeof document === "undefined") return; // SSR / no DOM: nothing to read a computed style from.
  if (hasReported) return;

  const target = options.target ?? document.documentElement;
  const value = getComputedStyle(target).getPropertyValue(TOKEN_STYLES_SENTINEL_PROPERTY).trim();
  if (value === EXPECTED_SENTINEL_VALUE) return;

  hasReported = true;
  if (options.onMissing) {
    options.onMissing({ marker: TOKEN_STYLES_SENTINEL_PROPERTY });
    return;
  }
  console.error(
    `@vespeneventures/ui: token CSS does not appear to be loaded (missing computed property ` +
      `"${TOKEN_STYLES_SENTINEL_PROPERTY}"). Every class this package's components render (bg-accent, ` +
      `text-ink-primary, rounded-control, ...) is a Tailwind utility generated from ` +
      `"@vespeneventures/ui/tokens.css"'s tokens — without it, those classes don't correspond to anything ` +
      `and components render unstyled. Import "@vespeneventures/ui/tokens.css" (directly, or via your own ` +
      `brand-bound stylesheet that imports it) before rendering components. See the README's Setup section.`,
  );
}

/**
 * Test-only. Not exported from `tokens/index.ts` (or anywhere else in
 * this package's public surface) — resets the once-per-load report flag
 * so each test can observe a fresh "has this reported yet" state instead
 * of inheriting it from whichever test ran first in the same module
 * instance.
 */
export function __resetTokenStylesLoadedReportedForTests(): void {
  hasReported = false;
}
