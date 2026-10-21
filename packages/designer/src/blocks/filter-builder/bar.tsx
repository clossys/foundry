import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../../atoms/Button.js";
import { Chip } from "../../atoms/Chip.js";
import { Menu } from "../../atoms/Menu.js";
import { Popover } from "../../atoms/Popover.js";
import type { FilterBuilderProps } from "../FilterBuilder.js";
import type { TableFilter } from "../table-model/index.js";
import { complete, newCondition, nextFilters, sentence } from "./draft.js";
import { AdvancedFilters } from "./advanced.js";
import { ConditionEditor } from "./editor.js";

type Editing = { key: number; index: number; filter: TableFilter; fresh: boolean };
export function FilterBar({ advanced, ...props }: FilterBuilderProps & { advanced?: ReactNode }) {
  const { model, labels, onChange } = props;
  const nodes = model.filters ?? [];
  const prefix = useId(); const root = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0); const keys = useRef<number[]>([]);
  while (keys.current.length < nodes.length) keys.current.push(nextKey.current++);
  keys.current.length = nodes.length;
  const [editing, setEditing] = useState<Editing | null>(null);
  const addId = `${prefix}-add`;
  const bodyId = (key: number) => `${prefix}-chip-${key}`;
  const focus = (id: string) => queueMicrotask(() => root.current?.querySelector<HTMLButtonElement>(`[id=${JSON.stringify(id)}]`)?.focus());
  const remove = (index: number) => {
    const bodies = nodes.flatMap((node, i) => i !== index && (node.kind !== "group" || props.maxDepth === 2) ? [{ index: i, key: keys.current[i]! }] : []);
    const target = (bodies.find(item => item.index > index) ?? [...bodies].reverse().find(item => item.index < index))?.key;
    keys.current = keys.current.filter((_, i) => i !== index); setEditing(null);
    onChange(nextFilters(model, nodes.filter((_, i) => i !== index)));
    focus(target === undefined ? addId : bodyId(target));
  };
  const update = (filter: TableFilter) => {
    if (!editing) return;
    const valid = complete(filter);
    setEditing({ ...editing, filter, fresh: editing.fresh && !valid });
    if (!valid) return;
    if (editing.fresh) keys.current.push(editing.key);
    onChange(nextFilters(model, editing.fresh ? [...nodes, filter] : nodes.map((node, index) => index === editing.index ? filter : node)));
  };
  const items = [...nodes.map((node, index) => ({ node, key: keys.current[index]!, index, fresh: false })), ...(editing?.fresh ? [{ node: editing.filter, key: editing.key, index: nodes.length, fresh: true }] : [])];
  return <div ref={root} role="group" aria-label={labels.region} className="flex min-w-0 max-w-full flex-wrap items-center gap-xs">
    {items.map(({ node, key, index, fresh }) => {
      const name = sentence(node, props);
      const body = <Button id={bodyId(key)} variant="ghost" size="sm" className="min-w-0 max-w-full whitespace-normal text-start" onKeyDown={event => {
        if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (fresh) { setEditing(null); focus(addId); } else remove(index); }
      }}>{name}</Button>;
      return <Chip key={key} onRemove={() => fresh ? (setEditing(null), focus(addId)) : remove(index)} removeLabel={labels.remove(name)}>
        {node.kind === "group" ? (props.maxDepth === 2 ? <AdvancedFilters {...props} trigger={body} /> : <span>{name}</span>) : <Popover trigger={body} aria-label={name} isOpen={editing?.key === key}
          onOpenChange={open => setEditing(open ? { key, index, filter: node, fresh } : null)} className="box-border max-w-full overflow-auto">
          <ConditionEditor {...props} filter={editing?.key === key ? editing.filter : node} change={update} />
        </Popover>}
      </Chip>;
    })}
    <Menu trigger={<Button id={addId} variant="secondary" size="sm">{labels.addFilter}</Button>}>
      {Object.entries(props.columnLabels).filter(([id]) => model.columns.some(column => column.id === id)).map(([id, label]) => <Menu.Item key={id} id={id} onAction={() => {
        const filter = newCondition(model.columns.find(column => column.id === id)!);
        const key = nextKey.current++;
        const valid = complete(filter);
        if (valid) { keys.current.push(key); onChange(nextFilters(model, [...nodes, filter])); }
        setEditing({ key, index: nodes.length, filter, fresh: !valid });
      }}>{label}</Menu.Item>)}
    </Menu>
    {nodes.length >= 2 ? <Button variant="ghost" size="sm" onPress={() => { keys.current = []; setEditing(null); onChange(nextFilters(model, [])); focus(addId); }}>{labels.clearAll}</Button> : null}
    {advanced}
  </div>;
}
