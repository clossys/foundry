import { useState } from "react";
import { ColumnMapper, type ColumnMapperSource, type ColumnMapperTarget, type ColumnMapping } from "../../blocks/ColumnMapper.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** One mapping record: which source column fills a target field, or null when it is not mapped. */
export interface ColumnMappingRecord { readonly target: string; readonly source: string | null }

function ColumnMapperFill({ targets, sourceColumns, mapping }: { readonly targets: readonly ColumnMapperTarget[]; readonly sourceColumns: readonly ColumnMapperSource[]; readonly mapping: readonly ColumnMappingRecord[] }) {
  const [value, setValue] = useState<ColumnMapping>(() => Object.fromEntries(targets.map(target => [target.id, mapping.find(row => row.target === target.id)?.source ?? null])));
  return <ColumnMapper
    targets={targets}
    sourceColumns={sourceColumns}
    mapping={value}
    onMappingChange={setValue}
    labels={{
      legend: "Match file columns to fields", notMapped: "Not mapped", required: "Required",
      requiredMissing: target => `${target} needs a column`, duplicate: header => `"${header}" is used more than once`,
      samples: values => `Examples: ${values.join(", ")}`, summary: (mapped, total, problems) => `${mapped} of ${total} fields mapped, ${problems} to fix`,
    }}
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
