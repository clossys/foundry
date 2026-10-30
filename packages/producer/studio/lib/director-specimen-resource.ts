'use client';
import { useEffect, useState } from 'react';
import { loadCell, type AgentCells, type CellDetail } from './cells-client';

export type SpecimenResource = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; cells: CellDetail[] };
/** Abort and clear the previous snapshot on index refresh so stale copy is never relabelled. */
export function useSpecimenCells(index: AgentCells): SpecimenResource {
  const [resource, setResource] = useState<SpecimenResource>({ state: 'loading' });
  const [loadedIndex, setLoadedIndex] = useState<AgentCells>();
  useEffect(() => {
    const controller = new AbortController();
    setResource({ state: 'loading' }); setLoadedIndex(index);
    Promise.all(index.cells.filter(cell => cell.status !== 'retired').map(cell => loadCell(index.agent, cell.id, controller.signal))).then(cells => {
      if (!controller.signal.aborted) setResource({ state: 'ready', cells });
    }, error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : 'Specimen cells could not be loaded.' }); });
    return () => controller.abort();
  }, [index]);
  return loadedIndex === index ? resource : { state: 'loading' };
}
