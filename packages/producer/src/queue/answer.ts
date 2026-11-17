/**
 * `clossys answer` (system.md 12.6 steps 1-5): closes one open queue entry by appending one `answered` event.
 *
 * 1. Loads the entry; it must be `open` (`answer.open-only`).
 * 2. `--by` must be the entry's decider (`answer.decider-match`). `code:<cli>` may close only a queue.fix or
 *    queue.clarify that an agent decides (never an owner entry), with `via: cli` and an `answers` ref to the pin or
 *    the answered queue.approve that finished it; that pin, or that approval's subject, is the entry's own subject.
 * 3. The answer is one of `options[].id` or the `default`; clarify (and a fix with no options) takes free text
 *    (`answer.option-valid`).
 * 4. An owner answer records the owner's words verbatim in `quote`, whatever the channel (`answer.quote-required`);
 *    only an owner answer takes a quote, and an owner answer names its channel (`--via cli|chat|app`).
 * 5. Writes under the entry's lock: re-reads, runs the record schema, every answer rule and the append-only
 *    comparison on the new bytes, then the `ledger.append-only` history check (check/ledger-append-only.ts) for
 *    this entry: an entry whose file was already edited against its git history, or a shallow clone whose history
 *    cannot be read, takes no answer. Only then are the bytes renamed into place. Nothing is written when any of
 *    them fails. A workspace with no git repository has no committed version to compare against; there the
 *    comparison above is the whole check (and `clossys check --strict` fails the workspace for it).
 * The follow-up (step 6: pin, confirm, resume) is not run here; for a queue.pick the result names the pin command.
 *
 * There is no flag to skip a rule and no flag to set the event time.
 */
import { checkLedgerAppendOnly, LEDGER_APPEND_ONLY, NOT_A_REPOSITORY } from "../check/ledger-append-only.js";
import { danglingReason } from "../check/refs-dangling.js";
import { parseRefString } from "../records/resolve.js";
import type { QueueEntry, Ref } from "../records/types.js";
import { queueEntryChangeIssues } from "./append-only.js";
import { findQueueEntry, readQueueEntry, replaceQueueEntry, withQueueEntryLock } from "./entry.js";
import { ANSWER_BY, ANSWER_DECIDER_MATCH, ANSWER_OPEN_ONLY, ANSWER_OPTION_VALID, ANSWER_QUOTE_REQUIRED, ANSWER_RULES, CODE_CLOSABLE, entrySchemaIssues } from "./rules.js";

export type Via = "cli" | "chat" | "app";
export const VIAS: readonly Via[] = ["cli", "chat", "app"];

export interface AnswerInput {
  /** `<id>`, `queue.<kind>#<id>` or `producer/queue.<kind>#<id>`. */
  readonly entry: string;
  readonly answer: string;
  readonly by: string;
  readonly via?: Via;
  readonly quote?: string;
  readonly note?: string;
  /** For `code:<cli>` only: the pin (`<agent>/<slot>[/<candidate>][#<record>]`) or `producer/queue.approve#<id>` that finished the work. */
  readonly answers?: string;
}

export class AnswerRefused extends Error {
  constructor(readonly check: string, message: string) {
    super(message);
    this.name = "AnswerRefused";
  }
}

export interface AnswerResult {
  readonly queue: QueueEntry["queue"];
  readonly id: string;
  readonly file: string;
  readonly event: QueueEntry["events"][number];
  readonly entry: QueueEntry;
  /** The follow-up command for an owner queue.pick, when the chosen option names a candidate. */
  readonly next?: string;
}

const refLabel = (ref: Ref): string => `${ref.to}${ref.record ? `#${ref.record}` : ""}`;
const isoSeconds = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, "Z");
const blank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

/** The `answers` ref of a code close: an answered queue.approve entry, or a slot, record or candidate that exists. */
function answersRef(root: string, value: string): Ref {
  const queue = /^producer\/(queue\.[a-z]+)#(.+)$/.exec(value);
  if (queue) {
    if (queue[1] !== "queue.approve") throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--answers ${value}: a code close answers a pin or a queue.approve entry`);
    const found = findQueueEntry(root, value);
    if (!found.ok) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--answers ${value}: ${found.reason}`);
    const read = readQueueEntry(found.at);
    if (!read.ok) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--answers ${value}: ${read.reason}`);
    if (read.entry.status !== "answered") throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--answers ${value}: that entry is ${read.entry.status}, not answered`);
    return { to: "producer/queue.approve", record: found.at.id, rel: "answers" };
  }
  const parsed = parseRefString(value);
  if (!parsed || parsed.key !== undefined || (parsed.agent === "producer" && /^(queue|ledger)\./.test(parsed.slotId))) {
    throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--answers ${value} is not a pin ref (<agent>/<slot-id>[/<candidate>][#<record>]) or producer/queue.approve#<id>`);
  }
  const to = `${parsed.agent}/${parsed.slotId}${parsed.candidate ? `/${parsed.packageDefault ? "package:" : ""}${parsed.candidate}` : ""}` as Ref["to"];
  const ref: Ref = { to, ...(parsed.record !== undefined ? { record: parsed.record } : {}), rel: "answers" };
  const dangling = danglingReason(root, ref);
  if (dangling) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--answers ${value}: ${dangling}`);
  return ref;
}

/** The `ledger.append-only` history findings that bar appending to this entry: its own, and an unreadable (shallow) history. */
function historyIssues(root: string, queue: string, id: string): string[] {
  const subject = `producer/${queue}#${id}`;
  return checkLedgerAppendOnly(root).findings
    .filter(finding => finding.subject === subject || (finding.subject === root && finding.detail !== NOT_A_REPOSITORY))
    .map(finding => finding.detail);
}

export function answerQueueEntry(root: string, input: AnswerInput, now: Date = new Date()): AnswerResult {
  const { by } = input;
  if (!ANSWER_BY.test(by)) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--by ${by} is not owner, agent:<agent> or code:<cli>`);
  const owner = by === "owner", code = by.startsWith("code:");
  if (owner && input.via === undefined) throw new AnswerRefused(ANSWER_QUOTE_REQUIRED, "an owner answer names its channel: --via cli|chat|app");
  if (!owner && input.via !== undefined && input.via !== "cli") throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--by ${by} answers through the CLI only (--via cli), not ${input.via}`);
  if (owner && blank(input.quote)) throw new AnswerRefused(ANSWER_QUOTE_REQUIRED, "an owner answer records the owner's words: --quote \"<the owner's words, verbatim>\"");
  if (!owner && input.quote !== undefined) throw new AnswerRefused(ANSWER_QUOTE_REQUIRED, `--quote is the owner's own words; --by ${by} takes no quote`);
  if (!code && input.answers !== undefined) throw new AnswerRefused(ANSWER_DECIDER_MATCH, "--answers is for a code close (--by code:<cli>) only");
  if (code && input.answers === undefined) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--by ${by} closes a fix or clarify only with --answers <pin ref | producer/queue.approve#<id>>`);
  if (blank(input.answer)) throw new AnswerRefused(ANSWER_OPTION_VALID, "the answer is empty");
  if (input.note !== undefined && blank(input.note)) throw new AnswerRefused(ANSWER_OPTION_VALID, "--note is empty");

  const found = findQueueEntry(root, input.entry);
  if (!found.ok) throw new AnswerRefused(ANSWER_OPEN_ONLY, found.reason);
  const { queue, id, file } = found.at;

  return withQueueEntryLock(root, queue, id, () => {
    const read = readQueueEntry(found.at);
    if (!read.ok) throw new AnswerRefused(ANSWER_OPEN_ONLY, `${queue}#${id}: ${read.reason}`);
    const entry = read.entry;
    const broken = entrySchemaIssues(entry);
    if (broken.length) throw new AnswerRefused(ANSWER_OPEN_ONLY, `${queue}#${id} is not a valid queue entry: ${broken.join("; ")}`);
    if (entry.status !== "open") throw new AnswerRefused(ANSWER_OPEN_ONLY, `${queue}#${id} is ${entry.status}; only an open entry takes an answer`);
    if (code && !CODE_CLOSABLE.includes(queue)) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--by ${by}: code may close only queue.fix or queue.clarify, not ${queue}`);
    if (!code && by !== entry.decider) throw new AnswerRefused(ANSWER_DECIDER_MATCH, `--by ${by}: ${queue}#${id} is decided by ${entry.decider}`);
    const extra = code ? answersRef(root, input.answers!) : undefined;

    const event: QueueEntry["events"][number] = {
      at: isoSeconds(now), op: "answered", by, via: input.via ?? "cli", answer: input.answer,
      ...(owner ? { quote: input.quote! } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    const next: QueueEntry = { ...entry, status: "answered", refs: extra ? [...entry.refs, extra] : entry.refs, events: [...entry.events, event] };

    const schema = entrySchemaIssues(next);
    if (schema.length) throw new AnswerRefused(ANSWER_OPEN_ONLY, `the answered entry would not be valid: ${schema.join("; ")}`);
    for (const rule of ANSWER_RULES) {
      const issues = rule.issues(next, root);
      if (issues.length) throw new AnswerRefused(rule.check, `${queue}#${id}: ${issues.join("; ")}`);
    }
    const rewritten = queueEntryChangeIssues(entry, next);
    if (rewritten.length) throw new AnswerRefused(LEDGER_APPEND_ONLY, `${queue}#${id}: ${rewritten.join("; ")}`);
    const history = historyIssues(root, queue, id);
    if (history.length) throw new AnswerRefused(LEDGER_APPEND_ONLY, `${queue}#${id}: ${history.join("; ")}`);

    replaceQueueEntry(file, next);
    const option = (next.options ?? []).find(candidate => candidate.id === input.answer);
    const pinNext = owner && queue === "queue.pick" && option?.candidate
      ? `clossys pin ${refLabel(next.subject)} ${option.candidate} --by owner:${queue}#${id}` : undefined;
    return { queue, id, file, event, entry: next, ...(pinNext ? { next: pinNext } : {}) };
  });
}
