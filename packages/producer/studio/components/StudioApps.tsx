'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadApps, type StudioApps } from '../lib/apps-client';

type AppsResource = { state: 'loading' } | StudioApps;
const AppsContext = createContext<AppsResource>({ state: 'loading' });
export function useStudioApps() { return useContext(AppsContext); }

/** One live consumer publication snapshot feeds both navigation and the Apps workspace. */
export function StudioAppsProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<AppsResource>({ state: 'loading' });
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void loadApps(controller.signal).then(result => { if (!controller.signal.aborted) setValue(result); }, error => {
        if (!controller.signal.aborted) setValue({ state: 'error', publications: [], message: error instanceof Error ? error.message : 'Producer could not load app publications.' });
      });
    };
    refresh();
    const events = new EventSource('/api/events');
    events.addEventListener('change', refresh);
    return () => { request?.abort(); events.close(); };
  }, []);
  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}
