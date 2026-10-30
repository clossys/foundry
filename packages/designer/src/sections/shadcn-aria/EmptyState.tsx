import type { EmptyStateProps } from "../../blocks/EmptyState.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { SectionHeader } from "./SectionHeader.js";

/** The pinned Empty/EmptyHeader/EmptyContent composition; copy and controls stay supplied slots. */
export function EmptyState({ icon, title, description, action, className, ...rest }: EmptyStateProps) {
  return (
    <SemanticContent as="section" {...rest} data-ds-layer="sections" data-ds-leaf="sections.empty-state" data-ds-fill="shadcn@aria/sections.empty-state" data-slot="empty" className={cx("flex min-w-0 flex-1 flex-col items-center justify-center gap-lg p-xl text-center text-balance", className)}>
      <SemanticContent as="div" data-slot="empty-header" className="flex flex-col items-center gap-sm">
        {icon ? <SemanticContent as="div" data-slot="empty-icon" className="flex shrink-0 items-center justify-center text-ink-muted">{icon}</SemanticContent> : null}
        <SectionHeader level={2} title={title} description={description} align="center" density="standard" />
      </SemanticContent>
      {action ? <SemanticContent as="div" data-slot="empty-content" className="flex min-w-0 flex-col items-center gap-md">{action}</SemanticContent> : null}
    </SemanticContent>
  );
}
