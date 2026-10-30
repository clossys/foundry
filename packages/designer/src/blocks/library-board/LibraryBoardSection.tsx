'use client';
import { useId, type Key, type ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { Table } from '../../components/Table.js';
import { BOARD_SURFACE_CLASS, BoardHeader, LeafCell, LeafLabel } from './LeafCell.js';
import { CandidatePromptDialog } from './CandidatePromptDialog.js';
import { assertLibraryBoardRecords, assertLibraryPreviewIdentity, type LibraryBoardCommand, type LibraryBoardRecords, type LibraryPreviewIdentity } from './model.js';
import type { CandidateWorkflow, LibraryBoardLabels } from './types.js';
export interface LibraryBoardPreviewPort {
  readonly selectionHash: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  /** Original checked preview provider; called only for exact prepared identity. It returns the leaf's whole cell (the shared `LeafCell` anatomy), never a second plate around one. */
  render(identity: LibraryPreviewIdentity): ReactNode | undefined;
}
export interface LibraryBoardSectionProps {
  readonly records: LibraryBoardRecords;
  readonly labels: LibraryBoardLabels;
  readonly previews: LibraryBoardPreviewPort;
  readonly workflow?: CandidateWorkflow;
  /** Typed live controller command port (reveal only: it selects a row; nothing writes). No function enters records or InstanceBinding. */
  readonly onCommand: (command: LibraryBoardCommand) => void;
}
import { dsPassThrough } from "../../catalog-core/provenance-attrs.js";
/**
 * Existing comparison Section, rendered read-only from checked board records: each leaf row shows its chosen
 * cell, and selecting a row reveals it (the inspector opens). There is no edit mode, no source choice and no
 * write command; a not-chosen row offers Ask agent, which hands the decision to a coding agent. A record whose
 * `controls.mode` is `edit` still renders this read-only view.
 */
export function LibraryBoardSection({ records, labels, previews, workflow, onCommand, ...passthrough }: LibraryBoardSectionProps) {
  assertLibraryBoardRecords(records);
  const { rows } = records;
  const headingId = useId();
  /** The checked preview for an exact prepared identity, or undefined when none may render. */
  const rendered = (identity: LibraryPreviewIdentity | undefined): ReactNode | undefined => {
    if (!identity) return undefined;
    assertLibraryPreviewIdentity(identity);
    if (identity.selectionHash !== previews.selectionHash || previews.sourceHashes[identity.source] !== identity.sourceHash) return undefined;
    try { return previews.render(identity) ?? undefined; } catch { return undefined; }
  };
  /** One leaf cell: the provider's checked cell, or the shared cell with the unavailable status in its status slot. */
  const cell = (identity: LibraryPreviewIdentity | undefined) => rendered(identity) ?? <LeafCell previewState="unavailable" status={labels.previewUnavailable} />;
  const reveal = (key: Key) => {
    const row = rows.items.find(row => row.id === String(key));
    if (row) onCommand({ version: 1, command: 'reveal', boardId: rows.boardId, leafId: row.id, ...(row.selectedSource ? { source: row.selectedSource } : {}) });
  };
  return <section {...dsPassThrough(passthrough)} data-library-board={rows.boardId} data-board-mode="view" aria-labelledby={headingId} className={BOARD_SURFACE_CLASS}>
    <BoardHeader id={headingId} title={rows.label} />
    <Table aria-label={labels.matrix.label} className="w-max" onRowAction={reveal}>
      <Table.Header><Table.Column id="leaf" isRowHeader>{labels.matrix.leaf}</Table.Column><Table.Column id="preview"><span className="sr-only">{labels.stageLabel}</span></Table.Column></Table.Header>
      <Table.Body>{rows.items.map(row => <Table.Row key={row.id} id={row.id}><Table.Cell><LeafLabel id={row.id} label={row.label} /></Table.Cell><Table.Cell>{row.selectedSource ? cell(row.selectedPreview) : <LeafCell previewState="not-chosen" status={labels.board.notChosen} actions={<CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{labels.board.askAgent}</Button>} data={row.prompt} labels={labels} workflow={workflow} />} />}</Table.Cell></Table.Row>)}</Table.Body>
    </Table>
  </section>;
}
