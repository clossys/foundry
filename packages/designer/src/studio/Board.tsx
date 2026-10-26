"use client";

import { memo, useId, useState, type ComponentProps, type ReactElement, type Ref } from "react";
import { Button } from "../components/Button.js";
import { Table } from "../components/Table.js";
import { BoardHeader, LeafCell } from "../blocks/library-board/LeafCell.js";
import { CanvasLodLayers } from "../blocks/canvas/CanvasLod.js";
import { Matrix } from "./Matrix.js";
import { CandidateCell } from "./CandidateCell.js";
import { CandidatePromptDialog } from "./CandidatePromptDialog.js";
import type { CandidatePromptData } from "./candidate-prompt.js";
import type { MatrixRow } from "./matrix-model.js";
import type { MatrixBoard } from "./matrix-model.js";
import type { StudioCandidateWorkflow } from "./types.js";
import { activeCandidateSource } from "./candidate-display.js";
import { valueBoardPrompt } from "./prepared-library-boards.js";

/** Self-contained placement group: its title and complete library matrix. */
export const Board = memo(function Board({ board, boardRef, summary, onOpen, workflow, contextTokens = [], variants, ...matrix }: Omit<ComponentProps<typeof Matrix>, "rows"> & { board: MatrixBoard; boardRef: Ref<HTMLElement>; summary?: { errors: number; warnings: number; sources: readonly string[] }; onOpen?: () => void; workflow?: StudioCandidateWorkflow; contextTokens?: readonly { id: string; value: string }[]; variants?: Readonly<Record<string, readonly string[]>> }): ReactElement {
  const id = `studio-board-${encodeURIComponent(board.id)}`;
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const rows = board.rows.filter(row => row.scope === "slot");
  const text = matrix.labels.board;
  const edit = () => { setEditing(true); for (const row of rows) if (row.candidatesReady === false) matrix.onRequestRow?.(row, matrix.sources[0] ?? matrix.working.source.id); };
  const promptData = (row: MatrixRow, current = false): CandidatePromptData => valueBoardPrompt({ board, row, consumer: matrix.working.source.id, contextTokens, variants, workflow, returnStep: text.returnStep }, current);
  const sources = matrix.sources.filter(source => rows.some(row => row.candidates.some(candidate => candidate.source === source && (candidate.fill.sourceAddress !== "" || candidate.members.length > 0))) || rows.some(row => row.candidatesReady === false));
  return <section tabIndex={-1} id={id} ref={boardRef} data-studio-board={board.id} data-board-mode={editing ? "edit" : "view"} aria-labelledby={headingId} className="flex h-max w-max shrink-0 flex-col gap-sm rounded-surface border border-line-base bg-surface-base p-md">
    <BoardHeader id={headingId} title={board.label} editing={editing} labels={text} onEdit={edit} onDone={() => setEditing(false)} />
    <CanvasLodLayers full={<div data-studio-zoom-full="" className="w-max">{editing ? <>
      <Matrix {...matrix} rows={rows} sources={sources} layout="wide" customCell={row => <div className="flex items-center gap-sm">
        <CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{text.create}</Button>} data={promptData(row)} labels={matrix.labels} workflow={workflow} />
        {row.candidates.some(candidate => candidate.selected && candidate.source === matrix.working.source.id && candidate.members.some(({ member }) => member.origin?.kind !== "adopted")) ? <CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{text.refresh}</Button>} data={promptData(row, true)} labels={matrix.labels} workflow={workflow} /> : null}
      </div>} />
    </> : <Table aria-label={matrix.labels.matrix.label} className="w-max">
      <Table.Header><Table.Column id="leaf" isRowHeader>{matrix.labels.matrix.leaf}</Table.Column><Table.Column id="preview"><span className="sr-only">{matrix.labels.stageLabel}</span></Table.Column></Table.Header>
      <Table.Body>{rows.map(row => { const active = row.candidates.find(candidate => candidate.selected); return <Table.Row key={row.id} id={row.id} data-studio-row={row.id} data-scope="slot">
        <Table.Cell><span ref={element => { matrix.onRowElement?.(row.id, element?.closest("tr") ?? null); }}>{row.label}</span></Table.Cell><Table.Cell>{active ? <CandidateCell candidate={active} labels={matrix.labels} /> : <LeafCell status={text.notChosen} actions={<><Button variant="ghost" size="sm" onPress={edit}>{text.choose}</Button><CandidatePromptDialog trigger={<Button variant="ghost" size="sm">{text.askAgent}</Button>} data={promptData(row)} labels={matrix.labels} workflow={workflow} /></>} />}</Table.Cell>
      </Table.Row>; })}</Table.Body>
    </Table>}</div>}
    // Compact: each row's name and chosen library, legible at text-h0.
    compact={summary ? <div data-studio-zoom-compact="" className="flex flex-col gap-md text-h0">
      <p className="break-words text-ink-secondary">{matrix.labels.checkSummary(summary.errors, summary.warnings)}</p>
      <ul className="flex flex-col gap-sm">{rows.map(row => { const source = activeCandidateSource(row.candidates); return <li key={row.id} className="break-words">
        <span className="text-ink-primary">{row.label}</span> <span className={source ? "text-ink-secondary" : "text-ink-muted"}>{source ?? text.notChosen}</span>
      </li>; })}</ul>
    </div> : undefined}
    // Overview: the board name, its check summary and the only Open action.
    overview={summary ? <div data-studio-zoom-summary="" className="flex flex-col items-start gap-md">
      <p className="break-words text-display-xl text-ink-primary">{board.label}</p>
      <p className="break-words text-display-m text-ink-secondary">{matrix.labels.checkSummary(summary.errors, summary.warnings)}</p>
      {onOpen ? <Button variant="ghost" size="sm" onPress={onOpen}>{matrix.labels.canvas.openBoard(board.label)}</Button> : null}
    </div> : undefined} />
  </section>;
});
