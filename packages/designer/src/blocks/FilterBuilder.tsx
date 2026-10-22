import { useState } from "react";
import { cx } from "../atoms/internal/cx.js";
import type { TableFilter, TableFilterResult, TableModel, TableValue } from "./table-model/index.js";
import { parseTableModel } from "./table-model/index.js";
import { FilterBar } from "./filter-builder/bar.js";
import { AdvancedFilters } from "./filter-builder/advanced.js";
import { FilterAnnouncement } from "./filter-builder/announce.js";
import { needsVersionTwo } from "./filter-builder/draft.js";

export interface FilterBuilderLabels {
  region: string; addFilter: string; clearAll: string; advanced: string; apply: string; cancel: string;
  describe: (column: string, filter: TableFilter, valueText: string) => string;
  describeGroup: (op: "and" | "or", count: number) => string;
  remove: (sentence: string) => string;
  operators: Record<TableFilter["op"], string>;
  connective: { and: string; or: string };
  matchLabel: string; columnLabel: string; operatorLabel: string; valueLabel: string;
  addCondition: string; addGroup: string; removeCondition: (sentence: string) => string;
  min: string; max: string; invalidRange: string; dateHint: string; valueRequired: string; noValues: string; yes: string; no: string;
  resultCount: (count: number) => string;
  /** Visible reason when the root Any wrapper consumes the remaining group depth. */
  depthLimit: string;
  /** Visible reason why a deep All draft cannot switch to Any. */
  simplifyGroups: string;
}
export interface FilterBuilderProps {
  model: TableModel;
  onChange: (next: TableModel) => void;
  columnLabels: Readonly<Record<string, string>>;
  facets: TableFilterResult<unknown>["facets"];
  labels: FilterBuilderLabels;
  formatValue?: (column: string, value: TableValue) => string;
  resultCount?: number;
  /** Omission selects the bar; 2 enables the advanced draft dialog. */
  maxDepth?: 0 | 2;
  className?: string;
}

/** Draft TableModel filter controls. Copy and value formatting belong to the host. */
export function FilterBuilder(props: FilterBuilderProps) {
  const [applied, setApplied] = useState(0);
  const apply: FilterBuilderProps["onChange"] = next => {
    const filters = next.filters ?? [];
    const model = { ...props.model, filters, version: needsVersionTwo(filters) ? 2 as const : props.model.version };
    // The existing engine remains the authority for saved-view validity.
    parseTableModel(model);
    props.onChange(model);
    setApplied(value => value + 1);
  };
  return <div className={cx("flex min-w-0 max-w-full flex-col gap-sm", props.className)}>
    <FilterBar {...props} onChange={apply} advanced={props.maxDepth === 2 ? <AdvancedFilters {...props} onChange={apply} /> : undefined} />
    <FilterAnnouncement filters={props.model.filters} applied={applied} resultCount={props.resultCount} resultMessage={props.labels.resultCount} />
  </div>;
}
