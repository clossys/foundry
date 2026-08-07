import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The page's own name. The only required prop. */
  title: ReactNode;
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Slot for the page's primary actions — typically one or more `Button`
   * atoms. Rendered at the trailing edge of the title row.
   */
  actions?: ReactNode;
  /**
   * Slot for a `Breadcrumb` atom (or any `ReactNode`), rendered above the
   * title. Not required — a top-level page has nowhere to link back to.
   */
  breadcrumb?: ReactNode;
}

/**
 * A page's top-of-content banner: an optional breadcrumb trail, a title,
 * an optional description, and an optional row of actions. Composes no
 * behavior of its own — everything interactive it renders (a `Breadcrumb`,
 * `Button`s) is passed in as a slot, not configured through a prop.
 *
 * Deliberately has no `variant`/`mode` prop. A consuming page that needs a
 * structurally different header — no description, an extra badge next to
 * the title, actions that wrap onto a second row — composes that directly
 * with slots rather than asking this component to grow a new mode for it.
 * See this package's README for why: a shared component that tried to
 * absorb structural differences through a mode prop has failed twice
 * before in the history behind this package.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
  ...rest
}: PageHeaderProps) {
  return (
    <header {...rest} className={cx("flex flex-col gap-md", className)}>
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-lg">
        <div className="flex flex-col gap-xs">
          <h1 className="text-h1 font-display text-ink-primary">{title}</h1>
          {description ? (
            <p className="text-body text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-sm">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
