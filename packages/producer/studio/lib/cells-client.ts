import { isAgent, type Agent } from './agents';

export interface CellSummary { id: string; title: string; parent?: string }
export interface AgentCells { agent: Agent; cells: CellSummary[]; tree: unknown; state?: string; error?: string }
export interface CellDetail { agent: Agent; id: string; content: string }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** This adapter accepts Producer's HTTP response only; it never reads cell files. */
export function parseCellsResponse(value: unknown): AgentCells[] {
  if (!object(value) || !Array.isArray(value.agents)) throw new Error('The cell index response is invalid.');
  return value.agents.map((entry: unknown) => {
    if (!object(entry) || typeof entry.agent !== 'string' || !isAgent(entry.agent) || !Array.isArray(entry.cells)) throw new Error('The agent cell index is invalid.');
    const cells = entry.cells.map((cell: unknown) => {
      if (!object(cell) || typeof cell.id !== 'string' || !cell.id || cell.parent !== undefined && typeof cell.parent !== 'string') throw new Error('A cell in the index is invalid.');
      return { id: cell.id, title: typeof cell.title === 'string' && cell.title ? cell.title : cell.id, ...(typeof cell.parent === 'string' ? { parent: cell.parent } : {}) };
    });
    if (new Set(cells.map(cell => cell.id)).size !== cells.length) throw new Error('The cell index contains duplicate IDs.');
    const error = typeof entry.error === 'string' ? entry.error : object(entry.error) && typeof entry.error.message === 'string' ? entry.error.message : undefined;
    return { agent: entry.agent, cells, tree: entry.tree, ...(typeof entry.state === 'string' ? { state: entry.state } : {}), ...(error ? { error } : {}) };
  });
}

export function parseCellResponse(value: unknown, agent: Agent, id: string): CellDetail {
  if (!object(value) || value.agent !== agent || value.id !== id || typeof value.content !== 'string') throw new Error('The selected cell response is invalid.');
  return { agent, id, content: value.content };
}

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'The requested cell is no longer available.' : `Producer could not load cells (${response.status}).`);
  return response.json();
}
export async function loadCells(signal: AbortSignal): Promise<AgentCells[]> { return parseCellsResponse(await request('/api/cells', signal)); }
export async function loadCell(agent: Agent, id: string, signal: AbortSignal): Promise<CellDetail> {
  return parseCellResponse(await request(`/api/cells/${encodeURIComponent(agent)}/${encodeURIComponent(id)}`, signal), agent, id);
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
