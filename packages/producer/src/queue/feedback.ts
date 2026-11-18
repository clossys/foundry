/**
 * `clossys feedback <ref> "<words>"` (flows.md F5 step 1, system.md 8): the owner's words about a content agent's slot
 * are a change request (foundry-build-0048 Q10: one queue, no queue-entry/1 queue.fix): one clossys.queue-entry/2 kind
 * change from the owner on the slot, `why` the words verbatim, wanting a new candidate, routed by the table
 * (records/request.ts raiseWork) to the slot's agent or, for an owner-reserved class, back to the owner as options.
 *
 * The ref must not dangle (`refs.dangling`). The entry's `input` ref carries the ref as given and the sha256 the slot
 * resolves to now (pinned or package default), so a later reader sees what the owner was looking at. An open change
 * from the owner on the same slot is returned (the same words) or refused (other words: answer that one first).
 * `--via app` (a consumer-built page ran the CLI) also records `--quote`, the owner's words as typed on the page.
 */
import { join } from "node:path";
import { danglingReason } from "../check/refs-dangling.js";
import { isContentAgent, raiseRequest, raiseWork, RequestError, workQueue, type SlotRequest } from "../records/request.js";
import { parseRefString, resolveSlot } from "../records/resolve.js";
import { slotDir, slotFile } from "../records/slot-model/layout.js";
import { modelExists, readSlotEntry } from "../records/slots.js";
import type { Ref } from "../records/types.js";
import type { Via } from "./answer.js";
import { FeedbackRefused } from "./entry.js";

export interface FeedbackInput {
  readonly ref: string;
  readonly words: string;
  readonly via: Via;
  readonly quote?: string;
  /** Where the owner said it (`createdBy.ref`); defaults to `<via>:clossys feedback <at>`. */
  readonly where?: string;
}

export { FeedbackRefused };

const isoSeconds = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, "Z");
const blank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

/**
 * SLOT-CREATE (foundry-build-0048 U5): feedback on a content-agent slot the consumer does not hold (no IA places it and
 * it has no slot folder) is a slotless need,
 * so it raises a clossys.queue-entry/2 kind slot from the owner (the owner agent answers reuse or create) instead of a
 * refusal. Every other ref goes to raiseFeedback.
 */
export function raiseFeedbackOrRequest(root: string, input: FeedbackInput, now: Date = new Date()): { request: SlotRequest; created: boolean } {
  const parsed = parseRefString(input.ref);
  if (parsed && !blank(input.words) && !parsed.candidate && isContentAgent(parsed.agent)
    && !readSlotEntry(join(root, "clossys"), parsed.agent, parsed.slotId) && !modelExists(slotFile(slotDir(join(root, "clossys"), parsed.agent, parsed.slotId)))) {
    if (input.via === "app" && blank(input.quote)) throw new FeedbackRefused("--via app records the owner's words as typed: --quote \"<words>\"");
    try {
      const at = isoSeconds(now);
      // As clossys.queue-entry/1: where the owner said it, how the words came and, when quoted, the words as typed.
      return raiseRequest(join(root, "clossys"), {
        target: `${parsed.agent}/${parsed.slotId}`, from: "owner", why: input.words, source: "feedback", by: "owner", at,
        createdBy: { actor: "owner", ref: input.where ?? `${input.via}:clossys feedback ${at}` }, via: input.via, ...(input.quote !== undefined ? { quote: input.quote } : {}),
      });
    } catch (error) {
      if (error instanceof RequestError) throw new FeedbackRefused(error.message);
      throw error;
    }
  }
  return raiseFeedback(root, input, now);
}

export function raiseFeedback(root: string, input: FeedbackInput, now: Date = new Date()): { request: SlotRequest; created: boolean } {
  if (blank(input.words)) throw new FeedbackRefused("feedback needs the owner's words");
  if (input.via === "app" && blank(input.quote)) throw new FeedbackRefused("--via app records the owner's words as typed: --quote \"<words>\"");
  if (input.quote !== undefined && blank(input.quote)) throw new FeedbackRefused("--quote is empty");
  if (input.where !== undefined && blank(input.where)) throw new FeedbackRefused("--ref is empty");
  const parsed = parseRefString(input.ref);
  if (!parsed) throw new FeedbackRefused(`${input.ref} is not a ref (<agent>/<slot-id>[/<candidate>][#<record>])`);
  if (parsed.agent === "producer" && /^(queue|ledger)\./.test(parsed.slotId)) throw new FeedbackRefused(`${input.ref}: feedback is about a slot, not a queue or ledger`);
  // DRAFT copy (not owner-approved).
  if (!isContentAgent(parsed.agent)) throw new FeedbackRefused(`${input.ref}: feedback is about a content agent's slot (director, designer, writer, publisher); ${parsed.agent}'s own slots change through its loops`);
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
  const target = `${parsed.agent}/${parsed.slotId}`;
  try {
    const raised = raiseWork(join(root, "clossys"), {
      kind: "change", target, from: "owner", want: "candidate", why: input.words, source: "feedback", by: "owner", at,
      createdBy: { actor: "owner", ref: input.where ?? `${input.via}:clossys feedback ${at}` }, via: input.via,
      ...(input.quote !== undefined ? { quote: input.quote } : {}),
      cites: [{ ...subject, ...(sha256 ? { sha256 } : {}) }],
    });
    if (!raised.created && raised.request.why !== input.words) {
      throw new FeedbackRefused(`${workQueue(raised.request.kind)}#${raised.request.id} already holds the owner's open change on ${target} ("${raised.request.why}"); answer or close it first`);
    }
    return raised;
  } catch (error) {
    if (error instanceof RequestError) throw new FeedbackRefused(error.message);
    throw error;
  }
}
