'use client';

import { useEffect, useState } from 'react';
import { contentCellIndex } from '../lib/cell-content';
import type { Agent } from '../lib/agents';
import { loadCells, loadCell, type AgentCells } from '../lib/cells-client';
import { loadPublication, safePreviewUrl, selectedPublicationId, selectedPublishedPage } from '../lib/publisher-preview';
import { AgentL3Specimen, useAgentSpecimenCoverage } from './AgentL3Specimen';
import { RoleToolsProvider, useRoleSpecimenResource } from './AgentSpecimenProvider';
import { useStudioUI } from './StudioSelection';

type ContentState = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; index: AgentCells };
function StandaloneBoundContent({ index, id }: { index: AgentCells; id: string }) {
  const { EmptyState } = useStudioUI();
  const resource = useRoleSpecimenResource(index);
  const coverage = useAgentSpecimenCoverage(index, index.cells[0]!);
  if (!resource || resource.cells.state === 'loading') return null;
  if (!coverage.ready) return <EmptyState role="alert" title="NEED: registered specimen leaf" description={coverage.issues.join(' ')} />;
  return <AgentL3Specimen index={index} selectedId={id} expanded />;
}
/** A content-only target deliberately renders neither StudioFrame nor a module host. */
export function StandaloneCellContent({ agent, id, version }: { agent: Agent; id: string; version?: number }) {
  const { EmptyState } = useStudioUI();
  const [resource, setResource] = useState<ContentState>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setResource({ state: 'loading' });
    void (async () => {
      const indexes = await loadCells(controller.signal);
      const index = indexes.find(index => index.agent === agent);
      if (!index || index.state !== 'ready' || !index.cells.some(cell => cell.id === id)) throw new Error('The requested cell is unavailable.');
      const detail = await loadCell(agent, id, controller.signal, version);
      if (version !== undefined && (agent === 'publisher' || agent === 'designer')) throw new Error(`NEED: ${agent} has no native historical cell-version provenance for this content target. Open the unversioned target for the current selected artifact.`);
      if (agent === 'publisher') {
        const publication = await loadPublication(controller.signal, selectedPublicationId(index, id));
        const page = publication.state === 'ready' ? selectedPublishedPage(index, id, publication.pages) : undefined;
        if (!page?.emitted || !safePreviewUrl(page.previewUrl)) throw new Error('This cell has no emitted publication. Run clossys publish --target preview.');
        if (!controller.signal.aborted) window.location.replace(page.previewUrl);
        return;
      }
      if (!controller.signal.aborted) setResource({ state: 'ready', index: contentCellIndex(index, detail, version) });
    })().catch(error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [agent, id, version]);
  if (resource.state === 'loading') return null;
  if (resource.state === 'error') return <EmptyState role="alert" title="Content unavailable" description={resource.message} />;
  return <RoleToolsProvider index={resource.index} selectedId={id}><StandaloneBoundContent index={resource.index} id={id} /></RoleToolsProvider>;
}
