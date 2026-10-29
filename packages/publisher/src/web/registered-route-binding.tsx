import type { ReactNode } from "react";
import { FrameStage, frameSectionRefKey } from "@clossys/designer/frames";
import { liveDesignerQueries } from "./registered-route-provider-context.js";
import { prepareRuntimeAssembly, resolve, libraryHash, runtimeHash, runtimeSnapshot, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { RuntimeAssemblyInput, RuntimeAssemblyBase, RuntimeAssemblyResult, RuntimeCell, RuntimeJson, RuntimeRendererDescriptor, RuntimeRenderInput, RuntimeContent } from "@clossys/designer/catalog";
import type { ConsumerInstanceLibrary, ContentRef, FlowInstanceBinding, InstanceRegistries, RepeatedSectionsResult, RepeatedSectionScope, SectionFill } from "../core/instance-binding.js";
import { contentReferenceKey, normalizeRepeatedSections, staticContentReference } from "../core/instance-binding.js";
import { instanceBodyFindings } from "../core/instance-body.js";
import { flowStageStyleSheet } from "../core/flow-stage.js";
import { registeredRouteBrandLink, normalizeRegionPageRoute } from "../core/route-registry.js";
import { isRegionPageRouteRegistration } from "../core/route-identities.js";
import type { LegacyRouteRegistration as RouteRegistration, LegacyRouteRegistry as RouteRegistry, RegionPageRouteRegistry } from "../core/route-registry.js";
import { currentRouteRuntimeMaterialization, deriveRouteRuntimeBinding, resolveSelectedRouteRuntimeBinding, selectedRouteRuntimeManifest } from "../core/route-runtime.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import type { RegisteredDesignerQuery } from "./registered-route-query.js";
import type { RegisteredPageSession, RegisteredRegionUpdate, RegisteredFrameRouteState, RegisteredPageChunk } from "./registered-route-query.js";
import { isCurrentRegisteredRouteLiveSourceEvidence, isCurrentRegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
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
  readonly page?: RegisteredPageSession;
  /** Concrete client-router path for the registered /[l0]/[id] template. */
  readonly itemPath?: string;
}
export type RegisteredRouteRuntimeHook = (route: RouteRegistration) => RegisteredRouteRuntime;
export type RegisteredRouteHeaderActions = (options: { readonly compact: boolean }) => ReactNode;
type PreparedRouteFields = { readonly input?: RuntimeAssemblyInput<ReactNode>; readonly materialization?: RouteRuntimeMaterialization; readonly renderRegions?: (cell: RuntimeCell) => RegisteredRegionUpdate; readonly routeState?: RegisteredFrameRouteState; readonly regionHash?: string };
export type PreparedRegisteredRoute = RuntimeAssemblyResult<ReactNode> & PreparedRouteFields;
type PreparedStaticRoute = PreparedRegisteredRoute;
/** A stream contains independently validated assemblies; it has no fabricated
 * aggregate assembly or aggregate render/source receipt. */
export type PreparedRegisteredPage = PreparedStaticRoute | ({ readonly status: "stream"; readonly findings: readonly string[]; readonly chunks: readonly { readonly id: string; readonly result: PreparedStaticRoute }[] } & PreparedRouteFields);

const only = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
/** The closed binder owns page composition. Hosts cannot return a body node,
 * page callback, Layout port, replacement header or old page wrapper. */
export function prepareRegisteredRoute(registry: RouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredRoute;
export function prepareRegisteredRoute(registry: RegionPageRouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredPage;
export function prepareRegisteredRoute(registry: RouteRegistry | RegionPageRouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredPage;
export function prepareRegisteredRoute(registry: RouteRegistry | RegionPageRouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredPage {
  try {
    const route = registry.routes.find(row => row.routeId === routeId);
    if (route && isRegionPageRouteRegistration(route)) {
      if (!runtime.page?.options.publication || runtime.page.options.routeId !== routeId || runtimeHash(runtime.page.options.publication.publication) !== runtimeHash(registry.publication)) return { status: "refused", findings: ["Region page requires the same persistent publication host"] };
      const lowered = normalizeRegionPageRoute(registry as RegionPageRouteRegistry, route);
      if (runtimeHash(runtime.page.options.page) !== runtimeHash(route.composition.binding) && runtimeHash(runtime.page.options.page) !== runtimeHash(lowered.composition.binding)) return { status: "refused", findings: ["Page loader session differs from the registered region page"] };
      return prepareRegionStream(registry as RegionPageRouteRegistry, lowered, runtime, renderActions);
    }
    const result = prepareRoute(registry as RouteRegistry, routeId, runtime, renderActions);
    return { ...result, ...(runtime.page?.frameState() ? { routeState: runtime.page.frameState() } : {}) };
  } catch { return { status: "refused", findings: ["Invalid registered publication page inputs"] }; }
}
const samePlacement = (section: import("../content/taxonomy.js").PageOutlinePlacement, scope: RepeatedSectionScope, mainSlot?: string) =>
  (section.slot === scope.placement.slot || section.slot === "main" && scope.placement.slot === mainSlot) && section.index === scope.placement.index
  && runtimeHash(section.children ?? []) === runtimeHash(scope.placement.children ?? [])
  && (section.keys ? runtimeHash(section.keys) === runtimeHash(scope.keys) : section.key === undefined || section.key === scope.key);
function prepareRegionStream(registry: RegionPageRouteRegistry, route: RouteRegistration, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions): PreparedRegisteredPage {
  const page = runtime.page!, slot = registry.publication!.mainSlot, binding = route.composition.binding;
  const read = (reference: ContentRef) => { const current = page.read(reference); return current.status === "ready" ? current.content : reference.lazy ? undefined : runtime.assembly.ports.resolveContent(staticContentReference(reference)); };
  const normalized = normalizeRepeatedSections(binding, read);
  if (normalized.status === "refused") return normalized;
  const targets = Object.values(page.outline.targets), chunks: { id: string; result: PreparedStaticRoute }[] = [];
  const descriptors: RegisteredPageChunk[] = [];
  const chunkId = (l0: string, l1?: string) => page.options.manifest.l0.find(row => row.id === l0)?.partition === "l1" && l1 ? `${l0}--${l1}` : l0;
  const partitions = page.options.manifest.l0.flatMap(l0 => [{ id: l0.id, estimate: l0.estimate, args: { l0: l0.id } }, ...(l0.partition === "l1" ? l0.l1.map(l1 => ({ id: `${l0.id}--${l1.id}`, estimate: l1.estimate, args: { l0: l0.id, l1: l1.id } })) : [])]);
  for (const chunk of partitions) {
    let result: PreparedStaticRoute = { status: "pending", findings: ["Chunk data has not been requested"] };
    if (normalized.status === "ready") {
      const values = normalized.binding.fills[slot] ?? [], chosen: number[] = [];
      for (const [index] of values.entries()) {
        const prefix = `sections.${slot}.${index}`, scopes = Object.entries(normalized.scopes).filter(([path]) => path === prefix || path.startsWith(`${prefix}.children.`)).map(([, scope]) => scope);
        const owners = new Set(scopes.flatMap(scope => targets.filter(target => samePlacement(target.section, scope, slot)).map(target => chunkId(target.l0, target.l1))));
        for (const scope of scopes) if (scope.l0) owners.add(chunkId(scope.l0, scope.l1));
        if (owners.size !== 1) return { status: "refused", findings: ["Every stream Section must belong to exactly one manifest L0 chunk"] };
        if (owners.has(chunk.id)) chosen.push(index);
      }
      const scoped: Record<string, RepeatedSectionScope> = {}, keys: Record<string, string> = {}, lazy: Record<string, ContentRef> = {};
      chosen.forEach((original, index) => {
        const prefix = `sections.${slot}.${original}`, next = `sections.${slot}.${index}`;
        for (const [path, scope] of Object.entries(normalized.scopes)) if (path === prefix || path.startsWith(`${prefix}.children.`)) scoped[next + path.slice(prefix.length)] = scope;
      });
      for (const [path, scope] of Object.entries(normalized.scopes)) if (path.startsWith("frameSlots.")) scoped[path] = scope;
      for (const [path, scope] of Object.entries(scoped)) if (scope.keys.length) keys[path] = scope.keys.length === 1 ? scope.keys[0]! : JSON.stringify(scope.keys);
      const fills = chosen.map(index => values[index]!);
      const visit = (fill: SectionFill) => { for (const reference of Object.values(fill.content)) { const current = normalized.lazy[contentReferenceKey(reference)]; if (current) lazy[contentReferenceKey(reference)] = current; } fill.children?.forEach(visit); };
      fills.forEach(visit); Object.values(normalized.binding.frame.slotFills ?? {}).forEach(visit);
      let missing = Object.values(lazy).some(reference => read(reference) === undefined);
      const authored = (fill: SectionFill) => { for (const reference of [...Object.values(fill.content), ...(fill.repeat ? [fill.repeat.over] : [])]) if (reference.lazy && chunkId(reference.lazy.args.l0, reference.lazy.args.l1) === chunk.id && !read(reference)) missing = true; fill.children?.forEach(authored); };
      Object.values(binding.fills).flat().forEach(authored);
      if (!missing && fills.length) {
        const chunkBinding: FlowInstanceBinding = { ...normalized.binding, layout: registry.publication!.layout, fills: { [slot]: fills }, body: { kind: "flow", source: { kind: "static" }, sections: fills.map((_, index) => ({ slot, index })) } };
        const chunkRoute = { ...route, composition: { ...route.composition, binding: chunkBinding } };
        const routes = registry.routes.map(row => row.routeId === route.routeId ? chunkRoute : normalizeRegionPageRoute(registry, row));
        result = prepareRoute({ ...registry, routes }, route.routeId, runtime, renderActions, undefined, { ...normalized, binding: chunkBinding, scopes: scoped, keys, lazy });
      }
    }
    chunks.push({ id: chunk.id, result });
    const selected = result.status === "ready" ? result : undefined;
    const requested = page.chunkStatus(chunk.args);
    descriptors.push({ id: chunk.id, estimate: chunk.estimate, status: selected ? "ready" : result.status === "refused" ? "error" : requested === "ready" ? "pending" : requested,
      load: () => page.requestChunk(chunk.args), ...(selected ? { content: selected.renderRegions!(runtime.cell).regions.main ?? [] } : {}) });
  }
  const failed = chunks.find(chunk => chunk.result.status === "refused");
  if (failed && "findings" in failed.result) return failed.result;
  const first = chunks.find(chunk => chunk.result.status === "ready")?.result;
  const renderRegions = (cell: RuntimeCell): RegisteredRegionUpdate => {
    const selected = first?.renderRegions?.(cell);
    return { routeId: route.routeId, trail: runtimeSnapshot(route.composition.header.data) as unknown as RuntimeJson,
      regions: { "page-module": selected?.regions["page-module"] ?? [] }, chunks: descriptors,
      ...(renderActions ? { headerActions: renderActions({ compact: false }) } : {}),
      ...("regions" in page.options.page && page.options.page.regions.inspector ? { inspectorContext: read(page.options.page.regions.inspector)?.value } : {}) };
  };
  return { status: "stream", findings: [], chunks, renderRegions, regionHash: runtimeHash({ route: route.routeId, chunks: chunks.map(({ id, result }, index) => [id, descriptors[index]!.status, result.regionHash ?? null]) }),
    ...(page.frameState() ? { routeState: page.frameState() } : {}) };
}
const plainDisplay = Symbol("plain display, never authenticated");
const verifiedNode = Symbol("verified Node source operation");
type PlainDisplayContext = { readonly token: typeof plainDisplay | typeof verifiedNode; readonly derivation?: Extract<PlainRegisteredRouteProjection["routes"][number], { kind: "derived-route-view" }>["derivation"] };
function prepareRoute(registry: RouteRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions, display?: PlainDisplayContext, lowered?: Extract<RepeatedSectionsResult, { status: "ready" }>): PreparedStaticRoute {
  try {
    if (!registry || "kind" in registry || "authentication" in registry) return { status: "refused", findings: ["Plain projections are not authenticated registries"] };
    if (display?.token === plainDisplay && (runtime.source || runtime.designerQuery || runtime.assembly.query)) return { status: "refused", findings: ["Plain display cannot accept a receipt or query proof"] };
    const routes = registry.routes.filter(route => route.routeId === routeId);
    if (routes.length !== 1) return { status: "refused", findings: ["Exactly one registered route is required"] };
    const route = routes[0]!; let binding = route.composition.binding;
    const brand = registeredRouteBrandLink(registry, route);
    if (!brand) return { status: "refused", findings: ["Exact registered brand home link is unavailable"] };
    if (!runtime || !only(runtime, ["assembly", "instanceLibrary", "registries", "layoutRenderer", "cell", "headerActions", "designerQuery", "source", "page", "itemPath"]) || !only(runtime.assembly, ["identity", "engine", "contracts", "ports", "themes", "states", "breakpointPixels", "breakpointBasis", "css", "assets", "runner", "stage", "stageMeasurements", "query"]) || !only(runtime.assembly.ports, ["manifest", "renderers", "resolveContent", "frameOrder", "stageActions", "frameHost", "sectionHosts"])) return { status: "refused", findings: ["Host runtime contains an unknown page/body escape"] };
    if (runtime.itemPath !== undefined && (!route.path.endsWith("/[l0]/[id]") || typeof runtime.itemPath !== "string")) return { status: "refused", findings: ["Concrete item path requires its registered item route"] };
    let materialization: RouteRuntimeMaterialization | undefined;
    let assembly = runtime.assembly;
    if (binding.body?.source.kind === "derived" && display?.token !== plainDisplay) {
      if (!runtime.designerQuery) return { status: "pending", findings: ["Fixed Designer query/current original provider inputs unavailable"] };
      if (display?.token !== verifiedNode && liveDesignerQueries.get(runtime.designerQuery) !== runtimeHash(runtime.designerQuery.input.projection)) return { status: "pending", findings: ["Actual mounted original Designer provider association unavailable"] };
      if (assembly.query) return { status: "refused", findings: ["Host cannot supply a query result or assembly seal"] };
      const result = materializeRegisteredDesignerRoute(binding, assembly.engine, runtime.registries, runtime.instanceLibrary, runtime.designerQuery);
      if (result.status !== "materialized") return result;
      materialization = result.materialization; binding = materialization.binding;
      // Node-verified evidence, or evidence this client minted from a checked bootstrap
      // (materializeRegisteredRouteSourceEvidence). The Node entry already required
      // Node-verified evidence before reaching here.
      if (!runtime.source || !isCurrentRegisteredRouteLiveSourceEvidence(runtime.source, registry, route, materialization.digest)) return { status: "pending", findings: ["Current reached original provider/query source materialization evidence unavailable"] };
      if (!assembly.stage) return { status: "pending", findings: ["Exact derived body Stage unavailable"] };
      const originals = assembly.ports.resolveContent;
      const content = new Map(result.contents.map(value => [runtimeHash(value.reference), value]));
      for (const value of result.contents) { const previous = originals(value.reference); if (previous && runtimeHash(previous) !== runtimeHash(value)) return { status: "refused", findings: ["Original content conflicts with fixed query materialization"] }; }
      assembly = { ...assembly, stage: { ...assembly.stage, bodyDigest: runtimeHash(binding.body), labels: result.labels, ...(binding.body?.kind === "flow" ? { state: {} } : {}) }, ports: { ...assembly.ports, resolveContent: ref => content.get(runtimeHash(ref)) ?? originals(ref) } };
    } else if (runtime.designerQuery) return { status: "refused", findings: ["Static route cannot accept a Designer query"] };
    const page = runtime.page;
    if (page && (page.options.path !== route.path || page.options.page.instanceId !== binding.instanceId || binding.body?.source.kind === "derived")) return { status: "refused", findings: ["Page session is outside its registered static page"] };
    if (page && !lowered && !("regions" in page.options.page) && runtimeHash(page.options.page) !== runtimeHash(route.composition.binding)) return { status: "refused", findings: ["Page loader session differs from its registered binding"] };
    const originalContent = assembly.ports.resolveContent;
    const read = (reference: ContentRef): RuntimeContent | undefined => {
      const current = page?.read(reference);
      if (current?.status === "ready") return current.content;
      return reference.lazy ? undefined : originalContent(staticContentReference(reference));
    };
    const normalized = lowered ?? normalizeRepeatedSections(binding, read);
    if (normalized.status !== "ready") return normalized;
    binding = normalized.binding;
    if (Object.values(normalized.lazy).some(reference => read(reference) === undefined)) return { status: "pending", findings: ["Requested page chunk content is pending"] };
    const outlineContent = new Map<string, RuntimeJson>();
    if (page) {
      const headings = (nodes: typeof page.outline.headings): RuntimeJson[] => nodes.flatMap(node => [{ id: node.id, label: node.label, level: node.level }, ...headings(node.children ?? [])]);
      for (const fill of [...Object.values(binding.fills).flat(), ...Object.values(binding.frame.slotFills ?? {})]) if (fill.section === "sections.table-of-contents") {
        if (fill.content.headings) outlineContent.set(contentReferenceKey(fill.content.headings), headings(page.outline.headings));
        const active = page.activeAnchor() ?? page.outline.anchors[0];
        if (fill.content["active-id"] && active) outlineContent.set(contentReferenceKey(fill.content["active-id"]), active);
      }
    }
    assembly = { ...assembly, ports: { ...assembly.ports, resolveContent: reference => {
      const derived = outlineContent.get(contentReferenceKey(reference));
      if (derived !== undefined) return { reference: staticContentReference(reference), value: derived, hash: runtimeHash(derived) };
      const key = contentReferenceKey(reference), value = read(normalized.lazy[key] ?? reference);
      if (!value || !page) return value;
      const command = binding.frame.content?.command;
      if (command && contentReferenceKey(command) === key && value.value && typeof value.value === "object" && !Array.isArray(value.value)) {
        const commandValue = { ...value.value, groups: page.commandGroups() } as unknown as RuntimeJson;
        return { reference: staticContentReference(reference), value: commandValue, hash: runtimeHash(commandValue) };
      }
      return value;
    } } };
    const bodyFindings = instanceBodyFindings(binding, runtime.registries);
    if (bodyFindings.length) return { status: "refused", findings: bodyFindings };
    if (registry.consumer !== binding.context.consumer || binding.path !== route.path) return { status: "refused", findings: ["Registered consumer/instance identity differs"] };
    const selected = display?.token === plainDisplay ? resolveSelectedRouteRuntimeBinding(binding, assembly.engine, assembly.ports.manifest) : deriveRouteRuntimeBinding(materialization ? route.composition.binding : binding, assembly.engine, assembly.ports.manifest, materialization);
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
    let capturedFrame: RuntimeRenderInput<ReactNode> | undefined;
    const renderers = { ...assembly.ports.renderers, [frame.renderer.id]: (current: Parameters<typeof originalFrame>[0]) => {
      const forward = (value: typeof current) => {
        const host = page && value.host ? { ...value.host,
          navigate: (href: string) => href.startsWith("#") ? page.navigate(href) : value.host!.navigate(href),
          onCommandQueryChange: (query: string) => { void page.search(query).catch(() => {}); },
        } : value.host;
        const next = { ...value, ...(host ? { host } : {}) }; capturedFrame = next; return originalFrame(next);
      };
      if (!current.stage) return forward(current);
      const stage = current.stage;
      const sectionNodes = Object.fromEntries(stage.sectionNodes.map(row => [frameSectionRefKey(row.reference), { label: row.label, node: row.node }]));
      const main = "layout" in stage
        ? <FrameStage body={stage.body} sectionNodes={sectionNodes} contract={stage.contract} aria-label={stage.label} layout={stage.layout} cell={stage.cell} profile={stage.profile} />
        : <FrameStage body={stage.body} sectionNodes={sectionNodes} contract={stage.contract} collapseBelowPx={stage.collapseBelowPx} aria-label={stage.label}
        camera={{ ...stage.camera, onViewportChange: stage.onViewportChange }} modules={stage.modules} currentBoardId={stage.currentBoardId} onCurrentBoardChange={stage.onCurrentBoardChange} />;
      return forward({ ...current, slots: { ...current.slots, main: [main] } });
    } };
    if (page) for (const fill of fills.filter(fill => fill.kind === "section")) {
      const original = renderers[fill.renderer.id]; if (!original) continue;
      renderers[fill.renderer.id] = current => {
        const existing = current.sectionHost ?? {};
        if (current.fill.leaf === "sections.table-of-contents") return original({ ...current, sectionHost: { ...existing,
          navigate: (anchor: string) => page.navigate(anchor.startsWith("#") ? anchor : `#${anchor}`), onActiveChange: (anchor: string) => page.scrollSpy(anchor) } });
        if (current.fill.leaf !== "sections.data-table") return original(current);
        const scope = normalized.scopes[current.path];
        const matches = Object.values(page.outline.targets).filter(target => scope && samePlacement(target.section, scope, page.options.publication?.publication.mainSlot));
        const l0 = scope?.l0 ?? (new Set(matches.map(target => target.l0)).size === 1 ? matches[0]?.l0 : undefined);
        if (!l0) throw new TypeError("Data-table selection requires its manifest L0 scope");
        return original({ ...current, sectionHost: page.selectionHost(l0, existing) });
      };
    }
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
    if (prepared.status !== "ready") return prepared;
    const renderRegions = page?.options.publication ? (cell: RuntimeCell): RegisteredRegionUpdate => {
      capturedFrame = undefined; prepared.assembly.render(cell);
      if (!capturedFrame) throw new TypeError("Selected publication frame was not reached");
      const current = capturedFrame as RuntimeRenderInput<ReactNode>;
      return { routeId, trail: runtimeSnapshot(route.composition.header.data) as unknown as RuntimeJson,
        regions: { main: current.slots.main ?? [], "page-module": current.slots["page-module"] ?? [] },
        ...(renderActions ? { headerActions: renderActions({ compact: false }) } : {}),
        ...(page.options.page && "regions" in page.options.page && page.options.page.regions.inspector ? { inspectorContext: read(page.options.page.regions.inspector)?.value } : {}) };
    } : undefined;
    const regionHash = renderRegions ? runtimeHash({ routeId, sections: input.binding.sections, frameSlots: input.binding.frameSlots, header: route.composition.header.data,
      actions: runtime.headerActions?.state ?? null,
      content: [...Object.values(input.binding.sections).flat(), ...Object.values(input.binding.frameSlots).flat()].flatMap(fill => Object.values(fill.content).map(reference => [contentReferenceKey(reference), assembly.ports.resolveContent(reference)?.hash ?? null])),
      inspector: page?.options.page && "regions" in page.options.page && page.options.page.regions.inspector ? read(page.options.page.regions.inspector)?.hash ?? null : null }) : undefined;
    return { ...prepared, input, ...(materialization ? { materialization } : {}), ...(renderRegions ? { renderRegions, regionHash } : {}) };
  } catch { return { status: "refused", findings: ["Invalid registered route runtime inputs"] }; }
}
export type RegisteredRoutePageProps = { readonly registry: RouteRegistry | RegionPageRouteRegistry; readonly routeId: string; readonly useRuntime: RegisteredRouteRuntimeHook; readonly renderActions?: RegisteredRouteHeaderActions; readonly publication?: import("./registered-route-query.js").RegisteredPublicationSession };
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
