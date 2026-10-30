import { applyLibraryChange, checkConsumerRuntimePorts, libraryHash, resolve } from "../catalog-core/index.js";
import type { BuildCatalogData, CompositeChangeSet, CompositeEngineInput, CompositeLibraryData, CompositeResolved, PlacementNode } from "../catalog-core/index.js";
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
/** One whole-library resolution per immutable engine input: the provider's committed-library check and every
 * evaluation of that input share it. A failed resolution is not kept, so it fails again where it is read. */
const resolutions = new WeakMap<CompositeEngineInput, CompositeResolved>();
export function resolveWhole(input: CompositeEngineInput): CompositeResolved {
  let profile = resolutions.get(input); if (!profile) resolutions.set(input, profile = resolve(input));
  return profile;
}
/** The working library's whole-library hash. A kept resolution of this input already carries it as its selection
 * hash (the same composite library hash of the same library), so the library is not hashed again. */
export function wholeLibraryHash(input: CompositeEngineInput): string {
  return resolutions.get(input)?.selectionHash ?? libraryHash(input.library);
}
function evaluate(input: CompositeEngineInput, snapshot: CompositeStudioSnapshot, contracts: BuildCatalogData) {
  const profile = resolveWhole(input);
  const runtime = snapshot.runtime ? checkConsumerRuntimePorts(snapshot.runtime, contracts, { consumer: input.library.source.id, libraryHash: wholeLibraryHash(input) as `sha256:${string}`, selectionHash: profile.selectionHash as `sha256:${string}` }) : undefined;
  return { profile, runtime };
}
type WholeEvaluation = ReturnType<typeof evaluate>;
/** One evaluation per immutable (input, snapshot, contracts) triple: the provider and every canvas board share it. */
const evaluations = new WeakMap<CompositeEngineInput, WeakMap<CompositeStudioSnapshot, WeakMap<BuildCatalogData, WholeEvaluation>>>();
export function evaluateWhole(input: CompositeEngineInput, snapshot: CompositeStudioSnapshot, contracts: BuildCatalogData): WholeEvaluation {
  let bySnapshot = evaluations.get(input); if (!bySnapshot) evaluations.set(input, bySnapshot = new WeakMap());
  let byContracts = bySnapshot.get(snapshot); if (!byContracts) bySnapshot.set(snapshot, byContracts = new WeakMap());
  let evaluation = byContracts.get(contracts); if (!evaluation) byContracts.set(contracts, evaluation = evaluate(input, snapshot, contracts));
  return evaluation;
}
export function previewComponent(input: CompositeEngineInput, slot: string, source: string, changes: CompositeChangeSet) {
  const change = { portion: "components" as const, change: { op: "adopt" as const, slot, source } };
  try {
    const library: CompositeLibraryData = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [change], ...(changes.bundles ? { bundles: changes.bundles } : {}), ...(changes.surfaceBundles ? { surfaceBundles: changes.surfaceBundles } : {}) }, input.surfaceOptions ? { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions } : undefined);
    const profile = resolve({ ...input, library });
    return { change, profile, findings: profile.check.findings.filter(f => f.subject === slot || f.subject.startsWith(slot + ".")), available: true as const };
  } catch (error) { return { change, findings: [], available: false as const, error: error instanceof Error ? error.message : String(error) }; }
}
