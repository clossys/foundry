import { cellHierarchy, type AgentCells, type CellDetail, type CellSummary } from './cells-client';
import type { Agent } from './agents';
import type { StudioSelection } from './selection-client';
import { studioAgentHref } from '../generated/studio-map';

export type StudioModulePayload = Record<string, unknown>;
export type StudioModulePayloads = Readonly<Record<string, StudioModulePayload>>;
export interface StudioActivity { kind: 'ready' | 'change'; agent: Agent | null; id: string | null; receivedAt: string }
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
  return { agent, id: cell.id, version: cell.version, status: cell.status, title: typeof cell.fields?.title === 'string' ? cell.fields.title : cell.id.split('.').at(-1), href: `${studioAgentHref(agent)}?${new URLSearchParams({ agent, cell: cell.id })}` };
}

/** Only stored facts and resolvable cell references become module data. */
export function studioModulePayloads(input: { indexes: readonly AgentCells[]; agent?: Agent; selectedId?: string; detail?: CellDetail; selection: StudioSelection; activity: readonly StudioActivity[]; connected: boolean; checks: StudioChecks }): StudioModulePayloads {
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
  let tree: ReturnType<typeof cellHierarchy> = [];
  let treeError: string | undefined;
  try { if (index) tree = cellHierarchy(index.cells, index.tree); } catch (error) { treeError = error instanceof Error ? error.message : String(error); }
  return {
    'sections.cell-explorer': { agent: input.agent, state: index?.state ?? 'missing', tree, selectedId: input.selectedId, ...(treeError ? { error: treeError } : {}), ...(index?.error ? { error: index.error } : {}) },
    'sections.cell-details': { state: cell ? 'ready' : 'missing', ...(cell ? { cell: { ...linkedCell(cell, cell.agent), ...(typeof cell.fields?.updated === 'string' ? { updated: cell.fields.updated } : {}), ...(typeof cell.fields?.created === 'string' ? { created: cell.fields.created } : {}), sources: strings(cell.fields?.cites), feeds: strings(cell.fields?.feeds), uses, usedBy } } : {}) },
    'sections.source-view': { state: cell ? 'ready' : 'missing', readOnly: true, ...(cell ? { source: cell.content, id: cell.id, version: cell.version } : {}) },
    'sections.check-findings': { ...input.checks },
    'sections.activity-feed': { connected: input.connected, events: input.activity },
  };
}

/** An SSE event records receipt, never an invented write or successful check. */
export function appendStudioActivity(previous: readonly StudioActivity[], event: StudioActivity): StudioActivity[] { return [...previous, event].slice(-100); }

export function selectionNeedData(selection: StudioSelection): StudioModulePayload { return { gaps: selection.leaves.filter(leaf => leaf.source !== 'consumer') }; }
