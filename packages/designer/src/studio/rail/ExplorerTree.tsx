"use client";
import { useEffect, useMemo, useState } from "react";
import type { LayerId, Placement } from "../../catalog-core/index.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { Select } from "../../components/Select.js";
import { TreeView } from "../TreeView.js";
import { useOptionalStudioSession } from "../StudioProvider.js";
import { useWholeStudio } from "../WholeStudioProvider.js";
import type { StudioLabels } from "../types.js";
import { EXPLORER_LAYER_ORDER, explorerIndex, explorerNodes, type StudioNavigateTarget } from "./explorer-tree.js";

/** IA only: paths label branches, leaf identity is the opaque catalog id. */
export function useExplorerPlacements(): readonly Placement[] {
  const state = useOptionalStudioSession(), whole = useWholeStudio();
  return useMemo(() => whole ? [...(state?.catalog.placements ?? []).filter(p => p.layer === "tokens" || p.layer === "assets"), ...whole.contracts.placements.filter(p => p.layer !== "tokens" && p.layer !== "assets")] : state?.catalog.placements ?? [], [state?.catalog, whole?.contracts]);
}
interface ExplorerProps {
  readonly query?: string; readonly placements?: readonly Placement[]; readonly labels?: StudioLabels;
  readonly activeLayer?: LayerId; readonly selectedLeaf?: string;
  readonly onNavigate?: (target: StudioNavigateTarget) => void;
  readonly onCloseInspector?: () => void;
}
/** Same tree on every layer. A branch is a camera target, never a filter. */
export function ExplorerTree(props: ExplorerProps) {
  const session = useOptionalStudioSession(), inherited = useExplorerPlacements();
  const placements = props.placements ?? inherited, labels = props.labels ?? session!.labels;
  const layer = props.activeLayer ?? session?.layer, selected = props.selectedLeaf ?? session?.selected;
  const navigate = props.onNavigate ?? session!.onNavigate;
  const expansionLeaf=selected??session?.slotId;
  const nodes = useMemo(() => explorerNodes(placements, labels.layers, props.query), [placements, labels.layers, props.query]);
  const index = useMemo(() => explorerIndex(nodes), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(layer ? [layer] : []));
  useEffect(() => {
    const ancestors: string[] = [];
    const visit = (rows: typeof nodes, parents: string[]): void => rows.forEach(node => { if (node.id === expansionLeaf) ancestors.push(...parents); if (node.children) visit([...node.children], [...parents,node.id]); });
    visit(nodes, []);
    setExpanded(current => { const next = new Set([...current].filter(id => !EXPLORER_LAYER_ORDER.includes(id as LayerId) || id === layer)); if (layer) next.add(layer); ancestors.forEach(id=>next.add(id)); return next.size === current.size && [...next].every(id=>current.has(id)) ? current : next; });
  }, [nodes, layer, expansionLeaf]);
  return <SemanticContent as="div" onKeyDownCapture={event => {
    if (event.key === "Escape" && selected !== undefined) {
      if (props.onCloseInspector) props.onCloseInspector();
      else session?.select(undefined);
    }
  }}><TreeView nodes={nodes} aria-label={labels.treeLabel} currentId={selected} expandedIds={expanded}
    onNavigate={id => { const entry=index.get(id); if(entry) navigate(entry.target); }}
    onExpandedChange={next => { const changed=[...new Set([...expanded,...next])].filter(id=>expanded.has(id)!==next.has(id)); setExpanded(next); const entry=changed.length===1 ? index.get(changed[0]!) : undefined; if(entry)navigate(entry.target); }} /></SemanticContent>;
}
export function LayerSelect(props: ExplorerProps = {}) {
  const session=useOptionalStudioSession(), inherited=useExplorerPlacements();
  const placements=props.placements ?? inherited,labels=props.labels ?? session!.labels,layer=props.activeLayer ?? session?.layer;
  const options=EXPLORER_LAYER_ORDER.filter(id=>placements.some(p=>p.layer===id)).map(id=>({id,label:labels.layers[id]}));
  return <Select size="sm" label={<SemanticContent as="span" className="sr-only">{labels.layers.label}</SemanticContent>} options={options} selectedKey={layer} onSelectionChange={id=>{ if(typeof id==="string"&&options.some(o=>o.id===id)) (props.onNavigate ?? session!.onNavigate)({layer:id as LayerId}); }} />;
}
