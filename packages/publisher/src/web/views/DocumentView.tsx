import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { ArticleBody, PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import { renderStructuredDocument } from "../../document/render.js";
import type { StructuredDocument } from "../../document/types.js";

/** A machine-readable effective date with approved copy for its visible label. */
export interface DocumentViewEffectiveDate {
  dateTime: string;
  text: CopyRef;
}

export interface DocumentViewProps extends HTMLAttributes<HTMLDivElement> {
  /** Persistent site identity, rendered in the page banner. */
  brand: ReactNode;
  /**
   * The canonical document body. DocumentView always passes it to
   * renderStructuredDocument itself, so structural and fragment validation
   * cannot be skipped on the path to this page.
   */
  document: StructuredDocument;
  /** The approved-copy resolver used for the document title and body. */
  resolveCopyId: CopyResolver;
  /** Optional approved summary copy shown below the page title. */
  summary?: CopyRef;
  /** Optional semantic effective date and its approved visible label. */
  effectiveDate?: DocumentViewEffectiveDate;
  /** Optional route onward or back to an index, rendered in PageHeader's action region. */
  action?: ReactNode;
  /** Persistent footer content. */
  footerSecondary?: ReactNode;
  style?: CSSProperties;
}

function resolveOptionalCopy(ref: CopyRef | undefined, path: string, resolver: CopyResolver): string | undefined {
  if (ref === undefined) return undefined;
  const resolution = resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `DocumentView could not resolve CopyRef "${ref.id}" at ${path}.`);
  }
  return resolution.text;
}

/**
 * A site page for one StructuredDocument. Unlike a caller-composed article
 * shell, this view makes renderStructuredDocument's validation unavoidable:
 * malformed heading hierarchy or an unresolved in-document fragment throws
 * before an `<article>` is built.
 */
export function DocumentView({ brand, document, resolveCopyId, summary, effectiveDate, action, footerSecondary, className, style, ...rest }: DocumentViewProps) {
  if (effectiveDate !== undefined && !isValidDateTime(effectiveDate.dateTime)) {
    throw new RenderError("resolution-failed", "DocumentView requires effectiveDate.dateTime to be a real ISO date or date-time.");
  }
  const rendered = renderStructuredDocument(document, { resolveCopyId });
  const title = rendered.resolutions[0]?.text;
  if (title === undefined) {
    throw new RenderError("resolution-failed", `DocumentView could not resolve title for document "${document.id}".`);
  }
  const summaryText = resolveOptionalCopy(summary, "summary", resolveCopyId);
  const effectiveDateText = resolveOptionalCopy(effectiveDate?.text, "effectiveDate.text", resolveCopyId);

  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader brand={brand} />
      <main className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style={{ maxWidth: "var(--ui-width-prose-max, 48rem)" }}>
        <PageHeader title={title} description={summaryText} actions={action} />
        {effectiveDateText === undefined ? null : <time dateTime={effectiveDate!.dateTime} className="text-body-s text-ink-secondary">{effectiveDateText}</time>}
        <ArticleBody>{rendered.element}</ArticleBody>
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}

function isValidDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) return false;
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (date === null) return false;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  return parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day;
}
