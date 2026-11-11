/**
 * The Director's content questions (DIR-INT): what `clossys next --owner --agent director` asks.
 *
 *   archetype      the core is the recorded archetype's (default core plus its extras); while no
 *                  archetype record exists and the Director has owner-held core cells, the archetype
 *                  is asked first (`clossys director check archetype <name> --by owner`).
 *   owner rounds   a core cell whose pin.director seat is held by the owner and that holds an open
 *                  option round: unpinned with candidates, or pinned with a drafted round newer than
 *                  its pin. A round is the newest candidate whose note opens `Option A (recommended)`
 *                  (newer than the pin) and every later `Option <L>` candidate; with no option notes,
 *                  an unpinned cell's newest candidates. Each becomes "Pick <cell title>", one option
 *                  per candidate (recommended first), each the exact pin argv.
 *   agent picks    non-core cells pinned by an agent seat (basis agent): one confirm question.
 *
 * Owner cells are ordered by the Director's dependency order: a cell another asked cell cites (the
 * catalog coherence links and cell links, and the recommended candidate's cell refs) comes first;
 * ties keep the catalog core order. Read-only; records nothing.
 */
import { slotCandidateCell } from "@clossys/director";
import type { Cell, StrategyModel } from "@clossys/director";
import { listSlots, readCandidate } from "../records/slots.js";
import type { SlotEntry } from "../records/slots.js";
import type { SeatReport } from "./seats.js";

export const ARCHETYPE_RECORD_ID = "director-archetype";
const OPTION_NOTE = /^Option ([A-Z])( \(recommended\))?/;

export interface RoundCandidate {
  readonly name: string;
  readonly version: number;
  readonly recommended: boolean;
  /** One line: the drafter's option note, else the first Direction bullet. */
  readonly summary: string;
  /** Cells the candidate cites. */
  readonly cites: readonly string[];
}
export interface OwnerCell {
  readonly cell: string;
  readonly item: string;
  readonly title: string;
  readonly header: string;
  /** The current pin's candidate, when the cell is pinned (the round is newer). */
  readonly pinned: string | null;
  /** The open round, recommended first. */
  readonly round: readonly RoundCandidate[];
}
export interface AgentPick { readonly cell: string; readonly item: string; readonly candidate: string; readonly group: string }
export interface DirectorContent {
  /** Archetype names (default first), and whether one is recorded. */
  readonly archetypes: readonly { readonly name: string; readonly extras: readonly string[] }[];
  readonly archetypeRecorded: boolean;
  /** The core cells of the recorded (else default) archetype, in catalog order. */
  readonly core: readonly string[];
  /** Owner-held core cells with an open round, in dependency order. */
  readonly owner: readonly OwnerCell[];
  readonly agentPicks: readonly AgentPick[];
}

const versionOf = (name: string) => Number(/-v(\d+)\.[a-z]+$/.exec(name)?.[1] ?? 0);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const SUMMARY_MAX = 200;
/** One line: the drafter's note (its option marker dropped, first sentence), then the first Direction bullet. */
function summaryOf(cell: Cell): string {
  const note = cell.note ? oneLine(cell.note.replace(/^Option [A-Z](?: \(recommended\))?[^:]*:\s*/, "")) : "";
  const sentence = note.split(/(?<=\.)\s/)[0]?.replace(/\.$/, "") ?? "";
  const first = cell.direction[0];
  const direction = first ? oneLine(`${first.key ? `${first.key}: ` : ""}${first.text}`).replace(/\.$/, "") : "";
  const line = [sentence, direction].filter(Boolean).join(". ") || cell.id;
  return line.length <= SUMMARY_MAX ? line : `${line.slice(0, line.lastIndexOf(" ", SUMMARY_MAX - 3))}...`;
}
const cellCites = (cell: Cell) => [...new Set(cell.cites.flatMap(ref => ref.kind === "cell" ? [ref.ref.cell] : []))];

function readRound(consumer: string, entry: SlotEntry): RoundCandidate[] {
  const pinned = entry.pin?.candidate ?? null;
  const pinVersion = pinned ? versionOf(pinned) : 0;
  const read = entry.candidates.flatMap(name => {
    try {
      const bytes = readCandidate(consumer, "director", entry.id, name).bytes;
      return [{ name, cell: slotCandidateCell({ id: entry.id, version: versionOf(name), updated: "", path: name, bytes }) }];
    } catch { return []; }
  });
  const marker = (cell: Cell) => OPTION_NOTE.exec(cell.note ?? "");
  const opener = read.filter(row => marker(row.cell)?.[1] === "A" && marker(row.cell)?.[2] && versionOf(row.name) > pinVersion).at(-1);
  let rows: typeof read;
  let recommended: string | undefined;
  if (opener) {
    rows = read.filter(row => versionOf(row.name) >= versionOf(opener.name) && marker(row.cell))
      .sort((a, b) => marker(a.cell)![1]!.localeCompare(marker(b.cell)![1]!) || versionOf(a.name) - versionOf(b.name));
    recommended = opener.name;
  } else if (!pinned) {
    rows = read.slice(-3).reverse();
    recommended = rows[0]?.name;
  } else return [];
  // An agent pick recorded on the round is the recommendation.
  if (entry.pin?.basis === "agent" && rows.some(row => row.name === pinned)) recommended = pinned!;
  rows = [...rows.filter(row => row.name === recommended), ...rows.filter(row => row.name !== recommended)];
  if (pinned && rows.some(row => row.name === pinned) && entry.pin?.basis !== "agent") return [];
  return rows.map(row => ({ name: row.name, version: versionOf(row.name), recommended: row.name === recommended, summary: summaryOf(row.cell), cites: cellCites(row.cell) }));
}

/** Cells in dependency order: each after every asked cell it depends on; ties in `order`. */
export function dependencyOrder(cells: readonly string[], dependsOn: (cell: string) => readonly string[], order: readonly string[]): string[] {
  const asked = new Set(cells);
  const rank = (cell: string) => { const at = order.indexOf(cell); return at < 0 ? order.length : at; };
  const deps = new Map(cells.map(cell => [cell, new Set(dependsOn(cell).filter(each => asked.has(each) && each !== cell))]));
  const out: string[] = [];
  const left = [...cells].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  while (left.length) {
    // The first cell whose dependencies are placed; on a cycle, the first one left.
    const at = Math.max(0, left.findIndex(cell => [...deps.get(cell)!].every(each => out.includes(each))));
    out.push(left.splice(at, 1)[0]!);
  }
  return out;
}

/** The Director content the interview asks, from the model read once and the pin.director seat. */
export function directorContent(consumer: string, model: StrategyModel, seat: SeatReport | undefined, ownerDecides: boolean): DirectorContent {
  const catalog = model.catalog;
  const archetypes = [{ name: "default", extras: [] as string[] }, ...Object.entries(catalog.archetypes.extras).map(([name, extras]) => ({ name, extras }))];
  const record = model.findings.find(finding => finding.id === ARCHETYPE_RECORD_ID);
  const archetypeRecorded = Boolean(record && typeof record.value === "string" && archetypes.some(each => each.name === record.value));
  const archetype = model.tree?.archetype ?? "default";
  const core = [...catalog.archetypes.default, ...(catalog.archetypes.extras[archetype] ?? [])];
  const coreSet = new Set(core);
  // The seat holds the owner: by owner (or owner:<ref>), else the step's own decider when no seat is recorded.
  const ownerHeld = seat?.by ? /^owner(?::|$)/.test(seat.by) : ownerDecides;
  const entries = listSlots(consumer, "director");
  const names = new Map(catalog.cells.map(cell => [cell.id, cell.names]));
  const owner: OwnerCell[] = [];
  if (ownerHeld) for (const entry of entries) {
    if (!coreSet.has(entry.id) || entry.state.state === "not-needed") continue;
    const round = readRound(consumer, entry);
    if (!round.length) continue;
    const name = names.get(entry.id);
    owner.push({ cell: entry.id, item: `director/${entry.id}`, title: name ? `${name.l3} (${name.l1} / ${name.l2})` : entry.id, header: (name?.l3 ?? entry.id).slice(0, 12), pinned: entry.pin?.candidate ?? null, round });
  }
  const byCell = new Map(owner.map(row => [row.cell, row]));
  const upstream = (cell: string) => [
    ...catalog.coherence.links.filter(link => link.downstream === cell).map(link => link.upstream),
    ...(catalog.cells.find(each => each.id === cell)?.links ?? []).map(link => link.cites),
    ...(byCell.get(cell)?.round[0]?.cites ?? []),
  ];
  const ordered = dependencyOrder(owner.map(row => row.cell), upstream, core).map(cell => byCell.get(cell)!);
  const agentPicks = entries.filter(entry => !coreSet.has(entry.id) && entry.pin?.basis === "agent" && entry.pin.decidedBy.startsWith("agent:director"))
    .map(entry => ({ cell: entry.id, item: `director/${entry.id}`, candidate: entry.pin!.candidate, group: entry.id.slice(0, entry.id.indexOf(".")) }));
  return { archetypes, archetypeRecorded, core, owner: ordered, agentPicks };
}
