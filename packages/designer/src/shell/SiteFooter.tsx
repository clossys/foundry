import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_WIDTH_PAGE_PADDING_X, UI_Z_SHELL } from "./internal/shell-vars.js";

export interface SiteFooterProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /**
   * The grouped link columns — typically one or more `SiteFooter.Column`s
   * laid out in a responsive grid this component owns. Optional: a short
   * site may have nothing to put here at all, only `secondary`.
   */
  columns?: ReactNode;
  /**
   * The secondary/legal row below the columns — a copyright line, legal
   * links, a locale switcher. Rendered under a hairline divider once
   * `columns` is present.
   */
  secondary?: ReactNode;
}

/**
 * The persistent bottom chrome a public site needs: grouped link columns
 * plus a secondary/legal row — two regions that differ in kind, and (the
 * same test #1 `SiteHeader` documents) still there after every route
 * change, which is what puts this in `shell` rather than `blocks`. Renders
 * a real `<footer>` — registering as the page's `contentinfo` landmark
 * automatically at the top level, the same placement rule `Shell.Footer`
 * already carries.
 */
function SiteFooterRoot({ columns, secondary, className, style, ...rest }: SiteFooterProps) {
  return (
    <footer
      {...rest}
      className={cx("bg-surface-raised py-lg border-t border-line-base", className)}
      style={{
        position: "relative",
        zIndex: UI_Z_SHELL,
        borderTopWidth: UI_BORDER_HAIRLINE,
        ...style,
      }}
    >
      <div
        className="mx-auto flex w-full flex-col gap-lg"
        style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X }}
      >
        {columns ? (
          <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4">{columns}</div>
        ) : null}
        {secondary ? (
          <div
            className={cx(
              "flex flex-col gap-sm text-body-s text-ink-secondary",
              "tablet:flex-row tablet:items-center tablet:justify-between",
              columns ? "border-t border-line-base pt-lg" : "",
            )}
          >
            {secondary}
          </div>
        ) : null}
      </div>
    </footer>
  );
}

export interface SiteFooterColumnProps {
  /** The column's own heading, rendered as a real `<h2>`. */
  heading: ReactNode;
  /** The column's links — typically one or more `Link` atoms (`variant="muted"` reads well here). */
  children: ReactNode;
  className?: string;
}

/**
 * One grouped column of footer links: a heading region and the links
 * themselves, the two regions that differ in kind inside a single column.
 * Ships as a sub-component (`SiteFooter.Column`, the same `Object.assign`
 * shape `Dialog.Heading`/`Menu.Item`/`Table.Row` already use in this
 * package) rather than a `columns` data prop: a real footer's columns
 * routinely differ column-by-column (link count, an occasional icon next
 * to one link) in a way that reads more naturally as hand-written JSX —
 * the same reasoning `RadioGroup.Radio`'s own section in this package's
 * README gives for composable children over a data array.
 */
function SiteFooterColumn({ heading, children, className }: SiteFooterColumnProps) {
  return (
    <div className={cx("flex flex-col gap-sm", className)}>
      <h2 className="text-body-s font-body font-medium text-ink-primary">{heading}</h2>
      <div className="flex flex-col gap-xs">{children}</div>
    </div>
  );
}

export const SiteFooter = Object.assign(SiteFooterRoot, { Column: SiteFooterColumn });
