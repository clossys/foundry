import type { ComponentProps, ComponentType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import type { SemanticContent as SemanticContentType } from "../components/SemanticContent.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

const SemanticContent = componentLeaf<typeof SemanticContentType>("components.semantic-content");
type CardPart = ComponentType<ComponentProps<"div">>;
const Card = componentLeaf<ComponentType<ComponentProps<"div"> & { size?: "default" | "sm" }>>("components.card");
const CardHeader = componentLeaf<CardPart>("components.card", "CardHeader");
const CardTitle = componentLeaf<CardPart>("components.card", "CardTitle");
const CardContent = componentLeaf<CardPart>("components.card", "CardContent");
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

/** Caller-ordered dated events composed through the consumer's selected component leaves. */
export function Timeline({ events, headingLevel = 3, className, ...rest }: TimelineProps) {
  if (events.length === 0) throw new TypeError("Timeline: events must not be empty.");
  return (
    <ol {...SECTION_STAMP} {...rest} className={cx("flex min-w-0 flex-col", className)}>
      {events.map((event, index) => {
        const rail = index < events.length - 1;
        return (
          <SemanticContent as="li" key={event.id} data-timeline-rail={rail ? "" : undefined} className={cx("relative flex gap-md", rail ? "pb-lg" : undefined)}>
            <SemanticContent as="span" aria-hidden="true" className="flex shrink-0 flex-col items-center">
              <SemanticContent as="span" className="mt-xs size-2 shrink-0 rounded-pill bg-accent forced-colors:bg-current" />
              {rail ? <SemanticContent as="span" className="mt-xs w-px flex-1 bg-line-base" /> : null}
            </SemanticContent>
            <Card className="min-w-0 flex-1">
              <CardHeader>
                <SemanticContent as="time" dateTime={event.at} className="text-caption text-ink-muted">{event.dateText}</SemanticContent>
                <CardTitle>
                  <SemanticContent as={headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3"}>{event.heading}</SemanticContent>
                </CardTitle>
              </CardHeader>
              {event.description !== undefined && event.description !== null ? <CardContent>{event.description}</CardContent> : null}
            </Card>
          </SemanticContent>
        );
      })}
    </ol>
  );
}
