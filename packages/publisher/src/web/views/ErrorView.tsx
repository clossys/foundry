import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms";
import { EmptyState } from "@clossys/designer/blocks";
import { UI_WIDTH_PROSE_MAX } from "./internal/view-vars.js";

export interface ErrorViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * The error's status — `404`, `"500"`, `"403"`, or any short code/label a
   * consumer's error boundary or route handler already has. Rendered
   * verbatim as real text content inside the page's own `<h1>`, never as
   * styling alone (a background image, an icon font glyph, a CSS counter):
   * a screen reader user, and anyone who searches the rendered page for
   * "404", needs the code to actually be there as text.
   */
  status: ReactNode;
  /**
   * A short, human description of the error — "Page not found", "Something
   * went wrong". Passed straight through to `EmptyState`'s own required
   * `title`, so it renders as that component's `<h2>`; the page's `<h1>` is
   * `status` above, not this.
   */
  title: ReactNode;
  /** A line of supporting copy under `title`. Passed straight through to `EmptyState`. */
  description?: ReactNode;
  /**
   * Slot for the recovery action — typically a `Button` atom ("Go home",
   * "Try again"). Passed straight through to `EmptyState`. Optional: a 403
   * page for a resource the visitor will never regain access to has
   * nowhere useful to send them.
   */
  action?: ReactNode;
  /**
   * Slot for technical/diagnostic content — a request id, a stack trace, a
   * correlation id for support. Rendered inside a native `<details>`,
   * collapsed by default: this information is for the rare visitor who
   * needs to report the error, not for the page's primary reading order.
   */
  details?: ReactNode;
  /** Copy-owned label for the technical-details disclosure. Required whenever `details` is supplied. */
  detailsLabel?: ReactNode;
  /** Merged onto the outer element's inline style, after this component's own. */
  style?: CSSProperties;
}

/**
 * A full-page error state — 404, 500, 403, or any other whole-page failure.
 * A view, not a block: a page cannot show two of these at once (there is
 * no such thing as "half a 404"), which is exactly this package's test 3
 * for the view/block boundary (see the README's "Placement rules").
 *
 * Composes `EmptyState` rather than reimplementing it — the icon/title/
 * description/action layout this needs is identical to the zero-item
 * placeholder `EmptyState` already ships. The status code is NOT threaded
 * through `EmptyState`'s own slots: it renders as this component's own
 * `<h1>`, above the `EmptyState`, so a page built from this view has
 * exactly one top-level heading (the status) with the error's own
 * description sitting one level below it (`EmptyState`'s `<h2>` title) —
 * the same title/subtitle heading structure a `PageHeader` gives an
 * ordinary page.
 *
 * Takes no router of any kind: `action` is a plain `ReactNode` slot, so a
 * consumer passes their own router's link/button ("Go home") rather than
 * this component importing or assuming one. See the README for why this
 * package never bundles routing.
 */
export function ErrorView({
  status,
  title,
  description,
  action,
  details,
  detailsLabel,
  className,
  style,
  ...rest
}: ErrorViewProps) {
  if (details && !detailsLabel) {
    throw new Error("ErrorView requires detailsLabel whenever details is provided.");
  }
  return (
    <div
      {...rest}
      className={mergeUiClasses(
        "flex min-h-dvh flex-col items-center justify-center gap-lg p-2xl text-center",
        className,
      )}
      style={style}
    >
      <h1 className="text-display-l font-display text-ink-primary">{status}</h1>
      <EmptyState title={title} description={description} action={action} />
      {details ? (
        <details
          className="mt-lg w-full text-left text-body-s text-ink-muted"
          style={{ maxWidth: UI_WIDTH_PROSE_MAX }}
        >
          <summary className="cursor-pointer text-body-s text-ink-secondary">
            {detailsLabel}
          </summary>
          <div className="mt-sm">{details}</div>
        </details>
      ) : null}
    </div>
  );
}
