'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ComponentType, type ComponentProps, type ReactNode } from 'react';
import type { AppNavigationNode, CommandMenuGroup, PageBarPage } from '@clossys/designer/blocks';
import { SHELL_COPY_REFS } from '@clossys/designer/frames';
import type { ContentMapNavigationNode } from '@clossys/publisher/content-map';
import { useStudioUI } from './StudioSelection';
import { studioNavigation, studioCommands, studioBreadcrumbs, studioHome, studioPageActions, studioRouteForPath } from '../generated/studio-map';
import { useStudioAdminCopy } from './StudioShellCopy';
import { useStudioBrand } from './StudioBrand';
import { useStudioModules } from './StudioModuleHost';
import { studioPageManifest, type StudioPageFrameManifest } from '../lib/studio-page-manifest';
import { createStudioShellCopyResolver, studioShellThemeLabels, studioShellText, STUDIO_SHELL_FALLBACK } from '../lib/studio-shell-resolver';
import { studioPageActionItems } from '../lib/page-actions';

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
  const route = studioRouteForPath(pathname);
  const activeId = route?.instanceId ?? studioHome.id;
  const { AppFrame: SelectedAppFrame, Icon, EmptyState } = useStudioUI();
  const AppFrame = SelectedAppFrame as ComponentType<ComponentProps<typeof SelectedAppFrame> & { pageManifest?: StudioPageFrameManifest }>;
  const adminCopy = useStudioAdminCopy();
  const copyResolver = useMemo(() => createStudioShellCopyResolver(adminCopy.resolve), [adminCopy.resolve]);
  const preferenceLabels = useMemo(() => studioShellThemeLabels(copyResolver), [copyResolver]);
  const modules = useStudioModules();
  const projected = studioNavigation[activeId] ?? studioNavigation[studioHome.id];
  const destinations = useDestinations(projected.tree);
  const commands: CommandMenuGroup[] = studioCommands.map(group => ({ ...group, items: group.items.flatMap(item => item.href ? [{ id: item.id, label: item.label, description: item.description, href: item.href }] : []) }));
  const activeHref = pathname;
  const breadcrumb = studioBreadcrumbs[activeId];
  const pageManifest = studioPageManifest({ pageId: activeId, breadcrumbs: page.breadcrumb ?? breadcrumb, modules, icon: asset => <Icon asset={asset} decorative />, need: (sectionId, reason) => <EmptyState title={`NEED: ${sectionId}`} description={reason} /> });
  const moduleNeeds = modules.filter(module => module.open && module.need).map(module => ({ id: `module-need:${module.action.id}`, severity: 'warning' as const, text: `NEED: ${module.need!.sectionId}`, dismissible: false }));
  return <AppFrame
    pageManifest={pageManifest} copyResolver={copyResolver} theme={{ preferenceLabels }}
    brand={{ markSrc: '/studio-mark.svg', navigationMark: { label: 'Studio' } }}
    notices={[...moduleNeeds, ...(theme.source === 'foundry' ? [{ id: 'studio-unbranded', severity: 'warning' as const, text: `Unbranded: ${theme.message ?? 'No active consumer brand cells. Using the Foundry default theme.'}`, dismissible: false }] : theme.message ? [{ id: 'studio-theme-error', severity: 'warning' as const, text: theme.message, dismissible: false }] : [])]}
    navigation={{ tree: destinations, activeHref, navigationKey: activeHref, defaultCollapsed: false, label: studioShellText(copyResolver, SHELL_COPY_REFS.navigation.label), emptyMessage: studioShellText(copyResolver, SHELL_COPY_REFS.navigation.empty), openLabel: studioShellText(copyResolver, SHELL_COPY_REFS.frame.navigationOpen), closeLabel: studioShellText(copyResolver, SHELL_COPY_REFS.frame.navigationClose), formatDisclosureLabel: (name, expanded) => studioShellText(copyResolver, expanded ? SHELL_COPY_REFS.navigation.collapse : SHELL_COPY_REFS.navigation.expand, { name }) }}
    account={{ signedOutLabel: STUDIO_SHELL_FALLBACK.brand, sections: [] }} showAccount={false} themeControl={null}
    commands={{ heading: 'Navigate Studio', triggerLabel: 'Find a page', searchLabel: 'Search pages', closeLabel: 'Close search', emptyMessage: 'No matching pages', resultCountMessage: count => studioShellText(copyResolver, SHELL_COPY_REFS.commands.results, { count }), groups: commands }}
    skipLabel={studioShellText(copyResolver, SHELL_COPY_REFS.frame.skip)} breadcrumbLabel={studioShellText(copyResolver, SHELL_COPY_REFS.frame.breadcrumb)} collapsedBreadcrumbLabel={studioShellText(copyResolver, SHELL_COPY_REFS.frame.collapsedBreadcrumb)} pageInfoLabel={studioShellText(copyResolver, SHELL_COPY_REFS.frame.pageInfo)} pageActionsLabel={studioShellText(copyResolver, SHELL_COPY_REFS.frame.pageActions)}
    page={{ ...page, breadcrumb: page.breadcrumb ?? breadcrumb, actions: studioPageActionItems(activeId, studioPageActions[activeId] ?? [], asset => <Icon asset={asset} decorative />) }} root={{ label: 'Studio', href: studioHome.href }}
    fill="viewport" onNavigate={href => router.push(href)}
  >{children}</AppFrame>;
}
