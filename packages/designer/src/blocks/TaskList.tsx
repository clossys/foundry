import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import type { EmptyStateProps } from "./EmptyState.js";
import { SectionHeader } from "./SectionHeader.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Meter = componentLeaf<typeof import("../components/Meter.server.js").Meter>("components.meter");
const StatusMark = componentLeaf<typeof import("../components/StatusMark.js").StatusMark>("components.status-mark");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.task-list", "foundry/sections.task-list");

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
  const { icon, title, description, action, className: emptyClassName, ...emptyProps } = emptyState;
  return (
    <SemanticContent as="section" {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-md px-sm tablet:px-md", className)}>
      {items.length === 0 ? <SemanticContent as="div" {...emptyProps} className={cx("flex flex-col gap-sm p-2xl", emptyClassName)}>
        {icon ? <SemanticContent as="div">{icon}</SemanticContent> : null}
        <SectionHeader title={title} description={description} actions={action} level={2} />
      </SemanticContent> : <>
        <Meter value={doneCount} scaleMax={items.length} tone="accent" valueText={progressText} role="meter" aria-label={progressText} aria-valuemin={0} aria-valuenow={doneCount} aria-valuemax={items.length} aria-valuetext={progressText} />
        <ol>
          {items.map((item, index) => {
            if (item.href !== undefined) assertNoNestedInteractive("TaskList", item.id, [item.title, item.description, item.meta]);
            const isDone = item.status === "done";
            const linkedClassName = item.href !== undefined ? cardLinkContainerClassName("plain", "base") : undefined;
            return (
              <SemanticContent as="li"
                key={item.id}
                data-task=""
                data-status={item.status}
                className={cx("relative isolate flex items-start gap-md py-md", index > 0 ? "border-t border-line-base" : undefined, linkedClassName)}
                style={{ minBlockSize: item.href !== undefined ? UI_LAYOUT_TAP_TARGET : undefined, borderBlockStartWidth: index > 0 ? UI_BORDER_HAIRLINE : undefined }}
              >
                <StatusMark tone={isDone ? "success" : item.status === "in-progress" ? "info" : item.status === "blocked" ? "danger" : "neutral"} className="shrink-0">{statusLabels[item.status]}</StatusMark>
                <SemanticContent as="div" className="min-w-0 flex-1 break-words">
                  <SemanticContent as="p" className={cx("text-body", isDone ? "text-ink-muted" : "text-ink-primary")}>
                    {item.href !== undefined ? <CardLinkTitle href={item.href} frame="plain" ground="base">{item.title}</CardLinkTitle> : item.title}
                  </SemanticContent>
                  {item.description !== undefined && item.description !== null ? <SemanticContent as="p" data-description="" className="text-body-s text-ink-muted">{item.description}</SemanticContent> : null}
                  {item.meta !== undefined && item.meta !== null ? <SemanticContent as="div" data-metadata="" className="text-caption text-ink-muted">{item.meta}</SemanticContent> : null}
                </SemanticContent>
              </SemanticContent>
            );
          })}
        </ol>
      </>}
    </SemanticContent>
  );
}
