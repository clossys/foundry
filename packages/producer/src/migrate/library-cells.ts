/**
 * `clossys migrate recut`, step 3: the int2 library tree `clossys/library/<slot>/<name>/v<n>/` becomes slot
 * candidates. Each version folder is one cell: `cell.md` is the body of one candidate `<name>-v<n>.md` in the
 * slot the recut maps `<slot>` to, `element.json` is its int2 header (folded into the candidate/1 header, as
 * system.md 6.2 does with the Designer `meta.element`), and `preview.json` is dropped (previews are computed).
 * A cell holding any other file, no `cell.md`, or a name that is no candidate name is a finding and is left in
 * place. Once written, the cell folder is removed, so a second run finds nothing to convert.
 */
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { CANDIDATE_NAME } from "../records/candidate.js";
import { ELEMENT_FILE, PREVIEW_FILE } from "../records/library.js";
import { fileState, type FileState } from "../records/migrations.js";
import type { AgentId } from "../records/types.js";

/** The library folder under the consumer folder (`clossys/`). */
export const LIBRARY_DIR = "library";
export const CELL_FILE = "cell.md";
const CELL_FILES = new Set([CELL_FILE, ELEMENT_FILE, PREVIEW_FILE]);
const VERSION = /^v([1-9][0-9]*)$/;

export interface LibraryCell {
  /** The int2 slot id the cell sits under. */
  readonly slot: string;
  readonly name: string;
  readonly version: number;
  /** The version folder. */
  readonly dir: string;
  /** Every file name in the version folder. */
  readonly files: readonly string[];
}

/** Every cell under `<consumer>/library/`, sorted by slot, name and version. */
export function listLibraryCells(consumer: string): LibraryCell[] {
  const root = join(consumer, LIBRARY_DIR);
  if (!existsSync(root)) return [];
  const dirs = (dir: string) => readdirSync(dir).filter(entry => statSync(join(dir, entry)).isDirectory()).sort();
  const cells: LibraryCell[] = [];
  for (const slot of dirs(root)) for (const name of dirs(join(root, slot))) {
    const versions = dirs(join(root, slot, name)).flatMap(entry => {
      const match = VERSION.exec(entry);
      return match ? [Number(match[1])] : [];
    }).sort((a, b) => a - b);
    for (const version of versions) {
      const dir = join(root, slot, name, `v${version}`);
      cells.push({ slot, name, version, dir, files: readdirSync(dir).sort() });
    }
  }
  return cells;
}

/** Where a cell's slot goes: a slot folder of an agent, or why it has none. */
export type CellRoute =
  | {
    readonly agent: AgentId; readonly slotId: string; readonly dir: string; readonly record: boolean;
    /** A slot folder that moves to `dir` before the cell is written: its candidates count as already there. */
    readonly arriving?: string;
  }
  | { readonly finding: string };

/** The candidate bytes for a cell: the body kept byte for byte, the header built from the int2 element record. */
export type CellConvert = (input: { readonly agent: AgentId; readonly slotId: string; readonly name: string; readonly body: string; readonly element: unknown; readonly sourceRef: string; readonly from?: string }) => string;

export interface CellConversion {
  readonly cell: LibraryCell;
  readonly agent: AgentId;
  readonly slotId: string;
  /** The candidate file written. */
  readonly file: string;
  readonly bytes: string;
  /** The ids of `cell.md`, the bytes the candidate's body keeps. */
  readonly from: FileState;
  /** Whether the migration manifest records the file (a slot folder in the tree, not a retired one). */
  readonly record: boolean;
}

export interface LibraryPlan {
  readonly conversions: CellConversion[];
  readonly findings: string[];
}

const posix = (cell: LibraryCell) => `${LIBRARY_DIR}/${cell.slot}/${cell.name}/v${cell.version}`;

/** What the conversion would write, without writing. `planned` holds candidate files other steps already plan. */
export function planLibraryCells(consumer: string, route: (slot: string) => CellRoute, convert: CellConvert, planned: ReadonlySet<string> = new Set()): LibraryPlan {
  const conversions: CellConversion[] = [];
  const findings: string[] = [];
  for (const cell of listLibraryCells(consumer)) {
    const at = posix(cell);
    const extra = cell.files.filter(file => !CELL_FILES.has(file));
    if (extra.length) { findings.push(`${at}: holds ${extra.join(", ")}, not only ${[...CELL_FILES].join(", ")}; left in place`); continue; }
    if (!cell.files.includes(CELL_FILE)) { findings.push(`${at}: no ${CELL_FILE}; left in place`); continue; }
    const candidate = `${cell.name}-v${cell.version}.md`;
    if (!CANDIDATE_NAME.test(candidate)) { findings.push(`${at}: ${candidate} is not a candidate name; left in place`); continue; }
    const target = route(cell.slot);
    if ("finding" in target) { findings.push(`${at}: ${target.finding}`); continue; }
    const file = join(target.dir, "candidates", candidate);
    if (existsSync(file) || planned.has(file) || (target.arriving !== undefined && existsSync(join(target.arriving, "candidates", candidate)))) { findings.push(`${at}: ${target.agent}/${target.slotId}/candidates/${candidate} already exists; left in place`); continue; }
    const body = readFileSync(join(cell.dir, CELL_FILE), "utf8");
    let element: unknown;
    if (cell.files.includes(ELEMENT_FILE)) {
      try { element = JSON.parse(readFileSync(join(cell.dir, ELEMENT_FILE), "utf8")); }
      catch (error) { findings.push(`${at}: ${ELEMENT_FILE} is not JSON (${(error as Error).message}); left in place`); continue; }
    }
    let bytes: string;
    try { bytes = convert({ agent: target.agent, slotId: target.slotId, name: candidate, body, element, sourceRef: at, from: cell.slot }); }
    catch (error) { findings.push(`${at}: ${(error as Error).message}; left in place`); continue; }
    conversions.push({ cell, agent: target.agent, slotId: target.slotId, file, bytes, from: fileState(body), record: target.record });
  }
  return { conversions, findings };
}

/** Removes a converted cell: its three files, then each folder left empty up to the library root. */
export function removeLibraryCell(consumer: string, cell: LibraryCell): void {
  for (const file of cell.files) if (CELL_FILES.has(file)) unlinkSync(join(cell.dir, file));
  const stop = join(consumer, LIBRARY_DIR);
  let dir = cell.dir;
  while (dir.startsWith(stop) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    if (dir === stop) break;
    dir = dirname(dir);
  }
}
