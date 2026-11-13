"use client";

import { memo, useMemo, useState } from "react";
import { Tree, type TreeProps } from "../components/Tree.js";
import { cx } from "../components/internal/cx.js";

export interface TreeViewNode {
  /** Stable unique id across the whole tree; it is the value `currentId` and `onNavigate` use. */
  readonly id: string;
  /** Host-authored visible label; it is also the typeahead text. */
  readonly label: string;
  /** Present and non-empty makes this node a branch; absent or empty makes it a leaf. */
  readonly children?: readonly TreeViewNode[];
}

export interface TreeViewProps {
  readonly nodes: readonly TreeViewNode[];
  /** Host-authored accessible name for the tree. */
  readonly "aria-label": string;
  /** The leaf shown as current (selected). */
  readonly currentId?: string;
  /** Called with a leaf id when a leaf row is activated and is not already current. */
  readonly onNavigate?: (id: string) => void;
  readonly defaultExpandedIds?: Iterable<string>;
  readonly expandedIds?: Iterable<string>;
  readonly onExpandedChange?: (ids: Set<string>) => void;
  readonly className?: string;
}

const isBranch = (node: TreeViewNode) => (node.children?.length ?? 0) > 0;

function indexNodes(nodes: readonly TreeViewNode[], into = new Map<string, TreeViewNode>()) {
  for (const node of nodes) {
    into.set(node.id, node);
    if (node.children) indexNodes(node.children, into);
  }
  return into;
}

// Rows depend only on the immutable nodes; selection, expansion and handlers stay on the native Tree.
const Rows = memo(function Rows({ nodes }: { nodes: readonly TreeViewNode[] }) {
  return nodes.map(node => <Tree.Node key={node.id} id={node.id} textValue={node.label}
    label={<span title={node.label} data-tree-label="" className="min-w-0 flex-1 truncate">{node.label}</span>} expandLabel={node.label}>
    {node.children ? <Rows nodes={node.children} /> : null}
  </Tree.Node>);
});

export function TreeView({ nodes, "aria-label": ariaLabel, currentId, onNavigate, defaultExpandedIds, expandedIds, onExpandedChange, className }: TreeViewProps) {
  if (!ariaLabel?.trim()) throw new TypeError("TreeView requires aria-label.");
  const index = useMemo(() => indexNodes(nodes), [nodes]);
  const [internal, setInternal] = useState<Set<string>>(() => new Set(defaultExpandedIds));
  const expanded = expandedIds === undefined ? internal : new Set(expandedIds);
  const change = (next: Set<string>) => {
    if (expandedIds === undefined) setInternal(next);
    onExpandedChange?.(next);
  };
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    change(next);
  };
  const select: NonNullable<TreeProps<TreeViewNode>["onSelectionChange"]> = keys => {
    if (keys === "all") return;
    const picked = [...keys].map(String).find(key => key !== currentId) ?? currentId;
    const node = picked === undefined ? undefined : index.get(picked);
    if (!node) return;
    if (isBranch(node)) toggle(node.id);
    else if (node.id !== currentId) onNavigate?.(node.id);
  };
  return <Tree aria-label={ariaLabel} selectionMode="single" selectedKeys={currentId === undefined ? [] : [currentId]}
    onSelectionChange={select} expandedKeys={expanded} onExpandedChange={keys => change(new Set([...keys].map(String)))}
    className={cx("w-full min-w-0 text-body text-ink-primary outline-none", className)}>
    <Rows nodes={nodes} />
  </Tree>;
}
