import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SITE_CHROME_GROUND_CLASSES, siteChromeHasBorder, type SiteChromeGround } from "./internal/shell-ground.js";
import { UI_BORDER_HAIRLINE, UI_WIDTH_PAGE_PADDING_X, UI_Z_SHELL } from "./internal/shell-vars.js";

export interface SiteHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /**
   * The site's identity — a wordmark, a logo image/link, or both. Required:
   * a header's entire job is announcing what site this is, the same reason
   * `PageHeader`'s `title` is required. This package ships no `BrandLockup`
   * of its own (a brand mark is per-product — the same reasoning `AuthView`
   * ships no `BrandLockup` either; see that view's own section in this
   * package's README).
   */
  brand: ReactNode;
  /**
   * The primary navigation — typically a `NavShell`, but any `ReactNode`
   * works (a short, static site with no drawer needs might pass a plain
   * `<nav>` of `Link`s directly).
   */
  nav?: ReactNode;
  /**
   * Trailing controls — a `ThemeToggle` (from `@clossys/designer/theme`,
   * composed here rather than imported: `shell` may not depend on
   * `theme` — see `src/ladder.test.ts`), auth controls, a CTA `Button`.
   */
  actions?: ReactNode;
  /**
   * A secondary call to action — a sign-in link beside a primary CTA. Renders
   * directly before `actions`, in the same trailing region, so the two stay
   * adjacent in DOM, visual, and tab order.
   */
  secondaryAction?: ReactNode;
  /**
   * Where the `nav` slot sits in the row. `"leading"` keeps it beside the
   * brand; `"centered"` gives brand, nav, and trailing controls their own
   * regions, with the brand and trailing regions growing equally so the nav
   * centers on the header. Logical properties only, so RTL mirrors.
   * @default "leading"
   */
  navPlacement?: "leading" | "centered";
  /**
   * Semantic plate for the header bar — `inverse` for a dark hero band,
   * `transparent` for no plate and no border at all (the page beneath shows
   * through). Like `base`, the header sets no ink class, so its content
   * inherits ink from the page; the consumer's backdrop owns contrast.
   * @default "base"
   */
  ground?: SiteChromeGround;
}

/**
 * The persistent top chrome a public site needs: a brand slot, the primary
 * navigation, and a trailing actions area — three regions that differ in
 * kind, run through this package's own placement test #1 first ("does it
 * survive a route change?"): a site header's whole job is to still be
 * there after the route beneath it changes, which is what puts it in
 * `shell` rather than `blocks` despite otherwise reading like a
 * `PageHeader`-shaped block (see this package's README, "Placement
 * rules"). Renders a real `<header>` — registering as the page's `banner`
 * landmark automatically, PROVIDED it is rendered at the top level (not
 * nested inside `<main>`/`<article>`/`<aside>`/`<nav>`/`<section>`, which
 * strips the implicit landmark role per the HTML/ARIA spec — the same
 * placement rule `Shell.Header` and `Shell.Footer` already carry).
 *
 * Deliberately no `mode`/`variant` prop, the same reasoning `Shell` itself
 * documents for why it ships no `SiteHeader`/`AppHeader` of its own at the
 * app-shell layer ("Shell" → "How differing chrome is handled" in this
 * package's README): a marketing header, a signed-in member header, and a
 * staff header with genuinely different actions are three different
 * `brand`/`nav`/`actions` fillings of THIS component, not three values of
 * a prop on it. `navPlacement` is not a mode in that sense: it moves the
 * same `nav` slot within the row (layout), where a mode would swap what
 * fills it. The secondary call to action is a filling, so it is the
 * `secondaryAction` slot. A single `nav` slot keeps the header at one
 * navigation landmark by construction.
 */
export function SiteHeader({
  brand,
  nav,
  actions,
  secondaryAction,
  navPlacement = "leading",
  ground = "base",
  className,
  style,
  ...rest
}: SiteHeaderProps) {
  const colors = SITE_CHROME_GROUND_CLASSES[ground];
  const bordered = siteChromeHasBorder(ground);

  return (
    <header
      {...rest}
      className={cx(colors.surface, "py-sm", bordered ? cx("border-b", colors.border) : "", className)}
      style={{
        position: "relative",
        zIndex: UI_Z_SHELL,
        ...(bordered ? { borderBottomWidth: UI_BORDER_HAIRLINE } : {}),
        ...style,
      }}
    >
      {navPlacement === "centered" ? (
        <div
          className="mx-auto flex w-full flex-wrap items-center gap-md"
          style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X }}
        >
          <div className="flex flex-1 items-center">{brand}</div>
          {nav ? <div className="flex items-center">{nav}</div> : null}
          <div className="flex flex-1 items-center justify-end gap-sm">
            {secondaryAction}
            {actions}
          </div>
        </div>
      ) : (
        <div
          className="mx-auto flex w-full flex-wrap items-center justify-between gap-md"
          style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X }}
        >
          <div className="flex items-center gap-lg">
            {brand}
            {nav}
          </div>
          {secondaryAction || actions ? (
            <div className="flex items-center gap-sm">
              {secondaryAction}
              {actions}
            </div>
          ) : null}
        </div>
      )}
    </header>
  );
}
