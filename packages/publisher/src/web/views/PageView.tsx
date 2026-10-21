import type { HTMLAttributes, ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { RenderError } from "../../internal/errors.js";
import { PAGE_COLUMN_CLASSES, PageLayout, pageColumnStyle } from "../internal/PageLayout.js";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

/** Same semantic date and approved-copy shape as the document view. */
interface PageViewDateLine {
  dateTime: string;
  text: CopyRef;
}

interface PageViewBaseProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  /** The page's single heading, rendered as escaped plain text. */
  title: string;
  /** Optional supporting plain text, absent from the markup when omitted. */
  subtitle?: string;
  /** Optional plain-text notes below the card, absent when omitted or empty. */
  notes?: string;
}

type PageViewContent =
  | { children?: ReactNode; form?: never }
  | { form: ReactNode; children?: never };

type PageViewMetadata =
  | { effectiveDate?: never; updated?: never; resolveCopyId?: CopyResolver }
  | {
      /** Machine-readable effective date and the approved copy for its visible label. */
      effectiveDate?: PageViewDateLine;
      /** Machine-readable update date and the approved copy for its visible label. */
      updated?: PageViewDateLine;
      /** The caller's approved-copy resolver, required when either date line is supplied. */
      resolveCopyId: CopyResolver;
    };

/** One content slot or one form slot; metadata uses the document date/copy shape. */
export type PageViewProps = PageViewBaseProps & PageViewContent & PageViewMetadata;

function isValidDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) return false;
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (date === null) return false;
  const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  return parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day;
}

function resolveOptionalCopy(ref: CopyRef | undefined, path: string, resolver: CopyResolver | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const resolution = resolver?.(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `PageView could not resolve a CopyRef at ${path}.`);
  }
  return resolution.text;
}

/**
 * A unified content or form page: a start-aligned title and subtitle, one
 * flat bordered plate, and optional notes below it. All visible copy is
 * supplied by the caller. The form slot retains its own accessible name,
 * controls and submit handler; this view adds no form or backend behavior.
 *
 * Chrome-free and server-safe: the enclosing frame owns the skip link and
 * single main landmark. This view owns one h1 and no frame landmarks.
 * Use StatusView for a cardless status page with a call to action instead.
 */
export function PageView({ title, subtitle, notes, effectiveDate, updated, resolveCopyId, children, form, className, style, ...rest }: PageViewProps) {
  assertViewContentRoot("PageView", rest);
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new RenderError("resolution-failed", "PageView requires a nonempty plain-text title.");
  }
  if (children !== undefined && form !== undefined) {
    throw new RenderError("resolution-failed", "PageView accepts children content or a form slot, never both.");
  }
  for (const [path, line] of [["effectiveDate", effectiveDate], ["updated", updated]] as const) {
    if (line !== undefined && !isValidDateTime(line.dateTime)) {
      throw new RenderError("resolution-failed", `PageView requires ${path}.dateTime to be a real ISO date or date-time.`);
    }
  }
  const effectiveDateText = resolveOptionalCopy(effectiveDate?.text, "effectiveDate.text", resolveCopyId);
  const updatedText = resolveOptionalCopy(updated?.text, "updated.text", resolveCopyId);
  return (
    <div {...rest} className={mergeUiClasses(PAGE_COLUMN_CLASSES, className)} style={pageColumnStyle("prose", style)}>
      <PageLayout title={title} subtitle={subtitle} notes={notes} surface="plate" alignment="start">
        {effectiveDateText === undefined ? null : <time dateTime={effectiveDate!.dateTime} className="text-body-s text-ink-secondary">{effectiveDateText}</time>}
        {updatedText === undefined ? null : <time dateTime={updated!.dateTime} className="text-body-s text-ink-secondary">{updatedText}</time>}
        {form ?? children}
      </PageLayout>
    </div>
  );
}
