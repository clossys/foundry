import type { ReactNode } from "react";
import { Select } from "../selected-components/Select.js";
import { cx } from "../selected-components/internal/cx.js";
import type { TableColumnKind } from "./table-model/types.js";
import { useDebouncedSummary } from "./access-matrix/summary.js";
import { assertColumnMapper, columnMapperIssues, mappedSource } from "./column-mapper/issues.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.column-mapper", "foundry/sections.column-mapper");

export interface ColumnMapperTarget { readonly id: string; readonly label: string; readonly kind: TableColumnKind; readonly required: boolean; readonly description?: string }
export interface ColumnMapperSource { readonly id: string; readonly header: string; readonly samples: readonly string[] }
/** Missing target keys mean null. */
export type ColumnMapping = Readonly<Record<string, string | null>>;
export interface ColumnMapperIssue { readonly targetId: string; readonly message: ReactNode }
export interface ColumnMapperLabels {
  legend: string;
  notMapped: string;
  required: string;
  requiredMissing: (target: string) => string;
  duplicate: (header: string) => string;
  samples: (values: readonly string[]) => string;
  summary: (mapped: number, total: number, problems: number) => string;
}
export interface ColumnMapperProps {
  targets: readonly ColumnMapperTarget[];
  sourceColumns: readonly ColumnMapperSource[];
  mapping: ColumnMapping;
  onMappingChange: (next: ColumnMapping) => void;
  labels: ColumnMapperLabels;
  issues?: readonly ColumnMapperIssue[];
  className?: string;
}

/** Matches supplied source columns to targets; parsing and type rules belong to the host. */
export function ColumnMapper(props: ColumnMapperProps) {
  assertColumnMapper(props);
  const { targets, sourceColumns, mapping, onMappingChange, labels, className } = props;
  const issues = columnMapperIssues(props);
  const mapped = targets.filter(target => mappedSource(mapping, target.id) !== null).length;
  const announced = useDebouncedSummary(labels.summary(mapped, targets.length, issues.length));
  const options = [{ id: "", label: labels.notMapped }, ...sourceColumns.map(source => ({ id: source.id, label: source.header }))];
  return <fieldset {...SECTION_STAMP} className={cx("m-0 flex min-w-0 flex-col gap-lg border-0 bg-surface-raised p-0 text-body text-ink-primary", className)}>
    <legend className="mb-md text-body-l font-medium">{labels.legend}</legend>
    {targets.map(target => {
      const sourceId = mappedSource(mapping, target.id);
      const source = sourceColumns.find(column => column.id === sourceId);
      const errors = issues.filter(issue => issue.targetId === target.id);
      return <div key={target.id} className="min-w-0">
        <Select
          label={<span className="inline-flex min-w-0 flex-wrap items-baseline gap-xs"><span className="wrap-anywhere">{target.label}</span>{target.required ? <span aria-hidden="true" className="text-caption text-ink-secondary">{labels.required}</span> : null}</span>}
          isRequired={target.required} validationBehavior="aria" selectedKey={sourceId ?? ""} placeholder={labels.notMapped}
          onSelectionChange={key => { if (typeof key === "string") onMappingChange({ ...mapping, [target.id]: key === "" ? null : key }); }}
          options={options} description={source ? labels.samples(source.samples) : undefined} isInvalid={errors.length > 0}
          errorMessage={<>{errors.map((issue, index) => <span key={index} className="block">{issue.message}</span>)}</>}
        />
        {target.description ? <p className="mt-xs text-caption text-ink-secondary">{target.description}</p> : null}
      </div>;
    })}
    <span role="status" aria-live="polite" className="text-body-s text-ink-secondary">{announced}</span>
  </fieldset>;
}
