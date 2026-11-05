"use client";
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { Matrix as Comparison } from "../blocks/Matrix.js";
import type { LibraryBoardPreviewPort } from "../blocks/library-board/LibraryBoardSection.js";
import type { LibraryBoardCommand, LibraryBoardRecords } from "../blocks/library-board/model.js";
import type { LibraryBoardLabels, CandidateWorkflow } from "../blocks/library-board/types.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import type { PreparedBoardPreviews } from "./prepared-library-boards.js";

/**
 * A focused text-entry control owns its own arrow keys: a native field, a spin button (a React Aria
 * date segment), a text box or an editable region. The canvas and the board grid never claim them.
 */
export const EDITABLE_CONTROL = "input, textarea, select, [role=spinbutton], [role=textbox], [contenteditable]:not([contenteditable=false])";
export const isEditableControl = (target: EventTarget | null): boolean => typeof Element !== "undefined" && target instanceof Element && target.closest(EDITABLE_CONTROL) !== null;

/** No preview port: every cell shows the Section's own unavailable status. */
const NO_PREVIEWS: LibraryBoardPreviewPort = { selectionHash: "unavailable", sourceHashes: {}, render: () => undefined };
/**
 * The canvas port: the prepared previews. A text-entry control inside a preview (a DateField segment)
 * keeps its own arrow keys because the library Table pauses its grid navigation while focus is in one.
 */
export function canvasPreviewPort(previews: PreparedBoardPreviews): LibraryBoardPreviewPort {
  if (previews.status !== "available") return NO_PREVIEWS;
  const port = previews.port;
  return { selectionHash: port.selectionHash, sourceHashes: port.sourceHashes, render: identity => port.render(identity) ?? undefined };
}

/**
 * Canvas-local digests: each source maps to a digest of the exact documents this canvas renders for it, so
 * a record's preview identity is bound to those bytes. It is not a source-owner association and certifies
 * nothing about where a source came from; a host with source-owner descriptors supplies those instead.
 */
export function canvasSourceDigests(documents: Iterable<readonly [source: string, document: unknown]>): Record<string, string> {
  const bySource = new Map<string, unknown[]>();
  for (const [source, document] of documents) { const list = bySource.get(source); if (list) list.push(document); else bySource.set(source, [document]); }
  return Object.fromEntries([...bySource].map(([source, list]) => [source, runtimeHash(list)]));
}

export interface CanvasBoardEntry {
  readonly id: string;
  readonly domain: string;
  /** A board the explorer filter excludes stays mounted but is not shown. */
  readonly hidden?: boolean;
  readonly records: LibraryBoardRecords;
  readonly previews: LibraryBoardPreviewPort;
}
export interface CanvasBoardsProps {
  readonly boards: readonly CanvasBoardEntry[];
  readonly labels: LibraryBoardLabels;
  readonly workflow?: CandidateWorkflow;
  readonly onCommand: (command: LibraryBoardCommand) => void;
  readonly onBoardElement?: (id: string, element: HTMLElement | null) => void;
  readonly onRowElement?: (id: string, element: HTMLElement | null) => void;
}

/** A board row's leaf id: the edit matrix marks its rows; a view row names its leaf in the shared leaf label. */
export function boardRowLeaf(row: HTMLElement): string | undefined {
  return row.dataset.studioRow ?? row.querySelector<HTMLElement>("[data-leaf-id]")?.textContent ?? undefined;
}
/**
 * One canvas board: the registered `sections.comparison@library-board` Section and nothing drawn around it.
 * The wrapper is structural only (no class, style, role or tab stop); it carries the board and domain ids the
 * camera, map and explorer address, and registers the Section's rows for reveal and visible-row loading.
 */
// Memoized: a session notification that leaves the prepared board unchanged does not render its Section (or host previews) again.
const CanvasBoard = memo(function CanvasBoard({ board, labels, workflow, onCommand, onBoardElement, onRowElement }: Omit<CanvasBoardsProps, "boards"> & { board: CanvasBoardEntry }) {
  const element = useRef<HTMLDivElement | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const register = useRef(onRowElement); register.current = onRowElement;
  const registerBoard = useRef(onBoardElement); registerBoard.current = onBoardElement;
  const ref = useCallback((node: HTMLDivElement | null) => { element.current = node; registerBoard.current?.(board.id, node); }, [board.id]);
  useLayoutEffect(() => {
    const wrapper = element.current; if (!wrapper) return;
    const ids = new Set(board.records.rows.items.map(row => row.id));
    const next = new Map<string, HTMLElement>();
    for (const row of wrapper.querySelectorAll<HTMLElement>("tr")) { const id = boardRowLeaf(row); if (id && ids.has(id)) next.set(id, row); }
    for (const [id, row] of rows.current) if (next.get(id) !== row) register.current?.(id, null);
    for (const [id, row] of next) if (rows.current.get(id) !== row) register.current?.(id, row);
    rows.current = next;
  });
  useLayoutEffect(() => () => { for (const id of rows.current.keys()) register.current?.(id, null); rows.current.clear(); }, []);
  return <div ref={ref} data-studio-canvas-board={board.id} data-studio-domain={board.domain} hidden={board.hidden || undefined}>
    <Comparison arrangement="library-board" records={board.records} previews={board.previews} labels={labels} workflow={workflow} onCommand={onCommand} />
  </div>;
});

/** Every canvas board, on every layer, is the registered library-board comparison Section. */
export function CanvasBoards({ boards, ...rest }: CanvasBoardsProps) {
  return <>{boards.map(board => <CanvasBoard key={board.id} board={board} {...rest} />)}</>;
}
