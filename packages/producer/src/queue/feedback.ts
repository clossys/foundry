/**
 * `clossys feedback <ref> "<words>"` (flows.md F5 step 1, system.md 8): opens one queue.fix entry with the owner's
 * words verbatim as its `ask`, decided by the agent that owns the ref (`agent:<agent>`), with no default.
 *
 * The ref must not dangle (`refs.dangling`). Its `input` ref carries the sha256 the slot resolves to now (pinned or
 * package default), so a later reader sees what the owner was looking at. The entry is created exclusively: an
 * existing entry is never overwritten (a colliding id takes the next free suffix).
 * `--via app` (a consumer-built page ran the CLI) also records `--quote`, the owner's words as typed on the page.
 */
import { danglingReason } from "../check/refs-dangling.js";
import { parseRefString, resolveSlot } from "../records/resolve.js";
import type { QueueEntry, Ref } from "../records/types.js";
import type { Via } from "./answer.js";
import { createQueueEntry, entryStamp, slugOf } from "./entry.js";
import { ANSWER_RULES, entrySchemaIssues } from "./rules.js";

export interface FeedbackInput {
  readonly ref: string;
  readonly words: string;
  readonly via: Via;
  readonly quote?: string;
  /** The entry id's slug; defaults to the record, else the slot id. */
  readonly slug?: string;
  /** Where the owner said it (`createdBy.ref`); defaults to `<via>:clossys feedback <at>`. */
  readonly where?: string;
}

export class FeedbackRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackRefused";
  }
}

const isoSeconds = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, "Z");
const blank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

export function raiseFeedback(root: string, input: FeedbackInput, now: Date = new Date()): QueueEntry {
  if (blank(input.words)) throw new FeedbackRefused("feedback needs the owner's words");
  if (input.via === "app" && blank(input.quote)) throw new FeedbackRefused("--via app records the owner's words as typed: --quote \"<words>\"");
  if (input.quote !== undefined && blank(input.quote)) throw new FeedbackRefused("--quote is empty");
  if (input.where !== undefined && blank(input.where)) throw new FeedbackRefused("--ref is empty");
  if (input.slug !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(input.slug)) throw new FeedbackRefused(`--slug ${input.slug} is not [a-z0-9][a-z0-9-]*`);
  const parsed = parseRefString(input.ref);
  if (!parsed) throw new FeedbackRefused(`${input.ref} is not a ref (<agent>/<slot-id>[/<candidate>][#<record>])`);
  if (parsed.agent === "producer" && /^(queue|ledger)\./.test(parsed.slotId)) throw new FeedbackRefused(`${input.ref}: feedback is about a slot, not a queue or ledger`);
  const to = `${parsed.agent}/${parsed.slotId}${parsed.candidate ? `/${parsed.packageDefault ? "package:" : ""}${parsed.candidate}` : ""}` as Ref["to"];
  const subject: Ref = {
    to, ...(parsed.key !== undefined ? { key: parsed.key } : {}), ...(parsed.record !== undefined ? { record: parsed.record } : {}), rel: "input",
  };
  const dangling = danglingReason(root, subject);
  if (dangling) throw new FeedbackRefused(`${input.ref}: ${dangling}`);
  let sha256: string | undefined;
  if (!parsed.candidate) {
    const resolution = resolveSlot(root, parsed.agent, parsed.slotId, parsed.record);
    if (resolution.state === "pinned" || resolution.state === "sample") sha256 = resolution.sha256;
  }

  const at = isoSeconds(now);
  const entry: QueueEntry = {
    schema: "clossys.queue-entry/1",
    id: `${entryStamp(at)}-${input.slug ?? slugOf(parsed.record ?? parsed.slotId)}`,
    agent: "producer",
    kind: "queue-entry",
    status: "open",
    createdBy: { actor: "owner", ref: input.where ?? `${input.via}:clossys feedback ${at}` },
    createdAt: at,
    refs: [{ ...subject, ...(sha256 ? { sha256 } : {}) }],
    queue: "queue.fix",
    ask: input.words,
    subject,
    decider: `agent:${parsed.agent}`,
    default: null,
    events: [{ at, op: "raised", by: "owner", via: input.via, ...(input.quote !== undefined ? { quote: input.quote } : {}) }],
  };
  const issues = [...entrySchemaIssues(entry), ...ANSWER_RULES.flatMap(rule => rule.issues(entry))];
  if (issues.length) throw new FeedbackRefused(`the entry would not be valid: ${issues.join("; ")}`);
  return createQueueEntry(root, entry);
}
