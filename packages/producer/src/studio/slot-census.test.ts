import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slotCensus } from '../server/slot-census.js';
import { listSlots } from '../records/slots.js';
import { loadSlotGroups } from '../../studio/lib/studio-seed';
import { AGENTS } from '../../studio/lib/agents';
import { loadSlotCensus, useSlotCensus } from '../../studio/lib/slot-census';

const consumer = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'), 'clossys');
const signal = () => new AbortController().signal;
const ready = { state: 'ready', total: 4, withCandidate: 3, pinned: 1 };
const unavailable = { state: 'error', message: 'The slot census could not load.' };
afterEach(() => vi.unstubAllGlobals());

describe('Home census data channel', () => {
  it('starts as explicit loading without a fabricated zero', () => {
    function Probe() { return JSON.stringify(useSlotCensus(0)); }
    const html = renderToStaticMarkup(createElement(Probe));
    for (const agent of AGENTS) expect(html).toContain(`&quot;${agent}&quot;:{&quot;state&quot;:&quot;loading&quot;}`);
    expect(html).not.toContain('total');
  });

  it('loads the native census even when the gallery request fails', async () => {
    const native = slotCensus(consumer);
    const fetcher = vi.fn(async (path: string) => {
      if (path !== '/api/slots/census') throw new Error('Gallery unavailable');
      return new Response(JSON.stringify(native), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    const [gallery, census] = await Promise.allSettled([loadSlotGroups('writer', signal()), loadSlotCensus(signal())]);
    expect(gallery.status).toBe('rejected');
    expect(census.status).toBe('fulfilled');
    if (census.status !== 'fulfilled') throw new Error('Missing census');
    for (const agent of ['director', 'designer', 'writer', 'publisher'] as const) {
      const entries = listSlots(consumer, agent);
      expect(census.value[agent]).toEqual({ state: 'ready', total: entries.length,
        withCandidate: entries.filter(entry => entry.candidates.length > 0).length,
        pinned: entries.filter(entry => entry.pin !== null).length });
    }
    expect(fetcher).toHaveBeenCalledWith('/api/slots/census', expect.objectContaining({ cache: 'no-store', headers: { Accept: 'application/json' } }));
  });

  it('preserves successful agents when one result fails and sanitizes error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      director: ready, designer: { state: 'error', message: 'Untrusted filesystem details' }, writer: ready, publisher: ready,
    }))));
    const census = await loadSlotCensus(signal());
    expect(census.director).toEqual(ready);
    expect(census.designer).toEqual(unavailable);
    expect(census.writer).toEqual(ready);
    expect(census.publisher).toEqual(ready);
    expect(JSON.stringify(census)).not.toContain('Untrusted');
  });

  it.each(['network', 'http', 'json'])('reports %s failure as error, never an empty successful census', async failure => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'network') throw new Error('Untrusted connection details');
      return new Response(failure === 'json' ? '{' : '', { status: failure === 'http' ? 503 : 200 });
    }));
    const census = await loadSlotCensus(signal());
    for (const agent of AGENTS) expect(census[agent]).toEqual(unavailable);
    expect(JSON.stringify(census)).not.toContain('total');
  });

  it('rejects missing, fractional, negative or impossible counts per agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      director: { ...ready, total: -1 }, designer: { ...ready, withCandidate: 5 }, writer: { ...ready, pinned: 0.5 },
    }))));
    const census = await loadSlotCensus(signal());
    for (const agent of AGENTS) expect(census[agent]).toEqual(unavailable);
  });
});
