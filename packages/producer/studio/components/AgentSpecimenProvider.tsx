'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AgentCells, CellDetail } from '../lib/cells-client';
import { useSpecimenCells, type SpecimenResource } from '../lib/director-specimen-resource';
import { loadPublication, selectedPublicationId, selectedPublishedPage, type PublicationResponse } from '../lib/publisher-preview';
import { writerProjection } from '../lib/writer-specimen';
import { cellContentTarget } from '../lib/cell-content';

export type RolePublicationResource = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: PublicationResponse };
export interface RoleSpecimenResource { index: AgentCells; cells: SpecimenResource; publication?: RolePublicationResource }
interface RoleValue { resource?: RoleSpecimenResource; payloads: Record<string, Record<string, unknown>> }
const RoleToolsContext = createContext<RoleValue>({ payloads: {} });

function LoadedRoles({ index, selectedId, children }: { index: AgentCells; selectedId?: string; children: ReactNode }) {
  const cells = useSpecimenCells(index);
  const publicationId = selectedPublicationId(index, selectedId);
  const [publication, setPublication] = useState<RolePublicationResource>({ state: 'loading' });
  useEffect(() => {
    if (index.agent !== 'publisher') return;
    const controller = new AbortController();
    setPublication({ state: 'loading' });
    loadPublication(controller.signal, publicationId).then(value => { if (!controller.signal.aborted) setPublication({ state: 'ready', value }); }, error => { if (!controller.signal.aborted) setPublication({ state: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [index, publicationId]);
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
  return <RoleToolsContext.Provider value={{ resource: { index, cells, ...(index.agent === 'publisher' ? { publication } : {}) }, payloads }}>{children}</RoleToolsContext.Provider>;
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
