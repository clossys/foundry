import type { ReactNode } from "react";
import { Card, mergeUiClasses } from "@clossys/designer/atoms/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { ViewChromeGround } from "../internal/viewChromeGround.js";
import type { ErrorViewProps } from "./ErrorView.js";

export interface BoundaryViewProps extends ErrorViewProps {
  /**
   * The site's brand, rendered by Designer's `SiteHeader`. Required: the
   * header announces which site the visitor is on, and this package ships
   * no default brand.
   */
  brand: ReactNode;
  /**
   * The page's own banner, replacing Designer's `SiteHeader` entirely, for a
   * consumer that carries its own site chrome. When given (including `null`,
   * which renders no banner) it is rendered as-is in place of the header: it
   * should hold the page's one banner landmark, and `brand`, `nav`,
   * `headerAction`, `secondaryAction` and `ground` are not used for the header.
   * `brand` stays required and is not rendered while `header` is given.
   * When `undefined`, the Designer header renders as before.
   */
  header?: ReactNode;
  /**
   * The page's own footer, replacing Designer's `SiteFooter` entirely. When
   * given (including `null`, which renders no footer) it is rendered as-is
   * and should hold the page's one contentinfo landmark; `footerSecondary`
   * is not used. When `undefined`, the Designer footer renders as before.
   */
  footer?: ReactNode;
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
  /**
   * The notes block below the card: supporting lines such as a support
   * contact or a reference to quote. Absent from the markup when omitted.
   */
  notes?: ReactNode;
  /**
   * Persistent footer content, rendered by Designer's `SiteFooter`. On a
   * boundary page this holds a legal row only - Designer's
   * `SiteFooter.Legal`, with privacy and terms as same-host routes. This
   * view supplies no default links and no copy.
   */
  footerSecondary?: ReactNode;
}

/**
 * One framed boundary page: `SiteHeader`, the three body blocks every
 * front-door view shares, then `SiteFooter`. Use it for whole-page boundary
 * states - not found, a failure, and the sign-in boundary states (access
 * pending, revoked, not authorized), which are not errors, hence the name.
 *
 * Inside `<main>`, on the same form-measure column as `AuthView`: the page
 * header block (`status` as the page's one `<h1>`, `title` as an `<h2>`,
 * then `description`), the body block (Designer's `Card` around `action`,
 * omitted when there is no action) and the notes block (`notes`, below the
 * card).
 *
 * It takes `ErrorViewProps` but no longer renders `ErrorView`: `className`,
 * `style` and the other HTML attributes land on the outer element, which
 * owns the page height (`min-h-dvh`).
 *
 * Server-safe: no client hooks, no router, no auth provider. `action` is a
 * plain slot, so the caller supplies its own link or button.
 */
export function BoundaryView({
  brand,
  header,
  footer,
  headerAction,
  secondaryAction,
  nav,
  ground = "base",
  footerSecondary,
  notes,
  status,
  title,
  description,
  action,
  className,
  style,
  ...rest
}: BoundaryViewProps) {
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      {header !== undefined ? (
        header
      ) : (
        <SiteHeader ground={ground} brand={brand} nav={nav} secondaryAction={secondaryAction} actions={headerAction} />
      )}
      <main
        className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl"
        style={{ maxWidth: "var(--ui-width-form-max, none)" }}
      >
        <div className="flex flex-col gap-xs">
          <h1 className="text-display-l font-display text-ink-primary">{status}</h1>
          <h2 className="text-h2 font-display text-ink-primary">{title}</h2>
          {description ? <p className="text-body text-ink-secondary">{description}</p> : null}
        </div>
        {action ? <Card className="flex flex-col gap-lg">{action}</Card> : null}
        {notes ? <div className="flex flex-col gap-xs text-body-s text-ink-secondary">{notes}</div> : null}
      </main>
      {footer !== undefined ? footer : <SiteFooter ground={ground} secondary={footerSecondary} />}
    </div>
  );
}
