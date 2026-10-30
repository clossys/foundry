import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { ArrowRight } from "../icons/ArrowRight.js";
import { Settings } from "../icons/Settings.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Avatar = componentLeaf<typeof import("../components/Avatar.server.js").Avatar>("components.avatar");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export interface EventActor {
  name: string;
  avatarSrc?: string;
  kind?: "person" | "system";
}

export interface EventChange {
  id: string;
  field: ReactNode;
  from?: ReactNode;
  to?: ReactNode;
}

export interface EventRecord {
  id: string;
  /** ISO 8601 timestamp for the time element's machine-readable value. */
  at: string;
  /** Host-formatted visible time. */
  timeText: string;
  actor: EventActor;
  /** A complete host-composed sentence, including the actor where appropriate. */
  summary: ReactNode;
  changes?: readonly EventChange[];
  detail?: ReactNode;
  unread?: boolean;
  actions?: ReactNode;
}

export interface EventLabels {
  unread: string;
  changedFrom: string;
  changedTo: string;
  cleared: string;
}

export interface EventItemProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  event: EventRecord;
  labels: EventLabels;
}

/** A server-safe history row with authored summary, change descriptions and optional actions. */
export function EventItem({ event, labels, className, ...rest }: EventItemProps) {
  return (
    <SemanticContent as="div" {...rest} data-event-item="" className={cx("grid grid-cols-[auto_1fr] gap-x-md gap-y-xs", className)}>
      {event.actor.kind === "system" ? (
        <SemanticContent as="span" aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-ink-secondary">
          <Icon glyph={Settings} decorative size="sm" />
        </SemanticContent>
      ) : <Avatar size="sm" alt={event.actor.name} src={event.actor.avatarSrc} />}
      <SemanticContent as="div" className="min-w-0 break-words">
        <SemanticContent as="p" className={cx("text-body text-ink-primary", event.unread ? "font-semibold" : undefined)}>
          {event.unread ? <><SemanticContent as="span" aria-hidden="true" className="me-xs inline-block size-2 rounded-pill bg-accent forced-colors:bg-current forced-colors:[forced-color-adjust:preserve-parent-color]" /><SemanticContent as="span" className="sr-only">{labels.unread}</SemanticContent>{" "}</> : null}
          {event.summary}
        </SemanticContent>
        <SemanticContent as="time" dateTime={event.at} className="text-caption text-ink-muted">{event.timeText}</SemanticContent>
        {event.changes?.length ? (
          <SemanticContent as="dl" className="mt-xs text-body-s tablet:flex tablet:flex-wrap tablet:gap-x-md">
            {event.changes.map(change => (
              <SemanticContent as="div" key={change.id} className="min-w-0">
                <SemanticContent as="dt" className="text-ink-secondary">{change.field}</SemanticContent>
                <SemanticContent as="dd" className="flex flex-wrap items-center gap-xs text-ink-primary">
                  {change.from !== undefined && change.from !== null ? <><SemanticContent as="span" className="sr-only">{labels.changedFrom}</SemanticContent>{" "}<SemanticContent as="span" className="line-through text-ink-muted">{change.from}</SemanticContent>{" "}<Icon glyph={ArrowRight} decorative size="sm" className="rtl:rotate-180" /></> : null}
                  <SemanticContent as="span" className="sr-only">{labels.changedTo}</SemanticContent>{" "}
                  <SemanticContent as="span">{change.to ?? labels.cleared}</SemanticContent>
                </SemanticContent>
              </SemanticContent>
            ))}
          </SemanticContent>
        ) : null}
        {event.detail !== undefined && event.detail !== null ? <SemanticContent as="div" data-event-detail="" className="mt-xs text-body-s text-ink-secondary">{event.detail}</SemanticContent> : null}
        {event.actions !== undefined && event.actions !== null ? <SemanticContent as="div" data-event-actions="" className="mt-sm flex flex-wrap gap-sm">{event.actions}</SemanticContent> : null}
      </SemanticContent>
    </SemanticContent>
  );
}
