import { useId } from "react";
import type { ReactNode } from "react";
import { Badge, type BadgeVariant } from "@clossys/designer/atoms/server";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteHeaderProps } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import type { PackReviewExportKind, PackReviewStatus } from "../../pack/review-index.js";

/** One forced state of a page: the slug shown, and the same-site address that pins the page to it. */
export interface PackReviewViewState {
  id: string;
  href: string;
}

export interface PackReviewViewPage {
  /** The route, shown as it is, e.g. `/contact`. */
  id: string;
  /** The page's own same-site address. */
  href: string;
  status: PackReviewStatus;
  states: readonly PackReviewViewState[];
}

export interface PackReviewViewExport {
  /** Unique across the exports. */
  id: string;
  kind: PackReviewExportKind;
  /** The output path, shown as plain text; the view makes no link of it. */
  path: string;
  /** A same-site address that serves the export. When present, the kind's name links to it. */
  href?: string;
  status: PackReviewStatus;
  /** The review width in CSS pixels, for an export that is reviewed at one. */
  width?: number;
}

/** Every visible string. The view owns no wording: a host passes approved copy for each. */
export interface PackReviewViewLabels {
  pagesHeading: string;
  exportsHeading: string;
  sheetHeading: string;
  /** Shown in place of a list with no entries. */
  none: string;
  /** The words for each iteration badge. */
  statuses: Readonly<Record<PackReviewStatus, string>>;
  /** The words naming each kind of export. */
  kinds: Readonly<Record<PackReviewExportKind, string>>;
  /** Names the review width of an export, e.g. for `600`. */
  exportWidth: (width: number) => string;
  /** The accessible name of one contact-sheet frame. `state` is absent for a page's own address. */
  frameTitle: (frame: { page: string; state?: string; width: number }) => string;
}

export interface PackReviewViewProps {
  /** Persistent site identity, rendered by Designer's `SiteHeader`. Required, as in the other views. */
  brand: ReactNode;
  /** Text-only label naming the surface, shown as `SiteHeader`'s non-interactive badge. Required: this view is never a member-facing page. */
  surfaceLabel: string;
  /** A call to action, rendered in the banner (`SiteHeader`'s `actions`) before the surface badge. Absent from the markup when omitted. */
  headerAction?: ReactNode;
  /** A secondary call to action, rendered in the banner just before `headerAction`. Absent from the markup when omitted. */
  secondaryAction?: ReactNode;
  /** The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted. */
  nav?: ReactNode;
  /**
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`.
   * @default "base"
   */
  ground?: import("../internal/viewChromeGround.js").ViewChromeGround;
  heading: ReactNode;
  description: ReactNode;
  pages: readonly PackReviewViewPage[];
  exports: readonly PackReviewViewExport[];
  labels: PackReviewViewLabels;
  /** Viewport widths of the contact sheet, in CSS pixels. @default [390, 1024, 1440] */
  widths?: readonly number[];
  /** Persistent footer content, rendered by Designer's `SiteFooter`. */
  footerSecondary?: ReactNode;
}

const DEFAULT_WIDTHS: readonly number[] = [390, 1024, 1440];

/** Tall enough to show a page's first screens without a scroll bar of its own in most layouts. */
const FRAME_HEIGHT = 640;

const STATUS_VARIANT: Readonly<Record<PackReviewStatus, BadgeVariant>> = {
  draft: "neutral",
  delegated: "warning",
  approved: "success",
};

/** A same-site address: one leading slash, no second slash, no backslash, no control character. Anything else is refused, not rendered. */
const SAME_SITE_HREF = /^\/(?!\/)[^\\\u0000-\u001f\u007f-\u009f]*$/;

function requireHref(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAME_SITE_HREF.test(value)) {
    throw new RenderError("resolution-failed", `PackReviewView requires ${path} to be a same-site address.`);
  }
  return value;
}

function requireStatus(value: unknown, path: string): PackReviewStatus {
  if (value !== "draft" && value !== "delegated" && value !== "approved") {
    throw new RenderError("resolution-failed", `PackReviewView requires ${path} to be draft, delegated or approved.`);
  }
  return value;
}

function requireWidths(widths: readonly number[]): readonly number[] {
  if (!Array.isArray(widths) || widths.length === 0 || !widths.every((width) => Number.isInteger(width) && width > 0 && width <= 4096)) {
    throw new RenderError("resolution-failed", "PackReviewView requires widths to be positive whole numbers.");
  }
  return widths;
}

interface SheetFrame {
  key: string;
  page: string;
  state?: string;
  href: string;
  status: PackReviewStatus;
}

/**
 * The dev-only review index: one page listing a site's pages and their forced
 * states, its exported artifacts, and a contact sheet that renders each page
 * and state in a lazy frame at each width. Every entry carries an iteration
 * badge (`draft`, `delegated` or `approved`): each page, forced state and
 * contact-sheet frame shows its page's badge, and each export its own.
 *
 * The frame is the other Publisher views': Designer's `SiteHeader` with the
 * surface badge, a `PageHeader`, and `SiteFooter`, with the page held to the
 * form measure (`--ui-width-form-max`). The contact sheet scrolls sideways
 * inside its own section, so the widest frame never widens the page.
 *
 * Server-safe: no client hooks. It reads nothing and fetches nothing; the
 * caller builds the entries (`buildPackReviewIndex`) and the addresses, and
 * the view refuses any address that is not same-site, an unknown badge, and a
 * width that is not a positive whole number, naming the position and never
 * the value. Text is rendered as text; no markup from an entry is injected.
 */
export function PackReviewView({
  brand,
  surfaceLabel,
  headerAction,
  secondaryAction,
  nav,
  ground = "base",
  heading,
  description,
  pages,
  exports,
  labels,
  widths = DEFAULT_WIDTHS,
  footerSecondary,
}: PackReviewViewProps) {
  const sheetWidths = requireWidths(widths);
  // One id per section heading, so each section is named by its own h2 through `aria-labelledby`.
  const pagesHeadingId = useId();
  const exportsHeadingId = useId();
  const sheetHeadingId = useId();

  pages.forEach((page, pageIndex) => {
    requireHref(page.href, `pages[${pageIndex}].href`);
    requireStatus(page.status, `pages[${pageIndex}].status`);
    page.states.forEach((state, stateIndex) => requireHref(state.href, `pages[${pageIndex}].states[${stateIndex}].href`));
  });
  exports.forEach((entry, index) => {
    requireStatus(entry.status, `exports[${index}].status`);
    if (entry.href !== undefined) requireHref(entry.href, `exports[${index}].href`);
  });

  const frames: SheetFrame[] = pages.flatMap((page) => [
    { key: page.id, page: page.id, href: page.href, status: page.status },
    ...page.states.map((state) => ({ key: `${page.id}:${state.id}`, page: page.id, state: state.id, href: state.href, status: page.status })),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        ground={ground}
        brand={brand}
        nav={nav}
        secondaryAction={secondaryAction}
        actions={headerAction}
        surfaceLabel={surfaceLabel}
      />
      <main
        className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl"
        style={{ maxWidth: "var(--ui-width-form-max, none)" }}
      >
        <PageHeader title={heading} description={description} />

        <section className="flex flex-col gap-md" aria-labelledby={pagesHeadingId}>
          <h2 id={pagesHeadingId} className="text-h2 text-ink-primary">
            {labels.pagesHeading}
          </h2>
          {pages.length === 0 ? (
            <p className="text-body-s text-ink-muted">{labels.none}</p>
          ) : (
            <ul className="flex flex-col gap-md">
              {pages.map((page) => (
                <li key={page.id} className="flex flex-col gap-xs">
                  <span className="flex items-center gap-xs text-body">
                    <a href={page.href}>{page.id}</a>
                    <Badge variant={STATUS_VARIANT[page.status]}>{labels.statuses[page.status]}</Badge>
                  </span>
                  {page.states.length > 0 ? (
                    <ul className="flex flex-wrap gap-sm ps-lg text-body-s">
                      {page.states.map((state) => (
                        <li key={state.id} className="flex items-center gap-xs">
                          <a href={state.href}>{state.id}</a>
                          <Badge variant={STATUS_VARIANT[page.status]}>{labels.statuses[page.status]}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={exportsHeadingId}>
          <h2 id={exportsHeadingId} className="text-h2 text-ink-primary">
            {labels.exportsHeading}
          </h2>
          {exports.length === 0 ? (
            <p className="text-body-s text-ink-muted">{labels.none}</p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {exports.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-xs text-body-s">
                  <Badge variant={STATUS_VARIANT[entry.status]}>{labels.statuses[entry.status]}</Badge>
                  <span className="text-ink-primary">
                    {entry.href === undefined ? labels.kinds[entry.kind] : <a href={entry.href}>{labels.kinds[entry.kind]}</a>}
                  </span>
                  {entry.width === undefined ? null : <span className="text-ink-secondary">{labels.exportWidth(entry.width)}</span>}
                  <code className="break-all text-ink-secondary">{entry.path}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={sheetHeadingId}>
          <h2 id={sheetHeadingId} className="text-h2 text-ink-primary">
            {labels.sheetHeading}
          </h2>
          {frames.length === 0 ? (
            <p className="text-body-s text-ink-muted">{labels.none}</p>
          ) : (
            <div className="flex flex-col gap-xl overflow-x-auto">
              {frames.map((frame) => (
                <div key={frame.key} className="flex flex-col gap-sm">
                  <p className="flex items-center gap-xs text-body-s text-ink-secondary">
                    <span>{frame.page}</span>
                    {frame.state === undefined ? null : (
                      <>
                        <span aria-hidden="true">{"\u00b7"}</span>
                        <span>{frame.state}</span>
                      </>
                    )}
                    <Badge variant={STATUS_VARIANT[frame.status]}>{labels.statuses[frame.status]}</Badge>
                  </p>
                  <div className="flex gap-lg">
                    {sheetWidths.map((width) => (
                      <iframe
                        key={width}
                        src={frame.href}
                        title={labels.frameTitle({ page: frame.page, ...(frame.state === undefined ? {} : { state: frame.state }), width })}
                        width={width}
                        height={FRAME_HEIGHT}
                        loading="lazy"
                        className="shrink-0 border border-line-base"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter ground={ground} secondary={footerSecondary} />
    </div>
  );
}
