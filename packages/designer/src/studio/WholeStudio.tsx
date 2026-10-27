"use client";
import { Disclosure } from "../components/Disclosure.js";

import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import type { LayerId, Placement, BuildCatalogData } from "../catalog-core/index.js";
import { Button } from "../components/Button.js";
import { useStudioSession } from "./StudioProvider.js";
import { useWholeStudio } from "./WholeStudioProvider.js";
export { WholeStudioProvider, useWholeStudio } from "./WholeStudioProvider.js";
import { LegacyStudioCanvas } from "./StudioCanvas.js";
import { Scorecard } from "./Scorecard.js";
import { StudioStatus } from "./StudioStatus.js";
import { StudioTopBar } from "./StudioTopBar.js";
import { EditFeedback } from "./EditFeedback.js";
import { CanvasExplorer } from "./CanvasExplorer.js";
import { CanvasModules } from "./CanvasModules.js";
import { TreeView } from "./TreeView.js";
import { SlotModule } from "../shell/FrameSlots.js";
import { RuntimePendingLine } from "./board-summary.js";
import { checkCounts } from "./runtime-pending.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { CANVAS_ZOOM_VAR } from "../blocks/canvas/CanvasLod.js";
import { useCanvasWorld } from "./useCanvasWorld.js";
import { placedLeaves, wholeSignoff } from "./whole-model.js";
import { prepareCompositeLibraryBoard } from "./prepared-library-boards.js";
import { CanvasBoards, canvasPreviewPort, canvasSourceDigests } from "./canvas-boards.js";
import type { LibraryBoardCommand } from "../blocks/library-board/model.js";
import type { StudioCanvasProps, StudioHeaderProps, CompositeStudioLabels } from "./types.js";

const LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
export function WholeStudioHeader({ className, layerHref, onLayerNavigate }: StudioHeaderProps) {
  const s = useWholeStudio()!;
  return <div className={className} data-studio-header=""><StudioTopBar labels={s.labels} layer={s.layer} layers={LAYERS} onLayer={s.setLayer} layerHref={layerHref} onLayerNavigate={onLayerNavigate} /></div>;
}
export function WholeStudioRightPanel() {
  const s = useWholeStudio()!; const values = useStudioSession(); const profile = s.evaluated?.value?.profile;
  const slots = s.contracts.slots.filter(slot => slot.layer === s.layer);
  const findings = profile?.check.findings.filter(f => s.layer === "components" ? f.code.startsWith("K") : !f.code.startsWith("K")) ?? [];
  const runtimeLayer = s.layer === "sections" || s.layer === "frames";
  const counts = checkCounts(findings), errors = counts.errors;
  return <><StudioStatus labels={s.labels} state={s.valueSession && s.feedback ? { ...s.valueSession, ...s.feedback } : undefined} />
    <Button variant="ghost" onPress={() => s.setScore(v => !v)} aria-expanded={s.score}>{s.labels.scorecard.title}</Button>
    {s.score && (s.layer === "tokens" || s.layer === "assets") && values.summary ? <Scorecard summary={values.summary} labels={s.labels} onClose={() => s.setScore(false)} onIssue={id => values.canvasActions.current?.reveal(id, true)} /> : s.score ? <section aria-label={s.labels.scorecard.title} className="border border-line-base bg-surface-base p-md"><Button onPress={() => s.setScore(false)}>{s.labels.scorecard.close}</Button><p>{s.labels.scorecard.title}</p><p>{runtimeLayer ? s.labels.whole.unassessed : s.labels.checkSummary(errors, 0)}</p>{!runtimeLayer ? <RuntimePendingLine count={counts.pending} label={s.labels.runtimePending} /> : null}{!runtimeLayer ? <p>{s.labels.whole.unassessed}</p> : null}{findings.map((f, i) => <p key={i}>{f.code}: {f.message}</p>)}{s.evaluated?.error ? <p role="alert">{s.evaluated.error}</p> : null}</section> : null}
  </>;
}

export function WholeStudioCanvas(props: StudioCanvasProps) {
  const s = useWholeStudio()!; const values = useStudioSession();
  const valueLayer = s.layer === "tokens" || s.layer === "assets";
  const leaf = valueLayer ? s.adapter.catalog.values.slots.find(slot => slot.layer === s.layer && slot.id === values.slotId)
    ?? s.adapter.catalog.values.slots.find(slot => slot.layer === s.layer) : undefined;
  const profile = s.evaluated?.value?.profile;
  const preview = useMemo(() => {
    try { return { node: leaf && profile ? s.snapshot?.preview?.(leaf.id, profile) : undefined }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [leaf?.id, profile, s.snapshot?.preview]);
  return <>{valueLayer ? <>
    {preview.node != null || preview.error ? <div data-studio-host-preview={leaf?.id}>{preview.node}{preview.error ? <p role="alert">{preview.error}</p> : null}</div> : null}
    <LegacyStudioCanvas {...props} />
  </> : <ContractCanvas {...props} />}</>;
}
function ContractCanvas({ className, candidateWorkflow }: StudioCanvasProps) {
  const s = useWholeStudio()!; const values = useStudioSession(); const t = s.labels; const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<import("./canvas-model.js").CanvasFilter>("all");
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const placement = s.contracts.placements.find(p => p.layer === s.layer);
  const canvas = useCanvasWorld(s.layer, undefined, undefined, Boolean(placement?.nodes.length));
  const profile = s.evaluated?.value?.profile;
  const groups = useMemo(() => contractBoards(placement), [placement]);
  const layer = s.layer === "components" || s.layer === "sections" || s.layer === "frames" ? s.layer : undefined;
  // The exact documents this canvas renders per leaf: the catalog's candidates and the consumer's own fills.
  const documents = useMemo(() => !s.input ? [] : s.layer === "components" ? [...s.input.catalog.components.fills, ...s.input.library.components.fills]
    : [...(s.input.catalog.surfaces?.fills ?? []), ...(s.input.library.surfaces?.fills ?? [])], [s.layer, s.input?.catalog, s.input?.library]);
  // Session notifications leave placement and query unchanged; keep the explorer's immutable nodes.
  const tree = useMemo(() => placement?.nodes.map(domain => ({ id: domain.id, label: domain.label, children: ("children" in domain ? domain.children : [domain]).map(group => ({ id: group.id, label: group.label, children: placedLeaves([group]).filter(leaf => leaf.id.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(leaf => ({ id: leaf.id, label: leaf.id })) })) })) ?? [], [placement, query]);
  const libraries = useMemo(() => [...new Set(s.layer === "components" ? (s.input && s.changes ? s.adapter.catalog.components.fills.map(doc => doc.$extensions["com.clossys.fill"].source) : []) : s.snapshot?.runtime?.manifest.fills.map(fill => fill.library) ?? [])], [s.layer, s.input, s.changes, s.adapter.catalog, s.snapshot?.runtime]);
  const session = s.session;
  // Every board is the registered library-board comparison Section, prepared from the original composite session.
  const boards = useMemo(() => layer && s.input && s.snapshot && s.changes && profile ? groups.flatMap(domain => domain.boards.map(group => {
    const id = `${layer}/${group.id}`, leaves = new Set(group.leaves.map(leaf => leaf.id));
    const sourceHashes = canvasSourceDigests(documents.filter(doc => leaves.has(doc.$extensions["com.clossys.fill"].slot)).map(doc => [doc.$extensions["com.clossys.fill"].source, doc] as const));
    const prepared = prepareCompositeLibraryBoard({ layer, board: { id, label: group.label, leaves: group.leaves }, mode: editing.has(id) ? "edit" : "view", canSave: Boolean(s.changes), pending: false,
      input: s.input!, snapshot: s.snapshot!, changes: s.changes!, contracts: s.contracts, profile, sources: values.catalog.sources, labels: t, workflow: candidateWorkflow, sourceHashes });
    const needle = query.toLocaleLowerCase();
    return { id, domain: domain.id, hidden: Boolean(needle) && !group.leaves.some(leaf => leaf.id.toLocaleLowerCase().includes(needle)), records: prepared.records, previews: canvasPreviewPort(prepared.previews), changeFor: prepared.changeFor };
  })) : [], [layer, groups, documents, editing, query, profile, s.input, s.snapshot, s.changes, s.contracts, values.catalog.sources, t, candidateWorkflow]);
  const setLeaf = s.setLeaf;
  const command = useCallback((input: LibraryBoardCommand) => {
    if (!("leafId" in input)) {
      const entering = input.command === "board-edit";
      setEditing(previous => { const next = new Set(previous); if (entering) next.add(input.boardId); else next.delete(input.boardId); return next; });
      return;
    }
    if (input.command === "reveal") { setLeaf(input.leafId); return; }
    const operations = boards.find(board => board.id === input.boardId)?.changeFor(input);
    if (operations) session?.edit(input.leafId, operations);
  }, [boards, session, setLeaf]);
  const activeBoard = groups.flatMap(domain => domain.boards).find(board => board.leaves.some(leaf => leaf.id === s.leaf));
  return <div data-studio="" data-studio-canvas="" className={["relative isolate min-h-0 flex-1 overflow-hidden", className].filter(Boolean).join(" ")}>
    <CanvasSurface aria-label={t.canvas.label} viewport={canvas.pose} onViewportChange={canvas.setPose} selection={[]} onSelectionChange={() => {}}
      worldBounds={canvas.bounds} items={[]} itemInteraction="content" minZoom={.12} maxZoom={2} grid="dots" style={{ [CANVAS_ZOOM_VAR]: canvas.pose.zoom } as CSSProperties}
      onSurfaceElement={canvas.onSurfaceElement} onWorldElement={canvas.onWorldElement} actionsRef={canvas.actions}
      worldClassName="flex h-max w-max flex-col gap-3xl p-3xl" className="absolute inset-0 rounded-none border-0">
      <CanvasBoards boards={boards} labels={t} workflow={candidateWorkflow} onCommand={command} />
    </CanvasSurface>
    <CanvasModules canvas={canvas} labels={t} explorer={<CanvasExplorer labels={t} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} libraries={libraries.map(id => ({ id, available: !activeBoard || (s.layer === "components" ? documents.some(doc => doc.$extensions["com.clossys.fill"].source === id && activeBoard.leaves.some(leaf => leaf.id === doc.$extensions["com.clossys.fill"].slot)) : Boolean(s.snapshot?.runtime?.manifest.fills.some(fill => fill.library === id && activeBoard.leaves.some(leaf => leaf.id === fill.leaf)))) }))}>
      <TreeView nodes={tree} aria-label={t.treeLabel} currentId={s.leaf} onNavigate={s.setLeaf} />
    </CanvasExplorer>} />
    <SlotModule id="contract-inspector" slot="right-panel" label={t.inspectorLabel}><section data-studio-panel="inspector" aria-label={t.inspectorLabel}><h2>{s.leaf}</h2>
      <h3>{t.whole.contract}</h3><pre className="whitespace-pre-wrap">{JSON.stringify(s.contracts.slots.find(slot => slot.id === s.leaf)?.contract, null, 2)}</pre>
      <h3>{t.inspector.findings}</h3>
      {profile?.components.components[s.leaf] ? <Disclosure title={<>{t.inspector.source}: {profile.components.components[s.leaf]!.descriptor.source}</>}><pre className="whitespace-pre-wrap">{JSON.stringify(profile.components.components[s.leaf], null, 2)}</pre></Disclosure> : null}
      {s.feedback ? <EditFeedback leaf={s.leaf} state={s.feedback} labels={t} /> : null}
      {s.evaluated?.error ? <p role="alert">{s.evaluated.error}</p> : null}
      {profile?.check.findings.filter(f => f.subject === s.leaf || f.subject.startsWith(s.leaf + ".")).map((finding, index) => <p key={index}>{finding.code}: {finding.message}</p>)}
      {s.layer !== "components" ? <><p>{t.whole.unassessed}</p>{s.evaluated?.value?.runtime?.findings.map((finding, index) => <p key={index}>{finding.path}: {finding.message}</p>)}<ContractSignoff contracts={s.contracts} labels={t.whole} none={t.inspector.none} /></> : null}
      {s.layer === "components" && profile?.components.components[s.leaf] ? <Button onPress={() => { if (s.changes) s.edit(s.leaf, [{ portion: "components", change: { op: "remove", slot: s.leaf } }]); }}>{t.resetToDefault}</Button> : null}
    </section></SlotModule>
  </div>;
}

// Leaf/session notifications do not change the complete signoff catalog. Keep
// its mounted disclosure content and expansion while selected findings update.
const ContractSignoff = memo(function ContractSignoff({ contracts, labels, none }: { contracts: BuildCatalogData; labels: CompositeStudioLabels["whole"]; none: string }) {
  return <><h3>{labels.signoff}</h3><p>{labels.proposed}</p>{wholeSignoff(contracts).map(row => <Disclosure key={row.id} title={<>{row.id}</>}><p>{row.placement.join(" / ")}</p><pre>{JSON.stringify(row.contract, null, 2)}</pre><p>{labels.unresolved}: {row.unresolved.join(", ") || none}</p></Disclosure>)}</>;
});

function contractBoards(placement: Placement | undefined) {
  return placement?.nodes.map(domain => ({ ...domain, boards: ("children" in domain ? domain.children : [domain]).map(group => ({ ...group, leaves: placedLeaves([group]) })) })) ?? [];
}
