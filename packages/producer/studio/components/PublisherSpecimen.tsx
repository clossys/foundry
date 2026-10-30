'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AgentCells } from '../lib/cells-client';
import { loadPublication, PUBLISHER_DEVICES, PUBLISH_PREVIEW_COMMAND, publicationNavigation, publicationStatus, selectedPublicationId, selectedPublishedPage, type PublicationPage, type PublicationResponse, type PublicationTreeNode, type PublisherDevice } from '../lib/publisher-preview';
import { usePublisherPreviewUI } from '../lib/publisher-preview-ui';

type UI = ReturnType<typeof usePublisherPreviewUI>;
type Resource = { state: 'loading' } | { state: 'error'; message: string } | { state: 'loaded'; value: PublicationResponse };

function NotPublished({ ui, message }: { ui: UI; message?: string }) {
  const { EmptyState } = ui;
  return <EmptyState title="Not published yet" description={`${message ? `${message}. ` : ''}Run ${PUBLISH_PREVIEW_COMMAND} to create the publication preview.`} />;
}
function PublisherSelectionNeeds({ ui }: { ui: UI }) {
  const { selection, ContentSection, SectionHeader, Badge } = ui;
  const needs = selection.leaves.filter(leaf => leaf.source !== 'consumer');
  return needs.length ? <ContentSection aria-label="Publisher design system needs"><SectionHeader title="Design system selection" description="Planned defaults are used for seats not selected by this consumer." />{needs.map(leaf => <Badge key={leaf.leaf} variant="warning">NEED: {leaf.leaf}{leaf.fill ? ` · ${leaf.fill}` : ''}</Badge>)}</ContentSection> : null;
}

function PreviewMetadata({ ui, page, publication }: { ui: UI; page: PublicationPage; publication: string }) {
  const { Card, SectionHeader, Link, ContentSection } = ui;
  if (!Card) return <ui.EmptyState title="Selected cards unavailable" description="The selected Designer runtime does not expose its Card component." />;
  let image: string | undefined;
  if (page.ogImage) {
    if (/^https?:\/\//.test(page.ogImage)) image = page.ogImage;
    else if (!page.ogImage.includes('..') && !/[\\%?#:]/.test(page.ogImage)) image = `/preview/${encodeURIComponent(publication)}/assets/${page.ogImage.replace(/^\//, '')}`;
  }
  return <ContentSection aria-label={`Search and social previews for ${page.route}`}>
    <Card aria-label="Search preview">
      <SectionHeader eyebrow="Search preview" title={page.title ?? 'Title not provided'} description={page.description ?? 'Description not provided'} />
      <Link variant="standalone" href={page.previewUrl}>{page.route}</Link>
    </Card>
    <Card aria-label="Social preview">
      {image ? <img src={image} alt={page.title ? `${page.title} — social image` : 'Published social image'} style={{ maxWidth: '100%', height: 'auto' }} /> : null}
      <SectionHeader eyebrow="Social preview" title={page.title ?? 'Title not provided'} description={page.description ?? 'Description not provided'} />
      {!page.ogImage ? <SectionHeader description="Open Graph image not provided" /> : !image ? <SectionHeader description={`Open Graph image: ${page.ogImage}`} /> : null}
    </Card>
  </ContentSection>;
}

function treeItems(nodes: PublicationTreeNode[], ui: UI, selectedId?: string) {
  const { NavigationTreeItem, NavigationTreeItemContent, Link, Badge } = ui;
  return nodes.map(node => <NavigationTreeItem key={node.id} id={node.id} textValue={node.title} href={node.page ? `?agent=publisher&cell=${encodeURIComponent(node.page.cellId ?? selectedId ?? '')}&published=${encodeURIComponent(node.id)}` : undefined}>
    <NavigationTreeItemContent><Link variant="standalone">{node.title}</Link>{node.page ? <Badge>{node.page.emitted ? 'Emitted' : 'Not published yet'}</Badge> : null}</NavigationTreeItemContent>
    {treeItems(node.children, ui, selectedId)}
  </NavigationTreeItem>);
}
function expanded(nodes: PublicationTreeNode[]): string[] { return nodes.flatMap(node => [...(node.children.length ? [node.id] : []), ...expanded(node.children)]); }

function PublicationSitemap({ ui, value, selectedId }: { ui: UI; value: Extract<PublicationResponse, { state: 'ready' }>; selectedId?: string }) {
  const { ContentSection, SectionHeader, NavigationTree, EmptyState, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } = ui;
  let nodes: PublicationTreeNode[];
  try { nodes = publicationNavigation(value.manifest.contentMap.entries, value.pages); }
  catch { return <EmptyState title="Publication map unavailable" description="The emitted content map has an invalid hierarchy." />; }
  return <ContentSection>
    <SectionHeader title="Publication sitemap" description="Routes and status from the emitted publication descriptor." />
    {nodes.length ? <NavigationTree aria-label="Publication sitemap" defaultExpandedKeys={expanded(nodes)}>{treeItems(nodes, ui, selectedId)}</NavigationTree> : <EmptyState title="No published routes" description="The emitted content map has no entries." />}
    {Table && TableHeader && TableColumn && TableBody && TableRow && TableCell ? <Table aria-label="Publication status" selectionMode="none">
      <TableHeader>
        <TableColumn id="route" isRowHeader>Route</TableColumn><TableColumn id="indexing">Indexing</TableColumn><TableColumn id="sitemap">In sitemap</TableColumn><TableColumn id="published">Last published</TableColumn>
      </TableHeader>
      <TableBody>{value.pages.map(page => { const status = publicationStatus(page); return <TableRow key={page.id} id={page.id}><TableCell>{status.route}</TableCell><TableCell>{status.indexing}</TableCell><TableCell>{status.sitemap}</TableCell><TableCell>{status.published}</TableCell></TableRow>; })}</TableBody>
    </Table> : <EmptyState title="Selected table unavailable" description="The selected Designer runtime does not expose its Table component and parts." />}
    {value.pages.map(page => <PreviewMetadata key={page.id} ui={ui} page={page} publication={value.publication} />)}
  </ContentSection>;
}

/** A live specimen of emitted publication output; source disclosure belongs to the host. */
export function PublisherSpecimen({ index, selectedId }: { index: AgentCells; selectedId?: string }) {
  const params = useSearchParams();
  const ui = usePublisherPreviewUI();
  const { ContentSection, SectionHeader, EmptyState, Button, Badge } = ui;
  const [resource, setResource] = useState<Resource>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  const [device, setDevice] = useState<PublisherDevice>('desktop');
  const [routeId, setRouteId] = useState<string>();
  const publication = selectedPublicationId(index, selectedId);
  useEffect(() => {
    const controller = new AbortController(); setResource({ state: 'loading' });
    loadPublication(controller.signal, publication).then(value => setResource({ state: 'loaded', value }), error => { if (!controller.signal.aborted) setResource({ state: 'error', message: error instanceof Error ? error.message : 'Producer could not load the publication.' }); });
    return () => controller.abort();
  }, [index, publication, revision]);
  useEffect(() => { setRouteId(undefined); }, [selectedId]);
  if (resource.state === 'loading') return <EmptyState role="status" title="Loading publication…" />;
  if (resource.state === 'error') return <EmptyState role="alert" title="Publication unavailable" description={resource.message} />;
  const value = resource.value;
  if (value.state !== 'ready') return <ContentSection><PublisherSelectionNeeds ui={ui} /><NotPublished ui={ui} message={value.state === 'error' ? value.message : undefined} /></ContentSection>;
  const requested = params.get('published');
  const page = routeId === '__root' ? undefined : requested ? value.pages.find(page => page.id === requested) : selectedPublishedPage(index, selectedId, value.pages);
  const viewport = PUBLISHER_DEVICES[device];
  return <ContentSection aria-label="Publisher specimen">
    <PublisherSelectionNeeds ui={ui} />
    <SectionHeader title={page?.title ?? value.publication} eyebrow="Publication" description={page?.route ?? 'Emitted routes'} actions={Button ? <><Button onPress={() => setRevision(value => value + 1)}>Reload publication</Button>{page ? <Button onPress={() => setRouteId('__root')}>Publication sitemap</Button> : null}</> : undefined} />
    {page ? page.emitted ? <>
      <SectionHeader title="Page preview" description={`${viewport.label} · ${viewport.width} × ${viewport.height}`} stats={<Badge>Read-only preview</Badge>} actions={Button ? <ContentSection aria-label="Device viewport">{(Object.keys(PUBLISHER_DEVICES) as PublisherDevice[]).map(key => <Button key={key} aria-pressed={device === key} onPress={() => setDevice(key)}>{PUBLISHER_DEVICES[key].label}</Button>)}</ContentSection> : undefined} />
      <ContentSection aria-label={`${viewport.label} publication viewport`} style={{ overflowX: 'auto' }}>
        <iframe title={`${page.title ?? page.route} — ${viewport.label} preview`} src={page.previewUrl} sandbox="" referrerPolicy="no-referrer" width={viewport.width} height={viewport.height} style={{ width: viewport.width, minWidth: viewport.width, height: viewport.height, border: 0 }} />
      </ContentSection>
      <PreviewMetadata ui={ui} page={page} publication={value.publication} />
    </> : <NotPublished ui={ui} /> : <PublicationSitemap ui={ui} value={value} selectedId={selectedId} />}
  </ContentSection>;
}
