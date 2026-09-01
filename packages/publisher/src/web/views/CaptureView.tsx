import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";

export interface CaptureViewProps extends HTMLAttributes<HTMLDivElement> {
  /** Persistent site identity, rendered in the page banner. */
  brand: ReactNode;
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
  /** Optional secondary navigation below the active form or confirmation. */
  secondaryAction?: ReactNode;
  /** Persistent footer content. */
  footerSecondary?: ReactNode;
  style?: CSSProperties;
}

/**
 * A page shell for a consumer-owned capture form. It owns neither network
 * submission nor validation state: the only state rule it applies is
 * presentational and fail-closed—`submitted` replaces the form in place.
 */
export function CaptureView({
  brand,
  heading,
  description,
  form,
  errorSummary,
  errorSummaryId,
  submitted,
  secondaryAction,
  footerSecondary,
  className,
  style,
  ...rest
}: CaptureViewProps) {
  if ((errorSummary === undefined) !== (errorSummaryId === undefined)) {
    throw new Error("CaptureView requires errorSummary and errorSummaryId together.");
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

  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader brand={brand} />
      <main className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style={{ maxWidth: "var(--ui-width-prose-max, 48rem)" }}>
        <PageHeader title={heading} description={description} />
        <section aria-label="Capture form" className="flex flex-col">
          {activeContent}
          {secondaryAction === undefined ? null : <div className="mt-lg text-body-s text-ink-secondary">{secondaryAction}</div>}
        </section>
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}
