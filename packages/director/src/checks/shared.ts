import type { Cell, Ref } from '../format/types.js';
import type { StrategyModel } from '../format/types.js';
import type { Scope } from './types.js';
export function refText(ref: Ref): string {
  if (ref.kind === 'cell')
    return `${ref.ref.cell}@${ref.ref.version}`;
  if (ref.kind === 'msg')
    return `msg:${ref.session}#${ref.line}`;
  return `finding:${ref.id}`;
}
export function activeCell(model: StrategyModel, id: string): Cell | undefined {
  const version = model.tree?.active[id];
  return model.cells.find(cell => cell.id === id && cell.version === version && cell.status === 'active');
}
export function resolves(ref: Ref, model: StrategyModel): boolean {
  if (ref.kind === 'cell')
    return model.cells.some(cell => cell.id === ref.ref.cell && cell.version === ref.ref.version);
  if (ref.kind === 'finding')
    return model.findings.some(finding => finding.id === ref.id);
  return model.sessions.some(session => session.id === ref.session && session.lines.some(line => line.id === ref.line));
}
export function fresh(cell: Cell, model: StrategyModel): boolean {
  return cell.status === 'active' && model.tree?.active[cell.id] === cell.version && cell.cites.every(ref => ref.kind !== 'cell' || (resolves(ref, model) && model.tree?.active[ref.ref.cell] === ref.ref.version));
}
export function scopeIds(model: StrategyModel, scope: Scope): string[] {
  if (scope === 'full')
    return model.catalog.cells.map(cell => cell.id);
  if (Array.isArray(model.tree?.core))
    return [...model.tree.core];
  const archetype = model.tree?.archetype ?? 'default';
  return [...new Set([...model.catalog.archetypes.default, ...(model.catalog.archetypes.extras[archetype] ?? [])])];
}
export function words(text: string): string[] { return text.trim().split(/\s+/).filter(Boolean); }
export function quoted(text: string): string[] { return [...text.matchAll(/["“]([^"”]+)["”]|'([^']+)'/g)].map(match => (match[1] ?? match[2]!).trim().toLowerCase()); }
export function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(phrase)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}
