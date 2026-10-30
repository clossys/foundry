/** Native source preparation only. It creates no type, closure or runtime qualification evidence. */
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { materializeSurfaceSourceFill } from "../catalog-core/surface-materialize.js";
import { surfaceDescriptorHash, surfaceDerivationHash, surfaceEntryOf, isSurfacePackageEntry, surfaceManifest } from "../catalog-core/surface-library.js";
import { specimenSectionSourceCatalog } from "../importers/specimen-sections.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import type { SurfaceBase, SurfaceMaterializationReceipt, SurfaceSlot, SurfaceSourceBundle, SurfaceDependency } from "../catalog-core/surface-types.js";

/** Replays the registered recipe against retained exact bytes through the existing native materializer. */
export async function prepareSpecimenSurfaceSources(input: CompositeEngineInput, leaves?: readonly SurfaceSlot[], selectedDependencies: readonly SurfaceDependency[] = []): Promise<{ readonly input: CompositeEngineInput; readonly bundles: readonly SurfaceSourceBundle[] }> {
  if (!input.catalog.surfaces || !input.library.adoptedAt) throw new Error("Native specimen source preparation requires a surface catalog and adoption date.");
  const registry = specimenSectionSourceCatalog(input.surfaceOptions?.packages, selectedDependencies);
  const wanted = new Set(leaves ?? registry.fills.filter(doc => !isSurfacePackageEntry(surfaceEntryOf(doc))).map(doc => doc.$extensions["com.clossys.fill"].slot as SurfaceSlot));
  const fills = registry.fills.filter(doc => wanted.has(doc.$extensions["com.clossys.fill"].slot as SurfaceSlot));
  if (fills.length !== wanted.size) throw new Error("A requested specimen leaf is not registered.");
  const existing = input.catalog.surfaces;
  const catalog = { ...input.catalog, surfaces: { ...existing, fills: [...existing.fills.filter(doc => !wanted.has(doc.$extensions["com.clossys.fill"].slot as SurfaceSlot)), ...fills], transforms: [...existing.transforms.filter(transform => !registry.transforms.some(row => row.identity.id === transform.identity.id)), ...registry.transforms], materializations: [...existing.materializations] } };
  const materializations: SurfaceMaterializationReceipt[] = [];
  for (const document of fills) {
    const candidate = surfaceEntryOf(document); if (isSurfacePackageEntry(candidate)) throw new Error("A specimen source candidate must retain its source.");
    const transform = registry.transforms.find(row => row.identity.id === candidate.slot.slice(9))!;
    const upstream = candidate.pin.files.map(row => registry.upstream.find(file => file.path === row.path)!);
    const notices = candidate.pin.files.filter(row => row.path === "LICENSE");
    const base: SurfaceBase = { source: candidate.source, fill: document.$extensions["com.clossys.fill"].id, license: candidate.license, pin: candidate.pin, descriptorHash: surfaceDescriptorHash(candidate), upstreamSha256: candidate.pin.files, notices };
    const output = transform.run({ candidate, upstream });
    const receipt = stableStringify({ version: 1, base, transform: transform.identity, rule: null, inputs: [] });
    const files = [...output.files, { path: `surfaces/receipts/r-${sha256(receipt)}.json`, content: receipt }, ...notices.map(row => { const text = upstream.find(file => file.path === row.path)!.content; return { path: `notices/surfaces/n-${sha256(text)}.txt`, content: text }; })];
    const fill = { ...output.fill, source: input.library.source.id, outputSha256: surfaceManifest(files) };
    materializations.push({ operation: "adopt", slot: fill.slot, baseDescriptorHash: base.descriptorHash, transform: transform.identity, rule: null, inputsHash: surfaceDerivationHash(base, transform.identity, null, catalog, fill.slot, []), descriptorHash: surfaceDescriptorHash(fill), outputSha256: fill.outputSha256 });
  }
  catalog.surfaces.materializations = [...existing.materializations.filter(row => !wanted.has(row.slot)), ...materializations];
  const prepared = { ...input, catalog };
  const bundles: SurfaceSourceBundle[] = [];
  for (const document of fills) {
    const candidate = surfaceEntryOf(document);
    bundles.push(await materializeSurfaceSourceFill({ ...prepared, slot: candidate.slot, source: "foundry", transform: candidate.slot.slice(9), rule: null, fetch: async request => {
      const file = registry.upstream.find(file => file.path === request.path);
      if (!file || sha256(file.content) !== request.sha256) throw new Error("Native specimen source bytes differ.");
      return file.content;
    }, surfaceOptions: input.surfaceOptions ?? { packages: [], measurements: [] } }));
  }
  return { input: prepared, bundles };
}
