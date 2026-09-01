import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import {
  UI_BORDER_HAIRLINE,
  UI_LAYOUT_ASIDE_W,
  UI_WIDTH_CONTENT_MAX,
  UI_WIDTH_PAGE_PADDING_X,
  UI_Z_ASIDE,
  UI_Z_SHELL,
  UI_Z_SKIP_LINK,
} from "./internal/shell-vars.js";

/**
 * The `id` `Shell.Main` renders and the skip link's `href` targets. Not
 * exported: there is exactly one `Shell.Main` per `Shell` (see this
 * package's README, "Placement rules" — shell provides slots, cardinality
 * one), so nothing outside this file needs to know or vary it. Kept as a
 * shared constant rather than threaded through props so `ShellRoot` and
 * `ShellMain` — two independent, independently-rendered components (see
 * the note on `ShellRoot` below for why) — stay in sync without either
 * needing a reference to the other.
 */
const MAIN_CONTENT_ID = "ui-shell-main";

export interface ShellProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `Shell.Header`, `Shell.SideNav`, `Shell.Main`, `Shell.Rail`, and
   * `Shell.Footer` — any subset that includes `Shell.Main`, in any order.
   */
  children: ReactNode;
}

/**
 * The persistent application frame: a fixed set of named slots (`Header`,
 * `SideNav`, `Main`, `Rail`, `Footer`) that content fills, rather than the
 * other way around. See this package's README for the full rationale; in
 * short — content (`views`, and the blocks/atoms inside them) remounts per
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
 * `ShellRoot`'s CSS Grid (`style={{ gridArea: "..." }}`), so:
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
function ShellRoot({ children, className, ...rest }: ShellProps) {
  return (
    <div
      {...rest}
      className={cx("grid min-h-dvh grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)_auto]", className)}
      style={{
        gridTemplateAreas: '"header header header" "sidenav main rail" "footer footer footer"',
      }}
    >
      <SkipLink />
      {children}
    </div>
  );
}

/**
 * The first focusable element on the page, visually hidden until it
 * receives focus. A real a11y requirement for any persistent frame with
 * navigation chrome above the content: without it, a keyboard user landing
 * on the page must tab through the entire header and side navigation
 * before reaching content that changes per route. Rendered outside the
 * grid's normal flow (Tailwind's `sr-only` is itself `position: absolute`,
 * on or off screen, so it never occupies — or fights for — a grid track)
 * and, while focused, stacked above literally everything else this package
 * renders (`UI_Z_SKIP_LINK`, the highest member of the z-scale) so it's
 * never obscured by the header it's floating above.
 *
 * Focuses `Shell.Main` directly rather than relying on the browser's
 * default fragment-navigation behavior alone: a `<main>` isn't natively
 * focusable, and while `tabIndex={-1}` (which `Shell.Main` sets) makes it
 * focusable, not every browser reliably MOVES focus there just from an
 * anchor's `href="#..."` being activated. Calling `.focus()` explicitly is
 * the same belt-and-braces fix real skip-link implementations use; the
 * `href` is kept too; so the URL fragment and browser history still update
 * normally.
 */
function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={() => {
        document.getElementById(MAIN_CONTENT_ID)?.focus();
      }}
      className={cx(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:start-sm focus:top-sm focus:rounded-control focus:bg-accent focus:px-md focus:py-sm",
        "focus:text-body focus:text-ink-on-accent focus:outline-none",
      )}
      style={{ zIndex: UI_Z_SKIP_LINK }}
    >
      Skip to content
    </a>
  );
}

export interface ShellHeaderProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

/**
 * The top chrome bar — a `<header>` landmark. Renders none of its own
 * content: a consumer composes their own brand mark, top-level nav, and
 * account menu from atoms and passes them in as children. Shipping a
 * pre-built `SiteHeader`/`AppHeader` here would recreate the `mode`-prop
 * problem this package's README warns against, one layer up — see
 * "Placement rules" there.
 */
function ShellHeader({ children, className, style, ...rest }: ShellHeaderProps) {
  return (
    <header
      {...rest}
      className={cx("bg-surface-raised py-sm border-b border-line-base", className)}
      style={{
        gridArea: "header",
        position: "relative",
        zIndex: UI_Z_SHELL,
        borderBottomWidth: UI_BORDER_HAIRLINE,
        ...style,
      }}
    >
      <div style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X }}>{children}</div>
    </header>
  );
}

export interface ShellSideNavProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
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
function ShellSideNav({ children, className, style, ...rest }: ShellSideNavProps) {
  return (
    <nav
      aria-label="Primary"
      {...rest}
      className={cx(
        "min-h-0 overflow-y-auto overflow-x-hidden py-lg border-e border-line-base",
        // Literal arbitrary-value classes, not `shell-vars.ts` constants:
        // Tailwind's build-time scanner needs this exact text in the
        // source file to generate the `tablet:` media query; a JS
        // identifier standing in for it would be invisible to that scan.
        // See the note on this in `shell/internal/shell-vars.ts`.
        "w-[var(--ui-layout-sidebar-rail-w,64px)] tablet:w-[var(--ui-layout-sidebar-w,256px)]",
        className,
      )}
      style={{
        gridArea: "sidenav",
        position: "relative",
        zIndex: UI_Z_SHELL,
        borderInlineEndWidth: UI_BORDER_HAIRLINE,
        ...style,
      }}
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
function ShellMain({ children, className, style, tabIndex, ...rest }: ShellMainProps) {
  return (
    <main
      {...rest}
      id={MAIN_CONTENT_ID}
      tabIndex={tabIndex ?? -1}
      className={cx("min-h-0 min-w-0 overflow-y-auto", className)}
      style={{ gridArea: "main", ...style }}
    >
      <div
        className="w-full mx-auto"
        style={{ maxWidth: UI_WIDTH_CONTENT_MAX, paddingInline: UI_WIDTH_PAGE_PADDING_X }}
      >
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
 * `--color-surface-aside` (the token named specifically for this region).
 * Hidden below the `desktop` breakpoint entirely, CSS-only: a secondary
 * context panel is the first thing to go on a narrower viewport, and unlike
 * `Shell.SideNav` there's no primary-navigation reason it has to stay
 * present in some reduced form.
 */
function ShellRail({ children, className, style, ...rest }: ShellRailProps) {
  return (
    <aside
      {...rest}
      className={cx(
        "hidden min-h-0 overflow-y-auto bg-surface-aside py-lg desktop:block border-s border-line-base",
        className,
      )}
      style={{
        gridArea: "rail",
        width: UI_LAYOUT_ASIDE_W,
        position: "relative",
        zIndex: UI_Z_ASIDE,
        borderInlineStartWidth: UI_BORDER_HAIRLINE,
        ...style,
      }}
    >
      {children}
    </aside>
  );
}

export interface ShellFooterProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

/** The bottom chrome bar — a `<footer>` landmark. Optional, and empty of any built-in content, for the same reason `Shell.Header` is (see there). */
function ShellFooter({ children, className, style, ...rest }: ShellFooterProps) {
  return (
    <footer
      {...rest}
      className={cx("bg-surface-raised py-sm border-t border-line-base", className)}
      style={{
        gridArea: "footer",
        position: "relative",
        zIndex: UI_Z_SHELL,
        borderTopWidth: UI_BORDER_HAIRLINE,
        ...style,
      }}
    >
      <div style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X }}>{children}</div>
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
