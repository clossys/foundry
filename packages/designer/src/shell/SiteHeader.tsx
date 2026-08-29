import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
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
 * a prop on it.
 */
export function SiteHeader({ brand, nav, actions, className, style, ...rest }: SiteHeaderProps) {
  return (
    <header
      {...rest}
      className={cx("bg-surface-raised py-sm border-b border-line-base", className)}
      style={{
        position: "relative",
        zIndex: UI_Z_SHELL,
        borderBottomWidth: UI_BORDER_HAIRLINE,
        ...style,
      }}
    >
      <div
        className="mx-auto flex w-full flex-wrap items-center justify-between gap-md"
        style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X }}
      >
        <div className="flex items-center gap-lg">
          {brand}
          {nav}
        </div>
        {actions ? <div className="flex items-center gap-sm">{actions}</div> : null}
      </div>
    </header>
  );
}
