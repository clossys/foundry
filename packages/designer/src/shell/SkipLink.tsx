import type { ComponentProps, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { UI_Z_SKIP_LINK } from "./internal/shell-vars.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Link = componentLeaf<typeof import("../components/Link.js").Link>("components.link");

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
 * A public, standalone component that `Shell` also renders for its own
 * `Shell.Main` target: `Shell`'s five slots are a closed, one-per-app set
 * wired to a fixed, package-owned id, whereas site chrome has no such fixed
 * target, so this version takes `targetId` (and its own visible `children`)
 * as props. Render it as the very first thing inside `<body>`, before
 * `SiteHeader`/`NavShell`, and give the jump target itself a matching `id`
 * plus `tabIndex={-1}`.
 *
 * Activation (click, Enter, or Space) moves focus to the target and scrolls
 * it into view, and cancels the anchor's default navigation, so
 * `location.hash` and browser history stay untouched. That keeps a
 * hash-routed application on its current route: following `href="#target"`
 * would otherwise overwrite the route in the fragment. The `href` remains as
 * the fallback for the cases where this handler does not run or cannot move
 * focus: JavaScript is unavailable, the click is a modified or non-primary
 * one (open in a new tab), the target is not in the document, or the target
 * cannot take focus (for example it lacks `tabIndex={-1}`). Space follows the
 * same `href` fallback in those cases, as Enter does.
 */
export function SkipLink({ targetId, children, className }: SkipLinkProps) {
  // True only when focus actually landed on the target. A target that cannot
  // take focus (no `tabIndex`, `inert`, hidden) leaves the `href` to run, so
  // the link never becomes a no-op.
  const jumpToTarget = (): boolean => {
    const target = document.getElementById(targetId);
    if (!target) return false;
    // `focus()` scrolls the target into view unless `preventScroll` is set.
    target.focus();
    return document.activeElement === target;
  };

  const onClick: NonNullable<ComponentProps<typeof Link>["onClick"]> = event => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (jumpToTarget()) event.preventDefault();
  };

  // A link activates on Enter natively (as a click); Space is added here so
  // the control also answers to it, as a button would. Space does not follow
  // an `href` on its own, so when focus cannot move to the target the handler
  // clicks the link, which runs the `href` fragment fallback exactly as Enter
  // does, and also keeps Space from scrolling the page.
  const onKeyDown: NonNullable<ComponentProps<typeof Link>["onKeyDown"]> = event => {
    if (event.defaultPrevented || event.key !== " ") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!jumpToTarget() && event.currentTarget instanceof HTMLElement) event.currentTarget.click();
  };

  return (
    <Link
      href={`#${targetId}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cx(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:start-sm focus:top-sm focus:rounded-control focus:bg-accent focus:px-md focus:py-sm",
        "focus:text-body focus:text-ink-on-accent focus:outline-none",
        className,
      )}
      style={{ zIndex: UI_Z_SKIP_LINK }}
    >
      {children}
    </Link>
  );
}
