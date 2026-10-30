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
  const requests = index.cells.filter(cell => cell.status !== 'retired').map(cell => ({ id: cell.id, version: cell.version }));
  const active = index.agent === 'director' ? index.tree?.active : undefined;
  if (active && typeof active === 'object' && !Array.isArray(active)) {
    for (const cell of index.cells) {
      const version = (active as Record<string, unknown>)[cell.id];
      if (typeof version === 'number' && Number.isSafeInteger(version) && version > 0 && !requests.some(request => request.id === cell.id && request.version === version)) requests.push({ id: cell.id, version });
    }
  }
  return requests;
}

/** Abort and clear the previous snapshot on index refresh so stale copy is never relabelled. */
export function useSpecimenCells(index: AgentCells): SpecimenResource {
  const [resource, setResource] = useState<SpecimenResource>({ state: 'loading' });
  const [loadedIndex, setLoadedIndex] = useState<AgentCells>();
  useEffect(() => {
    const controller = new AbortController();
    setResource({ state: 'loading' }); setLoadedIndex(index);
    Promise.all(specimenCellRequests(index).map(cell => loadCell(index.agent, cell.id, controller.signal, cell.version))).then(cells => {
      if (!controller.signal.aborted) setResource({ state: 'ready', cells });
    }, error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : 'Specimen cells could not be loaded.' }); });
    return () => controller.abort();
  }, [index]);
  return loadedIndex === index ? resource : { state: 'loading' };
}
