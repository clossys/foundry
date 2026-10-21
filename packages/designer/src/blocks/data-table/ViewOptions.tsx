import { defaultGroupByMessage, defaultGroupOrderMessage, defaultMoveGroupMessage, defaultSortDirectionMessage, defaultMoveSortMessage, defaultRemoveSortMessage, defaultAddSortMessage, defaultRemoveFilterMessage, defaultAddFilterMessage, defaultShowColumnMessage, defaultMoveColumnMessage, defaultPivotDimensionMessage, defaultPivotOrderMessage, defaultMovePivotMessage, defaultRemoveGroupMessage, defaultGroupChipMessage, defaultSortChipMessage, defaultFilterChipMessage, type DataTableMessages } from "./messages.js";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "../../atoms/Button.js";
import { Checkbox } from "../../atoms/Checkbox.js";
import { Chip } from "../../atoms/Chip.js";
import { Dialog } from "../../atoms/Dialog.js";
import { Popover } from "../../atoms/Popover.js";
import { Select } from "../../atoms/Select.js";
import { Drawer } from "../Drawer.js";
import type { TableColumn, TableDimension, TableFilter, TableFilterNode, TableFilterResult, TableModel } from "../table-model/index.js";
import { FilterEditor } from "./FilterEditor.js";
import { editView, type DataTableViewModel } from "./view-model.js";

const wideQuery = "(min-width: 768px)";
function subscribeViewport(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
function narrowViewport() { return typeof window.matchMedia === "function" && !window.matchMedia(wideQuery).matches; }
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-sm border-t border-line-base pt-md"><h3 className="text-body font-body text-ink-primary">{title}</h3>{children}</section>;
}
function without<T>(items: readonly T[], index: number): T[] { return items.filter((_, i) => i !== index); }
function moveUp<T>(items: readonly T[], index: number): T[] {
  if (!index) return [...items];
  const next = [...items]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next;
}
function newFilter(column: TableColumn): TableFilter {
  const base = { column: column.id };
  switch (column.kind) {
    case "text": return { ...base, kind: "text", op: "contains", value: "" };
    case "number": return { ...base, kind: "number", op: "range" };
    case "date": return { ...base, kind: "date", op: "range" };
    case "boolean": return { ...base, kind: "boolean", op: "equals", value: true };
    case "enum": return { ...base, kind: "enum", op: "in", values: [] };
    case "tags": return { ...base, kind: "tags", op: "any", values: [] };
  }
}
export function ViewOptions({
  /** @default "View options" */
  viewOptionsLabel = "View options",
  /** @default "Close view options" */
  closeViewOptionsLabel = "Close view options",
  /** @default "View mode" */
  viewModeLabel = "View mode",
  /** @default "Density" */
  densityLabel = "Density",
  /** @default "Group" */
  groupSectionLabel = "Group",
  /** @default "Sort" */
  sortSectionLabel = "Sort",
  /** @default "Filter" */
  filterSectionLabel = "Filter",
  /** @default "Columns" */
  columnsSectionLabel = "Columns",
  /** @default "Pivot" */
  pivotSectionLabel = "Pivot",
  /** @default "Ascending" */
  ascendingLabel = "Ascending",
  /** @default "Descending" */
  descendingLabel = "Descending",
  /** @default "Flat" */
  flatModeLabel = "Flat",
  /** @default "Grouped" */
  groupedModeLabel = "Grouped",
  /** @default "Pivot" */
  pivotModeLabel = "Pivot",
  /** @default "Comfortable" */
  comfortableDensityLabel = "Comfortable",
  /** @default "Compact" */
  compactDensityLabel = "Compact",
  /** @default "Define measures in the table model to configure a pivot." */
  pivotMeasuresLabel = "Define measures in the table model to configure a pivot.",
  /** @default "Active view rules" */
  activeRulesLabel = "Active view rules",
  /** @default column => `Group by ${column}` */
  groupByMessage = defaultGroupByMessage,
  /** @default column => `Group ${column} order` */
  groupOrderMessage = defaultGroupOrderMessage,
  /** @default column => `Move group ${column} earlier` */
  moveGroupMessage = defaultMoveGroupMessage,
  /** @default column => `Sort ${column} direction` */
  sortDirectionMessage = defaultSortDirectionMessage,
  /** @default column => `Move sort ${column} earlier` */
  moveSortMessage = defaultMoveSortMessage,
  /** @default column => `Remove sort ${column}` */
  removeSortMessage = defaultRemoveSortMessage,
  /** @default column => `Add sort ${column}` */
  addSortMessage = defaultAddSortMessage,
  /** @default (column, filter) => `Remove filter ${column} ${describeFilter(filter)}` */
  removeFilterMessage = defaultRemoveFilterMessage,
  /** @default column => `Add filter ${column}` */
  addFilterMessage = defaultAddFilterMessage,
  /** @default column => `Show ${column}` */
  showColumnMessage = defaultShowColumnMessage,
  /** @default column => `Move column ${column} earlier` */
  moveColumnMessage = defaultMoveColumnMessage,
  /** @default (rowAxis, column) => `Pivot ${rowAxis ? "rows" : "columns"} ${column}` */
  pivotDimensionMessage = defaultPivotDimensionMessage,
  /** @default (rowAxis, column) => `Pivot ${rowAxis ? "rows" : "columns"} ${column} order` */
  pivotOrderMessage = defaultPivotOrderMessage,
  /** @default (rowAxis, column) => `Move pivot ${rowAxis ? "rows" : "columns"} ${column} earlier` */
  movePivotMessage = defaultMovePivotMessage,
  /** @default column => `Remove group ${column}` */
  removeGroupMessage = defaultRemoveGroupMessage,
  /** @default column => `Group: ${column}` */
  groupChipMessage = defaultGroupChipMessage,
  /** @default (column, direction) => `Sort: ${column} ${direction}` */
  sortChipMessage = defaultSortChipMessage,
  /** @default (column, filter) => `Filter: ${column} ${describeFilter(filter)}` */
  filterChipMessage = defaultFilterChipMessage,
  model, change, facets, labels, messages, hideFilters = false,
}: DataTableMessages & { model: DataTableViewModel; change: (next: DataTableViewModel) => void; facets: TableFilterResult<unknown>["facets"]; labels: ReadonlyMap<string, string>; messages?: DataTableMessages; hideFilters?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribeViewport, narrowViewport, () => false);
  const label = (id: string) => labels.get(id) ?? id;
  const columns = model.table.columns;
  const groups = model.table.groupBy ?? [];
  const filters = model.table.filters ?? [];
  const filterLabel = (filter: TableFilterNode) => filter.kind === "group" ? "" : label(filter.column);
  const editableFilter = (filter: TableFilterNode): filter is TableFilter => filter.kind !== "group" && filter.op !== "notEquals" && filter.op !== "notIn" && filter.op !== "empty" && filter.op !== "notEmpty";
  const hasDimensions = groups.length > 0 || (model.table.pivot?.rows.length ?? 0) + (model.table.pivot?.columns.length ?? 0) > 0;
  const tableChange = (patch: Partial<TableModel>) => change(editView(model, { table: { ...model.table, ...patch } }));
  const addGroup = (column: string) => tableChange({ groupBy: [...groups, { column }] });
  const addFilter = (column: string) => tableChange({ filters: [...filters, newFilter(columns.find(item => item.id === column)!)] });
  const axisControls = (rowAxis: boolean, values: readonly TableDimension[], update: (values: readonly TableDimension[]) => void) => <div className="flex flex-col gap-sm">
    {columns.map(column => <Checkbox key={column.id} isSelected={values.some(value => value.column === column.id)} onChange={checked => update(checked ? [...values, { column: column.id }] : values.filter(value => value.column !== column.id))}>{pivotDimensionMessage(rowAxis, label(column.id))}</Checkbox>)}
    {values.map(({
      /** @default "asc" */
      order = "asc", ...value
    }, index) => <div key={value.column} className="flex flex-wrap items-end gap-sm">
      <Select label={pivotOrderMessage(rowAxis, label(value.column))} selectedKey={order} options={[{ id: "asc", label: ascendingLabel }, { id: "desc", label: descendingLabel }]} onSelectionChange={key => { if (key === "asc" || key === "desc") update(values.map((item, i) => i === index ? { ...item, order: key } : item)); }} />
      <Button variant="ghost" isDisabled={index === 0} onPress={() => update(moveUp(values, index))}>{movePivotMessage(rowAxis, label(value.column))}</Button>
    </div>)}
  </div>;
  const pivot = model.table.pivot ?? { rows: groups, columns: [] };
  const controls = <div className="flex flex-col gap-md">
    <Section title={groupSectionLabel}>
      {columns.map(column => <Checkbox key={column.id} isSelected={groups.some(value => value.column === column.id)} onChange={checked => checked ? addGroup(column.id) : tableChange({ groupBy: groups.filter(value => value.column !== column.id) })}>{groupByMessage(label(column.id))}</Checkbox>)}
      {groups.map(({
        /** @default "asc" */
        order = "asc", ...group
      }, index) => <div key={group.column} className="flex flex-wrap items-end gap-sm">
        <Select label={groupOrderMessage(label(group.column))} selectedKey={order} options={[{ id: "asc", label: ascendingLabel }, { id: "desc", label: descendingLabel }]} onSelectionChange={key => { if (key === "asc" || key === "desc") tableChange({ groupBy: groups.map((item, i) => i === index ? { ...item, order: key } : item) }); }} />
        <Button variant="ghost" isDisabled={index === 0} onPress={() => tableChange({ groupBy: moveUp(groups, index) })}>{moveGroupMessage(label(group.column))}</Button>
      </div>)}
    </Section>
    <Section title={sortSectionLabel}>
      {model.sort.map((rule, index) => <div key={rule.column} className="flex flex-wrap items-end gap-sm">
        <Select label={sortDirectionMessage(label(rule.column))} selectedKey={rule.direction} options={[{ id: "ascending", label: ascendingLabel }, { id: "descending", label: descendingLabel }]} onSelectionChange={key => { if (key === "ascending" || key === "descending") change(editView(model, { sort: model.sort.map((item, i) => i === index ? { ...item, direction: key } : item) })); }} />
        <Button variant="ghost" isDisabled={index === 0} onPress={() => change(editView(model, { sort: moveUp(model.sort, index) }))}>{moveSortMessage(label(rule.column))}</Button>
        <Button variant="ghost" onPress={() => change(editView(model, { sort: without(model.sort, index) }))}>{removeSortMessage(label(rule.column))}</Button>
      </div>)}
      <div className="flex flex-wrap gap-xs">{columns.filter(column => !model.sort.some(rule => rule.column === column.id)).map(column => <Button key={column.id} variant="secondary" onPress={() => change(editView(model, { sort: [...model.sort, { column: column.id, direction: "ascending" }] }))}>{addSortMessage(label(column.id))}</Button>)}</div>
    </Section>
    {!hideFilters ? <Section title={filterSectionLabel}>
      {filters.map((filter, index) => <div key={`${filter.kind === "group" ? "group" : filter.column}:${index}`} className="flex flex-col gap-sm rounded-control border border-line-base p-sm">
        {editableFilter(filter) ? <FilterEditor {...messages} messages={messages} filter={filter} label={filterLabel(filter)} facets={facets[filter.column] ?? []} change={next => tableChange({ filters: filters.map((item, i) => i === index ? next : item) })} />
          : <span>{filterChipMessage(filterLabel(filter), filter)}</span>}
        <Button variant="ghost" onPress={() => tableChange({ filters: without(filters, index) })}>{removeFilterMessage(filterLabel(filter), filter)}</Button>
      </div>)}
      <div className="flex flex-wrap gap-xs">{columns.filter(column => !filters.some(filter => filter.kind !== "group" && filter.column === column.id)).map(column => <Button key={column.id} variant="secondary" onPress={() => addFilter(column.id)}>{addFilterMessage(label(column.id))}</Button>)}</div>
    </Section> : null}
    <Section title={columnsSectionLabel}>
      {columns.map(column => <Checkbox key={column.id} isSelected={model.visibleColumns.includes(column.id)} isDisabled={model.pinnedColumns?.includes(column.id) || (model.visibleColumns.length === 1 && model.visibleColumns[0] === column.id)} onChange={checked => change(editView(model, { visibleColumns: checked ? [...model.visibleColumns, column.id] : model.visibleColumns.filter(id => id !== column.id) }))}>{showColumnMessage(label(column.id))}</Checkbox>)}
      {model.visibleColumns.map((id, index) => <Button key={id} variant="ghost" isDisabled={index <= (model.pinnedColumns?.length ?? 0)} onPress={() => change(editView(model, { visibleColumns: moveUp(model.visibleColumns, index) }))}>{moveColumnMessage(label(id))}</Button>)}
    </Section>
    {hasDimensions ? <Section title={pivotSectionLabel}>
      {model.table.measures?.length ? <>
        {axisControls(true, pivot.rows, rows => tableChange({ pivot: { ...pivot, rows } }))}
        {axisControls(false, pivot.columns, columns => tableChange({ pivot: { ...pivot, columns } }))}
      </> : <p className="text-body-s text-ink-muted">{pivotMeasuresLabel}</p>}
    </Section> : null}
  </div>;
  const trigger = <Button key="view-options" variant="secondary">{viewOptionsLabel}</Button>;
  return <>
    <div className="flex flex-wrap items-end gap-sm">
      <Select label={viewModeLabel} selectedKey={model.mode} options={[{ id: "flat", label: flatModeLabel }, { id: "grouped", label: groupedModeLabel }, { id: "pivot", label: pivotModeLabel, isDisabled: !hasDimensions || !model.table.measures?.length }]} onSelectionChange={key => { if (key === "flat" || key === "grouped" || key === "pivot") change(editView(model, { mode: key, ...(key === "pivot" && !model.table.pivot ? { table: { ...model.table, pivot } } : {}) })); }} />
      <Select label={densityLabel} selectedKey={model.density} options={[{ id: "comfortable", label: comfortableDensityLabel }, { id: "compact", label: compactDensityLabel }]} onSelectionChange={key => { if (key === "comfortable" || key === "compact") change(editView(model, { density: key })); }} />
      {narrow ? <Drawer trigger={trigger} heading={viewOptionsLabel} closeLabel={closeViewOptionsLabel} placement="bottom" wide="sheet" isOpen={isOpen} onOpenChange={setIsOpen}>{controls}</Drawer>
        : <Popover trigger={trigger} isOpen={isOpen} onOpenChange={setIsOpen} className="max-w-full max-h-[85vh] overflow-auto"><Dialog.Heading>{viewOptionsLabel}</Dialog.Heading>{controls}</Popover>}
    </div>
    {groups.length || model.sort.length || (!hideFilters && filters.length) ? <div aria-label={activeRulesLabel} className="flex flex-wrap gap-xs">
      {groups.map((group, index) => <Chip key={`group:${group.column}`} removeLabel={removeGroupMessage(label(group.column))} onRemove={() => tableChange({ groupBy: without(groups, index) })}>{groupChipMessage(label(group.column))}</Chip>)}
      {model.sort.map((sort, index) => <Chip key={`sort:${sort.column}`} removeLabel={removeSortMessage(label(sort.column))} onRemove={() => change(editView(model, { sort: without(model.sort, index) }))}>{sortChipMessage(label(sort.column), sort.direction)}</Chip>)}
      {!hideFilters ? filters.map((filter, index) => <Chip key={`filter:${filter.kind === "group" ? "group" : filter.column}:${index}`} removeLabel={removeFilterMessage(filterLabel(filter), filter)} onRemove={() => tableChange({ filters: without(filters, index) })}>{filterChipMessage(filterLabel(filter), filter)}</Chip>) : null}
    </div> : null}
  </>;
}
