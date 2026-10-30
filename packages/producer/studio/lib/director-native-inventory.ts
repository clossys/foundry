import { agentSpecimenPlan, type AgentSpecimenPlan } from './agent-specimen-data';
import type { AgentCells, CellDetail } from './cells-client';

const version = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Inventory only this Director cell's actual loaded active and draft versions. */
export function directorNativePlan(index: AgentCells, cells: readonly CellDetail[], id: string): AgentSpecimenPlan {
  const scope = index.contentScope;
  const plan: AgentSpecimenPlan = { cellId: id, ...(scope ? { scope } : {}), items: [], expectedVariantIds: [], issues: [] };
  if (index.state !== 'ready') plan.issues.push(index.error ?? 'The Director cell index is unavailable.');
  const summary = index.cells.find(cell => cell.id === id);
  if (index.agent !== 'director' || !summary || scope && scope.cellId !== id) {
    plan.issues.push('The selected Director cell is absent from this agent index.');
    return plan;
  }
  if (scope?.kind === 'version' && (!version(scope.version) || summary.version !== scope.version)) {
    plan.issues.push('The exact Director content-version scope does not match the indexed version.');
    return plan;
  }
  if (!version(summary.version)) plan.issues.push('The indexed Director cell has no valid version.');
  if (!['active', 'draft', 'retired'].includes(String(summary.status))) plan.issues.push('The indexed Director cell has no recognized status.');
  const selected = cells.filter(cell => cell.id === id && (scope?.kind !== 'version' || cell.version === scope.version));
  const seen = new Set<number>();
  const available: CellDetail[] = [];
  for (const cell of selected) {
    if (cell.agent !== 'director') { plan.issues.push('A loaded selected-cell version belongs to another agent.'); continue; }
    if (!version(cell.version)) { plan.issues.push('A loaded Director cell has no valid version.'); continue; }
    if (seen.has(cell.version)) { plan.issues.push(`The loaded Director version is duplicated: ${cell.version}`); continue; }
    seen.add(cell.version);
    if (!['active', 'draft', 'retired'].includes(String(cell.status))) { plan.issues.push(`The loaded Director version has no recognized status: ${cell.version}`); continue; }
    if (cell.status === 'active' || cell.status === 'draft') available.push(cell);
  }
  if ((summary.status === 'active' || summary.status === 'draft') && !available.some(cell => cell.version === summary.version && cell.status === summary.status)) plan.issues.push('The indexed Director version and status have not loaded.');
  const active = index.tree?.active;
  if (scope?.kind !== 'version' && active !== undefined && !object(active)) plan.issues.push('The Director active-version metadata is invalid.');
  if (scope?.kind !== 'version' && object(active) && Object.hasOwn(active, id)) {
    const pointed = active[id];
    if (!version(pointed)) plan.issues.push('The selected Director active-version pointer is invalid.');
    else if (!available.some(cell => cell.version === pointed && cell.status === 'active')) plan.issues.push(`The pointed active Director version has not loaded: ${pointed}`);
  }
  available.sort((left, right) => right.version! - left.version!);
  for (const cell of available) {
    const source = agentSpecimenPlan(index, cell);
    const identity = (sourceId: string) => `${sourceId}#v${cell.version}`;
    plan.expectedVariantIds.push(...source.expectedVariantIds.map(identity));
    plan.items.push(...source.items.map(item => {
      const sourceLabel = typeof item.label === 'string' ? item.label : typeof item.title === 'string' ? item.title : String(item.id);
      const label = `${sourceLabel} · v${cell.version} (${cell.status})`;
      return { ...item, id: identity(String(item.id)), label, ...(typeof item.title === 'string' ? { title: label } : {}), version: cell.version, status: cell.status };
    }));
    plan.issues.push(...source.issues.map(issue => `v${cell.version}: ${issue}`));
  }
  if (!available.length) plan.issues.push('No loaded active or draft Director versions are available.');
  return plan;
}
