import type { AgentCells, CellDetail } from './cells-client';
import { isAgent, type Agent } from './agents';

export interface CellContentOptions { version?: number }
const CELL_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2}$/;
/** Content targets are internal resources, never caller-supplied navigation URLs. */
export function cellContentHref(agent: Agent | string, id: string, options: CellContentOptions = {}): string {
  if (!isAgent(agent) || !CELL_ID.test(id)) throw new Error('Invalid cell content identity.');
  if (options.version !== undefined && (!Number.isSafeInteger(options.version) || options.version < 1)) throw new Error('Invalid cell content version.');
  return `/content/${encodeURIComponent(agent)}/${encodeURIComponent(id)}${options.version === undefined ? '' : `?version=${options.version}`}`;
}
export function cellContentTarget(agent: Agent | string, id: string, options?: CellContentOptions) {
  return { href: cellContentHref(agent, id, options), target: '_blank' as const, rel: 'noopener noreferrer' as const };
}
export function contentVersion(value: string | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid cell content version.');
  return Number(value);
}

/** An unversioned content target expands the selected cell's whole native version inventory. */
export function contentCellIndex(index: AgentCells, detail: CellDetail, exactVersion?: number): AgentCells {
  if (detail.agent !== index.agent || !index.cells.some(cell => cell.id === detail.id) || exactVersion !== undefined && (!Number.isSafeInteger(exactVersion) || exactVersion < 1 || detail.version !== exactVersion)) throw new Error('Invalid standalone cell snapshot.');
  return { ...index, cells: [{ ...detail }], contentScope: exactVersion === undefined ? { kind: 'cell', cellId: detail.id } : { kind: 'version', cellId: detail.id, version: exactVersion } };
}
