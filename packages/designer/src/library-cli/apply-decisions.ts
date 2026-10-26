import { CatalogError } from "../catalog-core/api.js";
import { isLibraryDecisions } from "../catalog-core/library-decisions.js";
import { applyCompositeLibraryChange, compositeLibraryHash } from "../catalog-core/library-components.js";
import { materializeSourceFill, type ComponentTransform, type SourceBundle } from "../catalog-core/changeset-components.js";
import { componentOf, type ComponentFile } from "../catalog-core/resolve-components.js";
import { stableStringify } from "../catalog-core/stable.js";
import type { CompositeCatalogData, CompositeChangeSet, CompositeEngineInput, CompositeLibraryData } from "../catalog-core/types.js";

export interface OfflineSource {
  slot: string;
  source: string;
  /** Already supplied bytes only. The apply step never opens an upstream URL. */
  upstream: readonly ComponentFile[];
}
export interface DecisionOptions {
  bundles?: readonly SourceBundle[];
  sources?: readonly OfflineSource[];
  transforms?: readonly ComponentTransform[];
  componentOptions?: CompositeEngineInput["componentOptions"];
}

/** Build exactly one ordered changeset. A selected fill must match the engine's unique candidate. */
export function decisionChangeSet(catalog: CompositeCatalogData, library: CompositeLibraryData, input: unknown, bundles: readonly SourceBundle[] = []): CompositeChangeSet {
  if (!isLibraryDecisions(input)) throw new CatalogError("decisions: invalid decisions.json");
  const changes: CompositeChangeSet["changes"][number][] = input.map<CompositeChangeSet["changes"][number]>(row => {
    const component = row.slot.startsWith("components.");
    if (!(component ? catalog.components.slots : catalog.values.slots).some(slot => slot.id === row.slot)) throw new CatalogError(`decisions: unknown slot ${row.slot}`);
    if (row.kind === "adopt") {
      const candidates = (component ? catalog.components.fills : catalog.values.fills).filter(doc => {
        const meta = doc.$extensions["com.clossys.fill"];
        return meta.slot === row.slot && meta.source === row.source && (component ? meta.mode === "implementation" : meta.mode !== "reference");
      });
      if (candidates.length !== 1 || row.fill !== undefined && candidates[0]!.$extensions["com.clossys.fill"].id !== row.fill) throw new CatalogError(`decisions: missing, ambiguous or mismatched candidate for ${row.slot}`);
      const change = { op: "adopt" as const, slot: row.slot, source: row.source };
      return component ? { portion: "components", change } : { portion: "values", change };
    }
    if (row.kind === "author") {
      if ("value" in row) return { portion: "values", change: { op: "author", slot: row.slot, tokens: row.value } };
      return { portion: "components", change: { op: "author", slot: row.slot, fill: row.fill, files: row.files } };
    }
    if (!component) return { portion: "values", change: { op: "derive", slot: row.slot, rule: row.rule, inputs: row.reads } };
    const rules = catalog.components.rules?.filter(rule => rule.id === row.rule && rule.slot === row.slot && rule.kind === row.kind) ?? [];
    if (rules.length !== 1 || stableStringify([...rules[0]!.inputs].sort()) !== stableStringify([...row.reads].sort())) throw new CatalogError(`decisions: registered rule reads differ for ${row.slot}`);
    return { portion: "components", change: row.kind === "compose" ? { op: "compose", slot: row.slot, rule: row.rule } : { op: "derive", slot: row.slot, rule: row.rule, inputs: row.reads } };
  });
  return { baseHash: compositeLibraryHash(library), changes, bundles };
}

/** Offline preparation uses the existing pin/hash/registered-transform verifier. */
export async function materializeDecisionBundles(catalog: CompositeCatalogData, input: unknown, options: DecisionOptions = {}): Promise<readonly SourceBundle[]> {
  if (!isLibraryDecisions(input)) throw new CatalogError("decisions: invalid decisions.json");
  const bundles = structuredClone([...(options.bundles ?? [])]);
  for (const row of input) {
    if (row.kind !== "adopt" || !row.slot.startsWith("components.")) continue;
    const docs = catalog.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === row.slot && doc.$extensions["com.clossys.fill"].source === row.source);
    if (docs.length !== 1) throw new CatalogError("decisions: unique component candidate required");
    const fill = componentOf(docs[0]!);
    if (fill.impl.kind !== "source" || bundles.some(bundle => bundle.slot === row.slot)) continue;
    const sources = options.sources?.filter(source => source.slot === row.slot && source.source === row.source) ?? [];
    if (sources.length !== 1) throw new CatalogError(`decisions: supplied offline source required for ${row.slot}`);
    bundles.push(await materializeSourceFill(fill, async pin => {
      const files = sources[0]!.upstream.filter(file => file.path === pin.path);
      if (files.length !== 1) throw new CatalogError("decisions: supplied upstream path missing or ambiguous");
      return files[0]!.content;
    }, options.transforms ?? []));
  }
  return bundles;
}

/** Pure apply: no source fetching, filesystem writes, refresh, or evidence invention. */
export function applyDecisions(catalog: CompositeCatalogData, library: CompositeLibraryData, input: unknown, options: DecisionOptions = {}): CompositeLibraryData {
  return applyCompositeLibraryChange(catalog, library, decisionChangeSet(catalog, library, input, options.bundles));
}
