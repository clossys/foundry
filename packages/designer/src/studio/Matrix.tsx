"use client";

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { cx } from "../atoms/internal/cx.js";
import { Button } from "../atoms/Button.js";
import { Tabs } from "../atoms/Tabs.js";
import type { StudioLayout } from "./use-layout.js";
import { RadioGroup } from "../atoms/RadioGroup.js";
import type { ChangeSet, Selection } from "../catalog-core/index.js";
import { pickAt, type Candidate, type NodeOption } from "./model.js";
import type { MatrixRow } from "./matrix-model.js";
import { TOKENS } from "../tokens/tokens.js";
import { CompactPreview } from "./previews.js";
import type { StudioLabels } from "./types.js";


export function Matrix({ rows, sources, labels, working, changes, groupChoices, groups = [], expanded, onExpand, onUse, onFocusCell, focusTarget, onRowElement, layout = "wide" }: {
  rows: readonly MatrixRow[]; sources: readonly string[]; labels: StudioLabels; working: Selection; changes: ChangeSet;
  groupChoices: Readonly<Record<string, string>>; groups?: readonly NodeOption[]; expanded: ReadonlySet<string>;
  onExpand: (leaf: string) => void; onUse: (row: MatrixRow, source: string) => void; onFocusCell: (row: MatrixRow, candidate: Candidate) => void;
  layout?: StudioLayout;
  focusTarget?: { id: string; serial: number };
  onRowElement?: (id: string, element: HTMLTableRowElement | null) => void;
}): ReactElement {
  const prefix = useId();
  const leafWidth = `var(--ui-layout-sidebar-w, ${TOKENS["--ui-layout-sidebar-w"]!.value})`;
  const [library, setLibrary] = useState(sources[0]);
  const visibleSources = layout === "narrow" ? sources.filter(source => source === (library ?? sources[0])) : sources;
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const consumedFocus = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusTarget && consumedFocus.current !== focusTarget.serial) {
      const element = rowElements.current.get(focusTarget.id);
      if (element) { consumedFocus.current = focusTarget.serial; element.focus(); }
    }
  }, [focusTarget, rows]);
  const memberships = groups.length ? groups : rows.filter(row => row.scope === "node").map(row => ({ id: row.id, label: row.label, leaves: row.leaves }));
  const table = <div className="min-w-0 overflow-x-auto" data-studio-matrix="" style={{ maxBlockSize: `var(--ui-table-max-block-default, ${TOKENS["--ui-table-max-block-default"]!.value})`, overflowY: "auto" }}>
    <table aria-label={labels.matrix.label} className="table-fixed min-w-0 text-start text-body-s"
      style={{ inlineSize: visibleSources.length > 4 ? `calc(${leafWidth} + (100% - ${leafWidth}) * ${visibleSources.length} / 4)` : "100%" }}>
      <thead className="sticky top-0 bg-surface-base" style={{ zIndex: `var(--ui-z-sticky, ${TOKENS["--ui-z-sticky"]!.value})` }}><tr>
        <th scope="col" className="sticky start-0 bg-surface-base p-sm text-start" style={{ inlineSize: leafWidth }}>{labels.matrix.leaf}</th>
        {visibleSources.map(source => <th key={source} scope="col" className="p-sm text-start">{source}</th>)}
      </tr></thead>
      <tbody>{rows.map((row, rowIndex) => {
        const selected = row.candidates.find(candidate => candidate.selected)?.source ?? null;
        const parent = [...memberships].reverse().find(group => group.leaves.includes(row.target) && groupChoices[group.id] !== undefined);
        const parentSource = parent ? groupChoices[parent.id] : undefined;
        const leafPick = row.scope === "slot" ? pickAt(working, "slot", row.target) : undefined;
        return <tr key={row.id} data-studio-row={row.id} data-scope={row.scope} data-basket={row.basket} data-emphasized={row.emphasized ? "" : undefined} tabIndex={-1}
          ref={element => { onRowElement?.(row.id, element); if (element) rowElements.current.set(row.id, element); else rowElements.current.delete(row.id); }}>
          <th scope="row" className={cx("sticky start-0 p-sm text-start align-top", row.emphasized ? "bg-surface-raised" : "bg-surface-base")} style={{ zIndex: `calc(var(--ui-z-sticky, ${TOKENS["--ui-z-sticky"]!.value}) - 1)`, paddingInlineStart: `calc(var(--spacing-sm, ${TOKENS["--spacing-sm"]!.value}) * ${row.depth + 1})` }}>
            <span>{row.label}</span>{row.tier ? <small className="text-ink-muted"> {row.tier}</small> : null}
            {row.scope === "slot" ? <Button variant="ghost" size="sm" aria-label={expanded.has(row.id) ? labels.matrix.collapse(row.id) : labels.matrix.expand(row.id)} aria-expanded={expanded.has(row.id)} onPress={() => onExpand(row.id)}>{expanded.has(row.id) ? "−" : "+"}</Button> : null}
          </th>
          <td colSpan={Math.max(1, visibleSources.length)} className="p-0 align-top">
            <RadioGroup label={<span className="sr-only">{labels.useGroup} {row.label}</span>} orientation="horizontal" value={selected} onChange={source => onUse(row, source)}>
              <table aria-label={`${labels.matrix.libraries} ${row.label}`} className="w-full table-fixed text-start">
                <thead className="sr-only"><tr>{visibleSources.map((source, sourceIndex) => <th key={source} id={`${prefix}-${rowIndex}-${sourceIndex}`} scope="col">{source}</th>)}</tr></thead>
                <tbody><tr>{visibleSources.map((source, sourceIndex) => {
                  const candidate = row.candidates.find(candidate => candidate.source === source);
                  const pending = changes.changes.some(change => {
                    const scope = change.op === "set" ? change.pick.scope : change.scope;
                    const target = change.op === "set" ? change.pick.target : change.target;
                    const matches = row.scope === "node" ? scope === "slot" && row.leaves.includes(target) : scope === row.scope && target === row.target;
                    return matches && (change.op === "set" ? change.pick.source === source : candidate?.inUseByDefault);
                  });
                  return <td key={source} headers={`${prefix}-${rowIndex}-${sourceIndex}`} data-studio-card={source} data-selected={candidate?.selected ? "" : undefined}
                    className="p-sm align-top" onFocus={() => { if (candidate) onFocusCell(row, candidate); }} onPointerDown={() => { if (candidate) onFocusCell(row, candidate); }}>
                    <div className="flex min-w-0 flex-col gap-xs">
                      <span className="text-caption text-ink-secondary">{source}</span>
                      <RadioGroup.Radio value={source} isDisabled={!candidate?.usable} aria-label={labels.useSource(source, row.target)}>{labels.useSource(source, row.target)}</RadioGroup.Radio>
                      {candidate?.inUseByDefault ? <small>{labels.inUseByDefault}</small> : null}
                      {candidate?.reason === "reference" ? <p className="text-caption text-ink-muted">{labels.referenceOnly}</p> : null}
                      {candidate?.previewable && candidate.members.length === 0 ? <p className="text-caption text-ink-muted">{labels.previewUnavailable}</p> : null}
                      {!candidate ? <p className="text-caption text-ink-muted">{labels.noFill}</p> : null}
                      {pending ? <span aria-label={labels.matrix.pending} data-studio-cell-pending="">●</span> : null}
                      {row.scope === "slot" && leafPick?.source === source && parentSource !== undefined && parentSource !== source ? <small>{labels.matrix.differs}</small> : null}
                      {candidate ? <><div data-studio-candidate={candidate.index}><CompactPreview candidate={candidate} labels={labels} /></div><small>{labels.checkSummary(candidate.errors, candidate.notices)}</small></> : null}
                    </div>
                  </td>;
                })}</tr></tbody>
              </table>
            </RadioGroup>
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
  return layout === "narrow" ? <Tabs selectedKey={library ?? sources[0]} onSelectionChange={key => setLibrary(String(key))}>
    <Tabs.List aria-label={labels.matrix.libraries}>{sources.map(source => <Tabs.Tab key={source} id={source}>{source}</Tabs.Tab>)}</Tabs.List>
    {sources.map(source => <Tabs.Panel key={source} id={source}>{table}</Tabs.Panel>)}
  </Tabs> : table;
}
