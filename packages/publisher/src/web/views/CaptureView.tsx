import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card, mergeUiClasses } from "@clossys/designer/atoms/server";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteChromeGround } from "../internal/viewChromeGround.js";
import { assertViewContentRoot, usesLegacyChrome } from "../internal/viewContentRoot.js";

export interface CaptureViewProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The site's brand, rendered by Designer's `SiteHeader` on the legacy page.
   *
   * @deprecated Page chrome belongs to `SiteFrame`, which owns the page's
   * skip link, banner, single `<main>` and contentinfo. Render this view
   * inside a `SiteFrame` and omit every chrome prop (`brand`, `header`,
   * `footer`, `mainId`, `nav`, `headerAction`, `headerSecondaryAction`, `ground`,
   * `footerSecondary`): the view then renders its content only, with no
   * landmarks. Passing any of them selects the legacy page, which keeps its
   * own header, `<main>` and footer.
   */
  brand?: ReactNode;
  /**
   * The page's own banner, replacing Designer's `SiteHeader` entirely, for a
   * consumer that carries its own site chrome. When given (including `null`,
   * which renders no banner) it is rendered as-is in place of the header: it
   * should hold the page's one banner landmark, and `brand`, `nav`,
   * `headerAction`, `headerSecondaryAction` and `ground` are not used for the header.
   * `brand` is not rendered while `header` is given.
   * When `undefined`, the Designer header renders as before.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  header?: ReactNode;
  /**
   * The page's own footer, replacing Designer's `SiteFooter` entirely. When
   * given (including `null`, which renders no footer) it is rendered as-is
   * and should hold the page's one contentinfo landmark; `footerSecondary`
   * is not used. When `undefined`, the Designer footer renders as before.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  footer?: ReactNode;
  /**
   * The `id` of the page's `<main>`, so a skip link rendered by the host (its
   * own chrome) can target it. When set to a non-empty string, `<main>` gets
   * that `id` and `tabIndex={-1}` so the link can move focus there. When
   * `undefined` (or empty) the markup is unchanged: no `id`, no `tabindex`.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  mainId?: string;
  /**
   * The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  nav?: ReactNode;
  /**
   * The banner's call to action (`SiteHeader`'s `actions`), such as one
   * Designer `SiteHeader.ActionLink` per environment. Absent from the markup
   * when omitted.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  headerAction?: ReactNode;
  /**
   * A secondary call to action in the banner, rendered just before
   * `headerAction`. Named apart from `secondaryAction`, which on this view
   * sits inside the card. Absent from the markup when omitted.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  headerSecondaryAction?: ReactNode;
  /**
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`.
   * @default "base"
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  ground?: SiteChromeGround;
  /** The page's one `<h1>`. */
  heading: ReactNode;
  /** Supporting copy under the heading. */
  description?: ReactNode;
  /**
   * Consumer-owned fields and controls. CaptureView does not submit,
   * validate, or inspect this content; a consumer may compose Designer's
   * Form/FieldGroup blocks or its own form implementation here.
   */
  form?: ReactNode;
  /**
   * Consumer-owned failed-submit summary. CaptureView makes this a real,
   * programmatically focusable alert before the form. On a client-side
   * failed submission the consumer focuses `errorSummaryId`; the view owns
   * the stable placement and target, never the submission state itself.
   */
  errorSummary?: ReactNode;
  /** Required with `errorSummary`; the id of its focus target. */
  errorSummaryId?: string;
  /**
   * Consumer-owned confirmation replacing the form after a successful
   * submission. It renders in a polite live region in the same page
   * position, rather than navigating away.
   */
  submitted?: ReactNode;
  /** Optional secondary navigation below the active form or confirmation, inside the card. */
  secondaryAction?: ReactNode;
  /**
   * The notes block below the card: supporting lines such as how the
   * submission is used. Absent from the markup when omitted.
   */
  notes?: ReactNode;
  /**
   * Persistent footer content, rendered by Designer's `SiteFooter`, such as
   * Designer's `SiteFooter.Legal` with privacy and terms as same-host
   * routes. This view supplies no default links and no copy.
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   */
  footerSecondary?: ReactNode;
  /**
   * Accessible name for the region that holds the form or the confirmation.
   * @default "Capture form"
   */
  formLabel?: string;
  style?: CSSProperties;
}

/**
 * A page for a consumer-owned capture form. Inside a `SiteFrame` (the
 * default, with no chrome prop) it renders its content only, landmark-free;
 * with any deprecated chrome prop it renders the legacy page: site header,
 * then the three body blocks every front-door view shares - the page header block
 * (heading and description), the body block (the form inside Designer's
 * `Card`) and the notes block (`notes`, below the card) - then site footer. It owns
 * neither network submission nor validation state: the only state rule it
 * applies is presentational and fail-closed-`submitted` replaces the form
 * in place, still inside the card.
 */
export function CaptureView({
  brand,
  header,
  footer,
  mainId,
  nav,
  headerAction,
  headerSecondaryAction,
  ground,
  heading,
  description,
  form,
  errorSummary,
  errorSummaryId,
  submitted,
  secondaryAction,
  notes,
  footerSecondary,
  formLabel = "Capture form",
  className,
  style,
  ...rest
}: CaptureViewProps) {
  if ((errorSummary === undefined) !== (errorSummaryId === undefined)) {
    throw new Error("CaptureView requires errorSummary and errorSummaryId together.");
  }
  if (errorSummaryId !== undefined && (typeof errorSummaryId !== "string" || errorSummaryId.trim().length === 0)) {
    throw new Error("CaptureView requires errorSummaryId to be a non-whitespace string.");
  }
  if (submitted === undefined && form === undefined) {
    throw new Error("CaptureView requires form while submitted is absent.");
  }

  const activeContent =
    submitted === undefined ? (
      <>
        {errorSummary === undefined ? null : (
          <div id={errorSummaryId} role="alert" tabIndex={-1} className="mb-lg">
            {errorSummary}
          </div>
        )}
        {form}
      </>
    ) : (
      <section role="status" aria-live="polite">
        {submitted}
      </section>
    );

  const content = (
    <>
      <PageHeader title={heading} description={description} />
      <section aria-label={formLabel}>
        <Card className="flex flex-col gap-lg">
          {activeContent}
          {secondaryAction === undefined ? null : <div className="text-body-s text-ink-secondary">{secondaryAction}</div>}
        </Card>
      </section>
      {notes ? <div className="flex flex-col gap-xs text-body-s text-ink-secondary">{notes}</div> : null}
    </>
  );

  const legacyChrome = usesLegacyChrome({ brand, header, footer, mainId, nav, headerAction, headerSecondaryAction, ground, footerSecondary });
  if (!legacyChrome) {
    assertViewContentRoot("CaptureView", rest);
    return (
      <div
        {...rest}
        className={mergeUiClasses("mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl", className)}
        style={{ maxWidth: "var(--ui-width-prose-max, none)", ...style }}
      >
        {content}
      </div>
    );
  }

  const chromeGround = ground ?? "base";
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      {header !== undefined ? (
        header
      ) : (
        <SiteHeader ground={chromeGround} brand={brand} nav={nav} secondaryAction={headerSecondaryAction} actions={headerAction} />
      )}
      <main id={mainId || undefined} tabIndex={mainId ? -1 : undefined} className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style={{ maxWidth: "var(--ui-width-prose-max, none)" }}>
        {content}
      </main>
      {footer !== undefined ? footer : <SiteFooter ground={chromeGround} secondary={footerSecondary} />}
    </div>
  );
}
