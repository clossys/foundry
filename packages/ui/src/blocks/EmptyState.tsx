import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Slot for an icon or illustration, rendered above the title. */
  icon?: ReactNode;
  /** The only required prop. Rendered as a heading. */
  title: ReactNode;
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Slot for the recovery action — typically a `Button` atom ("Create your
   * first prompt", "Clear filters"). Not every empty state has one (a
   * genuinely empty inbox has nothing to do about it), so it's optional.
   */
  action?: ReactNode;
}

/**
 * A placeholder shown in place of a list, table, or feed that currently has
 * nothing in it — the zero-item state for views like `/evals`,
 * `/experiments`, `/prompts`, `/inbox`. Composes no behavior of its own;
 * `icon` and `action` are slots, not configuration for a fixed set of
 * built-in icons/actions.
 *
 * `title` renders as a heading (`<h2>`) so the empty state announces itself
 * to assistive tech the same way any other section heading would, and so a
 * page can be scanned by heading alone even when every list item that would
 * normally carry structure is, by definition, absent.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      {...rest}
      className={cx(
        "flex flex-col items-center justify-center gap-sm p-2xl",
        className,
      )}
    >
      {icon ? <div className="text-ink-muted">{icon}</div> : null}
      <h2 className="text-h2 font-display text-ink-primary">{title}</h2>
      {description ? (
        <p className="text-body text-ink-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-sm">{action}</div> : null}
    </div>
  );
}
