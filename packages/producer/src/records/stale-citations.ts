/**
 * The one stale-citation rule: a pinned slot (not the Director's) whose slot.json input was pinned after it,
 * and whose `pin.recited` does not vouch for that input's pinned version. `clossys run` recites the
 * citers whose meaning is unchanged first (recite.direct, recite.design: `migrate recite --cascade`), so
 * what stays stale is a real meaning change. It opens `<agent>.candidates` for the slot until the agent
 * drafts a candidate newer than its pin (`drafted`), then the slot's pick (chain openItems); `clossys gaps`
 * reports it as `citation.stale` (interview.ts).
 */
import { candidateVersion } from "./pinned.js";
import { SLOT_AGENTS, type SlotAgent } from "./slot-model/types.js";
import { listSlots, readSlot, slotIndex } from "./slots.js";

export interface StaleCitation {
  readonly agent: SlotAgent;
  readonly slot: string;
  /** `<agent>/<slot>` of each input pinned since. */
  readonly inputs: readonly string[];
  /** The pin's `at`. */
  readonly pinnedAt: string;
  /** A candidate newer than the pinned one exists: the slot waits on its pick, not its candidates. */
  readonly drafted: boolean;
}

/** Every stale citation in the consumer (`consumer` is the `clossys/` folder), in agent then IA order. */
export function staleCitations(consumer: string): StaleCitation[] {
  const index = slotIndex(consumer);
  const stale: StaleCitation[] = [];
  for (const agent of SLOT_AGENTS) {
    if (agent === "director") continue;
    for (const entry of listSlots(consumer, agent)) {
      if (!entry.pin) continue;
      const inputs: string[] = [];
      for (const input of readSlot(consumer, agent, entry.id).inputs) {
        const upstream = index.get(input);
        // A pointer-only recite (pin.recited) vouches for the upstream version it names, whenever that was pinned.
        const recited = entry.pin.recited?.cites[`${upstream?.agent}:${input}`];
        if (upstream?.pin && upstream.pin.at > entry.pin.at && recited !== candidateVersion(upstream.pin.candidate)) inputs.push(`${upstream.agent}/${input}`);
      }
      if (!inputs.length) continue;
      const pinned = candidateVersion(entry.pin.candidate);
      stale.push({ agent, slot: entry.id, inputs, pinnedAt: entry.pin.at, drafted: entry.candidates.some(name => candidateVersion(name) > pinned) });
    }
  }
  return stale;
}
