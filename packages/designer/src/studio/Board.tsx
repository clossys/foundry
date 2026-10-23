"use client";

import { useId, type ComponentProps, type ReactElement, type Ref } from "react";
import { TOKENS } from "../tokens/tokens.js";
import { Matrix } from "./Matrix.js";
import type { MatrixBoard } from "./matrix-model.js";

/** Self-contained placement group: its selection progress and complete library matrix. */
export function Board({ board, boardRef, ...matrix }: Omit<ComponentProps<typeof Matrix>, "rows"> & { board: MatrixBoard; boardRef: Ref<HTMLElement> }): ReactElement {
  const id = `studio-board-${encodeURIComponent(board.id)}`;
  const headingId = useId();
  const percent = board.leaves.length ? board.decided * 100 / board.leaves.length : 0;
  return <section id={id} ref={boardRef} data-studio-board={board.id} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-sm">
    <h3 id={headingId} className="flex items-center gap-sm text-body">
      {board.label}
      <svg aria-hidden="true" viewBox="0 0 32 32" style={{ inlineSize: TOKENS["--spacing-2xl"]!.value, blockSize: TOKENS["--spacing-2xl"]!.value }}><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" /><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percent} transform="rotate(-90 16 16)" /></svg>
      <span>{matrix.labels.progress(board.decided, board.leaves.length)}</span>
    </h3>
    <Matrix {...matrix} rows={board.rows} />
  </section>;
}
