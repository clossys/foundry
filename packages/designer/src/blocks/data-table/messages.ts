import type { TableFilter, TableValue, TableAggregateValue, TablePivotAxis } from "../table-model/index.js";
import type { DataTableSortRule } from "./view-model.js";
import { pathLabel, valueLabel } from "./presentation.js";

/** Host copy, separate from the persisted view. Every field is optional. */
export interface DataTableMessages {
  /** @default "View options" */
  readonly viewOptionsLabel?: string;
  /** @default "Close view options" */
  readonly closeViewOptionsLabel?: string;
  /** @default "View mode" */
  readonly viewModeLabel?: string;
  /** @default "Density" */
  readonly densityLabel?: string;
  /** @default "Group" */
  readonly groupSectionLabel?: string;
  /** @default "Sort" */
  readonly sortSectionLabel?: string;
  /** @default "Filter" */
  readonly filterSectionLabel?: string;
  /** @default "Columns" */
  readonly columnsSectionLabel?: string;
  /** @default "Pivot" */
  readonly pivotSectionLabel?: string;
  /** @default "Ascending" */
  readonly ascendingLabel?: string;
  /** @default "Descending" */
  readonly descendingLabel?: string;
  /** @default "Flat" */
  readonly flatModeLabel?: string;
  /** @default "Grouped" */
  readonly groupedModeLabel?: string;
  /** @default "Pivot" */
  readonly pivotModeLabel?: string;
  /** @default "Comfortable" */
  readonly comfortableDensityLabel?: string;
  /** @default "Compact" */
  readonly compactDensityLabel?: string;
  /** @default "Define measures in the table model to configure a pivot." */
  readonly pivotMeasuresLabel?: string;
  /** @default "Active view rules" */
  readonly activeRulesLabel?: string;
  /** @default column => `Group by ${column}` */
  readonly groupByMessage?: (column: string) => string;
  /** @default column => `Group ${column} order` */
  readonly groupOrderMessage?: (column: string) => string;
  /** @default column => `Move group ${column} earlier` */
  readonly moveGroupMessage?: (column: string) => string;
  /** @default column => `Sort ${column} direction` */
  readonly sortDirectionMessage?: (column: string) => string;
  /** @default column => `Move sort ${column} earlier` */
  readonly moveSortMessage?: (column: string) => string;
  /** @default column => `Remove sort ${column}` */
  readonly removeSortMessage?: (column: string) => string;
  /** @default column => `Add sort ${column}` */
  readonly addSortMessage?: (column: string) => string;
  /** @default (column, filter) => `Remove filter ${column} ${describeFilter(filter)}` */
  readonly removeFilterMessage?: (column: string, filter: TableFilter) => string;
  /** @default column => `Add filter ${column}` */
  readonly addFilterMessage?: (column: string) => string;
  /** @default column => `Show ${column}` */
  readonly showColumnMessage?: (column: string) => string;
  /** @default column => `Move column ${column} earlier` */
  readonly moveColumnMessage?: (column: string) => string;
  /** @default (rowAxis, column) => `Pivot ${rowAxis ? "rows" : "columns"} ${column}` */
  readonly pivotDimensionMessage?: (rowAxis: boolean, column: string) => string;
  /** @default (rowAxis, column) => `Pivot ${rowAxis ? "rows" : "columns"} ${column} order` */
  readonly pivotOrderMessage?: (rowAxis: boolean, column: string) => string;
  /** @default (rowAxis, column) => `Move pivot ${rowAxis ? "rows" : "columns"} ${column} earlier` */
  readonly movePivotMessage?: (rowAxis: boolean, column: string) => string;
  /** @default column => `Remove group ${column}` */
  readonly removeGroupMessage?: (column: string) => string;
  /** @default column => `Group: ${column}` */
  readonly groupChipMessage?: (column: string) => string;
  /** @default (column, direction) => `Sort: ${column} ${direction}` */
  readonly sortChipMessage?: (column: string, direction: DataTableSortRule["direction"]) => string;
  /** @default (column, filter) => `Filter: ${column} ${describeFilter(filter)}` */
  readonly filterChipMessage?: (column: string, filter: TableFilter) => string;
  /** @default column => `Minimum ${column}` */
  readonly minimumMessage?: (column: string) => string;
  /** @default column => `Maximum ${column}` */
  readonly maximumMessage?: (column: string) => string;
  /** @default column => `Apply ${column} range` */
  readonly applyRangeMessage?: (column: string) => string;
  /** @default "Enter valid bounds with minimum no greater than maximum." */
  readonly invalidRangeLabel?: string;
  /** @default "UTC: YYYY-MM-DD or a canonical ISO timestamp." */
  readonly dateHintLabel?: string;
  /** @default column => `${column} comparison` */
  readonly comparisonMessage?: (column: string) => string;
  /** @default column => `${column} value` */
  readonly filterValueMessage?: (column: string) => string;
  /** @default column => `${column} matching` */
  readonly matchingMessage?: (column: string) => string;
  /** @default column => `${column} is true` */
  readonly booleanFilterMessage?: (column: string) => string;
  /** @default (column, value) => `${column}: ${value}` */
  readonly facetValueMessage?: (column: string, value: string) => string;
  /** @default "No values in the current data." */
  readonly noFacetValuesLabel?: string;
  /** @default "Contains" */
  readonly containsLabel?: string;
  /** @default "Equals" */
  readonly equalsLabel?: string;
  /** @default "Any" */
  readonly anyTagsLabel?: string;
  /** @default "All" */
  readonly allTagsLabel?: string;
  /** @default "None" */
  readonly noTagsLabel?: string;
  /** @default (path, expanded) => `${expanded ? "Collapse" : "Expand"} group ${pathLabel(path)}` */
  readonly groupToggleMessage?: (path: readonly TableValue[], expanded: boolean) => string;
  /** @default path => pathLabel(path) */
  readonly groupPathMessage?: (path: readonly TableValue[]) => string;
  /** @default (id, value) => `${id}: ${valueLabel(value)}` */
  readonly aggregateMessage?: (id: string, value: TableAggregateValue) => string;
  /** @default "Configure pivot dimensions and measures" */
  readonly pivotEmptyLabel?: string;
  /** @default "Rows" */
  readonly pivotRowsHeaderLabel?: string;
  /** @default axis => axis.kind === "total" ? "Total" : (axis.kind === "subtotal" ? "Subtotal " : "") + pathLabel(axis.path) */
  readonly pivotAxisMessage?: (axis: TablePivotAxis) => string;
  /** @default (axis, measure) => `${defaultPivotAxisMessage(axis)} · ${measure}` */
  readonly pivotColumnMessage?: (axis: TablePivotAxis, measure: string) => string;
  /** @default (value, empty) => empty ? "—" : valueLabel(value) */
  readonly pivotValueMessage?: (value: TableAggregateValue, empty: boolean) => string;
  /** @default "Select all rows" */
  readonly selectAllLabel?: string;
  /** @default "Select row" */
  readonly selectRowLabel?: string;
}

function describeFilter(filter: TableFilter): string {
  if (filter.kind === "text") return `${filter.op} “${filter.value}”`;
  if (filter.kind === "number" || filter.kind === "date") return `${filter.min ?? "…"} – ${filter.max ?? "…"}`;
  if (filter.kind === "boolean") return String(filter.value);
  return `${filter.op}: ${filter.values.join(", ") || "(none)"}`;
}

export const defaultGroupByMessage: NonNullable<DataTableMessages["groupByMessage"]> = column => `Group by ${column}`;
export const defaultGroupOrderMessage: NonNullable<DataTableMessages["groupOrderMessage"]> = column => `Group ${column} order`;
export const defaultMoveGroupMessage: NonNullable<DataTableMessages["moveGroupMessage"]> = column => `Move group ${column} earlier`;
export const defaultSortDirectionMessage: NonNullable<DataTableMessages["sortDirectionMessage"]> = column => `Sort ${column} direction`;
export const defaultMoveSortMessage: NonNullable<DataTableMessages["moveSortMessage"]> = column => `Move sort ${column} earlier`;
export const defaultRemoveSortMessage: NonNullable<DataTableMessages["removeSortMessage"]> = column => `Remove sort ${column}`;
export const defaultAddSortMessage: NonNullable<DataTableMessages["addSortMessage"]> = column => `Add sort ${column}`;
export const defaultRemoveFilterMessage: NonNullable<DataTableMessages["removeFilterMessage"]> = (column, filter) => `Remove filter ${column} ${describeFilter(filter)}`;
export const defaultAddFilterMessage: NonNullable<DataTableMessages["addFilterMessage"]> = column => `Add filter ${column}`;
export const defaultShowColumnMessage: NonNullable<DataTableMessages["showColumnMessage"]> = column => `Show ${column}`;
export const defaultMoveColumnMessage: NonNullable<DataTableMessages["moveColumnMessage"]> = column => `Move column ${column} earlier`;
export const defaultPivotDimensionMessage: NonNullable<DataTableMessages["pivotDimensionMessage"]> = (rowAxis, column) => `Pivot ${rowAxis ? "rows" : "columns"} ${column}`;
export const defaultPivotOrderMessage: NonNullable<DataTableMessages["pivotOrderMessage"]> = (rowAxis, column) => `Pivot ${rowAxis ? "rows" : "columns"} ${column} order`;
export const defaultMovePivotMessage: NonNullable<DataTableMessages["movePivotMessage"]> = (rowAxis, column) => `Move pivot ${rowAxis ? "rows" : "columns"} ${column} earlier`;
export const defaultRemoveGroupMessage: NonNullable<DataTableMessages["removeGroupMessage"]> = column => `Remove group ${column}`;
export const defaultGroupChipMessage: NonNullable<DataTableMessages["groupChipMessage"]> = column => `Group: ${column}`;
export const defaultSortChipMessage: NonNullable<DataTableMessages["sortChipMessage"]> = (column, direction) => `Sort: ${column} ${direction}`;
export const defaultFilterChipMessage: NonNullable<DataTableMessages["filterChipMessage"]> = (column, filter) => `Filter: ${column} ${describeFilter(filter)}`;
export const defaultMinimumMessage: NonNullable<DataTableMessages["minimumMessage"]> = column => `Minimum ${column}`;
export const defaultMaximumMessage: NonNullable<DataTableMessages["maximumMessage"]> = column => `Maximum ${column}`;
export const defaultApplyRangeMessage: NonNullable<DataTableMessages["applyRangeMessage"]> = column => `Apply ${column} range`;
export const defaultComparisonMessage: NonNullable<DataTableMessages["comparisonMessage"]> = column => `${column} comparison`;
export const defaultFilterValueMessage: NonNullable<DataTableMessages["filterValueMessage"]> = column => `${column} value`;
export const defaultMatchingMessage: NonNullable<DataTableMessages["matchingMessage"]> = column => `${column} matching`;
export const defaultBooleanFilterMessage: NonNullable<DataTableMessages["booleanFilterMessage"]> = column => `${column} is true`;
export const defaultFacetValueMessage: NonNullable<DataTableMessages["facetValueMessage"]> = (column, value) => `${column}: ${value}`;
export const defaultGroupToggleMessage: NonNullable<DataTableMessages["groupToggleMessage"]> = (path, expanded) => `${expanded ? "Collapse" : "Expand"} group ${pathLabel(path)}`;
export const defaultGroupPathMessage: NonNullable<DataTableMessages["groupPathMessage"]> = path => pathLabel(path);
export const defaultAggregateMessage: NonNullable<DataTableMessages["aggregateMessage"]> = (id, value) => `${id}: ${valueLabel(value)}`;
export const defaultPivotAxisMessage: NonNullable<DataTableMessages["pivotAxisMessage"]> = axis => axis.kind === "total" ? "Total" : (axis.kind === "subtotal" ? "Subtotal " : "") + pathLabel(axis.path);
export const defaultPivotColumnMessage: NonNullable<DataTableMessages["pivotColumnMessage"]> = (axis, measure) => `${defaultPivotAxisMessage(axis)} · ${measure}`;
export const defaultPivotValueMessage: NonNullable<DataTableMessages["pivotValueMessage"]> = (value, empty) => empty ? "—" : valueLabel(value);
