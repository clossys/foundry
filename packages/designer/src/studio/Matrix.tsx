"use client";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Tabs } from "../components/Tabs.js";
import { Matrix as Comparison } from "../blocks/Matrix.js";
import type { StudioLayout } from "./use-layout.js";
import type { ChangeSet, LibraryData } from "../catalog-core/index.js";
import type { Candidate, NodeOption } from "./model.js";
import type { MatrixRow } from "./matrix-model.js";
import { CandidateChoice } from "./CandidateChoice.js";
import { LeafLabel } from "./board-summary.js";
import { activeCandidateSource } from "./candidate-display.js";
import type { StudioLabels } from "./types.js";

export function Matrix({ rows, sources, labels, working, changes, onUse, onFocusCell, onRequestRow, focusTarget, onRowElement, customCell, layout = "wide" }: {
  rows: readonly MatrixRow[]; sources: readonly string[]; labels: StudioLabels; working: LibraryData; changes: ChangeSet;
  groupChoices: Readonly<Record<string, string>>; groups?: readonly NodeOption[]; expanded: ReadonlySet<string>;
  onExpand: (leaf: string) => void; onUse: (row: MatrixRow, source: string) => void; onFocusCell: (row: MatrixRow, candidate: Candidate) => void;
  onRequestRow?: (row: MatrixRow, source: string) => void; layout?: StudioLayout; contained?: boolean;
  focusTarget?: { id: string; serial: number }; onRowElement?: (id: string, element: HTMLTableRowElement | null) => void;
  customCell?: (row: MatrixRow) => ReactNode;
}): ReactElement {
  const [library, setLibrary] = useState(sources[0]);
  const visibleSources = layout === "narrow" ? sources.filter(source => source === (library ?? sources[0])) : sources;
  const elements = useRef(new Map<string, HTMLTableRowElement>());
  const consumed = useRef<number | undefined>(undefined);
  useEffect(() => { if (focusTarget && consumed.current !== focusTarget.serial) { const element = elements.current.get(focusTarget.id); if (element) { consumed.current = focusTarget.serial; element.focus({ preventScroll: true }); } } }, [focusTarget, rows]);
  const customId = working.source.id;
  const table = <Comparison arrangement="choices" aria-label={labels.matrix.label} columns={customCell ? [...visibleSources.filter(id => id !== customId).map(id => ({ id, label: id })), { id: customId, label: labels.board.custom }] : visibleSources.map(id => ({ id, label: id }))}
    onChange={(id, source) => { const row = rows.find(row => row.id === id); if (row) onUse(row, source); }}
    onFocusCell={(id, source) => { const row = rows.find(row => row.id === id); if (!row) return; if (row.candidatesReady === false) onRequestRow?.(row, source); else { const candidate = row.candidates.find(candidate => candidate.source === source); if (candidate) onFocusCell(row, candidate); } }}
    rows={rows.map(row => ({ id: row.id, emphasized: row.emphasized,
      name: <>{labels.useGroup} {row.label}</>,
      // One leaf-label treatment in view and edit mode (the view table uses the same LeafLabel).
      label: <><LeafLabel id={row.id} name={labels.leafName?.(row.id) ?? (row.label !== row.id ? row.label : undefined)} />{row.tier ? <small className="font-normal text-ink-muted"> {row.tier}</small> : null}</>,
      selected: activeCandidateSource(row.candidates) ?? (row.candidatesReady === false && working.fills.some(fill => fill.$extensions["com.clossys.fill"].slot === row.id) ? working.source.id : null),
      ref: (element: HTMLTableRowElement | null) => { onRowElement?.(row.id, element); if (element) elements.current.set(row.id, element); else elements.current.delete(row.id); },
      cells: { ...Object.fromEntries(visibleSources.filter(source => !customCell || source !== customId).map(source => { const candidate = row.candidates.find(candidate => candidate.source === source); const pending = changes.changes.some(change => row.leaves.includes(change.slot) && (change.op === "adopt" ? change.source === source : source === working.source.id));
        return [source, <>{candidate || row.candidatesReady === false ? <CandidateChoice candidate={candidate} source={source} target={row.target} labels={labels} /> : null}{pending ? <span className="sr-only" data-studio-cell-pending="">{labels.matrix.pending}</span> : null}</>]; })), ...(customCell ? { [customId]: <>{activeCandidateSource(row.candidates) === customId ? row.candidates.filter(candidate => candidate.source === customId && candidate.members.length > 0).map(candidate => <CandidateChoice key={candidate.source} candidate={candidate} target={row.target} labels={labels} />) : null}{customCell(row)}</> } : {}) }
    }))} />;
  return layout === "narrow" ? <Tabs selectedKey={library ?? sources[0]} onSelectionChange={key => setLibrary(String(key))}>
    <Tabs.List aria-label={labels.matrix.libraries}>{sources.map(source => <Tabs.Tab key={source} id={source}>{source}</Tabs.Tab>)}</Tabs.List>
    {sources.map(source => <Tabs.Panel key={source} id={source}>{table}</Tabs.Panel>)}
  </Tabs> : table;
}
