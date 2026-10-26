import type { ReactNode } from "react";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { cx } from "../components/internal/cx.js";
import { UI_BRANDMARK_HEIGHT_LG } from "../internal/brandmark.js";
import type { TableOfContentsItem, TableOfContentsProps } from "./TableOfContents.js";

const MIN_ITEMS = 2;
const MAX_ITEMS = 30;
const ID_PATTERN = /^[^\s#]+$/;

/**
 * The frame's default site-header clearance, restated from registered tokens: the
 * frame's own clearance variable is not a registered token, so a block cannot read it.
 * Standalone use without a frame header gets the same offset.
 */
const SITE_HEADER_CLEARANCE =
  "calc(max(" + UI_LAYOUT_TAP_TARGET + ", " + UI_BRANDMARK_HEIGHT_LG + ") + 2 * var(--spacing-sm, 8px) + var(--ui-border-hairline, 1px) + env(safe-area-inset-top, 0px))";
const Z_STICKY = "var(--ui-z-sticky, 10)";

const BOX_CLASSES = "rounded-panel border border-line-base p-md";
const FOCUS_CLASSES = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function fail(message: string): never {
  throw new TypeError("TableOfContents: " + message);
}

/** Throws a prefixed TypeError when the props break the contract; shared by both variants. */
export function validateTableOfContents({
  label,
  items,
  currentId,
}: Pick<TableOfContentsProps, "label" | "items" | "currentId">): void {
  if (typeof label !== "string" || label.trim().length === 0) fail("label must be a non-empty string.");
  if (!Array.isArray(items) || items.length < MIN_ITEMS || items.length > MAX_ITEMS) {
    fail("items must hold " + MIN_ITEMS + " to " + MAX_ITEMS + " entries.");
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item.id !== "string" || !ID_PATTERN.test(item.id)) {
      fail("each item id must be a non-empty string with no whitespace and no hash character.");
    }
    if (seen.has(item.id)) fail("duplicate item id: " + item.id);
    seen.add(item.id);
    if (item.level !== undefined && item.level !== 2 && item.level !== 3) fail("item level must be 2 or 3.");
  }
  if (currentId !== undefined && !seen.has(currentId)) fail("currentId must be one of the item ids.");
}

/** The ordered list of in-page links; the current item carries the location value of aria-current. */
export function renderTableOfContentsList(items: readonly TableOfContentsItem[], current: string | undefined): ReactNode {
  return (
    <ol className="flex flex-col">
      {items.map((item) => {
        const isCurrent = item.id === current;
        return (
          <li key={item.id}>
            <a
              href={"#" + item.id}
              aria-current={isCurrent ? "location" : undefined}
              style={{ minBlockSize: UI_LAYOUT_TAP_TARGET }}
              className={cx(
                "flex items-center border-s-2 pe-sm text-body-s",
                item.level === 3 ? "ps-xl" : "ps-md",
                isCurrent
                  ? "border-accent font-medium text-ink-primary forced-colors:border-current"
                  : "border-transparent text-ink-secondary hover:text-ink-primary",
                FOCUS_CLASSES,
              )}
            >
              {item.label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The sidebar presentation: a captioned plain list at every width, sticky below the
 * header clearance from desktop. The trailing spacer lets the last link scroll clear
 * of the viewport edge once the capped list scrolls on its own.
 */
export function renderTableOfContentsSidebar(
  { label, items, className, style }: Pick<TableOfContentsProps, "label" | "items" | "className" | "style">,
  current: string | undefined,
): ReactNode {
  return (
    <nav
      aria-label={label}
      className={cx("desktop:sticky desktop:max-h-dvh desktop:overflow-y-auto", className)}
      style={{ insetBlockStart: SITE_HEADER_CLEARANCE, zIndex: Z_STICKY, ...style }}
    >
      <p aria-hidden="true" className="pb-sm text-caption text-ink-muted">
        {label}
      </p>
      {renderTableOfContentsList(items, current)}
      <div aria-hidden="true" className="hidden desktop:block" style={{ blockSize: SITE_HEADER_CLEARANCE }} />
    </nav>
  );
}

/** The inline presentation's navigation, without the sticky caption row. */
export function renderTableOfContentsInlineNav(
  { label, items }: Pick<TableOfContentsProps, "label" | "items">,
  current: string | undefined,
): ReactNode {
  return <nav aria-label={label}>{renderTableOfContentsList(items, current)}</nav>;
}

/**
 * Server-safe variant: no hooks, no client-only dependency. It marks only the
 * `currentId` the host passes; `trackCurrent` belongs to the client variant. The
 * inline presentation is a native `<details open>`.
 */
export function TableOfContents(props: TableOfContentsProps) {
  validateTableOfContents(props);
  const { label, items, presentation = "sidebar", currentId, className, style } = props;
  if (presentation === "inline") {
    return (
      <details open className={cx(BOX_CLASSES, className)} style={style}>
        <summary className={cx("cursor-pointer rounded-default py-sm text-body text-ink-primary", FOCUS_CLASSES)}>
          {label}
        </summary>
        {renderTableOfContentsInlineNav({ label, items }, currentId)}
      </details>
    );
  }
  return renderTableOfContentsSidebar({ label, items, className, style }, currentId);
}
