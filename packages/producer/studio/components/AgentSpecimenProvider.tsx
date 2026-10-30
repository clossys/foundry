'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AgentCells, CellDetail } from '../lib/cells-client';
import { useSpecimenCells, type SpecimenResource } from '../lib/director-specimen-resource';
import { loadPublication, selectedPublicationId, selectedPublishedPage, type PublicationResponse } from '../lib/publisher-preview';
import { writerProjection } from '../lib/writer-specimen';
import { cellContentTarget } from '../lib/cell-content';

export type RolePublicationResource = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: PublicationResponse };
export interface RoleSpecimenResource { index: AgentCells; cells: SpecimenResource; publication?: RolePublicationResource; publications?: Record<string, RolePublicationResource> }
interface RoleValue { resource?: RoleSpecimenResource; payloads: Record<string, Record<string, unknown>> }
const RoleToolsContext = createContext<RoleValue>({ payloads: {} });

function LoadedRoles({ index, selectedId, children }: { index: AgentCells; selectedId?: string; children: ReactNode }) {
  const cells = useSpecimenCells(index);
  const publicationId = selectedPublicationId(index, selectedId);
  const [loadedPublications, setPublications] = useState<{ index?: AgentCells; primary: RolePublicationResource; resources: Record<string, RolePublicationResource> }>({ primary: { state: 'loading' }, resources: {} });
  useEffect(() => {
    if (index.agent !== 'publisher') return;
    const controller = new AbortController();
    const declared = index.tree?.meta && typeof index.tree.meta === 'object' && 'publications' in index.tree.meta && Array.isArray(index.tree.meta.publications)
      ? index.tree.meta.publications.flatMap((value: unknown) => value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? [value.id] : []) : [];
    setPublications({ index, primary: { state: 'loading' }, resources: {} });
    const load = async (id?: string): Promise<RolePublicationResource> => {
      try { return { state: 'ready', value: await loadPublication(controller.signal, id) }; }
      catch (error) { return { state: 'error', message: error instanceof Error ? error.message : String(error) }; }
    };
    void (async () => {
      const primary = await load(declared[0]);
      if (controller.signal.aborted) return;
      const primaryId = primary.state === 'ready' && primary.value.state === 'ready' ? primary.value.publication : declared[0];
      setPublications({ index, primary, resources: primaryId ? { [primaryId]: primary } : {} });
      const discovered = primary.state === 'ready' && primary.value.state === 'ready' ? primary.value.publications : [];
      await Promise.all([...new Set([...declared, ...discovered])].filter(id => id !== primaryId).map(async id => {
        const value = await load(id);
        if (!controller.signal.aborted) setPublications(current => current.index === index ? { ...current, resources: { ...current.resources, [id]: value } } : current);
      }));
    })();
    return () => controller.abort();
  }, [index]);
  const publications = loadedPublications.index === index ? loadedPublications.resources : {};
  const publication: RolePublicationResource = publicationId && publications[publicationId] ? publications[publicationId] : loadedPublications.index === index ? loadedPublications.primary : { state: 'loading' };
  const summary = index.cells.find(cell => cell.id === selectedId);
  const cell = cells.state === 'ready' ? cells.cells.find(cell => cell.id === selectedId && (summary?.version === undefined || cell.version === summary.version)) : undefined;
  const roleFacts: Record<string, unknown> = {};
  if (index.agent === 'writer' && cell) {
    const copy = writerProjection(cell);
    roleFacts.voice = { tone: copy.tone, bannedWords: copy.banned };
  }
  if (index.agent === 'publisher' && publication.state === 'ready' && publication.value.state === 'ready') {
    const page = selectedPublishedPage(index, selectedId, publication.value.pages);
    if (page) roleFacts.publication = { ...page, publication: publication.value.publication };
  }
  const payloads: Record<string, Record<string, unknown>> = selectedId && Object.keys(roleFacts).length ? { 'sections.record-detail': { roleFacts, contentTarget: cellContentTarget(index.agent, selectedId, { version: summary?.version }) } } : {};
  return <RoleToolsContext.Provider value={{ resource: { index, cells, ...(index.agent === 'publisher' ? { publication, publications } : {}) }, payloads }}>{children}</RoleToolsContext.Provider>;
}

/** Shares loaded semantic content; tools and their labels come only from the page manifest. */
export function RoleToolsProvider({ index, selectedId, children }: { index?: AgentCells; selectedId?: string; children: ReactNode }) {
  return index ? <LoadedRoles index={index} selectedId={selectedId}>{children}</LoadedRoles> : <RoleToolsContext.Provider value={{ payloads: {} }}>{children}</RoleToolsContext.Provider>;
}
export function useRoleToolPayload(sectionId: string): Record<string, unknown> | undefined { return useContext(RoleToolsContext).payloads[sectionId]; }
export function useRoleToolPayloads(): Record<string, Record<string, unknown>> { return useContext(RoleToolsContext).payloads; }
export function useRoleSpecimenResource(index: AgentCells): RoleSpecimenResource | undefined {
  const resource = useContext(RoleToolsContext).resource;
  return resource?.index === index ? resource : undefined;
}
export function latestSpecimenCell(resource: SpecimenResource, index: AgentCells, id: string): CellDetail | undefined {
  const summary = index.cells.find(cell => cell.id === id);
  return resource.state === 'ready' ? resource.cells.find(cell => cell.id === id && (summary?.version === undefined || summary.version === cell.version)) : undefined;
}
