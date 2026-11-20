/**
 * Owner queue answers for the owner.wiring and conform probes and for tests (foundry-build-0048 U13 r4, B2). It ships
 * with the package (`clossys pipeline check` writes these entries on its scratch copy), so it is runtime code, not a
 * fixture. `ownerEntry` writes a typed clossys.queue-entry/1 decision entry the owner answered (schema, every answer rule, `resolveOwnerAnswer`), about one
 * slot, whose answered option is bound to the decision: the candidate a pin names, or `not-needed` / `seat` about the
 * whole slot. It writes through the engine API (queue/entry.ts `createQueueEntry`, or `replaceQueueEntry` under the
 * entry's lock when the id is already taken), so each entry leaves its `queue.create` / `queue.replace` event.
 * Tests write any other bytes at the same path with `bareEntry` (cli/__fixtures__/owner-entry.ts), for the refusals.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createQueueEntry, queueEntryPath, replaceQueueEntry, withQueueEntryLock } from "../queue/entry.js";
import type { QueueEntry, QueueName } from "../records/types.js";

export interface OwnerEntryInput {
  /** The queue folder, `pick` (default) or `approve`. */
  readonly queue?: "pick" | "approve";
  readonly id: string;
  /** What the entry is about: `<agent>/<slot-id>` (or `<agent>/<slot-id>#<record>`). */
  readonly about: string;
  /** The answered option: a candidate file (a pin), or `not-needed` / `seat` (the whole slot). */
  readonly answer: { readonly candidate: string } | "not-needed" | "seat";
  readonly at: string;
  /** Leave it open (no answer), or have someone other than the owner answer it. */
  readonly status?: "answered" | "open";
  readonly answeredBy?: string;
}

/** The entry file `owner:queue.<kind>#<id>` names under a consumer (`<root>/clossys`). */
export function entryFile(consumer: string, queue: string, id: string): string {
  return join(consumer, "agents", "producer", `queue.${queue}`, "entries", `${id}.json`);
}

/** Write the typed, answered queue entry and return its `--by` ref. */
export function ownerEntry(consumer: string, input: OwnerEntryInput): string {
  const queue = input.queue ?? "pick";
  const chosen = typeof input.answer === "string" ? { id: input.answer, summary: input.answer } : { id: input.answer.candidate, summary: `pin ${input.answer.candidate}`, candidate: input.answer.candidate };
  const options = [chosen, { id: "keep", summary: "keep it as it is" }];
  const raised = { at: input.at, op: "raised", by: "code:clossys test" };
  const by = input.answeredBy ?? "owner";
  const answered = { at: input.at, op: "answered", by, via: "chat", answer: chosen.id, ...(by === "owner" ? { quote: `yes, ${chosen.id}` } : {}) };
  const status = input.status ?? "answered";
  const name: QueueName = `queue.${queue}`;
  const entry = {
    schema: "clossys.queue-entry/1", id: input.id, agent: "producer", kind: "queue-entry", status,
    createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: input.at, refs: [],
    queue: name, ask: `Decide ${input.about}?`, subject: { to: input.about, rel: "input" }, decider: "owner",
    options, default: null, events: status === "answered" ? [raised, answered] : [raised],
  } as unknown as QueueEntry;
  // The queue writer takes the workspace root, the folder that holds `clossys/`.
  const root = dirname(consumer);
  const file = queueEntryPath(root, name, input.id);
  if (existsSync(file)) withQueueEntryLock(root, name, input.id, () => replaceQueueEntry(file, entry));
  else createQueueEntry(root, entry);
  return `owner:queue.${queue}#${input.id}`;
}
