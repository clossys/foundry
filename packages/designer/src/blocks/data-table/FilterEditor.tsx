import { defaultMinimumMessage, defaultMaximumMessage, defaultApplyRangeMessage, defaultComparisonMessage, defaultFilterValueMessage, defaultMatchingMessage, defaultBooleanFilterMessage, defaultFacetValueMessage, type DataTableMessages } from "./messages.js";
import { useEffect, useState } from "react";
import { Button } from "../../atoms/Button.js";
import { Checkbox } from "../../atoms/Checkbox.js";
import { Select } from "../../atoms/Select.js";
import { TextField } from "../../atoms/TextField.js";
import type { TableFacet, TableFilter } from "../table-model/index.js";
import { dateValue } from "../table-model/model.js";

type RangeFilter = Extract<TableFilter, { kind: "number" | "date" }>;
function RangeEditor({
  /** @default column => `Minimum ${column}` */
  minimumMessage = defaultMinimumMessage,
  /** @default column => `Maximum ${column}` */
  maximumMessage = defaultMaximumMessage,
  /** @default column => `Apply ${column} range` */
  applyRangeMessage = defaultApplyRangeMessage,
  /** @default "Enter valid bounds with minimum no greater than maximum." */
  invalidRangeLabel = "Enter valid bounds with minimum no greater than maximum.",
  /** @default "UTC: YYYY-MM-DD or a canonical ISO timestamp." */
  dateHintLabel = "UTC: YYYY-MM-DD or a canonical ISO timestamp.",
  filter, label, change,
}: DataTableMessages & { filter: RangeFilter; label: string; change: (filter: TableFilter) => void }) {
  const [min, setMin] = useState(filter.kind === "date" && Number.isFinite(filter.min) ? dateValue(filter.min, "invalid-model") : String(filter.min ?? ""));
  const [max, setMax] = useState(filter.kind === "date" && Number.isFinite(filter.max) ? dateValue(filter.max, "invalid-model") : String(filter.max ?? ""));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setMin(filter.kind === "date" && Number.isFinite(filter.min) ? dateValue(filter.min, "invalid-model") : String(filter.min ?? ""));
    setMax(filter.kind === "date" && Number.isFinite(filter.max) ? dateValue(filter.max, "invalid-model") : String(filter.max ?? ""));
    setInvalid(false);
  }, [filter.kind, filter.min, filter.max]);
  const apply = () => {
    const number = (text: string) => filter.kind === "number" ? Number(text) : Date.parse(text);
    const valid = (text: string) => !text || (Number.isFinite(number(text)) && (filter.kind === "number" || new Date(text).toISOString() === text || /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text).toISOString() === text + "T00:00:00.000Z"));
    if (!valid(min) || !valid(max) || (min && max && number(min) > number(max))) { setInvalid(true); return; }
    setInvalid(false);
    const bounds = { ...(min ? { min: filter.kind === "number" ? Number(min) : min } : {}), ...(max ? { max: filter.kind === "number" ? Number(max) : max } : {}) };
    change({ column: filter.column, kind: filter.kind, op: "range", ...bounds } as RangeFilter);
  };
  return <div className="flex flex-col gap-sm">
    <TextField label={minimumMessage(label)} value={min} onChange={setMin} isInvalid={invalid} errorMessage={invalidRangeLabel} description={filter.kind === "date" ? <span>{dateHintLabel}</span> : undefined} />
    <TextField label={maximumMessage(label)} value={max} onChange={setMax} isInvalid={invalid} errorMessage={invalidRangeLabel} />
    <Button variant="secondary" onPress={apply}>{applyRangeMessage(label)}</Button>
  </div>;
}
export function FilterEditor({
  /** @default column => `${column} comparison` */
  comparisonMessage = defaultComparisonMessage,
  /** @default column => `${column} value` */
  filterValueMessage = defaultFilterValueMessage,
  /** @default column => `${column} matching` */
  matchingMessage = defaultMatchingMessage,
  /** @default column => `${column} is true` */
  booleanFilterMessage = defaultBooleanFilterMessage,
  /** @default (column, value) => `${column}: ${value}` */
  facetValueMessage = defaultFacetValueMessage,
  /** @default "No values in the current data." */
  noFacetValuesLabel = "No values in the current data.",
  /** @default "Contains" */
  containsLabel = "Contains",
  /** @default "Equals" */
  equalsLabel = "Equals",
  /** @default "Any" */
  anyTagsLabel = "Any",
  /** @default "All" */
  allTagsLabel = "All",
  /** @default "None" */
  noTagsLabel = "None",
  filter, label, facets, change, messages,
}: DataTableMessages & { filter: TableFilter; label: string; facets: readonly TableFacet[]; change: (filter: TableFilter) => void; messages?: DataTableMessages }) {
  if (filter.kind === "number" || filter.kind === "date") return <RangeEditor {...messages} filter={filter} label={label} change={change} />;
  if (filter.kind === "text") return <>
    <Select label={comparisonMessage(label)} selectedKey={filter.op} options={[{ id: "contains", label: containsLabel }, { id: "equals", label: equalsLabel }]} onSelectionChange={key => { if (key === "contains" || key === "equals") change({ ...filter, op: key }); }} />
    <TextField label={filterValueMessage(label)} value={filter.value} onChange={value => change({ ...filter, value })} />
  </>;
  if (filter.kind === "boolean") return <Checkbox isSelected={filter.value} onChange={value => change({ ...filter, value })}>{booleanFilterMessage(label)}</Checkbox>;
  const values = [...new Set([...facets.flatMap(facet => typeof facet.value === "string" ? [facet.value] : []), ...filter.values])];
  return <div className="flex flex-col gap-sm">
    {filter.kind === "tags" ? <Select label={matchingMessage(label)} selectedKey={filter.op} options={[{ id: "any", label: anyTagsLabel }, { id: "all", label: allTagsLabel }, { id: "none", label: noTagsLabel }]} onSelectionChange={key => { if (key === "any" || key === "all" || key === "none") change({ ...filter, op: key }); }} /> : null}
    {values.map(value => <Checkbox key={value} isSelected={filter.values.includes(value)} onChange={checked => change({ ...filter, values: checked ? [...filter.values, value] : filter.values.filter(item => item !== value) })}>{facetValueMessage(label, value)}</Checkbox>)}
    {!values.length ? <p className="text-body-s text-ink-muted">{noFacetValuesLabel}</p> : null}
  </div>;
}
