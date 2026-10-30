import type { CSSProperties, HTMLAttributes } from "react";

import { useShellCopy } from "../components/Banner.copy-context.js";
import type { ShellCopyResolver } from "../components/Banner.copy.js";
import { useGlyph } from "../components/glyph-context.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const Select = componentLeaf<typeof import("../components/Select.js").Select>("components.select");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.pagination", "foundry/sections.pagination");

/** Stable Writer references; the host owns locale, approval and message formatting. */
export const PAGINATION_COPY_REFS = Object.freeze({
  previousPageLabel: Object.freeze({ id: "st.96qkp2bzpm" }),
  nextPageLabel: Object.freeze({ id: "st.kb8ve83tjp" }),
  noResultsLabel: Object.freeze({ id: "st.asj8g1mcjn" }),
  rangeSummaryMessage: Object.freeze({ id: "st.pzmpksy76x" }),
  pageSummaryMessage: Object.freeze({ id: "st.vxwx1e3xwq" }),
  pageSizeLabel: Object.freeze({ id: "st.bhhba11w6f" }),
  "aria-label": Object.freeze({ id: "st.s13b3hwkta" }),
});

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  /** The current page, 1-indexed. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  /** Fired with the requested page when a page control is activated. Controlled only — `Pagination` never advances `page` itself. */
  onPageChange: (page: number) => void;
  /** Total item count for the range summary. Omit for a page/count summary. */
  totalItems?: number;
  /** Items per page, required alongside `totalItems` to compute the range summary. */
  pageSize?: number;
  /** Choices for the optional page-size selector. Omit (with `onPageSizeChange`) to not render that region at all. */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  /** How many page numbers to show on each side of the current page before truncating with an ellipsis. @default 1 */
  siblingCount?: number;
  /** Accessible name for the previous-page control; omitted means resolve its Writer reference. */
  previousPageLabel?: string;
  /** Accessible name for the next-page control; omitted means resolve its Writer reference. */
  nextPageLabel?: string;
  /** Summary when there are no pages or no items; omitted means resolve its Writer reference. */
  noResultsLabel?: string;
  /**
   * Range summary when `totalItems` and `pageSize` are set.
   * Omitted means resolve its Writer reference with the live range values.
   */
  rangeSummaryMessage?: (start: number, end: number, total: number) => string;
  /**
   * Summary when the range summary inputs are omitted.
   * Omitted means resolve its Writer reference with the live page values.
   */
  pageSummaryMessage?: (page: number, pageCount: number) => string;
  /** Label on the optional page-size selector; omitted means resolve its Writer reference. */
  pageSizeLabel?: string;
  /**
   * Accessible name for the pagination `<nav>` landmark.
   * Omitted means resolve its Writer reference.
   */
  "aria-label"?: string;
  /** Host-configured Writer resolver; otherwise inherited from ShellCopyProvider. */
  copyResolver?: ShellCopyResolver;
  className?: string;
  style?: CSSProperties;
}

function copyText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`Pagination: ${field} requires nonempty text`);
  return value;
}

type PageItem = number | "ellipsis";

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * Builds the truncated page list (first/last/ellipsis) a large `pageCount`
 * needs — the standard "1 … 4 5 6 … 20" shape, never a flat 1..N button
 * row past a handful of pages. Below the truncation threshold, every page
 * number is shown.
 */
function buildPageItems(page: number, pageCount: number, siblingCount: number): PageItem[] {
  const totalPageNumbers = siblingCount * 2 + 5; // first + last + current + 2 siblings + 2 ellipsis slots
  if (pageCount <= totalPageNumbers) {
    return range(1, pageCount);
  }

  const leftSibling = Math.max(page - siblingCount, 1);
  const rightSibling = Math.min(page + siblingCount, pageCount);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < pageCount - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, 3 + siblingCount * 2), "ellipsis", pageCount];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, "ellipsis", ...range(pageCount - (2 + siblingCount * 2), pageCount)];
  }
  return [1, "ellipsis", ...range(leftSibling, rightSibling), "ellipsis", pageCount];
}

/**
 * Page navigation for a paginated list or grid — the range summary, the
 * page controls themselves, and an optional page-size selector, three
 * regions that differ in kind. A page can hold two `Pagination`s (e.g. two
 * independent lists side by side), which is what makes it a block rather
 * than a view.
 *
 * Controlled only: `page`/`pageCount` come in as props and every
 * navigation is reported through `onPageChange` rather than applied
 * internally — `Pagination` never owns which page is current, the same
 * "no async/owned state" contract `DataTable`'s own doc comment describes,
 * so this block composes into whatever paging mechanism a consumer's data
 * layer already has (offset, cursor, or otherwise).
 *
 * Wrapped in a `<nav>` landmark (real navigation, not a generic list), the
 * current page carries `aria-current="page"`, and every control is a real
 * Button component rather than an anchor
 * styled to look pressable — there is nowhere for a page control to
 * navigate to as a URL in a controlled component like this one, so a link
 * would be the wrong element regardless of styling.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  totalItems,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  siblingCount = 1,
  previousPageLabel,
  nextPageLabel,
  noResultsLabel,
  rangeSummaryMessage,
  pageSummaryMessage,
  pageSizeLabel,
  copyResolver,
  className,
  style,
  "aria-label": ariaLabel,
  ...rest
}: PaginationProps) {
  const copy = useShellCopy(copyResolver);
  const previousGlyph = useGlyph("assets.icon-chevron-left");
  const nextGlyph = useGlyph("assets.icon-chevron-right");
  const clampedCount = Math.max(pageCount, 0);
  const items = clampedCount > 0 ? buildPageItems(page, clampedCount, siblingCount) : [];
  const isFirstPage = page <= 1;
  const isLastPage = page >= clampedCount;

  const showPageSizeSelector = Boolean(
    pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange,
  );
  const summary = clampedCount === 0 || totalItems === 0
    ? noResultsLabel ?? copy(PAGINATION_COPY_REFS.noResultsLabel)
    : totalItems !== undefined && pageSize !== undefined
      ? rangeSummaryMessage
        ? rangeSummaryMessage((page - 1) * pageSize + 1, Math.min(page * pageSize, totalItems), totalItems)
        : copy(PAGINATION_COPY_REFS.rangeSummaryMessage, { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, totalItems), total: totalItems })
      : pageSummaryMessage
        ? pageSummaryMessage(page, clampedCount)
        : copy(PAGINATION_COPY_REFS.pageSummaryMessage, { page, pageCount: clampedCount });

  return (
    <nav
      {...SECTION_STAMP} {...rest}
      aria-label={copyText(ariaLabel ?? copy(PAGINATION_COPY_REFS["aria-label"]), "aria-label")}
      className={cx("flex flex-wrap items-center justify-between gap-md", className)}
      style={style}
    >
      <SemanticContent as="p" className="text-body-s text-ink-secondary">
        {copyText(summary, "summary")}
      </SemanticContent>
      <SemanticContent as="div" className="flex min-w-0 flex-wrap items-center gap-xs">
        <Button
          variant="ghost"
          size="sm"
          aria-label={copyText(previousPageLabel ?? copy(PAGINATION_COPY_REFS.previousPageLabel), "previousPageLabel")}
          isDisabled={isFirstPage}
          onPress={() => onPageChange(page - 1)}
        >
          <Icon glyph={previousGlyph} decorative size="sm" />
        </Button>
        {items.map((item, index) =>
          item === "ellipsis" ? (
            <SemanticContent as="span" key={`ellipsis-${index}`} aria-hidden="true" className="px-xs text-ink-muted">
              …
            </SemanticContent>
          ) : (
            <Button
              key={item}
              variant={item === page ? "primary" : "ghost"}
              size="sm"
              aria-current={item === page ? "page" : undefined}
              onPress={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={copyText(nextPageLabel ?? copy(PAGINATION_COPY_REFS.nextPageLabel), "nextPageLabel")}
          isDisabled={isLastPage}
          onPress={() => onPageChange(page + 1)}
        >
          <Icon glyph={nextGlyph} decorative size="sm" />
        </Button>
      </SemanticContent>
      {showPageSizeSelector ? (
        <Select
          label={copyText(pageSizeLabel ?? copy(PAGINATION_COPY_REFS.pageSizeLabel), "pageSizeLabel")}
          className="w-auto"
          options={(pageSizeOptions ?? []).map((size) => ({ id: String(size), label: String(size) }))}
          selectedKey={pageSize !== undefined ? String(pageSize) : null}
          onSelectionChange={(key) => onPageSizeChange?.(Number(key))}
        />
      ) : null}
    </nav>
  );
}
