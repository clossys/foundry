"use client";
import { Disclosure } from "../components/Disclosure.js";

import { memo, useCallback, useMemo, useState } from "react";
import type { Placement, BuildCatalogData } from "../catalog-core/index.js";
import { Button } from "../components/Button.js";
import { useStudioSession } from "./StudioProvider.js";
import { useWholeStudio } from "./WholeStudioProvider.js";
export { WholeStudioProvider, useWholeStudio } from "./WholeStudioProvider.js";
import { LegacyStudioCanvas } from "./StudioCanvas.js";
import { Scorecard } from "./Scorecard.js";
import { CanvasExplorer } from "./CanvasExplorer.js";
import { CanvasModules } from "./CanvasModules.js";
import { ExplorerTree, LayerSelect } from "./rail/ExplorerTree.js";
import { StudioUsage } from "./usage/StudioUsage.js";
import { RuntimePendingLine } from "./board-summary.js";
import { checkCounts } from "./runtime-pending.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { CanvasLod } from "../blocks/canvas/CanvasLod.js";
import { useCanvasWorld } from "./useCanvasWorld.js";
import { placedLeaves, wholeSignoff } from "./whole-model.js";
import { compositeBoardPrompt, prepareCompositeLibraryBoard } from "./prepared-library-boards.js";
import { InspectorChange } from "./Inspector.js";
import { CanvasBoards, canvasPreviewPort, canvasSourceDigests } from "./canvas-boards.js";
import type { LibraryBoardCommand } from "../blocks/library-board/model.js";
import type { StudioCanvasProps, CompositeStudioLabels } from "./types.js";

export function WholeStudioRightPanel() {
  const s = useWholeStudio()!; const values = useStudioSession(); const profile = s.evaluated?.value?.profile;
  const slots = s.contracts.slots.filter(slot => slot.layer === s.layer);
  const findings = profile?.check.findings.filter(f => s.layer === "components" ? f.code.startsWith("K") : !f.code.startsWith("K")) ?? [];
  const runtimeLayer = s.layer === "sections" || s.layer === "frames";
  const counts = checkCounts(findings), errors = counts.errors;
  return <><Button variant="ghost" onPress={() => s.setScore(v => !v)} aria-expanded={s.score}>{s.labels.scorecard.title}</Button>
    {s.score && (s.layer === "tokens" || s.layer === "assets") && values.summary ? <Scorecard summary={values.summary} labels={s.labels} onClose={() => s.setScore(false)} onIssue={id => values.onNavigate({ layer: s.layer, leaf: id })} /> : s.score ? <section aria-label={s.labels.scorecard.title} className="border border-line-base bg-surface-base p-md"><Button onPress={() => s.setScore(false)}>{s.labels.scorecard.close}</Button><p>{s.labels.scorecard.title}</p><p>{runtimeLayer ? s.labels.whole.unassessed : s.labels.checkSummary(errors, 0)}</p>{!runtimeLayer ? <RuntimePendingLine count={counts.pending} label={s.labels.runtimePending} /> : null}{!runtimeLayer ? <p>{s.labels.whole.unassessed}</p> : null}{findings.map((f, i) => <p key={i}>{f.code}: {f.message}</p>)}{s.evaluated?.error ? <p role="alert">{s.evaluated.error}</p> : null}</section> : null}
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
  const placement = s.contracts.placements.find(p => p.layer === s.layer);
  const canvas = useCanvasWorld(s.layer, undefined, undefined, Boolean(placement?.nodes.length));
  const profile = s.evaluated?.value?.profile;
  const groups = useMemo(() => contractBoards(placement), [placement]);
  const layer = s.layer === "components" || s.layer === "sections" || s.layer === "frames" ? s.layer : undefined;
  // The exact documents this canvas renders per leaf: the catalog's candidates and the consumer's own fills.
  const documents = useMemo(() => !s.input ? [] : s.layer === "components" ? [...s.input.catalog.components.fills, ...s.input.library.components.fills]
    : [...(s.input.catalog.surfaces?.fills ?? []), ...(s.input.library.surfaces?.fills ?? [])], [s.layer, s.input?.catalog, s.input?.library]);
  const libraries = useMemo(() => [...new Set(s.layer === "components" ? (s.input && s.changes ? s.adapter.catalog.components.fills.map(doc => doc.$extensions["com.clossys.fill"].source) : []) : s.snapshot?.runtime?.manifest.fills.map(fill => fill.library) ?? [])], [s.layer, s.input, s.changes, s.adapter.catalog, s.snapshot?.runtime]);
  // Every board is the registered library-board comparison Section, prepared from the original composite session.
  const boards = useMemo(() => layer && s.input && s.snapshot && s.changes && profile ? groups.flatMap(domain => domain.boards.map(group => {
    // The explorer query narrows each board to its matching rows; a board with none is hidden.
    const needle = query.toLocaleLowerCase(), matching = group.leaves.filter(leaf => leaf.id.toLocaleLowerCase().includes(needle));
    const id = `${layer}/${group.id}`, shown = matching.length ? matching : group.leaves, leaves = new Set(shown.map(leaf => leaf.id));
    // A runtime-manifest selection is digested from its manifest entry, the only record this canvas renders for it.
    const sourceHashes = canvasSourceDigests([...documents.filter(doc => leaves.has(doc.$extensions["com.clossys.fill"].slot)).map(doc => [doc.$extensions["com.clossys.fill"].source, doc] as const),
      ...(layer === "components" ? [] : s.snapshot!.runtime?.manifest.fills ?? []).filter(fill => leaves.has(fill.leaf)).map(fill => [fill.library, fill] as const),
      // A planned default is digested from its planned row, the only record this canvas renders for it.
      ...(layer === "components" ? [] : Object.values(s.snapshot!.plannedPreviews?.previews ?? {})).filter(row => leaves.has(row.slot)).map(row => [row.source, { slot: row.slot, fill: row.fill, pointer: row.pointer, state: row.state ?? "default" }] as const)]);
    const prepared = prepareCompositeLibraryBoard({ layer, board: { id, label: group.label, leaves: shown }, mode: "view", canSave: false, pending: false,
      input: s.input!, snapshot: s.snapshot!, changes: s.changes!, contracts: s.contracts, profile, sources: values.catalog.sources, labels: t, workflow: candidateWorkflow, sourceHashes });
    return { id, domain: domain.id, hidden: matching.length === 0, records: prepared.records, previews: canvasPreviewPort(prepared.previews) };
  })) : [], [layer, groups, documents, query, profile, s.input, s.snapshot, s.changes, s.contracts, values.catalog.sources, t, candidateWorkflow]);
  const navigate = values.onNavigate, activeLayer = s.layer;
  // Reveal is the board's only command: it selects the row and the Inspector card shows it. Nothing writes.
  const command = useCallback((input: LibraryBoardCommand) => { if (input.command === "reveal") navigate({ layer: activeLayer, leaf: input.leafId }); }, [navigate, activeLayer]);
  const activeBoard = groups.flatMap(domain => domain.boards).find(board => board.leaves.some(leaf => leaf.id === s.leaf));
  const fill = layer ? selectedFill(s, layer, documents) : undefined;
  const prompts = activeBoard && s.input && layer ? (() => {
    const input = { board: { id: `${layer}/${activeBoard.id}`, label: activeBoard.label, leaves: activeBoard.leaves }, leaf: s.leaf, consumer: s.input.library.source.id, slots: s.contracts.slots, profile, workflow: candidateWorkflow, returnStep: t.board.returnStep };
    return { create: compositeBoardPrompt(input), ...(fill ? { refresh: compositeBoardPrompt(input, true) } : {}), ...(candidateWorkflow ? { workflow: candidateWorkflow } : {}) };
  })() : undefined;
  const inspector = values.selected ? <section data-studio-panel="inspector" aria-label={t.inspectorLabel} className="flex min-w-0 flex-col gap-xs"><h2>{s.leaf}</h2>
      <dl data-studio-inspector-identity="" className="flex flex-col gap-xs text-body">
        {([[t.inspector.representedLeaf, s.leaf], [t.layers.label, t.layers[s.layer]], [t.inspector.source, fill?.source], [t.inspector.mode, fill?.mode], [t.inspector.trust, fill?.trust], [t.inspector.status, fill?.status], [t.inspector.pin, fill?.pin ? JSON.stringify(fill.pin) : undefined]] as const).map(([name, value]) => <div key={name} className="flex min-w-0 flex-wrap justify-between gap-sm"><dt className="text-ink-secondary">{name}</dt><dd className="min-w-0 break-words text-ink-primary">{value ?? t.inspector.none}</dd></div>)}
      </dl>
      <h3>{t.whole.contract}</h3><pre className="whitespace-pre-wrap">{JSON.stringify(s.contracts.slots.find(slot => slot.id === s.leaf)?.contract, null, 2)}</pre>
      <h3>{t.inspector.findings}</h3>
      {profile?.components.components[s.leaf] ? <Disclosure title={<>{t.inspector.source}: {profile.components.components[s.leaf]!.descriptor.source}</>}><pre className="whitespace-pre-wrap">{JSON.stringify(profile.components.components[s.leaf], null, 2)}</pre></Disclosure> : null}
      {s.evaluated?.error ? <p role="alert">{s.evaluated.error}</p> : null}
      {profile?.check.findings.filter(f => f.subject === s.leaf || f.subject.startsWith(s.leaf + ".")).map((finding, index) => <p key={index}>{finding.code}: {finding.message}</p>)}
      {s.layer !== "components" ? <><p>{t.whole.unassessed}</p>{s.evaluated?.value?.runtime?.findings.map((finding, index) => <p key={index}>{finding.path}: {finding.message}</p>)}<ContractSignoff contracts={s.contracts} labels={t.whole} none={t.inspector.none} /></> : null}
      {t.usage && s.leaf ? <StudioUsage id={s.leaf} labels={t.usage} /> : null}
      <InspectorChange labels={t} {...(prompts ? { prompts } : {})} />
    </section> : <div className="flex min-w-0 flex-col gap-xs">
      {/* A whole-library refusal is not a leaf's: it stays visible with nothing selected. */}
      {s.evaluated?.error ? <p role="alert">{s.evaluated.error}</p> : null}
      <p data-studio-inspector-empty="" className="text-body-s text-ink-secondary">{t.rail.inspectorEmpty}</p>
    </div>;
  return <div data-studio-body="" className="relative flex h-full w-full min-h-0 min-w-0 flex-1">
    <div data-studio="" data-studio-canvas="" className={["relative isolate min-h-0 min-w-0 flex-1 overflow-hidden", className].filter(Boolean).join(" ")}>
    <CanvasLod zoom={canvas.pose.zoom}><CanvasSurface aria-label={t.canvas.label} viewport={canvas.pose} onViewportChange={canvas.setPose} selection={[]} onSelectionChange={() => {}}
      worldBounds={canvas.bounds} items={[]} itemInteraction="content" minZoom={.12} maxZoom={2} grid="dots"
      onSurfaceElement={canvas.onSurfaceElement} onWorldElement={canvas.onWorldElement} actionsRef={canvas.actions}
      worldClassName="flex h-max w-max flex-col gap-3xl p-3xl" className="absolute inset-0 rounded-none border-0">
      <CanvasBoards boards={boards} labels={t} workflow={candidateWorkflow} onCommand={command} />
    </CanvasSurface></CanvasLod>
    </div>
    <CanvasModules canvas={canvas} labels={t} inspector={inspector} explorerHeader={<LayerSelect />} explorer={<CanvasExplorer labels={t} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} libraries={libraries.map(id => ({ id, available: !activeBoard || (s.layer === "components" ? documents.some(doc => doc.$extensions["com.clossys.fill"].source === id && activeBoard.leaves.some(leaf => leaf.id === doc.$extensions["com.clossys.fill"].slot)) : Boolean(s.snapshot?.runtime?.manifest.fills.some(fill => fill.library === id && activeBoard.leaves.some(leaf => leaf.id === fill.leaf)))) }))}>
      <ExplorerTree query={query} />
    </CanvasExplorer>} />
  </div>;
}

// Leaf/session notifications do not change the complete signoff catalog. Keep
// its mounted disclosure content and expansion while selected findings update.
const ContractSignoff = memo(function ContractSignoff({ contracts, labels, none }: { contracts: BuildCatalogData; labels: CompositeStudioLabels["whole"]; none: string }) {
  return <><h3>{labels.signoff}</h3><p>{labels.proposed}</p>{wholeSignoff(contracts).map(row => <Disclosure key={row.id} title={<>{row.id}</>}><p>{row.placement.join(" / ")}</p><pre>{JSON.stringify(row.contract, null, 2)}</pre><p>{labels.unresolved}: {row.unresolved.join(", ") || none}</p></Disclosure>)}</>;
});

/**
 * The selected fill's metadata for the inspected leaf, read from the evaluated profile and the documents this
 * canvas renders (a runtime-manifest selection carries its library only). Undefined: no fill is chosen.
 */
function selectedFill(s: NonNullable<ReturnType<typeof useWholeStudio>>, layer: "components" | "sections" | "frames", documents: readonly { $extensions: { "com.clossys.fill": import("../catalog-core/index.js").FillMeta } }[]): Partial<import("../catalog-core/index.js").FillMeta> & { source: string } | undefined {
  const profile = s.evaluated?.value?.profile;
  const source = layer === "components" ? profile?.components.components[s.leaf]?.descriptor.source
    : Object.values(profile?.surfaces?.fills ?? {}).find(fill => fill.document.$extensions["com.clossys.fill"].slot === s.leaf)?.document.$extensions["com.clossys.fill"].source
      ?? s.snapshot?.runtime?.manifest.fills.find(fill => fill.leaf === s.leaf)?.library;
  if (!source) return undefined;
  return documents.find(doc => doc.$extensions["com.clossys.fill"].slot === s.leaf && doc.$extensions["com.clossys.fill"].source === source)?.$extensions["com.clossys.fill"] ?? { source };
}

function contractBoards(placement: Placement | undefined) {
  return placement?.nodes.map(domain => ({ ...domain, boards: ("children" in domain ? domain.children : [domain]).map(group => ({ ...group, leaves: placedLeaves([group]) })) })) ?? [];
}
