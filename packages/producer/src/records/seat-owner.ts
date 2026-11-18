/**
 * No cross-edit through a verb (foundry-build-0048 U7, Q9): a seat names who acts (`agent:<seat>`). Only a registered
 * seat acts, an agent's own (`agent:<agent>` or `agent:<agent>.<role>`, the agent one of SEAT_AGENTS), and only on that
 * agent's slots. Any other head (`agent:judge`, `agent:writer-x`) is no registered seat and acts on no slot. The owner,
 * the planner and migrated records are no seat: their own pin rules (records/pin.ts) decide them.
 *
 * `assertSeat` is the one guard every writer of a slot decision calls (records/slot-write.ts pin, pick, verdict,
 * reissue and not-needed; records/pin-map.ts the clossys.slot/2 pin), so a new verb that writes through them cannot
 * skip it.
 *
 * `assertActor` is the total guard (foundry-build-0048 U7 r3): it has no pass-through. An actor is an agent seat that
 * may act on the slot, or an owner answer ref (`owner:queue.<kind>#<id>`) that resolves to an entry the owner answered
 * (queue/rules.ts resolveOwnerAnswer, the predicate release/ready.ts uses). Bare `owner`, `planner`, `migration` and
 * free text are refused unless the caller names them in `also`. The retire verb and writers and the candidate writers
 * call it; retire binds the owner answer to its slot and the option `retire` (`bind`, U7 r4).
 */
import { resolveOwnerAnswer } from "../queue/rules.js";

export const SEAT_AGENTS = ["director", "designer", "writer", "publisher", "producer"] as const;

const SEAT = /^agent:([a-z][a-z0-9-]*)(?:\.[a-z0-9.-]+)?$/;

/** A seat that may not act on the slot: the writers throw it, and the verbs report its message as their refusal. */
export class SeatRefusal extends Error {
  override readonly name = "SeatRefusal";
}

/** Why `by` may not act on a slot of `slotAgent`; undefined when it may. */
export function seatRefusal(by: string, slotAgent: string): string | undefined {
  const match = SEAT.exec(by);
  if (!match) return `--by ${by} is not agent:<agent>[.<role>]`;
  const head = match[1]!;
  if (!(SEAT_AGENTS as readonly string[]).includes(head)) return `--by ${by} is not a registered seat: a seat is agent:<${SEAT_AGENTS.join("|")}>[.<role>], acting on its own agent's slots`;
  if (head !== slotAgent) return `--by ${by} is ${head}'s seat and ${slotAgent}/<slot> is ${slotAgent}'s: an agent acts only on its own slots`;
  return undefined;
}

/**
 * The shared seat guard: throws a SeatRefusal (`<verb> refused: ...`) when `by` is an agent seat (`agent:...`) that may
 * not act on a slot of `slotAgent`. A decider that is not an agent seat passes here; its own rules judge it.
 */
export function assertSeat(by: string, slotAgent: string, verb: string): void {
  if (!by.startsWith("agent:")) return;
  const why = seatRefusal(by, slotAgent);
  if (why !== undefined) throw new SeatRefusal(`${verb} refused: ${why}`);
}

export interface ActorOptions {
  /** Non-seat actors this writer accepts as they are (the candidate writers: the owner and the planner author too). */
  readonly also?: readonly string[];
  /** The owner-answer queues accepted (default: every queue). */
  readonly queues?: readonly string[];
  /**
   * What an owner answer must be to act (foundry-build-0048 U7 r4): an entry about `subject` (`<agent>/<slot>`) whose
   * owner answer is the option `answer`, one of the entry's options. Without it any resolved owner answer acts; the
   * retire writers and verb always bind it.
   */
  readonly bind?: { readonly subject: string; readonly answer: string };
}

/** Why `by` may not act on a slot of `slotAgent` (undefined when it may): the total form of `seatRefusal`. */
export function actorRefusal(root: string, by: string, slotAgent: string, options: ActorOptions = {}): string | undefined {
  if (options.also?.includes(by)) return undefined;
  if (by.startsWith("agent:")) return seatRefusal(by, slotAgent);
  if (by.startsWith("owner:")) {
    const owner = resolveOwnerAnswer(root, by, options.queues);
    const issues = [...owner.issues];
    if (owner.ok && !issues.length && options.bind) {
      const { subject, answer } = options.bind;
      if (owner.entry.subject?.to !== subject) issues.push(`${owner.name} is about ${owner.entry.subject?.to ?? "nothing"}, not ${subject}`);
      if (owner.answered?.answer !== answer) issues.push(`${owner.name} was answered ${owner.answered?.answer ?? "with no option"}, not ${answer}`);
      else if (!(owner.entry.options ?? []).some(option => option.id === answer)) issues.push(`${owner.name} offers no option ${answer}: an answer is one of the entry's options`);
    }
    return issues.length ? `--by ${by} is not agent:<agent>[.<role>] and not a resolved owner answer: ${issues.join("; ")}` : undefined;
  }
  return `--by ${by} is not agent:<agent>[.<role>] or a resolved owner answer (owner:queue.<kind>#<id>)`;
}

/** The total actor guard: throws a SeatRefusal (`<verb> refused: ...`) unless `by` may act on a slot of `slotAgent`. */
export function assertActor(root: string, by: string, slotAgent: string, verb: string, options: ActorOptions = {}): void {
  const why = actorRefusal(root, by, slotAgent, options);
  if (why !== undefined) throw new SeatRefusal(`${verb} refused: ${why}`);
}
