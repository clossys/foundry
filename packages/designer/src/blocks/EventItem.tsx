import type { HTMLAttributes, ReactNode } from "react";
import { Avatar } from "../atoms/Avatar.server.js";
import { Icon } from "../atoms/Icon.js";
import { cx } from "../atoms/internal/cx.js";
import { ArrowRight } from "../icons/ArrowRight.js";
import { Settings } from "../icons/Settings.js";

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
    <div {...rest} data-event-item="" className={cx("grid grid-cols-[auto_1fr] gap-x-md gap-y-xs", className)}>
      {event.actor.kind === "system" ? (
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-ink-secondary">
          <Icon glyph={Settings} decorative size="sm" />
        </span>
      ) : <Avatar size="sm" alt={event.actor.name} src={event.actor.avatarSrc} />}
      <div className="min-w-0 break-words">
        <p className={cx("text-body text-ink-primary", event.unread ? "font-semibold" : undefined)}>
          {event.unread ? <><span aria-hidden="true" className="me-xs inline-block size-2 rounded-pill bg-accent forced-colors:bg-current forced-colors:[forced-color-adjust:preserve-parent-color]" /><span className="sr-only">{labels.unread}</span>{" "}</> : null}
          {event.summary}
        </p>
        <time dateTime={event.at} className="text-caption text-ink-muted">{event.timeText}</time>
        {event.changes?.length ? (
          <dl className="mt-xs text-body-s tablet:flex tablet:flex-wrap tablet:gap-x-md">
            {event.changes.map(change => (
              <div key={change.id} className="min-w-0">
                <dt className="text-ink-secondary">{change.field}</dt>
                <dd className="flex flex-wrap items-center gap-xs text-ink-primary">
                  {change.from !== undefined && change.from !== null ? <><span className="sr-only">{labels.changedFrom}</span>{" "}<span className="line-through text-ink-muted">{change.from}</span>{" "}<Icon glyph={ArrowRight} decorative size="sm" className="rtl:rotate-180" /></> : null}
                  <span className="sr-only">{labels.changedTo}</span>{" "}
                  <span>{change.to ?? labels.cleared}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {event.detail !== undefined && event.detail !== null ? <div data-event-detail="" className="mt-xs text-body-s text-ink-secondary">{event.detail}</div> : null}
        {event.actions !== undefined && event.actions !== null ? <div data-event-actions="" className="mt-sm flex flex-wrap gap-sm">{event.actions}</div> : null}
      </div>
    </div>
  );
}
