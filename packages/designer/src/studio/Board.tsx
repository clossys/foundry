"use client";

import { memo, useId, type ComponentProps, type ReactElement, type Ref } from "react";
import { TOKENS } from "../tokens/tokens.js";
import { Button } from "../atoms/Button.js";
import { Matrix } from "./Matrix.js";
import type { MatrixBoard } from "./matrix-model.js";

/** Self-contained placement group: its selection progress and complete library matrix. */
export const Board = memo(function Board({ board, boardRef, summary, onOpen, ...matrix }: Omit<ComponentProps<typeof Matrix>, "rows"> & { board: MatrixBoard; boardRef: Ref<HTMLElement>; summary?: { errors: number; warnings: number; sources: readonly string[] }; onOpen?: () => void }): ReactElement {
  const id = `studio-board-${encodeURIComponent(board.id)}`;
  const headingId = useId();
  const percent = board.leaves.length ? board.decided * 100 / board.leaves.length : 0;
  return <section tabIndex={-1} id={id} ref={boardRef} data-studio-board={board.id} aria-labelledby={headingId} className="relative flex min-w-0 flex-col gap-sm rounded-surface border border-line-base bg-surface-base p-md" style={{ inlineSize: `calc(var(--ui-layout-sidebar-w, ${TOKENS["--ui-layout-sidebar-w"]!.value}) * 4)`, blockSize: `calc(var(--ui-layout-aside-w, ${TOKENS["--ui-layout-aside-w"]!.value}) * 2)`, flexShrink: 0 }}>
    <h3 id={headingId} className="flex items-center gap-sm text-body">
      {board.label}
      <svg aria-hidden="true" viewBox="0 0 32 32" style={{ inlineSize: TOKENS["--spacing-2xl"]!.value, blockSize: TOKENS["--spacing-2xl"]!.value }}><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" /><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percent} transform="rotate(-90 16 16)" /></svg>
      <span>{matrix.labels.progress(board.decided, board.leaves.length)}</span>
    </h3>
    <div data-studio-zoom-full="" className="min-h-0 flex-1"><Matrix {...matrix} rows={board.rows} contained /></div>
    {summary ? <div data-studio-zoom-summary="" hidden className="absolute inset-md flex-col gap-md" style={{ insetBlockStart: `var(--spacing-3xl, ${TOKENS["--spacing-3xl"]!.value})` }}>
      <p className="text-body-s text-ink-secondary">{matrix.labels.checkSummary(summary.errors, summary.warnings)}</p>
      <div className="flex flex-wrap gap-xs">{summary.sources.map(source => <span key={source} className="rounded-control bg-surface-raised px-sm py-xs text-caption">{source}</span>)}</div>
      {onOpen ? <Button variant="ghost" size="sm" onPress={onOpen}>{matrix.labels.canvas.openBoard(board.label)}</Button> : null}
    </div> : null}
  </section>;
});
