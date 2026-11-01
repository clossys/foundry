import { studioCopy } from './studio-copy';
import { useEffect, useState } from 'react';
import { AGENTS, type Agent } from './agents';

/** Matches Home's census input; this resource has no gallery or route-map dependency. */
export type HomeSlotCensus =
  | { state: 'ready'; total: number; withCandidate: number; pinned: number }
  | { state: 'loading' }
  | { state: 'error'; message: string };
export type SlotCensusByAgent = Record<Agent, HomeSlotCensus>;
const unavailable = (): HomeSlotCensus => ({ state: 'error', message: studioCopy("studio.the-slot-census-could-not-load") });
const states = (value: () => HomeSlotCensus): SlotCensusByAgent => Object.fromEntries(AGENTS.map(agent => [agent, value()])) as SlotCensusByAgent;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function agentCensus(value: unknown): HomeSlotCensus {
  if (!object(value) || value.state !== 'ready' || !count(value.total) || !count(value.withCandidate) || !count(value.pinned)
    || value.withCandidate > value.total || value.pinned > value.total) return unavailable();
  return { state: 'ready', total: value.total, withCandidate: value.withCandidate, pinned: value.pinned };
}

export async function loadSlotCensus(signal: AbortSignal): Promise<SlotCensusByAgent> {
  try {
    const response = await fetch('/api/slots/census', { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return states(unavailable);
    const value: unknown = await response.json();
    return Object.fromEntries(AGENTS.map(agent => [agent, agentCensus(object(value) ? value[agent] : undefined)])) as SlotCensusByAgent;
  } catch { return states(unavailable); }
}

/** Refresh on the native Producer revision channel, without waiting for a gallery request. */
export function useSlotCensus(revision: number): SlotCensusByAgent {
  const [census, setCensus] = useState<SlotCensusByAgent>(() => states(() => ({ state: 'loading' })));
  useEffect(() => {
    const controller = new AbortController();
    setCensus(states(() => ({ state: 'loading' })));
    loadSlotCensus(controller.signal).then(value => { if (!controller.signal.aborted) setCensus(value); });
    return () => controller.abort();
  }, [revision]);
  return census;
}
