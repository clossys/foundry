import type { StudioSelectionLeaf } from './selection-client';
import type { StudioPageAction } from '../generated/studio-map';

export type StudioModuleAction = Extract<StudioPageAction, { module: unknown }>;
export interface StudioModuleState { open: boolean; collapsed: boolean }
export interface StudioModuleNeed { code: 'missing-section' | 'missing-selected-export' | 'missing-payload'; sectionId: string; actionId: string }

/** The manifest owns the action identity, label, icon and initial state. */
export function moduleStates(actions: readonly StudioModuleAction[]): Record<string, StudioModuleState> {
  if (new Set(actions.map(action => action.id)).size !== actions.length) throw new Error('Repeated module action identity.');
  return Object.fromEntries(actions.map(action => [action.id, { open: action.defaultOpen, collapsed: false }]));
}
export function changeModuleState(state: Readonly<Record<string, StudioModuleState>>, actionId: string, change: 'toggle' | 'collapse' | 'expand'): Record<string, StudioModuleState> {
  const current = state[actionId];
  if (!current) throw new Error('The module action is not in the page manifest.');
  return { ...state, [actionId]: change === 'toggle' ? { ...current, open: !current.open } : { ...current, collapsed: change === 'collapse' } };
}

/** Surface compiler canonical export spelling; no leaf aliases or default kit imports. */
export function selectedModuleSection(action: StudioModuleAction, leaves: readonly StudioSelectionLeaf[], surfaces: Readonly<Record<string, unknown>>, payload: unknown): { component?: unknown; need?: StudioModuleNeed } {
  const selected = leaves.find(leaf => leaf.leaf === action.module.section);
  if (!/^sections\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(action.module.section) || !selected?.fill || selected.source === 'unavailable') return { need: { code: 'missing-section', sectionId: action.module.section, actionId: action.id } };
  const name = action.module.section.slice('sections.'.length).split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join('');
  const component = surfaces[name];
  if (!component || !['function', 'object'].includes(typeof component)) return { need: { code: 'missing-selected-export', sectionId: action.module.section, actionId: action.id } };
  if (!payload || typeof payload !== 'object') return { need: { code: 'missing-payload', sectionId: action.module.section, actionId: action.id } };
  return { component };
}
