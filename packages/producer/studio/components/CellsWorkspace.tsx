'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRightIcon, XIcon } from 'lucide-react';
import {
  Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, LinkButton, ScrollArea, Skeleton,
} from '@clossys/designer-ui';
import { AGENT_LABELS, AGENTS, type Agent } from '../lib/agents';
import { cellHierarchy, loadCell, type AgentCells, type CellDetail, type CellNode } from '../lib/cells-client';
import { designerLayer } from '../lib/designer-fill';
import { studioIcon } from '../lib/studio-icons';
import type { StudioReport } from '../lib/studio-report';
import { cellTitle, humanize, presentText, titleMap } from '../lib/studio-text';
import { studioAgentHref } from '../generated/studio-map';
import { AgentDetail } from './AgentDetails';
import { ReportList, StudioFrame, usePageModules } from './StudioFrame';
import { useStudioData, type Resource } from './StudioProviders';

const AGENT_PURPOSE: Record<Agent, string> = {
  director: 'Strategy: the direction, reasoning and signals the business runs on.',
  designer: 'Design decisions: tokens, sections and frames the product is built from.',
  writer: 'Copy: the voice and every string the product shows.',
  publisher: 'Pages: what gets published, where, and its preview state.',
};

const LAYER_ORDER = ['frames', 'sections', 'components', 'tokens', 'assets'];

/** Explorer tree. Designer cells carry no authored grouping, so their layer becomes the group. */
function explorerTree(index: AgentCells): CellNode[] {
  if (index.agent !== 'designer') {
    const tree = cellHierarchy(index.cells, index.tree);
    // An ungrouped flat list of dotted identities groups by its leading domain.
    if (tree.some(node => node.group || node.children.length) || !index.cells.every(cell => cell.id.includes('.'))) return tree;
    const domains = new Map<string, CellNode[]>();
    for (const node of tree) { const domain = node.id.split('.')[0]!; domains.set(domain, [...(domains.get(domain) ?? []), node]); }
    return domains.size < 2 ? tree : [...domains].map(([domain, children]) => ({ id: `domain-${domain}`, title: humanize(domain), group: true, children }));
  }
  const layers = new Map<string, CellNode[]>();
  for (const cell of index.cells) {
    const layer = designerLayer(cell.id);
    layers.set(layer, [...(layers.get(layer) ?? []), { ...cell, children: [] }]);
  }
  return [...layers].sort(([a], [b]) => (LAYER_ORDER.indexOf(a) + 99) % 99 - (LAYER_ORDER.indexOf(b) + 99) % 99)
    .map(([layer, children]) => ({ id: `layer-${layer}`, title: humanize(layer), group: true, children }));
}
function leaves(nodes: readonly CellNode[]): CellNode[] { return nodes.flatMap(node => node.group ? leaves(node.children) : [node, ...leaves(node.children)]); }
function leafCount(node: CellNode): number { return node.group ? node.children.reduce((sum, child) => sum + leafCount(child), 0) : 1 + node.children.reduce((sum, child) => sum + leafCount(child), 0); }

function PageHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="flex flex-col gap-3 border-b px-4 py-6 md:px-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  </div>;
}

function Explorer({ nodes, selectedId, onSelect }: { nodes: readonly CellNode[]; selectedId?: string; onSelect: (id: string) => void }) {
  function render(list: readonly CellNode[], depth: number): ReactNode {
    return list.map(node => node.group
      ? <div key={node.id} className={depth ? 'mt-2 flex flex-col gap-0.5' : 'mt-4 flex flex-col gap-0.5 first:mt-0'}>
        <div className={depth ? 'flex items-center justify-between px-2 py-1 text-xs text-muted-foreground' : 'flex items-center justify-between px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'}>
          <span>{/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(node.title) ? humanize(node.title) : node.title}</span><span className="tabular-nums">{leafCount(node)}</span>
        </div>
        {render(node.children, depth + 1)}
      </div>
      : <div key={node.id} className="flex flex-col gap-0.5">
        <Button variant={node.id === selectedId ? 'secondary' : 'ghost'} size="sm" className="w-full justify-start font-normal" aria-current={node.id === selectedId ? 'true' : undefined} onPress={() => onSelect(node.id)}>
          <span className="truncate">{cellTitle(node)}</span>
          {node.status === 'draft' && <Badge variant="outline" className="ml-auto">Draft</Badge>}
        </Button>
        {node.children.length > 0 && <div className="ml-3 border-l pl-2">{render(node.children, depth + 1)}</div>}
      </div>);
  }
  return <Card className="gap-0 py-0 lg:sticky lg:top-18">
    <CardHeader className="border-b py-3"><CardTitle className="text-sm">Explorer</CardTitle></CardHeader>
    <ScrollArea className="max-h-72 overflow-y-auto p-2 lg:max-h-[calc(100svh-10rem)]">
      <nav aria-label="Cells" className="flex flex-col">{render(nodes, 0)}</nav>
    </ScrollArea>
  </Card>;
}

function ModuleCard({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  const { toggle } = usePageModules();
  return <Card size="sm">
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
      <CardAction><Button variant="ghost" size="icon-xs" aria-label={`Close ${title}`} onPress={() => toggle(id)}><XIcon /></Button></CardAction>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>;
}

function Checks({ agent, detail, reports }: { agent: Agent; detail?: CellDetail; reports: readonly StudioReport[] }) {
  const relevant = reports.filter(report => !report.agent || report.agent === agent);
  const shown = detail ? presentText(detail.content) : undefined;
  const local: StudioReport[] = detail ? [
    { id: 'status', area: 'compile', severity: detail.status === 'active' ? 'info' : 'warning', title: detail.status === 'active' ? 'Cell is active' : 'Cell is a draft', detail: detail.status === 'active' ? 'This version is the one Studio and Producer use.' : 'Drafts are visible here but not yet relied on.' },
    ...(shown && shown.citations.length ? [{ id: 'citations', area: 'compile' as const, severity: 'info' as const, title: `${shown.citations.length} cited ${shown.citations.length === 1 ? 'source' : 'sources'}`, detail: 'Statements in this cell point at recorded evidence.' }] : []),
  ] : [];
  return <ReportList reports={[...local, ...relevant]} />;
}

function Needs({ detail, reports }: { detail?: CellDetail; reports: readonly StudioReport[] }) {
  const owner = detail ? presentText(detail.content).ownerInput : false;
  const items: StudioReport[] = [
    ...(owner ? [{ id: 'owner', area: 'compile' as const, severity: 'warning' as const, title: 'Awaiting owner input', detail: 'Some statements in this cell wait for a decision from the owner.' }] : []),
    ...reports.filter(report => report.severity !== 'info' && report.area !== 'compile'),
  ];
  return <ReportList reports={items} empty="Nothing is waiting on you." />;
}

function useSelection(index: AgentCells | undefined) {
  const params = useSearchParams();
  const requested = params.get('cell') ?? undefined;
  const tree = useMemo(() => { try { return index ? explorerTree(index) : []; } catch { return index ? index.cells.map(cell => ({ ...cell, children: [] })) : []; } }, [index]);
  const ordered = useMemo(() => leaves(tree), [tree]);
  const selected = ordered.find(cell => cell.id === requested) ?? ordered[0];
  return { tree, selected };
}

function AgentWorkspace({ agent, indexes, revision, reports }: { agent: Agent; indexes: AgentCells[]; revision: number; reports: readonly StudioReport[] }) {
  const router = useRouter();
  const { isOpen } = usePageModules();
  const index = indexes.find(entry => entry.agent === agent);
  const { tree, selected } = useSelection(index);
  const titles = useMemo(() => titleMap(indexes.flatMap(entry => entry.cells)), [indexes]);
  const [detail, setDetail] = useState<Resource<CellDetail>>({ state: 'loading' });
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetail({ state: 'loading' });
    loadCell(agent, selectedId, controller.signal).then(value => setDetail({ state: 'ready', value }), error => { if (!controller.signal.aborted) setDetail({ state: 'error', message: error instanceof Error ? error.message : 'The cell could not be loaded.' }); });
    return () => controller.abort();
  }, [agent, selectedId, revision]);
  const current = detail.state === 'ready' && detail.value.id === selectedId ? detail.value : undefined;
  const select = (id: string) => router.replace(`?cell=${encodeURIComponent(id)}`, { scroll: false });

  if (!index || index.state !== 'ready') return <div className="p-4 md:p-8"><Card><CardHeader><CardTitle>{AGENT_LABELS[agent]} cells are unavailable</CardTitle><CardDescription>{index?.error ?? 'Producer has no cells for this agent yet.'}</CardDescription></CardHeader></Card></div>;
  if (!selected) return <div className="p-4 md:p-8"><Card><CardHeader><CardTitle>No cells yet</CardTitle><CardDescription>{AGENT_LABELS[agent]} has not written any cells.</CardDescription></CardHeader></Card></div>;

  const explorerOpen = isOpen('explorer');
  const sideModules = [
    isOpen('checks') ? <ModuleCard key="checks" id="checks" title="Checks" description="What Producer verified."><Checks agent={agent} detail={current} reports={reports} /></ModuleCard> : null,
    isOpen('needs') ? <ModuleCard key="needs" id="needs" title="Needs" description="Open requests for the owner."><Needs detail={current} reports={reports.filter(report => !report.agent || report.agent === agent)} /></ModuleCard> : null,
  ].filter(Boolean);
  return <div className="flex flex-col">
    <PageHeader title={AGENT_LABELS[agent]} description={AGENT_PURPOSE[agent]}>
      <Badge variant="secondary" className="tabular-nums">{index.cells.length === 1 ? '1 cell' : `${index.cells.length} cells`}</Badge>
    </PageHeader>
    <div className={explorerOpen ? 'grid gap-6 p-4 md:p-8 lg:grid-cols-[16rem_minmax(0,1fr)]' : 'grid gap-6 p-4 md:p-8'}>
      {explorerOpen && <Explorer nodes={tree} selectedId={selected.id} onSelect={select} />}
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{cellTitle(selected)}</h2>
            <Badge variant="outline">v{selected.version}</Badge>
            {selected.status === 'draft' && <Badge variant="secondary">Draft</Badge>}
          </div>
          {agent === 'designer' && <p className="text-sm text-muted-foreground">{humanize(designerLayer(selected.id)).replace(/s$/, '')}</p>}
        </div>
        {sideModules.length > 0 && <div className="grid gap-4 xl:grid-cols-2">{sideModules}</div>}
        {detail.state === 'error' ? <Card><CardHeader><CardTitle>This cell could not be loaded</CardTitle><CardDescription>{detail.message}</CardDescription></CardHeader></Card>
          : current ? <AgentDetail agent={agent} index={index} detail={current} titles={titles} revision={revision} />
            : <div className="flex flex-col gap-3" role="status" aria-label="Loading cell"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>}
        {isOpen('source') && current && <ModuleCard id="source" title="Source" description="The cell exactly as the agent wrote it.">
          <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{current.content}</pre>
        </ModuleCard>}
      </div>
    </div>
  </div>;
}

function HomeOverview({ indexes, reports }: { indexes: Resource<AgentCells[]>; reports: Resource<StudioReport[]> }) {
  const { isOpen } = usePageModules();
  const list = reports.state === 'ready' ? reports.value : [];
  const needs = isOpen('needs');
  return <div className="flex flex-col">
    <PageHeader title="Home" description="Your agents and what they have written for this workspace." />
    <div className={needs ? 'grid gap-6 p-4 md:p-8 2xl:grid-cols-[minmax(0,1fr)_20rem]' : 'p-4 md:p-8'}>
      <section aria-labelledby="home-agents" className="flex flex-col gap-4">
        <h2 id="home-agents" className="text-base font-semibold tracking-tight">Agents</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {AGENTS.map(agent => {
            const index = indexes.state === 'ready' ? indexes.value.find(entry => entry.agent === agent) : undefined;
            const Icon = studioIcon(undefined, agent);
            const count = index?.cells.length ?? 0;
            return <Card key={agent}>
              <CardHeader>
                <div className="mb-1 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground"><Icon className="size-4" /></div>
                <CardTitle>{AGENT_LABELS[agent]}</CardTitle>
                <CardDescription>{AGENT_PURPOSE[agent]}</CardDescription>
                <CardAction>{indexes.state === 'loading' ? <Skeleton className="h-5 w-14" /> : <Badge variant={index?.state === 'ready' ? 'secondary' : 'outline'} className="tabular-nums">{index?.state === 'ready' ? (count === 1 ? '1 cell' : `${count} cells`) : 'Unavailable'}</Badge>}</CardAction>
              </CardHeader>
              <CardFooter><LinkButton variant="outline" size="sm" href={studioAgentHref(agent)}>Open {AGENT_LABELS[agent]}<ArrowRightIcon data-icon="inline-end" /></LinkButton></CardFooter>
            </Card>;
          })}
        </div>
      </section>
      {needs && <aside className="flex flex-col gap-4"><ModuleCard id="needs" title="Needs" description="Open requests for the owner."><Needs reports={list} /></ModuleCard></aside>}
    </div>
  </div>;
}

/** Every Studio page renders through the shell; agent pages add the cell explorer and detail. */
export function CellsWorkspace({ agent }: { agent?: Agent }) {
  const { cells, revision, reports } = useStudioData();
  const params = useSearchParams();
  const indexes = cells.state === 'ready' ? cells.value : [];
  const index = agent ? indexes.find(entry => entry.agent === agent) : undefined;
  const requested = params.get('cell');
  const trailCell = index?.cells.find(cell => cell.id === requested);
  const reportList = reports.state === 'ready' ? reports.value : [];
  let body: ReactNode;
  if (!agent) body = <HomeOverview indexes={cells} reports={reports} />;
  else if (cells.state === 'loading') body = <WorkspaceLoading title={AGENT_LABELS[agent]} />;
  else if (cells.state === 'error') body = <div className="p-4 md:p-8"><Card><CardHeader><CardTitle>Cells could not be loaded</CardTitle><CardDescription>{cells.message}</CardDescription></CardHeader></Card></div>;
  else body = <AgentWorkspace agent={agent} indexes={indexes} revision={revision} reports={reportList} />;
  return <StudioFrame {...(trailCell ? { trail: cellTitle(trailCell) } : {})}>{body}</StudioFrame>;
}

export function WorkspaceLoading({ title }: { title: string }) {
  return <div className="flex flex-col" role="status" aria-label={`Loading ${title}`}>
    <div className="flex flex-col gap-2 border-b px-4 py-6 md:px-8"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><Skeleton className="h-4 w-80 max-w-full" /></div>
    <div className="grid gap-6 p-4 md:p-8 lg:grid-cols-[16rem_minmax(0,1fr)]"><Skeleton className="h-72 w-full" /><div className="flex flex-col gap-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div></div>
  </div>;
}
