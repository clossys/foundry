"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Banner } from "../atoms/Banner.js";
import { Disclosure } from "../atoms/Disclosure.js";
import { cx } from "../atoms/internal/cx.js";
import type { CatalogData, ChangeSet, Finding, LibraryData, Selection } from "../catalog-core/index.js";
import { CandidateStage } from "./CandidateStage.js";
import { studioEngine } from "./engine.js";
import { Inspector } from "./Inspector.js";
import { DEFAULT_SLOT_ID, addChanges, buildCandidates, buildSlotTree, changesFor, defaultTarget, emptyChanges, pendingCount, pickAt, scopeTargets, workingSelection, type Change, type Scope } from "./model.js";
import { candidatesCss, liveCss } from "./preview-css.js";
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

/**
 * The library Studio: pick which source's fill each slot uses, see every candidate in its own values, and re-theme the
 * document live from the working selection. All copy comes from `labels`; saving goes through the host's adapter.
 */
export function Studio({ catalog: catalogProp, adapter, labels, initialSlotId = DEFAULT_SLOT_ID, livePreview = true, className }: StudioProps): ReactElement {
  const catalog: CatalogData = useMemo(() => catalogProp ?? adapter.catalog ?? studioEngine.loadCatalog(), [catalogProp, adapter.catalog]);
  const layout = useStudioLayout();
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [changes, setChanges] = useState<ChangeSet | undefined>(undefined);
  const [slotId, setSlotId] = useState(initialSlotId);
  const [scope, setScope] = useState<Scope>("slot");
  const [pickedTarget, setPickedTarget] = useState<string | undefined>(undefined);
  const [focusedSource, setFocusedSource] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | undefined>(undefined);
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
  const pending = base ? (changes ?? emptyChanges(base)) : undefined;
  const working = base && pending ? workingSelection({ base, changes: pending }) : undefined;
  const tree = useMemo(() => buildSlotTree(catalog.placements), [catalog]);

  const targets = library ? scopeTargets({ catalog, library, slotId, scope }) : [];
  const target = pickedTarget !== undefined && targets.includes(pickedTarget) ? pickedTarget : library ? defaultTarget({ catalog, library, slotId, scope }) : slotId;
  const candidates = useMemo(
    () => (library && working ? buildCandidates({ catalog, library, working, slotId, scope, target }) : []),
    [catalog, library, working, slotId, scope, target],
  );
  const live = library && working ? liveCss({ catalog, library, working, previous: lastSafe.current }) : undefined;
  if (live) lastSafe.current = live.css;
  const focused = candidates.find((candidate) => candidate.source === focusedSource)
    ?? candidates.find((candidate) => candidate.selected) ?? candidates.find((candidate) => candidate.inUseByDefault) ?? candidates[0];

  const apply = (list: readonly Change[]): void => {
    if (!base || !pending) return;
    setChanges(addChanges({ base, changes: pending, list }));
    setFailure(undefined);
  };
  const resetList = library ? changesFor({ catalog, library, scope, target }) : [];
  const canReset = working !== undefined && resetList.some((entry) => entry.op === "clear" && pickAt(working, entry.scope, entry.target) !== undefined);
  const save = async (): Promise<void> => {
    if (!pending) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const result = await adapterRef.current.save(pending);
      if (!mounted.current) return;
      if (result.ok) {
        setPhase((current) => (current.status === "ready" ? { ...current, base: result.selection } : current));
        setChanges(emptyChanges(result.selection));
      } else setFailure({ reason: result.reason, ...(result.findings ? { findings: result.findings } : {}) });
    } catch {
      if (mounted.current) setFailure({ reason: "failed" });
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const treeCell = layout === "medium" ? "min-w-0 row-span-2" : "min-w-0";
  const counts = Object.fromEntries(catalog.slots.map((slot) => [slot.id, library ? scopeTargets({ catalog, library, slotId: slot.id, scope: "member" }).length : 0]));
  const treeNode = <SlotTree counts={counts} memberCount={labels.memberCount} nodes={tree} placements={catalog.placements} label={labels.treeLabel} slotId={slotId} onNavigate={(id) => { setSlotId(id); setPickedTarget(undefined); setFocusedSource(undefined); }} />;
  const inspector = (
    <aside aria-label={labels.inspectorLabel} className="min-w-0">
      {focused && working ? (
        <Inspector candidate={focused} labels={labels} canReset={canReset} onReset={() => apply(resetList)} />
      ) : null}
    </aside>
  );

  return (
    <div data-studio="" data-layout={layout} className={cx("flex min-w-0 flex-col gap-md text-ink-primary", className)}>
      {livePreview && live?.css ? <style data-studio-preview="">{live.css}</style> : null}
      {ready ? <style data-studio-candidates="">{candidatesCss(candidates)}</style> : null}
      {phase.status === "error" ? <Banner variant="danger">{labels.loadFailed}</Banner> : null}
      {phase.status === "loading" ? <p role="status" className="text-body text-ink-secondary">{labels.loading}</p> : null}
      {ready && pending ? (
        <>
          <StudioTopBar labels={labels} pending={pendingCount(pending)} canSave={adapter.canSave} saving={saving}
            onSave={() => { void save(); }} onDiscard={() => { setChanges(emptyChanges(ready.base)); setFailure(undefined); }} />
          {failure ? (
            <Banner variant="danger">
              {labels.saveFailed[failure.reason]}
              {failure.findings && failure.findings.length > 0 ? <ul>{failure.findings.map((finding) => <li key={`${finding.code}:${finding.subject}:${finding.message}`}>{finding.message}</li>)}</ul> : null}
            </Banner>
          ) : null}
          <div className={GRID_CLASSES[layout]}>
            <div className={treeCell}>
              {layout === "narrow" ? <Disclosure title={labels.treeLabel}>{treeNode}</Disclosure> : treeNode}
            </div>
            <CandidateStage labels={labels} layout={layout} scope={scope} onScope={(next) => { setScope(next); setPickedTarget(undefined); }}
              target={target} targets={targets} onTarget={setPickedTarget} candidates={candidates} focusedSource={focused?.source}
              onFocusSource={setFocusedSource} onUse={(source) => { if (library) apply(changesFor({ catalog, library, scope, target, source })); }} />
            {inspector}
          </div>
        </>
      ) : null}
    </div>
  );
}
