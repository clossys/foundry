import { useState } from "react";
import { Badge } from "../../atoms/Badge.js";
import { Explorer } from "../Explorer.js";
import type { CatalogWorkspaceItem } from "./types.js";
import type { catalogIndex } from "./model.js";

/** Catalog metadata and controlled selection compose the public Explorer. */
export function Browse({ items, index, selectedId, onSelect, label, defaultExpandedIds = [] }: {
  items: readonly CatalogWorkspaceItem[]; index: ReturnType<typeof catalogIndex>;
  selectedId: string | null; onSelect: (id: string) => void; label: string; defaultExpandedIds?: readonly string[];
}) {
  // Explorer reads its default disclosure once, so a list that gains an id remounts it to apply the list. A list that
  // only drops ids keeps the mounted tree, with its disclosure and keyboard focus.
  const [disclosure, setDisclosure] = useState({ ids: defaultExpandedIds, generation: 0 });
  const previous = new Set(disclosure.ids); const next = new Set(defaultExpandedIds);
  const gains = [...next].some(id => !previous.has(id));
  if (gains || [...previous].some(id => !next.has(id))) setDisclosure({ ids: defaultExpandedIds, generation: disclosure.generation + (gains ? 1 : 0) });
  if (!items.length) return null;
  const candidate = selectedId === null ? undefined : index.nodes.get(selectedId);
  const selection = candidate?.children === undefined ? candidate?.id : null;
  return <Explorer key={disclosure.generation} defaultExpandedIds={defaultExpandedIds} tree={items} selectedId={selection} onSelect={id => {
    const item = index.nodes.get(id); if (item && item.children === undefined) onSelect(id);
  }} label={label}
    renderDetails={item => <><span>{item.kind}{item.tag ? ` · ${item.tag}` : ""}</span>{item.badge ? <> <Badge>{item.badge}</Badge></> : null}</>} />;
}
