'use client';
import { studioCopy } from '../lib/studio-copy';


import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContentMap } from '@clossys/publisher/content-map';
import { loadGallery, type StudioGallery } from '../lib/studio-seed';
import { studioLeafPages, studioRuntimeMap, type StudioLeafIndex, type StudioLeafRow } from '../lib/studio-route-map';
import type { Resource } from './StudioProviders';

export type { StudioGallery } from '../lib/studio-seed';

interface StudioRoutes { map: ContentMap; leaves: StudioLeafIndex; galleries: Readonly<Record<string, Resource<StudioGallery> | undefined>> }
const RoutesContext = createContext<StudioRoutes>({ map: studioRuntimeMap({}), leaves: {}, galleries: {} });

/** The runtime Studio map: the compiled pages plus every leaf the agents' record stores hold. */
export function useStudioRoutes() { return useContext(RoutesContext); }

function leafRows(gallery: StudioGallery): StudioLeafRow[] {
  const sections: readonly { cards: readonly { slug: string; name: string }[] }[] = gallery.records.sections;
  return sections.flatMap(section => section.cards.map(card => ({ slug: card.slug, title: card.name })));
}

/** Loads each gallery page's records once per Producer revision and extends the map with their leaves. */
export function StudioRouteMapProvider({ revision, initial, children }: { revision: number; initial?: Readonly<Record<string, Resource<StudioGallery>>>; children: ReactNode }) {
  const [galleries, setGalleries] = useState<Record<string, Resource<StudioGallery> | undefined>>(() => ({ ...initial }));
  // Server-rendered galleries are current for the first revision.
  const seeded = useRef(initial ? revision : undefined);
  useEffect(() => {
    if (seeded.current === revision) return;
    seeded.current = undefined;
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
