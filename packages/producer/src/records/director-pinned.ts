/**
 * Pinned Director candidates as the Director package's own `Cell` shape, so its checks
 * (contracts, won't-claim, grounding) run over the slot model unchanged. Bullets are read by
 * the Director's own `readBullet`; Producer parses no strategy prose itself.
 */
import type { Bullet, Cell, Finding, StrategyModel } from "@clossys/strategist";
import { agentModule } from "../server/cells.js";
import { candidateDocument, readPinned, type PinnedCandidate, type PinnedSet } from "./pinned.js";
import { readAgentFolder } from "./slots.js";
import { join } from "node:path";

export interface PinnedDirector {
  readonly set: PinnedSet;
  readonly cells: readonly Cell[];
  /** Pinned candidates whose body could not be read as Direction/Because/Watch. */
  readonly unreadable: readonly { slot: string; path: string; message: string }[];
}

const SECTIONS = { "## Direction": "direction", "## Because": "because", "## Watch": "watch" } as const;

async function toCell(candidate: PinnedCandidate): Promise<Cell> {
  const format = await agentModule("director", "cell-format/index.js");
  const { fields, body, firstLine } = candidateDocument(candidate);
  const lists: Record<"direction" | "because" | "watch", Bullet[]> = { direction: [], because: [], watch: [] };
  let section: keyof typeof lists | undefined;
  body.split("\n").forEach((text, index) => {
    if (text.startsWith("## ")) { section = SECTIONS[text.trim() as keyof typeof SECTIONS]; return; }
    if (!section) return;
    const bullet = format.readBullet(text, firstLine + index) as Bullet | undefined;
    if (bullet) lists[section].push(bullet);
  });
  if (!lists.direction.length) throw new Error(`${candidate.path}: no Direction bullets`);
  const source = fields.source as { ref?: unknown } | undefined;
  const cites = (Array.isArray(source?.ref) ? source!.ref as unknown[] : []).flatMap(ref =>
    typeof ref === "string" && ref.startsWith("finding:") ? [{ kind: "finding" as const, id: ref.slice("finding:".length) }] : []);
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    id: candidate.id, version: candidate.version, status: "active", updated: candidate.pin.at.slice(0, 10),
    cites, feeds: strings(fields.feeds), functions: strings(fields.functions),
    ...(typeof fields.note === "string" ? { note: fields.note } : {}),
    direction: lists.direction, because: lists.because, watch: lists.watch, path: candidate.path,
  };
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

export const directorRef = (cell: Pick<Cell, "id" | "version">) => `director:${cell.id}@${cell.version}`;

/** Director evidence (`agents/director/_evidence/<id>.md`), read by the Director's own finding parser. */
export async function readDirectorEvidence(consumer: string): Promise<{ findings: Finding[]; issues: { file: string; line: number; detail: string }[] }> {
  const files = readAgentFolder(consumer, "director", "_evidence");
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
