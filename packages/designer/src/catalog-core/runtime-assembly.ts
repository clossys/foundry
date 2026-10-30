import { isSurfacePackageEntry, surfaceEntryOf } from "./surface-library.js";
import { surfaceRuntimeIdentity } from "./surface-check.js";
import { libraryHash, resolve } from "./api.js";
import { isObservationPending } from "./check-components.js";
import { checkConsumerRuntimePorts, isRuntimeDigest, runtimeHash, runtimeSnapshot, runtimeSourceFindings, runtimeStageModuleIdentity, SECTION_HEADER_CONTENT_KEY } from "./runtime-ports.js";
import type { ConsumerRuntimePorts, RuntimeCell, RuntimeContent, RuntimeContentRef, RuntimeDigest, RuntimeFillDescriptor, RuntimeJson, RuntimeRendererDescriptor, RuntimeFramePageHeader, RuntimeStageDescriptor, RuntimeFrameStage } from "./runtime-ports.js";
import type { BuildCatalogData, CompositeEngineInput, CompositeResolved } from "./types.js";
import type { CompositionBody, CanvasBody, FlowBody } from "./body-substrate.js";
import { bodySubstrateFindings } from "./body-substrate.js";

export interface RuntimeFillSelection {
  readonly leaf: `frames.${string}` | `sections.${string}`;
  readonly fill: string;
  readonly config: string | null;
  readonly members: readonly string[];
  readonly content: Readonly<Record<string, RuntimeContentRef>>;
  /**
   * Sections nested inside this one, in reading order: only for a parent that each child's contract names as
   * its `anatomy.band` (sections.band). Each child resolves at `<path>.children.<index>` and reaches the parent
   * renderer as `slots.children`.
   */
  readonly children?: readonly RuntimeFillSelection[];
}
export interface RuntimeAssemblyBinding {
  readonly id: string;
  readonly frame: RuntimeFillSelection;
  /** Additional section fills in a frame's consent/context or other declared slots. */
  readonly frameSlots: Readonly<Record<string, readonly RuntimeFillSelection[]>>;
  readonly sections: Readonly<Record<string, readonly RuntimeFillSelection[]>>;
  /** Canonical body references, retained in exact runtime evidence. */
  readonly body?: CompositionBody<{ readonly slot: string; readonly index: number }>;
}
export interface RuntimeLayoutDescriptor {
  readonly library: string;
  readonly fill: string;
  readonly leaf: `layouts.${string}`;
  readonly config: string;
  readonly members: Readonly<Record<string, string>>;
  readonly slots: readonly { readonly id: string; readonly min: number; readonly max: number; readonly accepts: readonly `sections.${string}`[] }[];
  readonly breakpoints: readonly `tokens.breakpoint.${string}`[];
  readonly states: readonly string[];
  readonly renderer: RuntimeRendererDescriptor;
  /** Finite execution inputs projected from the canonical instance (e.g. tile
   * spans). These are snapshot data, never an editable second composition. */
  readonly inputs?: RuntimeJson;
}
/** Publisher or another caller owns layout behavior and its closed layout contract. */
export interface RuntimeLayoutPort<Node> {
  readonly descriptor: RuntimeLayoutDescriptor;
  render(input: { readonly slots: Readonly<Record<string, readonly Node[]>>; readonly cell: RuntimeCell; readonly profile: CompositeResolved; readonly stageWidth: number }): Node;
  /** Exact paths in expected reading order for this cell; bound into the snapshot. */
  expectedOrder(cell: RuntimeCell, paths: Readonly<Record<string, readonly string[]>>, stageWidth: number): readonly string[];
}
/** Actual Stage geometry is independent of the viewport audit cell and tokens. */
export interface RuntimeStageMeasurementBasis {
  readonly renderer: RuntimeRendererDescriptor;
  readonly environment: RuntimeJson;
  readonly cells: readonly { readonly cell: RuntimeCell; readonly width: number }[];
}
/** Derived output stays solely in binding; this seals the implementation and
 * original finite controller state against the current selected input/output. */
export interface RuntimeBodyQueryBinding {
  readonly id: string;
  readonly version: number;
  readonly renderer: RuntimeRendererDescriptor;
  readonly state: RuntimeJson;
  readonly inputHash: RuntimeDigest;
  readonly outputHash: RuntimeDigest;
}
export type RuntimeAssemblyIdentity =
  | { readonly kind: "git"; readonly head: string; readonly tree: string }
  | { readonly kind: "artifact"; readonly name: string; readonly sha256: RuntimeDigest };
export interface RuntimeAssemblyBase<Node> {
  readonly identity: RuntimeAssemblyIdentity;
  readonly engine: CompositeEngineInput;
  readonly contracts: BuildCatalogData;
  readonly ports: ConsumerRuntimePorts<Node>;
  readonly binding: RuntimeAssemblyBinding;
  readonly stage?: RuntimeStageDescriptor;
  readonly stageMeasurements?: RuntimeStageMeasurementBasis;
  readonly query?: RuntimeBodyQueryBinding;
  readonly themes: readonly string[];
  readonly states: readonly string[];
  /** Measured pixels for non-pixel consumer units; no assumed root font size. */
  readonly breakpointPixels?: Readonly<Record<string, number>>;
  readonly breakpointBasis?: { readonly renderer: RuntimeRendererDescriptor; readonly environment: RuntimeJson };
  readonly css: readonly { readonly id: string; readonly contents: string }[];
  readonly assets: readonly { readonly id: string; readonly mediaType: string; readonly bytes: readonly number[] }[];
  /** Explicit measurement implementation identity; the callback is supplied separately. */
  readonly runner?: RuntimeRendererDescriptor;
  /** A typed lease consumed inside the selected Frame provider. */
  readonly pageHeader?: RuntimeFramePageHeader<Node>;
}
export type RuntimeFlowAssemblyInput<Node> = RuntimeAssemblyBase<Node> & { readonly layout: RuntimeLayoutPort<Node>; readonly binding: Omit<RuntimeAssemblyBinding, "body"> & { readonly body?: FlowBody<{ readonly slot: string; readonly index: number }> } };
export type RuntimeCanvasAssemblyInput<Node> = RuntimeAssemblyBase<Node> & { readonly layout?: never; readonly stage: RuntimeStageDescriptor; readonly binding: Omit<RuntimeAssemblyBinding, "body"> & { readonly body: CanvasBody<{ readonly slot: string; readonly index: number }> } };
export type RuntimeAssemblyInput<Node> = RuntimeFlowAssemblyInput<Node> | RuntimeCanvasAssemblyInput<Node>;
export interface RuntimeAssemblySnapshot {
  readonly version: 1;
  readonly hash: RuntimeDigest;
  readonly data: RuntimeJson;
  readonly cells: readonly RuntimeCell[];
  readonly breakpoints: Readonly<Record<string, number>>;
  readonly expectedOrder: Readonly<Record<string, readonly string[]>>;
  readonly measuredPaths: readonly string[];
  /** Empty until measured; never populated from viewport or observed DOM order. */
  readonly stageWidths?: Readonly<Record<string, number>>;
  readonly stageBasisHash?: RuntimeDigest;
  readonly orderPending?: readonly string[];
}
export interface RuntimeAssembly<Node> {
  readonly snapshot: RuntimeAssemblySnapshot;
  render(cell: RuntimeCell): Node;
}
export type RuntimeAssemblyResult<Node> = { readonly status: "ready"; readonly assembly: RuntimeAssembly<Node>; readonly findings: readonly [] }
  | { readonly status: "pending" | "refused"; readonly findings: readonly string[] };
class AssemblyFault extends Error { constructor(readonly status: "pending" | "refused", message: string) { super(message); } }
function fail(status: "pending" | "refused", message: string): never { throw new AssemblyFault(status, message); }
/** Anatomy header copy against the header contract's slots: known keys only, required present, copy as text, bounded actions. */
function sectionHeaderFinding(value: RuntimeJson, slots: readonly { readonly name: string; readonly type: string; readonly required?: boolean; readonly max?: number }[], tableMetadata = false): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "header anatomy copy must be one object";
  const record = value as Readonly<Record<string, RuntimeJson>>;
  const metadata = tableMetadata ? ["count", "level", "id"] : [];
  const unknown = Object.keys(record).filter(key => !slots.some(slot => slot.name === key) && !metadata.includes(key));
  if (unknown.length) return `header anatomy has no ${unknown.sort().join(", ")} slot`;
  if (tableMetadata) {
    if (record.count !== undefined && !(typeof record.count === "string" && record.count.trim() || typeof record.count === "number" && Number.isInteger(record.count) && record.count >= 0)) return "header anatomy count must be nonnegative integer or resolved text";
    if (record.level !== undefined && !(typeof record.level === "number" && Number.isInteger(record.level) && record.level >= 2 && record.level <= 6)) return "header anatomy level must be an integer from 2 to 6";
    if (record.id !== undefined && !(typeof record.id === "string" && record.id.length > 0 && !/[\s#]/.test(record.id))) return "header anatomy id must be an anchor without whitespace or hash";
  }
  for (const slot of slots) {
    const field = record[slot.name];
    if (field === undefined) { if (slot.required) return `header anatomy ${slot.name} is required`; continue; }
    if (slot.type === "copy" && (typeof field !== "string" || !field.trim())) return `header anatomy ${slot.name} must be non-empty text`;
    if (slot.type === "action" && (!Array.isArray(field) || !field.length || slot.max !== undefined && field.length > slot.max || field.some(action => !action || typeof action !== "object" || Array.isArray(action)))) return `header anatomy ${slot.name} must list 1-${slot.max ?? "n"} action records`;
  }
  return undefined;
}
export function runtimeCellKey(cell: RuntimeCell): string { return JSON.stringify([cell.theme, cell.state, cell.width]); }

/** 320 and every resolved consumer breakpoint ±1; never substitute catalog numbers. */
export function runtimeAssemblyCells(profile: CompositeResolved, themes: readonly string[], states: readonly string[], requiredBreakpoints: readonly string[] = [], measuredPixels: Readonly<Record<string, number>> = {}): readonly RuntimeCell[] {
  for (const [name, values] of [["themes", themes], ["states", states]] as const) if (!values.length || values.some(value => typeof value !== "string" || !value.trim()) || new Set(values).size !== values.length) fail("pending", `explicit unique ${name} required`);
  const members = Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint."));
  if (!members.length || requiredBreakpoints.some(id => !profile.values.members[id])) fail("pending", "consumer breakpoint values missing");
  const widths = new Set([320]);
  for (const [id, member] of members) {
    const value = member.value.light;
    if (!value || typeof value !== "object" || Array.isArray(value) || !("unit" in value) || !("value" in value) || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value <= 0) fail("pending", `unresolved consumer breakpoint ${id}`);
    const pixels = value.unit === "px" ? value.value : measuredPixels[id];
    if (value.unit === "px" && measuredPixels[id] !== undefined && measuredPixels[id] !== pixels) fail("refused", `conflicting pixel breakpoint ${id}`);
    if (typeof pixels !== "number" || !Number.isSafeInteger(pixels) || pixels <= 1 || pixels > 100000) fail("pending", `measured pixel breakpoint required: ${id}`);
    for (const width of [pixels - 1, pixels, pixels + 1]) widths.add(width);
  }
  return runtimeSnapshot(themes.flatMap(theme => states.flatMap(state => [...widths].sort((a, b) => a - b).map(width => ({ theme, state, width })))));
}
/** Resolve and freeze all data before invoking renderer or runner callbacks. */
export function prepareRuntimeAssembly<Node>(input: RuntimeAssemblyInput<Node>): RuntimeAssemblyResult<Node> {
  try {
    const identity = runtimeSnapshot(input.identity);
    if (identity.kind === "git" ? !/^[a-f0-9]{40}$/.test(identity.head) || !/^[a-f0-9]{40}$/.test(identity.tree) : identity.kind !== "artifact" || !identity.name?.trim() || !isRuntimeDigest(identity.sha256)) fail("pending", "exact source head/tree or artifact identity required");
    const library = runtimeSnapshot(input.engine.library);
    const wholeHash = libraryHash(library);
    const profile = runtimeSnapshot(resolve({ ...input.engine, library }));
    if (!profile.check.ok || profile.check.findings.some(f => f.severity === "error")) fail("refused", "consumer library checks failed");
    // Adoption admits absent component observations; a runtime assembly never runs without them.
    const unobserved = [...new Set(profile.check.findings.filter(isObservationPending).map(f => f.subject))].sort();
    if (unobserved.length) fail("pending", `component runtime observations required: ${unobserved.join(", ")}`);
    const check = checkConsumerRuntimePorts(input.ports, input.contracts, { consumer: profile.consumer, libraryHash: wholeHash, selectionHash: profile.selectionHash });
    if (check.status !== "valid") fail("refused", check.findings.map(f => `${f.path}: ${f.message}`).join("; "));
    const manifest = runtimeSnapshot(input.ports.manifest), binding = runtimeSnapshot(input.binding), layout = input.layout && runtimeSnapshot(input.layout.descriptor);
    const canvas = binding.body?.kind === "canvas", stage = input.stage && runtimeSnapshot(input.stage);
    if (canvas && input.layout !== undefined) fail("refused", "canvas cannot substitute a flow Layout");
    if (!canvas && !layout) fail("refused", "flow requires its exact selected Layout");
    if (canvas && !stage) fail("pending", "canvas requires the canonical Stage module");
    if (!profile.surfaces && manifest.fills.some(fill => fill.surface !== undefined)) fail("refused", "S7 surface record without an owned selected surface");
    if(profile.surfaces){
      for(const descriptor of manifest.fills){
        const row=profile.surfaces.fills[descriptor.leaf];
        if(!row||descriptor.fill!==row.document.$extensions["com.clossys.fill"].id||!descriptor.surface||runtimeHash(descriptor.surface)!==runtimeHash(surfaceRuntimeIdentity(row)))fail("refused","S7 stale, orphan or foreign surface record");
        const entry=surfaceEntryOf(row.document);
        if(isSurfacePackageEntry(entry)){
          // A package pointer carries its contract support (slots, members, configs) but no states or module bytes:
          // runtime qualification belongs to the pinned package release, the same notice rule the check applies.
          const kind=entry.slot.startsWith("sections.")?"section":"frame",slots=Object.keys("slotMap" in entry?entry.slotMap:entry.slots).sort(),members="members" in entry?entry.members:Object.keys(entry.propMap);
          if(kind!==descriptor.kind||runtimeHash([...descriptor.slots].sort())!==runtimeHash(slots)||descriptor.members.some(member=>!members.includes(member)))fail("refused","S7 surface contract support differs");
          if(descriptor.config!==null&&("configs" in entry?!Object.hasOwn(entry.configs,descriptor.config):!descriptor.members.includes(descriptor.config)))fail("refused","S7 surface config differs");
          continue;
        }
        const fill=entry;const slots=Object.keys(fill.kind==="section"?fill.slotMap:fill.slots).sort();
        if(fill.kind!==descriptor.kind||runtimeHash([...descriptor.slots].sort())!==runtimeHash(slots)||runtimeHash([...descriptor.states].sort())!==runtimeHash([...fill.states].sort())||descriptor.members.some(member=>!fill.members.includes(member)))fail("refused","S7 surface contract support differs");
        if(fill.kind==="section"&&descriptor.config!==null){const config=fill.configs[descriptor.config];if(!config||runtimeHash([...config.members].sort())!==runtimeHash([...descriptor.members].sort()))fail("refused","S7 surface config differs");}
        if(fill.kind==="frame"&&descriptor.config!==null&&!descriptor.members.includes(descriptor.config))fail("refused","S7 unsupported frame configuration");
        const measurements=input.engine.surfaceOptions?.measurements.filter(measurement=>measurement.slot===fill.slot&&runtimeHash(measurement.identity)===runtimeHash(descriptor.surface));
        if(measurements?.length!==1||!measurements[0]!.runtime)fail("pending","S8 independent surface module runtime evidence missing");
        const measurement=measurements[0]!;
        if(runtimeHash(measurement.runtime!.renderer)!==runtimeHash(descriptor.renderer)||runtimeHash(measurement.compiled)!==runtimeHash(descriptor.renderer.source))fail("refused","S7 runtime compiled closure differs");
      }
    }
    if (!binding.id?.trim() || layout && (layout.library !== profile.consumer || !layout.fill?.trim() || !layout.leaf.startsWith("layouts.") || !layout.config?.trim())) fail("refused", "foreign or missing layout/binding identity");
    if (layout && runtimeSourceFindings(layout.renderer).length) fail("refused", "layout source binding invalid");
    if (layout && (typeof input.layout?.render !== "function" || typeof input.layout?.expectedOrder !== "function")) fail("pending", "layout render and order ports required");
    if (input.runner && runtimeSourceFindings(input.runner).length) fail("refused", "runner source binding invalid");
    const css = runtimeSnapshot(input.css), assets = runtimeSnapshot(input.assets);
    if (!css.length || css.some(file => !file.id || typeof file.contents !== "string" || !file.contents.trim())) fail("pending", "explicit CSS bytes required");
    if (new Set(css.map(file => file.id)).size !== css.length || new Set(assets.map(file => file.id)).size !== assets.length || assets.some(asset => !asset.id || !asset.mediaType || !asset.bytes.length || asset.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))) fail("refused", "invalid CSS or asset bytes");
    if (manifest.assetClosure.complete !== true) fail("pending", "complete runtime asset closure required");
    const componentAssets = Object.values(profile.components.components).flatMap(component => component.reads.assets);
    if (componentAssets.some(id => !manifest.assetClosure.ids.includes(id))) fail("pending", "component asset missing from runtime closure");
    const glyphs: Record<string, unknown> = {};
    for (const id of manifest.assetClosure.ids) {
      const members = Object.values(profile.values.members).filter(member => member.slot === id);
      const glyph = members.find(member => member.$type === "glyph");
      if (glyph) glyphs[id] = glyph.value.light;
      else if (!assets.some(asset => asset.id === id)) fail("pending", `concrete runtime asset bytes missing: ${id}`);
    }
    const requiredBreakpoints = [...(layout?.breakpoints ?? []), ...(canvas ? [(binding.body as CanvasBody<unknown>).collapseBelow] : [])];
    const frameContract = input.contracts.slots.find(slot => slot.id === binding.frame.leaf)?.contract;
    if (frameContract?.kind !== "frame") fail("refused", "frame contract missing");
    if (binding.body) {
      const findings = bodySubstrateFindings(binding.body, frameContract.stage, reference => {
        const selected = binding.sections[reference.slot]?.[reference.index];
        const contract = selected && input.contracts.slots.find(slot => slot.id === selected.leaf)?.contract;
        return contract && contract.kind === "section" && contract.substrates ? { substrates: contract.substrates, substrateTests: contract.substrateTests } : undefined;
      });
      if (findings.length) fail("refused", findings.join("; "));
    }
    requiredBreakpoints.push(...frameContract.breakpoints);
    const breakpointPixels = runtimeSnapshot(input.breakpointPixels ?? {});
    const tokenBreakpoints = Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")));
    if (Object.entries(breakpointPixels).some(([id, pixels]) => !tokenBreakpoints[id] || !Number.isSafeInteger(pixels) || pixels <= 1 || pixels > 100000)) fail("refused", "unused or invalid measured breakpoint input");
    if (Object.keys(breakpointPixels).length && (!input.breakpointBasis || runtimeSourceFindings(input.breakpointBasis.renderer).length)) fail("pending", "breakpoint measurement basis required");
    const breakpoints = Object.fromEntries(Object.entries(tokenBreakpoints).map(([id, member]) => {
      const value = member.value.light;
      return [id, value && typeof value === "object" && "unit" in value && "value" in value && value.unit === "px" ? value.value : breakpointPixels[id]];
    })) as Record<string, number>;
    const cells = runtimeAssemblyCells(profile, runtimeSnapshot(input.themes), runtimeSnapshot(input.states), requiredBreakpoints, runtimeSnapshot(input.breakpointPixels ?? {}));
    if (layout && cells.some(cell => !layout.states.includes(cell.state))) fail("refused", "layout does not support requested state");
    const stageMeasurements = input.stageMeasurements && runtimeSnapshot(input.stageMeasurements);
    const stageWidths: Record<string, number> = {};
    if (stageMeasurements) {
      if (Object.keys(stageMeasurements).sort().join(",") !== "cells,environment,renderer" || runtimeSourceFindings(stageMeasurements.renderer).length) fail("refused", "Stage measurement source/environment identity invalid");
      for (const row of stageMeasurements.cells) {
        const key = runtimeCellKey(row.cell);
        if (Object.keys(row).sort().join(",") !== "cell,width" || !cells.some(cell => runtimeCellKey(cell) === key) || stageWidths[key] !== undefined || !Number.isFinite(row.width) || row.width <= 0) fail("refused", "invalid or duplicate actual Stage width");
        stageWidths[key] = row.width;
      }
    }
    const contentSnapshot: Record<string, Readonly<Record<string, RuntimeContent>>> = {};
    const descriptors: Record<string, RuntimeFillDescriptor> = {};
    const renderers = { ...input.ports.renderers };
    // Behaviour, not data: shape-checked by checkConsumerRuntimePorts, frozen, never snapshotted or hashed.
    const frameHost = input.ports.frameHost && Object.freeze({ ...input.ports.frameHost });
    const sectionHosts = Object.freeze({ ...input.ports.sectionHosts });
    const componentIndex = input.ports.componentIndex;
    const selections: Record<string, RuntimeFillSelection> = {};
    const childPaths: Record<string, readonly string[]> = {};
    const resolveFill = (selected: RuntimeFillSelection, path: string, kind: "frame" | "section"): void => {
      const fill = manifest.fills.find(fill => fill.leaf === selected.leaf && fill.config === selected.config && fill.fill === selected.fill && fill.kind === kind);
      if (!fill) fail("pending", `${path}: exact consumer runtime fill missing`);
      if (cells.some(cell => !fill.states.includes(cell.state)) || selected.members.some(member => !fill.members.includes(member)) || new Set(selected.members).size !== selected.members.length) fail("refused", `${path}: unsupported members or states`);
      if(profile.surfaces){const owned=surfaceEntryOf(profile.surfaces.fills[fill.leaf]!.document);if(!isSurfacePackageEntry(owned)&&owned.kind==="section"&&selected.config!==null&&runtimeHash([...selected.members].sort())!==runtimeHash([...owned.configs[selected.config]!.members].sort()))fail("refused",`${path}: S7 selected config members differ`);}
      const contract = input.contracts.slots.find(slot => slot.id === fill.leaf)?.contract;
      if (!contract || (contract.kind !== "frame" && contract.kind !== "section")) fail("refused", `${path}: contract unavailable`);
      const allowed = contract.kind === "section" ? contract.slots.map(slot => slot.name) : contract.slots.filter(slot => slot.accepts === "host-node").map(slot => slot.id);
      const required = contract.kind === "section" ? contract.slots.filter(slot => slot.required).map(slot => slot.name) : contract.slots.filter(slot => slot.required && slot.accepts === "host-node").map(slot => slot.id);
      // Anatomy header copy rides one reserved key when the contract names a header part and has no slot of that name.
      const headerLeaf = contract.kind === "section" && !allowed.includes(SECTION_HEADER_CONTENT_KEY) ? contract.anatomy?.header ?? null : null;
      const headerContract = headerLeaf === null ? undefined : input.contracts.slots.find(slot => slot.id === headerLeaf)?.contract;
      const isHeader = (name: string) => headerLeaf !== null && name === SECTION_HEADER_CONTENT_KEY;
      if (Object.keys(selected.content).some(name => !isHeader(name) && (!allowed.includes(name) || !fill.slots.includes(name)))) fail("refused", `${path}: unknown content slot`);
      if (Object.keys(selected.content).some(isHeader) && headerContract?.kind !== "section") fail("refused", `${path}: header anatomy contract unavailable`);
      if (required.some(name => !selected.content[name])) fail("pending", `${path}: required content missing`);
      const content: Record<string, RuntimeContent> = {};
      for (const [name, reference] of Object.entries(selected.content)) {
        if (!reference || !reference.ref?.trim() || !["copy", "media", "records", "action", "region"].includes(reference.kind)) fail("refused", `${path}.${name}: invalid content reference`);
        if (contract.kind === "section" && (isHeader(name) ? reference.kind !== "copy" : contract.slots.find(slot => slot.name === name)?.type !== reference.kind)) fail("refused", `${path}.${name}: wrong content kind`);
        const resolved = input.ports.resolveContent(runtimeSnapshot(reference));
        if (!resolved) fail("pending", `${path}.${name}: consumer content unresolved`);
        const current = runtimeSnapshot(resolved);
        if (runtimeHash(current.reference) !== runtimeHash(reference) || current.hash !== runtimeHash(current.value)) fail("refused", `${path}.${name}: stale or foreign content binding`);
        if (current.value === null || current.value === "" || Array.isArray(current.value) && current.value.length === 0) fail("pending", `${path}.${name}: empty required content`);
        if (isHeader(name) && headerContract?.kind === "section") {
          const finding = sectionHeaderFinding(current.value, headerContract.slots, selected.leaf === "sections.data-table");
          if (finding) fail("refused", `${path}.${name}: ${finding}`);
        }
        content[name] = current;
      }
      descriptors[path] = fill; contentSnapshot[path] = runtimeSnapshot(content); selections[path] = selected;
      if (selected.children !== undefined) {
        if (kind !== "section" || !Array.isArray(selected.children) || !selected.children.length) fail("refused", `${path}: children must be a non-empty Section list`);
        childPaths[path] = selected.children.map((child, index) => {
          const at = `${path}.children.${index}`;
          const childContract = input.contracts.slots.find(slot => slot.id === child.leaf)?.contract;
          if (childContract?.kind !== "section" || childContract.anatomy?.band !== selected.leaf) fail("refused", `${at}: ${child.leaf} does not take ${selected.leaf} as its band`);
          resolveFill(child, at, "section"); return at;
        });
      }
    };
    resolveFill(binding.frame, "frame", "frame");
    const stageContent: Record<string, RuntimeContent> = {};
    const stageLabel = (reference: RuntimeContentRef, at: string): string => {
      if (!reference || Object.keys(reference).sort().join(",") !== "kind,ref" || reference.kind !== "copy" || !reference.ref?.trim()) fail("refused", `${at}: Stage label requires an existing copy reference`);
      const resolved = input.ports.resolveContent(reference);
      if (!resolved) fail("pending", `${at}: current Stage label unavailable`);
      const current = runtimeSnapshot(resolved);
      if (runtimeHash(current.reference) !== runtimeHash(reference) || current.hash !== runtimeHash(current.value) || typeof current.value !== "string" || !current.value.trim()) fail("refused", `${at}: stale or invalid Stage label content`);
      stageContent[at] = current; return current.value;
    };
    let label: string | undefined;
    if (stage) {
      if (Object.keys(stage).sort().join(",") !== "bodyDigest,controller,label,labels,module,state" || !binding.body || stage.bodyDigest !== runtimeHash(binding.body)) fail("refused", "Stage must reference the exact canonical body digest");
      if (!stage.module || Object.keys(stage.module).sort().join(",") !== "export,package,renderer" || stage.module.package !== runtimeStageModuleIdentity.package || stage.module.export !== runtimeStageModuleIdentity.export || runtimeSourceFindings(stage.module.renderer).length) fail("refused", "canonical imported Stage source identity required");
      if (!descriptors.frame!.stageModule || runtimeHash(stage.module) !== runtimeHash(descriptors.frame!.stageModule)) fail("refused", "selected Frame Stage module source identity differs");
      if (runtimeSourceFindings(stage.controller).length || Object.keys(stage.state).some(key => !["camera", "modules", "currentBoardId"].includes(key))) fail("refused", "bounded Stage controller source/state required");
      label = stageLabel(stage.label, "stage.label");
      if (canvas) {
        const camera = stage.state.camera;
        if (!camera || Object.keys(camera).sort().join(",") !== "fitPadding,maxZoom,minZoom,viewport" || Object.keys(camera.viewport).sort().join(",") !== "x,y,zoom" || ![camera.viewport.x, camera.viewport.y, camera.viewport.zoom, camera.minZoom, camera.maxZoom, camera.fitPadding].every(Number.isFinite) || camera.minZoom <= 0 || camera.maxZoom < camera.minZoom || camera.viewport.zoom < camera.minZoom || camera.viewport.zoom > camera.maxZoom || camera.fitPadding < 0) fail("refused", "existing finite canvas camera state required");
        if (typeof input.ports.stageActions?.onViewportChange !== "function" || input.ports.stageActions.onCurrentBoardChange !== undefined && typeof input.ports.stageActions.onCurrentBoardChange !== "function") fail("pending", "original Stage camera/current-board controller unavailable");
        const modules = stage.state.modules;
        if (modules && (Object.keys(modules).some(key => !["map", "zoom"].includes(key)) || modules.map && (Object.keys(modules.map).sort().join(",") !== "id,label" || !modules.map.id?.trim() || !modules.map.label?.trim()) || modules.zoom && (Object.keys(modules.zoom).sort().join(",") !== "id,labels" || !modules.zoom.id?.trim() || Object.keys(modules.zoom.labels).sort().join(",") !== "fit,group,in,out,percent" || Object.values(modules.zoom.labels).some(value => !value?.trim())) || modules.map && modules.zoom && modules.map.id === modules.zoom.id)) fail("refused", "bounded registered Stage modules required");
        if (stage.state.currentBoardId !== undefined && !(binding.body as CanvasBody<unknown>).boards.some(board => board.id === stage.state.currentBoardId)) fail("refused", "current board is outside canonical body");
      } else if (Object.keys(stage.state).length) fail("refused", "flow Stage has no canvas camera/module state");
    }
    let pageHeader: RuntimeFramePageHeader<Node> | undefined;
    let headerSnapshot: RuntimeJson = null;
    if (input.pageHeader !== undefined) {
      const header = input.pageHeader;
      const fields = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
      if (!header || !fields(header, ["id", "data", "module", "actions", "brand"]) || !header.id?.trim() || !header.data || !fields(header.data, ["title", "nav"]) || !header.data.title?.trim()) fail("refused", "invalid bounded Frame header lease data");
      if (Object.keys(binding.frame.content).some(slot => /^(?:header|header-start|header-end)$/.test(slot))) fail("refused", "raw Frame header slot cannot replace a PageHeaderModule lease");
      const data = runtimeSnapshot(header.data), module = runtimeSnapshot(header.module);
      const brand = header.brand === undefined ? undefined : runtimeSnapshot(header.brand);
      if (brand && (!fields(brand, ["href", "label"]) || !brand.href?.trim() || !brand.label?.trim())) fail("refused", "invalid bounded Frame brand link");
      if (!module || !fields(module, ["package", "export", "renderer"]) || module.package !== "@clossys/designer/shell" || module.export !== "PageHeaderModule" || runtimeSourceFindings(module.renderer).length) fail("refused", "canonical imported PageHeaderModule identity required");
      if (!descriptors.frame!.headerModule) fail("pending", "selected Frame renderer has no header lease port");
      if (runtimeHash(module) !== runtimeHash(descriptors.frame!.headerModule)) fail("refused", "selected Frame header module source identity differs");
      const nav = data.nav;
      if (nav && (!fields(nav, ["label", "items", "activeId"]) || !nav.label?.trim() || !nav.items.length || new Set(nav.items.map(item => item.id)).size !== nav.items.length || nav.items.some(item => !fields(item, ["id", "label", "href"]) || !item.id?.trim() || !item.label?.trim() || !item.href?.trim()) || !nav.items.some(item => item.id === nav.activeId))) fail("refused", "invalid Frame header navigation");
      let actions: RuntimeFramePageHeader<Node>["actions"];
      let actionSnapshot: RuntimeJson = null;
      if (header.actions !== undefined) {
        if (!fields(header.actions, ["renderer", "state", "render"]) || typeof header.actions.render !== "function" || runtimeSourceFindings(header.actions.renderer).length) fail("refused", "bound Frame header actions require exact source, state and compact render port");
        const renderer = runtimeSnapshot(header.actions.renderer), state = runtimeSnapshot(header.actions.state);
        actionSnapshot = { renderer: renderer as unknown as RuntimeJson, state };
        actions = Object.freeze({ renderer, state, render: header.actions.render });
      }
      headerSnapshot = runtimeSnapshot({ id: header.id, data, module, actions: actionSnapshot, ...(brand ? { brand } : {}) }) as unknown as RuntimeJson;
      pageHeader = Object.freeze({ id: header.id, data, module, ...(brand ? { brand } : {}), ...(actions ? { actions } : {}) });
    }
    const paths: Record<string, string[]> = {};
    if (layout && new Set(layout.slots.map(slot => slot.id)).size !== layout.slots.length) fail("refused", "duplicate layout slots");
    for (const name of Object.keys(binding.sections)) if (layout && !layout.slots.some(slot => slot.id === name)) fail("refused", `unknown layout slot ${name}`);
    const bodySlots = layout?.slots ?? Object.entries(binding.sections).map(([id, fills]) => ({ id, min: 0, max: fills.length, accepts: fills.map(fill => fill.leaf as `sections.${string}`) }));
    for (const slot of bodySlots) {
      if (!Number.isSafeInteger(slot.min) || !Number.isSafeInteger(slot.max) || slot.min < 0 || slot.max < slot.min) fail("refused", "invalid layout count bounds");
      const fills = binding.sections[slot.id] ?? [];
      if (fills.length < slot.min) fail("pending", `${slot.id}: required sections missing`);
      if (fills.length > slot.max) fail("refused", `${slot.id}: too many sections`);
      paths[slot.id] = fills.map((selected, index) => {
        const path = `sections.${slot.id}.${index}`;
        if (!slot.accepts.includes(selected.leaf as `sections.${string}`)) fail("refused", `${path}: section not accepted`);
        resolveFill(selected, path, "section"); return path;
      });
    }
    for (const [slot, fills] of Object.entries(binding.frameSlots)) {
      if (!frameContract.slots.some(item => item.id === slot && item.accepts === "sections.*") || !descriptors.frame!.slots.includes(slot)) fail("refused", `unsupported frame section slot ${slot}`);
      fills.forEach((selected, index) => resolveFill(selected, `frameSlots.${slot}.${index}`, "section"));
    }
    for (const slot of frameContract.slots.filter(slot => slot.required)) if (slot.accepts === "view" ? slot.id !== "main" : slot.accepts === "sections.*" ? !binding.frameSlots[slot.id]?.length : slot.accepts !== "host-node") fail("pending", `required frame slot ${slot.id} missing`);
    const sectionPaths = Object.values(paths).flat();
    if (!sectionPaths.length) fail("pending", "real section content required");
    const references = binding.body ? binding.body.kind === "flow" ? binding.body.sections : binding.body.boards.map(board => board.section) : undefined;
    const referencePaths = references?.map(reference => `sections.${reference.slot}.${reference.index}`);
    if (referencePaths && (referencePaths.length !== sectionPaths.length || new Set(referencePaths).size !== referencePaths.length || referencePaths.some(path => !sectionPaths.includes(path)))) fail("refused", "canonical body must cover every Section reference exactly once");
    const sectionLabels: Record<string, string> = {};
    if (stage) {
      if (Object.keys(stage.labels).length !== sectionPaths.length || Object.keys(stage.labels).some(path => !sectionPaths.includes(path))) fail("refused", "Stage labels must join every exact canonical Section reference");
      for (const path of sectionPaths) sectionLabels[path] = stageLabel(stage.labels[path]!, path);
    }
    let query: RuntimeBodyQueryBinding | undefined;
    if (binding.body?.source.kind === "derived") {
      if (!input.query) fail("pending", "versioned body query source/input/output evidence pending");
      query = runtimeSnapshot(input.query);
      if (Object.keys(query).sort().join(",") !== "id,inputHash,outputHash,renderer,state,version" || query.id !== binding.body.source.query.id || query.version !== binding.body.source.query.version || runtimeSourceFindings(query.renderer).length) fail("refused", "body query implementation/version source identity differs");
      if (query.inputHash !== runtimeHash({ libraryHash: wholeHash, selectionHash: profile.selectionHash, content: contentSnapshot, state: query.state }) || query.outputHash !== runtimeHash({ body: binding.body, sections: binding.sections, frameSlots: binding.frameSlots })) fail("refused", "stale body query input/output digest");
    } else if (input.query) fail("refused", "static body cannot carry a derived query result");
    const framePaths = Object.fromEntries(Object.entries(binding.frameSlots).map(([slot, fills]) => [slot, fills.map((_, index) => `frameSlots.${slot}.${index}`)]));
    const allSectionPaths = [...sectionPaths, ...Object.values(framePaths).flat()];
    if (Object.values(framePaths).some(paths => paths.length) && !input.ports.frameOrder) fail("pending", "frame section reading-order port required");
    const expectedOrder: Record<string, readonly string[]> = {};
    const orderPending: string[] = [];
    for (const cell of cells) {
      const key = runtimeCellKey(cell);
      if (binding.body?.kind === "flow" && stageWidths[key] === undefined) { orderPending.push(key); expectedOrder[key] = []; continue; }
      let boardRefs = references ?? [];
      if (binding.body?.kind === "canvas") {
        if (["graph", "freeform"].includes(binding.body.arrangement.kind)) fail("pending", "canvas arrangement runtime unavailable");
        if (binding.body.arrangement.kind === "lanes") {
          const groupKey = binding.body.arrangement.groupKey, boards = binding.body.boards;
          const groups = [...new Set(boards.map(board => board.groups![groupKey]!))];
          boardRefs = groups.flatMap(group => boards.filter(board => board.groups![groupKey] === group).map(board => board.section));
        }
      }
      const order = canvas ? boardRefs.map(ref => `sections.${ref.slot}.${ref.index}`) : runtimeSnapshot(input.layout!.expectedOrder(cell, runtimeSnapshot(paths), binding.body ? stageWidths[key]! : cell.width));
      if (order.length !== sectionPaths.length || new Set(order).size !== order.length || order.some(path => !sectionPaths.includes(path))) fail("refused", "layout order port omitted or duplicated a fill");
      const wholeOrder = input.ports.frameOrder ? runtimeSnapshot(input.ports.frameOrder({ cell, layout: order, slots: runtimeSnapshot(framePaths) })) : order;
      if (wholeOrder.length !== allSectionPaths.length || new Set(wholeOrder).size !== wholeOrder.length || wholeOrder.some(path => !allSectionPaths.includes(path)) || wholeOrder.filter(path => sectionPaths.includes(path)).some((path, index) => path !== order[index])) fail("refused", "frame order port omitted, duplicated or reordered a fill");
      expectedOrder[key] = wholeOrder;
    }
    if (binding.body?.kind === "flow" && !stage && orderPending.length) fail("pending", "actual measured Stage width/order basis pending");
    const measuredPaths = ["frame", ...Object.keys(descriptors).filter(path => path !== "frame")];
    const data = runtimeSnapshot({ identity, library, wholeHash, selectionHash: profile.selectionHash, profile, manifest, binding, layout,
      contracts: input.contracts, content: contentSnapshot, descriptors, css, assets, glyphs, breakpointPixels, breakpointBasis: input.breakpointBasis ?? null, breakpoints, cells, expectedOrder, measuredPaths, runner: input.runner ?? null, pageHeader: headerSnapshot, stage: stage ?? null, stageContent, stageMeasurements: stageMeasurements ?? null, query: query ?? null });
    const snapshot: RuntimeAssemblySnapshot = runtimeSnapshot({ version: 1, hash: runtimeHash(data), data: data as unknown as RuntimeJson, cells, breakpoints, expectedOrder, measuredPaths, ...(binding.body ? { stageWidths, orderPending, ...(stageMeasurements ? { stageBasisHash: runtimeHash(stageMeasurements) } : {}) } : {}) });
    const render = (cell: RuntimeCell): Node => {
      if (!cells.some(candidate => runtimeCellKey(candidate) === runtimeCellKey(cell))) throw new Error("runtime: cell outside bound matrix");
      const draw = (path: string, slots: Readonly<Record<string, readonly Node[]>> = childPaths[path] ? { children: childPaths[path]!.map(child => draw(child)) } : {}, frameStage?: RuntimeFrameStage<Node>): Node => {
        const fill = descriptors[path]!;
        const sectionHost = path === "frame" || !Object.hasOwn(sectionHosts, fill.leaf) ? undefined : sectionHosts[fill.leaf];
        return renderers[fill.renderer.id]!({ path, fill, selection: selections[path]!, cell: runtimeSnapshot(cell), content: contentSnapshot[path]!, slots, profile, ...(componentIndex ? { componentIndex } : {}), ...(path === "frame" && pageHeader ? { pageHeader } : {}), ...(path === "frame" && frameStage ? { stage: frameStage } : {}), ...(path === "frame" && frameHost ? { host: frameHost } : {}), ...(sectionHost ? { sectionHost } : {}) });
      };
      const slots = Object.fromEntries(Object.entries(paths).map(([slot, values]) => [slot, values.map(path => draw(path))]));
      let frameStage: RuntimeFrameStage<Node> | undefined;
      if (stage && binding.body) {
        const common = { module: stage.module, contract: frameContract.stage!, label: label!, sectionNodes: references!.map(reference => ({ reference, label: sectionLabels[`sections.${reference.slot}.${reference.index}`]!, node: slots[reference.slot]![reference.index]! })), cell: runtimeSnapshot(cell), profile };
        frameStage = binding.body.kind === "flow" ? { ...common, body: binding.body, layout: input.layout! } : { ...common, body: binding.body, collapseBelowPx: breakpoints[binding.body.collapseBelow]!, camera: stage.state.camera!, ...(stage.state.modules ? { modules: stage.state.modules } : {}), ...(stage.state.currentBoardId ? { currentBoardId: stage.state.currentBoardId } : {}), onViewportChange: input.ports.stageActions!.onViewportChange, ...(input.ports.stageActions!.onCurrentBoardChange ? { onCurrentBoardChange: input.ports.stageActions!.onCurrentBoardChange } : {}) };
      }
      const frameSlots: Record<string, readonly Node[]> = {};
      if (!frameStage) {
        const stageWidth = binding.body ? stageWidths[runtimeCellKey(cell)] : cell.width;
        if (stageWidth === undefined) throw new Error("runtime: actual measured Stage width pending");
        frameSlots.main = [input.layout!.render({ slots, cell: runtimeSnapshot(cell), profile, stageWidth })];
      }
      for (const [slot, fills] of Object.entries(binding.frameSlots)) frameSlots[slot] = fills.map((_, index) => draw(`frameSlots.${slot}.${index}`));
      return draw("frame", frameSlots, frameStage);
    };
    return { status: "ready", assembly: Object.freeze({ snapshot, render }), findings: [] };
  } catch (error) {
    return { status: error instanceof AssemblyFault ? error.status : "refused", findings: [error instanceof AssemblyFault ? error.message : "invalid runtime assembly input"] };
  }
}
