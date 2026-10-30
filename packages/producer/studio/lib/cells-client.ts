import { isAgent, type Agent } from './agents';
import type { DirectorLabelResult } from './director-copy-bindings';
import { directorStudioCell } from './director-studio-copy';
import type { DirectorInspectAction } from './director-studio-copy';

export interface CellSummary { id: string; title: string; directorLabel?: DirectorLabelResult; directorInspectAction?: DirectorInspectAction; parent?: string; version?: number; status?: 'draft' | 'active' | 'retired'; path?: string; fields?: Record<string, unknown> }
export type CellContentScope = { kind: 'cell'; cellId: string } | { kind: 'version'; cellId: string; version: number };
export interface AgentCells { contentScope?: CellContentScope; agent: Agent; cells: CellSummary[]; tree?: Record<string, unknown>; state: 'ready' | 'missing' | 'error'; error?: string }
export interface CellDetail extends CellSummary { agent: Agent; content: string }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function summary(value: unknown, agent: Agent): CellSummary {
  if (!object(value) || typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !['draft', 'active', 'retired'].includes(String(value.status)) || typeof value.path !== 'string' || !object(value.fields)) throw new Error('A cell in the response is invalid.');
  const cell: CellSummary = { id: value.id, title: typeof value.fields.title === 'string' && value.fields.title ? value.fields.title : value.id.split('.').at(-1)!, version: Number(value.version), status: value.status as 'draft' | 'active' | 'retired', path: value.path, fields: value.fields };
  return agent === 'director' ? directorStudioCell(cell) : cell;
}


/** This adapter accepts Producer's HTTP response only; it never reads cell files. */
export function parseCellsResponse(value: unknown): AgentCells[] {
  if (!object(value) || !Array.isArray(value.agents)) throw new Error('The cell index response is invalid.');
  return value.agents.map((entry: unknown) => {
    if (!object(entry) || typeof entry.agent !== 'string' || !isAgent(entry.agent) || !['ready', 'missing', 'error'].includes(String(entry.state)) || !Array.isArray(entry.cells) || entry.tree !== undefined && !object(entry.tree)) throw new Error('The agent cell index is invalid.');
    const cells = entry.cells.map(cell => summary(cell, entry.agent as Agent));
    if (new Set(cells.map(cell => cell.id)).size !== cells.length) throw new Error('The cell index contains duplicate IDs.');
    const error = entry.state === 'error' ? typeof entry.message === 'string' ? entry.message : 'Producer could not read this agent’s cells.' : undefined;
    return { agent: entry.agent, cells, tree: entry.tree as Record<string, unknown> | undefined, state: entry.state as AgentCells['state'], ...(error ? { error } : {}) };
  });
}

export function parseCellResponse(value: unknown, agent: Agent, id: string): CellDetail {
  if (!object(value) || value.agent !== agent || value.state !== 'ready' || !object(value.cell)) throw new Error('The selected cell response is invalid.');
  const cell = value.cell;
  if (cell.id !== id || typeof cell.source !== 'string') throw new Error('The selected cell response is invalid.');
  return { ...summary(cell, agent), agent, content: cell.source };
}

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'Producer could not find the requested cell resource.' : `Producer could not load cells (${response.status}).`);
  return response.json();
}
export async function loadCells(signal: AbortSignal): Promise<AgentCells[]> { return parseCellsResponse(await request('/api/cells', signal)); }
export async function loadCell(agent: Agent, id: string, signal: AbortSignal, version?: number): Promise<CellDetail> {
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new Error('The requested cell version is invalid.');
  const query = version === undefined ? '' : `?version=${version}`;
  const detail = parseCellResponse(await request(`/api/cells/${encodeURIComponent(agent)}/${encodeURIComponent(id)}${query}`, signal), agent, id);
  if (version !== undefined && detail.version !== version) throw new Error('Producer returned a different cell version.');
  return detail;
}

export interface CellNode extends CellSummary { group?: boolean; children: CellNode[] }
/** Validate parent links before nesting so a malformed index becomes an honest error. */
export function cellHierarchy(cells: readonly CellSummary[], tree?: unknown): CellNode[] {
  if (object(tree) && tree.tree !== undefined) {
    const placed = new Set<string>();
    const groups = new Set<string>();
    const known = new Map(cells.map(cell => [cell.id, cell]));
    function groupNodes(value: unknown, depth = 0): CellNode[] {
      if (!Array.isArray(value) || depth > 20) throw new Error('The cell grouping is invalid.');
      return value.map((entry: unknown) => {
        if (!object(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string' || groups.has(entry.id) || known.has(entry.id)) throw new Error('A cell group is invalid.');
        groups.add(entry.id);
        if (entry.cells !== undefined && !Array.isArray(entry.cells)) throw new Error('A cell group has invalid members.');
        const children: CellNode[] = entry.children === undefined ? [] : groupNodes(entry.children, depth + 1);
        for (const id of (entry.cells ?? []) as unknown[]) {
          if (typeof id !== 'string' || !known.has(id) || placed.has(id)) throw new Error('A cell group refers to an unavailable or repeated cell.');
          placed.add(id);
          children.push({ ...known.get(id)!, children: [] });
        }
        return { id: entry.id, title: entry.name, group: true, children };
      });
    }
    const roots = groupNodes(tree.tree);
    if (placed.size !== cells.length) throw new Error('The cell grouping does not place every cell.');
    return roots;
  }

  const nodes = new Map(cells.map(cell => [cell.id, { ...cell, children: [] } as CellNode]));
  const roots: CellNode[] = [];
  for (const cell of cells) {
    const seen = new Set([cell.id]);
    let parent = cell.parent;
    while (parent !== undefined) {
      if (seen.has(parent)) throw new Error('The cell tree contains a cycle.');
      seen.add(parent);
      const ancestor = nodes.get(parent);
      if (!ancestor) throw new Error('The cell tree refers to an unavailable parent.');
      parent = ancestor.parent;
    }
    const node = nodes.get(cell.id)!;
    if (cell.parent !== undefined) nodes.get(cell.parent)!.children.push(node); else roots.push(node);
  }
  return roots;
}
