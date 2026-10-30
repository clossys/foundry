'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStudioUI } from './StudioSelection';
import { AGENT_LABELS, type Agent } from '../lib/agents';
import { loadCell, loadCells, type AgentCells, type CellDetail } from '../lib/cells-client';
import { studioCellChange } from '../lib/studio-module-data';
import { StudioFrame } from './StudioFrame';
import { RoleToolsProvider } from './AgentSpecimenProvider';
import { StudioCommonModules } from './StudioCommonModules';
import { studioHome } from '../generated/studio-map';

type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

export function CellsWorkspace({ agent }: { agent?: Agent }) {
  const { EmptyState } = useStudioUI();
  const params = useSearchParams();
  const selectedId = params.get('cell') ?? undefined;
  const [revision, setRevision] = useState(0);
  const [index, setIndex] = useState<Resource<AgentCells[]>>({ state: 'loading' });
  const [detail, setDetail] = useState<Resource<CellDetail>>({ state: 'loading' });
  useEffect(() => {
    const events = new EventSource('/api/events');
    events.addEventListener('change', event => {
      try { if (studioCellChange(JSON.parse((event as MessageEvent<string>).data))) setRevision(value => value + 1); }
      catch { /* Malformed SSE cannot become a revision or successful check. */ }
    });
    return () => events.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setIndex({ state: 'loading' });
    loadCells(controller.signal).then(value => setIndex({ state: 'ready', value }), error => { if (!controller.signal.aborted) setIndex({ state: 'error', message: error instanceof Error ? error.message : 'Producer is unavailable.' }); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail({ state: 'loading' });
    if (agent && selectedId) loadCell(agent, selectedId, controller.signal).then(value => setDetail({ state: 'ready', value }), error => { if (!controller.signal.aborted) setDetail({ state: 'error', message: error instanceof Error ? error.message : 'The cell could not be loaded.' }); });
    return () => controller.abort();
  }, [agent, selectedId, revision]);
  const indexes = index.state === 'ready' ? index.value : [];
  const selectedIndex = indexes.find(item => item.agent === agent);
  const selectedDetail = detail.state === 'ready' && detail.value.agent === agent && detail.value.id === selectedId ? detail.value : undefined;
  const title = agent ? AGENT_LABELS[agent] : studioHome.label;
  let stage = <EmptyState title={studioHome.label} />;
  if (agent) {
    if (index.state === 'loading') stage = <EmptyState role="status" title="Loading cells…" />;
    else if (index.state === 'error') stage = <EmptyState role="alert" title="Cells could not be loaded" description={index.message} />;
    else if (!selectedIndex || selectedIndex.state !== 'ready') stage = <EmptyState title="Cells are unavailable" description={selectedIndex?.error} />;
    else stage = <EmptyState title="NEED: manifest-bound IA body" description="The native body/container projection and registered specimen, card-body and module-frame APIs require the integration composition." />;
  }
  return <RoleToolsProvider index={selectedIndex} selectedId={selectedId}><StudioCommonModules pageId={agent ?? studioHome.id} indexes={indexes} agent={agent} selectedId={selectedId} detail={selectedDetail} revision={revision}>
    <StudioFrame page={{ title }}>{stage}</StudioFrame>
  </StudioCommonModules></RoleToolsProvider>;
}
