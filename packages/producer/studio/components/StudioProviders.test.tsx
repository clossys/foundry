import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioSeed } from '../lib/studio-seed';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

const seed = { reports: { state: 'ready', value: [] }, brand: {}, census: {} } as unknown as StudioSeed;
const globals = ['window', 'document', 'EventSource', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const saved = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
afterEach(() => {
  for (const name of globals) {
    const descriptor = saved[name];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
  }
});

/** Mounts the Studio providers in `win` (a top page or a frame inside one) and counts event streams opened. */
async function streamsOpened(win: Window): Promise<number> {
  let opened = 0;
  class CountingEventSource { constructor() { opened += 1; } addEventListener() {} close() {} }
  Object.assign(win, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.assign(globalThis, { window: win, document: win.document, EventSource: CountingEventSource, IS_REACT_ACT_ENVIRONMENT: true });
  const { StudioProviders } = await import('./StudioProviders');
  const root = createRoot(win.document.body.appendChild(win.document.createElement('div')));
  await act(async () => { root.render(<StudioProviders seed={seed}><p>page</p></StudioProviders>); });
  await act(async () => { root.unmount(); });
  return opened;
}

describe('Studio live change stream (R2F-03b)', () => {
  it('opens the change stream on the top page', async () => {
    expect(await streamsOpened(new JSDOM('<body></body>', { url: 'http://localhost/' }).window as unknown as Window)).toBe(1);
  });

  it('opens no stream in a framed Studio page, so a gallery of page previews cannot use up the connections per host', async () => {
    const top = new JSDOM('<body><iframe></iframe></body>', { url: 'http://localhost/' }).window;
    const frame = top.document.querySelector('iframe')!.contentWindow as unknown as Window;
    expect(frame.top).not.toBe(frame.self);
    expect(await streamsOpened(frame)).toBe(0);
  });
});
