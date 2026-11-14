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

/** Mounts the providers in a fresh top page whose OS prefers `prefersDark`, with `stored` in localStorage; reports what the page shows. */
async function themeShown(prefersDark: boolean, stored: string | null, toggle?: 'light' | 'dark') {
  const win = new JSDOM('<body></body>', { url: 'http://localhost/' }).window as unknown as Window;
  if (stored !== null) win.localStorage.setItem('theme', stored);
  class QuietEventSource { addEventListener() {} close() {} }
  Object.assign(win, { matchMedia: () => ({ matches: prefersDark, addEventListener() {}, removeEventListener() {} }) });
  Object.assign(globalThis, { window: win, document: win.document, localStorage: win.localStorage, EventSource: QuietEventSource, IS_REACT_ACT_ENVIRONMENT: true });
  const { StudioProviders, useThemeMode } = await import('./StudioProviders');
  let theme: ReturnType<typeof useThemeMode> | undefined;
  function Probe() { theme = useThemeMode(); return null; }
  const root = createRoot(win.document.body.appendChild(win.document.createElement('div')));
  await act(async () => { root.render(<StudioProviders seed={seed}><Probe /></StudioProviders>); });
  if (toggle) await act(async () => { theme!.setMode(toggle); });
  const shown = { mode: theme!.mode, resolved: theme!.resolved, dataTheme: win.document.documentElement.dataset.theme, dark: win.document.documentElement.classList.contains('dark'), stored: win.localStorage.getItem('theme') };
  await act(async () => { root.unmount(); });
  return shown;
}

describe('Studio theme default (foundry-audit-0009)', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).localStorage; });

  it('defaults to light, even when the operating system prefers dark', async () => {
    expect(await themeShown(true, null)).toEqual({ mode: 'light', resolved: 'light', dataTheme: 'light', dark: false, stored: null });
    expect(await themeShown(false, null)).toMatchObject({ mode: 'light', resolved: 'light' });
    // A stale 'system' choice from before is not followed either.
    expect(await themeShown(true, 'system')).toMatchObject({ mode: 'light', resolved: 'light', dataTheme: 'light' });
  });

  it('keeps the light/dark toggle: a stored or toggled dark shows dark, and toggling back shows light', async () => {
    expect(await themeShown(false, 'dark')).toEqual({ mode: 'dark', resolved: 'dark', dataTheme: 'dark', dark: true, stored: 'dark' });
    expect(await themeShown(false, null, 'dark')).toEqual({ mode: 'dark', resolved: 'dark', dataTheme: 'dark', dark: true, stored: 'dark' });
    expect(await themeShown(true, 'dark', 'light')).toEqual({ mode: 'light', resolved: 'light', dataTheme: 'light', dark: false, stored: 'light' });
  });

  it('the pre-hydration script paints light by default and dark only for a stored dark choice', async () => {
    const { THEME_INIT_SCRIPT, DEFAULT_THEME_MODE } = await import('./StudioProviders');
    expect(DEFAULT_THEME_MODE).toBe('light');
    expect(THEME_INIT_SCRIPT).not.toMatch(/prefers-color-scheme|system/);
    for (const [stored, expected] of [[null, 'light'], ['system', 'light'], ['light', 'light'], ['dark', 'dark']] as const) {
      const page = new JSDOM('<body></body>', { url: 'http://localhost/', runScripts: 'outside-only' }).window;
      Object.assign(page, { matchMedia: () => ({ matches: true }) });
      if (stored !== null) page.localStorage.setItem('theme', stored);
      page.eval(THEME_INIT_SCRIPT);
      expect(page.document.documentElement.dataset.theme, String(stored)).toBe(expected);
      expect(page.document.documentElement.classList.contains('dark')).toBe(expected === 'dark');
    }
  });
});
