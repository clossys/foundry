import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { EmptyState } from "@clossys/designer/blocks/server";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

/**
 * `ErrorView`'s props.
 *
 * @deprecated Use `StatusViewProps` (`status`, `subtitle`, `action`, `notes`)
 * with `StatusView`. Kept, unchanged, for existing call sites.
 */
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
  /**
   * A line of supporting copy under `title`. Passed straight through to
   * `EmptyState`. A diagnostic reference belongs here as caller copy, for
   * example `"Something went wrong. Error: 8f2a91c0."`, and any secondary
   * destination is a text link inside this copy rather than a second control
   * in `action`.
   */
  description?: ReactNode;
  /**
   * Slot for the ONE primary recovery control — typically a `Button` atom
   * ("Go home", "Try again"). Passed straight through to `EmptyState`. It
   * stays a `ReactNode` because template bindings fill it with text; put a
   * secondary destination in `description` as a text link. Optional: a 403
   * page for a resource the visitor will never regain access to has
   * nowhere useful to send them.
   */
  action?: ReactNode;
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
 *
 * @deprecated Use `StatusView` (cardless: `status`, `subtitle`, one `action`,
 * optional `notes`) for a whole-page status, or `AuthView` when the state
 * needs a card.
 * Rule of thumb: a title, a subtitle and one action is `StatusView`; content
 * that needs a card to house it takes the card view for that content
 * (`AuthView`, `CaptureView`, `DocumentView`).
 * `ErrorView` still renders as before and is not removed.
 */
export function ErrorView(props: ErrorViewProps) {
  assertViewContentRoot("ErrorView", { role: props.role, id: props.id });
  return <ErrorViewBody {...props} />;
}

/**
 * The error page's markup without the content-root guard. Internal to this
 * package, not exported from its entry points: `GlobalErrorDocument`'s
 * deprecated `ErrorView` shape renders this as the whole `<body>`, with no
 * page frame and no `<main>`, so a host may give its content root
 * `role="main"` there.
 */
export function ErrorViewBody({
  status,
  title,
  description,
  action,
  className,
  style,
  ...rest
}: ErrorViewProps) {
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
    </div>
  );
}
