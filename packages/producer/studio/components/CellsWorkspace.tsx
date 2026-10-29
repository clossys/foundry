'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArticleBody, ContentSection, DetailView, EmptyState, SectionFrame } from '@clossys/designer/blocks';
import { Icon, Link } from '@clossys/designer/components';
import { FileText, Home } from '@clossys/designer/icons';
import { AGENT_LABELS, isAgent, type Agent } from '../lib/agents';
import { cellHierarchy, loadCell, loadCells, type AgentCells, type CellDetail, type CellNode } from '../lib/cells-client';
import { StudioFrame } from './StudioFrame';

type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

function CellTree({ nodes, agent, selected }: { nodes: readonly CellNode[]; agent: Agent; selected?: string }) {
  return <ul>{nodes.map(node => <li key={node.id}>
    {node.group ? <span>{node.title}</span> : <Link href={`?agent=${encodeURIComponent(agent)}&cell=${encodeURIComponent(node.id)}`} aria-current={selected === node.id ? 'true' : undefined}>{node.title}{node.status || node.version !== undefined ? <span className="text-body-s text-ink-secondary"> · {[node.status, node.version !== undefined ? `v${node.version}` : undefined].filter(Boolean).join(' · ')}</span> : null}</Link>}
    {node.children.length ? <CellTree nodes={node.children} agent={agent} selected={selected} /> : null}
  </li>)}</ul>;
}
function AgentTree({ index, selected }: { index: AgentCells; selected?: string }) {
  let nodes: CellNode[];
  try { nodes = cellHierarchy(index.cells, index.tree); } catch { return <EmptyState title="Cell tree unavailable" description="Producer returned an invalid cell hierarchy." role="alert" />; }
  return <ContentSection heading={AGENT_LABELS[index.agent]} headingLevel={2} description={index.state && index.state !== 'ready' ? `Cell index: ${index.state}` : undefined}>
    {index.error ? <EmptyState title="Cells unavailable" description={index.error} role="alert" /> : nodes.length ? <nav className="studio-cell-tree" aria-label={`${AGENT_LABELS[index.agent]} cells`}><CellTree nodes={nodes} agent={index.agent} selected={selected} /></nav> : <EmptyState title="No cells yet" description={`No ${AGENT_LABELS[index.agent]} cells were found in this repository.`} />}
  </ContentSection>;
}

export function CellsWorkspace({ agent }: { agent?: Agent }) {
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get('cell') ?? undefined;
  const requestedAgent = params.get('agent');
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(false);
  const [index, setIndex] = useState<Resource<AgentCells[]>>({ state: 'loading' });
  const [detail, setDetail] = useState<Resource<CellDetail>>({ state: 'loading' });
  const selectedAgent = agent ?? (requestedAgent && isAgent(requestedAgent) ? requestedAgent : undefined);
  useEffect(() => {
    const events = new EventSource('/api/events');
    const refresh = () => setRevision(value => value + 1);
    events.onopen = () => setLive(true);
    events.onerror = () => setLive(false);
    events.addEventListener('change', refresh);
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
    if (selectedAgent && selectedId) loadCell(selectedAgent, selectedId, controller.signal).then(value => setDetail({ state: 'ready', value }), error => { if (!controller.signal.aborted) setDetail({ state: 'error', message: error instanceof Error ? error.message : 'The cell could not be loaded.' }); });
    return () => controller.abort();
  }, [selectedAgent, selectedId, revision]);
  const visible = index.state === 'ready' ? index.value.filter(item => agent === undefined || item.agent === agent) : [];
  const title = agent ? AGENT_LABELS[agent] : 'Home';
  const selectedCell = visible.find(item => item.agent === selectedAgent)?.cells.find(cell => cell.id === selectedId);
  return <StudioFrame page={{ title, breadcrumb: agent ? [{ id: 'agents', label: 'Agents' }] : undefined, description: 'Read-only agent cells', actions: [
    { id: 'refresh', label: 'Reload cells', icon: <Icon glyph={FileText} decorative />, onAction: () => { setRevision(value => value + 1); router.refresh(); } },
    ...(agent ? [{ id: 'home', label: 'Open Home', href: '/', icon: <Icon glyph={Home} decorative /> }] : []),
  ] }}>
    <SectionFrame measure="wide">
      <p className="text-body-s text-ink-secondary" role="status">{live ? 'Changes refresh automatically.' : 'Use Reload cells to check for changes.'}</p>
      {index.state === 'loading' ? <EmptyState role="status" title="Loading cells…" description="Reading the current cell index from Producer." /> : index.state === 'error' ? <EmptyState role="alert" title="Cells could not be loaded" description={index.message} /> : visible.length === 0 ? <EmptyState title="No cells available" description="Producer has no cell index for this view." /> : <div className="studio-columns">
        <div>{visible.map(item => <AgentTree key={item.agent} index={item} selected={selectedAgent === item.agent ? selectedId : undefined} />)}</div>
        <div>
          {!selectedId ? <EmptyState title="Choose a cell" description="Select a cell from the tree to read its content." /> : !selectedAgent ? <EmptyState role="alert" title="Choose an agent" description="The selected cell needs an agent from this repository." /> : detail.state === 'loading' || detail.state === 'ready' && (detail.value.agent !== selectedAgent || detail.value.id !== selectedId) ? <EmptyState role="status" title="Loading cell…" /> : detail.state === 'error' ? <EmptyState role="alert" title="Cell could not be loaded" description={detail.message} /> : <>
            <DetailView title={selectedCell?.title ?? selectedId} fields={[{ label: 'Agent', value: AGENT_LABELS[detail.value.agent] }, { label: 'Cell', value: detail.value.id }, ...(detail.value.status ? [{ label: 'Status', value: detail.value.status }] : []), ...(detail.value.version !== undefined ? [{ label: 'Version', value: String(detail.value.version) }] : [])]} />
            <ArticleBody aria-label="Cell content"><div className="studio-cell-source">{detail.value.content || 'This cell has no content.'}</div></ArticleBody>
          </>}
        </div>
      </div>}
    </SectionFrame>
  </StudioFrame>;
}
