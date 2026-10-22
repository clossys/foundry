import { Badge } from "../../atoms/Badge.js";
import { Explorer } from "../Explorer.js";
import type { CatalogWorkspaceItem } from "./types.js";
import type { catalogIndex } from "./model.js";

/** Catalog metadata and controlled selection compose the public Explorer. */
export function Browse({ items, index, selectedId, onSelect, label, defaultExpandedIds = [] }: {
  items: readonly CatalogWorkspaceItem[]; index: ReturnType<typeof catalogIndex>;
  selectedId: string | null; onSelect: (id: string) => void; label: string; defaultExpandedIds?: readonly string[];
}) {
  if (!items.length) return null;
  const candidate = selectedId === null ? undefined : index.nodes.get(selectedId);
  const selection = candidate?.children === undefined ? candidate?.id : null;
  // Explorer reads its default disclosure once; a new list remounts it so the change applies.
  return <Explorer key={JSON.stringify(defaultExpandedIds)} defaultExpandedIds={defaultExpandedIds} tree={items} selectedId={selection} onSelect={id => {
    const item = index.nodes.get(id); if (item && item.children === undefined) onSelect(id);
  }} label={label}
    renderDetails={item => <><span>{item.kind}{item.tag ? ` · ${item.tag}` : ""}</span>{item.badge ? <> <Badge>{item.badge}</Badge></> : null}</>} />;
}
