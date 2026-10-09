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
