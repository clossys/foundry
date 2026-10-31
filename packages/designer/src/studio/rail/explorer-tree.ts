import type { LayerId, Placement } from "../../catalog-core/index.js";
import { buildSlotTree, type SlotTreeNode } from "../model.js";
import type { TreeViewNode } from "../TreeView.js";

/** D5g row order: Frames on top, Tokens at the bottom. */
export const EXPLORER_LAYER_ORDER: readonly LayerId[] = ["frames", "sections", "components", "assets", "themes"];

/** One navigation target: a layer, optionally an L1 or L2 branch inside it, optionally an L3 leaf. */
export interface StudioNavigateTarget { readonly layer: LayerId; readonly l1?: string; readonly l2?: string; readonly leaf?: string }
export interface ExplorerEntry { readonly target: StudioNavigateTarget; readonly branch: boolean }

function filterLeaves(node: SlotTreeNode, needle: string): SlotTreeNode | undefined {
  if (!node.children) return node.id.toLocaleLowerCase().includes(needle) || node.label.toLocaleLowerCase().includes(needle) ? node : undefined;
  const children = node.children.flatMap(child => filterLeaves(child, needle) ?? []);
  return children.length ? { ...node, children } : undefined;
}

/**
 * The explorer's tree: the placed layers at the top level in D5g order, then L1, L2 and L3 with the slot-tree
 * ids. A query keeps the leaves whose id or label contains it and drops branches left empty.
 */
export function explorerNodes(placements: readonly Placement[], layerLabels: Readonly<Record<LayerId, string>>, query = ""): TreeViewNode[] {
  const tree = buildSlotTree(placements);
  const needle = query.trim().toLocaleLowerCase();
  return EXPLORER_LAYER_ORDER.flatMap(layer => {
    const tops = tree.filter(top => top.id === layer);
    if (!tops.length) return [];
    const all = tops.flatMap(top => top.children ?? []);
    const children = needle ? all.flatMap(child => filterLeaves(child, needle) ?? []) : all;
    return needle && !children.length ? [] : [{ id: layer, label: layerLabels[layer], children }];
  });
}

/** Every node id with the target a click on it navigates to; branches carry no leaf. */
export function explorerIndex(nodes: readonly TreeViewNode[]): Map<string, ExplorerEntry> {
  const index = new Map<string, ExplorerEntry>();
  const visit = (node: TreeViewNode, base: StudioNavigateTarget, depth: number): void => {
    const branch = (node.children?.length ?? 0) > 0;
    const target: StudioNavigateTarget = !branch ? { ...base, leaf: node.id } : depth === 1 ? { layer: base.layer, l1: node.id } : { ...base, l2: node.id };
    index.set(node.id, { target, branch });
    node.children?.forEach(child => visit(child, branch ? target : base, depth + 1));
  };
  for (const layer of nodes) {
    const target: StudioNavigateTarget = { layer: layer.id as LayerId };
    index.set(layer.id, { target, branch: true });
    layer.children?.forEach(child => visit(child, target, 1));
  }
  return index;
}
