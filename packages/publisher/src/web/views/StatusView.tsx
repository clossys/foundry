import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { CARDLESS_PAGE_COLUMN_CLASSES, CardlessPageLayout, pageColumnStyle } from "../internal/PageLayout.js";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

export interface StatusViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * The page's one `<h1>`, rendered as text: a status code such as `404`,
   * `"500"` or `"403"`, or a short title such as "Coming soon".
   */
  status: ReactNode;
  /**
   * One line of supporting copy under the status, such as "This page does not
   * exist." A diagnostic reference belongs in this line as caller copy.
   * Absent from the markup when omitted.
   */
  subtitle?: ReactNode;
  /**
   * The primary call to action, on the page background with no card around
   * it: a link home or a retry button. An error page should offer one; a 403,
   * or a placeholder page with nowhere to send the visitor, may omit it. The
   * element is absent from the markup when omitted.
   */
  action?: ReactNode;
  /** A quiet line under the action for secondary links. Absent from the markup when omitted. */
  notes?: ReactNode;
  /** Merged onto the content root's inline style, after the column measure. */
  style?: CSSProperties;
}

/**
 * A whole-page status on the card-free layout (see `CardlessPageLayout`): not
 * found, a server error, no access, an expired link, an unavailable service,
 * a sign-in boundary state, or a placeholder for a route that is linked but
 * not built yet. The status is the one `<h1>`, then an optional subtitle, an
 * optional primary action on the page background and optional notes, centered
 * in the form-measure column.
 *
 * The intended shape for an error page is a code, one subtitle and one primary
 * action; that is guidance for the caller, not a requirement, so only `status`
 * is required.
 *
 * Chrome-free: it renders its content only, with no header, footer or
 * `<main>`, for a `SiteFrame` to place inside the page's one `<main>`. Every
 * string is a prop; the view ships no copy, and the HTTP status is the host's
 * response, not this view's. A placeholder route also takes the
 * `construction` page kind of `buildSiteMetadata` (`noindex, nofollow`).
 *
 * Server-safe: no client hooks, no router. `action` is a plain slot, so the
 * caller supplies its own link or button.
 */
export function StatusView({ status, subtitle, action, notes, className, style, ...rest }: StatusViewProps) {
  assertViewContentRoot("StatusView", rest);
  return (
    <div {...rest} className={mergeUiClasses(CARDLESS_PAGE_COLUMN_CLASSES, className)} style={pageColumnStyle("form", style)}>
      <CardlessPageLayout title={status} subtitle={subtitle} action={action} notes={notes} />
    </div>
  );
}
