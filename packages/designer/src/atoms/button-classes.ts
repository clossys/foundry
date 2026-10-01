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
