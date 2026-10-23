"use client";

import { useRef, useState, type ReactElement } from "react";
import type { Placement } from "../catalog-core/index.js";
import { TreeView } from "../atoms/TreeView.js";
import { nodeOptions, type SlotTreeNode } from "./model.js";

/** The layer and the placement nodes that hold a slot, read from the placement files, so the tree opens on it. No id is split. */
const branchesAbove = (placements: readonly Placement[], slotId: string): string[] =>
  placements.flatMap((placement) => {
    const nodes = nodeOptions([placement], slotId);
    return nodes.length > 0 ? [placement.layer, ...nodes.map((node) => node.id)] : [];
  });

export function SlotTree({ nodes, placements, label, slotId, counts, memberCount, onNavigate, onNodeNavigate, onSelect }: {
  onSelect?: (nodeId: string) => void;
  onNodeNavigate?: (node: string) => void;
  counts: Readonly<Record<string, number>>; memberCount: (count: number) => string;
  nodes: readonly SlotTreeNode[]; placements: readonly Placement[]; label: string; slotId: string; onNavigate?: (slotId: string) => void;
}): ReactElement {
  const [initial] = useState(() => {
    const ids = new Set<string>();
    const visit = (node: SlotTreeNode): void => { ids.add(node.id); node.children?.forEach(visit); };
    nodes.forEach(visit);
    return branchesAbove(placements, slotId).filter(id => ids.has(id));
  });
  const previous = useRef(new Set(initial));
  const decorate = (node: SlotTreeNode): SlotTreeNode => node.children
    ? { ...node, children: node.children.map(decorate) }
    : { ...node, label: `${node.label} (${memberCount(counts[node.id] ?? 0)})` };
  return <TreeView nodes={nodes.map(decorate)} aria-label={label} currentId={slotId} onNavigate={id => { onSelect?.(id); onNavigate?.(id); }} defaultExpandedIds={initial} onExpandedChange={next => {
    const changed = [...new Set([...previous.current, ...next])].filter(id => previous.current.has(id) !== next.has(id));
    previous.current = new Set(next);
    if (changed.length === 1 && changed[0] !== undefined) { onSelect?.(changed[0]); onNodeNavigate?.(changed[0]); }
  }} />;
}
