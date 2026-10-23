"use client";

import { useState, type ReactElement } from "react";
import type { Placement } from "../catalog-core/index.js";
import { TreeView } from "../atoms/TreeView.js";
import { nodeOptions, type SlotTreeNode } from "./model.js";

/** The layer and the placement nodes that hold a slot, read from the placement files, so the tree opens on it. No id is split. */
const branchesAbove = (placements: readonly Placement[], slotId: string): string[] =>
  placements.flatMap((placement) => {
    const nodes = nodeOptions([placement], slotId);
    return nodes.length > 0 ? [placement.layer, ...nodes.map((node) => node.id)] : [];
  });

export function SlotTree({ nodes, placements, label, slotId, onNavigate }: {
  nodes: readonly SlotTreeNode[]; placements: readonly Placement[]; label: string; slotId: string; onNavigate: (slotId: string) => void;
}): ReactElement {
  const [initial] = useState(() => branchesAbove(placements, slotId));
  return <TreeView nodes={nodes} aria-label={label} currentId={slotId} onNavigate={onNavigate} defaultExpandedIds={initial} />;
}
