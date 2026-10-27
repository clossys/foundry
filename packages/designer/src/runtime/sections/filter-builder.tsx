import { useState } from "react";
import { FilterBuilder, type FilterBuilderField, type FilterBuilderGroup, type FilterBuilderOperator } from "../../blocks/FilterBuilder.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

function FilterBuilderFill({ fields, operators, groups }: { readonly fields: readonly FilterBuilderField[]; readonly operators: readonly FilterBuilderOperator[]; readonly groups: readonly FilterBuilderGroup[] }) {
  const [value, setValue] = useState(groups);
  return <FilterBuilder
    fields={fields}
    operators={operators}
    groups={value}
    onGroupsChange={setValue}
    labels={{
      legend: "Filter records", group: position => `Group ${position}`, match: "Match", matchAll: "All conditions", matchAny: "Any condition",
      field: "Field", operator: "Operator", value: "Value", addCondition: "Add condition", removeCondition: position => `Remove condition ${position}`, addGroup: "Add group",
    }}
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
