/** The slot census as Producer's native endpoint reports it; server-safe (no hooks), so a server render can seed it. */
import { producerUrl } from './producer-url';
import { studioCopy } from './studio-copy';
import { studioAgents } from '../generated/studio-map';

/** Matches Home's census input; this resource has no gallery or route-map dependency. */
export type HomeSlotCensus =
  | { state: 'ready'; total: number; withCandidate: number; pinned: number }
  | { state: 'loading' }
  | { state: 'error'; message: string };
/** Census per top-level map group (the agents the publication lists). */
export type SlotCensusByAgent = Readonly<Record<string, HomeSlotCensus>>;
const AGENTS = studioAgents.map(agent => agent.id);
const unavailable = (): HomeSlotCensus => ({ state: 'error', message: studioCopy("studio.the-slot-census-could-not-load") });
export const censusStates = (value: () => HomeSlotCensus): SlotCensusByAgent => Object.fromEntries(AGENTS.map(agent => [agent, value()])) as SlotCensusByAgent;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function agentCensus(value: unknown): HomeSlotCensus {
  if (!object(value) || value.state !== 'ready' || !count(value.total) || !count(value.withCandidate) || !count(value.pinned)
    || value.withCandidate > value.total || value.pinned > value.total) return unavailable();
  return { state: 'ready', total: value.total, withCandidate: value.withCandidate, pinned: value.pinned };
}

export async function loadSlotCensus(signal: AbortSignal): Promise<SlotCensusByAgent> {
  try {
    const response = await fetch(producerUrl('/api/slots/census'), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return censusStates(unavailable);
    const value: unknown = await response.json();
    return Object.fromEntries(AGENTS.map(agent => [agent, agentCensus(object(value) ? value[agent] : undefined)])) as SlotCensusByAgent;
  } catch { return censusStates(unavailable); }
}

