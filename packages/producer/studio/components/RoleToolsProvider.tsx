'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AgentCells } from '../lib/cells-client';
import { useSpecimenCells, type SpecimenResource } from '../lib/director-specimen-resource';
import { loadPublication, PUBLISHER_DEVICES, selectedPublicationId, selectedPublishedPage, type PublicationPage, type PublicationResponse, type PublisherDevice } from '../lib/publisher-preview';
import { writerRoleView, writerRoleVoice, type RoleDirection } from '../lib/role-tool-data';

export type RolePublicationResource = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: PublicationResponse };
export interface PublisherRoleTools {
  resource: RolePublicationResource; page?: PublicationPage; device: PublisherDevice;
  viewport: typeof PUBLISHER_DEVICES[PublisherDevice]; selectDevice: (device: string) => void;
  selectRoute: (id: string) => void;
}
export interface WriterRoleTools extends ReturnType<typeof writerRoleView> {
  resource: SpecimenResource; cell?: import('../lib/cells-client').CellDetail;
  selectLocale: (locale: string) => void; selectDirection: (direction: RoleDirection) => void;
}
interface RoleToolsValue {
  publisher?: PublisherRoleTools; writer?: WriterRoleTools;
  payloads: Record<string, Record<string, unknown> | undefined>;
}
const RoleToolsContext = createContext<RoleToolsValue | undefined>(undefined);

function PublisherTools({ index, selectedId, children }: { index: AgentCells; selectedId?: string; children: ReactNode }) {
  const params = useSearchParams();
  const publicationId = selectedPublicationId(index, selectedId);
  const [resource, setResource] = useState<RolePublicationResource>({ state: 'loading' });
  const [device, setDevice] = useState<PublisherDevice>('desktop');
  const [route, setRoute] = useState<{ cell?: string; id: string }>();
  useEffect(() => {
    const controller = new AbortController(); setResource({ state: 'loading' });
    loadPublication(controller.signal, publicationId).then(value => setResource({ state: 'ready', value }), error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [index, publicationId]);
  const value = resource.state === 'ready' && resource.value.state === 'ready' ? resource.value : undefined;
  const routeId = route?.cell === selectedId ? route?.id : params.get('published') ?? undefined;
  const page = value ? routeId ? value.pages.find(page => page.id === routeId) : selectedPublishedPage(index, selectedId, value.pages) ?? (!selectedId ? value.pages[0] : undefined) : undefined;
  const selectDevice = (next: string) => { if (Object.hasOwn(PUBLISHER_DEVICES, next)) setDevice(next as PublisherDevice); };
  const selectRoute = (id: string) => { if (value?.pages.some(page => page.id === id)) setRoute({ cell: selectedId, id }); };
  const publisher: PublisherRoleTools = { resource, page, device, viewport: PUBLISHER_DEVICES[device], selectDevice, selectRoute };
  // These are semantic section inputs, not page actions or module chrome.
  const payloads = {
    'sections.preview-controls': value ? { device, onDeviceChange: selectDevice } : undefined,
    'sections.site-map': value ? { entries: value.manifest.contentMap.entries, pages: value.pages, selectedId: page?.id, onSelectionChange: selectRoute } : undefined,
    'sections.search-social-preview': page ? { page, publication: value?.publication } : undefined,
  };
  return <RoleToolsContext.Provider value={{ publisher, payloads }}>{children}</RoleToolsContext.Provider>;
}

function WriterTools({ index, selectedId, children }: { index: AgentCells; selectedId?: string; children: ReactNode }) {
  const resource = useSpecimenCells(index);
  const cell = resource.state === 'ready' ? resource.cells.find(cell => cell.id === selectedId) : undefined;
  const [requestedLocale, setLocale] = useState<string>();
  const [direction, setDirection] = useState<RoleDirection>();
  const view = useMemo(() => writerRoleView(index, cell, requestedLocale, direction), [index, cell, requestedLocale, direction]);
  const selectLocale = (locale: string) => { if (view.locales.some(value => value.id === locale)) { setLocale(locale); setDirection(undefined); } };
  const selectDirection = (next: RoleDirection) => { if (next === 'ltr' || next === 'rtl') setDirection(next); };
  const voice = resource.state === 'ready' ? writerRoleVoice(resource.cells) : undefined;
  const writer: WriterRoleTools = { ...view, resource, cell, selectLocale, selectDirection };
  const payloads = {
    'sections.locale-switcher': cell ? { locales: view.locales, locale: view.selectedLocale, direction: view.selectedDirection, onLocaleChange: selectLocale, onDirectionChange: selectDirection } : undefined,
    'sections.voice-rules': voice ? voice : undefined,
  };
  return <RoleToolsContext.Provider value={{ writer, payloads }}>{children}</RoleToolsContext.Provider>;
}

/** One provider wraps the specimen and the manifest-driven right-column host. */
export function RoleToolsProvider({ index, selectedId, children }: { index?: AgentCells; selectedId?: string; children: ReactNode }) {
  if (index?.agent === 'publisher') return <PublisherTools index={index} selectedId={selectedId}>{children}</PublisherTools>;
  if (index?.agent === 'writer') return <WriterTools index={index} selectedId={selectedId}>{children}</WriterTools>;
  return <RoleToolsContext.Provider value={{ payloads: {} }}>{children}</RoleToolsContext.Provider>;
}
export function useRoleToolPayload(sectionId: string): Record<string, unknown> | undefined { return useContext(RoleToolsContext)?.payloads[sectionId]; }
export function useRoleToolPayloads(): Record<string, Record<string, unknown>> {
  const payloads = useContext(RoleToolsContext)?.payloads ?? {};
  return Object.fromEntries(Object.entries(payloads).filter((entry): entry is [string, Record<string, unknown>] => entry[1] !== undefined));
}
export function usePublisherRoleTools(): PublisherRoleTools | undefined { return useContext(RoleToolsContext)?.publisher; }
export function useWriterRoleTools(): WriterRoleTools | undefined { return useContext(RoleToolsContext)?.writer; }
