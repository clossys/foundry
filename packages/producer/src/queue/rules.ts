/**
 * The per-entry answer rules (system.md 12.6). Each rule returns the issues of one queue entry; the file checks
 * (`src/check/answer-*.ts`) run them over every committed entry, and `clossys answer` runs the same functions on the
 * entry it is about to write, so the CLI and the checks cannot disagree.
 *
 * A rule takes the workspace root as well, so a rule that reads another file (a code close's `answers` ref) resolves it
 * the same way for the CLI and the checks.
 *
 * Check ids follow the ticket; system.md 12.6 calls two of them `answer.in-options` and `answer.owner-quoted`
 * (ANSWER_CHECK_ALIASES maps those names).
 */
import { danglingReason } from "../check/refs-dangling.js";
import { targetSchema } from "../records/candidate.js";
import { OWNER_QUEUE_ANSWER } from "../records/pin.js";
import { validateAgainst } from "../records/schema.js";
import type { QueueEntry, Ref } from "../records/types.js";
import { findQueueEntry, readQueueEntry } from "./entry.js";

export const ANSWER_OPEN_ONLY = "answer.open-only";
export const ANSWER_DECIDER_MATCH = "answer.decider-match";
export const ANSWER_OPTION_VALID = "answer.option-valid";
export const ANSWER_QUOTE_REQUIRED = "answer.quote-required";

/** system.md 12.6 names, resolved to the check that enforces them. */
export const ANSWER_CHECK_ALIASES: Readonly<Record<string, string>> = {
  "answer.in-options": ANSWER_OPTION_VALID,
  "answer.owner-quoted": ANSWER_QUOTE_REQUIRED,
};

type Event = QueueEntry["events"][number];

/** `owner`, `agent:<id>` or `code:<cli>`: who may write an `answered` event. */
export const ANSWER_BY = /^(owner|agent:(director|designer|writer|publisher|producer)|code:[a-z][a-z0-9 ._-]*)$/;
/** Queues a `code:<cli>` answer may close: the fix or clarify whose work a pin or an approval finished. */
export const CODE_CLOSABLE: readonly QueueEntry["queue"][] = ["queue.fix", "queue.clarify"];

const events = (entry: QueueEntry): Event[] => (Array.isArray(entry.events) ? entry.events : []);
const answered = (entry: QueueEntry): [Event, number][] =>
  events(entry).map((event, index): [Event, number] => [event, index]).filter(([event]) => event?.op === "answered");
const blank = (value: unknown): boolean => typeof value !== "string" || value.trim() === "";

/** The record schema `clossys.queue-entry/1`. */
export function entrySchemaIssues(entry: unknown): string[] {
  return validateAgainst(targetSchema("queue-entry"), entry).map(issue => `schema: ${issue.path} ${issue.message}`);
}

/**
 * `answer.open-only`: an entry is answered (or withdrawn) at most once. The first event raises it and is the only
 * `raised`; at most one terminal event, and it is the last; `status` agrees with the events; times never go back.
 */
export function openOnlyIssues(entry: QueueEntry): string[] {
  const out: string[] = [];
  const list = events(entry);
  if (list.length === 0) return ["the entry has no events"];
  if (list[0]?.op !== "raised") out.push(`events[0] is ${JSON.stringify(list[0]?.op)}, not raised`);
  list.forEach((event, index) => { if (index > 0 && event?.op === "raised") out.push(`events[${index}] raises the entry again`); });
  const terminal = list.map((event, index) => [event?.op, index] as const).filter(([op]) => op === "answered" || op === "withdrawn");
  if (terminal.length > 1) out.push(`the entry is closed ${terminal.length} times (events ${terminal.map(([, index]) => index).join(", ")}); an entry takes one answer`);
  if (terminal.length && terminal[terminal.length - 1]![1] !== list.length - 1) out.push(`events[${terminal[terminal.length - 1]![1]}] closes the entry but later events follow`);
  const last = terminal.length ? terminal[terminal.length - 1]![0] : undefined;
  const expected = last === "answered" ? "answered" : last === "withdrawn" ? "withdrawn" : "open";
  if (entry.status !== expected) out.push(`status is ${JSON.stringify(entry.status)} but the events say ${expected}`);
  for (let index = 1; index < list.length; index++) {
    const before = Date.parse(list[index - 1]?.at ?? ""), now = Date.parse(list[index]?.at ?? "");
    if (!(now >= before)) out.push(`events[${index}].at ${list[index]?.at} is before events[${index - 1}].at ${list[index - 1]?.at}`);
  }
  return out;
}

/** The `<agent>/<slot-id>` a ref points into (its `to` without a candidate). */
const slotOf = (to: string): string => to.split("/").slice(0, 2).join("/");

/**
 * A ref is about the entry's subject when it points into the same slot and, when the subject names a record, names
 * that record too.
 */
const aboutSubject = (ref: Pick<Ref, "to" | "record"> | undefined, subject: Ref | undefined): boolean =>
  typeof ref?.to === "string" && typeof subject?.to === "string" && slotOf(ref.to) === slotOf(subject.to)
  && (subject.record === undefined || ref.record === subject.record);

const refLabel = (ref: Pick<Ref, "to" | "record"> | undefined): string => `${ref?.to}${ref?.record !== undefined ? `#${ref.record}` : ""}`;

/**
 * Why one `answers` ref does not finish the entry's subject, or undefined when it does: it is either a pin ref (a
 * slot, candidate or record that exists) about the entry's subject, or an answered queue.approve whose subject is
 * the entry's subject.
 */
export function answersRefIssue(root: string, entry: QueueEntry, ref: Ref): string | undefined {
  const label = refLabel(ref);
  if (ref.to === ("producer/queue.approve" as Ref["to"])) {
    if (typeof ref.record !== "string") return `${label} names no queue.approve entry`;
    const found = findQueueEntry(root, `producer/queue.approve#${ref.record}`);
    if (!found.ok) return `${label}: ${found.reason}`;
    const read = readQueueEntry(found.at);
    if (!read.ok) return `${label}: ${read.reason}`;
    if (read.entry.status !== "answered") return `${label}: that entry is ${read.entry.status}, not answered`;
    if (!aboutSubject(read.entry.subject, entry.subject)) return `${label} approves ${refLabel(read.entry.subject)}, not this entry's subject ${refLabel(entry.subject)}`;
    return undefined;
  }
  if (typeof ref.to !== "string" || ref.to === "facts" || ref.to.startsWith("producer/queue.") || ref.to.startsWith("producer/ledger.")) {
    return `${label} is not a pin ref or a queue.approve entry`;
  }
  const dangling = danglingReason(root, ref);
  if (dangling) return `${label}: ${dangling}`;
  if (!aboutSubject(ref, entry.subject)) return `${label} is not this entry's subject ${refLabel(entry.subject)}`;
  return undefined;
}

/**
 * `answer.decider-match`: an answer comes from the decider the entry names. `owner` answers only an owner entry,
 * `agent:<id>` only an entry whose decider is that agent, and only through the CLI (`via` absent or `cli`). One
 * exception: `code:<cli>` may close a queue.fix or queue.clarify that an agent decides (never a pick, an approve or
 * an owner entry), with `via: cli` and an `answers` ref to the pin or the answered queue.approve that finished the
 * entry's own subject.
 */
export function deciderMatchIssues(entry: QueueEntry, root: string): string[] {
  const out: string[] = [];
  for (const [event, index] of answered(entry)) {
    const by = typeof event.by === "string" ? event.by : "";
    const where = `events[${index}] answered by ${JSON.stringify(by)}`;
    if (!ANSWER_BY.test(by)) { out.push(`${where}: by is not owner, agent:<id> or code:<cli>`); continue; }
    if (by.startsWith("code:")) {
      if (!CODE_CLOSABLE.includes(entry.queue)) out.push(`${where}: code may close only queue.fix or queue.clarify, not ${entry.queue}`);
      if (entry.decider === "owner") out.push(`${where}: the owner decides this entry; code may not close it`);
      if (event.via !== "cli") out.push(`${where}: a code close is via cli, not ${JSON.stringify(event.via ?? null)}`);
      const answers = (Array.isArray(entry.refs) ? entry.refs : []).filter(ref => ref?.rel === "answers");
      if (answers.length === 0) { out.push(`${where}: a code close carries an answers ref to the pin or queue.approve that finished it`); continue; }
      const issues = answers.map(ref => answersRefIssue(root, entry, ref));
      if (issues.every(issue => issue !== undefined)) out.push(`${where}: no answers ref finishes this entry's subject (${issues.join("; ")})`);
      continue;
    }
    if (by !== "owner" && event.via !== undefined && event.via !== "cli") out.push(`${where}: an agent answers through the CLI only (via cli), not ${event.via}`);
    if (by !== entry.decider) out.push(`${where}: the entry's decider is ${entry.decider}`);
  }
  return out;
}

/**
 * `answer.option-valid`: every answer names one of the entry's `options[].id` or equals its `default`. A queue.pick or
 * queue.approve must carry options; queue.clarify takes free text; queue.fix takes free text unless it lists options.
 */
export function optionValidIssues(entry: QueueEntry): string[] {
  const out: string[] = [];
  const options = Array.isArray(entry.options) ? entry.options : [];
  const ids = options.map(option => option?.id);
  const duplicate = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicate.length) out.push(`options repeat the id ${[...new Set(duplicate)].map(id => JSON.stringify(id)).join(", ")}`);
  const needsOptions = entry.queue === "queue.pick" || entry.queue === "queue.approve";
  if (needsOptions && options.length === 0) out.push(`${entry.queue} carries no options to answer from`);
  for (const [event, index] of answered(entry)) {
    if (blank(event.answer)) { out.push(`events[${index}] is answered with no answer`); continue; }
    if (entry.queue === "queue.clarify" || (entry.queue === "queue.fix" && options.length === 0)) continue;
    if (!ids.includes(event.answer!) && event.answer !== entry.default) {
      out.push(`events[${index}] answer ${JSON.stringify(event.answer)} is not an option (${ids.map(id => JSON.stringify(id)).join(", ") || "none"}) or the default ${JSON.stringify(entry.default)}`);
    }
  }
  return out;
}

/**
 * `answer.quote-required`: an owner answer names its channel (`via`) and records the owner's own words (`quote`),
 * whatever the channel; only an owner answer takes a quote.
 */
export function quoteRequiredIssues(entry: QueueEntry): string[] {
  const out: string[] = [];
  for (const [event, index] of answered(entry)) {
    if (event.by === "owner") {
      if (event.via === undefined) out.push(`events[${index}] is an owner answer that names no channel (via cli|chat|app)`);
      if (blank(event.quote)) out.push(`events[${index}] is an owner answer with no quote of the owner's words`);
    } else if (event.quote !== undefined) {
      out.push(`events[${index}] answered by ${JSON.stringify(event.by)} carries a quote; only an owner answer takes one`);
    }
  }
  return out;
}

export type AnswerRule = (entry: QueueEntry, root: string) => string[];

export const ANSWER_RULES: readonly { readonly check: string; readonly issues: AnswerRule }[] = [
  { check: ANSWER_OPEN_ONLY, issues: openOnlyIssues },
  { check: ANSWER_DECIDER_MATCH, issues: deciderMatchIssues },
  { check: ANSWER_OPTION_VALID, issues: optionValidIssues },
  { check: ANSWER_QUOTE_REQUIRED, issues: quoteRequiredIssues },
];

/** An owner answer ref (`owner:queue.<kind>#<id>`) as it resolves on disk. */
export type OwnerAnswer =
  | { readonly ok: false; readonly issues: readonly string[] }
  | { readonly ok: true; readonly entry: QueueEntry; readonly name: string; readonly answered: Event | undefined; readonly issues: readonly string[] };

/**
 * The one owner-answer predicate (foundry-build-0048 U7): `by` is `owner:queue.<kind>#<id>` (records/pin.ts
 * OWNER_QUEUE_ANSWER), the entry exists, it is answered, and the owner wrote the answer. `issues` is empty only then.
 * `release/ready.ts` adds its ready-pin rules on top; `records/seat-owner.ts assertActor` and the request closers take
 * it as it is. `queues` limits the kinds the caller accepts.
 */
export function resolveOwnerAnswer(root: string, by: string, queues?: readonly string[]): OwnerAnswer {
  const match = OWNER_QUEUE_ANSWER.exec(by);
  if (!match) return { ok: false, issues: [`${by} is not an owner answer (owner:queue.<kind>#<id>)`] };
  if (queues && !queues.includes(match[1]!)) return { ok: false, issues: [`${by} answers ${match[1]}, not ${queues.join(" or ")}`] };
  const found = findQueueEntry(root, `${match[1]}#${match[2]}`);
  if (!found.ok) return { ok: false, issues: [found.reason] };
  const read = readQueueEntry(found.at);
  if (!read.ok) return { ok: false, issues: [`${match[1]}#${match[2]}: ${read.reason}`] };
  const entry: QueueEntry = read.entry;
  const name = `${entry.queue}#${entry.id}`;
  const answered = [...events(entry)].reverse().find(event => event?.op === "answered");
  const issues: string[] = [];
  if (entry.status !== "answered" || !answered) issues.push(`${name} is ${entry.status}, not answered`);
  else if (answered.by !== "owner") issues.push(`${name} was answered by ${answered.by}, not the owner`);
  return { ok: true, entry, name, answered, issues };
}
