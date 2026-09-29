import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { ArticleBody, PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import { renderStructuredDocument } from "../../document/render.js";
import { validateLegalDocument } from "../../document/legal.js";
import type { LegalDocument } from "../../document/legal.js";

/** Approved copy for the labels this view adds around a legal document. There is no built-in wording. */
export interface LegalViewLabels {
  /** Visible label for the effective date. */
  effectiveDate: CopyRef;
  /** Visible label for the last-updated date. */
  lastUpdated: CopyRef;
  /** Heading of the draft callout, rendered whenever the document status is `"draft"`. */
  draftHeading: CopyRef;
}

export interface LegalViewProps extends HTMLAttributes<HTMLDivElement> {
  /** Persistent site identity, rendered in the page banner. */
  brand: ReactNode;
  /**
   * The legal document. LegalView always validates it with
   * validateLegalDocument and renders it through renderStructuredDocument
   * itself, so neither check can be skipped on the path to this page.
   */
  document: LegalDocument;
  /** The approved-copy resolver used for the title, the body, the labels and the facts to confirm. */
  resolveCopyId: CopyResolver;
  /** Approved copy for the effective-date, last-updated and draft-callout labels. */
  labels: LegalViewLabels;
  /** BCP 47 locale used to format both dates. Required: there is no default. */
  locale: string;
  /** Persistent footer content. */
  footerSecondary?: ReactNode;
  style?: CSSProperties;
}

function resolveCopy(ref: CopyRef, path: string, resolver: CopyResolver): string {
  const resolution = resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `LegalView could not resolve CopyRef "${ref.id}" at ${path}.`);
  }
  return resolution.text;
}

function createDateFormatter(locale: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RenderError("resolution-failed", `LegalView could not format dates for locale ${JSON.stringify(locale)}.`);
    }
    throw error;
  }
}

/** `value` is already proven `YYYY-MM-DD` by validateLegalDocument; the date is built in UTC so no timezone can shift the day. */
function formatDate(formatter: Intl.DateTimeFormat, value: string): string {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  // Date.UTC maps years 0-99 to 1900-1999, so set the full year explicitly.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return formatter.format(date);
}

/**
 * A site page for one LegalDocument (terms or privacy).
 *
 * What it guarantees: the document is validated first (any finding throws a
 * RenderError before anything renders), the top-level sections appear in the
 * fixed order for the document kind, both dates are shown as machine-readable
 * `<time>` elements formatted for `locale`, and a document whose status is
 * `"draft"` always carries a draft callout listing its facts to confirm, ahead
 * of the sections. No prop can suppress or alter that callout.
 *
 * What it does not do: it says nothing about the legal adequacy of any text
 * (every word comes from the caller's copy registry), and it does not enforce
 * the production gate. A caller must call gateLegalDocument(document,
 * "production") separately before publishing. The content variables
 * (entity, jurisdiction, contact) are not rendered and nothing is interpolated
 * into the copy.
 */
export function LegalView({ brand, document, resolveCopyId, labels, locale, footerSecondary, className, style, ...rest }: LegalViewProps) {
  const findings = validateLegalDocument(document);
  if (findings.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `LegalView refused an invalid legal document: ${findings.map((finding) => `${finding.rule} at ${finding.path ?? "(document)"}`).join("; ")}.`,
    );
  }

  const rendered = renderStructuredDocument(document, { resolveCopyId });
  const title = rendered.resolutions[0]?.text;
  if (title === undefined) {
    throw new RenderError("resolution-failed", `LegalView could not resolve title for document "${document.id}".`);
  }

  const effectiveLabel = resolveCopy(labels.effectiveDate, "labels.effectiveDate", resolveCopyId);
  const updatedLabel = resolveCopy(labels.lastUpdated, "labels.lastUpdated", resolveCopyId);
  const draftHeading = resolveCopy(labels.draftHeading, "labels.draftHeading", resolveCopyId);

  const formatter = createDateFormatter(locale);
  const { legal } = document;
  const facts = legal.status === "draft" ? (legal.factsToConfirm ?? []).map((fact, index) => resolveCopy(fact, `legal.factsToConfirm.${index}`, resolveCopyId)) : null;

  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader brand={brand} />
      <main className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style={{ maxWidth: "var(--ui-width-prose-max, 48rem)" }}>
        <PageHeader title={title} />
        <dl className="flex flex-col gap-xs text-body-s text-ink-secondary">
          <div className="flex flex-wrap gap-sm">
            <dt>{effectiveLabel}</dt>
            <dd>
              <time dateTime={legal.effectiveDate}>{formatDate(formatter, legal.effectiveDate)}</time>
            </dd>
          </div>
          <div className="flex flex-wrap gap-sm">
            <dt>{updatedLabel}</dt>
            <dd>
              <time dateTime={legal.lastUpdated}>{formatDate(formatter, legal.lastUpdated)}</time>
            </dd>
          </div>
        </dl>
        <ArticleBody>
          {facts === null ? null : (
            <aside role="note" data-callout-tone="warning" className="flex flex-col gap-sm rounded-lg border border-status-warning bg-surface-sunken p-lg">
              <h2>{draftHeading}</h2>
              <ul>
                {facts.map((fact, index) => (
                  <li key={index}>{fact}</li>
                ))}
              </ul>
            </aside>
          )}
          {rendered.element}
        </ArticleBody>
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}
