import type { DtcgNode, FillDoc, Slot } from '../catalog-core/types.js';
import { compare } from './shared.js';

/** Candidate availability only; consumer completeness is measured by check(), separately. */
export function leafCoverage(slots: readonly Slot[], fills: readonly FillDoc[]) {
  function members(node: DtcgNode, path = ''): string[] {
    return '$value' in node ? [path] : Object.entries(node).flatMap(([key, child]) => members(child as DtcgNode, path ? path + '.' + key : key));
  }
  const sources = [...new Set(fills.map(fill => fill.$extensions['com.clossys.fill'].source))].sort(compare);
  const leaves = [...slots].sort((a, b) => compare(a.id, b.id)).map(slot => {
    const candidates = fills.filter(fill => fill.$extensions['com.clossys.fill'].slot === slot.id);
    const providedMembers = Object.fromEntries(sources.map(source => [source, [...new Set(candidates.filter(fill => fill.$extensions['com.clossys.fill'].source === source).flatMap(fill => members((fill.tokens ?? fill.assets ?? {})[slot.id.split('.')[1]!] ?? {})))].sort(compare)]));
    return { slot: slot.id, values: Object.fromEntries(sources.map(source => [source, providedMembers[source]!.length])), providedMembers, baselines: candidates.filter(fill => fill.$extensions['com.clossys.fill'].baseline).map(fill => fill.$extensions['com.clossys.fill'].source).sort(compare), ...(slot.id === 'tokens.diverging-color' ? { derivedMembers: { neutral: 'token-diverging-neutral@1 from consumer tokens.border-color.base' } } : {}) };
  });
  return {
    kind: 'candidate-availability', consumerCoverage: 'not measured; adopt explicit ops and run check() on the consumer library',
    leaves,
    totals: Object.fromEntries(sources.map(source => [source, { filledLeaves: leaves.filter(leaf => leaf.values[source]! > 0).length, members: leaves.reduce((sum, leaf) => sum + leaf.values[source]!, 0) }])),
    unionFilledLeaves: leaves.filter(leaf => Object.values(leaf.values).some(count => count > 0)).length,
    uncoveredLeaves: leaves.filter(leaf => Object.values(leaf.values).every(count => count === 0)).map(leaf => leaf.slot),
  };
}
