'use client';

import { createContext, createElement, useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useStudioSelection } from './StudioSelection';
import { studioPageActions } from '../generated/studio-map';
import { STUDIO_PAGE_ACTION_EVENT, type StudioPageActionDetail } from '../lib/page-actions';
import { changeModuleState, moduleStates, selectedModuleSection, type StudioModuleAction, type StudioModuleNeed } from '../lib/studio-module-host';
import { studioModuleProps } from './studio-module-props';
import type { StudioModulePayloads } from '../lib/studio-module-data';

export interface StudioHostedModule { action: StudioModuleAction; open: boolean; collapsed: boolean; content?: ReactNode; need?: StudioModuleNeed; onToggle: () => void; onCollapsedChange: (collapsed: boolean) => void }
const StudioModulesContext = createContext<readonly StudioHostedModule[]>([]);
export function useStudioModules() { return useContext(StudioModulesContext); }

/** Module geometry and ghost action chrome belong to the selected frame, not this host. */
export function useStudioModuleHost(pageId: string, payloads: StudioModulePayloads): StudioHostedModule[] {
  const { selection, runtime } = useStudioSelection();
  const actions = (studioPageActions[pageId] ?? []).filter((action): action is StudioModuleAction => Boolean(action.module));
  const signature = JSON.stringify(actions);
  const [state, setState] = useState(() => moduleStates(actions));
  useEffect(() => {
    setState(moduleStates(actions));
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<StudioPageActionDetail>).detail;
      // Only the current actual manifest can choose a module; event fields cannot replace it.
      if (detail?.pageId === pageId && actions.some(action => action.id === detail.action?.id)) setState(current => changeModuleState(current, detail.action.id, 'toggle'));
    };
    window.addEventListener(STUDIO_PAGE_ACTION_EVENT, onAction);
    return () => window.removeEventListener(STUDIO_PAGE_ACTION_EVENT, onAction);
  }, [pageId, signature]);
  return actions.map(action => {
    const current = state[action.id] ?? { open: action.defaultOpen, collapsed: false };
    const payload = payloads[action.module.source ?? action.module.section];
    const props = payload ? studioModuleProps(action, payload, runtime.components) : undefined;
    const resolved = selectedModuleSection(action, selection.leaves, runtime.surfaces, props);
    return { action, ...current, ...(resolved.need ? { need: resolved.need } : {}),
      ...(resolved.component ? { content: createElement(resolved.component as ComponentType<Record<string, unknown>>, props) } : {}),
      onToggle: () => setState(current => changeModuleState(current, action.id, 'toggle')),
      onCollapsedChange: collapsed => setState(current => changeModuleState(current, action.id, collapsed ? 'collapse' : 'expand')),
    };
  });
}
export function StudioModulesProvider({ pageId, payloads, children }: { pageId: string; payloads: StudioModulePayloads; children: ReactNode }) {
  const modules = useStudioModuleHost(pageId, payloads);
  return <StudioModulesContext.Provider value={modules}>{children}</StudioModulesContext.Provider>;
}
