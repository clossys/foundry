import { useId, type HTMLAttributes, type ReactNode } from "react";
import { Badge, type BadgeVariant } from "../components/Badge.js";
import { Card } from "../components/Card.js";
import { Link } from "../components/Link.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.cards", "foundry/sections.cards");

export type RecordCardsLayout = "grid" | "list";
export type RecordCardsHeadingLevel = 2 | 3 | 4;
export interface RecordCardsRecord {
  /** Stable key for the record. */
  id: string;
  /** The record's name; a link when `href` is given. */
  title: ReactNode;
  /** One or two lines of supporting copy. */
  description?: ReactNode;
  /** Full record content, rendered intact inside the card. May contain interactive content. */
  body?: ReactNode;
  /** Declared width in the grid; all cards stack at the narrowest width. @default "third" */
  span?: "full" | "half" | "third";
  /** Destination of the record. The title becomes the link; the card is not a nested interactive. */
  href?: string;
  /** Short status or category shown beside the title. */
  badge?: { label: ReactNode; variant?: BadgeVariant };
  /** Secondary detail at the foot of the card ("Updated 2 days ago"). */
  meta?: ReactNode;
}
export interface RecordCardsProps extends Omit<HTMLAttributes<HTMLUListElement>, "children" | "onSelect"> {
  /** The records, in reading order. Each renders one `Card`. */
  records: readonly RecordCardsRecord[];
  /** `grid` lays cards in columns (one, two, then three); `list` stacks them full width. @default "grid" */
  layout?: RecordCardsLayout;
  /** Heading level of each card title. @default 3 */
  headingLevel?: RecordCardsHeadingLevel;
  /** The controlled current record. */
  selectedId?: string | null;
  /** Select a record by pointer or by pressing Enter/Space on its card, without wrapping its body in a button. */
  onSelect?: (id: string) => void;
}

const LAYOUT_CLASSES: Record<RecordCardsLayout, string> = {
  grid: "grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-6",
  list: "flex flex-col gap-sm",
};
const SPAN_CLASSES = {
  full: "col-span-full",
  half: "desktop:col-span-3",
  third: "desktop:col-span-2",
};

/**
 * A collection of records as cards: the Foundry `Card` (outline), a title
 * that is the record's single link, an optional `Badge` and supporting copy.
 * Renders a list; the host injects the records and owns sorting, paging and
 * empty, loading and error states around it.
 */
export function RecordCards({ records, layout = "grid", headingLevel = 3, selectedId, onSelect, className, ...rest }: RecordCardsProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const titlePrefix = useId();
  return (
    <ul {...SECTION_STAMP} {...rest} role="list" data-layout={layout} className={cx(LAYOUT_CLASSES[layout], className)}>
      {records.map((record, index) => (
        <li key={record.id} data-span={record.span ?? "third"} className={cx("flex min-w-0", layout === "grid" && SPAN_CLASSES[record.span ?? "third"])}>
          <Card
            variant="outline"
            role={onSelect ? "group" : undefined}
            aria-labelledby={onSelect ? titlePrefix + "-" + index : undefined}
            aria-current={record.id === selectedId ? "true" : undefined}
            data-selected={record.id === selectedId ? "" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? () => onSelect(record.id) : undefined}
            onKeyDown={onSelect ? event => {
              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onSelect(record.id);
              }
            } : undefined}
            className={cx("flex w-full flex-col gap-xs p-lg", onSelect && "outline-none focus-visible:ring-2 focus-visible:ring-current", record.id === selectedId && "border-current bg-surface-selected")}
          >
            <div className="flex flex-wrap items-start justify-between gap-sm">
              <Heading id={onSelect ? titlePrefix + "-" + index : undefined} className="m-0 text-body-l font-medium text-ink-primary">
                {record.href ? <Link href={record.href} variant="standalone">{record.title}</Link> : record.title}
              </Heading>
              {record.badge ? <Badge variant={record.badge.variant}>{record.badge.label}</Badge> : null}
            </div>
            {record.description ? <p className="text-body-s text-ink-secondary">{record.description}</p> : null}
            {record.body}
            {record.meta ? <p className="mt-auto text-caption text-ink-muted">{record.meta}</p> : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
