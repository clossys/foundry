'use client';

import { useEffect, useMemo, useState } from 'react';
import { StudioFrame } from '../components/StudioFrame';
import { agentGalleryHeader, agentGalleryLayers, agentNotice, agentUnit, loadAgentGallery, type AgentGalleryRecords, type LibraryAgent } from '../lib/agent-library';
import { AgentGallery, GalleryNotice } from './agent-gallery';

type Load = { state: 'loading' } | { state: 'ready'; value: AgentGalleryRecords } | { state: 'error'; message: string };
const NO_ACTIONS: never[] = [];

/** `/<agent>`: the view-only gallery of one agent's record store, through the shared template. */
export default function AgentGalleryView({ agent }: { agent: LibraryAgent }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    loadAgentGallery(agent, controller.signal).then(value => setLoad({ state: 'ready', value }), error => {
      if (!controller.signal.aborted) setLoad({ state: 'error', message: error instanceof Error ? error.message : 'The agent library could not load.' });
    });
    return () => controller.abort();
  }, [agent]);
  const layers = useMemo(() => load.state === 'ready' ? agentGalleryLayers(load.value) : [], [load]);
  return <StudioFrame pageId={agent} actions={NO_ACTIONS}>
    {load.state === 'loading' ? <GalleryNotice />
      : load.state === 'error' ? <GalleryNotice notice={agentNotice(agent, 'error', load.message)} />
      : load.value.state === 'missing' || !layers.length ? <GalleryNotice notice={agentNotice(agent, 'missing')} />
      : <AgentGallery header={agentGalleryHeader(load.value)} unit={agentUnit(agent)} layers={layers} />}
  </StudioFrame>;
}
