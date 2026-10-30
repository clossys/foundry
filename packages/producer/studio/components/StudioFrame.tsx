'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { PageBarPage } from '@clossys/designer/blocks';
import { AppFrame } from '@clossys/designer/frames';
import { Icon } from '@clossys/designer/components';
import { Home, Users, Grid3x3 } from '@clossys/designer/icons';
import { AGENTS, AGENT_LABELS } from '../lib/agents';

const destinations = [
  { id: 'home', label: 'Home', href: '/', icon: <Icon glyph={Home} decorative /> },
  { id: 'agents', label: 'Agents', icon: <Icon glyph={Users} decorative />, children: AGENTS.map(agent => ({ id: agent, label: AGENT_LABELS[agent], href: `/agents/${agent}` })) },
  { id: 'apps', label: 'Apps', href: '/apps', icon: <Icon glyph={Grid3x3} decorative /> },
];

export function StudioFrame({ children, page }: { children: ReactNode; page: PageBarPage }) {
  const pathname = usePathname();
  const router = useRouter();
  return <AppFrame
    brand={{ markSrc: '/studio-mark.svg', navigationMark: { label: 'Clossys Studio' } }}
    navigation={{ tree: destinations, activeHref: pathname, navigationKey: pathname, defaultCollapsed: false, label: 'Studio navigation', emptyMessage: 'No pages available', openLabel: 'Open navigation', closeLabel: 'Close navigation', formatDisclosureLabel: (name, expanded) => `${expanded ? 'Collapse' : 'Expand'} ${name}` }}
    account={{ signedOutLabel: 'Local Studio', sections: [] }} showAccount={false} themeControl={null}
    commands={{ heading: 'Navigate Studio', triggerLabel: 'Find a page', searchLabel: 'Search pages', closeLabel: 'Close search', emptyMessage: 'No matching pages', resultCountMessage: count => `${count} pages`, groups: [{ id: 'pages', label: 'Pages', items: [{ id: 'home', label: 'Home', href: '/' }, ...AGENTS.map(agent => ({ id: agent, label: AGENT_LABELS[agent], href: `/agents/${agent}` })), { id: 'apps', label: 'Apps', href: '/apps' }] }] }}
    skipLabel="Skip to content" breadcrumbLabel="Breadcrumb" collapsedBreadcrumbLabel="More breadcrumb levels" pageInfoLabel="Page information" pageActionsLabel="More page actions"
    page={page} root={{ label: 'Studio', href: '/' }}
    fill="viewport" onNavigate={href => router.push(href)}
  >{children}</AppFrame>;
}
