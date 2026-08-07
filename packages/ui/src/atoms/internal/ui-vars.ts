/**
 * Raw CSS custom-property reads for the handful of @vespeneventures/tokens
 * values that have no Tailwind utility namespace — see that package's
 * README, the "no Tailwind namespace, raw var() only" table. Everything
 * else this package styles with is a Tailwind class (`bg-accent`,
 * `text-ink-primary`, ...); these three are the exceptions.
 *
 * Every read below carries an explicit fallback (the token's own shipped
 * default from @vespeneventures/tokens' `styles/tokens.css`), so a
 * consumer who has these atoms but hasn't wired up tokens' CSS yet still
 * gets a legible, if unbranded, result — a focus ring, a disabled state,
 * a raised card — instead of `var()` silently resolving to nothing.
 */

/** Focus-visible ring. Applied only when `isFocusVisible` is true. */
export const UI_RING_FOCUS = "var(--ui-ring-focus, 0 0 0 2px var(--color-accent, oklch(0.4748 0 0)))";

/** Disabled-state opacity. Applied only when `isDisabled` is true. */
export const UI_ALPHA_DISABLED = "var(--ui-alpha-disabled, 0.5)";

/** Card's raised elevation — a hairline shadow, not a heavy drop shadow. */
export const UI_ELEVATION_RAISED =
  "var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))";
