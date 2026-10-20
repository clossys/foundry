import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../../atoms/Button.js";
import { Badge } from "../../atoms/Badge.js";
import type { CatalogWorkspaceItem } from "./types.js";
import type { catalogIndex } from "./model.js";

type Index = ReturnType<typeof catalogIndex>;
interface RowProps {
  item: CatalogWorkspaceItem;
  level: number;
  position: number;
  count: number;
  expanded: ReadonlySet<string>;
  active: string | undefined;
  selectedId: string | null;
  activate: (item: CatalogWorkspaceItem) => void;
  focus: (id: string) => void;
  keyDown: (event: KeyboardEvent, item: CatalogWorkspaceItem) => void;
  register: (id: string, element: HTMLButtonElement | null) => void;
}
/** Internal tree rows; Button supplies native pointer and Enter/Space press semantics. */
function Row(props: RowProps) {
  const { item, expanded, active, selectedId, activate, focus, keyDown, register, level, position, count } = props;
  const rowId = useId();
  const groupId = useId();
  const descriptionId = useId();
  const group = item.children !== undefined;
  const open = group && expanded.has(item.id);
  return <div role="none">
    <div role="none" ref={element => { register(item.id, element?.querySelector<HTMLButtonElement>("button") ?? null); }}>
      <Button id={rowId} variant={!group && selectedId === item.id ? "secondary" : "ghost"} className="w-full justify-start gap-sm text-start"
        aria-label={item.label} aria-describedby={descriptionId}
        render={domProps => <button {...domProps} role="treeitem" tabIndex={active === item.id ? 0 : -1}
          aria-level={level} aria-posinset={position} aria-setsize={count}
          aria-expanded={group ? open : undefined} aria-selected={group ? undefined : selectedId === item.id}
          aria-owns={group ? groupId : undefined} />}
        onFocus={() => focus(item.id)}
        onKeyDown={event => keyDown(event, item)} onPress={() => activate(item)}>
        {group ? <span aria-hidden="true">{open ? "−" : "+"}</span> : null}
        <span>{item.label}</span>
        <span id={descriptionId} className="text-caption text-ink-secondary">{item.kind}{item.tag ? ` · ${item.tag}` : ""}</span>
        {item.badge ? <Badge>{item.badge}</Badge> : null}
      </Button>
    </div>
    {group ? <div role="group" id={groupId} aria-labelledby={rowId} hidden={!open} className="ps-md">
      {item.children!.map((child, index) => <Row {...props} key={child.id} item={child} level={level + 1} position={index + 1} count={item.children!.length} />)}
    </div> : null}
  </div>;
}
export function Browse({ items, index, selectedId, onSelect, label }: {
  items: readonly CatalogWorkspaceItem[]; index: Index; selectedId: string | null; onSelect: (id: string) => void; label: string;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focused, setFocused] = useState<string>();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const ownsFocus = useRef(false);
  const visible: CatalogWorkspaceItem[] = [];
  const visit = (list: readonly CatalogWorkspaceItem[]) => { for (const item of list) { visible.push(item); if (expanded.has(item.id) && item.children) visit(item.children); } };
  visit(items);
  const active = visible.some(item => item.id === focused) ? focused : visible[0]?.id;
  const move = (id: string) => { setFocused(id); buttons.current.get(id)?.focus(); };
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const activate = (item: CatalogWorkspaceItem) => { move(item.id); if (item.children !== undefined) toggle(item.id); else onSelect(item.id); };
  const keyDown = (event: KeyboardEvent, item: CatalogWorkspaceItem) => {
    const position = visible.findIndex(node => node.id === item.id);
    let destination: string | undefined;
    if (event.key === "ArrowDown") destination = visible[Math.min(visible.length - 1, position + 1)]?.id;
    else if (event.key === "ArrowUp") destination = visible[Math.max(0, position - 1)]?.id;
    else if (event.key === "Home") destination = visible[0]?.id;
    else if (event.key === "End") destination = visible.at(-1)?.id;
    else if (event.key === "ArrowRight") {
      if (item.children !== undefined && !expanded.has(item.id)) toggle(item.id);
      else destination = item.children?.[0]?.id;
    } else if (event.key === "ArrowLeft") {
      if (item.children !== undefined && expanded.has(item.id)) toggle(item.id);
      else destination = index.parents.get(item.id);
    } else return;
    event.preventDefault(); event.stopPropagation(); if (destination !== undefined) move(destination);
  };
  useLayoutEffect(() => {
    if (ownsFocus.current && active !== undefined) buttons.current.get(active)?.focus();
  }, [active]);
  const register = (id: string, element: HTMLButtonElement | null) => { if (element) buttons.current.set(id, element); else buttons.current.delete(id); };
  if (items.length === 0) return null;
  return <div role="tree" aria-label={label} onFocusCapture={() => { ownsFocus.current = true; }} onBlurCapture={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) ownsFocus.current = false;
  }}>
    {items.map((item, position) => <Row key={item.id} item={item} level={1} position={position + 1} count={items.length}
      expanded={expanded} active={active} selectedId={selectedId} activate={activate} focus={setFocused} keyDown={keyDown} register={register} />)}
  </div>;
}
