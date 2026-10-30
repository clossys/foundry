import { createElement, type ComponentType } from 'react';
import type { StudioModuleAction } from '../lib/studio-module-host';
import type { StudioModulePayload } from '../lib/studio-module-data';
import type { StudioIAOutline } from '../lib/studio-agent-ia';

const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
const valueText = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(valueText).filter(Boolean).join(', ') : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${key}: ${valueText(item)}`).join('; ') : '';

/** Adapt semantic data to the existing closed section APIs. Never pass data models as JSX props. */
export function studioModuleProps(action: StudioModuleAction, payload: StudioModulePayload, components: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (action.module.section === 'sections.explorer') {
    const tree = (payload.tree ?? []) as StudioIAOutline[];
    const expanded = (nodes: StudioIAOutline[]): string[] => nodes.flatMap(node => node.children ? [node.id, ...expanded(node.children)] : []);
    return { label: action.label, tree, selectedId: payload.selectedId, defaultExpandedIds: expanded(tree), ...(typeof payload.onSelect === 'function' ? { onSelect: payload.onSelect } : {}) };
  }
  if (action.module.section === 'sections.record-detail') {
    const cell = payload.cell && typeof payload.cell === 'object' ? payload.cell as Record<string, unknown> : undefined;
    const facts = cell ? Object.entries(cell).filter(([key]) => !['href', 'contentHref', 'contentTarget', 'contentRel', 'title'].includes(key)) : [];
    const roleFacts = payload.roleFacts && typeof payload.roleFacts === 'object' ? Object.entries(payload.roleFacts) : [];
    return { title: cell?.title ?? action.label, fields: [...facts, ...roleFacts].map(([label, value]) => ({ label, value: valueText(value) })) };
  }
  if (action.module.section === 'sections.content') {
    const SemanticContent = components.SemanticContent;
    if (!SemanticContent || !['function', 'object'].includes(typeof SemanticContent)) return undefined;
    return { heading: action.label, children: createElement(SemanticContent as ComponentType<Record<string, unknown>>, { as: 'code', 'data-studio-source': '', 'aria-readonly': true }, typeof payload.source === 'string' ? payload.source : '') };
  }
  if (action.module.section === 'sections.status-list') return {
    heading: action.label,
    labels: { available: 'Available', partial: 'Partial', planned: 'Planned', dispositions: { 'not-offered': 'Unavailable' } },
    legendLabel: action.label,
    items: records(payload.results).map(result => ({ id: `${result.agent}:${result.verb}`, label: `${result.agent}: ${result.verb}`, detail: `${result.message} (exit ${result.exitCode})`, disposition: 'not-offered' })),
    ...(payload.state !== 'ready' ? { description: valueText(payload.error) || valueText(payload.state) } : {}),
  };
  if (action.module.section === 'sections.task-list') {
    const items = records(payload.gaps).map(gap => ({ id: valueText(gap.leaf), title: valueText(gap.leaf), description: valueText(gap.message), status: 'blocked' }));
    return { 'aria-label': action.label, items, statusLabels: { todo: 'Open', 'in-progress': 'In progress', blocked: 'Blocked', done: 'Done' }, progressText: `0 of ${items.length} resolved`, emptyState: { title: action.label, description: 'No unresolved selection needs were reported.' } };
  }
  return undefined;
}
