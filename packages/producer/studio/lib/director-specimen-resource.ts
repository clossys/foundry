'use client';
import { useEffect, useState } from 'react';
import { loadCell, type AgentCells, type CellDetail } from './cells-client';

export type SpecimenResource = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; cells: CellDetail[] };
/** Latest cells and independently pointed active Director versions are distinct requests. */
export function specimenCellRequests(index: AgentCells): { id: string; version?: number }[] {
  const scope = index.contentScope;
  if (scope?.kind === 'version') {
    if (!Number.isSafeInteger(scope.version) || scope.version < 1 || !index.cells.some(cell => cell.id === scope.cellId && cell.version === scope.version)) throw new Error('The exact content-version scope is invalid.');
    return [{ id: scope.cellId, version: scope.version }];
  }
  if (scope && (scope.kind !== 'cell' || !index.cells.some(cell => cell.id === scope.cellId))) throw new Error('The selected content-cell scope is invalid.');
  const selected = index.cells.filter(cell => !scope || cell.id === scope.cellId);
  const requests = selected.filter(cell => cell.status !== 'retired').map(cell => ({ id: cell.id, version: cell.version }));
  const active = index.agent === 'director' ? index.tree?.active : undefined;
  if (active !== undefined && (active === null || typeof active !== 'object' || Array.isArray(active))) throw new Error('The Director active-version metadata is invalid.');
  if (active && typeof active === 'object') {
    for (const cell of selected) {
      const version = (active as Record<string, unknown>)[cell.id];
      // A null pointer explicitly means that this cell has no active version.
      if (version === undefined || version === null) continue;
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('The selected Director active-version pointer is invalid.');
      if (!requests.some(request => request.id === cell.id && request.version === version)) requests.push({ id: cell.id, version });
    }
  }
  return requests;
}

/** Request planning failures and HTTP failures use the same visible resource error path. */
export async function loadSpecimenCells(index: AgentCells, signal: AbortSignal): Promise<CellDetail[]> {
  return Promise.all(specimenCellRequests(index).map(cell => loadCell(index.agent, cell.id, signal, cell.version)));
}

/** Abort and clear the previous snapshot on index refresh so stale copy is never relabelled. */
export function useSpecimenCells(index: AgentCells): SpecimenResource {
  const [resource, setResource] = useState<SpecimenResource>({ state: 'loading' });
  const [loadedIndex, setLoadedIndex] = useState<AgentCells>();
  useEffect(() => {
    const controller = new AbortController();
    setResource({ state: 'loading' }); setLoadedIndex(index);
    loadSpecimenCells(index, controller.signal).then(cells => {
      if (!controller.signal.aborted) setResource({ state: 'ready', cells });
    }, error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : 'Specimen cells could not be loaded.' }); });
    return () => controller.abort();
  }, [index]);
  return loadedIndex === index ? resource : { state: 'loading' };
}
