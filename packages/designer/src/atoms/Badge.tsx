import type { HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** @default "neutral" */
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-surface-sunken text-ink-secondary",
  success: "bg-status-success-tint text-status-success-text",
  warning: "bg-status-warning-tint text-status-warning-text",
  danger: "bg-status-danger-tint text-status-danger-text",
  info: "bg-status-info-tint text-status-info-text",
};

/**
 * A small status/label pill. Not interactive and does not compose another
 * atom — plain markup, no react-aria-components primitive needed, unlike
 * `Button` and `TextField` (see this package's README).
 */
export function Badge({ variant = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        "inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
