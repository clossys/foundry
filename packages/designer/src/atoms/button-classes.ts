import type { ButtonSize, ButtonVariant } from "./Button.js";

const BASE =
  "inline-flex items-center justify-center gap-sm rounded-control text-body font-body transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-ink-on-accent hover:bg-accent-hover",
  secondary: "bg-surface-raised text-ink-primary border border-line-base hover:bg-surface-sunken",
  ghost: "text-ink-primary hover:bg-surface-sunken",
  danger: "bg-status-danger text-ink-on-accent hover:bg-status-danger-text",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-sm py-xs text-body-s",
  md: "px-md py-sm text-body",
  lg: "px-lg py-md text-body-l",
};

/**
 * The class string `Button` applies for a variant and size, shared so that
 * `Link` can render the identical look on a link element without copying it.
 */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize): string {
  return [BASE, SIZE_CLASSES[size], VARIANT_CLASSES[variant]].join(" ");
}

/** The package-standard keyboard focus outline, for a link that takes the button look. */
const LINK_FOCUS_CLASSES = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The `Button` look for a plain `<a>` (no React Aria, so server-safe): the
 * same variant and size classes, without `outline-none` (which would also
 * suppress the focus outline) and `disabled:cursor-not-allowed` (a link is
 * never disabled), plus the package-standard `focus-visible` outline. For a
 * call to action that navigates, such as a hero or closing band's action.
 */
export function buttonLinkClassName(variant: ButtonVariant, size: ButtonSize): string {
  const look = buttonClassName(variant, size)
    .split(" ")
    .filter((token) => token !== "outline-none" && token !== "disabled:cursor-not-allowed");
  return [...look, LINK_FOCUS_CLASSES].join(" ");
}

/** The grounds a round icon link is drawn for: a light (`base`) or dark (`inverse`) ground. */
export type IconButtonLinkGround = "base" | "inverse";

/**
 * A 44px circle (`--ui-layout-tap-target`) on a pill radius, centring one
 * icon, with a hairline edge. Colours ease on the fast motion tier; reduced
 * motion changes them instantly.
 */
const ICON_LINK_BASE =
  "inline-flex shrink-0 items-center justify-center size-[var(--ui-layout-tap-target)] rounded-pill border transition-colors duration-[var(--ui-duration-fast)] ease-default motion-reduce:transition-none";

/**
 * Per ground: rest surface, edge and ink; hover lifts the edge and shifts the
 * surface; pressed takes the ground's strongest edge. The focus outline is
 * the package-standard accent outline over a halo in the link's own surface,
 * so the ring reads where the circle overlaps a ground of the other tone.
 */
const ICON_LINK_GROUND_CLASSES: Record<IconButtonLinkGround, string> = {
  base: "bg-surface-raised text-ink-primary border-line-base hover:bg-surface-sunken hover:border-line-strong active:bg-surface-sunken active:border-ink-primary focus-visible:ring-2 focus-visible:ring-surface-raised",
  inverse:
    "bg-surface-inverse-raised text-ink-on-inverse border-line-on-inverse hover:bg-surface-inverse hover:border-ink-on-inverse-muted active:bg-surface-inverse active:border-ink-on-inverse focus-visible:ring-2 focus-visible:ring-surface-inverse-raised",
};

/**
 * The round icon-only look for a plain `<a>` (server-safe): a 44px circle
 * that holds one decorative `Icon`, for a control whose glyph says what it
 * does (a scroll cue, a back-to-top link). `ground` picks the surface, edge
 * and ink for a light or dark ground. The link still needs an accessible
 * name (`aria-label`, or visually hidden text); this class string ships no
 * copy.
 */
export function iconButtonLinkClassName(ground: IconButtonLinkGround = "base"): string {
  return [ICON_LINK_BASE, ICON_LINK_GROUND_CLASSES[ground], LINK_FOCUS_CLASSES].join(" ");
}
