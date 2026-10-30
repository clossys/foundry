'use client';

import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useStudioSelection } from './StudioSelection';
import { changeModuleState, moduleStates, selectedModuleSection, type StudioModuleAction, type StudioModuleNeed } from '../lib/studio-module-host';
import type { StudioModulePayloads } from '../lib/studio-module-data';

export interface StudioHostedModule { action: StudioModuleAction; open: boolean; collapsed: boolean; content?: ReactNode; need?: StudioModuleNeed; onToggle: () => void; onCollapsedChange: (collapsed: boolean) => void }
/** Module geometry and ghost action chrome belong to the selected frame, not this host. */
export function useStudioModuleHost(actions: readonly StudioModuleAction[], payloads: StudioModulePayloads): StudioHostedModule[] {
  const { selection, runtime } = useStudioSelection();
  const signature = JSON.stringify(actions);
  const [state, setState] = useState(() => moduleStates(actions));
  useEffect(() => setState(moduleStates(actions)), [signature]);
  return actions.map(action => {
    const current = state[action.id] ?? { open: action.defaultOpen, collapsed: false };
    const payload = payloads[action.module];
    const resolved = selectedModuleSection(action, selection.leaves, runtime.surfaces, payload);
    return { action, ...current, ...(resolved.need ? { need: resolved.need } : {}),
      ...(resolved.component && current.open && !current.collapsed ? { content: createElement(resolved.component as ComponentType<Record<string, unknown>>, payload) } : {}),
      onToggle: () => setState(current => changeModuleState(current, action.id, 'toggle')),
      onCollapsedChange: collapsed => setState(current => changeModuleState(current, action.id, collapsed ? 'collapse' : 'expand')),
    };
  });
}
