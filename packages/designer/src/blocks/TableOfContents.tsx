import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Disclosure } from "../atoms/Disclosure.js";
import { cx } from "../atoms/internal/cx.js";
import {
  renderTableOfContentsInlineNav,
  renderTableOfContentsSidebar,
  validateTableOfContents,
} from "./TableOfContents.server.js";

export interface TableOfContentsItem {
  /** The id of the target element in the page; the link is `#{id}`. No whitespace and no `#`. */
  id: string;
  /** The visible link text. */
  label: ReactNode;
  /** Heading depth, which sets the indent. Default 2. */
  level?: 2 | 3;
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
  /** Track the current heading with an `IntersectionObserver`. Default true; ignored when `currentId` is given and by the server variant. */
  trackCurrent?: boolean;
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
  const tracking = currentId === undefined && trackCurrent !== false;
  const idsKey = items.map((item) => item.id).join("\n");
  const [observed, setObserved] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!tracking || typeof IntersectionObserver === "undefined") return;
    const order = idsKey.split("\n");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = order.find((id) => visible.has(id));
        if (first !== undefined) setObserved(first);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const id of order) {
      const target = document.getElementById(id);
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [tracking, idsKey]);

  const current = currentId ?? observed;

  if (presentation === "inline") {
    return (
      <div className={cx(BOX_CLASSES, className)} style={style}>
        <Disclosure title={label} defaultExpanded panelClassName="ps-0">
          {renderTableOfContentsInlineNav({ label, items }, current)}
        </Disclosure>
      </div>
    );
  }
  return renderTableOfContentsSidebar({ label, items, className, style }, current);
}
