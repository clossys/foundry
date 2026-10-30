import { projectStudioAgentIA, studioIAHref } from './studio-agent-ia';
import { type AgentCells, type CellDetail, type CellSummary } from './cells-client';
import { cellContentHref } from './cell-content';
import { isAgent, type Agent } from './agents';
import type { StudioSelection } from './selection-client';
import { studioAgentHref } from '../generated/studio-map';
import { directorStudioCell } from './director-studio-copy';

export type StudioModulePayload = Record<string, unknown>;
export type StudioModulePayloads = Readonly<Record<string, StudioModulePayload>>;
export interface StudioCheckResult { agent: Agent; verb: string; state: 'unavailable' | 'error'; exitCode: number; message: string }
export interface StudioChecks { state: 'ready' | 'loading' | 'error'; results: StudioCheckResult[]; error?: string }
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function cellRef(reference: string, agent: Agent) {
  const match = /^(?:(director|designer|writer|publisher):)?([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2})@([1-9]\d*)$/.exec(reference);
  if (!match) return undefined;
  const owner = (match[1] ?? agent) as Agent;
  return { agent: owner, id: match[2]!, version: Number(match[3]), reference };
}
function linkedCell(cell: CellSummary, agent: Agent) {
  const display = agent === 'director' ? directorStudioCell(cell) : cell;
  return { agent, id: cell.id, version: cell.version, status: cell.status, title: agent === 'director' ? display.title : typeof cell.fields?.title === 'string' ? cell.fields.title : cell.id.split('.').at(-1), ...(display.directorLabel ? { directorLabel: display.directorLabel } : {}), href: `${studioAgentHref(agent)}${studioIAHref(cell.id)}`, contentHref: cellContentHref(agent, cell.id), contentTarget: '_blank', contentRel: 'noopener noreferrer' };
}

/** Only stored facts and resolvable cell references become module data. */
export function studioModulePayloads(input: { indexes: readonly AgentCells[]; agent?: Agent; selectedId?: string; detail?: CellDetail; selection: StudioSelection; checks: StudioChecks }): StudioModulePayloads {
  const index = input.indexes.find(index => index.agent === input.agent);
  const cell = input.detail && input.detail.agent === input.agent && input.detail.id === input.selectedId ? input.detail : undefined;
  const links = strings(cell?.fields?.links);
  const uses = links.flatMap(reference => {
    const ref = cell && cellRef(reference, cell.agent);
    const target = ref && input.indexes.find(index => index.agent === ref.agent)?.cells.find(candidate => candidate.id === ref.id);
    return ref ? [{ ...ref, ...(target ? { href: linkedCell(target, ref.agent).href } : {}) }] : [{ reference }];
  });
  const usedBy = cell ? input.indexes.flatMap(index => index.cells.filter(candidate => strings(candidate.fields?.links).some(reference => {
    const ref = cellRef(reference, index.agent);
    return ref?.agent === cell.agent && ref.id === cell.id && ref.version === cell.version;
  })).map(candidate => linkedCell(candidate, index.agent))) : [];
  const ia = index ? projectStudioAgentIA(index) : undefined;
  const inspector = { state: cell ? 'ready' : 'missing', ...(cell ? { cell: { ...linkedCell(cell, cell.agent), ...(typeof cell.fields?.updated === 'string' ? { updated: cell.fields.updated } : {}), ...(typeof cell.fields?.created === 'string' ? { created: cell.fields.created } : {}), sources: strings(cell.fields?.cites), feeds: strings(cell.fields?.feeds), uses, usedBy } } : {}) };
  const needs = selectionNeedData(input.selection);
  return {
    'sections.explorer': { agent: input.agent, state: ia?.state ?? 'missing', tree: ia?.tree ?? [], selectedId: input.selectedId, ...(ia?.error ? { error: ia.error } : {}) },
    'sections.record-detail': inspector,
    ...(input.agent ? { [`${input.agent}.inspector`]: inspector } : {}),
    'sections.content': { state: cell ? 'ready' : 'missing', readOnly: true, ...(cell ? { source: cell.content, id: cell.id, version: cell.version } : {}) },
    'sections.status-list': { ...input.checks },
    'sections.task-list': needs,
    [`${input.agent ?? 'home'}.open-requests`]: needs,
  };
}

export function selectionNeedData(selection: StudioSelection): StudioModulePayload { return { gaps: selection.leaves.filter(leaf => leaf.source !== 'consumer') }; }

export { cellContentHref as studioCellContentHref } from './cell-content';
export function studioCellChange(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('reload' in value) || value.reload !== true) return false;
  const row = value as Record<string, unknown>;
  return (row.agent === null || typeof row.agent === 'string' && isAgent(row.agent)) && (row.id === null || typeof row.id === 'string');
}
