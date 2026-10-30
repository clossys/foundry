import type { ReactNode } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import { Badge } from "../components/Badge.js";
import { Link } from "../components/Link.js";

/** Display copy is supplied by Writer; date values are ISO calendar dates. */
export interface EditorialMetadata {
  author?: { name: string; label?: string; href?: string };
  date?: { value: string; label?: string };
  readingTime?: { value: string; label?: string };
  tags?: readonly { id: string; label: string; href?: string }[];
  summary?: ReactNode;
  outcomeStats?: readonly { id: string; label: string; value: string }[];
}

/** Never use the machine locale or a timezone-dependent calendar day. */
export function editorialDate(value: string, locale: string | undefined): string {
  if (!locale?.trim() || Intl.getCanonicalLocales(locale).length !== 1) throw new TypeError("Editorial dates require a page locale");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new TypeError("Editorial date must be a valid ISO calendar date");
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}

export function PageHeaderMetadata({ metadata, locale }: { metadata: EditorialMetadata; locale?: string }) {
  const { author, date, readingTime, tags, summary, outcomeStats } = metadata;
  const entries = [
    author ? { id: "author", label: author.label, value: author.href ? <Link href={author.href}>{author.name}</Link> : author.name } : null,
    date ? { id: "date", label: date.label, value: <SemanticContent as="time" dateTime={date.value}>{editorialDate(date.value, locale)}</SemanticContent> } : null,
    readingTime ? { id: "reading-time", label: readingTime.label, value: readingTime.value } : null,
  ].filter(entry => entry !== null);
  return <SemanticContent as="div" className="flex flex-col gap-sm">
    {summary ? <SemanticContent as="p" dir="auto" className="text-body-l text-ink-secondary">{summary}</SemanticContent> : null}
    {entries.length ? <SemanticContent as="div" className="flex flex-wrap gap-md text-body-s text-ink-secondary">
      {entries.map(entry => entry.label ? <SemanticContent as="dl" key={entry.id} className="m-0">
        <SemanticContent as="dt" dir="auto">{entry.label}</SemanticContent>
        <SemanticContent as="dd" dir="auto" className="m-0">{entry.value}</SemanticContent>
      </SemanticContent> : <SemanticContent as="p" key={entry.id} dir="auto" className="m-0">{entry.value}</SemanticContent>)}
    </SemanticContent> : null}
    {tags?.length ? <SemanticContent as="ul" role="list" className="m-0 flex flex-wrap gap-xs p-0">
      {tags.map(tag => <SemanticContent as="li" key={tag.id}><Badge>{tag.href ? <Link href={tag.href}>{tag.label}</Link> : tag.label}</Badge></SemanticContent>)}
    </SemanticContent> : null}
    {outcomeStats?.length ? <SemanticContent as="dl" className="m-0 grid grid-cols-1 gap-md tablet:grid-cols-3">
      {outcomeStats.map(stat => <SemanticContent as="div" key={stat.id}>
        <SemanticContent as="dt" dir="auto" className="text-caption text-ink-secondary">{stat.label}</SemanticContent>
        <SemanticContent as="dd" dir="auto" className="m-0 text-h2 text-ink-primary">{stat.value}</SemanticContent>
      </SemanticContent>)}
    </SemanticContent> : null}
  </SemanticContent>;
}
