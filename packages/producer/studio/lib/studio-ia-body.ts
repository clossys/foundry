import { AGENTS } from './agents';
import type { AgentCells, CellSummary } from './cells-client';
import type { StudioSelectionLeaf } from './selection-client';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** Read the sole native Publisher body declaration. No substitute body schema or agent map. */
export function studioIABands(namespace: Readonly<Record<string, unknown>>, pageId: string): { bands?: Record<'L0' | 'L1' | 'L2', string>; need?: string } {
  const bodies = namespace.studioPageBodies;
  const body = object(bodies) ? bodies[pageId] : undefined;
  if (!object(body) || body.template !== 'ia-scroll' || !object(body.bands)) return { need: 'NEED: native IA body projection' };
  const bands = body.bands;
  if (bands.L0 !== 'sections.section-header' || bands.L1 !== 'sections.section-header' || bands.L2 !== 'sections.cards') return { need: 'NEED: native IA card-grid bands' };
  return { bands: { L0: bands.L0, L1: bands.L1, L2: bands.L2 } };
}
/** The surface compiler's actual canonical export spelling, with provenance required. */
export function studioSelectedSurface(sectionId: string, leaves: readonly StudioSelectionLeaf[], surfaces: Readonly<Record<string, unknown>>): unknown {
  const leaf = leaves.find(leaf => leaf.leaf === sectionId);
  if (!leaf?.fill || leaf.source === 'unavailable' || !/^sections\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(sectionId)) return undefined;
  const name = sectionId.slice('sections.'.length).split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join('');
  const component = surfaces[name];
  return component && ['function', 'object'].includes(typeof component) ? component : undefined;
}
export function studioUsedByCount(indexes: readonly AgentCells[], agent: string, cell: CellSummary): { count: number; complete: boolean } {
  const count = indexes.reduce((count, index) => count + index.cells.filter(candidate => Array.isArray(candidate.fields?.links) && candidate.fields.links.some(reference => typeof reference === 'string' && (reference === `${agent}:${cell.id}@${cell.version}` || index.agent === agent && reference === `${cell.id}@${cell.version}`))).length, 0);
  return { count, complete: AGENTS.every(agent => indexes.some(index => index.agent === agent && index.state === 'ready')) };
}
