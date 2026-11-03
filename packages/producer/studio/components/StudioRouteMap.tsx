'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { ContentMap } from '@clossys/publisher/content-map';
import { studioRuntimeMap } from '../lib/studio-route-map';

interface StudioRoutes { map: ContentMap }
const RoutesContext = createContext<StudioRoutes>({ map: studioRuntimeMap });

/** The Studio map: the compiled pages, their group tabs and every leaf route the publication declares. */
export function useStudioRoutes() { return useContext(RoutesContext); }

/** The map is compiled data; the provider only hands it down. */
export function StudioRouteMapProvider({ children }: { children: ReactNode }) {
  return <RoutesContext.Provider value={{ map: studioRuntimeMap }}>{children}</RoutesContext.Provider>;
}
