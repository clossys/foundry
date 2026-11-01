'use client';
import { studioCopy } from '../lib/studio-copy';


import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ContentMap } from '@clossys/publisher/content-map';
import { isLibraryAgent, loadAgentGallery, type AgentGalleryRecords } from '../lib/agent-library';
import { loadDesignerGallery, type DesignerGallery } from '../lib/designer-library';
import { studioLeafPages, studioRuntimeMap, type StudioLeafIndex, type StudioLeafRow } from '../lib/studio-route-map';
import type { Resource } from './StudioProviders';

/** One gallery page's record store, as its agent's library endpoint returns it. */
export type StudioGallery = { agent: 'designer'; records: DesignerGallery } | { agent: 'director' | 'writer' | 'publisher'; records: AgentGalleryRecords };

interface StudioRoutes { map: ContentMap; leaves: StudioLeafIndex; galleries: Readonly<Record<string, Resource<StudioGallery> | undefined>> }
const RoutesContext = createContext<StudioRoutes>({ map: studioRuntimeMap({}), leaves: {}, galleries: {} });

/** The runtime Studio map: the compiled pages plus every leaf the agents' record stores hold. */
export function useStudioRoutes() { return useContext(RoutesContext); }

function leafRows(gallery: StudioGallery): StudioLeafRow[] {
  const sections: readonly { cards: readonly { slug: string; name: string }[] }[] = gallery.records.sections;
  return sections.flatMap(section => section.cards.map(card => ({ slug: card.slug, title: card.name })));
}

async function loadGallery(agent: string, signal: AbortSignal): Promise<StudioGallery> {
  if (agent === 'designer') return { agent, records: await loadDesignerGallery(signal) };
  if (isLibraryAgent(agent)) return { agent, records: await loadAgentGallery(agent, signal) };
  throw new Error(studioCopy("studio.studio-has-no-library-for", { value0: String(agent) }));
}

/** Loads each gallery page's records once per Producer revision and extends the map with their leaves. */
export function StudioRouteMapProvider({ revision, children }: { revision: number; children: ReactNode }) {
  const [galleries, setGalleries] = useState<Record<string, Resource<StudioGallery> | undefined>>({});
  useEffect(() => {
    const controller = new AbortController();
    for (const page of studioLeafPages) {
      const agent = page.leaf!.data.agent ?? page.id;
      loadGallery(agent, controller.signal).then(value => setGalleries(current => ({ ...current, [page.id]: { state: 'ready', value } })), error => {
        if (!controller.signal.aborted) setGalleries(current => ({ ...current, [page.id]: { state: 'error', message: error instanceof Error ? error.message : studioCopy("studio.the-library-could-not-load") } }));
      });
    }
    return () => controller.abort();
  }, [revision]);
  const value = useMemo(() => {
    // A gallery that failed to load holds no leaves; its own page reports the error.
    const leaves: Record<string, readonly StudioLeafRow[] | undefined> = {};
    for (const [id, gallery] of Object.entries(galleries)) leaves[id] = gallery?.state === 'ready' ? leafRows(gallery.value) : gallery?.state === 'error' ? [] : undefined;
    return { map: studioRuntimeMap(leaves), leaves, galleries };
  }, [galleries]);
  return <RoutesContext.Provider value={value}>{children}</RoutesContext.Provider>;
}
