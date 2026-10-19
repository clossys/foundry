import { Children, cloneElement, isValidElement, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SITE_CHROME_GROUND_CLASSES, siteChromeHasBorder, type SiteChromeGround } from "./internal/shell-ground.js";
import { UI_BORDER_HAIRLINE, UI_BRANDMARK_HEIGHT_SM, UI_LAYOUT_TAP_TARGET, UI_WIDTH_PAGE_PADDING_X, UI_Z_SHELL } from "./internal/shell-vars.js";

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
   * Legacy ground vocabulary retained for source compatibility and divider
   * policy. Paint is always footer-local dark with paired light semantic
   * roles in either global theme; transparent values only omit dividers.
   * @default "base"
   */
  ground?: SiteChromeGround;
  /** Top hairline on transparent ground only; other grounds keep their own policy. @default "none" */
  rule?: "none" | "top";
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
function SiteFooterRoot({ columns, secondary, ground = "base", rule = "none", className, style, ...rest }: SiteFooterProps) {
  const colors = SITE_CHROME_GROUND_CLASSES[ground];
  const bordered = siteChromeHasBorder(ground);
  const topRule = ground === "transparent" && rule === "top";

  return (
    <footer
      {...rest}
      data-footer-root=""
      className={cx("site-footer-dark", colors.surface, colors.primary, "py-lg", bordered ? cx("border-t", colors.border) : topRule ? "border-t border-line-base" : "", className)}
      style={{
        position: "relative",
        zIndex: UI_Z_SHELL,
        ...(bordered || topRule ? { borderTopWidth: UI_BORDER_HAIRLINE } : {}),
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
      <div className="flex flex-col gap-xs">{safeColumnLinks(children)}</div>
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
  /** Social/profile links with consumer-supplied decorative artwork and explicit names. */
  icons?: readonly { readonly label: string; readonly href: string; readonly icon: ReactNode }[];
  /** Accessible group name retained for supplied social profiles and home. */
  iconsLabel?: string;
  /** Dark-compatible authored home artwork. Always last within the icon group. */
  home?: { readonly label: string; readonly href: string; readonly markSrc: string };
}

const LEGAL_LINK_CLASSES = cx(
  "inline-flex items-center justify-center px-xs",
  "text-inherit",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse",
);

const LEGAL_LINK_STYLE = { minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET } as const;

/** Apply link safety to supported column anchors without changing their artwork or copy. */
function safeColumnLinks(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (!isValidElement<{ href?: string; rel?: string; children?: ReactNode }>(child)) return child;
    const props = child.props;
    const rel = typeof props.href === "string" ? externalRel(props.href) : undefined;
    return cloneElement(child, {
      ...(rel ? { rel: Array.from(new Set(((props.rel ?? "") + " " + rel).trim().split(/\s+/))).join(" ") } : {}),
      ...(props.children === undefined ? {} : { children: safeColumnLinks(props.children) }),
    });
  });
}

/** External destinations receive rel safety even when the consumer uses the same tab. */
function externalRel(href: string): string | undefined {
  return /^(?:https?:)?\/\//i.test(href) ? "noopener noreferrer" : undefined;
}

function requireNamedDestination(link: { label: string; href: string }): void {
  if (!link.label.trim() || !link.href.trim()) throw new TypeError("Footer icons need a name and destination.");
  const protocol = new URL(link.href, "https://example.invalid").protocol;
  if (!["http:", "https:", "mailto:", "tel:"].includes(protocol)) throw new TypeError("Footer icon destination is unsafe.");
}

/**
 * Standard composition: links, icons (home last), copyright in reading order.
 * The desktop grid centers the links independently of asymmetric side contents;
 * bounded tracks wrap labels before collision and collapse to a phone stack.
 * No consent controls or arbitrary children are accepted in this row.
 */
function SiteFooterLegal({ entity, links, linksLabel, icons = [], home, iconsLabel }: SiteFooterLegalProps) {
  for (const link of icons) requireNamedDestination(link);
  if (home) requireNamedDestination(home);
  const IconGroup = iconsLabel ? "nav" : "div";
  const year = new Date().getFullYear();
  const list = (
    <ul role="list" className="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0">
      {links.map((link, index) => (
        <li key={index}>
          <a href={link.href} rel={externalRel(link.href)} className={LEGAL_LINK_CLASSES} style={LEGAL_LINK_STYLE}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <div data-footer-composition="" className="site-footer-composition">
      {linksLabel ? <nav data-footer-region="links" aria-label={linksLabel}>{list}</nav> : <div data-footer-region="links">{list}</div>}
      <IconGroup data-footer-region="icons" aria-label={iconsLabel}>
        <ul role="list" dir="ltr" className="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0">
          {icons.map((link, index) => <li key={index}>
            <a href={link.href} aria-label={link.label} rel={externalRel(link.href)} className={LEGAL_LINK_CLASSES} style={LEGAL_LINK_STYLE}>{link.icon}</a>
          </li>)}
          {home ? <li><a href={home.href} aria-label={home.label} rel={externalRel(home.href)} className={LEGAL_LINK_CLASSES} style={LEGAL_LINK_STYLE}>
            <img src={home.markSrc} alt="" style={{ height: UI_BRANDMARK_HEIGHT_SM, width: "auto" }} />
          </a></li> : null}
        </ul>
      </IconGroup>
      <p data-footer-region="copyright" className="m-0">{`© ${year} ${entity}`}</p>
    </div>
  );
}

export const SiteFooter = Object.assign(SiteFooterRoot, { Column: SiteFooterColumn, Legal: SiteFooterLegal });
