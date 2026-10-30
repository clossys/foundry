'use client';
import { useSearchParams } from 'next/navigation';
import type { ContentMapNavigationNode } from '@clossys/publisher/content-map';
import { useStudioUI } from './StudioSelection';
import { useStudioApps } from './StudioApps';
import { StudioFrame } from './StudioFrame';
import { SourceDisclosure } from './SourceDisclosure';
import { studioPublicationHref, studioRoutes } from '../generated/studio-map';

function publicationTreeItems(nodes: readonly ContentMapNavigationNode[], publicationId: string, ui: ReturnType<typeof useStudioUI>) {
  const { NavigationTreeItem, NavigationTreeItemContent, Link } = ui;
  return nodes.map(node => <NavigationTreeItem key={node.id} id={node.id} textValue={node.label} href={node.href ? studioPublicationHref(publicationId, node.id) : undefined}>
    <NavigationTreeItemContent><Link variant="standalone">{node.label}</Link></NavigationTreeItemContent>
    {node.children ? publicationTreeItems(node.children, publicationId, ui) : null}
  </NavigationTreeItem>);
}

export function AppsWorkspace() {
  const ui = useStudioUI();
  const { ArticleBody, ContentSection, EmptyState, Link, NavigationTree, SectionFrame, SectionHeader } = ui;
  const apps = useStudioApps();
  const params = useSearchParams();
  const publicationId = params.get('publication');
  const publication = apps.state === 'ready' ? apps.publications.find(item => item.id === publicationId) : undefined;
  const entryId = params.get('entry') ?? publication?.entryId;
  const entry = publication?.map.entries.find(item => item.id === entryId);
  const route = studioRoutes.find(item => item.instanceId === 'apps')!;
  const breadcrumbs = publication && entryId ? publication.breadcrumbs[entryId]?.map(crumb => ({ id: `publication:${publication.id}:${crumb.id}`, label: crumb.label, ...(crumb.href ? { href: studioPublicationHref(publication.id, crumb.id) } : {}) })) : undefined;
  return <StudioFrame pageActionCapabilities={{ appDevServerUrl: publication?.target?.devServerUrl }} page={{ title: entry?.title ?? publication?.title ?? route.label, description: 'Read-only consumer app publications', ...(publication ? { breadcrumb: [{ id: 'apps', label: route.label, href: route.path }, { id: `publication:${publication.id}`, label: publication.title, href: studioPublicationHref(publication.id) }, ...(breadcrumbs ?? [])] } : {}) }}>
    <SectionFrame measure="wide">
      {apps.state === 'loading' ? <EmptyState role="status" title="Loading app publications…" /> : apps.state === 'error' ? <EmptyState role="alert" title="App publications unavailable" description={apps.message} /> : !apps.publications.length ? <EmptyState title="No app publications" description={apps.message ?? 'This repository has no app content maps.'} /> : publicationId && !publication ? <EmptyState role="alert" title="App publication unavailable" description="The selected app publication is no longer in this repository." /> : !publication ? <ContentSection>
        {apps.publications.map(item => <ContentSection key={item.id}><SectionHeader title={item.title} description={item.id} /><Link href={studioPublicationHref(item.id)}>Open {item.title}</Link></ContentSection>)}
      </ContentSection> : <ArticleBody aria-label="App publication" toc={publication.navigation ? <NavigationTree aria-label={`${publication.title} pages`} selectedRoute={entryId ? studioPublicationHref(publication.id, entryId) : undefined}>{publicationTreeItems(publication.navigation.tree, publication.id, ui)}</NavigationTree> : undefined}>
        {entryId && !entry ? <EmptyState role="alert" title="Publication entry unavailable" description="The selected entry is no longer in this content map." /> : <>
          <SectionHeader title={entry?.title ?? publication.title} description={entry?.description ?? `Content map · ${publication.format}`} />
          <SourceDisclosure key={`${publication.id}:${entryId ?? ''}`} source={JSON.stringify(entry ?? publication.map, null, 2)} />
        </>}
      </ArticleBody>}
    </SectionFrame>
  </StudioFrame>;
}
