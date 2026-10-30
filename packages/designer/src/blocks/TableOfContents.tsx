import { componentLeaf } from "../runtime/component-leaf.js";
import { TableOfContentsDisclosure } from "./TableOfContentsDisclosure.js";
const Link = componentLeaf<typeof import("../components/Link.js").Link>("components.link");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
import { articleTocCss, readingTarget } from "./ArticleReading.js";
import { useHeadingScrollSpy } from "./TableOfContents.scroll-spy.js";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import {
  renderTableOfContentsInlineNav,
  renderTableOfContentsSidebar,
  validateTableOfContents,
} from "./TableOfContents.server.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.table-of-contents", "foundry/sections.table-of-contents");

export interface TableOfContentsItem {
  /** The id of the target element in the page; the link is `#{id}`. No whitespace and no `#`. */
  id: string;
  /** The visible link text. */
  label: ReactNode;
  /** Heading depth, which sets the indent. Default 2. */
  level?: 2 | 3 | 4;
}

export interface TableOfContentsProps {
  /** Required. The navigation's accessible name and, for `inline`, the disclosure title. */
  label: string;
  /** Two to thirty in-page links; ids are unique. Anything else throws a `TypeError`. */
  items: readonly TableOfContentsItem[];
  /** `sidebar` is a plain list that sticks from desktop; `inline` is a bordered, collapsible box. Default `sidebar`. */
  presentation?: "sidebar" | "inline";
  /** Controlled current item. Must be one of the item ids, else a `TypeError`. */
  currentId?: string;
  /** Track the current heading with an `IntersectionObserver`. Default true; `"css"` selects declarative target timelines with a static fallback. */
  trackCurrent?: boolean | "css";
  onCurrentChange?: (id: string) => void;
  onNavigate?: (id: string) => void;
  /** Three-level expandable page outline, using the registered Disclosure. */
  nested?: boolean;
  className?: string;
  style?: CSSProperties;
}

const BOX_CLASSES = "rounded-panel border border-line-base p-md";

/**
 * A table of contents: a navigation landmark of in-page links with the current
 * item marked by the location value of `aria-current` plus a border and weight change, so
 * colour is never the only channel.
 *
 * The client variant tracks the current heading with one `IntersectionObserver`
 * (no scroll listeners, no timers): the first visible target in item order is
 * current, and the previous item stays current while none is visible. No item is
 * current before the first observer callback, which keeps the first client render
 * equal to the server render. The server variant, exported from
 * `@clossys/designer/blocks/server`, renders the same markup and marks only
 * `currentId`. The host owns `scroll-behavior` and the targets' `scroll-margin`.
 */
export function TableOfContents(props: TableOfContentsProps) {
  validateTableOfContents(props);
  const { label, items, presentation = "sidebar", currentId, trackCurrent, className, style } = props;
  const tracking = currentId === undefined && trackCurrent !== false && trackCurrent !== "css";
  const observed = useHeadingScrollSpy(items.map(item => item.id), { enabled: tracking, onChange: props.onCurrentChange });

  const current = currentId ?? observed;

  if (props.nested) {
    const branch = (from: number, until: number): ReactNode => <SemanticContent as="ol">{items.slice(from, until).map((item, relative) => {
      const at = from + relative, level = item.level ?? 2;
      if (at > from && level > (items[from]?.level ?? 2)) return null;
      let end = at + 1;
      while (end < until && (items[end]!.level ?? 2) > level) end++;
      const link = <Link href={"#" + item.id} data-reading-target={trackCurrent === "css" ? readingTarget(item.id).name : undefined} aria-current={item.id === current ? "location" : undefined}
        onClick={event => { if (props.onNavigate) { event.preventDefault(); props.onNavigate(item.id); } }}>{item.label}</Link>;
      return <SemanticContent as="li" key={item.id}>{link}{end > at + 1 ? <TableOfContentsDisclosure id={item.id} title={item.label}>{branch(at + 1, end)}</TableOfContentsDisclosure> : null}</SemanticContent>;
    })}</SemanticContent>;
    return <SemanticContent as="nav" {...SECTION_STAMP} aria-label={label} className={className} style={style}>{trackCurrent === "css" ? <style>{articleTocCss(items)}</style> : null}{branch(0, items.length)}</SemanticContent>;
  }
  if (presentation === "inline") {
    return (
      <SemanticContent as="div" {...SECTION_STAMP} className={cx(BOX_CLASSES, className)} style={style}>
        <TableOfContentsDisclosure id="article-toc" title={label}>
          {renderTableOfContentsInlineNav({ label, items, onNavigate: props.onNavigate, trackCurrent }, current, props.onNavigate ? Link : undefined)}
        </TableOfContentsDisclosure>
      </SemanticContent>
    );
  }
  return renderTableOfContentsSidebar({ label, items, className, style, onNavigate: props.onNavigate, trackCurrent }, current, props.onNavigate ? Link : undefined);
}
