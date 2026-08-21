import type { ReactNode } from "react";
import {
  Breadcrumbs as AriaBreadcrumbs,
  Breadcrumb as AriaBreadcrumbItem,
  Link as AriaLink,
  type BreadcrumbsProps as AriaBreadcrumbsProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";

export interface BreadcrumbProps
  extends Omit<AriaBreadcrumbsProps<object>, "children" | "className"> {
  /** One or more `Breadcrumb.Item`s, first-to-last (root first, current page last). */
  children: ReactNode;
  className?: string;
  /**
   * Accessible name for the surrounding `<nav>` landmark. Several navs on
   * one page (a sidebar nav, this one) need distinct names so assistive
   * tech can tell them apart in a landmarks list.
   * @default "Breadcrumb"
   */
  "aria-label"?: string;
}

/**
 * A breadcrumb trail. Built on react-aria-components' `Breadcrumbs` +
 * `Breadcrumb` + `Link` collection components rather than hand-rolled: they
 * supply the collection's keyboard behavior, and — the part that's easy to
 * get subtly wrong by hand — automatically mark the LAST item as the
 * current page, rendering it as inert text with `aria-current="page"`
 * instead of a clickable link, purely from its position in the list. See
 * `Breadcrumb.Item` below for how that's wired.
 *
 * Wrapped in a real `<nav>` landmark: react-aria-components' `Breadcrumbs`
 * renders only the `<ol>` and applies its `aria-label` there, not a
 * `role="navigation"` element, so this component supplies the `<nav>` itself —
 * without it, the trail is an unlabeled list, not a landmark a screen
 * reader user can jump to.
 *
 * Composable rather than a flat `items={[...]}` array: react-aria-components'
 * `Breadcrumbs` is itself a collection component built to take real JSX
 * children (each a `Breadcrumb.Item`), and a consumer's items are almost
 * always `ReactNode`s already (a route name, an icon + label) rather than
 * plain strings — forcing them through a data prop would mean re-inventing
 * a render-prop escape hatch for exactly the cases a data-driven API
 * usually can't express cleanly. If a future consumer's breadcrumbs are
 * genuinely data-driven (fetched, computed), they can still `.map()` an
 * array into `Breadcrumb.Item` children themselves — ordinary React, no
 * API on this component needs to change to support it.
 */
function BreadcrumbRoot({
  children,
  className,
  "aria-label": ariaLabel = "Breadcrumb",
  ...rest
}: BreadcrumbProps) {
  return (
    <nav aria-label={ariaLabel}>
      <AriaBreadcrumbs {...rest} className={cx("flex list-none items-center gap-xs", className)}>
        {children}
      </AriaBreadcrumbs>
    </nav>
  );
}

export interface BreadcrumbItemProps {
  /**
   * Destination for this item. Omit for a step with no navigable target —
   * still valid because whether an item is clickable is decided by its
   * POSITION (only the last item is ever rendered as current/inert), not
   * by whether `href` is present.
   */
  href?: string;
  children: ReactNode;
  /** Merged onto the rendered link/current-page text. */
  className?: string;
}

/**
 * One step in a `Breadcrumb` trail. Whichever `Breadcrumb.Item` is LAST
 * among its siblings is automatically rendered as the current page: real
 * `react-aria-components` behavior (`node.nextKey == null`, computed from
 * the collection, not a prop this component sets), which renders it as a
 * non-interactive `<span>` carrying `aria-current="page"` instead of an
 * `<a>` — a screen reader announces "current page", and there's no
 * clickable link to the page already being viewed.
 */
function BreadcrumbItem({ href, children, className }: BreadcrumbItemProps) {
  return (
    <AriaBreadcrumbItem className="not-last:after:content-['/'] not-last:after:text-ink-muted flex items-center gap-xs">
      <AriaLink
        href={href}
        className={(renderProps) =>
          cx(
            "text-body-s font-body",
            renderProps.isCurrent
              ? "text-ink-primary"
              : "text-ink-link hover:underline",
            className,
          )
        }
      >
        {children}
      </AriaLink>
    </AriaBreadcrumbItem>
  );
}

export const Breadcrumb = Object.assign(BreadcrumbRoot, { Item: BreadcrumbItem });
