/**
 * Raw CSS custom-property reads for the handful of @vespeneventures/tokens
 * values that have no Tailwind utility namespace — see that package's
 * README, the "no Tailwind namespace, raw var() only" table. Everything
 * else this package styles with is a Tailwind class (`bg-accent`,
 * `text-ink-primary`, ...); these are the exceptions.
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

/**
 * A floating overlay's elevation — heavier than Card's raised hairline,
 * because a `Select`/`Menu` popover sits detached above the page rather
 * than flush with it. Applied while the popover is open.
 */
export const UI_ELEVATION_FLOATING = "var(--ui-elevation-floating, 0 8px 24px rgba(0, 0, 0, 0.10))";

/**
 * Stacking context for a `Select`/`Menu` popover — content portalled above
 * everything else in the page, including shell chrome (`--ui-z-shell`,
 * `--ui-z-aside`) and sticky headers (`--ui-z-sticky`). There is no token
 * named specifically for "popover"; `--ui-z-modal` is the closest fit in
 * the z-index family — a full-stack overlay above ordinary page content —
 * and a select/menu popover belongs at that same level even when it isn't
 * a dialog, since it can be opened from inside one.
 */
export const UI_Z_POPOVER = "var(--ui-z-modal, 50)";

/**
 * Stacking context for `Dialog`'s scrim and surface — the same
 * `--ui-z-modal` token `UI_Z_POPOVER` above already reads, and
 * deliberately so: a `Select`/`Menu` opened from inside an open `Dialog`
 * must paint above it, and pinning both to one shared level (rather than
 * inventing a higher one for `Dialog`) is what `UI_Z_POPOVER`'s own doc
 * comment already commits to — a popover belongs at the modal level
 * "even when it isn't a dialog, since it can be opened from inside one."
 * Later DOM order (the popover portals in after the dialog that opened it)
 * settles the tie in the correct direction at equal z-index. A separate
 * constant, not a re-export of `UI_Z_POPOVER` under a second name, so each
 * call site's own name says what it's actually stacking.
 */
export const UI_Z_MODAL = "var(--ui-z-modal, 50)";

/**
 * Stacking context for `Tooltip` — the highest member of the z-index family,
 * above `Dialog`/`Popover`'s shared `--ui-z-modal` layer. A tooltip has to
 * paint above whatever it's describing even when that trigger sits inside an
 * open `Dialog` or `Popover`, since either can contain a control (an
 * icon-only `Button`, say) whose accessible name still needs a hover/focus
 * tooltip.
 */
export const UI_Z_TOOLTIP = "var(--ui-z-tooltip, 80)";
