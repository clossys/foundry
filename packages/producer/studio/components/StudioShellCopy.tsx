'use client';

import { useEffect, useState } from 'react';
import { loadCell, loadCells, type AgentCells } from '../lib/cells-client';
import { emptyStudioAdminCopy, projectStudioAdminCopy, studioAdminCopyRequests, type StudioAdminCopyData } from '../lib/studio-shell-copy';

/** Data only: the host installs this native Writer port on the selected AppFrame. */
export function useStudioAdminCopy(indexes?: readonly AgentCells[]): StudioAdminCopyData {
  const [data, setData] = useState<StudioAdminCopyData>(() => emptyStudioAdminCopy('loading'));
  const [loadedIndexes, setLoadedIndexes] = useState<readonly AgentCells[] | undefined>();
  useEffect(() => {
    let request: AbortController | undefined;
    let disposed = false;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController(); request = controller;
      setData(emptyStudioAdminCopy('loading')); setLoadedIndexes(indexes);
      void (async () => {
        const all = indexes ?? await loadCells(controller.signal);
        const index = all.find(index => index.agent === 'writer');
        if (!index || index.state !== 'ready') return emptyStudioAdminCopy('missing', [index?.error ?? 'Writer cells are unavailable.']);
        const selected = studioAdminCopyRequests(index);
        const loaded = await Promise.allSettled(selected.requests.map(cell => loadCell('writer', cell.id, controller.signal, cell.version)));
        const cells = loaded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        const issues = loaded.flatMap((result, position) => result.status === 'rejected' ? [`Writer source version could not be read: ${selected.requests[position]!.id}`] : []);
        return projectStudioAdminCopy(index, cells, issues);
      })().then(value => { if (!disposed && !controller.signal.aborted) setData(value); }, () => { if (!disposed && !controller.signal.aborted) setData(emptyStudioAdminCopy('error', ['Writer cells could not be loaded.'])); });
    };
    refresh();
    return () => { disposed = true; request?.abort(); };
  }, [indexes]);
  return loadedIndexes === indexes ? data : emptyStudioAdminCopy('loading');
}
