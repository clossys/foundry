"use client";
import { Disclosure } from "../components/Disclosure.js";

import { memo, useCallback, useId, useMemo, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import type { LayerId, Placement, CompositeResolved, CompositeLibraryOperation, BuildCatalogData } from "../catalog-core/index.js";
import { Button } from "../components/Button.js";
import { SearchField } from "../components/SearchField.js";
import { RadioGroup } from "../components/RadioGroup.js";
import { useStudioSession } from "./StudioProvider.js";
import { useWholeStudio, type WholeStudioState } from "./WholeStudioProvider.js";
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
import { Matrix as Comparison } from "../blocks/Matrix.js";
import { Badge } from "../components/Badge.js";
import { Tooltip } from "../components/Tooltip.js";
import { PREVIEW_CHOICE_CLASS } from "./CandidateChoice.js";
import { CandidateCell } from "./CandidateCell.js";
import { ErrorReason } from "../blocks/library-board/ErrorReason.js";
import { BoardHeader, LeafCell } from "../blocks/library-board/LeafCell.js";
import { CandidatePromptDialog } from "./CandidatePromptDialog.js";
import { Table } from "../components/Table.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { CanvasLod, CanvasLodLayers } from "../blocks/canvas/CanvasLod.js";
import { useCanvasWorld } from "./useCanvasWorld.js";
import { CanvasDomain } from "./CanvasDomain.js";
import { placedLeaves, previewComponent, wholeSignoff } from "./whole-model.js";
import { compositeBoardPrompt } from "./prepared-library-boards.js";
import type { StudioCanvasProps, StudioHeaderProps, CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";

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
  const errors = findings.filter(f => f.severity === "error").length;
  return <><StudioStatus labels={s.labels} state={s.valueSession && s.feedback ? { ...s.valueSession, ...s.feedback } : undefined} />
    <Button variant="ghost" onPress={() => s.setScore(v => !v)} aria-expanded={s.score}>{s.labels.scorecard.title}</Button>
    {s.score && (s.layer === "tokens" || s.layer === "assets") && values.summary ? <Scorecard summary={values.summary} labels={s.labels} onClose={() => s.setScore(false)} onIssue={id => values.canvasActions.current?.reveal(id, true)} /> : s.score ? <section aria-label={s.labels.scorecard.title} className="border border-line-base bg-surface-base p-md"><Button onPress={() => s.setScore(false)}>{s.labels.scorecard.close}</Button><p>{s.labels.scorecard.title}</p><p>{runtimeLayer ? s.labels.whole.unassessed : s.labels.checkSummary(errors, 0)}</p>{!runtimeLayer ? <p>{s.labels.whole.unassessed}</p> : null}{findings.map((f, i) => <p key={i}>{f.code}: {f.message}</p>)}{s.evaluated?.error ? <p role="alert">{s.evaluated.error}</p> : null}</section> : null}
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
  const s = useWholeStudio()!; const t = s.labels; const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<import("./canvas-model.js").CanvasFilter>("all");
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const placement = s.contracts.placements.find(p => p.layer === s.layer);
  const canvas = useCanvasWorld(s.layer, undefined, undefined, Boolean(placement?.nodes.length));
  const profile = s.evaluated?.value?.profile;
  const boards = useMemo(() => contractBoards(placement), [placement]);
  const candidates = useMemo(() => s.input && s.changes && s.layer === "components" ? s.adapter.catalog.components.fills.map(doc => {
    const meta = doc.$extensions["com.clossys.fill"];
    let node: ReactNode; let error: string | undefined;
    const edited = boards.some(domain => domain.boards.some(board => editing.has(`${s.layer}/${board.id}`) && board.leaves.some(leaf => leaf.id === meta.slot)));
    // View mode uses the evaluated selection; alternative profiles belong to open edit boards.
    const result = edited ? previewComponent(s.input!, meta.slot, meta.source, s.changes!) : undefined;
    if (edited && result?.available && !result.findings.some(finding => finding.severity === "error")) try { node = s.snapshot?.preview?.(meta.slot, result.profile); } catch (value) { error = value instanceof Error ? value.message : String(value); }
    return { meta, result, node, error };
  }) : [], [s.layer, s.input?.library, s.adapter.catalog, s.snapshot, s.changes, boards, editing]);
  // Session notifications leave placement and query unchanged; keep the explorer's immutable nodes.
  const tree = useMemo(() => placement?.nodes.map(domain => ({ id: domain.id, label: domain.label, children: ("children" in domain ? domain.children : [domain]).map(group => ({ id: group.id, label: group.label, children: placedLeaves([group]).filter(leaf => leaf.id.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(leaf => ({ id: leaf.id, label: leaf.id })) })) })) ?? [], [placement, query]);
  const libraries = useMemo(() => [...new Set(s.layer === "components" ? candidates.map(candidate => candidate.meta.source) : s.snapshot?.runtime?.manifest.fills.map(fill => fill.library) ?? [])], [s.layer, candidates, s.snapshot?.runtime]);
  const session = s.session;
  const edit = useCallback((leaf: string, operations: readonly CompositeLibraryOperation[]) => { session?.edit(leaf, operations); }, [session]);
  const activeBoard = boards.flatMap(domain => domain.boards).find(board => board.leaves.some(leaf => leaf.id === s.leaf));
  const actions = canvas.actions;
  const open = useCallback((element: HTMLElement) => actions.current?.flyTo(element, { focus: true }), [actions]);
  return <div data-studio="" data-studio-canvas="" className={["relative isolate min-h-0 flex-1 overflow-hidden", className].filter(Boolean).join(" ")}>
    <CanvasSurface aria-label={t.canvas.label} viewport={canvas.pose} onViewportChange={canvas.setPose} selection={[]} onSelectionChange={() => {}}
      worldBounds={canvas.bounds} items={[]} itemInteraction="content" minZoom={.12} maxZoom={2} grid="dots"
      onSurfaceElement={canvas.onSurfaceElement} onWorldElement={canvas.onWorldElement} actionsRef={canvas.actions}
      worldClassName="flex h-max w-max flex-col gap-3xl p-3xl" className="absolute inset-0 rounded-none border-0">
      <CanvasLod zoom={canvas.pose.zoom}><ContractBoards narrow={canvas.overlayLayout === "narrow"} boards={boards} layer={s.layer} query={query} editing={editing} setEditing={setEditing} open={open}
        candidates={candidates} libraries={libraries} profile={profile} previewLeaf={s.snapshot?.preview} runtime={s.snapshot?.runtime}
        slots={s.contracts.slots} consumer={s.input?.library.source.id} t={t} candidateWorkflow={candidateWorkflow}
        setLeaf={s.setLeaf} edit={edit} canEdit={Boolean(s.changes)} /></CanvasLod>
    </CanvasSurface>
    <CanvasModules canvas={canvas} labels={t} explorer={<CanvasExplorer labels={t} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} libraries={libraries.map(id => ({ id, available: !activeBoard || (s.layer === "components" ? candidates.some(candidate => candidate.meta.source === id && activeBoard.leaves.some(leaf => leaf.id === candidate.meta.slot)) : Boolean(s.snapshot?.runtime?.manifest.fills.some(fill => fill.library === id && activeBoard.leaves.some(leaf => leaf.id === fill.leaf)))) }))}>
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
type ContractCandidate = {
  meta: WholeStudioState["adapter"]["catalog"]["components"]["fills"][number]["$extensions"]["com.clossys.fill"];
  result: ReturnType<typeof previewComponent> | undefined;
  node: ReactNode;
  error: string | undefined;
};
interface ContractBoardsProps {
  narrow: boolean;
  boards: ReturnType<typeof contractBoards>;
  layer: LayerId;
  query: string;
  editing: ReadonlySet<string>;
  setEditing: Dispatch<SetStateAction<ReadonlySet<string>>>;
  candidates: readonly ContractCandidate[];
  libraries: readonly string[];
  profile: CompositeResolved | undefined;
  previewLeaf: CompositeStudioSnapshot["preview"];
  runtime: CompositeStudioSnapshot["runtime"];
  slots: BuildCatalogData["slots"];
  consumer: string | undefined;
  t: CompositeStudioLabels;
  candidateWorkflow: StudioCanvasProps["candidateWorkflow"];
  setLeaf(id: string): void;
  edit(leaf: string, operations: readonly CompositeLibraryOperation[]): void;
  canEdit: boolean;
  open(board: HTMLElement): void;
}
// Session revision notifications also reach this canvas through portal blur.
// Only actual board inputs should prepare its tables, previews and prompts again.
const ContractBoards = memo(function ContractBoards({ narrow, boards, layer, query, editing, setEditing, candidates, libraries, profile, previewLeaf, runtime, slots, consumer, t, candidateWorkflow, setLeaf, edit, canEdit, open }: ContractBoardsProps) {
  const headingBase = useId();
  return <>{boards.map(domain => <CanvasDomain key={domain.id} id={domain.id} label={domain.label} narrow={narrow}>
        {domain.boards.map(board => {
          const leaves = board.leaves.filter(leaf => !query || leaf.id.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
          const columns = libraries.filter(id => layer === "components" ? candidates.some(candidate => candidate.meta.source === id && board.leaves.some(leaf => leaf.id === candidate.meta.slot)) : runtime?.manifest.fills.some(fill => fill.library === id && board.leaves.some(leaf => leaf.id === fill.leaf)));
          const boardKey = `${layer}/${board.id}`;
          const isEditing = editing.has(boardKey);
          const setBoardEditing = (value: boolean) => setEditing(previous => { const next = new Set(previous); if (value) next.add(boardKey); else next.delete(boardKey); return next; });
          const data = (id: string, refresh = false) => compositeBoardPrompt({ board: { id: boardKey, label: board.label, leaves }, leaf: id, consumer: consumer ?? "", slots, profile, workflow: candidateWorkflow, returnStep: t.board.returnStep }, refresh);
          const prompt = (id: string, refresh = false) => <CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{refresh ? t.board.refresh : t.board.create}</Button>} data={data(id, refresh)} labels={t} workflow={candidateWorkflow} />;
          const findings = profile?.check.findings.filter(finding => board.leaves.some(leaf => finding.subject === leaf.id || finding.subject.startsWith(leaf.id + "."))) ?? [];
          const summary = t.checkSummary(findings.filter(finding => finding.severity === "error").length, findings.filter(finding => finding.severity === "notice").length);
          const chosen = (id: string) => profile?.components.components[id]?.descriptor.source ?? runtime?.manifest.fills.find(fill => fill.leaf === id)?.library;
          return <section key={board.id} tabIndex={-1} data-studio-board={boardKey} data-board-mode={isEditing ? "edit" : "view"} aria-labelledby={`${headingBase}${boardKey}`} className="h-max w-max shrink-0 rounded-surface border border-line-base bg-surface-base p-md">
            <BoardHeader id={`${headingBase}${boardKey}`} title={board.label} editing={isEditing} labels={t.board} onEdit={() => setBoardEditing(true)} onDone={() => setBoardEditing(false)} />
            <CanvasLodLayers compact={<div data-studio-zoom-compact="" className="flex flex-col gap-md text-h0">
              <p className="break-words text-ink-secondary">{summary}</p>
              <ul className="flex flex-col gap-sm">{leaves.map(leaf => { const source = chosen(leaf.id); return <li key={leaf.id} className="break-words"><span className="text-ink-primary">{leaf.id}</span> <span className={source ? "text-ink-secondary" : "text-ink-muted"}>{source ?? t.board.notChosen}</span></li>; })}</ul>
            </div>}
            overview={<div data-studio-zoom-summary="" className="flex flex-col items-start gap-md">
              <p className="break-words text-display-xl text-ink-primary">{board.label}</p>
              <p className="break-words text-display-m text-ink-secondary">{summary}</p>
              <Button variant="ghost" size="sm" onPress={event => { const element = (event.target as HTMLElement).closest<HTMLElement>("[data-studio-board]"); if (element) open(element); }}>{t.canvas.openBoard(board.label)}</Button>
            </div>}
            full={<div data-studio-zoom-full="" className="w-max">{!isEditing ? <Table aria-label={t.matrix.label} className="w-max"><Table.Header><Table.Column id="leaf" isRowHeader>{t.matrix.leaf}</Table.Column><Table.Column id="preview"><span className="sr-only">{t.stageLabel}</span></Table.Column></Table.Header><Table.Body>{leaves.map(leaf => {
              const selected = profile?.components.components[leaf.id];
              const runtimeSelected = Object.keys(profile?.surfaces?.fills ?? {}).includes(leaf.id) || runtime?.manifest.fills.some(fill => fill.leaf === leaf.id);
              let preview: ReactNode;
              if (selected || runtimeSelected) try { preview = profile ? previewLeaf?.(leaf.id, profile) : undefined; } catch { /* Findings remain in the inspector; preview never fabricates a sample. */ }
              return <Table.Row key={leaf.id} id={leaf.id} data-studio-row={leaf.id}><Table.Cell>{leaf.id}</Table.Cell><Table.Cell>{selected || runtimeSelected ? <CandidateCell labels={t} preview={preview} /> : <LeafCell status={t.board.notChosen} actions={<><Button variant="ghost" size="sm" onPress={() => setBoardEditing(true)}>{t.board.choose}</Button><CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{t.board.askAgent}</Button>} data={data(leaf.id)} labels={t} workflow={candidateWorkflow} /></>} />}</Table.Cell></Table.Row>;
            })}</Table.Body></Table> : layer === "components" ? <Comparison arrangement="choices" aria-label={t.matrix.label} columns={[...columns.map(id => ({ id, label: id })), { id: "studio-custom-actions", label: t.board.custom }]} onFocusCell={id => setLeaf(id)}
              onChange={(id, source) => { const candidate = candidates.find(candidate => candidate.meta.slot === id && candidate.meta.source === source); if (candidate?.result?.available && !candidate.result.findings.some(f => f.severity === "error") && canEdit) edit(id, [candidate.result.change]); }}
              rows={leaves.map(leaf => ({ id: leaf.id, label: leaf.id, name: <>{t.useGroup} {leaf.id}</>, selected: profile?.components.components[leaf.id]?.descriptor.source ?? null,
                cells: { "studio-custom-actions": <div className="flex gap-sm">{prompt(leaf.id)}{profile?.components.components[leaf.id]?.descriptor.source === consumer ? prompt(leaf.id, true) : null}</div>, ...Object.fromEntries(columns.map(source => {
                  const candidate = candidates.find(candidate => candidate.meta.slot === leaf.id && candidate.meta.source === source);
                  if (!candidate?.result) return [source, null];
                  const errors = candidate.result.findings.filter(f => f.severity === "error").length + (candidate.error || !candidate.result.available ? 1 : 0);
                  const notices = candidate.result.findings.filter(f => f.severity === "notice").length;
                  return [source, <div className="relative"><RadioGroup.Radio value={source} aria-label={t.useSource(source, leaf.id)} isDisabled={!candidate.result.available || errors > 0} className={PREVIEW_CHOICE_CLASS}><CandidateCell labels={t} preview={candidate.node} /></RadioGroup.Radio>
                    {errors > 0 ? <Tooltip trigger={<Button variant="ghost" size="sm" aria-label={t.checkSummary(errors, notices)}><Badge variant="danger">!</Badge></Button>}>{t.checkSummary(errors, notices)}{candidate.result.findings.map((finding, index) => <p key={index}>{finding.code}: {finding.message}</p>)}{candidate.error ?? (!candidate.result.available ? candidate.result.error : null)}</Tooltip> : null}
                    {errors > 0 ? <ErrorReason findings={candidate.result.findings} /> : null}
                  </div>];
                })) }
              }))} /> : leaves.map(leaf => {
                let node: ReactNode; let error: string | undefined;
                try { node = profile ? previewLeaf?.(leaf.id, profile) : undefined; } catch (value) { error = value instanceof Error ? value.message : String(value); }
                return <section key={leaf.id} data-studio-row={leaf.id} className="p-sm"><h4>{leaf.id}</h4><p>{t.whole.unassessed}</p>{node}{error ? <Tooltip trigger={<Button variant="ghost" aria-label={t.checkSummary(1, 0)}><Badge variant="danger">!</Badge></Button>}>{error}</Tooltip> : null}{prompt(leaf.id)}</section>;
              })}</div>} />
          </section>;
        })}
      </CanvasDomain>)}</>;
});
