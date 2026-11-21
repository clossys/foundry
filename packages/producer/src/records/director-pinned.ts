/**
 * Pinned Director candidates as the Director package's own `Cell` shape, so its checks
 * (contracts, won't-claim, grounding) run over the slot model unchanged. Candidates are read by
 * the Director's own `slotCandidateCell`; Producer parses no strategy prose itself.
 */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { Cell, Finding, StrategyModel } from "@clossys/director";
import { agentModule } from "../read/cells.js";
import { readPinned, type PinnedCandidate, type PinnedSet } from "./pinned.js";

export interface PinnedDirector {
  readonly set: PinnedSet;
  readonly cells: readonly Cell[];
  /** Pinned candidates whose body could not be read as Direction/Because/Watch. */
  readonly unreadable: readonly { slot: string; path: string; message: string }[];
}

/** One candidate parser for every reader: Director's own `slotCandidateCell` (@clossys/director), over the file as written (it reads a clossys header as the candidate view does, and counts body lines in the file). */
async function toCell(candidate: PinnedCandidate): Promise<Cell> {
  const director = await agentModule("director", "index.js");
  return director.slotCandidateCell({ id: candidate.id, version: candidate.version, updated: candidate.pin.at.slice(0, 10), path: candidate.path, bytes: candidate.raw }) as Cell;
}

/** The consumer's pinned Director set as cells. `consumer` is the `clossys/` folder. */
export async function readPinnedDirector(consumer: string): Promise<PinnedDirector> {
  const set = readPinned(consumer, "director");
  const cells: Cell[] = [], unreadable: { slot: string; path: string; message: string }[] = [];
  for (const candidate of set.pinned) {
    try { cells.push(await toCell(candidate)); }
    catch (error) { unreadable.push({ slot: candidate.id, path: candidate.path, message: error instanceof Error ? error.message : String(error) }); }
  }
  return { set, cells, unreadable };
}

/** A pinned Director cell's citation: its slot id, resolved through the slot's pin (planner D2). */
export const directorRef = (cell: Pick<Cell, "id">) => `director:${cell.id}`;
/**
 * A line anchor into the pinned Director candidate: `director:<id>@<version>`, then `#L<line>` or `#direction-L<line>`.
 * A line number only means something in the bytes of one version, so line-anchored record sources (Writer
 * `directorSources`, Designer traits) keep the version until the Writer and Designer packages move them to slot ids.
 */
export const directorLineRef = (cell: Pick<Cell, "id" | "version">) => `director:${cell.id}@${cell.version}`;

/** Director evidence (`evidence/director/<id>.md`, outside the agent tree), read by the Director's own finding parser. */
export async function readDirectorEvidence(consumer: string): Promise<{ findings: Finding[]; issues: { file: string; line: number; detail: string }[] }> {
  const dir = join(consumer, "evidence", "director");
  const files: Record<string, string> = {};
  let names: string[] = [];
  try { names = readdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const name of names.sort()) {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) throw new Error("Symbolic links are not followed in the slot model");
    if (lstatSync(path).isFile()) files[name] = readFileSync(path, "utf8");
  }
  const api = await agentModule("director", "index.js");
  const read = api.readFindings({ files });
  return { findings: read.findings, issues: read.issues };
}

/** A Director model for the Director's pure checks: the pinned cells stand as the active set. */
export function pinnedStrategyModel(consumer: string, cells: readonly Cell[], findings: readonly Finding[]): StrategyModel {
  return {
    root: join(consumer, "agents", "director"),
    catalog: undefined as unknown as StrategyModel["catalog"],
    tree: { schemaVersion: 1, catalog: "slot-model", archetype: "slot-model", core: "archetype", active: Object.fromEntries(cells.map(cell => [cell.id, cell.version])) },
    cells: [...cells], sessions: [], findings: [...findings], requests: [], files: {}, issues: [],
  };
}
