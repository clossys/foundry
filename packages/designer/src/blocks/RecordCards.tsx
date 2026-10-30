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
export interface RecordCardsRecord {
  /** Stable key for the record. */
  id: string;
  /** The record's name; a link when `href` is given. */
  title: ReactNode;
  /** One or two lines of supporting copy. */
  description?: ReactNode;
  /** Rich content owned by a selected section, outside the supporting-copy paragraph. */
  body?: ReactNode;
  /** Declared width of the section rendered in this card. @default "third" */
  span?: "full" | "half" | "third";
  /** Whether the record is the host's current selection. Selection controls remain in the title. */
  selected?: boolean;
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
}

const LAYOUT_CLASSES: Record<RecordCardsLayout, string> = {
  grid: "grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-6",
  list: "flex flex-col gap-sm",
};
const SPAN_CLASSES = {
  full: "tablet:col-span-2 desktop:col-span-6",
  half: "desktop:col-span-3",
  third: "desktop:col-span-2",
};

/**
 * A collection of records as cards: the Foundry `Card` (outline), a title
 * that is the record's single link, an optional `Badge` and supporting copy.
 * Renders a list; the host injects the records and owns sorting, paging and
 * empty, loading and error states around it.
 */
export function RecordCards({ records, layout = "grid", headingLevel = 3, className, ...rest }: RecordCardsProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <ul {...SECTION_STAMP} {...rest} role="list" data-layout={layout} className={cx(LAYOUT_CLASSES[layout], className)}>
      {records.map(record => (
        <li key={record.id} data-record-id={record.id} data-selected={record.selected || undefined} data-card-span={record.span} className={cx("flex min-w-0", layout === "grid" && SPAN_CLASSES[record.span ?? "third"])}>
          <Card variant="outline" className={cx("flex w-full flex-col gap-xs p-lg", record.selected && "ring-2 ring-accent")}>
            <div className="flex flex-wrap items-start justify-between gap-sm">
              <Heading className="m-0 text-body-l font-medium text-ink-primary">
                {record.href ? <Link href={record.href} variant="standalone">{record.title}</Link> : record.title}
              </Heading>
              {record.badge ? <Badge variant={record.badge.variant}>{record.badge.label}</Badge> : null}
            </div>
            {record.description ? <p className="text-body-s text-ink-secondary">{record.description}</p> : null}
            {record.body !== undefined && record.body !== null ? <div className="min-w-0" data-record-body="">{record.body}</div> : null}
            {record.meta ? <p className="mt-auto text-caption text-ink-muted">{record.meta}</p> : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
