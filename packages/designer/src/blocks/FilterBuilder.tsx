import { Button } from "../components/Button.js";
import { Select } from "../components/Select.js";
import { TextField } from "../components/TextField.js";
import { cx } from "../components/internal/cx.js";

export interface FilterBuilderField { readonly id: string; readonly label: string }
export interface FilterBuilderOperator {
  readonly id: string;
  readonly label: string;
  /** False for operators such as "is empty" that compare against nothing. @default true */
  readonly takesValue?: boolean;
}
export interface FilterBuilderCondition { readonly id: string; readonly field: string; readonly operator: string; readonly value: string }
export type FilterBuilderMatch = "all" | "any";
export interface FilterBuilderGroup { readonly id: string; readonly match: FilterBuilderMatch; readonly conditions: readonly FilterBuilderCondition[] }
export interface FilterBuilderLabels {
  legend: string;
  group: (position: number) => string;
  match: string;
  matchAll: string;
  matchAny: string;
  field: string;
  operator: string;
  value: string;
  addCondition: string;
  removeCondition: (position: number) => string;
  addGroup: string;
}
export interface FilterBuilderProps {
  /** Fields a condition can test. The first is the default for a new condition. */
  fields: readonly FilterBuilderField[];
  /** Operators a condition can apply. The first is the default for a new condition. */
  operators: readonly FilterBuilderOperator[];
  /** Controlled condition groups; groups combine with each other as "all". */
  groups: readonly FilterBuilderGroup[];
  onGroupsChange: (next: readonly FilterBuilderGroup[]) => void;
  labels: FilterBuilderLabels;
  className?: string;
}

/** The first `prefix-N` id not already used. Deterministic, so server and client agree. */
function nextId(prefix: string, used: readonly string[]): string {
  for (let index = used.length + 1; ; index += 1) if (!used.includes(`${prefix}-${index}`)) return `${prefix}-${index}`;
}

/** Edits host-owned condition groups; evaluating them against records belongs to the host. */
export function FilterBuilder({ fields, operators, groups, onGroupsChange, labels, className }: FilterBuilderProps) {
  if (!fields.length || !operators.length) throw new TypeError("FilterBuilder: fields and operators must not be empty.");
  for (const group of groups) for (const condition of group.conditions) {
    if (!fields.some(field => field.id === condition.field)) throw new TypeError(`FilterBuilder: unknown field ${condition.field}.`);
    if (!operators.some(operator => operator.id === condition.operator)) throw new TypeError(`FilterBuilder: unknown operator ${condition.operator}.`);
  }
  const allIds = groups.flatMap(group => [group.id, ...group.conditions.map(condition => condition.id)]);
  const blank = (group: string, used: readonly string[]): FilterBuilderCondition => ({ id: nextId(group, used), field: fields[0]!.id, operator: operators[0]!.id, value: "" });
  const replace = (groupId: string, change: (group: FilterBuilderGroup) => FilterBuilderGroup) => onGroupsChange(groups.map(group => group.id === groupId ? change(group) : group));
  const update = (groupId: string, conditionId: string, patch: Partial<FilterBuilderCondition>) =>
    replace(groupId, group => ({ ...group, conditions: group.conditions.map(condition => condition.id === conditionId ? { ...condition, ...patch } : condition) }));
  const fieldOptions = fields.map(field => ({ id: field.id, label: field.label }));
  const operatorOptions = operators.map(operator => ({ id: operator.id, label: operator.label }));
  return <fieldset className={cx("m-0 flex min-w-0 flex-col gap-lg border-0 p-0 text-body text-ink-primary", className)}>
    <legend className="mb-md text-body-l font-medium">{labels.legend}</legend>
    {groups.map((group, groupIndex) => <div key={group.id} role="group" aria-label={labels.group(groupIndex + 1)} className="flex min-w-0 flex-col gap-md rounded-surface border border-line-base bg-surface-raised p-md">
      <Select label={labels.match} size="sm" className="filter-match-width" selectedKey={group.match}
        options={[{ id: "all", label: labels.matchAll }, { id: "any", label: labels.matchAny }]}
        onSelectionChange={key => { if (key === "all" || key === "any") replace(group.id, current => ({ ...current, match: key })); }} />
      <ol className="m-0 flex list-none flex-col gap-sm p-0">
        {group.conditions.map((condition, conditionIndex) => {
          const takesValue = operators.find(operator => operator.id === condition.operator)?.takesValue !== false;
          return <li key={condition.id} className="grid grid-cols-1 items-end gap-sm tablet:grid-cols-4">
            <Select label={labels.field} size="sm" selectedKey={condition.field} options={fieldOptions}
              onSelectionChange={key => { if (typeof key === "string") update(group.id, condition.id, { field: key }); }} />
            <Select label={labels.operator} size="sm" selectedKey={condition.operator} options={operatorOptions}
              onSelectionChange={key => { if (typeof key === "string") update(group.id, condition.id, { operator: key }); }} />
            {takesValue ? <TextField label={labels.value} size="sm" value={condition.value} onChange={value => update(group.id, condition.id, { value })} /> : <span aria-hidden="true" />}
            <Button variant="quiet" size="sm" onPress={() => replace(group.id, current => ({ ...current, conditions: current.conditions.filter(row => row.id !== condition.id) }))}>
              {labels.removeCondition(conditionIndex + 1)}
            </Button>
          </li>;
        })}
      </ol>
      <div><Button variant="secondary" size="sm" onPress={() => replace(group.id, current => ({ ...current, conditions: [...current.conditions, blank(current.id, allIds)] }))}>{labels.addCondition}</Button></div>
    </div>)}
    <div><Button variant="outline" size="sm" onPress={() => {
      const id = nextId("group", allIds);
      onGroupsChange([...groups, { id, match: "all", conditions: [blank(id, allIds)] }]);
    }}>{labels.addGroup}</Button></div>
  </fieldset>;
}
