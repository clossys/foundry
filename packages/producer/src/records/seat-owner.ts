/**
 * No cross-edit through a verb (foundry-build-0048 U7, Q9): a seat names who acts (`agent:<seat>`). Only a registered
 * seat acts, an agent's own (`agent:<agent>` or `agent:<agent>.<role>`, the agent one of SEAT_AGENTS), and only on that
 * agent's slots. Any other head (`agent:judge`, `agent:writer-x`) is no registered seat and acts on no slot. The owner,
 * the planner and migrated records are no seat: their own pin rules (records/pin.ts) decide them.
 *
 * `assertSeat` is the one guard every writer of a slot decision calls (records/slot-write.ts pin, pick, verdict,
 * reissue and not-needed; records/pin-map.ts the clossys.slot/2 pin), so a new verb that writes through them cannot
 * skip it.
 */
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
