'use client';

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { StudioFrame } from '../components/StudioFrame';
import { agentDetailData, agentNotice, loadAgentLeaf, type AgentLeafRecords, type LibraryAgent } from '../lib/agent-library';
import { AgentDetail } from './agent-detail';
import { GalleryNotice } from './agent-gallery';

type Load = { state: 'loading' } | { state: 'ready'; value: AgentLeafRecords } | { state: 'missing' } | { state: 'error'; message: string };
const NO_ACTIONS: never[] = [];

/** `/<agent>/<leaf>`: one leaf's specimen, checks, contract, history and uses, through the shared template. */
export default function AgentLeafView({ agent, slug }: { agent: LibraryAgent; slug: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    loadAgentLeaf(agent, slug, controller.signal).then(value => setLoad(value ? { state: 'ready', value } : { state: 'missing' }), error => {
      if (!controller.signal.aborted) setLoad({ state: 'error', message: error instanceof Error ? error.message : 'The leaf could not load.' });
    });
    return () => controller.abort();
  }, [agent, slug]);
  const data = useMemo(() => load.state === 'ready' ? agentDetailData(load.value) : undefined, [load]);
  if (load.state === 'missing') notFound();
  return <StudioFrame pageId={agent} actions={NO_ACTIONS} {...(data ? { trail: data.header.name } : {})}>
    {load.state === 'loading' ? <GalleryNotice />
      : load.state === 'error' ? <GalleryNotice notice={agentNotice(agent, 'error', load.message)} />
      : data && <AgentDetail {...data} />}
  </StudioFrame>;
}
