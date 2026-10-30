import type { ReactNode } from 'react';
import type { StudioModuleAction, StudioModuleNeed } from './studio-module-host';

/** Exact published PageFrameManifest structural port (Designer 1988bfd3). */
export interface StudioPageFrameManifest {
  id: string;
  breadcrumbs: readonly { id: string; label: string; href?: string }[];
  actions: readonly { id: string; label: string; icon: ReactNode; defaultOpen?: boolean; module: { sectionId: string; label: string; children: ReactNode; defaultExpanded?: boolean } }[];
}
export function studioPageManifest(input: {
  pageId: string;
  breadcrumbs: readonly { id?: string; label: string; href?: string }[];
  modules: readonly { action: StudioModuleAction; content?: ReactNode; need?: StudioModuleNeed }[];
  icon(asset: string): ReactNode;
  need(sectionId: string, reason: string): ReactNode;
}): StudioPageFrameManifest {
  return {
    id: input.pageId,
    breadcrumbs: input.breadcrumbs.map((crumb, index) => ({ ...crumb, id: crumb.id ?? `${input.pageId}:breadcrumb:${index}` })),
    actions: input.modules.map(({ action, content, need }) => ({
      id: action.id, label: action.label, icon: input.icon(action.icon), defaultOpen: action.defaultOpen,
      module: { sectionId: action.module.section, label: action.label, children: content ?? input.need(action.module.section, need?.code ?? 'The selected module content is unavailable.') },
    })),
  };
}
