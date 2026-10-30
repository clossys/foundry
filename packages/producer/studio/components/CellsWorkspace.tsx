'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStudioSelection, useStudioUI } from './StudioSelection';
import { AGENT_LABELS, isAgent, type Agent } from '../lib/agents';
import { cellHierarchy, loadCell, loadCells, type AgentCells, type CellDetail, type CellNode } from '../lib/cells-client';
import { StudioFrame } from './StudioFrame';
import { DirectorSpecimen } from './DirectorSpecimen';
import { WriterSpecimen } from './WriterSpecimen';
import { PublisherSpecimen } from './PublisherSpecimen';
import { SourceDisclosure } from './SourceDisclosure';
import { studioHome } from '../generated/studio-map';

type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

function cellHref(agent: Agent, id: string) {
  return `?agent=${encodeURIComponent(agent)}&cell=${encodeURIComponent(id)}`;
}

function firstCell(nodes: readonly CellNode[]): CellNode | undefined {
  for (const node of nodes) {
    if (!node.group) return node;
    const child = firstCell(node.children);
    if (child) return child;
  }
}

function expandedGroups(nodes: readonly CellNode[]): string[] {
  return nodes.flatMap(node => [...(node.group ? [node.id] : []), ...expandedGroups(node.children)]);
}

function cellTreeItems(nodes: readonly CellNode[], agent: Agent, ui: ReturnType<typeof useStudioUI>) {
  const { NavigationTreeItem, NavigationTreeItemContent, Link, Icon, Badge } = ui;
  return nodes.map(node => <NavigationTreeItem key={node.id} id={node.id} textValue={node.title} href={node.group ? undefined : cellHref(agent, node.id)}>
    <NavigationTreeItemContent>{({ isExpanded }) => <>
      <Link variant="standalone">{node.group ? <Icon asset={isExpanded ? 'assets.icon-chevron-down' : 'assets.icon-chevron-right'} decorative /> : null}{node.title}</Link>
      {node.status ? <Badge variant={node.status === 'active' ? 'success' : node.status === 'draft' ? 'warning' : 'neutral'}>{node.status}</Badge> : null}
    </>}</NavigationTreeItemContent>
    {cellTreeItems(node.children, agent, ui)}
  </NavigationTreeItem>);
}

function AgentTree({ index, selected }: { index: AgentCells; selected?: string }) {
  const ui = useStudioUI();
  const { EmptyState, ContentSection, SectionHeader, NavigationTree } = ui;
  let nodes: CellNode[];
  try { nodes = cellHierarchy(index.cells, index.tree); } catch { return <EmptyState title="Cell tree unavailable" description="Producer returned an invalid cell hierarchy." role="alert" />; }
  return <ContentSection>
    <SectionHeader title={AGENT_LABELS[index.agent]} description={index.state && index.state !== 'ready' ? `Cell index: ${index.state}` : undefined} />
    {index.error ? <EmptyState title="Cells unavailable" description={index.error} role="alert" /> : index.cells.length ? <NavigationTree aria-label={`${AGENT_LABELS[index.agent]} cells`} selectedRoute={selected ? cellHref(index.agent, selected) : undefined} defaultExpandedKeys={expandedGroups(nodes)}>{cellTreeItems(nodes, index.agent, ui)}</NavigationTree> : <EmptyState title="No cells yet" description={`No ${AGENT_LABELS[index.agent]} cells were found in this repository.`} />}
  </ContentSection>;
}

function DesignerSelectionNeeds() {
  const { selection } = useStudioSelection();
  const { ContentSection, SectionHeader } = useStudioUI();
  const missing = selection.leaves.filter(leaf => leaf.source !== 'consumer');
  if (!missing.length) return null;
  return <ContentSection><SectionHeader title="Designer selection gaps" description={missing.map(leaf => `NEED: ${leaf.leaf} → ${leaf.fill ?? 'unavailable'}`).join('; ')} /></ContentSection>;
}

export function CellsWorkspace({ agent }: { agent?: Agent }) {
  const { ArticleBody, ContentSection, EmptyState, SectionFrame, SectionHeader, Badge, Icon } = useStudioUI();
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
    if (selectedId || index.state !== 'ready') return;
    for (const item of index.value) {
      if (selectedAgent && item.agent !== selectedAgent || item.state !== 'ready') continue;
      let first: CellNode | undefined;
      try { first = firstCell(cellHierarchy(item.cells, item.tree)); } catch { continue; }
      if (!first) continue;
      const next = new URLSearchParams(params.toString());
      next.set('agent', item.agent);
      next.set('cell', first.id);
      router.replace(`?${next.toString()}`, { scroll: false });
      break;
    }
  }, [index, params, router, selectedAgent, selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail({ state: 'loading' });
    if (selectedAgent && selectedId) loadCell(selectedAgent, selectedId, controller.signal).then(value => setDetail({ state: 'ready', value }), error => { if (!controller.signal.aborted) setDetail({ state: 'error', message: error instanceof Error ? error.message : 'The cell could not be loaded.' }); });
    return () => controller.abort();
  }, [selectedAgent, selectedId, revision]);
  const visible = index.state === 'ready' ? index.value.filter(item => agent === undefined || item.agent === agent) : [];
  const title = agent ? AGENT_LABELS[agent] : studioHome.label;
  const selectedIndex = visible.find(item => item.agent === selectedAgent);
  const selectedCell = selectedIndex?.cells.find(cell => cell.id === selectedId);
  return <StudioFrame page={{ title, description: 'Read-only agent cells', actions: [
    { id: 'refresh', label: 'Reload cells', icon: <Icon asset="assets.icon-document" decorative />, onAction: () => { setRevision(value => value + 1); router.refresh(); } },
    ...(agent ? [{ id: studioHome.id, label: `Open ${studioHome.label}`, href: studioHome.href, icon: <Icon asset="assets.icon-home" decorative /> }] : []),
  ] }}>
    <SectionFrame measure="wide">
      <SectionHeader role="status" description={live ? 'Changes refresh automatically.' : 'Use Reload cells to check for changes.'} />
      {agent === 'designer' ? <DesignerSelectionNeeds /> : null}
      {index.state === 'loading' ? <EmptyState role="status" title="Loading cells…" description="Reading the current cell index from Producer." /> : index.state === 'error' ? <EmptyState role="alert" title="Cells could not be loaded" description={index.message} /> : visible.length === 0 ? <EmptyState title="No cells available" description="Producer has no cell index for this view." /> : <ArticleBody aria-label="Cell workspace" toc={<ContentSection>{visible.map(item => <AgentTree key={item.agent} index={item} selected={selectedAgent === item.agent ? selectedId : undefined} />)}</ContentSection>}>
        {!selectedId ? <EmptyState title="No cell selected" description="Select an available cell from the tree to read its content." /> : !selectedAgent ? <EmptyState role="alert" title="Choose an agent" description="The selected cell needs an agent from this repository." /> : selectedIndex && selectedAgent === 'director' ? <DirectorSpecimen index={selectedIndex} selectedId={selectedId} /> : selectedIndex && selectedAgent === 'writer' ? <WriterSpecimen index={selectedIndex} selectedId={selectedId} /> : detail.state === 'loading' || detail.state === 'ready' && (detail.value.agent !== selectedAgent || detail.value.id !== selectedId) ? <EmptyState role="status" title="Loading cell…" /> : detail.state === 'error' ? <EmptyState role="alert" title="Cell could not be loaded" description={detail.message} /> : <>
          <SectionHeader title={selectedCell?.title ?? detail.value.title} eyebrow={AGENT_LABELS[detail.value.agent]} description={detail.value.id} stats={<>
            {detail.value.status ? <Badge variant={detail.value.status === 'active' ? 'success' : detail.value.status === 'draft' ? 'warning' : 'neutral'}>{detail.value.status}</Badge> : null}
            {detail.value.version !== undefined ? <Badge>v{detail.value.version}</Badge> : null}
          </>} />
          {detail.value.agent === 'publisher' ? <PublisherSpecimen index={visible.find(item => item.agent === 'publisher')!} selectedId={selectedId} /> : null}
          <SourceDisclosure key={`${detail.value.agent}:${detail.value.id}`} source={detail.value.content} />
        </>}
        {selectedIndex && (selectedAgent === 'director' || selectedAgent === 'writer') && detail.state === 'ready' && detail.value.agent === selectedAgent && detail.value.id === selectedId ? <SourceDisclosure key={`${detail.value.agent}:${detail.value.id}`} source={detail.value.content} /> : null}
      </ArticleBody>}
    </SectionFrame>
  </StudioFrame>;
}
