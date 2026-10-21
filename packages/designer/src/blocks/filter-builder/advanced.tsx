import { useId, useState, type ReactNode } from "react";
import { Button } from "../../atoms/Button.js";
import { Dialog } from "../../atoms/Dialog.js";
import { IconButton } from "../../atoms/IconButton.js";
import { RadioGroup } from "../../atoms/RadioGroup.js";
import { Select } from "../../atoms/Select.js";
import { X } from "../../icons/X.js";
import type { FilterBuilderProps } from "../FilterBuilder.js";
import type { TableFilterGroup, TableFilterNode } from "../table-model/index.js";
import { complete, groupLevels, newCondition, nextFilters, sentence } from "./draft.js";
import { ConditionEditor } from "./editor.js";

function DraftGroup({ items, change, depth, rootAny, ...props }: FilterBuilderProps & { items: readonly TableFilterNode[]; change: (items: readonly TableFilterNode[]) => void; depth: number; rootAny: boolean }) {
  const { labels } = props; const id = useId();
  const columns = Object.entries(props.columnLabels).flatMap(([id, label]) => { const column = props.model.columns.find(column => column.id === id); return column ? [{ id, label, column }] : []; });
  const limited = rootAny && depth >= 1;
  return <div className="flex min-w-0 max-w-full flex-col gap-sm">
    {items.map((node, index) => {
      const replace = (next: TableFilterNode) => change(items.map((item, i) => i === index ? next : item));
      const remove = () => change(items.filter((_, i) => i !== index));
      return node.kind === "group" ? <div key={index} role="group" aria-labelledby={`${id}-${index}`} className="flex min-w-0 max-w-full flex-col gap-sm rounded-control border border-line-base p-sm">
        <div className="flex flex-wrap items-end gap-sm">
          <span id={`${id}-${index}`} className="text-body-s text-ink-primary">{labels.connective[node.op]}</span>
          <Select label={labels.matchLabel} selectedKey={node.op} options={(["and", "or"] as const).map(id => ({ id, label: labels.connective[id] }))} onSelectionChange={op => { if (op === "and" || op === "or") replace({ ...node, op }); }} />
          <IconButton icon={X} label={labels.removeCondition(sentence(node, props))} onPress={remove} />
        </div>
        <DraftGroup {...props} items={node.items} change={items => replace({ ...node, items })} depth={depth + 1} rootAny={rootAny} />
      </div> : <div key={index} className="flex min-w-0 max-w-full flex-col gap-sm rounded-control border border-line-base p-sm">
        <div className="flex flex-wrap items-end gap-sm">
          <Select className="min-w-0 max-w-full" label={labels.columnLabel} selectedKey={node.column} options={columns} onSelectionChange={id => { const column = columns.find(column => column.id === id); if (column) replace(newCondition(column.column)); }} />
          <IconButton icon={X} label={labels.removeCondition(sentence(node, props))} onPress={remove} />
        </div>
        <ConditionEditor {...props} filter={node} change={replace} />
      </div>;
    })}
    <div className="flex flex-wrap gap-xs">
      <Button variant="secondary" size="sm" isDisabled={!columns.length} onPress={() => { if (columns[0]) change([...items, newCondition(columns[0].column)]); }}>{labels.addCondition}</Button>
      {depth < 2 ? <Button variant="secondary" size="sm" isDisabled={limited} aria-describedby={limited ? `${id}-limit` : undefined} onPress={() => {
        if (!limited) change([...items, { kind: "group", op: "and", items: [] }]);
      }}>{labels.addGroup}</Button> : null}
    </div>
    {limited ? <p id={`${id}-limit`} className="text-body-s text-ink-muted">{labels.depthLimit}</p> : null}
  </div>;
}

function Draft({ close, ...props }: FilterBuilderProps & { close: () => void }) {
  const filters = props.model.filters ?? [];
  const root = filters.length === 1 && filters[0]?.kind === "group" && filters[0].op === "or" ? filters[0] : undefined;
  const [op, setOp] = useState<"and" | "or">(root ? "or" : "and");
  const [items, setItems] = useState<readonly TableFilterNode[]>(root?.items ?? filters);
  const id = useId(); const cannotAny = groupLevels(items) > 1;
  const apply = () => {
    if (!items.every(complete) || (op === "or" && cannotAny)) return;
    const filters = op === "or" ? [{ kind: "group", op: "or", items } satisfies TableFilterGroup] : items;
    props.onChange(nextFilters(props.model, filters)); close();
  };
  return <>
    <Dialog.Heading>{props.labels.advanced}</Dialog.Heading>
    <RadioGroup label={props.labels.matchLabel} orientation="horizontal" value={op} onChange={value => { if (value === "and" || value === "or" && !cannotAny) setOp(value); }}>
      <RadioGroup.Radio value="and">{props.labels.connective.and}</RadioGroup.Radio>
      <RadioGroup.Radio value="or" isDisabled={cannotAny} aria-describedby={cannotAny ? id : undefined}>{props.labels.connective.or}</RadioGroup.Radio>
    </RadioGroup>
    {cannotAny ? <p id={id} className="text-body-s text-ink-muted">{props.labels.simplifyGroups}</p> : null}
    <DraftGroup {...props} items={items} change={setItems} depth={0} rootAny={op === "or"} />
    <div className="flex flex-wrap justify-end gap-sm">
      <Button variant="ghost" onPress={close}>{props.labels.cancel}</Button>
      <Button onPress={apply}>{props.labels.apply}</Button>
    </div>
  </>;
}
export function AdvancedFilters({ trigger, ...props }: FilterBuilderProps & { trigger?: ReactNode }) {
  return <Dialog size="md" trigger={trigger ?? <Button variant="secondary" size="sm">{props.labels.advanced}</Button>}>
    {({ close }) => <Draft {...props} close={close} />}
  </Dialog>;
}
