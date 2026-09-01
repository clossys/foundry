import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { EmptyState, PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";

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
  if (!empty || typeof empty !== "object") {
    throw new Error("CollectionView requires an explicit empty state.");
  }
  if (typeof focusTargetId !== "string" || focusTargetId.trim().length === 0) {
    throw new Error("CollectionView requires a non-empty focusTargetId.");
  }
  assertLink(empty.action, "empty.action");
  if (pagination !== undefined && (!pagination || typeof pagination !== "object")) {
    throw new Error("CollectionView requires pagination to be an object when supplied.");
  }
  assertLink(pagination?.previous, "pagination.previous");
  assertLink(pagination?.next, "pagination.next");
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0 || typeof entry.href !== "string" || entry.href.length === 0 || !entry.date || typeof entry.date.dateTime !== "string" || entry.date.dateTime.length === 0) {
      throw new Error("CollectionView requires every entry to have non-empty id, href, and date.dateTime fields.");
    }
    if (entry.tags !== undefined && !Array.isArray(entry.tags)) {
      throw new Error("CollectionView requires entry tags to be an array when supplied.");
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
            {pagination.previous === undefined ? null : <a href={pagination.previous.href} className="text-ink-link underline">{pagination.previous.label}</a>}
            {pagination.next === undefined ? null : <a href={pagination.next.href} className="text-ink-link underline">{pagination.next.label}</a>}
          </nav>
        )}
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}

function assertLink(link: CollectionViewLink | undefined, path: string): void {
  if (link === undefined) return;
  if (!link || typeof link.href !== "string" || link.href.trim().length === 0 || typeof link.label !== "string" || link.label.trim().length === 0) {
    throw new Error(`CollectionView requires ${path} to have non-empty href and label fields.`);
  }
}
