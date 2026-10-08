import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { CARDLESS_PAGE_COLUMN_CLASSES, CardlessPageLayout, pageColumnStyle } from "../internal/PageLayout.js";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

export interface ConstructionViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The page's one `<h1>`: usually the name of the page that is not built yet. */
  title: ReactNode;
  /** One line of supporting copy under the title. */
  subtitle?: ReactNode;
  /**
   * The one primary call to action, usually a link back to the home page.
   * Absent from the markup when omitted.
   */
  action?: ReactNode;
  /** A quiet line under the action for a secondary link. Absent from the markup when omitted. */
  notes?: ReactNode;
  /** Merged onto the content root's inline style, after the column measure. */
  style?: CSSProperties;
}

/**
 * The page for a route that is linked but not built yet. It renders the
 * card-free layout (see `CardlessPageLayout`): the title as the one `<h1>`,
 * an optional subtitle, then one call to action on the page background and
 * optional notes, centered in the form-measure column.
 *
 * Chrome-free: it renders its content only, with no header, footer or
 * `<main>`, for a `SiteFrame` to place inside the page's one `<main>`. Every
 * string is a prop; the view ships no copy. Pair the route with the
 * `construction` page kind of `buildSiteMetadata`, which marks it
 * `noindex, nofollow`.
 *
 * Server-safe: no client hooks, no router. `action` is a plain slot, so the
 * caller supplies its own link or button.
 */
export function ConstructionView({ title, subtitle, action, notes, className, style, ...rest }: ConstructionViewProps) {
  assertViewContentRoot("ConstructionView", rest);
  return (
    <div {...rest} className={mergeUiClasses(CARDLESS_PAGE_COLUMN_CLASSES, className)} style={pageColumnStyle("form", style)}>
      <CardlessPageLayout title={title} subtitle={subtitle} action={action} notes={notes} />
    </div>
  );
}
