/**
 * sections.comparison with the arrangement.library-board member: the real LibraryBoardSection, drawn from the
 * board records in the fill's `columns`, `rows` and `controls` content and the live Studio port registered for
 * the leaf (ConsumerRuntimePorts.sectionHosts["sections.comparison"]). Without that port the board is refused,
 * never drawn with stand-in previews or inert commands. Every other arrangement keeps the grid renderer.
 */
import type { ReactNode } from "react";
import { LibraryBoardSection, type LibraryBoardPreviewPort } from "../../blocks/library-board/LibraryBoardSection.js";
import type { LibraryBoardCommand, LibraryBoardRecords } from "../../blocks/library-board/model.js";
import type { CandidateWorkflow, LibraryBoardLabels } from "../../blocks/library-board/types.js";
import { runtimeSnapshotCopies } from "../../catalog-core/runtime-snapshot-identity.js";
import { runtimeSnapshot } from "../../catalog-core/runtime-ports.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { runtimeValue, type SurfaceRuntimeRenderer } from "../contract.js";

export const LIBRARY_BOARD_MEMBER = "arrangement.library-board";
const BOARD_SLOTS: readonly string[] = ["columns", "rows", "controls"];
/** The comparison leaf's live port: checked previews, board copy and the typed board command channel. */
export interface LibraryBoardSectionHost {
  readonly previews: LibraryBoardPreviewPort;
  readonly labels: LibraryBoardLabels;
  readonly onCommand: (command: LibraryBoardCommand) => void;
  readonly workflow?: CandidateWorkflow;
}

function boardHost(input: RuntimeRenderInput<ReactNode>): LibraryBoardSectionHost {
  const host = input.sectionHost as Partial<LibraryBoardSectionHost> | undefined;
  if (!host || typeof host.onCommand !== "function" || !host.labels || !host.previews || typeof host.previews.render !== "function") {
    throw new TypeError("sections.comparison: arrangement.library-board needs its live port (previews, labels, onCommand) in sectionHosts");
  }
  return host as LibraryBoardSectionHost;
}

const boardRecordsByContent = new WeakMap<object, LibraryBoardRecords>();
function boardRecords(input: RuntimeRenderInput<ReactNode>): LibraryBoardRecords {
  const immutable = runtimeSnapshotCopies.has(input.content);
  const cached = immutable ? boardRecordsByContent.get(input.content) : undefined;
  if (cached) return cached;
  const records = { columns: runtimeValue(input, "columns"), rows: runtimeValue(input, "rows"), controls: runtimeValue(input, "controls") } as unknown as LibraryBoardRecords;
  if (!immutable) return records;
  const snapshot = runtimeSnapshot(records);
  boardRecordsByContent.set(input.content, snapshot);
  return snapshot;
}

/** Library-board arrangement first; the grid renderer for everything else. */
export function withLibraryBoard(grid: SurfaceRuntimeRenderer): SurfaceRuntimeRenderer {
  return input => {
    if (!input.selection.members.includes(LIBRARY_BOARD_MEMBER)) return grid(input);
    if (!input.fill.members.includes(LIBRARY_BOARD_MEMBER)) throw new TypeError(`sections.comparison: member ${LIBRARY_BOARD_MEMBER} is not mapped by this fill`);
    const unmapped = Object.keys(input.content).filter(slot => !input.fill.slots.includes(slot));
    if (unmapped.length) throw new TypeError(`sections.comparison: content slot ${unmapped.join(", ")} is not mapped by this fill`);
    const extra = Object.keys(input.content).filter(slot => !BOARD_SLOTS.includes(slot));
    if (extra.length) throw new TypeError(`sections.comparison: arrangement.library-board draws only columns, rows and controls; ${extra.join(", ")} has no board prop`);
    const host = boardHost(input);
    // LibraryBoardSection checks the exact record shape (assertLibraryBoardRecords) before it renders anything.
    const records = boardRecords(input);
    return <LibraryBoardSection records={records} labels={host.labels} previews={host.previews} onCommand={host.onCommand} {...(host.workflow ? { workflow: host.workflow } : {})} />;
  };
}
