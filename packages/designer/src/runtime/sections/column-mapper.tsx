import { useState } from "react";
import { ColumnMapper, type ColumnMapperSource, type ColumnMapperTarget, type ColumnMapping } from "../../blocks/ColumnMapper.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/** One mapping record: which source column fills a target field, or null when it is not mapped. */
export interface ColumnMappingRecord { readonly target: string; readonly source: string | null }

function ColumnMapperFill({ targets, sourceColumns, mapping }: { readonly targets: readonly ColumnMapperTarget[]; readonly sourceColumns: readonly ColumnMapperSource[]; readonly mapping: readonly ColumnMappingRecord[] }) {
  const [value, setValue] = useState<ColumnMapping>(() => Object.fromEntries(targets.map(target => [target.id, mapping.find(row => row.target === target.id)?.source ?? null])));
  return <ColumnMapper
    targets={targets}
    sourceColumns={sourceColumns}
    mapping={value}
    onMappingChange={setValue}
    labels={specimenDataset.sections.columnMapper.labels}
  />;
}

/** sections.column-mapper: each target field gets a Select of the source columns. */
export function renderColumnMapper(input: SectionRenderInput) {
  return <ColumnMapperFill
    targets={recordsOf<ColumnMapperTarget>(input, "target-fields")}
    sourceColumns={recordsOf<ColumnMapperSource>(input, "source-columns")}
    mapping={recordsOf<ColumnMappingRecord>(input, "mapping")}
  />;
}

export const columnMapperSection: GroupBSection = { leaf: "sections.column-mapper", slots: ["mapping", "source-columns", "target-fields"], render: renderColumnMapper };
