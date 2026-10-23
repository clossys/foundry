"use client";

import { useMemo, useState } from "react";
import {
  Button as AriaButton,
  Tree as AriaTree,
  TreeItem as AriaTreeItem,
  TreeItemContent as AriaTreeItemContent,
  type Selection,
} from "react-aria-components";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { Icon } from "./Icon.js";
import { cx } from "./internal/cx.js";
import { UI_LAYOUT_TAP_TARGET, UI_RING_FOCUS } from "./internal/ui-vars.js";

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

function Rows({ nodes }: { nodes: readonly TreeViewNode[] }) {
  return nodes.map(node => <AriaTreeItem key={node.id} id={node.id} textValue={node.label}
    className={({ isSelected, isFocusVisible }) => cx(
      "flex min-w-0 items-center outline-none text-body text-ink-primary",
      isSelected ? "bg-surface-selected" : "hover:bg-surface-sunken",
      isSelected || isFocusVisible ? "forced-colors:outline forced-colors:outline-solid" : "",
      isFocusVisible ? "forced-colors:outline-2 forced-colors:-outline-offset-2" : "",
    )}
    style={({ isFocusVisible }) => ({
      minBlockSize: UI_LAYOUT_TAP_TARGET,
      boxShadow: isFocusVisible ? "inset " + UI_RING_FOCUS : undefined,
    })}>
    <AriaTreeItemContent>
      {({ level, isExpanded, hasChildItems }) => <div className="flex min-w-0 flex-1 items-center gap-sm py-xs pe-md"
        style={{ paddingInlineStart: "calc(var(--spacing-lg, 16px) * " + (level - 1) + " + var(--spacing-sm, 8px))" }}>
        {hasChildItems
          ? <AriaButton slot="chevron" className="inline-flex shrink-0 items-center outline-none">
              <Icon glyph={isExpanded ? ChevronDown : ChevronRight} decorative size="sm" className={isExpanded ? undefined : "rtl:rotate-180"} />
            </AriaButton>
          : <span aria-hidden="true" className="inline-block shrink-0" style={{ inlineSize: "var(--ui-icon-sm, 1rem)" }} />}
        <span className="min-w-0 truncate">{node.label}</span>
      </div>}
    </AriaTreeItemContent>
    {node.children ? <Rows nodes={node.children} /> : null}
  </AriaTreeItem>);
}

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
  const select = (keys: Selection) => {
    if (keys === "all") return;
    const picked = [...keys].map(String).find(key => key !== currentId) ?? currentId;
    const node = picked === undefined ? undefined : index.get(picked);
    if (!node) return;
    if (isBranch(node)) toggle(node.id);
    else if (node.id !== currentId) onNavigate?.(node.id);
  };
  return <AriaTree aria-label={ariaLabel} selectionMode="single" selectedKeys={currentId === undefined ? [] : [currentId]}
    onSelectionChange={select} expandedKeys={expanded} onExpandedChange={keys => change(new Set([...keys].map(String)))}
    className={cx("w-full min-w-0 text-body text-ink-primary outline-none", className)}>
    <Rows nodes={nodes} />
  </AriaTree>;
}
