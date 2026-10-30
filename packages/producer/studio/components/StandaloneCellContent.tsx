'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardDescription, CardHeader, CardTitle, Skeleton } from '@clossys/designer-ui';
import { contentCellIndex } from '../lib/cell-content';
import { AGENT_LABELS, type Agent } from '../lib/agents';
import { loadCells, loadCell, type AgentCells, type CellDetail } from '../lib/cells-client';
import { loadPublication, safePreviewUrl, selectedPublicationId, selectedPublishedPage } from '../lib/publisher-preview';
import { cellTitle, titleMap } from '../lib/studio-text';
import { AgentDetail } from './AgentDetails';
import { useStudioData } from './StudioProviders';

type ContentState = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; index: AgentCells; detail: CellDetail };

/** A content-only target deliberately renders neither the Studio shell nor its page modules. */
export function StandaloneCellContent({ agent, id, version }: { agent: Agent; id: string; version?: number }) {
  const { revision, cells } = useStudioData();
  const [resource, setResource] = useState<ContentState>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setResource({ state: 'loading' });
    void (async () => {
      const indexes = await loadCells(controller.signal);
      const index = indexes.find(entry => entry.agent === agent);
      if (!index || index.state !== 'ready' || !index.cells.some(cell => cell.id === id)) throw new Error('The requested cell is unavailable.');
      const detail = await loadCell(agent, id, controller.signal, version);
      if (agent === 'publisher' && version === undefined) {
        // An emitted page is the real content of a Publisher cell; open it when it exists.
        const publication = await loadPublication(controller.signal, selectedPublicationId(index, id)).catch(() => undefined);
        const page = publication?.state === 'ready' ? selectedPublishedPage(index, id, publication.pages) : undefined;
        if (page?.emitted && safePreviewUrl(page.previewUrl)) {
          if (!controller.signal.aborted) window.location.replace(page.previewUrl);
          return;
        }
      }
      if (!controller.signal.aborted) setResource({ state: 'ready', index: contentCellIndex(index, detail, version), detail });
    })().catch(error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [agent, id, version, revision]);
  const titles = useMemo(() => titleMap(cells.state === 'ready' ? cells.value.flatMap(entry => entry.cells) : []), [cells]);

  return <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-8">
    {resource.state === 'loading' ? <div className="flex flex-col gap-3" role="status" aria-label="Loading content">
      <h1 className="text-2xl font-semibold tracking-tight">{AGENT_LABELS[agent]}</h1>
      <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" />
    </div> : resource.state === 'error' ? <Card>
      <CardHeader><h1 className="sr-only">Content unavailable</h1><CardTitle>Content unavailable</CardTitle><CardDescription>{resource.message}</CardDescription></CardHeader>
    </Card> : <>
      <header className="flex flex-col gap-2 border-b pb-6">
        <p className="text-sm text-muted-foreground">{AGENT_LABELS[agent]}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{cellTitle(resource.detail)}</h1>
          <Badge variant="outline">v{resource.detail.version}</Badge>
          {resource.detail.status === 'draft' && <Badge variant="secondary">Draft</Badge>}
        </div>
      </header>
      <AgentDetail agent={agent} index={resource.index} detail={resource.detail} titles={titles} revision={revision} />
    </>}
  </main>;
}
