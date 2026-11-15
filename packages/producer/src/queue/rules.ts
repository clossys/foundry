/**
 * The per-entry answer rules (system.md 12.6). Each rule returns the issues of one queue entry; the file checks
 * (`src/check/answer-*.ts`) run them over every committed entry, and `clossys answer` runs the same functions on the
 * entry it is about to write, so the CLI and the checks cannot disagree.
 *
 * Check ids follow the ticket; system.md 12.6 calls two of them `answer.in-options` and `answer.owner-quoted`
 * (ANSWER_CHECK_ALIASES maps those names).
 */
import { targetSchema } from "../records/candidate.js";
import { validateAgainst } from "../records/schema.js";
import type { QueueEntry } from "../records/types.js";

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

/**
 * `answer.decider-match`: an answer comes from the decider the entry names. `owner` answers only an owner entry,
 * `agent:<id>` only an entry whose decider is that agent. One exception: `code:<cli>` may close a queue.fix or
 * queue.clarify (never a pick or an approve).
 */
export function deciderMatchIssues(entry: QueueEntry): string[] {
  const out: string[] = [];
  for (const [event, index] of answered(entry)) {
    const by = typeof event.by === "string" ? event.by : "";
    const where = `events[${index}] answered by ${JSON.stringify(by)}`;
    if (!ANSWER_BY.test(by)) { out.push(`${where}: by is not owner, agent:<id> or code:<cli>`); continue; }
    if (by.startsWith("code:")) {
      if (!CODE_CLOSABLE.includes(entry.queue)) out.push(`${where}: code may close only queue.fix or queue.clarify, not ${entry.queue}`);
      continue;
    }
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

/** `answer.quote-required`: an owner answer records the owner's own words (`quote`), whatever the channel. */
export function quoteRequiredIssues(entry: QueueEntry): string[] {
  const out: string[] = [];
  for (const [event, index] of answered(entry)) {
    if (event.by === "owner" && blank(event.quote)) out.push(`events[${index}] is an owner answer with no quote of the owner's words`);
  }
  return out;
}

export const ANSWER_RULES: readonly { readonly check: string; readonly issues: (entry: QueueEntry) => string[] }[] = [
  { check: ANSWER_OPEN_ONLY, issues: openOnlyIssues },
  { check: ANSWER_DECIDER_MATCH, issues: deciderMatchIssues },
  { check: ANSWER_OPTION_VALID, issues: optionValidIssues },
  { check: ANSWER_QUOTE_REQUIRED, issues: quoteRequiredIssues },
];
