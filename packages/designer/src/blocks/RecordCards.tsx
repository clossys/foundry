import type { HTMLAttributes, ReactNode } from "react";
import { Badge, type BadgeVariant } from "../components/Badge.js";
import { Card } from "../components/Card.js";
import { Link } from "../components/Link.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.cards", "foundry/sections.cards");

export type RecordCardsLayout = "grid" | "list";
export type RecordCardsHeadingLevel = 2 | 3 | 4;
export type RecordCardsSpan = "full" | "half" | "third";
export interface RecordCardsRecord {
  /** Stable key for the record. */
  id: string;
  /** The record's name; a link when `href` is given. */
  title: ReactNode;
  /** One or two lines of supporting copy. */
  description?: ReactNode;
  /** Complete record content, such as one bound specimen leaf. Never wrapped as prose. */
  body?: ReactNode;
  /** The content leaf's declared share of a grid row. */
  span?: RecordCardsSpan;
  /** Destination of the record. The title becomes the link; the card is not a nested interactive. */
  href?: string;
  /** Short status or category shown beside the title. */
  badge?: { label: ReactNode; variant?: BadgeVariant };
  /** Secondary detail at the foot of the card ("Updated 2 days ago"). */
  meta?: ReactNode;
}
export interface RecordCardsProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  /** The records, in reading order. Each renders one `Card`. */
  records: readonly RecordCardsRecord[];
  /** `grid` lays cards in columns (one, two, then three); `list` stacks them full width. @default "grid" */
  layout?: RecordCardsLayout;
  /** Heading level of each card title. @default 3 */
  headingLevel?: RecordCardsHeadingLevel;
  /** The selected record identity. Selection controls remain in the supplied record content. */
  selectedId?: string;
}

const LAYOUT_CLASSES: Record<RecordCardsLayout, string> = {
  grid: "grid grid-cols-1 gap-md tablet:grid-cols-12",
  list: "flex flex-col gap-sm",
};
const SPAN_CLASSES: Record<RecordCardsSpan, string> = {
  full: "tablet:col-span-12",
  half: "tablet:col-span-6",
  third: "tablet:col-span-4",
};

/**
 * A collection of records as cards: the Foundry `Card` (outline), a title
 * that is the record's single link, an optional `Badge` and supporting copy.
 * Renders a list; the host injects the records and owns sorting, paging and
 * empty, loading and error states around it.
 */
export function RecordCards({ records, layout = "grid", headingLevel = 3, selectedId, className, ...rest }: RecordCardsProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <ul {...SECTION_STAMP} {...rest} role="list" data-layout={layout} className={cx(LAYOUT_CLASSES[layout], className)}>
      {records.map(record => (
        <li key={record.id} data-record-id={record.id} data-span={record.span} data-selected={selectedId === record.id ? "true" : undefined} className={cx("flex min-w-0", layout === "grid" ? record.span ? SPAN_CLASSES[record.span] : "tablet:col-span-6 desktop:col-span-4" : undefined)}>
          <Card variant="outline" className={cx("flex w-full min-w-0 flex-col gap-xs p-lg", selectedId === record.id ? "border-accent" : undefined)}>
            <div className="flex flex-wrap items-start justify-between gap-sm">
              <Heading className="m-0 text-body-l font-medium text-ink-primary">
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
