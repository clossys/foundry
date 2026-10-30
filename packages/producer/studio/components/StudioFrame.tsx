'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { PageBarPage } from '@clossys/designer/blocks';
import { useStudioSelection, useStudioUI } from './StudioSelection';
import { AGENTS, AGENT_LABELS } from '../lib/agents';
import { useStudioBrand } from './StudioBrand';

function useDestinations() {
  const { Icon } = useStudioUI();
  return [
  { id: 'home', label: 'Home', href: '/', icon: <Icon asset="assets.icon-home" decorative /> },
  { id: 'agents', label: 'Agents', icon: <Icon asset="assets.icon-team" decorative />, children: AGENTS.map(agent => ({ id: agent, label: AGENT_LABELS[agent], href: `/agents/${agent}` })) },
  { id: 'apps', label: 'Apps', href: '/apps', icon: <Icon asset="assets.icon-grid-view" decorative /> },
  ];
}

export function StudioFrame({ children, page }: { children: ReactNode; page: PageBarPage }) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useStudioBrand();
  const { AppFrame } = useStudioUI();
  const { selection } = useStudioSelection();
  const destinations = useDestinations();
  const missing = pathname === '/agents/designer' ? selection.leaves.filter(leaf => leaf.source !== 'consumer') : [];
  const needs = missing.length ? [{ id: 'designer-needs', severity: 'warning' as const, text: `NEED: ${missing.length} consumer Designer selections are missing. Designer defaults are active; review the selection gaps on this page.`, dismissible: false }] : [];
  return <AppFrame
    brand={{ markSrc: '/studio-mark.svg', navigationMark: { label: 'Studio' } }}
    notices={[...needs, ...(theme.source === 'foundry' ? [{ id: 'studio-unbranded', severity: 'warning' as const, text: `Unbranded: ${theme.message ?? 'No active consumer brand cells. Using the Foundry default theme.'}`, dismissible: false }] : theme.message ? [{ id: 'studio-theme-error', severity: 'warning' as const, text: theme.message, dismissible: false }] : [])]}
    navigation={{ tree: destinations, activeHref: pathname, navigationKey: pathname, defaultCollapsed: false, label: 'Studio navigation', emptyMessage: 'No pages available', openLabel: 'Open navigation', closeLabel: 'Close navigation', formatDisclosureLabel: (name, expanded) => `${expanded ? 'Collapse' : 'Expand'} ${name}` }}
    account={{ signedOutLabel: 'Local Studio', sections: [] }} showAccount={false} themeControl={null}
    commands={{ heading: 'Navigate Studio', triggerLabel: 'Find a page', searchLabel: 'Search pages', closeLabel: 'Close search', emptyMessage: 'No matching pages', resultCountMessage: count => `${count} pages`, groups: [{ id: 'pages', label: 'Pages', items: [{ id: 'home', label: 'Home', href: '/' }, ...AGENTS.map(agent => ({ id: agent, label: AGENT_LABELS[agent], href: `/agents/${agent}` })), { id: 'apps', label: 'Apps', href: '/apps' }] }] }}
    skipLabel="Skip to content" breadcrumbLabel="Breadcrumb" collapsedBreadcrumbLabel="More breadcrumb levels" pageInfoLabel="Page information" pageActionsLabel="More page actions"
    page={page} root={{ label: 'Studio', href: '/' }}
    fill="viewport" onNavigate={href => router.push(href)}
  >{children}</AppFrame>;
}
