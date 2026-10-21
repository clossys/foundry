import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Badge } from "../atoms/Badge.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export interface TimelineEntry {
  id: string;
  dateTime: string;
  date: ReactNode;
  heading: ReactNode;
  label?: ReactNode;
  body?: ReactNode;
  href?: string;
}

export interface TimelineProps extends Omit<HTMLAttributes<HTMLOListElement>, "children"> {
  /** Entries remain in their authored order; one through twenty entries. */
  entries: readonly TimelineEntry[];
  /** Heading rank for each entry. @default 3 */
  headingLevel?: 3 | 4 | 5 | 6;
  /** Semantic surface and ink policy. @default "base" */
  ground?: SectionGround;
  "aria-labelledby"?: string;
  className?: string;
  style?: CSSProperties;
}

const DATE_TIME_PATTERN = /^\d{4}-\d{2}(-\d{2})?(T[\d:.+Z-]+)?$/;

/** Server-safe dated entries with host-formatted dates and optional linked headings. */
export function Timeline({ entries, headingLevel = 3, ground = "base", className, style, ...rest }: TimelineProps) {
  if (entries.length < 1 || entries.length > 20) throw new TypeError("Timeline: entries must contain one through twenty items.");
  for (const entry of entries) {
    if (!DATE_TIME_PATTERN.test(entry.dateTime)) throw new TypeError("Timeline: dateTime must be a year-month, date or date-time.");
  }
  const colors = SECTION_GROUND_CLASSES[ground];
  const Heading = `h${headingLevel}` as "h3" | "h4" | "h5" | "h6";
  const inverse = ground === "inverse";
  const dotClass = inverse ? "bg-accent-on-inverse" : "bg-accent";
  const focusClass = inverse ? "focus-visible:outline-accent-on-inverse" : "focus-visible:outline-accent";

  return (
    <ol {...rest} role="list" className={cx("m-0 flex list-none flex-col gap-xl p-0", colors.surface, className)} style={style}>
      {entries.map(entry => (
        <li key={entry.id} className="grid min-w-0 gap-sm tablet:grid-cols-[10rem_1fr] tablet:gap-xl">
          <div className="flex flex-wrap items-center gap-sm">
            <time dateTime={entry.dateTime} className={cx("text-body-s tabular-nums", colors.secondary)}>{entry.date}</time>
            {entry.label !== undefined ? <Badge variant="neutral">{entry.label}</Badge> : null}
          </div>
          <div className={cx("relative min-w-0 border-s ps-lg wrap-anywhere", colors.border)}>
            <span aria-hidden="true" className={cx("absolute -start-1 top-2 size-2 rounded-pill", dotClass)} />
            <Heading className={cx("text-body-l font-medium", colors.primary)}>
              {entry.href !== undefined ? (
                <a href={entry.href} style={{ minBlockSize: UI_LAYOUT_TAP_TARGET }} className={cx("inline-flex items-center rounded-default underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2", focusClass)}>{entry.heading}</a>
              ) : entry.heading}
            </Heading>
            {entry.body !== undefined ? <div className={cx("text-body", colors.secondary)}>{entry.body}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
