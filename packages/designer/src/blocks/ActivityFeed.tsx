import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { EmptyState, type EmptyStateProps } from "./EmptyState.js";
import { EventItem, type EventLabels, type EventRecord } from "./EventItem.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.activity-feed", "foundry/sections.activity-feed");

export interface ActivityFeedGroup {
  id: string;
  /** Visible group heading, such as a host-formatted day. */
  label: ReactNode;
  /** Ids of the events in this group, in display order. */
  eventIds: readonly string[];
}

export interface ActivityFeedProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  "aria-label": string;
  /** Every event in the feed, newest first as authored by the host. */
  events: readonly EventRecord[];
  /** Optional grouping: every event must belong to exactly one group. */
  groups?: readonly ActivityFeedGroup[];
  labels: EventLabels;
  /** Host filter controls rendered above the feed. */
  filters?: ReactNode;
  /** Shown instead of the list when there are no events. */
  emptyState: EmptyStateProps;
}

function eventList(events: readonly EventRecord[], labels: EventLabels) {
  return (
    <ol className="flex flex-col">
      {events.map((event, index) => (
        <li key={event.id} data-event-id={event.id} className={cx("py-md", index > 0 ? "border-t border-line-base" : undefined)}>
          <EventItem event={event} labels={labels} />
        </li>
      ))}
    </ol>
  );
}

/** A server-safe feed of EventItem rows, optionally grouped under headings, with a host filter region. */
export function ActivityFeed({ events, groups, labels, filters, emptyState, className, ...rest }: ActivityFeedProps) {
  const byId = new Map(events.map(event => [event.id, event]));
  const grouped = groups?.map(group => ({
    group,
    events: group.eventIds.map(id => {
      const event = byId.get(id);
      if (!event) throw new RangeError(`ActivityFeed: group ${group.id} names unknown event ${id}.`);
      return event;
    }),
  }));
  if (grouped) {
    const placed = new Set(grouped.flatMap(row => row.events.map(event => event.id)));
    const loose = events.find(event => !placed.has(event.id));
    if (loose) throw new RangeError(`ActivityFeed: event ${loose.id} is in no group.`);
  }
  return (
    <section {...SECTION_STAMP} {...rest} className={cx("flex min-w-0 flex-col gap-md font-body", className)}>
      {filters !== undefined && filters !== null ? <div data-activity-filters="" className="flex flex-wrap items-center gap-sm">{filters}</div> : null}
      {events.length === 0 ? <EmptyState {...emptyState} /> : grouped ? (
        <ol className="flex flex-col gap-lg">
          {grouped.map(({ group, events: rows }) => (
            <li key={group.id} data-activity-group={group.id} className="flex flex-col gap-xs">
              <h3 className="text-body-s font-semibold text-ink-secondary">{group.label}</h3>
              {eventList(rows, labels)}
            </li>
          ))}
        </ol>
      ) : eventList(events, labels)}
    </section>
  );
}
