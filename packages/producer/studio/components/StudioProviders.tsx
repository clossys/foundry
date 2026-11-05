'use client';
import { studioCopy, errorText } from '../lib/studio-copy';


import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RouterProvider } from '@clossys/designer-ui';
import { studioCellChange } from '../lib/cell-events';
import type { StudioReport } from '../lib/studio-report';
import { loadBrand, loadReports, type Resource, type StudioBrandInfo, type StudioSeed } from '../lib/studio-seed';
import { StudioRouteMapProvider } from './StudioRouteMap';
import copyRegistry from '../generated/studio-copy.json';

export type { Resource, StudioBrandInfo } from '../lib/studio-seed';
export type ThemeMode = 'light' | 'dark' | 'system';

/** `census` is only the server-rendered slot census; Home refreshes it per revision itself. */
interface StudioData { revision: number; reports: Resource<StudioReport[]>; brand: Resource<StudioBrandInfo>; census?: StudioSeed['census'] }
const DataContext = createContext<StudioData>({ revision: 0, reports: { state: 'loading' }, brand: { state: 'loading' } });
const ThemeContext = createContext<{ mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (mode: ThemeMode) => void }>({ mode: 'system', resolved: 'light', setMode: () => {} });

export function useStudioData() { return useContext(DataContext); }
export function useThemeMode() { return useContext(ThemeContext); }

/** Runs before hydration so the first paint already carries the stored mode. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.dataset.theme=d?'dark':'light';r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

/**
 * The publication's one document element: `<html>` in the Writer registry's locale around a head
 * and a body. The installed root layout (through the assembly's `PublishedDocument`) and the
 * installed `global-error` state (which replaces the root layout) both render it, so the document
 * is written once and no state draws its own.
 */
export function StudioDocument({ head, children }: { head?: ReactNode; children: ReactNode }) {
  return <html lang={copyRegistry.locale} suppressHydrationWarning>
    <head>{head}</head>
    <body>{children}</body>
  </html>;
}

function storedMode(): ThemeMode {
  // No stored choice means the system mode; storage the browser denies is reported, then treated as no choice.
  let value: string | null = null;
  try { value = localStorage.getItem('theme'); } catch (error) { console.warn('Theme preference storage is unavailable', error); }
  return value === 'light' || value === 'dark' ? value : 'system';
}
function applyMode(mode: ThemeMode): 'light' | 'dark' {
  const dark = mode === 'dark' || mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark ? 'dark' : 'light';
}

/** `seed` is what the server render already loaded: the first paint shows it and the first revision does not refetch it. */
export function StudioProviders({ children, seed }: { children: ReactNode; seed?: StudioSeed }) {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const [reports, setReports] = useState<Resource<StudioReport[]>>(() => seed?.reports ?? { state: 'loading' });
  const [brand, setBrand] = useState<Resource<StudioBrandInfo>>(() => seed ? { state: 'ready', value: seed.brand } : { state: 'loading' });
  const seeded = useRef(seed ? 0 : undefined);
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const initial = storedMode();
    setModeState(initial);
    setResolved(applyMode(initial));
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => { if (storedMode() === 'system') setResolved(applyMode('system')); };
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);
  const setMode = useCallback((next: ThemeMode) => {
    // The mode still applies when the browser denies storage; the failure to remember it is reported.
    try { if (next === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch (error) { console.warn('Theme preference was not saved', error); }
    setModeState(next);
    setResolved(applyMode(next));
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.addEventListener('change', event => {
      try { if (studioCellChange(JSON.parse((event as MessageEvent<string>).data))) setRevision(value => value + 1); }
      catch (error) { console.error('Malformed Studio change event', error); }
    });
    return () => events.close();
  }, []);
  useEffect(() => {
    if (seeded.current === revision) return;
    seeded.current = undefined;
    const controller = new AbortController();
    loadReports(controller.signal).then(value => setReports({ state: 'ready', value }), error => { if (!controller.signal.aborted) setReports({ state: 'error', message: errorText(error, studioCopy("studio.producer-is-unavailable")) }); });
    loadBrand(controller.signal).then(value => setBrand({ state: 'ready', value }), () => { if (!controller.signal.aborted) setBrand({ state: 'ready', value: {} }); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (brand.state !== 'ready') return;
    document.title = brand.value.name ? studioCopy("studio.branded-title", { value0: String(brand.value.name) }) : studioCopy("studio.studio");
  }, [brand]);

  const census = seed?.census;
  const data = useMemo(() => ({ revision, reports, brand, ...(census ? { census } : {}) }), [revision, reports, brand, census]);
  const theme = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <RouterProvider navigate={href => router.push(href)}>
    <ThemeContext.Provider value={theme}><DataContext.Provider value={data}><StudioRouteMapProvider>{children}</StudioRouteMapProvider></DataContext.Provider></ThemeContext.Provider>
  </RouterProvider>;
}
