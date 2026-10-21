import { FilterEditor } from "../data-table/FilterEditor.js";
import type { FilterBuilderProps } from "../FilterBuilder.js";
import type { TableFilter } from "../table-model/index.js";
import { complete, operatorsFor } from "./draft.js";

export function ConditionEditor({ filter, change, ...props }: Pick<FilterBuilderProps, "labels" | "columnLabels" | "facets" | "formatValue"> & { filter: TableFilter; change: (filter: TableFilter) => void }) {
  const { labels } = props;
  const messages = {
    minimumMessage: () => labels.min, maximumMessage: () => labels.max, applyRangeMessage: () => labels.apply,
    invalidRangeLabel: labels.invalidRange, dateHintLabel: labels.dateHint,
    comparisonMessage: () => labels.operatorLabel, matchingMessage: () => labels.operatorLabel,
    filterValueMessage: () => labels.valueLabel, booleanFilterMessage: () => "value" in filter && filter.value === false ? labels.no : labels.yes,
    facetValueMessage: (_column: string, value: string) => props.formatValue?.(filter.column, value) ?? String(value),
    noFacetValuesLabel: labels.noValues, containsLabel: labels.operators.contains, equalsLabel: labels.operators.equals,
    anyTagsLabel: labels.operators.any, allTagsLabel: labels.operators.all, noTagsLabel: labels.operators.none,
  };
  return <div className="flex min-w-0 max-w-full flex-col gap-sm">
    <FilterEditor {...messages} messages={messages} filter={filter} label={props.columnLabels[filter.column] ?? filter.column} facets={props.facets[filter.column] ?? []} change={change}
      operatorOptions={operatorsFor(filter.kind).map(id => ({ id, label: labels.operators[id] }))} operatorLabel={labels.operatorLabel} />
    {!complete(filter) ? <p className="bg-surface-raised text-body-s text-status-danger-text">{labels.valueRequired}</p> : null}
  </div>;
}
