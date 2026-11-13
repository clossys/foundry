import type { FilterBuilderProps } from "../FilterBuilder.js";

export const filterBuilderSample: FilterBuilderProps = {
  fields: [{ id: "status", label: "Status" }, { id: "owner", label: "Owner" }, { id: "updated", label: "Last updated" }],
  operators: [{ id: "is", label: "is" }, { id: "is-not", label: "is not" }, { id: "contains", label: "contains" }, { id: "empty", label: "is empty", takesValue: false }],
  groups: [
    { id: "group-1", match: "all", conditions: [{ id: "group-1-1", field: "status", operator: "is", value: "Active" }] },
    { id: "group-2", match: "any", conditions: [{ id: "group-2-1", field: "owner", operator: "contains", value: "Park" }, { id: "group-2-2", field: "updated", operator: "empty", value: "" }] },
  ],
  onGroupsChange: () => {},
  labels: {
    legend: "Filter records", group: position => `Group ${position}`, match: "Match", matchAll: "All conditions", matchAny: "Any condition",
    field: "Field", operator: "Operator", value: "Value", addCondition: "Add condition", removeCondition: position => `Remove condition ${position}`, addGroup: "Add group",
  },
};
