import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { mergeUiClasses } from "@clossys/designer/components/server";
import { ArticleBody, DetailView, PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";
import { siteHeaderPresentation, type SiteChromeGround } from "../internal/viewChromeGround.js";
import { PAGE_COLUMN_CLASSES, PageLayout, pageColumnStyle } from "../internal/PageLayout.js";
import { renderViewLinks, type ViewLinksInput } from "../internal/ViewLinks.js";
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
  /** Heading of the draft callout, rendered whenever the document status is `"draft"` on the self-chromed page. The framed page renders no draft callout. */
  draftHeading: CopyRef;
}

/**
 * The labels the framed page uses. It adds no draft text to a public page, so
 * `draftHeading` is optional there and is never resolved or rendered; a
 * `LegalViewLabels` value is still accepted.
 */
export type LegalViewFramedLabels = Omit<LegalViewLabels, "draftHeading"> & { draftHeading?: CopyRef };

interface LegalViewChromeProps {
  /** Persistent site identity, rendered in the page banner. */
  brand: ReactNode;
  /** The site's call to action, rendered in the banner (`SiteHeader`'s `actions`). Absent from the markup when omitted. */
  headerAction?: ReactNode;
  /** A secondary call to action, rendered in the banner just before `headerAction`. Absent from the markup when omitted. */
  secondaryAction?: ReactNode;
  /** The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted. */
  nav?: ReactNode;
  /**
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`. `"transparent"` matches `HeroView`'s chrome.
   * @default "base"
   */
  ground?: SiteChromeGround;
  /** Persistent footer content. */
  footerSecondary?: ReactNode;
}

interface LegalViewBodyProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The legal document. LegalView always validates it with
   * validateLegalDocument and renders it through renderStructuredDocument
   * itself, so neither check can be skipped on the path to this page.
   */
  document: LegalDocument;
  /** The approved-copy resolver used for the title, the body, the labels and (self-chromed only) the facts to confirm. */
  resolveCopyId: CopyResolver;
  /** BCP 47 locale used to format both dates. Required: there is no default. */
  locale: string;
  /** Caller-labelled references after the legal body: one Item or two to six rows. Empty collections render nothing. */
  related?: ViewLinksInput;
  style?: CSSProperties;
}

/**
 * One legal document, either inside SiteFrame on the shared page layout or
 * surrounded by legacy chrome on the self-chromed page.
 */
export type LegalViewProps = LegalViewBodyProps & (
  | ({
      framed: true;
      /** Approved copy for the effective-date and last-updated labels. */
      labels: LegalViewFramedLabels;
      /** Optional approved summary copy, shown as the subtitle under the page title. */
      summary?: CopyRef;
    } & { [Key in keyof LegalViewChromeProps]?: never })
  | ({
      framed?: false;
      /** Approved copy for the effective-date, last-updated and draft-callout labels. */
      labels: LegalViewLabels;
      summary?: never;
    } & LegalViewChromeProps)
);

const NOT_APPLICABLE_PATH_PREFIX = "legal.notApplicable.";

/** A finding path for an error message: `legal.notApplicable.<key>` is built from a caller-controlled object key, so the key is never repeated. */
function messagePath(path: string | undefined): string {
  if (path === undefined) return "(document)";
  return path.startsWith(NOT_APPLICABLE_PATH_PREFIX) ? "legal.notApplicable" : path;
}

function resolveCopy(ref: CopyRef, path: string, resolver: CopyResolver): string {
  const resolution = resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `LegalView could not resolve a CopyRef at ${path}.`);
  }
  return resolution.text;
}

function createDateFormatter(locale: unknown): Intl.DateTimeFormat {
  // The type requires a locale, but a JavaScript caller can omit it or pass anything; Intl would silently fall back to the host default.
  if (typeof locale !== "string" || locale.trim().length === 0) {
    throw new RenderError("resolution-failed", "LegalView requires a non-empty locale string and does not fall back to a default locale.");
  }
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RenderError("resolution-failed", "LegalView could not format dates for the given locale.");
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
 * A site page for one LegalDocument (terms or privacy). Pass `framed` inside
 * SiteFrame: it renders the page layout every front-door view shares (see
 * `PageLayout`) with no site chrome or main. The document title and the
 * optional `summary` are the header, both dates and the document body are in
 * the one card, and `related` is the notes region below it. Omit `framed` and
 * supply `brand` for the existing self-chromed page, whose output is unchanged.
 *
 * What it guarantees: the document is validated first (any finding throws a
 * RenderError before anything renders), the top-level sections appear in the
 * fixed order for the document kind, and both dates are shown as
 * machine-readable `<time>` elements formatted for `locale`. On the
 * self-chromed page a document whose status is `"draft"` always carries a
 * draft callout listing its facts to confirm, ahead of the sections, and no
 * prop can suppress or alter it. The framed page is a public page and renders
 * no draft or status text at all: a draft is kept off production by
 * `gateLegalDocument`, and whether search engines index the page is the
 * caller's explicit `indexing` choice in `buildSiteMetadata`.
 *
 * What it does not do: it says nothing about the legal adequacy of any text
 * (the legal document text comes from the caller's copy registry), and it does not enforce
 * the production gate. A caller must call gateLegalDocument(document,
 * "production") separately before publishing. The content variables
 * (entity, jurisdiction, contact) are not rendered and nothing is interpolated
 * into the copy.
 */
export function LegalView({
  framed = false,
  brand,
  headerAction,
  secondaryAction,
  nav,
  ground,
  document,
  resolveCopyId,
  labels,
  summary,
  locale,
  footerSecondary,
  related,
  className,
  style,
  ...rest
}: LegalViewProps) {
  if (framed) {
    if ([brand, headerAction, secondaryAction, nav, ground, footerSecondary].some((value) => value !== undefined)) {
      throw new RenderError("resolution-failed", "LegalView: framed content cannot take chrome props; SiteFrame owns the chrome.");
    }
    assertViewContentRoot("LegalView", rest);
  } else if (summary !== undefined) {
    throw new RenderError("resolution-failed", "LegalView: summary is only available on the framed page.");
  }
  const findings = validateLegalDocument(document);
  if (findings.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `LegalView refused an invalid legal document: ${findings.map((finding) => `${finding.rule} at ${messagePath(finding.path)}`).join("; ")}.`,
    );
  }

  const rendered = renderStructuredDocument(document, { resolveCopyId });
  const title = rendered.resolutions[0]?.text;
  if (title === undefined) {
    throw new RenderError("resolution-failed", "LegalView could not resolve the document title.");
  }

  const effectiveLabel = resolveCopy(labels.effectiveDate, "labels.effectiveDate", resolveCopyId);
  const updatedLabel = resolveCopy(labels.lastUpdated, "labels.lastUpdated", resolveCopyId);
  // The framed page is public and renders no draft text, so it never resolves the draft heading or the facts to confirm.
  const draftHeading = framed ? undefined : resolveCopy((labels as LegalViewLabels).draftHeading, "labels.draftHeading", resolveCopyId);
  const summaryText = summary === undefined ? undefined : resolveCopy(summary, "summary", resolveCopyId);

  const formatter = createDateFormatter(locale);
  const { legal } = document;
  const facts = framed || legal.status !== "draft" ? null : (legal.factsToConfirm ?? []).map((fact, index) => resolveCopy(fact, `legal.factsToConfirm.${index}`, resolveCopyId));
  const references = renderViewLinks(related, "LegalView");

  const dates = (
    <DetailView
      fields={[
        {
          label: effectiveLabel,
          value: <time dateTime={legal.effectiveDate}>{formatDate(formatter, legal.effectiveDate)}</time>,
        },
        {
          label: updatedLabel,
          value: <time dateTime={legal.lastUpdated}>{formatDate(formatter, legal.lastUpdated)}</time>,
        },
      ]}
    />
  );

  if (framed) {
    return (
      <div {...rest} className={mergeUiClasses(PAGE_COLUMN_CLASSES, className)} style={pageColumnStyle("prose", style)}>
        <PageLayout title={title} subtitle={summaryText} notes={references === null ? undefined : <div className="w-full text-start">{references}</div>}>
          {dates}
          <ArticleBody>{rendered.element}</ArticleBody>
        </PageLayout>
      </div>
    );
  }

  const content = (
    <>
      <PageHeader title={title} />
      {dates}
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
      {references}
    </>
  );

  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader {...siteHeaderPresentation(ground)} brand={brand} nav={nav} actions={<>{secondaryAction}{headerAction}</>} />
      <main className={`${PAGE_COLUMN_CLASSES} max-w-[var(--ui-width-prose-max,none)]`}>
        {content}
      </main>
      <SiteFooter ground={ground === undefined ? "base" : ground} secondary={footerSecondary} />
    </div>
  );
}
