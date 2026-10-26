'use client';
import type { ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { Table } from '../../components/Table.js';
import { Card } from '../../components/Card.js';
import { RadioGroup } from '../../components/RadioGroup.js';
import { Tooltip } from '../../components/Tooltip.js';
import { Badge } from '../../components/Badge.js';
import { SectionHeader } from '../SectionHeader.js';
import { MatrixChoices } from '../matrix/choices.js';
import { CandidatePromptDialog } from './CandidatePromptDialog.js';
import { assertLibraryBoardRecords, assertLibraryPreviewIdentity, type LibraryBoardCommand, type LibraryBoardRecords, type LibraryPreviewIdentity } from './model.js';
import type { CandidateWorkflow, LibraryBoardLabels } from './types.js';
export interface LibraryBoardPreviewPort {
  readonly selectionHash: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  /** Original checked preview provider; called only for exact prepared identity. */
  render(identity: LibraryPreviewIdentity): ReactNode | undefined;
}
export interface LibraryBoardSectionProps {
  readonly records: LibraryBoardRecords;
  readonly labels: LibraryBoardLabels;
  readonly previews: LibraryBoardPreviewPort;
  readonly workflow?: CandidateWorkflow;
  /** Typed live controller command port. No function enters records or InstanceBinding. */
  readonly onCommand: (command: LibraryBoardCommand) => void;
}
import { PREVIEW_CHOICE_CLASS } from './choice-class.js';
/** Existing comparison Section, rendered from checked board records in either body substrate. */
export function LibraryBoardSection({ records, labels, previews, workflow, onCommand }: LibraryBoardSectionProps) {
  assertLibraryBoardRecords(records);
  const { rows, columns, controls } = records;
  const command = (name: 'board-edit' | 'board-done') => onCommand({ version: 1, command: name, boardId: rows.boardId });
  const preview = (identity: LibraryPreviewIdentity | undefined) => {
    if (!identity) return <p>{labels.previewUnavailable}</p>;
    assertLibraryPreviewIdentity(identity);
    if (identity.selectionHash !== previews.selectionHash || previews.sourceHashes[identity.source] !== identity.sourceHash) return <p>{labels.previewUnavailable}</p>;
    let node: ReactNode;
    try { node = previews.render(identity); } catch { node = undefined; }
    return node ?? <p>{labels.previewUnavailable}</p>;
  };
  const prompt = (row: typeof rows.items[number], refresh = false) => <CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{refresh ? labels.board.refresh : labels.board.create}</Button>} data={refresh ? row.refreshPrompt! : row.prompt} labels={labels} workflow={workflow} />;
  const custom = columns.items.find(column => column.role === 'consumer');
  const choiceColumns = columns.items.filter(column => rows.items.some(row => row.candidates.some(candidate => candidate.source === column.source)));
  return <section data-library-board={rows.boardId} data-board-mode={controls.mode} aria-label={rows.label} className="flex h-max w-max shrink-0 flex-col gap-sm rounded-surface border border-line-base bg-surface-base p-md">
    <SectionHeader title={rows.label} level={3} actions={controls.mode === 'edit' ? <Button size="sm" onPress={() => command('board-done')}>{labels.board.done}</Button> : <Tooltip trigger={<Button size="sm" variant="ghost" aria-label={labels.board.changeSelection} onPress={() => command('board-edit')}>{labels.board.changeSelection}</Button>}>{labels.board.changeSelection}</Tooltip>} />
    {controls.mode === 'view' ? <Table aria-label={labels.matrix.label} className="w-max">
      <Table.Header><Table.Column id="leaf" isRowHeader>{labels.matrix.leaf}</Table.Column><Table.Column id="preview"><span className="sr-only">{labels.stageLabel}</span></Table.Column></Table.Header>
      <Table.Body>{rows.items.map(row => <Table.Row key={row.id} id={row.id}><Table.Cell>{row.label}</Table.Cell><Table.Cell>{row.selectedSource ? <Card variant="plate" className="flex w-max items-start gap-md p-sm">{preview(row.selectedPreview)}</Card> : <div className="flex items-center gap-sm text-ink-muted"><span>{labels.board.notChosen}</span><Button variant="ghost" size="sm" onPress={() => command('board-edit')}>{labels.board.choose}</Button><CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{labels.board.askAgent}</Button>} data={row.prompt} labels={labels} workflow={workflow} /></div>}</Table.Cell></Table.Row>)}</Table.Body>
    </Table> : rows.layer === 'sections' || rows.layer === 'frames' ? <div className="grid gap-md">{rows.items.map(row => <section key={row.id} aria-label={row.label}><h4>{row.label}</h4>{preview(row.selectedPreview)}<div className="flex gap-sm">{prompt(row)}{row.refreshPrompt ? prompt(row, true) : null}</div></section>)}</div> : <MatrixChoices arrangement="choices" aria-label={labels.matrix.label} columns={[...choiceColumns.map(column => ({ id: column.source, label: <Tooltip trigger={<span tabIndex={0}>{column.label}</span>}>{column.license}{column.restriction ? ` · ${column.restriction}` : ''}</Tooltip> })), { id: 'library-board-custom-actions', label: labels.board.custom }]}
      onChange={(id, source) => {
        const candidate = rows.items.find(row => row.id === id)?.candidates.find(candidate => candidate.source === source);
        const column = columns.items.find(column => column.source === source);
        if (!controls.canSave || controls.pending || !candidate?.usable || column?.referenceOnly || candidate.findings.some(finding => finding.severity === 'error')) return;
        onCommand({ version: 1, command: 'use-source', boardId: rows.boardId, leafId: id, source });
      }}
      onFocusCell={(id, source) => onCommand({ version: 1, command: 'reveal', boardId: rows.boardId, leafId: id, source })}
      rows={rows.items.map(row => ({ id: row.id, label: row.label, name: row.label, selected: row.selectedSource,
        cells: { ...Object.fromEntries(choiceColumns.map(column => {
          const candidate = row.candidates.find(candidate => candidate.source === column.source);
          if (!candidate) return [column.source, null];
          const errors = candidate.findings.filter(finding => finding.severity === 'error').length, notices = candidate.findings.filter(finding => finding.severity === 'notice').length;
          return [column.source, <div className="relative"><RadioGroup.Radio value={candidate.source} aria-label={labels.useSource(candidate.source, row.id)} isDisabled={!controls.canSave || controls.pending || !candidate.usable || column.referenceOnly || errors > 0} className={PREVIEW_CHOICE_CLASS}><Card variant="plate" className="flex w-max items-start gap-md p-sm">{preview(candidate.previewIdentity)}</Card></RadioGroup.Radio>
            {errors > 0 ? <Tooltip trigger={<Button variant="ghost" size="sm" aria-label={labels.checkSummary(errors, notices)}><Badge variant="danger">!</Badge></Button>}>{candidate.findings.map((finding, index) => <p key={index}>{finding.code}: {finding.message}</p>)}</Tooltip> : null}</div>];
        })), 'library-board-custom-actions': <div className="flex gap-sm">{prompt(row)}{custom && row.refreshPrompt ? prompt(row, true) : null}</div> }
      }))} />}
  </section>;
}
