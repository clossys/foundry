"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Banner } from "../atoms/Banner.js";
import { Disclosure } from "../atoms/Disclosure.js";
import { TOKENS } from "../tokens/tokens.js";
import { cx } from "../atoms/internal/cx.js";
import type { CatalogData, ChangeSet, Finding, LibraryData, Selection } from "../catalog-core/index.js";
import { studioEngine } from "./engine.js";
import { Inspector } from "./Inspector.js";
import { Board } from "./Board.js";
import { matrixBoards, matrixRows, matrixSources, matrixSummary, purePlacementTree, type MatrixRow } from "./matrix-model.js";
import { DEFAULT_SLOT_ID, addChanges, allNodes, changesFor, emptyChanges, pendingCount, pickAt, scopeTargets, workingSelection, type Candidate, type Change } from "./model.js";
import { candidatesCss, liveCss } from "./preview-css.js";
import { Scorecard } from "./Scorecard.js";
import { SlotTree } from "./SlotTree.js";
import { StudioTopBar } from "./StudioTopBar.js";
import type { StudioProps } from "./types.js";
import { useStudioLayout, type StudioLayout } from "./use-layout.js";

type Phase = { status: "loading" } | { status: "error" } | { status: "ready"; library: LibraryData; base: Selection };
type SaveFailure = { reason: "unavailable" | "conflict" | "invalid" | "failed"; findings?: readonly Finding[] };
const GRID_CLASSES: Record<StudioLayout, string> = {
  wide: "grid grid-cols-[17.5rem_1fr_22.5rem] items-start gap-md",
  medium: "grid grid-cols-[17.5rem_1fr] items-start gap-md",
  narrow: "flex flex-col gap-md",
};

/** A selection-only library matrix. All copy comes from labels and all persistence goes through the adapter. */
export function Studio({ catalog: catalogProp, adapter, labels, initialSlotId = DEFAULT_SLOT_ID, livePreview = true, className }: StudioProps): ReactElement {
  const catalog: CatalogData = useMemo(() => catalogProp ?? adapter.catalog ?? studioEngine.loadCatalog(), [catalogProp, adapter.catalog]);
  const layout = useStudioLayout();
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [changes, setChanges] = useState<ChangeSet | undefined>(undefined);
  const [slotId, setSlotId] = useState(initialSlotId);
  const scrollElements = useRef(new Map<string, HTMLElement>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedCell, setFocusedCell] = useState<{ row: string; source?: string }>({ row: initialSlotId });
  const [focusTarget, setFocusTarget] = useState<{ id: string; serial: number }>();
  const [groupChoices, setGroupChoices] = useState<Record<string, string>>({});
  const savedGroups = useRef<Record<string, string>>({});
  const [scoreOpen, setScoreOpen] = useState(false);
  const scoreTrigger = useRef<HTMLElement | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure>();
  const adapterRef = useRef(adapter);
  const mounted = useRef(true);
  const lastSafe = useRef("");
  useEffect(() => {
    mounted.current = true;
    adapterRef.current.load().then(
      ({ library, selection }) => { if (mounted.current) setPhase({ status: "ready", library, base: selection }); },
      () => { if (mounted.current) setPhase({ status: "error" }); },
    );
    return () => { mounted.current = false; };
  }, []);
  const ready = phase.status === "ready" ? phase : undefined;
  const base = ready?.base;
  const library = ready?.library;
  const pending = useMemo(() => base ? changes ?? emptyChanges(base) : undefined, [base, changes]);
  const working = useMemo(() => base && pending ? workingSelection({ base, changes: pending }) : undefined, [base, pending]);
  const tree = useMemo(() => purePlacementTree(catalog.placements), [catalog]);
  const groups = useMemo(() => allNodes(catalog.placements.filter(placement => placement.layer === "tokens")), [catalog]);
  const counts = useMemo(() => Object.fromEntries(catalog.slots.filter(slot => slot.layer === "tokens").map(slot => [slot.id, library ? scopeTargets({ catalog, library, slotId: slot.id, scope: "member" }).length : 0])), [catalog, library]);
  const candidateCache = useMemo(() => new Map<string, Candidate[]>(), [catalog, library, working]);
  const rows = useMemo(() => library && working && pending ? matrixRows({ catalog, library, working, cache: candidateCache, changes: pending, expanded }) : [], [catalog, library, working, candidateCache, pending, expanded]);
  const boards = useMemo(() => library && working ? matrixBoards({ catalog, library, working }, rows) : [], [catalog, library, working, rows]);
  const sources = useMemo(() => library ? matrixSources({ catalog, library }) : [], [catalog, library]);
  const summary = useMemo(() => library && working ? matrixSummary({ catalog, library, working, cache: candidateCache }) : undefined, [catalog, library, working, candidateCache]);
  const resolved = useMemo(() => library && working ? studioEngine.resolve({ catalog, library, selection: working }) : undefined, [catalog, library, working]);
  const focusedRow = rows.find(row => row.id === focusedCell.row) ?? rows.find(row => row.scope === "slot") ?? rows[0];
  const focused = focusedRow?.candidates.find(candidate => candidate.source === focusedCell.source) ?? focusedRow?.candidates.find(candidate => candidate.selected) ?? focusedRow?.candidates.find(candidate => candidate.inUseByDefault) ?? focusedRow?.candidates[0];
  const live = library && working ? liveCss({ catalog, library, working, previous: lastSafe.current }) : undefined;
  if (live) lastSafe.current = live.css;
  const apply = (list: readonly Change[]): void => {
    if (!base || !pending) return;
    setChanges(addChanges({ base, changes: pending, list }));
    setFailure(undefined);
  };
  const use = (row: MatrixRow, source: string): void => {
    if (!library || !row.candidates.find(candidate => candidate.source === source)?.usable) return;
    apply(changesFor({ catalog, library, scope: row.scope, target: row.target, source }));
    if (row.scope === "node") setGroupChoices(current => ({ ...current, [row.target]: source }));
  };
  const resetList = library && focusedRow ? changesFor({ catalog, library, scope: focusedRow.scope, target: focusedRow.target }) : [];
  const canReset = working !== undefined && resetList.some((entry) => entry.op === "clear" && pickAt(working, entry.scope, entry.target) !== undefined);
  const save = async (): Promise<void> => {
    if (!pending) return;
    setSaving(true); setFailure(undefined);
    try {
      const result = await adapterRef.current.save(pending);
      if (!mounted.current) return;
      if (result.ok) {
        setPhase(current => current.status === "ready" ? { ...current, base: result.selection } : current);
        setChanges(emptyChanges(result.selection));
        savedGroups.current = groupChoices;
      } else setFailure({ reason: result.reason, ...(result.findings ? { findings: result.findings } : {}) });
    } catch { if (mounted.current) setFailure({ reason: "failed" }); }
    finally { if (mounted.current) setSaving(false); }
  };
  const closeScore = (): void => { setScoreOpen(false); scoreTrigger.current?.focus(); };
  const treeCell = layout === "medium" ? "min-w-0 row-span-2" : "min-w-0";
  const selectNode = (id: string): void => {
    setSlotId(id);
    const group = groups.find(group => group.id === id);
    const board = boards.find(board => board.id === id || board.leaves.includes(id) || group?.leaves.some(leaf => board.leaves.includes(leaf)));
    const target = scrollElements.current.get(id) ?? (board ? scrollElements.current.get(board.id) : undefined);
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (rows.some(row => row.id === id)) setFocusedCell({ row: id });
  };
  const treeNode = <SlotTree nodes={tree} placements={catalog.placements.filter(placement => placement.layer === "tokens")} counts={counts} memberCount={labels.memberCount} label={labels.treeLabel} slotId={slotId} onSelect={selectNode} />;
  return <div data-studio="" data-layout={layout} className={cx("flex min-w-0 flex-col gap-md text-ink-primary", className)}>
    {livePreview && live?.css ? <style data-studio-preview="">{live.css}</style> : null}
    {ready ? <style data-studio-candidates="">{candidatesCss(rows.flatMap(row => row.candidates))}</style> : null}
    {phase.status === "error" ? <Banner variant="danger">{labels.loadFailed}</Banner> : null}
    {phase.status === "loading" ? <p role="status" className="text-body text-ink-secondary">{labels.loading}</p> : null}
    {ready && pending && working && summary ? <StudioTopBar labels={labels} pending={pendingCount(pending)} canSave={adapter.canSave} saving={saving} summary={summary} scoreOpen={scoreOpen}
      onScore={target => { scoreTrigger.current = target; setScoreOpen(current => !current); }} onSave={() => { void save(); }}
      onDiscard={() => { setChanges(emptyChanges(ready.base)); setGroupChoices(savedGroups.current); setFailure(undefined); }}>
      <div className="flex min-w-0 flex-col gap-md">
        {scoreOpen ? <Scorecard summary={summary} labels={labels} onClose={closeScore} onIssue={id => { selectNode(id); setFocusedCell({ row: id }); setFocusTarget(current => ({ id, serial: (current?.serial ?? 0) + 1 })); }} /> : null}
        {failure ? <Banner variant="danger">{labels.saveFailed[failure.reason]}{failure.findings?.length ? <ul>{failure.findings.map((finding, index) => <li key={`${finding.code}:${finding.subject}:${index}`}>{finding.message}</li>)}</ul> : null}</Banner> : null}
        <p className="text-caption text-ink-secondary">{labels.scope.explanation}</p>
        <div className={GRID_CLASSES[layout]}>
          <div className={treeCell}>{layout === "narrow" ? <Disclosure title={labels.treeLabel}>{treeNode}</Disclosure> : treeNode}</div>
          <section aria-label={labels.stageLabel} className="flex min-w-0 flex-col gap-sm">
            <h2 className="text-body">{labels.scope.label}</h2>
            <div className="flex flex-wrap gap-sm text-caption text-ink-secondary"><span>{labels.scope.member}</span><span>{labels.scope.slot}</span><span>{labels.scope.node}</span></div>
            <div data-studio-boards="" className="flex min-w-0 flex-col gap-md overflow-y-auto" style={{ maxBlockSize: `var(--ui-table-max-block-default, ${TOKENS["--ui-table-max-block-default"]!.value})` }}>
              {boards.map(board => <Board key={board.id} board={board} boardRef={element => { if (element) scrollElements.current.set(board.id, element); else scrollElements.current.delete(board.id); }} sources={sources} labels={labels} working={working} changes={pending} groups={groups} groupChoices={groupChoices} expanded={expanded} layout={layout}
                onExpand={id => setExpanded(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; })} onUse={use}
                onRowElement={(id, element) => { if (element) scrollElements.current.set(id, element); else scrollElements.current.delete(id); }}
                onFocusCell={(row, candidate) => setFocusedCell(current => current.row === row.id && current.source === candidate.source ? current : { row: row.id, source: candidate.source })} {...(focusTarget ? { focusTarget } : {})} />)}
            </div>
          </section>
          <aside aria-label={labels.inspectorLabel} className="min-w-0">{focused && focusedRow ? <Inspector candidate={focused} labels={labels} canReset={canReset} {...(resolved ? { resolved } : {})} tier={catalog.slots.find(slot => slot.id === focused.fill.slot)?.contract.tier}
            onReset={() => { apply(resetList); if (focusedRow.scope === "node") setGroupChoices(current => { const next = { ...current }; delete next[focusedRow.target]; return next; }); }} /> : null}</aside>
        </div>
      </div>
    </StudioTopBar> : null}
  </div>;
}
