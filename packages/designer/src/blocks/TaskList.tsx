import type { HTMLAttributes, ReactNode } from "react";
import { Meter } from "../atoms/Meter.server.js";
import { StatusMark } from "../atoms/StatusMark.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../atoms/internal/ui-vars.js";
import { EmptyState, type EmptyStateProps } from "./EmptyState.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";

export type TaskStatus = "todo" | "in-progress" | "blocked" | "done";

export interface TaskListItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status: TaskStatus;
  href?: string;
  meta?: ReactNode;
}

export interface TaskListProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  "aria-label": string;
  items: readonly TaskListItem[];
  statusLabels: Record<TaskStatus, string>;
  /** Authored visible and accessible meter value, such as "1 of 4 done". */
  progressText: string;
  emptyState: EmptyStateProps;
}

/** A server-safe ordered checklist with explicit state labels and a completion meter. */
export function TaskList({ items, statusLabels, progressText, emptyState, className, ...rest }: TaskListProps) {
  const doneCount = items.filter(item => item.status === "done").length;
  return (
    <section {...rest} className={cx("flex flex-col gap-md px-sm tablet:px-md", className)}>
      {items.length === 0 ? <EmptyState {...emptyState} /> : <>
        <Meter value={doneCount} scaleMax={items.length} tone="accent" valueText={progressText} role="meter" aria-label={progressText} aria-valuemin={0} aria-valuenow={doneCount} aria-valuemax={items.length} aria-valuetext={progressText} />
        <ol>
          {items.map((item, index) => {
            if (item.href !== undefined) assertNoNestedInteractive("TaskList", item.id, [item.title, item.description, item.meta]);
            const isDone = item.status === "done";
            const linkedClassName = item.href !== undefined ? cardLinkContainerClassName("plain", "base") : undefined;
            return (
              <li
                key={item.id}
                data-task=""
                data-status={item.status}
                className={cx("relative isolate flex items-start gap-md py-md", index > 0 ? "border-t border-line-base" : undefined, linkedClassName)}
                style={{ minBlockSize: item.href !== undefined ? UI_LAYOUT_TAP_TARGET : undefined, borderBlockStartWidth: index > 0 ? UI_BORDER_HAIRLINE : undefined }}
              >
                <StatusMark tone={isDone ? "success" : item.status === "in-progress" ? "info" : item.status === "blocked" ? "danger" : "neutral"} className="shrink-0">{statusLabels[item.status]}</StatusMark>
                <div className="min-w-0 flex-1 break-words">
                  <p className={cx("text-body", isDone ? "text-ink-muted" : "text-ink-primary")}>
                    {item.href !== undefined ? <CardLinkTitle href={item.href} frame="plain" ground="base">{item.title}</CardLinkTitle> : item.title}
                  </p>
                  {item.description !== undefined && item.description !== null ? <p data-description="" className="text-body-s text-ink-muted">{item.description}</p> : null}
                  {item.meta !== undefined && item.meta !== null ? <div data-metadata="" className="text-caption text-ink-muted">{item.meta}</div> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </>}
    </section>
  );
}
