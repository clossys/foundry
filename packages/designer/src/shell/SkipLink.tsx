import type { ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { UI_Z_SKIP_LINK } from "./internal/shell-vars.js";

export interface SkipLinkProps {
  /**
   * The `id` of the landmark this link jumps to — typically a page's
   * `<main>`. The target element must itself be focusable (`tabIndex={-1}`
   * at minimum) for the programmatic focus move below to land anywhere;
   * a plain `<main id="...">` with no `tabIndex` is not natively
   * focusable, so `href` alone would move the URL fragment without ever
   * moving keyboard focus.
   */
  targetId: string;
  /**
   * The link's own visible text — this package ships no default copy (see
   * this package's README, "Public contract": every label is a consumer-
   * supplied prop). `"Skip to content"`/`"Skip to main content"` is the
   * conventional choice, but the exact wording is this component's one
   * genuinely product-facing string, so it stays a required prop rather
   * than a baked-in default.
   */
  children: ReactNode;
  className?: string;
}

/**
 * The keyboard affordance that lets a keyboard user bypass a site's nav
 * chrome and jump straight to a route's own content — visually hidden
 * until it receives focus, and (once focused) the first thing Tab reaches
 * on the page. Without it, a keyboard user landing on any route has to tab
 * through an entire `SiteHeader`/`NavShell` before reaching the content
 * that actually changed.
 *
 * A public, standalone sibling of the identically-shaped skip link `Shell`
 * already renders internally (see `Shell.tsx`'s own `SkipLink`): that one
 * is wired to `Shell.Main`'s own fixed id, because `Shell`'s five slots are
 * a closed, one-per-app set this package already owns end to end. Site
 * chrome has no such fixed target — a consumer's page structure decides
 * what "content" means and which element carries that id — so this version
 * takes `targetId` (and its own visible `children`) as props instead of
 * assuming either. Render it as the very first thing inside `<body>`,
 * before `SiteHeader`/`NavShell`, and give the jump target itself a
 * matching `id` plus `tabIndex={-1}`.
 *
 * Focuses the target directly, in addition to following `href`'s own URL-
 * fragment navigation: a target isn't natively focusable purely from
 * `tabIndex={-1}`'s absence of a browser default, and not every browser
 * reliably moves focus there from an anchor click alone — calling
 * `.focus()` explicitly is the same belt-and-braces fix `Shell`'s own skip
 * link uses, kept identical here rather than reinvented.
 */
export function SkipLink({ targetId, children, className }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      onClick={() => {
        document.getElementById(targetId)?.focus();
      }}
      className={cx(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:start-sm focus:top-sm focus:rounded-control focus:bg-accent focus:px-md focus:py-sm",
        "focus:text-body focus:text-ink-on-accent focus:outline-none",
        className,
      )}
      style={{ zIndex: UI_Z_SKIP_LINK }}
    >
      {children}
    </a>
  );
}
