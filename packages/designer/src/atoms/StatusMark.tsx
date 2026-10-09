import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./internal/cx.js";

export type StatusMarkTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The state's tone. Colour only repeats what the text already says. */
  tone: StatusMarkTone;
  /**
   * Required. The state in words ("Received", "Outside limit"). The text
   * always carries the meaning; the dot is decoration.
   */
  children: ReactNode;
}

const DOT_CLASSES: Record<StatusMarkTone, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  info: "bg-status-info",
  neutral: "bg-ink-muted",
};

const TEXT_CLASSES: Record<StatusMarkTone, string> = {
  success: "text-status-success-text",
  warning: "text-status-warning-text",
  danger: "text-status-danger-text",
  info: "text-status-info-text",
  neutral: "text-ink-secondary",
};

/**
 * A small coloured dot followed by a label: one data state inside a row,
 * a table cell or a panel header. Lighter than `Badge` (no pill fill), for
 * places where several states sit close together.
 *
 * The dot is `aria-hidden`; the label is ordinary text in the tone's
 * `status-*-text` colour, which is contrast-checked against the raised
 * surface in both themes. Not interactive, composes no other atom and uses
 * no hooks, so it is server-safe (re-exported from `atoms/server.ts`).
 */
export function StatusMark({ tone, className, children, ...rest }: StatusMarkProps) {
  return (
    <span
      {...rest}
      data-tone={tone}
      className={cx("inline-flex items-center gap-xs text-body-s font-body", TEXT_CLASSES[tone], className)}
    >
      <span aria-hidden="true" className={cx("inline-block h-2 w-2 shrink-0 rounded-pill", DOT_CLASSES[tone])} />
      <span>{children}</span>
    </span>
  );
}
