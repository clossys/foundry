import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SITE_CHROME_GROUND_CLASSES, siteChromeHasBorder, type SiteChromeGround } from "./internal/shell-ground.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET, UI_WIDTH_PAGE_PADDING_X, UI_Z_SHELL } from "./internal/shell-vars.js";

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
  /**
   * Semantic plate for the footer bar — `inverse` paints the same
   * surface/ink tokens grounded marketing blocks use; `transparent` paints
   * no plate, no border and no divider between `columns` and `secondary`
   * (ink stays the base ink; the consumer's backdrop owns contrast). Do not
   * reconstruct the plate with host `className` utilities.
   * @default "base"
   */
  ground?: SiteChromeGround;
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
function SiteFooterRoot({ columns, secondary, ground = "base", className, style, ...rest }: SiteFooterProps) {
  const colors = SITE_CHROME_GROUND_CLASSES[ground];
  const bordered = siteChromeHasBorder(ground);

  return (
    <footer
      {...rest}
      className={cx(colors.surface, colors.primary, "py-lg", bordered ? cx("border-t", colors.border) : "", className)}
      style={{
        position: "relative",
        zIndex: UI_Z_SHELL,
        ...(bordered ? { borderTopWidth: UI_BORDER_HAIRLINE } : {}),
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
              "flex flex-col gap-sm text-body-s",
              colors.secondary,
              "tablet:flex-row tablet:items-center tablet:justify-between",
              columns && bordered ? cx("border-t pt-lg", colors.border) : "",
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
      <h2 className="text-body-s font-body font-medium">{heading}</h2>
      <div className="flex flex-col gap-xs">{children}</div>
    </div>
  );
}

export interface SiteFooterLegalLink {
  /** The link's visible text, supplied by the consumer. */
  label: string;
  /** The link's destination — rendered as a real `<a href>`. */
  href: string;
}

export interface SiteFooterLegalProps {
  /** The legal entity named in the copyright line, e.g. a company or studio name. */
  entity: string;
  /** The legal links (privacy, terms, ...), in the order they should read. */
  links: readonly SiteFooterLegalLink[];
  /**
   * Accessible name for the links region. When given, the links are wrapped
   * in a `<nav>` carrying this name; when omitted they render as a bare
   * list. This package ships no default copy, so no name is assumed.
   */
  linksLabel?: string;
}

const LEGAL_LINK_CLASSES = cx(
  "inline-flex items-center justify-center px-xs",
  "text-inherit underline",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
);

const LEGAL_LINK_STYLE = { minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET } as const;

/**
 * The standard legal row for `SiteFooter`'s `secondary` slot: a copyright
 * line and a short list of legal links. The component owns the copyright
 * format (the year is read from the clock at render), the order (links
 * first in the DOM, so a stacked mobile layout reads links then copyright),
 * and the responsive layout (a centred stack below `desktop`, one line from
 * `desktop` up with the copyright at the start and the links at the end).
 * It deliberately accepts nothing else — no children, no `className`, no
 * `style`, no disclaimer — so every site's legal row reads the same way.
 *
 * Text colour is inherited from the footer's `secondary` wrapper, which
 * already follows the footer's `ground`, so no ground prop is needed here.
 */
function SiteFooterLegal({ entity, links, linksLabel }: SiteFooterLegalProps) {
  const year = new Date().getFullYear();
  const list = (
    <ul
      role="list"
      className="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end"
    >
      {links.map((link) => (
        <li key={link.href + link.label}>
          <a href={link.href} className={LEGAL_LINK_CLASSES} style={LEGAL_LINK_STYLE}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start">
      {linksLabel ? <nav aria-label={linksLabel}>{list}</nav> : list}
      <p className="m-0 desktop:whitespace-nowrap">{`© ${year} ${entity}`}</p>
    </div>
  );
}

export const SiteFooter = Object.assign(SiteFooterRoot, { Column: SiteFooterColumn, Legal: SiteFooterLegal });
