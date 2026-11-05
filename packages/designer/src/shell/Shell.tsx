import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { MAIN_CONTENT_ID } from "./internal/main-content-id.js";
import { SkipLink } from "./SkipLink.js";
import { SHELL_GROUND_CLASSES, type ShellGround } from "./internal/shell-ground.js";
import { GROUND_PAINT } from "../components/Card.js";

export interface ShellProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `Shell.Header`, `Shell.SideNav`, `Shell.Main`, `Shell.Rail`, and
   * `Shell.Footer` — any subset that includes `Shell.Main`, in any order.
   */
  children: ReactNode;
  /**
   * Visible text of the skip link that jumps to `Shell.Main`.
   * @default "Skip to content"
   */
  skipLinkLabel?: string;
}

/**
 * The persistent application frame: a fixed set of named slots (`Header`,
 * `SideNav`, `Main`, `Rail`, `Footer`) that content fills, rather than the
 * other way around. See this package's README for the full rationale; in
 * short — content (`views`, and the blocks/components inside them) remounts per
 * route and is many-per-app; `Shell` persists across navigation and is
 * exactly one-per-app. In a Next.js App Router application that maps
 * directly onto `layout.tsx` (this) vs. `page.tsx` (a view) — mounting
 * `Shell` from a page rather than a layout would remount the whole frame on
 * every navigation, which is precisely the bug this layer exists to
 * prevent.
 *
 * Every slot except `Main` is optional, and each is a real, independently
 * rendered landmark element (`<header>`, `<nav>`, `<main>`, `<aside>`,
 * `<footer>`) — `ShellRoot` below does not inspect, reorder, or wrap its
 * children to build them. Each slot places itself into a named area of
 * `ShellRoot`'s CSS Grid (the `shell-area-*` classes), so:
 *
 *   - slots can appear in any order in JSX and still render in the correct
 *     visual position (grid-area placement is order-independent, unlike a
 *     row of flex children);
 *   - an omitted slot leaves its named area with no grid item in it, which
 *     collapses that area's track to 0 — an "auto"-sized grid track with no
 *     item placed in it sizes to zero, and this component never applies a
 *     `gap` to the grid that would otherwise leave phantom space between
 *     tracks regardless of their content. The result: no `Shell.Rail`
 *     means no reserved column, not an empty one.
 *
 * There is deliberately no `mode`/`variant` prop for different chrome
 * (marketing vs. member vs. staff, say). Three different route groups with
 * three different chromes are three different slot fillings in three
 * different `layout.tsx` files — see this package's README, "How differing
 * chrome is handled".
 */
function ShellRoot({ children, className, skipLinkLabel = "Skip to content", ...rest }: ShellProps) {
  return (
    <div
      {...rest}
      className={cx("shell-grid", className)}
    >
      <SkipLink targetId={MAIN_CONTENT_ID}>{skipLinkLabel}</SkipLink>
      {children}
    </div>
  );
}

export interface ShellHeaderProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  /** Semantic plate for the header bar. @default "base" */
  ground?: ShellGround;
}

/**
 * The top chrome bar — a `<header>` landmark. Renders none of its own
 * content: a consumer composes their own brand mark, top-level nav, and
 * account menu from components and passes them in as children. Shipping a
 * pre-built `SiteHeader`/`AppHeader` here would recreate the `mode`-prop
 * problem this package's README warns against, one layer up — see
 * "Placement rules" there.
 */
function ShellHeader({ children, className, ground = "base", ...rest }: ShellHeaderProps) {
  const colors = SHELL_GROUND_CLASSES[ground];

  return (
    <header
      {...rest}
      className={cx(colors.surface, "shell-area-header relative layer-shell py-shell-chrome hairline-b", colors.border, className)}
    >
      <div className="page-inset-x">{children}</div>
    </header>
  );
}

export interface ShellSideNavProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  /**
   * Accessible name for the primary navigation landmark.
   * @default "Primary"
   */
  "aria-label"?: string;
}

/**
 * The primary navigation column — a `<nav>` landmark, labeled "Primary" by
 * default (overridable via `aria-label`, same as `Breadcrumb`'s default —
 * see this package's README). Sized to the full sidebar width
 * (`--ui-layout-sidebar-w`) from the `tablet` breakpoint up, and to the
 * icon-rail width (`--ui-layout-sidebar-rail-w`) below it — a CSS-only
 * collapse via a Tailwind responsive variant, not JS breakpoint state. What
 * renders inside at the collapsed width (icons alone, or icons with
 * visually-hidden labels) is the consumer's own nav content's job; this
 * component only sizes the track it sits in.
 */
function ShellSideNav({
  children,
  className,
  "aria-label": ariaLabel = "Primary",
  ...rest
}: ShellSideNavProps) {
  return (
    <nav
      {...rest}
      aria-label={ariaLabel}
      className={cx(
        "shell-area-sidenav relative layer-shell min-h-0 overflow-y-auto overflow-x-hidden py-shell-region hairline-e", GROUND_PAINT.page.border,
        // The rail width below the tablet breakpoint, the full width from it up (theme-keys.css).
        "shell-sidenav-width",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export interface ShellMainProps extends Omit<HTMLAttributes<HTMLElement>, "id"> {
  children?: ReactNode;
}

/**
 * The single content slot every view fills — a `<main>` landmark, and the
 * only element in this package that renders one. Its content is centered
 * within `--ui-width-content-max` and inset by the fluid
 * `--ui-width-page-padding-x`, the same horizontal rhythm `Shell.Header`
 * and `Shell.Footer` apply to their own full-bleed bars.
 *
 * Carries a fixed `id` (not overridable — `ShellMainProps` omits `id` from
 * its accepted props) and `tabIndex={-1}` so the skip link above can focus
 * it directly; a consumer may still override `tabIndex` for their own
 * reason (a route that manages its own initial focus, say).
 */
function ShellMain({ children, className, tabIndex, ...rest }: ShellMainProps) {
  return (
    <main
      {...rest}
      id={MAIN_CONTENT_ID}
      tabIndex={tabIndex ?? -1}
      className={cx("shell-area-main min-h-0 min-w-0 overflow-y-auto", className)}
    >
      <div className="w-full mx-auto measure-content page-inset-x">
        {children}
      </div>
    </main>
  );
}

export interface ShellRailProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

/**
 * The optional context panel — an `<aside>` landmark, styled with
 * `--sidebar` (the token named specifically for this region).
 * Hidden below the `desktop` breakpoint entirely, CSS-only: a secondary
 * context panel is the first thing to go on a narrower viewport, and unlike
 * `Shell.SideNav` there's no primary-navigation reason it has to stay
 * present in some reduced form.
 */
function ShellRail({ children, className, ...rest }: ShellRailProps) {
  return (
    <aside
      {...rest}
      className={cx(
        "shell-area-rail shell-rail-width relative layer-aside hidden min-h-0 overflow-y-auto py-shell-region desktop:block hairline-s",
        GROUND_PAINT.sidebar.surface,
        GROUND_PAINT.page.border,
        className,
      )}
    >
      {children}
    </aside>
  );
}

export interface ShellFooterProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  /** Semantic plate for the footer bar. @default "base" */
  ground?: ShellGround;
}

/** The bottom chrome bar — a `<footer>` landmark. Optional, and empty of any built-in content, for the same reason `Shell.Header` is (see there). */
function ShellFooter({ children, className, ground = "base", ...rest }: ShellFooterProps) {
  const colors = SHELL_GROUND_CLASSES[ground];

  return (
    <footer
      {...rest}
      className={cx(colors.surface, "shell-area-footer relative layer-shell py-shell-chrome hairline-t", colors.border, className)}
    >
      <div className="page-inset-x">{children}</div>
    </footer>
  );
}

export const Shell = Object.assign(ShellRoot, {
  Header: ShellHeader,
  SideNav: ShellSideNav,
  Main: ShellMain,
  Rail: ShellRail,
  Footer: ShellFooter,
});
