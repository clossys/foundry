import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.timeline", "foundry/sections.timeline");

export interface TimelineEvent {
  id: string;
  /** Machine-readable date for the time element (ISO 8601, any precision). */
  at: string;
  /** Host-formatted visible date. */
  dateText: string;
  heading: ReactNode;
  description?: ReactNode;
}

export type TimelineHeadingLevel = 2 | 3 | 4;

export interface TimelineProps extends Omit<HTMLAttributes<HTMLOListElement>, "children"> {
  /** Dated events in display order; at least one. */
  events: readonly TimelineEvent[];
  /** Level of each event heading. @default 3 */
  headingLevel?: TimelineHeadingLevel;
}

/** A server-safe dated sequence: one ordered list with a marker rail, dates and event headings. */
export function Timeline({ events, headingLevel = 3, className, ...rest }: TimelineProps) {
  if (events.length === 0) throw new TypeError("Timeline: events must not be empty.");
  const Heading = `h${headingLevel}` as const;
  return (
    <ol {...SECTION_STAMP} {...rest} className={cx("flex min-w-0 flex-col font-body", className)}>
      {events.map((event, index) => {
        const rail = index < events.length - 1;
        return (
          <li key={event.id} data-timeline-rail={rail ? "" : undefined} className={cx("relative flex gap-md", rail ? "pb-lg" : undefined)}>
            <span aria-hidden="true" className="flex shrink-0 flex-col items-center">
              <span className="mt-xs size-2 shrink-0 rounded-pill bg-accent forced-colors:bg-current" />
              {rail ? <span className="mt-xs w-px flex-1 bg-line-base" /> : null}
            </span>
            <div className="flex min-w-0 flex-col gap-xs break-words">
              <time dateTime={event.at} className="text-caption text-ink-muted">{event.dateText}</time>
              <Heading className="text-body font-semibold text-ink-primary">{event.heading}</Heading>
              {event.description !== undefined && event.description !== null ? <p className="text-body-s text-ink-secondary">{event.description}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
