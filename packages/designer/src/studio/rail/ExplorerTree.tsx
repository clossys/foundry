"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerId, Placement } from "../../catalog-core/index.js";
import { Select } from "../../components/Select.js";
import { nodeOptions } from "../model.js";
import { TreeView, type TreeViewNode } from "../TreeView.js";
import { useStudioSession } from "../StudioProvider.js";
import { useWholeStudio } from "../WholeStudioProvider.js";
import { EXPLORER_LAYER_ORDER, explorerIndex, explorerNodes } from "./explorer-tree.js";
import { useInheritedRailFocus, useRailFocusRecord } from "./rail-focus.js";

const VALUE_LAYERS: ReadonlySet<LayerId> = new Set(["tokens", "assets"]);

/** Every placement the explorer lists: a whole library's value and contract layers, else the value catalog's. */
export function useExplorerPlacements(): readonly Placement[] {
  const state = useStudioSession(), whole = useWholeStudio();
  const contracts = whole?.contracts;
  return useMemo(() => contracts
    ? [...state.catalog.placements.filter(placement => VALUE_LAYERS.has(placement.layer)), ...contracts.placements.filter(placement => !VALUE_LAYERS.has(placement.layer))]
    : state.catalog.placements, [state.catalog, contracts]);
}

/** The layer, and the placement nodes that hold a leaf, so the tree opens on it. No id is split. */
const branchesAbove = (placements: readonly Placement[], leaf: string | undefined): string[] => leaf === undefined ? [] : placements.flatMap(placement => {
  const nodes = nodeOptions([placement], leaf);
  return nodes.length > 0 ? [placement.layer, ...nodes.map(node => node.id)] : [];
});
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every(id => b.has(id));

/**
 * The Explorer card body: one tree whose top level is the five layers in D5g order, then L1, L2 and L3. A click
 * never filters; it navigates (the studio context's `onNavigate`). Only the active layer stays expanded.
 */
export function ExplorerTree({ query = "" }: { query?: string }) {
  const state = useStudioSession();
  const placements = useExplorerPlacements();
  const { counts, labels } = state;
  const nodes = useMemo(() => explorerNodes(placements, labels.layers, query), [placements, labels.layers, query]);
  const index = useMemo(() => explorerIndex(nodes), [nodes]);
  // Value leaves carry their member count, as the slot tree did. A subtree with no counted leaf keeps its
  // identity, so the tree's memoised rows are not prepared again for it.
  const shown = useMemo(() => {
    const decorate = (node: TreeViewNode): TreeViewNode => {
      if (!node.children?.length) return node.id in counts ? { ...node, label: `${node.label} (${labels.memberCount(counts[node.id] ?? 0)})` } : node;
      const children = node.children.map(decorate);
      return children.every((child, index) => child === node.children![index]) ? node : { ...node, children };
    };
    return nodes.map(decorate);
  }, [nodes, counts, labels]);
  const layerIds = useMemo(() => new Set<string>(EXPLORER_LAYER_ORDER), []);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([state.layer, ...branchesAbove(placements, state.selected ?? state.slotId)]));
  const latest = useRef(expanded); latest.current = expanded;
  // The tree first mounts once the library has loaded, so its rows (and their member counts) are prepared once;
  // a later host reload keeps it mounted.
  const [loaded, setLoaded] = useState(() => Boolean(state.ready));
  if (state.ready && !loaded) setLoaded(true);
  // A layer change that swapped the canvas left focus on a row of the previous rail's tree: the same row here takes it
  // once the tree has rendered it.
  const record = useRailFocusRecord(), inherited = useInheritedRailFocus();
  const focusRow = useRef(inherited?.kind === "row" ? inherited.id : undefined), body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = focusRow.current, row = id === undefined ? null : body.current?.querySelector<HTMLElement>(`[role="row"][data-key="${CSS.escape(id)}"]`);
    if (row) { focusRow.current = undefined; row.focus(); }
  });
  // Following the active layer (and the selection) keeps one layer open; other expanded branches stay open.
  useEffect(() => {
    setExpanded(current => {
      const next = new Set([...current].filter(id => !layerIds.has(id) || id === state.layer));
      next.add(state.layer);
      branchesAbove(placements, state.selected).forEach(id => { if (!layerIds.has(id) || id === state.layer) next.add(id); });
      return sameSet(next, current) ? current : next;
    });
  }, [state.layer, state.selected, placements, layerIds]);
  // The tree's collection treats Escape as its own (and marks it handled), so the card clears the selection here:
  // Escape closes the Inspector card wherever focus is.
  if (!loaded) return null;
  return <div ref={body} className="min-w-0" onKeyDownCapture={event => { if (event.key === "Escape" && state.selected !== undefined) state.select(undefined); }}>
    <TreeView nodes={shown} aria-label={labels.treeLabel} currentId={state.selected} expandedIds={expanded}
    onNavigate={id => { const entry = index.get(id); if (entry) { record(state.layer, entry.target.layer, { kind: "row", id }); state.onNavigate(entry.target); } }}
    onExpandedChange={next => {
      const changed = [...new Set([...latest.current, ...next])].filter(id => latest.current.has(id) !== next.has(id));
      setExpanded(next);
      const entry = changed.length === 1 ? index.get(changed[0]!) : undefined;
      if (entry?.branch) { record(state.layer, entry.target.layer, { kind: "row", id: changed[0]! }); state.onNavigate(entry.target); }
    }} />
  </div>;
}

/** The Explorer card's header control: a layer select that stays in sync with the tree's open layer. */
export function LayerSelect() {
  const state = useStudioSession();
  const placements = useExplorerPlacements();
  const record = useRailFocusRecord(), autoFocus = useInheritedRailFocus()?.kind === "layer";
  const options = useMemo(() => EXPLORER_LAYER_ORDER.filter(layer => placements.some(placement => placement.layer === layer)).map(id => ({ id, label: state.labels.layers[id] })), [placements, state.labels.layers]);
  return <Select size="sm" className="min-w-0" label={<span className="sr-only">{state.labels.layers.label}</span>} options={options} selectedKey={state.layer} autoFocus={autoFocus}
    onSelectionChange={key => { if (typeof key !== "string" || key === state.layer || !options.some(option => option.id === key)) return; record(state.layer, key as LayerId, { kind: "layer" }); state.onNavigate({ layer: key as LayerId }); }} />;
}
