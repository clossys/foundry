import { dsAttrs, libraryHash, resolve, runtimeHash, runtimeSnapshot } from "@clossys/designer/catalog";
import type { CompositeEngineInput, DsAttrs, ConsumerRuntimeManifest, RuntimeAssemblyBinding, RuntimeFillSelection, RuntimeDigest, RuntimeJson } from "@clossys/designer/catalog";
import type { InstanceBinding, SectionFill } from "./instance-binding.js";

/** Internal execution receipt. Only the closed fixed-query adapter records it after
 * re-execution; copied/deserialized or caller-authored results do not resolve. */
export interface RouteRuntimeMaterialization {
  readonly binding: InstanceBinding;
  readonly digest: RuntimeDigest;
  readonly facts: RuntimeJson;
}
const materializations = new WeakMap<object, { registered: string; library: string; selection: string }>();
export function recordRouteRuntimeMaterialization(registered: InstanceBinding, binding: InstanceBinding, engine: CompositeEngineInput, facts: RuntimeJson): RouteRuntimeMaterialization {
  const receipt = runtimeSnapshot({ binding, facts, digest: runtimeHash({ binding, facts }) });
  materializations.set(receipt, { registered: runtimeHash(registered), library: libraryHash(engine.library), selection: resolve(engine).selectionHash });
  return receipt;
}
export function currentRouteRuntimeMaterialization(receipt: RouteRuntimeMaterialization | undefined, registered: InstanceBinding, engine: CompositeEngineInput): receipt is RouteRuntimeMaterialization {
  const seal = receipt && materializations.get(receipt);
  return !!receipt && !!seal && seal.registered === runtimeHash(registered) && seal.library === libraryHash(engine.library) && seal.selection === resolve(engine).selectionHash && receipt.digest === runtimeHash({ binding: receipt.binding, facts: receipt.facts });
}
export type RouteRuntimeBindingResult =
  | { readonly status: "resolved"; readonly binding: RuntimeAssemblyBinding; readonly instance: InstanceBinding; readonly libraryHash: string; readonly selectionHash: string;
      /** Page-root provenance stamp (D1, D2): spread on the route's root element so provenance-scan can attribute it. */
      readonly pageRoot: DsAttrs }
  | { readonly status: "pending" | "refused"; readonly findings: readonly string[] };
/** Resolve only the exact consumer's current selected surfaces. This projects the canonical
 * InstanceBinding; it cannot pick a catalog candidate or infer a missing configuration. */
export function deriveRouteRuntimeBinding(binding: InstanceBinding, engine: CompositeEngineInput, manifest: ConsumerRuntimeManifest, materialization?: RouteRuntimeMaterialization): RouteRuntimeBindingResult {
  try {
    if (!binding || "kind" in binding || "authentication" in binding) return { status: "refused", findings: ["Plain projections are not authenticated bindings"] };
    if (binding.body?.source.kind === "derived") {
      if (!materialization) return { status: "pending", findings: [`Exact versioned body query implementation is unavailable: ${binding.body.source.query.id}@${binding.body.source.query.version}`] };
      if (!currentRouteRuntimeMaterialization(materialization, binding, engine)) return { status: "refused", findings: ["Stale or foreign fixed query materialization"] };
      binding = materialization.binding;
    } else if (materialization) return { status: "refused", findings: ["Static body cannot accept a query materialization"] };
    return resolveSelectedRouteRuntimeBinding(binding, engine, manifest);
  } catch { return { status: "refused", findings: ["Invalid selected consumer assembly data"] }; }
}
/** Shared selected-surface validation. A plain display caller obtains no authenticated
 * materialization or lifecycle receipt from this operation. Not a public core export. */
export function resolveSelectedRouteRuntimeBinding(binding: InstanceBinding, engine: CompositeEngineInput, manifest: ConsumerRuntimeManifest): RouteRuntimeBindingResult {
  try {
    if (!binding || "kind" in binding || "authentication" in binding) return { status: "refused", findings: ["Plain projections are not authenticated bindings"] };
    const profile = resolve(engine), hash = libraryHash(engine.library);
    if (!profile.check.ok || profile.check.findings.some(f => f.severity === "error")) return { status: "refused", findings: ["Selected consumer library checks failed"] };
    if (binding.context.consumer !== profile.consumer || manifest.consumer !== profile.consumer || manifest.libraryHash !== hash || manifest.selectionHash !== profile.selectionHash) return { status: "refused", findings: ["Stale or foreign consumer library/selection identity"] };
    if (!profile.surfaces) return { status: "pending", findings: ["Consumer-selected executable surfaces are unavailable"] };
    const findings: string[] = [];
    const pick = (leaf: `frames.${string}` | `sections.${string}`, config: string | undefined, content: RuntimeFillSelection["content"], path: string): RuntimeFillSelection | undefined => {
      const selected = profile.surfaces!.fills[leaf];
      if (!selected) { findings.push(`${path}: selected consumer surface missing`); return; }
      const id = selected.document.$extensions["com.clossys.fill"].id;
      const fills = manifest.fills.filter(fill => fill.leaf === leaf && fill.fill === id && fill.config === (config ?? null) && fill.library === profile.consumer);
      if (fills.length !== 1) { findings.push(`${path}: exact selected fill/config runtime descriptor missing or ambiguous`); return; }
      const fill = fills[0]!;
      return { leaf, fill: id, config: config ?? null, members: [...fill.members], content };
    };
    const section = (fill: SectionFill, path: string) => pick(fill.section, fill.config, fill.content, path);
    const frame = pick(binding.frame.leaf, binding.frame.config, binding.frame.content ?? {}, "frame");
    const sections: Record<string, RuntimeFillSelection[]> = {};
    for (const [slot, fills] of Object.entries(binding.fills)) sections[slot] = fills.flatMap((fill, index) => { const selected = section(fill, `fills.${slot}.${index}`); return selected ? [selected] : []; });
    const frameSlots: Record<string, RuntimeFillSelection[]> = {};
    for (const [slot, fill] of Object.entries(binding.frame.slotFills ?? {})) { const selected = section(fill, `frame.slotFills.${slot}`); frameSlots[slot] = selected ? [selected] : []; }
    if (!Object.values(sections).some(fills => fills.length)) findings.push("Real body Section content is unavailable");
    if (findings.length || !frame) return { status: "pending", findings };
    return runtimeSnapshot({ status: "resolved" as const, instance: binding, binding: { id: binding.instanceId, frame, frameSlots, sections, ...(binding.body ? { body: binding.body } : {}) }, libraryHash: hash, selectionHash: profile.selectionHash,
      pageRoot: dsAttrs("pages", `pages.${binding.instanceId}`, `${profile.consumer}/pages.${binding.instanceId}`) });
  } catch { return { status: "refused", findings: ["Invalid selected consumer assembly data"] }; }
}

/** Exact current binding closure; unrelated globally selected pages stay outside it. */
export function selectedRouteRuntimeManifest(binding: RuntimeAssemblyBinding, manifest: ConsumerRuntimeManifest): ConsumerRuntimeManifest {
  const selections = [binding.frame, ...Object.values(binding.sections).flat(), ...Object.values(binding.frameSlots).flat()];
  return { ...manifest, fills: manifest.fills.filter(fill => selections.some(selection => selection.leaf === fill.leaf && selection.fill === fill.fill && selection.config === fill.config)) };
}
