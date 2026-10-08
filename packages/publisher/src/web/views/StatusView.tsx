import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { CARDLESS_PAGE_COLUMN_CLASSES, CardlessPageLayout, pageColumnStyle } from "../internal/PageLayout.js";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

export interface StatusViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * The status code or short label, such as `404`, `"500"` or `"403"`,
   * rendered as text inside the page's one `<h1>`.
   */
  status: ReactNode;
  /**
   * The one line of copy under the status, such as "This page does not
   * exist." A diagnostic reference belongs in this line as caller copy.
   */
  subtitle: ReactNode;
  /**
   * The one primary recovery action, such as a link home or a retry button,
   * on the page background with no card around it.
   */
  action: ReactNode;
  /** A quiet line under the action for secondary links. Absent from the markup when omitted. */
  notes?: ReactNode;
  /** Merged onto the content root's inline style, after the column measure. */
  style?: CSSProperties;
}

/**
 * A whole-page status: not found, a server error, no access, an expired link
 * or an unavailable service. It renders the card-free layout (see
 * `CardlessPageLayout`): the status as the one `<h1>`, one subtitle, then one
 * primary action on the page background and optional notes, centered in the
 * form-measure column.
 *
 * Chrome-free: it renders its content only, with no header, footer or
 * `<main>`, for a `SiteFrame` to place inside the page's one `<main>`. Every
 * string is a prop; the view ships no copy, and the HTTP status is the host's
 * response, not this view's.
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
