import type { HTMLAttributes, ReactNode } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { ArticleBody } from "./ArticleBody.js";
import { SectionHeader, type SectionHeaderLevel } from "./SectionHeader.js";

const SECTION_STAMP = dsAttrs("sections", "sections.legal-prose", "foundry/sections.legal-prose");

export interface LegalProseRevision {
  /** Host-resolved revision label and display value. */
  label: ReactNode;
  value: ReactNode;
  /** Authored calendar date in YYYY-MM-DD form, separate from display copy. */
  dateTime?: string;
}

export interface LegalProseProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  heading: ReactNode;
  /** Section heading rank; the surrounding page owns its page heading. @default 2 */
  headingLevel?: SectionHeaderLevel;
  revision?: LegalProseRevision;
  /** Pre-structured rich prose, rendered with ArticleBody typography. */
  children: ReactNode;
}

function checkRevisionDate(dateTime: string): void {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dateTime) ? new Date(`${dateTime}T00:00:00.000Z`) : undefined;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateTime) {
    throw new TypeError("LegalProse revision.dateTime requires a valid YYYY-MM-DD calendar date");
  }
}

/** Host-authored legal prose and revision metadata, inside an external SectionFrame. */
export function LegalProse({ heading, headingLevel = 2, revision, children, className, ...rest }: LegalProseProps) {
  if (revision?.dateTime !== undefined) checkRevisionDate(revision.dateTime);
  return (
    <SemanticContent as="div" {...rest} {...SECTION_STAMP} className={cx("flex flex-col gap-2xl", className)} data-designer-requires-section-frame="">
      <SectionHeader title={heading} level={headingLevel} density="standard" />
      {revision ? (
        <SemanticContent as="p" className="text-body-s text-ink-secondary">
          <SemanticContent as="span">{revision.label}</SemanticContent>{" "}
          {revision.dateTime === undefined
            ? <SemanticContent as="span">{revision.value}</SemanticContent>
            : <SemanticContent as="time" dateTime={revision.dateTime}>{revision.value}</SemanticContent>}
        </SemanticContent>
      ) : null}
      <ArticleBody>{children}</ArticleBody>
    </SemanticContent>
  );
}
