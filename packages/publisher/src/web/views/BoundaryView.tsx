import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { ViewChromeGround } from "../internal/viewChromeGround.js";
import { ErrorView, type ErrorViewProps } from "./ErrorView.js";

export interface BoundaryViewProps extends ErrorViewProps {
  /**
   * The site's brand, rendered by Designer's `SiteHeader`. Required: the
   * header announces which site the visitor is on, and this package ships
   * no default brand.
   */
  brand: ReactNode;
  /** The site's call to action, rendered in the banner (`SiteHeader`'s `actions`). Absent from the markup when omitted. */
  headerAction?: ReactNode;
  /** A secondary call to action, rendered in the banner just before `headerAction`. Absent from the markup when omitted. */
  secondaryAction?: ReactNode;
  /** The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted. */
  nav?: ReactNode;
  /**
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`. `"transparent"` matches `LandingView`'s chrome.
   * @default "base"
   */
  ground?: ViewChromeGround;
  /** Persistent footer content, rendered by Designer's `SiteFooter`. */
  footerSecondary?: ReactNode;
}

/**
 * One framed boundary page: `SiteHeader`, an `ErrorView` filling the main
 * area, then `SiteFooter`. Use it for whole-page boundary states — not
 * found, a failure, and the sign-in boundary states (access pending,
 * revoked, not authorized), which are not errors, hence the name.
 *
 * Every `ErrorViewProps` key (`status`, `title`, `description`, `action`,
 * `className`, `style`, and the rest) is forwarded to `ErrorView`; `brand`,
 * the header slots (`headerAction`, `secondaryAction`, `nav`), `ground` and
 * `footerSecondary` belong to the frame and are not. The outer element
 * owns the page height (`min-h-dvh`), so the `ErrorView` root takes
 * `min-h-0 flex-1` in place of its own full-height class and fills the
 * space between header and footer. The page has exactly one `<h1>`, the
 * status.
 *
 * Server-safe: no client hooks, no router, no auth provider. `action` is a
 * plain slot, so the caller supplies its own link or button.
 */
export function BoundaryView({
  brand,
  headerAction,
  secondaryAction,
  nav,
  ground = "base",
  footerSecondary,
  className,
  ...errorProps
}: BoundaryViewProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader ground={ground} brand={brand} nav={nav} secondaryAction={secondaryAction} actions={headerAction} />
      <main className="flex w-full flex-1 flex-col">
        <ErrorView {...errorProps} className={["min-h-0 flex-1", className].filter(Boolean).join(" ")} />
      </main>
      <SiteFooter ground={ground} secondary={footerSecondary} />
    </div>
  );
}
