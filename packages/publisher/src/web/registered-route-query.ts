import { deriveDesignerLayerBoardsV1, DESIGNER_LAYER_BOARDS_QUERY } from "@clossys/designer/studio/queries";
import type { DesignerLayerBoardsInput } from "@clossys/designer/studio/queries";
import { libraryHash, resolve, runtimeHash, runtimeSnapshot, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { CompositeEngineInput, RuntimeContent, RuntimeContentRef, RuntimeJson, RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import type { ConsumerInstanceLibrary, InstanceBinding, InstanceRegistries } from "../core/instance-binding.js";
import { instanceBodyFindings } from "../core/instance-body.js";
import { recordRouteRuntimeMaterialization } from "../core/route-runtime.js";
import type { RouteRuntimeMaterialization } from "../core/route-runtime.js";
import { getEffectiveLayoutContract } from "../layouts/resolve.js";
import { isLayoutId } from "../layouts/ids.js";

export interface RegisteredDesignerQuery {
  readonly input: DesignerLayerBoardsInput;
  readonly implementation: RuntimeRendererDescriptor;
  readonly provider: RuntimeRendererDescriptor;
}
export type RegisteredQueryResult = { readonly status: "pending" | "refused"; readonly findings: readonly string[] } | {
  readonly status: "materialized";
  readonly materialization: RouteRuntimeMaterialization;
  readonly contents: readonly RuntimeContent[];
  readonly labels: Readonly<Record<string, RuntimeContentRef>>;
};
const only = (value: object, keys: readonly string[]) => !!value && Object.keys(value).every(key => keys.includes(key));
/** Stateless fixed invocation. No caller result/executor is accepted. Source
 * authentication and original-provider association are checked independently. */
export function materializeRegisteredDesignerRoute(registered: InstanceBinding, engine: CompositeEngineInput, registries: InstanceRegistries, library: ConsumerInstanceLibrary, query: RegisteredDesignerQuery): RegisteredQueryResult {
  try {
    if (!only(query, ["input", "implementation", "provider"]) || runtimeSourceFindings(query.implementation).length || runtimeSourceFindings(query.provider).length || query.implementation.source.entry !== "studio/designer-layer-boards.js" || query.provider.source.entry !== "studio/WholeStudioProvider.js") return { status: "refused", findings: ["Fixed Designer query/original provider source identity differs"] };
    const input = runtimeSnapshot(query.input), profile = resolve(engine), p = input.projection;
    if (!registered.body || registered.body.source.kind !== "derived" || runtimeHash(registered.body.source.query) !== runtimeHash(DESIGNER_LAYER_BOARDS_QUERY) || runtimeHash(input.query) !== runtimeHash(DESIGNER_LAYER_BOARDS_QUERY)) return { status: "refused", findings: ["Unknown registered body query/version"] };
    if (!profile.check.ok || profile.consumer !== registered.context.consumer || library.role !== "consumer" || library.id !== profile.consumer) return { status: "refused", findings: ["Current Designer consumer library checks differ"] };
    if (p.consumer !== null && p.consumer !== profile.consumer || p.libraryHash !== null && p.libraryHash !== libraryHash(engine.library) || p.selectionHash !== null && p.selectionHash !== profile.selectionHash) return { status: "refused", findings: ["Designer projection differs from current engine/library/selection"] };
    // Loading can lack library truth. It cannot borrow a different/default selection.
    if (p.consumer === null || p.libraryHash === null || p.selectionHash === null) return { status: "pending", findings: ["Current selected Designer provider library unavailable"] };
    const result = deriveDesignerLayerBoardsV1(input);
    if (result.status === "pending") return { status: "pending", findings: [result.reason] };
    const { layout: _oldLayout, body: _oldBody, fills: _oldFills, ...base } = registered;
    let binding: InstanceBinding;
    if (result.body.kind === "flow") {
      const selected = result.layout;
      const adopted = selected && library.resolveFill(selected.leaf, selected.config);
      if (!selected || !isLayoutId(selected.leaf) || !adopted || adopted.library !== profile.consumer || adopted.leaf !== selected.leaf || adopted.config !== selected.config) return { status: "pending", findings: ["Actual selected Designer state Layout unavailable"] };
      const contract = getEffectiveLayoutContract(selected.leaf, selected.config, selected.members);
      const slot = contract.slots.find(slot => slot.id === selected.slot);
      if (!slot || contract.slots.some(slot => (result.fills[slot.id]?.length ?? 0) < slot.min)) return { status: "pending", findings: ["Selected state Layout required slots unavailable"] };
      if (Object.entries(result.fills).some(([name, fills]) => !contract.slots.some(slot => slot.id === name && fills.length <= slot.max && fills.every(fill => slot.accepts.includes(fill.section))))) return { status: "refused", findings: ["State Section does not satisfy selected Layout slot/count"] };
      const { slot: _slot, ...layout } = selected;
      binding = { ...base, body: result.body, fills: result.fills, layout: { ...layout, leaf: selected.leaf } };
    } else binding = { ...base, body: result.body, fills: result.fills };
    const findings = instanceBodyFindings(binding, registries);
    if (findings.length) return { status: "pending", findings };
    const contents = [...result.content], labels: Record<string, RuntimeContentRef> = {};
    const refs = binding.body!.kind === "flow" ? binding.body!.sections : binding.body!.boards.map(board => board.section);
    refs.forEach((reference, index) => {
      const label = binding.body!.kind === "canvas" ? p.boards[index]!.label : binding.label;
      const copy: RuntimeContentRef = { kind: "copy", ref: `designer.layer-boards/labels/${encodeURIComponent(reference.slot)}/${reference.index}` };
      contents.push({ reference: copy, value: label, hash: runtimeHash(label) });
      labels[`sections.${reference.slot}.${reference.index}`] = copy;
    });
    const facts = runtimeSnapshot({ implementation: query.implementation, provider: query.provider, input, inputHash: result.inputHash, materializationHash: result.materializationHash, contents, labels }) as unknown as RuntimeJson;
    return { status: "materialized", materialization: recordRouteRuntimeMaterialization(registered, binding, engine, facts), contents: runtimeSnapshot(contents), labels: runtimeSnapshot(labels) };
  } catch (error) { return { status: "refused", findings: [`Designer canonical materialization refused: ${(error as Error).message}`] }; }
}
