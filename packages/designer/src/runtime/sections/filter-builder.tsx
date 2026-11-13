import { useState } from "react";
import { FilterBuilder, type FilterBuilderField, type FilterBuilderGroup, type FilterBuilderOperator } from "../../blocks/FilterBuilder.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

function FilterBuilderFill({ fields, operators, groups }: { readonly fields: readonly FilterBuilderField[]; readonly operators: readonly FilterBuilderOperator[]; readonly groups: readonly FilterBuilderGroup[] }) {
  const [value, setValue] = useState(groups);
  return <FilterBuilder
    fields={fields}
    operators={operators}
    groups={value}
    onGroupsChange={setValue}
    labels={specimenDataset.sections.filterBuilder.labels}
  />;
}

/** sections.filter-builder: condition groups of field, operator and value controls. */
export function renderFilterBuilder(input: SectionRenderInput) {
  return <FilterBuilderFill
    fields={recordsOf<FilterBuilderField>(input, "fields")}
    operators={recordsOf<FilterBuilderOperator>(input, "operators")}
    groups={recordsOf<FilterBuilderGroup>(input, "groups")}
  />;
}

export const filterBuilderSection: GroupBSection = { leaf: "sections.filter-builder", slots: ["fields", "groups", "operators"], render: renderFilterBuilder };
