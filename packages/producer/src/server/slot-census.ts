import { listSlots, readIa } from '../records/slots.js';
import { SLOT_AGENTS, type SlotAgent } from '../records/slot-model/index.js';

export type SlotCensus =
  | { state: 'ready'; total: number; withCandidate: number; pinned: number }
  | { state: 'error'; message: string };

/** Inventory only: candidate versions, rendering and input readiness do not change these counts. */
export function agentSlotCensus(consumer: string, agent: SlotAgent): SlotCensus {
  try {
    if (!readIa(consumer, agent)) throw new Error('No slot IA');
    const entries = listSlots(consumer, agent);
    return {
      state: 'ready', total: entries.length,
      withCandidate: entries.filter(entry => entry.candidates.length > 0).length,
      pinned: entries.filter(entry => entry.pin !== null).length,
    };
  } catch {
    // Filesystem/validation exceptions can contain private paths or candidate content.
    return { state: 'error', message: 'The slot census could not load.' };
  }
}

/** A failed agent never discards another agent's successful inventory. */
export function slotCensus(consumer: string): Record<SlotAgent, SlotCensus> {
  return Object.fromEntries(SLOT_AGENTS.map(agent => [agent, agentSlotCensus(consumer, agent)])) as Record<SlotAgent, SlotCensus>;
}
