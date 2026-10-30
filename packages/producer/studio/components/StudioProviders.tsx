'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RouterProvider } from 'react-aria-components';
import { loadCells, type AgentCells } from '../lib/cells-client';
import { studioCellChange } from '../lib/studio-module-data';
import { studioReports, type StudioReport } from '../lib/studio-report';

export type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
export type ThemeMode = 'light' | 'dark' | 'system';

interface StudioData { cells: Resource<AgentCells[]>; revision: number; reports: Resource<StudioReport[]> }
const DataContext = createContext<StudioData>({ cells: { state: 'loading' }, revision: 0, reports: { state: 'loading' } });
const ThemeContext = createContext<{ mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (mode: ThemeMode) => void }>({ mode: 'system', resolved: 'light', setMode: () => {} });

export function useStudioData() { return useContext(DataContext); }
export function useThemeMode() { return useContext(ThemeContext); }

/** Runs before hydration so the first paint already carries the stored mode. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.dataset.theme=d?'dark':'light';r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

function storedMode(): ThemeMode {
  try { const value = localStorage.getItem('theme'); return value === 'light' || value === 'dark' ? value : 'system'; } catch { return 'system'; }
}
function applyMode(mode: ThemeMode): 'light' | 'dark' {
  const dark = mode === 'dark' || mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark ? 'dark' : 'light';
}

async function loadReports(signal: AbortSignal): Promise<StudioReport[]> {
  const response = await fetch('/api/config', { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer could not load its configuration (${response.status}).`);
  const config = await response.json() as Record<string, unknown>;
  // Only the report fields leave this function; the session token is never retained.
  return studioReports({ selection: config.selection, theme: config.theme, compilation: config.compilation });
}

export function StudioProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const [cells, setCells] = useState<Resource<AgentCells[]>>({ state: 'loading' });
  const [reports, setReports] = useState<Resource<StudioReport[]>>({ state: 'loading' });
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
    try { if (next === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch { /* Storage can be unavailable; the mode still applies. */ }
    setModeState(next);
    setResolved(applyMode(next));
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.addEventListener('change', event => {
      try { if (studioCellChange(JSON.parse((event as MessageEvent<string>).data))) setRevision(value => value + 1); }
      catch { /* A malformed event never becomes a revision. */ }
    });
    return () => events.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadCells(controller.signal).then(value => setCells({ state: 'ready', value }), error => { if (!controller.signal.aborted) setCells({ state: 'error', message: error instanceof Error ? error.message : 'Producer is unavailable.' }); });
    loadReports(controller.signal).then(value => setReports({ state: 'ready', value }), error => { if (!controller.signal.aborted) setReports({ state: 'error', message: error instanceof Error ? error.message : 'Producer is unavailable.' }); });
    return () => controller.abort();
  }, [revision]);

  const data = useMemo(() => ({ cells, revision, reports }), [cells, revision, reports]);
  const theme = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <RouterProvider navigate={href => router.push(href)}>
    <ThemeContext.Provider value={theme}><DataContext.Provider value={data}>{children}</DataContext.Provider></ThemeContext.Provider>
  </RouterProvider>;
}
