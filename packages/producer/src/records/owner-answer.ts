/**
 * One owner-decision predicate (foundry-build-0048 U13 r4, B2): every verb that records an owner decision on a slot
 * (pin and approve with basis picked or bulk, not-needed, confirm, seat) names the queue entry the owner answered
 * (`--by owner:queue.<kind>#<id>`) and calls `ownerDecisionRefusal`, nothing else. The entry decides only when it is a
 * typed, owner-answered entry whose answer is bound to this decision:
 *
 * - a `clossys.queue-entry/2` work entry: an open change entry filed under the named queue, assigned to the owner (or
 *   asked of the owner by Producer), whose last event is the owner's answered option with the exact step
 *   `pin <slot> <candidate> [flags]` (`typedAnswerRefusal`);
 * - a `clossys.queue-entry/1` decision entry: it validates against its schema and every answer rule, the owner answered
 *   it (`resolveOwnerAnswer`, the predicate release/ready.ts and the retire writers use), it is about this slot, and the
 *   answered option is bound to this decision (the candidate it names, or `not-needed` / `seat`).
 *
 * A missing file, `{}`, an untyped `{id, kind}` object, non-JSON, an unanswered entry or an answer about another slot
 * or candidate is refused. It lives apart from records/seat-owner.ts because the work-entry reader (records/request.ts)
 * imports the slot writers, which import seat-owner.ts.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkKind } from "../queue/routing.js";
import { ANSWER_RULES, entrySchemaIssues, resolveOwnerAnswer } from "../queue/rules.js";
import { ownerAnswerRef } from "./pin.js";
import { answeredStep, readRequest, requestsDir, workQueue, type SlotRequest } from "./request.js";

export type OwnerDecisionKind = "pin" | "not-needed" | "confirm" | "seat";

export interface OwnerDecision {
  readonly kind: OwnerDecisionKind;
  /** The slot the decision is about, `<agent>/<slot-id>`. */
  readonly slot: string;
  /** The pinned target when it is a pin-map record, `<agent>/<slot-id>#<record>`; else the slot. */
  readonly target?: string;
  /** The candidate a pin or confirm records. */
  readonly candidate?: string;
}

/**
 * Why a `clossys.queue-entry/2` work entry's answer does not decide `pin <args>` (undefined when it does). The entry
 * reads as a work entry through readRequest (its schema and every entry rule); it is an open kind change filed under
 * the queue the ref names, assigned to the owner; and its last event is the owner's answered option whose step is
 * exactly `pin <args>`.
 */
export function typedAnswerRefusal(root: string, answer: { readonly to: string; readonly record?: string }, file: string, args: readonly string[]): string | undefined {
  let request: SlotRequest;
  try { request = readRequest(join(root, "clossys"), answer.record!); } catch (error) { return `does not read as a work entry: ${error instanceof Error ? error.message : String(error)}`; }
  const filed = `producer/${workQueue(request.kind as WorkKind)}`;
  if (filed !== answer.to || resolve(requestsDir(join(root, "clossys"), request.kind as WorkKind), `${request.id}.json`) !== resolve(file)) return `is a kind ${request.kind} entry filed under ${filed}, not ${answer.to}`;
  if (request.kind !== "change") return `is kind ${request.kind}: only an owner-assigned change entry answers a pin`;
  if (request.status !== "open") return "is closed: its answer already ran";
  // The owner's entry: assigned to the owner, or one Producer asked the owner about (an asked event before the answer).
  if (request.assignee !== "owner" && !request.events.some(event => event.op === "asked" && event.by === "producer")) return `is assigned to ${request.assignee}, not the owner, and Producer never asked the owner: only the owner's entry answers a pin`;
  const option = answeredStep(request);
  if (!option) return "has no owner answer as its last event (clossys request <id> --answer <option>)";
  const step = ["pin", ...args].join(" ");
  if (option.then.verb !== "pin" || option.then.args.length !== args.length || option.then.args.some((arg, index) => arg !== args[index])) return `was answered ${option.id} (${option.then.verb} ${option.then.args.join(" ")}), not ${step}`;
  return undefined;
}

/** The `pin` step a clossys.queue-entry/2 option runs for this decision; undefined when no work-entry option runs it. */
function typedStep(decision: OwnerDecision): readonly string[] | undefined {
  const target = decision.target ?? decision.slot;
  if (decision.kind === "pin" && decision.candidate) return [target, decision.candidate];
  if (decision.kind === "confirm" && decision.candidate) return [target, decision.candidate, "--confirm"];
  return undefined;
}

/** Why a typed `clossys.queue-entry/1` owner answer does not decide this (undefined when it does). */
function decisionEntryRefusal(root: string, by: string, decision: OwnerDecision, raw: unknown): string | undefined {
  const schema = entrySchemaIssues(raw);
  if (schema.length) return `is not a valid clossys.queue-entry/1 entry: ${schema.slice(0, 3).join("; ")}`;
  const owner = resolveOwnerAnswer(root, by);
  if (!owner.ok) return owner.issues.join("; ");
  const rules = ANSWER_RULES.flatMap(rule => rule.issues(owner.entry, root));
  const issues = [...owner.issues, ...rules];
  if (issues.length) return issues.slice(0, 3).join("; ");
  const answered = owner.answered!.answer;
  const option = (owner.entry.options ?? []).find(item => item.id === answered);
  const about = owner.entry.subject?.to;
  const slots = new Set([decision.slot, decision.target ?? decision.slot]);
  if (!about || !slots.has(about)) return `is about ${about ?? "nothing"}, not ${[...slots].join(" or ")}`;
  if (decision.kind === "pin") {
    // A pick or approval of one candidate: the answered option names this candidate.
    if (!option) return `was answered ${answered ?? "with no option"}, which is none of its options: a pin needs the option naming ${decision.candidate}`;
    if (option.candidate !== decision.candidate) return `was answered ${option.id} about ${option.candidate === undefined ? "no candidate" : `candidate ${option.candidate}`}, not ${decision.candidate}`;
    return undefined;
  }
  const want = decision.kind; // not-needed or seat: an answer about the whole slot
  if (!option || option.id !== want) return `was answered ${answered ?? "with no option"}, not ${want}`;
  if (option.candidate !== undefined) return `answered ${want} about candidate ${option.candidate}, not the whole slot`;
  return undefined;
}

/**
 * Why `by` does not record this owner decision (undefined when it does). `by` must be `owner:queue.<kind>#<id>`; the
 * message names the entry and the reason. A confirmation takes only a typed work entry (no decision-entry option
 * confirms an agent pick); a seat and a not-needed take only a decision entry (no work-entry option runs them).
 */
export function ownerDecisionRefusal(root: string, by: string, decision: OwnerDecision): string | undefined {
  const answer = ownerAnswerRef(by);
  // DRAFT copy (not owner-approved).
  if (!answer) return `--by ${by} names no queue answer (owner:queue.<kind>#<id>)`;
  const name = `${answer.to}#${answer.record}`;
  const file = join(root, "clossys", "agents", answer.to, "entries", `${answer.record}.json`);
  let bytes: string;
  try { bytes = readFileSync(file, "utf8"); } catch { return `${name} is not a queue entry`; }
  let raw: unknown;
  try { raw = JSON.parse(bytes); } catch { return `${name} does not read: it is not JSON`; }
  const schema = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as { schema?: unknown }).schema : undefined;
  if (schema === "clossys.queue-entry/2") {
    const args = typedStep(decision);
    if (!args) return `${name} is a clossys.queue-entry/2 work entry: no work-entry option runs ${decision.kind}; the owner answers it on a clossys.queue-entry/1 entry`;
    const why = typedAnswerRefusal(root, answer, file, args);
    return why === undefined ? undefined : `${name} ${why}`;
  }
  if (schema === "clossys.queue-entry/1") {
    if (decision.kind === "confirm") return `${name} is not a clossys.queue-entry/2 entry: only the owner's typed answer (clossys request <id> --answer <option>) confirms an agent pick`;
    const why = decisionEntryRefusal(root, by, decision, raw);
    return why === undefined ? undefined : `${name} ${why}`;
  }
  return `${name} is not a typed queue entry (clossys.queue-entry/1 or /2): only the owner's answered entry decides a slot`;
}
