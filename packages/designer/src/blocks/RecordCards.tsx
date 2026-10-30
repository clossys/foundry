import type { HTMLAttributes, ReactNode } from "react";
import type { BadgeVariant } from "../components/Badge.js";

import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Badge = componentLeaf<typeof import("../components/Badge.js").Badge>("components.badge");
const Card = componentLeaf<typeof import("../components/Card.js").Card>("components.card");
const Link = componentLeaf<typeof import("../components/Link.js").Link>("components.link");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

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
  grid: "grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3",
  list: "flex flex-col gap-sm",
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
    <SemanticContent as="ul" {...SECTION_STAMP} {...rest} role="list" data-layout={layout} className={cx(LAYOUT_CLASSES[layout], className)}>
      {records.map(record => (
        <SemanticContent as="li" key={record.id} className="flex min-w-0">
          <Card variant="outline" className="flex w-full flex-col gap-xs p-lg">
            <SemanticContent as="div" className="flex flex-wrap items-start justify-between gap-sm">
              <SemanticContent as={Heading} className="m-0 text-body-l font-medium text-ink-primary">
                {record.href ? <Link href={record.href} variant="standalone">{record.title}</Link> : record.title}
              </SemanticContent>
              {record.badge ? <Badge variant={record.badge.variant}>{record.badge.label}</Badge> : null}
            </SemanticContent>
            {record.description ? <SemanticContent as="p" className="text-body-s text-ink-secondary">{record.description}</SemanticContent> : null}
            {record.meta ? <SemanticContent as="p" className="mt-auto text-caption text-ink-muted">{record.meta}</SemanticContent> : null}
          </Card>
        </SemanticContent>
      ))}
    </SemanticContent>
  );
}
