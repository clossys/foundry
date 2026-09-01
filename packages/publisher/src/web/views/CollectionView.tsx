import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { EmptyState, PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { isSanctionedHref } from "../../internal/href.js";

/** One published collection entry. Dates remain a distinct semantic field, never text folded into a summary. */
export interface CollectionViewEntry {
  id: string;
  href: string;
  title: string;
  date: { dateTime: string; text: string };
  summary?: string;
  tags?: readonly string[];
}

/** A closed, semantic route link rendered by CollectionView. */
export interface CollectionViewLink {
  href: string;
  label: string;
}

/** Consumer-owned page links; CollectionView owns their navigation landmark, not router state. */
export interface CollectionViewPagination {
  previous?: CollectionViewLink;
  next?: CollectionViewLink;
}

/** The explicit zero-entry state: an empty collection must announce itself, never render as a blank list. */
export interface CollectionViewEmptyState {
  title: string;
  description?: string;
  action?: CollectionViewLink;
}

export interface CollectionViewProps extends HTMLAttributes<HTMLDivElement> {
  brand: ReactNode;
  heading: ReactNode;
  description?: ReactNode;
  entries: readonly CollectionViewEntry[];
  empty: CollectionViewEmptyState;
  /** Stable focus target for a consumer router after replacing entries in place. */
  focusTargetId?: string;
  /**
   * Consumer-controlled pagination. Keep its focus contract with the
   * consumer's router: after an in-place page update, move focus to this
   * view's h1; ordinary link navigation receives the browser's normal route
   * focus handling. Publisher does not own a router or paging state.
   */
  pagination?: CollectionViewPagination;
  footerSecondary?: ReactNode;
  style?: CSSProperties;
}

/**
 * A server-safe collection index. It fixes entry landmarks, unique linked
 * titles, semantic dates, tag-list semantics, and the explicit empty state;
 * it intentionally leaves data loading and pagination state to the consumer.
 */
export function CollectionView({ brand, heading, description, entries, empty, focusTargetId = "collection-heading", pagination, footerSecondary, className, style, ...rest }: CollectionViewProps) {
  if (!Array.isArray(entries)) {
    throw new Error("CollectionView requires entries to be an array.");
  }
  if (!isPlainClosedObject(empty) || !hasOnlyOwnKeys(empty, ["title", "description", "action"]) || !isNonWhitespaceString(empty.title) || (empty.description !== undefined && !isNonWhitespaceString(empty.description))) {
    throw new Error("CollectionView requires an explicit empty state with a non-whitespace title and optional non-whitespace description.");
  }
  if (typeof focusTargetId !== "string" || focusTargetId.trim().length === 0) {
    throw new Error("CollectionView requires a non-empty focusTargetId.");
  }
  assertLink(empty.action, "empty.action");
  if (pagination !== undefined && (!isPlainClosedObject(pagination) || !hasOnlyOwnKeys(pagination, ["previous", "next"]))) {
    throw new Error("CollectionView requires pagination to be a plain object with only previous/next links when supplied.");
  }
  const previous = pagination?.previous as CollectionViewLink | undefined;
  const next = pagination?.next as CollectionViewLink | undefined;
  assertLink(previous, "pagination.previous");
  assertLink(next, "pagination.next");
  const ids = new Set<string>();
  for (const entry of entries) {
    if (isPlainClosedObject(entry) && hasOnlyOwnKeys(entry, ["id", "href", "title", "date", "summary", "tags"]) && Object.hasOwn(entry, "href") && !isSanctionedHref(entry.href)) {
      throw new Error("CollectionView requires every entry href to use a sanctioned URL form.");
    }
    if (!isPlainClosedObject(entry) || !hasOnlyOwnKeys(entry, ["id", "href", "title", "date", "summary", "tags"]) || !isNonWhitespaceString(entry.id) || !isSanctionedHref(entry.href) || !isNonWhitespaceString(entry.title) || !isPlainClosedObject(entry.date) || !hasOnlyOwnKeys(entry.date, ["dateTime", "text"]) || !isValidDateTime(entry.date.dateTime) || !isNonWhitespaceString(entry.date.text) || (entry.summary !== undefined && !isNonWhitespaceString(entry.summary))) {
      throw new Error("CollectionView requires every entry to have non-whitespace id, href, title, and date text plus a valid date.dateTime.");
    }
    if (entry.tags !== undefined && !isDenseNonWhitespaceStringArray(entry.tags)) {
      throw new Error("CollectionView requires entry tags to be a dense array of non-whitespace strings when supplied.");
    }
    if (ids.has(entry.id)) throw new Error(`CollectionView received duplicate entry id "${entry.id}".`);
    ids.add(entry.id);
  }

  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader brand={brand} />
      <main className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style={{ maxWidth: "var(--ui-width-content-max, 72rem)" }}>
        <PageHeader id={focusTargetId} tabIndex={-1} title={heading} description={description} />
        {entries.length === 0 ? (
          <EmptyState
            title={empty.title}
            description={empty.description}
            action={empty.action === undefined ? undefined : <a href={empty.action.href} className="text-ink-link underline">{empty.action.label}</a>}
          />
        ) : (
          <ul className="flex flex-col gap-lg" aria-label="Collection entries">
            {entries.map((entry) => (
              <li key={entry.id}>
                <article className="flex flex-col gap-sm border-b border-line-base pb-lg">
                  <div className="flex flex-wrap items-baseline justify-between gap-sm">
                    <h2 className="text-h2 font-display text-ink-primary">
                      <a href={entry.href} className="text-ink-link underline">
                        {entry.title}
                      </a>
                    </h2>
                    <time dateTime={entry.date.dateTime} className="text-body-s text-ink-secondary">
                      {entry.date.text}
                    </time>
                  </div>
                  {entry.summary === undefined ? null : <p className="text-body text-ink-secondary">{entry.summary}</p>}
                  {entry.tags === undefined || entry.tags.length === 0 ? null : (
                    <ul className="flex flex-wrap gap-sm" aria-label="Tags">
                      {entry.tags.map((tag: string, index: number) => (
                        <li key={`${entry.id}-tag-${index}`} className="rounded-pill bg-surface-sunken px-sm py-xs text-caption text-ink-secondary">
                          {tag}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            ))}
          </ul>
        )}
        {pagination === undefined ? null : (
          <nav className="flex flex-wrap gap-md" aria-label="Collection pagination">
            {previous === undefined ? null : <a href={previous.href} className="text-ink-link underline">{previous.label}</a>}
            {next === undefined ? null : <a href={next.href} className="text-ink-link underline">{next.label}</a>}
          </nav>
        )}
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}

function isPlainClosedObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasOnlyOwnKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string" || !allowed.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
    });
  } catch {
    return false;
  }
}

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDenseNonWhitespaceStringArray(value: unknown): value is readonly string[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number") return false;
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= lengthDescriptor.value) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) || !isNonWhitespaceString(descriptor.value)) return false;
    }
    for (let index = 0; index < lengthDescriptor.value; index += 1) if (!Object.hasOwn(value, index)) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidDateTime(value: unknown): value is string {
  if (!isNonWhitespaceString(value) || Number.isNaN(Date.parse(value))) return false;
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (date === null) return false;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  return parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day;
}

function assertLink(link: unknown, path: string): void {
  if (link === undefined) return;
  if (!isPlainClosedObject(link) || !hasOnlyOwnKeys(link, ["href", "label"]) || !isSanctionedHref(link.href) || !isNonWhitespaceString(link.label)) {
    throw new Error(`CollectionView requires ${path} to have a sanctioned href and non-empty label fields.`);
  }
}

