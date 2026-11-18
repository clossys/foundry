/**
 * No cross-edit through a verb (foundry-build-0048 U7, Q9): a seat names who acts (`agent:<seat>`), and a seat of one
 * agent (`agent:<agent>` or `agent:<agent>.<role>`) never acts on another agent's slot. A seat that names no agent
 * (`agent:judge`, the judging seat a decide:judgment step uses) is not an agent's and may act on any slot.
 */
export const SEAT_AGENTS = ["director", "designer", "writer", "publisher", "producer"] as const;

/** Why `by` may not act on a slot of `slotAgent`; undefined when it may. */
export function seatRefusal(by: string, slotAgent: string): string | undefined {
  const match = /^agent:([a-z][a-z0-9-]*)(?:\.[a-z0-9.-]+)?$/.exec(by);
  if (!match) return `--by ${by} is not agent:<seat>`;
  const head = match[1]!;
  if ((SEAT_AGENTS as readonly string[]).includes(head) && head !== slotAgent) return `--by ${by} is ${head}'s seat and ${slotAgent}/<slot> is ${slotAgent}'s: an agent acts only on its own slots`;
  return undefined;
}
