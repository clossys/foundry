import type { ReactNode } from "react";
import { FrameStage, frameSectionRefKey } from "@clossys/designer/frames";
import { liveDesignerQueries } from "./registered-route-provider-context.js";
import { prepareRuntimeAssembly, resolve, libraryHash, runtimeHash, runtimeSnapshot, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { RuntimeAssemblyInput, RuntimeAssemblyBase, RuntimeAssemblyResult, RuntimeCell, RuntimeJson, RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import type { ConsumerInstanceLibrary, FlowInstanceBinding, InstanceRegistries } from "../core/instance-binding.js";
import { instanceBodyFindings } from "../core/instance-body.js";
import { flowStageStyleSheet } from "../core/flow-stage.js";
import { registeredRouteBrandLink } from "../core/route-registry.js";
import type { RouteRegistration, RouteRegistry } from "../core/route-registry.js";
import { currentRouteRuntimeMaterialization, deriveRouteRuntimeBinding, resolveSelectedRouteRuntimeBinding, selectedRouteRuntimeManifest } from "../core/route-runtime.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import type { RegisteredDesignerQuery } from "./registered-route-query.js";
import { isCurrentRegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import type { RegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import { plainRouteProjectionRegistry } from "../core/route-projection.js";
import type { PlainRegisteredRouteProjection } from "../core/route-projection.js";
export type { PlainRegisteredRouteProjection } from "../core/route-projection.js";
import type { RouteRuntimeMaterialization } from "../core/route-runtime.js";
import { bindRegisteredFlowLayout, registeredRouteBreakpointValues } from "./registered-route-layout.js";

export interface RegisteredRouteRuntime {
  /** Existing selected consumer ports and finite runtime inputs only. */
  readonly assembly: Omit<RuntimeAssemblyBase<ReactNode>, "binding" | "pageHeader">;
  readonly instanceLibrary: ConsumerInstanceLibrary;
  readonly registries: InstanceRegistries;
  readonly layoutRenderer?: RuntimeRendererDescriptor;
  readonly cell: RuntimeCell;
  readonly source?: RegisteredRouteSourceEvidence;
  readonly designerQuery?: RegisteredDesignerQuery;
  readonly headerActions?: { readonly renderer: RuntimeRendererDescriptor; readonly state: RuntimeJson };
}
export type RegisteredRouteRuntimeHook = (route: RouteRegistration) => RegisteredRouteRuntime;
export type RegisteredRouteHeaderActions = (options: { readonly compact: boolean }) => ReactNode;
export type PreparedRegisteredRoute = RuntimeAssemblyResult<ReactNode> & { readonly input?: RuntimeAssemblyInput<ReactNode>; readonly materialization?: RouteRuntimeMaterialization };

const only = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
/** The closed binder owns page composition. Hosts cannot return a body node,
 * page callback, Layout port, replacement header or old page wrapper. */
export function prepareRegisteredRoute(registry: RouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredRoute {
  return prepareRoute(registry, routeId, runtime, renderActions);
}
const plainDisplay = Symbol("plain display, never authenticated");
const verifiedNode = Symbol("verified Node source operation");
type PlainDisplayContext = { readonly token: typeof plainDisplay | typeof verifiedNode; readonly derivation?: Extract<PlainRegisteredRouteProjection["routes"][number], { kind: "derived-route-view" }>["derivation"] };
function prepareRoute(registry: RouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions, display?: PlainDisplayContext): PreparedRegisteredRoute {
  try {
    if (!registry || "kind" in registry || "authentication" in registry) return { status: "refused", findings: ["Plain projections are not authenticated registries"] };
    if (display?.token === plainDisplay && (runtime.source || runtime.designerQuery || runtime.assembly.query)) return { status: "refused", findings: ["Plain display cannot accept a receipt or query proof"] };
    const routes = registry.routes.filter(route => route.routeId === routeId);
    if (routes.length !== 1) return { status: "refused", findings: ["Exactly one registered route is required"] };
    const route = routes[0]!; let binding = route.composition.binding;
    const brand = registeredRouteBrandLink(registry, route);
    if (!brand) return { status: "refused", findings: ["Exact registered brand home link is unavailable"] };
    if (!runtime || !only(runtime, ["assembly", "instanceLibrary", "registries", "layoutRenderer", "cell", "headerActions", "designerQuery", "source"]) || !only(runtime.assembly, ["identity", "engine", "contracts", "ports", "themes", "states", "breakpointPixels", "breakpointBasis", "css", "assets", "runner", "stage", "stageMeasurements", "query"]) || !only(runtime.assembly.ports, ["manifest", "renderers", "resolveContent", "frameOrder", "stageActions"])) return { status: "refused", findings: ["Host runtime contains an unknown page/body escape"] };
    let materialization: RouteRuntimeMaterialization | undefined;
    let assembly = runtime.assembly;
    if (binding.body?.source.kind === "derived" && display?.token !== plainDisplay) {
      if (!runtime.designerQuery) return { status: "pending", findings: ["Fixed Designer query/current original provider inputs unavailable"] };
      if (display?.token !== verifiedNode && liveDesignerQueries.get(runtime.designerQuery) !== runtimeHash(runtime.designerQuery.input.projection)) return { status: "pending", findings: ["Actual mounted original Designer provider association unavailable"] };
      if (assembly.query) return { status: "refused", findings: ["Host cannot supply a query result or assembly seal"] };
      const result = materializeRegisteredDesignerRoute(binding, assembly.engine, runtime.registries, runtime.instanceLibrary, runtime.designerQuery);
      if (result.status !== "materialized") return result;
      materialization = result.materialization; binding = materialization.binding;
      if (!runtime.source || !isCurrentRegisteredRouteSourceEvidence(runtime.source, registry, route, materialization.digest)) return { status: "pending", findings: ["Current reached original provider/query source materialization evidence unavailable"] };
      if (!assembly.stage) return { status: "pending", findings: ["Exact derived body Stage unavailable"] };
      const originals = assembly.ports.resolveContent;
      const content = new Map(result.contents.map(value => [runtimeHash(value.reference), value]));
      for (const value of result.contents) { const previous = originals(value.reference); if (previous && runtimeHash(previous) !== runtimeHash(value)) return { status: "refused", findings: ["Original content conflicts with fixed query materialization"] }; }
      assembly = { ...assembly, stage: { ...assembly.stage, bodyDigest: runtimeHash(binding.body), labels: result.labels, ...(binding.body?.kind === "flow" ? { state: {} } : {}) }, ports: { ...assembly.ports, resolveContent: ref => content.get(runtimeHash(ref)) ?? originals(ref) } };
    } else if (runtime.designerQuery) return { status: "refused", findings: ["Static route cannot accept a Designer query"] };
    const bodyFindings = instanceBodyFindings(binding, runtime.registries);
    if (bodyFindings.length) return { status: "refused", findings: bodyFindings };
    if (registry.consumer !== binding.context.consumer || binding.path !== route.path) return { status: "refused", findings: ["Registered consumer/instance identity differs"] };
    const selected = display?.token === plainDisplay ? resolveSelectedRouteRuntimeBinding(binding, assembly.engine, assembly.ports.manifest) : deriveRouteRuntimeBinding(route.composition.binding, assembly.engine, assembly.ports.manifest, materialization);
    if (selected.status !== "resolved") return selected;
    if (!binding.body) return { status: "pending", findings: ["Explicit canonical route body is required"] };
    if (binding.body.kind === "canvas" && !assembly.stage) return { status: "pending", findings: ["Exact canonical Canvas Stage source/controller inputs unavailable"] };
    const profile = resolve(assembly.engine);
    let layout;
    if (binding.body.kind === "flow") {
      const flow = binding as FlowInstanceBinding;
      const css = flowStageStyleSheet(profile, flow.layout.leaf, flow.layout.config, flow.layout.members);
      if (!assembly.css.some(file => file.id === "publisher-flow-stage.css" && file.contents === css)) return { status: "pending", findings: ["Exact consumer-emitted flow Stage stylesheet is unavailable"] };
      const pixels = registeredRouteBreakpointValues(profile, assembly.breakpointPixels ?? {}) as Readonly<Record<string, number>>;
      layout = runtime.layoutRenderer && bindRegisteredFlowLayout(flow, runtime.instanceLibrary, runtime.layoutRenderer, pixels);
      if (!layout) return { status: "pending", findings: ["Exact selected public flow Layout source/configuration is unavailable"] };

    } else if (runtime.layoutRenderer !== undefined) return { status: "refused", findings: ["Canvas cannot substitute a flow Layout renderer"] };
    const manifest = selectedRouteRuntimeManifest(selected.binding, assembly.ports.manifest), fills = manifest.fills;
    const frame = fills.find(fill => fill.kind === "frame");
    if (!frame?.headerModule) return { status: "pending", findings: ["Selected Frame header provider lease is unavailable"] };
    if (!!route.composition.header.actions !== !!renderActions || !!renderActions !== !!runtime.headerActions) return { status: "pending", findings: ["Registered header action implementation/state is unavailable"] };
    if (runtime.headerActions && (!only(runtime.headerActions, ["renderer", "state"]) || runtimeSourceFindings(runtime.headerActions.renderer).length || runtime.headerActions.renderer.source.entry !== route.composition.header.actions!.file)) return { status: "refused", findings: ["Header action source differs from registration"] };
    const originalFrame = frame && assembly.ports.renderers[frame.renderer.id];
    if (!originalFrame) return { status: "pending", findings: ["Exact selected Frame renderer unavailable"] };
    const renderers = { ...assembly.ports.renderers, [frame.renderer.id]: (current: Parameters<typeof originalFrame>[0]) => {
      if (!current.stage) return originalFrame(current);
      const stage = current.stage;
      const sectionNodes = Object.fromEntries(stage.sectionNodes.map(row => [frameSectionRefKey(row.reference), { label: row.label, node: row.node }]));
      const main = "layout" in stage
        ? <FrameStage body={stage.body} sectionNodes={sectionNodes} contract={stage.contract} aria-label={stage.label} layout={stage.layout} cell={stage.cell} profile={stage.profile} />
        : <FrameStage body={stage.body} sectionNodes={sectionNodes} contract={stage.contract} collapseBelowPx={stage.collapseBelowPx} aria-label={stage.label}
        camera={{ ...stage.camera, onViewportChange: stage.onViewportChange }} modules={stage.modules} currentBoardId={stage.currentBoardId} onCurrentBoardChange={stage.onCurrentBoardChange} />;
      return originalFrame({ ...current, slots: { ...current.slots, main: [main] } });
    } };
    let query;
    const derivation = display?.derivation ?? (materialization && runtime.designerQuery ? { id: "designer.layer-boards", version: 1, renderer: runtime.designerQuery.implementation, state: materialization.facts } : undefined);
    if (derivation) {
      const contents: Record<string, Record<string, unknown>> = {};
      const entries = [["frame", selected.binding.frame] as const, ...Object.entries(selected.binding.sections).flatMap(([slot, fills]) => fills.map((fill, index) => [`sections.${slot}.${index}`, fill] as const)), ...Object.entries(selected.binding.frameSlots).flatMap(([slot, fills]) => fills.map((fill, index) => [`frameSlots.${slot}.${index}`, fill] as const))];
      for (const [path, fill] of entries) contents[path] = Object.fromEntries(Object.entries(fill.content).map(([name, ref]) => [name, assembly.ports.resolveContent(ref)]));
      const state = derivation.state;
      query = { ...derivation, state, inputHash: runtimeHash({ libraryHash: selected.libraryHash, selectionHash: selected.selectionHash, content: contents, state }), outputHash: runtimeHash({ body: selected.binding.body, sections: selected.binding.sections, frameSlots: selected.binding.frameSlots }) };
    }
    const base = { ...assembly, ...(query ? { query } : {}), ports: { ...assembly.ports, manifest, renderers },
      pageHeader: { brand, id: route.composition.header.id, data: route.composition.header.data, module: frame.headerModule, ...(renderActions && runtime.headerActions ? { actions: { ...runtime.headerActions, render: renderActions } } : {}) },
    };
    const input: RuntimeAssemblyInput<ReactNode> = selected.binding.body?.kind === "canvas" && assembly.stage
      ? { ...base, binding: { ...selected.binding, body: selected.binding.body }, stage: assembly.stage }
      : { ...base, binding: { ...selected.binding, body: selected.binding.body?.kind === "flow" ? selected.binding.body : undefined }, layout: layout! };
    const prepared = prepareRuntimeAssembly(input);
    return prepared.status === "ready" ? { ...prepared, input, ...(materialization ? { materialization } : {}) } : prepared;
  } catch { return { status: "refused", findings: ["Invalid registered route runtime inputs"] }; }
}
export type RegisteredRoutePageProps = { readonly registry: RouteRegistry; readonly routeId: string; readonly useRuntime: RegisteredRouteRuntimeHook; readonly renderActions?: RegisteredRouteHeaderActions };
/** Render-only data boundary. Plain JSON never becomes an authenticated registry,
 * source receipt or lifecycle record, including when this returns a ready view. */
export function prepareRegisteredRouteProjection(projection: PlainRegisteredRouteProjection, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredRoute & { readonly authentication: "unverified" } {
  const registry = plainRouteProjectionRegistry(projection);
  const row = registry ? projection.routes.find(row => row.registration.routeId === routeId) : undefined;
  const result = registry ? prepareRoute(registry, routeId, runtime, renderActions, { token: plainDisplay, ...(row?.kind === "derived-route-view" ? { derivation: row.derivation } : {}) }) : { status: "refused" as const, findings: ["Invalid plain route projection/provenance"] };
  return { ...result, authentication: "unverified" };
}
/** Node's actual source operation can prepare the same binding without requiring
 * browser hooks to mount in a server/build process. Both receipts must retain
 * their original brands; the fixed query is still re-executed by prepareRoute. */
export function prepareRegisteredRouteFromNode(registry: RouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, proof: { readonly source: RegisteredRouteSourceEvidence; readonly materialization?: RouteRuntimeMaterialization }, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredRoute {
  try {
  if (!registry || "kind" in registry || "authentication" in registry) return { status: "refused", findings: ["Plain projections are not authenticated Node registries"] };
  const route = registry.routes.find(route => route.routeId === routeId);
  if (!route || !isCurrentRegisteredRouteSourceEvidence(proof.source, registry, route, proof.materialization?.digest) || route.composition.binding.body?.source.kind === "derived" && !currentRouteRuntimeMaterialization(proof.materialization, route.composition.binding, runtime.assembly.engine)) return { status: "refused", findings: ["Current authenticated Node source/materialization receipts required"] };
  return prepareRoute(registry, routeId, { ...runtime, source: proof.source }, renderActions, { token: verifiedNode });
  } catch { return { status: "refused", findings: ["Invalid Node verification artifacts"] }; }
}
