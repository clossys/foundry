import { applyLibraryChange, checkConsumerRuntimePorts, libraryHash, resolve } from "../catalog-core/index.js";
import type { BuildCatalogData, CompositeChangeSet, CompositeEngineInput, CompositeLibraryData, PlacementNode } from "../catalog-core/index.js";
import type { CompositeStudioSnapshot } from "./types.js";

export function placedLeaves(nodes: readonly PlacementNode[], parents: readonly string[] = []): { id: string; placement: readonly string[] }[] {
  return nodes.flatMap(node => "leaves" in node ? node.leaves.map(id => ({ id, placement: [...parents, node.id, id] })) : placedLeaves(node.children, [...parents, node.id]));
}
/** One unsigned proposal, derived from contracts rather than a parallel registry. */
export function wholeSignoff(contracts: BuildCatalogData) {
  return contracts.placements.filter(p => p.layer === "sections" || p.layer === "frames").flatMap(p => placedLeaves(p.nodes).map(leaf => {
    const slot = contracts.slots.find(slot => slot.id === leaf.id)!;
    return { ...leaf, layer: p.layer, status: "proposed" as const, contract: slot.contract, requires: slot.requires, unresolved: slot.contract.kind === "section" ? slot.contract.unresolvedMemberAxes ?? [] : [] };
  }));
}
export function evaluateWhole(input: CompositeEngineInput, snapshot: CompositeStudioSnapshot, contracts: BuildCatalogData) {
  const profile = resolve(input);
  const runtime = snapshot.runtime ? checkConsumerRuntimePorts(snapshot.runtime, contracts, { consumer: input.library.source.id, libraryHash: libraryHash(input.library) as `sha256:${string}`, selectionHash: profile.selectionHash as `sha256:${string}` }) : undefined;
  return { profile, runtime };
}
export function previewComponent(input: CompositeEngineInput, slot: string, source: string, changes: CompositeChangeSet) {
  const change = { portion: "components" as const, change: { op: "adopt" as const, slot, source } };
  try {
    const library: CompositeLibraryData = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [change], ...(changes.bundles ? { bundles: changes.bundles } : {}), ...(changes.surfaceBundles ? { surfaceBundles: changes.surfaceBundles } : {}) }, input.surfaceOptions ? { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions } : undefined);
    const profile = resolve({ ...input, library });
    return { change, profile, findings: profile.check.findings.filter(f => f.subject === slot || f.subject.startsWith(slot + ".")), available: true as const };
  } catch (error) { return { change, findings: [], available: false as const, error: error instanceof Error ? error.message : String(error) }; }
}
