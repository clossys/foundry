import { defaultGroupToggleMessage, defaultGroupPathMessage, defaultAggregateMessage, type DataTableMessages } from "./messages.js";
import type { Key } from "react-aria-components";
import { TOKENS } from "../../tokens/tokens.js";

import { useGlyph } from "../../components/glyph-context.js";
import { cx } from "../../components/internal/cx.js";
import type { DataTableColumn, DataTableProps } from "../DataTable.js";
import { filterRows, groupRows, type TableGroup } from "../table-model/index.js";
import { FlatGrid } from "./FlatGrid.js";
import { PivotGrid } from "./PivotGrid.js";
import { sortViewRows } from "./presentation.js";
import { ViewOptions } from "./ViewOptions.js";
import { editView, parseDataTableViewModel, type DataTableViewModel, type DataTableViewModelV1 } from "./view-model.js";
import { dsPassThrough } from "../../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const Button = componentLeaf<typeof import("../../components/Button.js").Button>("components.button");
const Icon = componentLeaf<typeof import("../../components/Icon.js").Icon>("components.icon");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

type DisplayRow<Row> = { kind: "leaf"; key: string; row: Row } | { kind: "group"; key: string; group: TableGroup<Row>; open: boolean };
const leafKey = (key: Key) => "leaf:" + JSON.stringify([typeof key, key]);
export function ModelTable<Row>({
  /** @default (path, expanded) => `${expanded ? "Collapse" : "Expand"} group ${pathLabel(path)}` */
  groupToggleMessage = defaultGroupToggleMessage,
  /** @default path => pathLabel(path) */
  groupPathMessage = defaultGroupPathMessage,
  /** @default (id, value) => `${id}: ${valueLabel(value)}` */
  aggregateMessage = defaultAggregateMessage,
  ...props
}: DataTableProps<Row> & DataTableMessages & { model: DataTableViewModel | DataTableViewModelV1 }) {
  const expandedGlyph = useGlyph("assets.icon-chevron-down");
  const collapsedGlyph = useGlyph("assets.icon-chevron-right");
  const { model: inputModel, onModelChange, expandedGroupKeys = "all", onExpandedGroupKeysChange, toolbar, footer } = props;
  const model = parseDataTableViewModel(inputModel);
  if (!onModelChange) throw new TypeError("DataTable with model requires onModelChange.");
  const supplied = new Map(props.columns.map(column => [column.id, column]));
  for (const column of model.table.columns) if (!supplied.has(column.id)) throw new TypeError("DataTable requires a renderer for every model column.");
  const visible = model.visibleColumns.map(id => supplied.get(id)!);
  const rowHeader = visible.find(column => column.isRowHeader)?.id ?? visible[0]!.id;
  const columns = visible.map(column => ({ ...column, isRowHeader: column.id === rowHeader, allowsSorting: true }));
  const filtered = filterRows(props.rows as readonly (Row & object)[], model.table);
  const sorted = sortViewRows(filtered.rows, model);
  const labels = new Map(props.columns.map(column => [column.id, typeof column.header === "string" ? column.header : column.id]));
  const sortProps = {
    sortDescriptor: model.sort[0] ? { column: model.sort[0].column, direction: model.sort[0].direction } : undefined,
    onSortChange: (sort: { column: Key; direction: "ascending" | "descending" }) => onModelChange(editView(model, { sort: [{ column: String(sort.column), direction: sort.direction }, ...model.sort.filter(rule => rule.column !== sort.column)] })),
  };
  let grid;
  if (model.mode === "pivot" && !props.isLoading) grid = <PivotGrid {...props.messages} rows={props.rows} model={model} label={props["aria-label"]} />;
  else if (model.mode === "grouped" && model.table.groupBy?.length && !props.isLoading) {
    const groups = groupRows(props.rows as readonly (Row & object)[], model.table);
    const allKeys = new Set<string>();
    const collect = (groups: readonly TableGroup<Row>[]) => { for (const group of groups) { allKeys.add(group.key); collect(group.children); } }; collect(groups);
    const display: DisplayRow<Row>[] = [];
    const visit = (groups: readonly TableGroup<Row>[]) => { for (const group of groups) {
      const open = expandedGroupKeys === "all" || expandedGroupKeys.has(group.key);
      display.push({ kind: "group", key: "group:" + group.key, group, open });
      if (open) { if (group.children.length) visit(group.children); else for (const row of sortViewRows(group.rows, model)) display.push({ kind: "leaf", key: leafKey(props.rowKey(row)), row }); }
    } }; visit(groups);
    const toggle = (group: TableGroup<Row>, open: boolean) => {
      const keys = new Set(expandedGroupKeys === "all" ? allKeys : expandedGroupKeys);
      if (open) keys.delete(group.key); else keys.add(group.key);
      onExpandedGroupKeysChange?.(keys);
    };
    const groupedColumns: DataTableColumn<DisplayRow<Row>>[] = columns.map(column => ({ ...column, cell: item => {
      if (item.kind === "leaf") return column.cell(item.row);
      return <>
        {column.id === rowHeader ? <SemanticContent as="span" style={{ paddingInlineStart: `calc(${item.group.path.length - 1} * var(--spacing-md, ${TOKENS["--spacing-md"]!.value}))` }}>
          {onExpandedGroupKeysChange ? <Button variant="ghost" className="text-ink-muted" style={{ whiteSpace: "normal", textAlign: "start" }} aria-expanded={item.open} aria-label={groupToggleMessage(item.group.path, item.open)} onPress={() => toggle(item.group, item.open)}>
            <Icon glyph={item.open ? expandedGlyph : collapsedGlyph} decorative size="sm" /> {groupPathMessage(item.group.path)}
          </Button> : <SemanticContent as="span" className="inline-flex items-center gap-xs text-ink-muted" style={{ whiteSpace: "normal" }}>
            <Icon glyph={item.open ? expandedGlyph : collapsedGlyph} decorative size="sm" /> {groupPathMessage(item.group.path)}
          </SemanticContent>}
        </SemanticContent> : null}
        {column.id === columns[columns.length - 1]!.id ? <SemanticContent as="span" className="inline-flex flex-wrap gap-sm">{Object.entries(item.group.aggregates).map(([id, value]) => <SemanticContent as="span" key={id}>{aggregateMessage(id, value)}</SemanticContent>)}</SemanticContent> : null}
      </>;
    } }));
    const keys = new Map(props.rows.map(row => [leafKey(props.rowKey(row)), props.rowKey(row)]));
    const selectedKeys = typeof props.selectedKeys === "string" ? props.selectedKeys : props.selectedKeys ? new Set([...props.selectedKeys].map(leafKey)) : undefined;
    grid = <FlatGrid {...props} {...props.messages} {...sortProps} data-ds-layer={undefined} data-ds-leaf={undefined} data-ds-fill={undefined} className={undefined} style={undefined} toolbar={undefined} footer={undefined} columns={groupedColumns} rows={display} rowKey={item => item.key} density={model.density}
      disabledKeys={display.filter(item => item.kind === "group").map(item => item.key)} selectedKeys={selectedKeys}
      onSelectionChange={next => props.onSelectionChange?.(next === "all" ? "all" : new Set([...next].flatMap(key => keys.has(String(key)) ? [keys.get(String(key))!] : [])))} />;
  } else grid = <FlatGrid {...props} {...props.messages} {...sortProps} data-ds-layer={undefined} data-ds-leaf={undefined} data-ds-fill={undefined} className={undefined} style={undefined} toolbar={undefined} footer={undefined} rows={sorted} columns={columns} density={model.density} />;
  return <SemanticContent as="div" {...dsPassThrough(props)} className={cx("flex min-w-0 max-w-full flex-col gap-md", props.className)} style={props.style}>
    {toolbar ? <SemanticContent as="div" data-table-toolbar="" className="flex flex-wrap items-end justify-between gap-md">{toolbar}</SemanticContent> : null}
    <ViewOptions {...props.messages} messages={props.messages} model={model} change={onModelChange} facets={filtered.facets} labels={labels} />
    {grid}
    {footer ? <SemanticContent as="div" className="flex flex-wrap items-center justify-between gap-md">{footer}</SemanticContent> : null}
  </SemanticContent>;
}
