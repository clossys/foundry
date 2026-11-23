/**
 * `clossys answer --export <file>` and `clossys answer --replay <file>` (ANSWER-REPLAY): the owner answers a consumer's
 * queue records, written out and re-applied on another consumer with no model call.
 *
 * The export lists every owner `answered` event, oldest first, as the question it answered (queue, subject, ask) and
 * the answer (answer, via, quote, note). It carries no entry id and no time: both are stamped when an entry is raised
 * or answered, so a fresh consumer has its own, and two consumers that hold the same answers export the same bytes.
 *
 * Replay matches each exported answer, in order, to an entry of the same queue, subject and ask (lowest id first,
 * each entry used once) and answers it through `answerQueueEntry`, so every answer rule runs as for `clossys answer`.
 * An entry already answered with the same words counts as applied, so a re-run writes nothing. Every answer is
 * matched before any is written: when one matches no open question, replay names the first such answer and writes
 * nothing. The answers it writes are stamped one second apart from `now`, in replay order, so the replayed
 * consumer's own export lists them in the same order (answers written in the same second would sort by queue).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { QueueEntry, Ref } from "../records/types.js";
import { AnswerRefused, answerQueueEntry, VIAS, type Via } from "./answer.js";
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
  constructor(readonly index: number, message: string) {
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
    if (!ok) throw new ReplayRefused(index, `${name}: answer ${index + 1} is not a recorded owner answer (queue, subject, ask, answer, via, quote[, note])`);
  });
  return file as AnswersFile;
}

const label = (index: number, row: ExportedAnswer): string => `answer ${index + 1} (${row.queue} ${row.subject} "${row.ask}" = ${row.answer})`;
const sameAnswer = (row: ExportedAnswer, event: Event): boolean => event.op === "answered" && event.by === "owner"
  && event.answer === row.answer && (event.via ?? "cli") === row.via && (event.quote ?? "") === row.quote && event.note === row.note;

export interface ReplayStep { readonly index: number; readonly queue: string; readonly id: string; readonly action: "answered" | "already" }

/** Re-applies `file`'s answers under `root`, in order. Throws ReplayRefused naming the first answer that does not apply. */
export function replayAnswers(root: string, file: AnswersFile, now: Date = new Date()): ReplayStep[] {
  const entries = readEntries(root).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Set<string>();
  const plan: { index: number; row: ExportedAnswer; entry: QueueEntry; action: "answer" | "already" }[] = [];
  file.answers.forEach((row, index) => {
    const same = entries.filter(entry => !used.has(`${entry.queue}#${entry.id}`) && entry.queue === row.queue && subjectLabel(entry.subject) === row.subject && entry.ask === row.ask);
    const applied = same.find(entry => entry.status === "answered" && entry.events.some(event => sameAnswer(row, event)));
    const open = same.find(entry => entry.status === "open");
    const entry = applied ?? open;
    if (!entry) throw new ReplayRefused(index, `${label(index, row)} no longer matches an open question; nothing was written`);
    used.add(`${entry.queue}#${entry.id}`);
    plan.push({ index, row, entry, action: applied ? "already" : "answer" });
  });
  let written = 0;
  return plan.map(({ index, row, entry, action }) => {
    if (action === "already") return { index, queue: entry.queue, id: entry.id, action: "already" };
    try {
      answerQueueEntry(root, { entry: `${entry.queue}#${entry.id}`, answer: row.answer, by: "owner", via: row.via, quote: row.quote, ...(row.note !== undefined ? { note: row.note } : {}) }, new Date(now.getTime() + 1000 * written++));
    } catch (error) {
      if (error instanceof AnswerRefused) throw new ReplayRefused(index, `${label(index, row)} refused (${error.check}): ${error.message}`);
      throw error;
    }
    return { index, queue: entry.queue, id: entry.id, action: "answered" };
  });
}

export function replayAnswersFile(root: string, path: string, now?: Date): ReplayStep[] {
  return replayAnswers(root, parseAnswersFile(readFileSync(path, "utf8"), path), now);
}
