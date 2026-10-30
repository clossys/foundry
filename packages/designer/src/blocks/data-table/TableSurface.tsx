import type { ReactNode } from "react";
import { TOKENS } from "../../tokens/tokens.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Component-scoped layout, independent of a consumer's utility generation. */
const TABLE_LAYOUT = `
[data-table-scroll] table { inline-size: 100%; min-inline-size: max-content; }
[data-table-scroll] [data-column-label]::before { display: none; }
[data-table-cell-value] { min-inline-size: 0; }
[data-table-toolbar] { min-inline-size: 0; max-inline-size: 100%; }
[data-table-toolbar] > * { min-inline-size: 0; max-inline-size: 100%; }
[data-table-toolbar] input, [data-table-toolbar] button[aria-haspopup="listbox"] {
  block-size: var(--ui-control-h-md, 32px);
  min-block-size: var(--ui-control-h-md, 32px); padding-block: 0;
}
@container (width < ${TOKENS["--breakpoint-tablet"]!.value}) {
  [data-table-scroll][data-table-stack] table { display: block; min-inline-size: 100%; }
  [data-table-stack] table > thead { display: block; }
  [data-table-stack] table > thead > tr { display: flex; flex-wrap: wrap; }
  [data-table-stack] table > thead > tr > th { display: block; max-inline-size: 100%; inline-size: auto; }
  [data-table-stack] table > tbody { display: block; }
  [data-table-stack] table > tbody > tr { display: flex; min-inline-size: 0; flex-direction: column; }
  [data-table-stack] table > tbody > tr > :is(td, th) {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--spacing-md); min-inline-size: 0; overflow-wrap: anywhere;
  }
  [data-table-stack] [data-column-label]::before { display: block; content: attr(data-column-label); color: var(--color-ink-muted); }
}
`;

/** The containing board can shrink; only the table's own viewport scrolls. */
export function TableSurface({ label, children, stacked = true }: { label: string; children: ReactNode; stacked?: boolean }) {
  return <SemanticContent as="div" data-table-surface="" style={{ containerType: "inline-size", minInlineSize: 0, maxInlineSize: "100%" }}>
    <style>{TABLE_LAYOUT}</style>
    <SemanticContent as="div" data-table-scroll="" data-table-stack={stacked ? "" : undefined} role="region" aria-label={label} tabIndex={0}
      className="rounded-control border border-line-base"
      style={{ overflowX: "auto", minInlineSize: 0, maxInlineSize: "100%" }}>{children}</SemanticContent>
  </SemanticContent>;
}
