'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AppNavigationNode, CommandMenuGroup, PageBarPage } from '@clossys/designer/blocks';
import type { ContentMapNavigationNode } from '@clossys/publisher/content-map';
import { useStudioSelection, useStudioUI } from './StudioSelection';
import { studioNavigation, studioCommands, studioBreadcrumbs, studioHome, studioPublicationHref, studioRouteForPath } from '../generated/studio-map';
import { useStudioApps } from './StudioApps';
import { useStudioBrand } from './StudioBrand';

/** Bind projected identities to the selected Designer icon renderer. */
function useDestinations(nodes: readonly ContentMapNavigationNode[]): AppNavigationNode[] {
  const { Icon } = useStudioUI();
  return nodes.map(node => {
    const identity = { id: node.id, label: node.label, ...(node.icon ? { icon: <Icon asset={node.icon} decorative /> } : {}) };
    if (node.children?.length) {
      const children = node.children.map(child => {
        if (!child.href || child.children?.length) throw new Error('The selected Studio frame requires a two-level navigation projection.');
        return { id: child.id, label: child.label, href: child.href, ...(child.icon ? { icon: <Icon asset={child.icon} decorative /> } : {}) };
      });
      return node.href ? { ...identity, href: node.href, children } : { ...identity, children };
    }
    if (!node.href) throw new Error('A projected Studio navigation leaf has no destination.');
    return { ...identity, href: node.href };
  });
}

export function StudioFrame({ children, page }: { children: ReactNode; page: PageBarPage }) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useStudioBrand();
  const params = useSearchParams();
  const apps = useStudioApps();
  const route = studioRouteForPath(pathname);
  const activeId = route?.instanceId ?? studioHome.id;
  const publications = apps.state === 'ready' ? apps.publications : [];
  const { AppFrame } = useStudioUI();
  const { selection } = useStudioSelection();
  const projected = studioNavigation[activeId] ?? studioNavigation[studioHome.id];
  const destinations = useDestinations(projected.tree.map(node => node.id === 'apps' && publications.length ? { ...node, children: publications.map(publication => ({ id: `publication:${publication.id}`, label: publication.title, href: studioPublicationHref(publication.id) })) } : node));
  const commands: CommandMenuGroup[] = [
    ...studioCommands.map(group => ({ ...group, items: group.items.flatMap(item => item.href ? [{ id: item.id, label: item.label, description: item.description, href: item.href }] : []) })),
    ...publications.flatMap(publication => publication.commands.map(group => ({ id: `publication:${publication.id}:${group.id}`, label: `${publication.title} · ${group.label}`, items: group.items.flatMap(item => item.href ? [{ id: `publication:${publication.id}:${item.id}`, label: item.label, description: item.description, href: studioPublicationHref(publication.id, item.id) }] : []) }))),
  ];
  const publicationId = activeId === 'apps' ? params.get('publication') : null;
  const activeHref = publicationId ? studioPublicationHref(publicationId) : pathname;
  const breadcrumb = studioBreadcrumbs[activeId];
  const missing = activeId === 'designer' ? selection.leaves.filter(leaf => leaf.source !== 'consumer') : [];
  const needs = missing.length ? [{ id: 'designer-needs', severity: 'warning' as const, text: `NEED: ${missing.length} consumer Designer selections are missing. Designer defaults are active; review the selection gaps on this page.`, dismissible: false }] : [];
  return <AppFrame
    brand={{ markSrc: '/studio-mark.svg', navigationMark: { label: 'Studio' } }}
    notices={[...needs, ...(theme.source === 'foundry' ? [{ id: 'studio-unbranded', severity: 'warning' as const, text: `Unbranded: ${theme.message ?? 'No active consumer brand cells. Using the Foundry default theme.'}`, dismissible: false }] : theme.message ? [{ id: 'studio-theme-error', severity: 'warning' as const, text: theme.message, dismissible: false }] : [])]}
    navigation={{ tree: destinations, activeHref, navigationKey: activeHref, defaultCollapsed: false, label: 'Studio navigation', emptyMessage: 'No pages available', openLabel: 'Open navigation', closeLabel: 'Close navigation', formatDisclosureLabel: (name, expanded) => `${expanded ? 'Collapse' : 'Expand'} ${name}` }}
    account={{ signedOutLabel: 'Local Studio', sections: [] }} showAccount={false} themeControl={null}
    commands={{ heading: 'Navigate Studio', triggerLabel: 'Find a page', searchLabel: 'Search pages', closeLabel: 'Close search', emptyMessage: 'No matching pages', resultCountMessage: count => `${count} pages`, groups: commands }}
    skipLabel="Skip to content" breadcrumbLabel="Breadcrumb" collapsedBreadcrumbLabel="More breadcrumb levels" pageInfoLabel="Page information" pageActionsLabel="More page actions"
    page={{ ...page, breadcrumb: page.breadcrumb ?? breadcrumb }} root={{ label: 'Studio', href: studioHome.href }}
    fill="viewport" onNavigate={href => router.push(href)}
  >{children}</AppFrame>;
}
