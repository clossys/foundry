"use client";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import type { BuildCatalogData, CompositeEngineInput, CompositeResolved } from "../catalog-core/index.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument, type SurfaceDefaultsInput } from "../catalog-core/surface-defaults.js";
import type { LibraryBoardCommand, LibraryBoardRecords } from "../blocks/library-board/model.js";
import type { Placement } from "../catalog-core/types.js";
import { useOptionalStudioSession, type StudioSession } from "./StudioProvider.js";
import { useDesignerPreparedLibraryBoards, useWholeStudio, type DesignerPreparedLibraryBoardOptions, type WholeStudioState } from "./WholeStudioProvider.js";
import { Scorecard } from "./Scorecard.js";
import { readStudioMessage, studioCopyNeed, type StudioCopyBinding } from "./copy-binding.js";
import type { CompositeStudioSnapshot, StudioCandidateWorkflow, StudioLabels } from "./types.js";
import { adoptedPackagePreview, plannedSurfacePreview } from "./library-board-adapter.js";
import { planSurfacePreviews, type PlannedSurfacePreviews } from "./planned-surface-previews.js";
import { CanvasBoards, canvasPreviewPort, canvasSourceDigests, type CanvasBoardEntry } from "./canvas-boards.js";
import { prepareValueLibraryBoard } from "./prepared-library-boards.js";
import { ExplorerTree, LayerSelect } from "./rail/ExplorerTree.js";
import { StudioRail } from "./rail/StudioRail.js";

export interface DesignerPageProps {
  /** The host supplies its locale and Writer resolver; no locale is inferred here. */
  readonly copy: StudioCopyBinding;
  readonly workflow?: StudioCandidateWorkflow;
  readonly className?: string;
}

/** Preview-only defaults: the catalog's eligible package compositions, never a library mutation or approval. */
export function designerSurfacePreviews(input: CompositeEngineInput, contracts: BuildCatalogData, hosted?: CompositeStudioSnapshot["plannedPreviews"]): PlannedSurfacePreviews {
  const slots = contracts.slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
  const fills = (input.catalog.surfaces?.fills ?? []) as unknown as readonly SurfaceDefaultCandidateDocument[];
  const plan = planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] });
  const defaults = planSurfacePreviews({ plan, fills });
  const previews = { ...defaults.previews, ...hosted?.previews };
  return { previews, sampleState: hosted?.sampleState ?? defaults.sampleState,
    unrenderable: [...defaults.unrenderable, ...plan.rows.filter(row => row.status === "not-chosen").map(row => ({ slot: row.slot, reason: row.reasons.join("; ") }))]
      .filter(row => !Object.hasOwn(previews, row.slot)),
  };
}

/** A selected surface always resolves its actual descriptor; another source's planned row is never substituted. */
export function designerSurfacePreview(leaf: string, profile: CompositeResolved | undefined, planned: PlannedSurfacePreviews | undefined): { node: ReactNode; state: string } | undefined {
  if (profile?.surfaces?.fills[leaf as `sections.${string}`]) {
    const actual = planned ? { ...planned, previews: Object.fromEntries(Object.entries(planned.previews).filter(([id]) => id !== leaf)) } : undefined;
    return adoptedPackagePreview(leaf, profile, actual);
  }
  return plannedSurfacePreview(planned, leaf);
}

const VIEW_ONLY = { mode: "view", canSave: false, pending: false } as const;

/**
 * A board's title and its rows' names are Writer copy, addressed by the same IA cells the Explorer reads (an L2
 * board is its L1's line; a leaf-bearing L1 is a board); the catalog's English labels never reach the page.
 */
function boardCopy(copy: StudioCopyBinding, placements: readonly Placement[]) {
  const cells = new Map<string, string>();
  for (const { layer, nodes } of placements) for (const node of nodes) {
    if (!("children" in node)) { cells.set(`${layer}/${node.id}`, `studio.ia.board.${layer}/${node.id}`); continue; }
    for (const child of node.children) cells.set(`${layer}/${child.id}`, `studio.ia.line.${layer}/${node.id}/${child.id}`);
  }
  return (records: LibraryBoardRecords): LibraryBoardRecords => {
    const cell = cells.get(records.rows.boardId);
    if (!cell) return studioCopyNeed(`studio.ia.board.${records.rows.boardId}`);
    return { ...records, rows: { ...records.rows, label: readStudioMessage(copy, cell),
      items: records.rows.items.map(item => ({ ...item, label: readStudioMessage(copy, `studio.ia.item.${item.id}`) })) } };
  };
}
const fillSource = (document: unknown): string | undefined => (document as { $extensions?: Record<string, { source?: unknown }> } | undefined)?.$extensions?.["com.clossys.fill"]?.source as string | undefined;

/**
 * Page-local digests of the exact composite documents the boards render for each source (contract layers). Like
 * the value boards' digests, they bind a preview identity to those bytes and certify nothing about provenance.
 */
function compositeDigests(whole: WholeStudioState): Readonly<Record<string, string>> {
  const input = whole.input;
  if (!input) return {};
  const documents: (readonly [string, unknown])[] = [];
  const add = (document: unknown, source = fillSource(document)) => { if (source) documents.push([source, document]); };
  for (const document of input.catalog.components.fills) add(document);
  for (const document of [...(input.catalog.surfaces?.fills ?? []), ...(input.library.surfaces?.fills ?? [])]) add(document);
  for (const fill of whole.snapshot?.runtime?.manifest.fills ?? []) add(fill, fill.library);
  return canvasSourceDigests(documents);
}

/** The value boards' digests: each source maps to the exact candidate documents its rows render. */
const valueDigests = (session: StudioSession): Readonly<Record<string, string>> =>
  canvasSourceDigests(session.boards.flatMap(board => board.rows.flatMap(row => row.candidates.map(candidate => [candidate.source, candidate.fill] as const))));

/** A whole Studio: every layer's boards come from the original prepared library-board accessor. */
function WholeBoards({ whole, session, copy, workflow, children }: { whole: WholeStudioState; session: StudioSession; copy: StudioCopyBinding; workflow?: StudioCandidateWorkflow; children: (boards: readonly CanvasBoardEntry[]) => ReactNode }) {
  const valueLayer = whole.layer === "themes" || whole.layer === "assets";
  const sourceHashes = useMemo(() => valueLayer ? valueDigests(session) : compositeDigests(whole), [valueLayer, session.boards, whole.input, whole.snapshot]);
  const board = useCallback<DesignerPreparedLibraryBoardOptions["board"]>(() => ({ ...VIEW_ONLY, sourceHashes }), [sourceHashes]);
  const prepared = useDesignerPreparedLibraryBoards(useMemo(() => ({ board, ...(workflow ? { workflow } : {}) }), [board, workflow]));
  const boards = useMemo(() => {
    if (prepared.status !== "prepared") return [];
    // The projection's placements are the authority its boards were reconciled against.
    const bind = boardCopy(copy, prepared.projection.placements);
    return prepared.boards.map((entry, index) => {
      const id = prepared.projection.boards[index]!.id;
      return { id, domain: whole.layer, records: bind(entry.records), previews: canvasPreviewPort(entry.previews) };
    });
  }, [prepared, whole.layer, copy]);
  return <>{children(boards)}</>;
}

/** A value-only Studio: its session's boards, prepared exactly as the whole Studio prepares value boards. */
function ValueBoards({ session, copy, workflow, children }: { session: StudioSession; copy: StudioCopyBinding; workflow?: StudioCandidateWorkflow; children: (boards: readonly CanvasBoardEntry[]) => ReactNode }) {
  const selectionHash = session.resolved?.selectionHash;
  const boards = useMemo(() => {
    if (!session.working || !selectionHash) return [];
    const sourceHashes = valueDigests(session);
    const variants = Object.fromEntries(session.activeCatalog.slots.filter(slot => slot.contract.members.mode === "closed").map(slot => [slot.id, slot.contract.members.mode === "closed" ? slot.contract.members.names.map(name => `${slot.id}.${name}`) : []]));
    const bind = boardCopy(copy, session.activeCatalog.placements);
    const contextTokens = Object.entries(session.resolved?.members ?? {}).filter(([, member]) => member.slot.startsWith("themes.")).map(([id, member]) => ({ id, value: member.css.light }));
    return session.boards.map(board => {
      const prepared = prepareValueLibraryBoard({ ...VIEW_ONLY, sourceHashes, layer: session.layer, board, sources: session.catalog.sources, consumerSource: session.working!.source.id, selectionHash, labels: session.labels, workflow, contextTokens, variants });
      return { id: board.id, domain: session.layer, records: bind(prepared.records), previews: canvasPreviewPort(prepared.previews) };
    });
  }, [session.boards, session.working, session.layer, session.catalog.sources, session.activeCatalog, session.resolved, session.labels, selectionHash, workflow, copy]);
  return <>{children(boards)}</>;
}

const hasIntersectionObserver = (): boolean => typeof IntersectionObserver === "function";

/**
 * One page, one vertical scroll (owner, 2026-10-28): every board of the active layer is the registered library-board
 * Section, stacked as a page block with its own anchor; the rail's Explorer switches layers and scrolls a board or
 * row into view. Rows evaluate as they scroll into view (bounded, never all at once). View-only: nothing writes.
 */
export function DesignerPage({ copy, workflow, className }: DesignerPageProps) {
  const session = useOptionalStudioSession(), whole = useWholeStudio();
  if (!copy || typeof copy.locale !== "string" || !copy.locale || typeof copy.resolver !== "function") studioCopyNeed("studio.copy.binding");
  if (!session) throw new TypeError("StudioProvider");
  const labels: StudioLabels = session.labels;
  const latest = useRef(session); latest.current = session;
  const scroll = useRef<HTMLElement | null>(null);
  const visible = useRef(new Set<string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const publish = useCallback(() => latest.current.showRows(new Set(visible.current)), []);
  useEffect(() => {
    if (!hasIntersectionObserver()) return;
    const next = new IntersectionObserver(entries => {
      for (const entry of entries) { const id = (entry.target as HTMLElement).dataset.designerRow; if (!id) continue; if (entry.isIntersecting) visible.current.add(id); else visible.current.delete(id); }
      publish();
    }, { root: scroll.current, rootMargin: "50% 0%" });
    observer.current = next;
    for (const row of latest.current.rowElements.current.values()) next.observe(row);
    return () => { next.disconnect(); observer.current = null; };
  }, [publish]);
  // Without an IntersectionObserver (server, tests) every mounted row is shown, so the page stays deterministic.
  const registerRow = useCallback((id: string, element: HTMLElement | null) => {
    const elements = latest.current.rowElements.current, previous = elements.get(id);
    if (previous && previous !== element) { observer.current?.unobserve(previous); visible.current.delete(id); }
    if (element) { elements.set(id, element); element.dataset.designerRow = id; if (observer.current) observer.current.observe(element); else visible.current.add(id); }
    else elements.delete(id);
    if (!observer.current) publish();
  }, [publish]);
  const registerBoard = useCallback((id: string, element: HTMLElement | null) => {
    const elements = latest.current.boardElements.current;
    if (element) elements.set(id, element); else elements.delete(id);
  }, []);
  // The Explorer's reveal scrolls the board (or the row's board) into view; a leaf's row is demanded so it evaluates.
  const reveal = useCallback((id: string) => {
    const current = latest.current;
    const board = current.boards.find(board => board.id === id || board.leaves.includes(id));
    const target = current.rowElements.current.get(id) ?? current.boardElements.current.get(id) ?? (board ? current.boardElements.current.get(board.id) : undefined);
    if (current.rowElements.current.has(id)) current.requestRow(id);
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => { session.canvasActions.current = { reveal }; return () => { session.canvasActions.current = null; }; }, [session.canvasActions, reveal]);
  // Reveal is the boards' only command: it selects the row's leaf. Nothing writes.
  const command = useCallback((input: LibraryBoardCommand) => {
    if (input.command !== "reveal") return;
    latest.current.select(input.leafId); latest.current.requestRow(input.leafId, input.source);
  }, []);
  const checks = session.summary ? <Scorecard copy={copy} summary={session.summary} labels={labels} onClose={() => {}} onIssue={leaf => { const layer = session.catalog.slots.find(slot => slot.id === leaf)?.layer; if (layer) session.onNavigate({ layer, leaf }); }} />
    : <SemanticContent as="p">{whole?.evaluated?.error ? readStudioMessage(copy, "studio.evaluation.error") : labels.scorecard.target}</SemanticContent>;
  const page = (boards: readonly CanvasBoardEntry[]) => <SemanticContent as="section" data-designer-page="" data-designer-ready={session.ready ? "" : undefined} aria-label={labels.stageLabel} className={"relative flex h-full min-h-0 min-w-0 " + (className ?? "")}>
    <SemanticContent as="section" ref={scroll} data-designer-region="scroll" aria-label={labels.canvas.label} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
      <SemanticContent as="div" data-studio-world="" data-designer-scroll="" className="flex min-w-0 flex-col gap-3xl p-3xl">
        {session.phase.status === "loading" ? <SemanticContent as="p" role="status">{labels.loading}</SemanticContent> : null}
        <CanvasBoards boards={boards} labels={labels} workflow={workflow} onCommand={command} onBoardElement={registerBoard} onRowElement={registerRow} />
      </SemanticContent>
    </SemanticContent>
    <StudioRail labels={labels} explorer={<ExplorerTree copy={copy} labels={labels} />} explorerHeader={<LayerSelect labels={labels} />} checks={checks} />
  </SemanticContent>;
  return whole ? <WholeBoards whole={whole} session={session} copy={copy} workflow={workflow}>{page}</WholeBoards> : <ValueBoards session={session} copy={copy} workflow={workflow}>{page}</ValueBoards>;
}
