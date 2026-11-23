/**
 * `clossys answer --export <file>` and `clossys answer --replay <file>` (ANSWER-REPLAY): the owner answers a consumer's
 * queue records, written out and re-applied on another consumer with no model call.
 *
 * The export lists every owner `answered` event, oldest first, as the question it answered (queue, subject, ask) and
 * the answer (answer, via, quote, note). It carries no entry id and no time: both are stamped when an entry is raised
 * or answered, so a fresh consumer has its own, and two consumers that hold the same answers export the same bytes.
 *
 * Replay walks the answers in order. For each it re-reads the consumer's queue entries and looks for one of the same
 * queue, subject and ask (lowest id first, each entry used once): an entry already answered with the same words counts
 * as applied; else an open one is answered through `answerQueueEntry`, so every answer rule runs as for `clossys answer`.
 * Rounds come one after another (a round-two question is raised only once round one is answered), so replay applies
 * what it can and stops at the first answer whose question is not open, naming it and how many answers are applied;
 * the answers before it stay applied, and a re-run once that question is raised carries on from there. A rule refusal
 * stops it the same way. An owner answer to a queue.pick whose option names a candidate is followed, as `clossys answer`
 * prints it, by that same `clossys pin ... --by owner:queue.pick#<id>` run through the pin verb (every pin rule and
 * guard runs); a pin that already records that candidate from that answer is not run again, so a re-run writes nothing.
 * The answers and pins it writes are stamped one second apart from `now`, in replay order, so the replayed consumer's
 * own export lists them in the same order (answers written in the same second would sort by queue).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPinCli } from "../cli/pin.js";
import { readPinFile } from "../records/pin-map.js";
import type { QueueEntry, Ref } from "../records/types.js";
import { AnswerRefused, answerQueueEntry, pickFollowUp, VIAS, type Via } from "./answer.js";
import { listQueueEntryFiles, QUEUE_NAMES, readQueueEntry } from "./entry.js";

export const ANSWERS_SCHEMA = "clossys.answers/1";

export interface ExportedAnswer {
  readonly queue: QueueEntry["queue"];
  /** `<agent>/<slot>[#<record>]`, the entry's subject. */
  readonly subject: string;
  readonly ask: string;
  readonly answer: string;
  readonly via: Via;
  readonly quote: string;
  readonly note?: string;
}

export interface AnswersFile {
  readonly schema: typeof ANSWERS_SCHEMA;
  readonly answers: readonly ExportedAnswer[];
}

const subjectLabel = (ref: Ref): string => `${ref.to}${ref.record ? `#${ref.record}` : ""}`;
type Event = QueueEntry["events"][number];

function readEntries(root: string): QueueEntry[] {
  const entries: QueueEntry[] = [];
  for (const at of listQueueEntryFiles(root)) {
    const read = readQueueEntry(at);
    if (read.ok) entries.push(read.entry);
  }
  return entries;
}

const exportedOf = (entry: QueueEntry, event: Event): ExportedAnswer => ({
  queue: entry.queue, subject: subjectLabel(entry.subject), ask: entry.ask, answer: event.answer!,
  via: event.via ?? "cli", quote: event.quote ?? "", ...(event.note !== undefined ? { note: event.note } : {}),
});

/** The owner answers recorded under `root`, oldest first (ties by queue, then entry id). */
export function exportAnswers(root: string): AnswersFile {
  const rows: { at: string; queue: string; id: string; answer: ExportedAnswer }[] = [];
  for (const entry of readEntries(root)) {
    for (const event of entry.events) {
      if (event.op === "answered" && event.by === "owner" && event.answer !== undefined) rows.push({ at: event.at, queue: entry.queue, id: entry.id, answer: exportedOf(entry, event) });
    }
  }
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) => order(a.at, b.at) || order(a.queue, b.queue) || order(a.id, b.id));
  return { schema: ANSWERS_SCHEMA, answers: rows.map(row => row.answer) };
}

export const serializeAnswers = (file: AnswersFile): string => `${JSON.stringify(file, null, 2)}\n`;

export function writeAnswersExport(root: string, file: string): AnswersFile {
  const doc = exportAnswers(root);
  writeFileSync(file, serializeAnswers(doc));
  return doc;
}

export class ReplayRefused extends Error {
  /** `steps`: what this run did before it stopped (answers and pins it wrote, or found already applied). */
  constructor(readonly index: number, message: string, readonly steps: readonly ReplayStep[] = []) {
    super(message);
    this.name = "ReplayRefused";
  }
}

const isString = (value: unknown): value is string => typeof value === "string";

/** Parses an answers file; refuses anything that is not clossys.answers/1. */
export function parseAnswersFile(text: string, name: string): AnswersFile {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (error) { throw new ReplayRefused(-1, `${name} is not JSON: ${(error as Error).message}`); }
  const file = doc as Partial<AnswersFile> | null;
  if (!file || file.schema !== ANSWERS_SCHEMA || !Array.isArray(file.answers)) throw new ReplayRefused(-1, `${name} is not a ${ANSWERS_SCHEMA} file`);
  file.answers.forEach((row, index) => {
    const ok = row && (QUEUE_NAMES as readonly unknown[]).includes(row.queue) && isString(row.subject) && isString(row.ask) && isString(row.answer)
      && (VIAS as readonly unknown[]).includes(row.via) && isString(row.quote) && (row.note === undefined || isString(row.note));
    if (!ok) throw new ReplayRefused(-1, `${name}: answer ${index + 1} is not a recorded owner answer (queue, subject, ask, answer, via, quote[, note])`);
  });
  return file as AnswersFile;
}

const label = (index: number, row: ExportedAnswer): string => `answer ${index + 1} (${row.queue} ${row.subject} "${row.ask}" = ${row.answer})`;
const sameAnswer = (row: ExportedAnswer, event: Event): boolean => event.op === "answered" && event.by === "owner"
  && event.answer === row.answer && (event.via ?? "cli") === row.via && (event.quote ?? "") === row.quote && event.note === row.note;
const isoSeconds = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, "Z");

export interface ReplayPin { readonly command: string; readonly action: "pinned" | "already" }
export interface ReplayStep {
  readonly index: number; readonly queue: string; readonly id: string; readonly action: "answered" | "already";
  /** The pick's follow-up pin, when the answered option names a candidate. */
  readonly pin?: ReplayPin;
}

const PIN_COMMAND = /^clossys pin ([a-z]+)\/([^\s#]+)(?:#(\S+))? (\S+) --by (\S+)$/;

/** True when the slot's pin already records `candidate` decided by `by` (the follow-up ran). */
function pinRecorded(root: string, command: string): boolean {
  const match = PIN_COMMAND.exec(command);
  if (!match) return false;
  const [, agent, slotId, record, candidate, by] = match;
  const read = readPinFile(join(root, "clossys", "agents", agent!, slotId!, "pin.json"));
  const pinned = read.kind === "pin" ? read.doc : read.kind === "pin-map" && record !== undefined ? read.doc.records[record] : undefined;
  return pinned !== undefined && pinned.candidate === candidate && pinned.decidedBy === by;
}

/**
 * Re-applies `file`'s answers under `root`, in order, each pick's follow-up pin with it. Throws ReplayRefused naming the
 * first answer that does not apply (its question is not open, a rule refuses it, or its pin is refused); the answers
 * before it stay applied.
 */
export async function replayAnswers(root: string, file: AnswersFile, now: Date = new Date()): Promise<ReplayStep[]> {
  const used = new Set<string>();
  const steps: ReplayStep[] = [];
  let written = 0;
  const stamp = (): Date => new Date(now.getTime() + 1000 * written++);
  const stop = (index: number, row: ExportedAnswer, why: string): ReplayRefused => new ReplayRefused(index,
    `${label(index, row)} ${why}; ${index} of ${file.answers.length} answer(s) before it are applied, `
    + `${steps.filter(step => step.action === "answered").length} written by this run; re-run once it can apply to carry on`, steps);
  for (const [index, row] of file.answers.entries()) {
    // Re-read after every answer: answering one round is what raises the next.
    const entries = readEntries(root).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const same = entries.filter(entry => !used.has(`${entry.queue}#${entry.id}`) && entry.queue === row.queue && subjectLabel(entry.subject) === row.subject && entry.ask === row.ask);
    const applied = same.find(entry => entry.status === "answered" && entry.events.some(event => sameAnswer(row, event)));
    const open = same.find(entry => entry.status === "open");
    const entry = applied ?? open;
    if (!entry) throw stop(index, row, "matches no open question (same queue, subject and ask)");
    used.add(`${entry.queue}#${entry.id}`);
    let answered: QueueEntry = entry, event: Event | undefined = applied?.events.find(item => sameAnswer(row, item));
    if (!applied) {
      try {
        const result = answerQueueEntry(root, { entry: `${entry.queue}#${entry.id}`, answer: row.answer, by: "owner", via: row.via, quote: row.quote, ...(row.note !== undefined ? { note: row.note } : {}) }, stamp());
        answered = result.entry; event = result.event;
      } catch (error) {
        if (error instanceof AnswerRefused) throw stop(index, row, `refused (${error.check}): ${error.message}`);
        throw error;
      }
    }
    const step: ReplayStep = { index, queue: entry.queue, id: entry.id, action: applied ? "already" : "answered" };
    const command = event ? pickFollowUp(answered, event) : undefined;
    if (command === undefined) { steps.push(step); continue; }
    if (pinRecorded(root, command)) { steps.push({ ...step, pin: { command, action: "already" } }); continue; }
    // The same pin `clossys answer` prints, run through the pin verb (its deciders, CHOOSE gate and guard).
    const argv = command.split(" ").slice(2);
    const pinned = await runPinCli([...argv, "--at", isoSeconds(stamp()), "--root", root], root);
    steps.push(step);
    if (pinned.exitCode !== 0) throw stop(index, row, `was answered, but its pin (${command}) was refused: ${pinned.message}`);
    steps[steps.length - 1] = { ...step, pin: { command, action: "pinned" } };
  }
  return steps;
}

export async function replayAnswersFile(root: string, path: string, now?: Date, name: string = path): Promise<ReplayStep[]> {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ReplayRefused(-1, code === "ENOENT" ? `${name} does not exist: write one with clossys answer --export <file>` : `${name} cannot be read (${code ?? (error as Error).message})`);
  }
  return replayAnswers(root, parseAnswersFile(text, name), now);
}
