import type { CSSProperties, HTMLAttributes } from "react";
import { Button } from "../atoms/Button.js";
import { Select } from "../atoms/Select.js";
import { cx } from "../atoms/internal/cx.js";

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  /** The current page, 1-indexed. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  /** Fired with the requested page when a page control is activated. Controlled only — `Pagination` never advances `page` itself. */
  onPageChange: (page: number) => void;
  /** Total item count, for the range summary ("Showing 1–10 of 42"). Omit for a plain "Page X of Y" summary. */
  totalItems?: number;
  /** Items per page, required alongside `totalItems` to compute the range summary. */
  pageSize?: number;
  /** Choices for the optional page-size selector. Omit (with `onPageSizeChange`) to not render that region at all. */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  /** How many page numbers to show on each side of the current page before truncating with an ellipsis. @default 1 */
  siblingCount?: number;
  className?: string;
  style?: CSSProperties;
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
 * `<button>` (via this package's own `Button` atom) rather than an anchor
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
  className,
  style,
  "aria-label": ariaLabel = "Pagination",
  ...rest
}: PaginationProps) {
  const clampedCount = Math.max(pageCount, 0);
  const items = clampedCount > 0 ? buildPageItems(page, clampedCount, siblingCount) : [];
  const isFirstPage = page <= 1;
  const isLastPage = page >= clampedCount;

  let rangeSummary: string;
  if (clampedCount === 0) {
    rangeSummary = "No results";
  } else if (totalItems !== undefined && pageSize !== undefined) {
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, totalItems);
    rangeSummary = totalItems === 0 ? "No results" : `Showing ${start}–${end} of ${totalItems}`;
  } else {
    rangeSummary = `Page ${page} of ${clampedCount}`;
  }

  const showPageSizeSelector = Boolean(
    pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange,
  );

  return (
    <nav
      {...rest}
      aria-label={ariaLabel}
      className={cx("flex flex-wrap items-center justify-between gap-md", className)}
      style={style}
    >
      <p className="text-body-s text-ink-secondary">{rangeSummary}</p>
      <div className="flex items-center gap-xs">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous page"
          isDisabled={isFirstPage}
          onPress={() => onPageChange(page - 1)}
        >
          ‹
        </Button>
        {items.map((item, index) =>
          item === "ellipsis" ? (
            <span key={`ellipsis-${index}`} aria-hidden="true" className="px-xs text-ink-muted">
              …
            </span>
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
          aria-label="Next page"
          isDisabled={isLastPage}
          onPress={() => onPageChange(page + 1)}
        >
          ›
        </Button>
      </div>
      {showPageSizeSelector ? (
        <Select
          label="Rows per page"
          className="w-auto"
          options={(pageSizeOptions ?? []).map((size) => ({ id: String(size), label: String(size) }))}
          selectedKey={pageSize !== undefined ? String(pageSize) : null}
          onSelectionChange={(key) => onPageSizeChange?.(Number(key))}
        />
      ) : null}
    </nav>
  );
}
