import { instanceBodyFindings } from "./instance-body.js";
import type { InstanceBinding as AnyInstanceBinding } from "./instance-binding.js";
import { registeredBindingTemplate } from "./instance-binding.js";
import { analyzeLayoutSource } from "./layout-source.js";
import type { LayoutCompilerPort } from "./layout-source.js";
import { getEffectiveLayoutContract } from "../layouts/index.js";
import type { PageLayoutContract } from "../layouts/contract.js";
import { checkFormatBinding } from "../formats/index.js";
import type {
  BindingToken, ConsumerInstanceFill, ConsumerInstanceLibrary, ContentRef, FlowInstanceBinding as InstanceBinding,
  InstanceCheckCode, InstanceCheckResult, InstanceFinding, InstanceRegistries, LayoutRendererSource, SectionFill,
} from "./instance-binding.js";

const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const active = (leaf: { status: string } | undefined) => leaf?.status === "draft" || leaf?.status === "stable";
const same = (a: unknown, b: unknown) => a === b;
const surface = (declared: string, requested: string) => declared === "both" || declared === requested;
const fields = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const list = (value: unknown): value is string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const result = (findings: InstanceFinding[]): InstanceCheckResult => ({ staticStatus: findings.length ? "refused" : "valid", findings, pendingChecks: ["LK12"] });

/** Reject accessors, cycles, exotic objects and sparse arrays before reading untrusted binding data. */
function plain(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) && Object.getPrototypeOf(value) !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === "length") continue;
    const property = descriptors[key as string]!;
    if (typeof key !== "string" || !property.enumerable || !own(property, "value") || !plain(property.value, seen)) return false;
  }
  seen.delete(value);
  return true;
}
/** One choice per axis: a non-empty record whose axes cannot themselves address a member. */
function memberSelection(value: unknown): value is Record<string, string> {
  return object(value) && Object.keys(value).length > 0 && Object.entries(value).every(([axis, member]) => text(axis) && !axis.includes(".") && text(member));
}
function ref(value: unknown): value is ContentRef {
  return object(value) && fields(value, ["kind", "ref"]) &&
    ["copy", "media", "records", "action", "region"].includes(value.kind as string) && text(value.ref);
}

/** Source syntax comes from the host parser; Publisher owns the complete LK11 decision. */
export function checkLayoutRendererSource(renderer: LayoutRendererSource, contract: PageLayoutContract, tokens: readonly BindingToken[], compiler?: LayoutCompilerPort): string[] {
  if (!plain(renderer)) return ["missing renderer source closure"];
  return analyzeLayoutSource(renderer, contract, tokens, compiler);
}

/** Execution evidence for the workspace; it never changes the public static verdict. */
export interface InstanceCheckInspection {
  readonly result: InstanceCheckResult;
  readonly completed: boolean;
  readonly unavailableChecks: readonly InstanceCheckCode[];
}

/** Keep completion beside execution, rather than reconstructing it from finding text. */
export function inspectInstanceChecks(input: unknown, library: ConsumerInstanceLibrary, registries: InstanceRegistries, compiler?: LayoutCompilerPort): InstanceCheckInspection {
  const findings: InstanceFinding[] = [];
  const unavailableChecks = new Set<InstanceCheckCode>();
  const finish = (completed = false): InstanceCheckInspection => ({ result: result(findings), completed, unavailableChecks: [...unavailableChecks] });
  const add = (code: InstanceCheckCode, path: string, message: string) => findings.push({ code, path, message });
  try {
    if (!plain(input) || !object(input) || !fields(input, ["instanceId", "label", "path", "surface", "packIds", "format", "context", "frame", "layout", "fills", "states", "body"]) ||
      !text(input.instanceId) || !text(input.label) || !["site", "app"].includes(input.surface as string) || !list(input.packIds) ||
      !object(input.context) || !fields(input.context, ["consumer", "brand", "medium"]) || input.context.medium !== "web" ||
      [input.context.consumer, input.context.brand].some(value => value !== undefined && !text(value)) ||
      (input.path !== undefined && (!text(input.path) || !input.path.startsWith("/") || input.path.startsWith("//")))) {
      add("LK7", "instance", "Binding must contain only assembly data and consumer references"); return finish();
    }
    const lazyContent = (value: unknown): boolean => object(value) && Object.values(value).some(reference => object(reference) && "lazy" in reference);
    const fillPageData = (value: unknown): boolean => object(value) && ("repeat" in value || lazyContent(value.content) || Array.isArray(value.children) && value.children.some(fillPageData));
    const hasPageData = object(input.fills) && Object.values(input.fills).some(values => Array.isArray(values) && values.some(fillPageData))
      || object(input.frame) && (lazyContent(input.frame.content) || object(input.frame.slotFills) && Object.values(input.frame.slotFills).some(fillPageData));
    if (hasPageData) {
      let template: AnyInstanceBinding;
      try { template = registeredBindingTemplate(input as unknown as AnyInstanceBinding); }
      catch { add("LK7", "instance", "Invalid registered repeat/lazy metadata"); return finish(); }
      // Authored template checks cannot prove dynamic row counts or future data.
      const checked = inspectInstanceChecks(template, library, registries, compiler);
      return { ...checked, unavailableChecks: [...new Set<InstanceCheckCode>([...checked.unavailableChecks, "LK5", "LK10"])] };
    }
    if (!object(input.frame) || !fields(input.frame, ["leaf", "config", "content", "slotFills", "members"]) || !text(input.frame.leaf) ||
      (input.frame.config !== undefined && !text(input.frame.config)) || (input.frame.members !== undefined && !memberSelection(input.frame.members)) ||
      (input.frame.content !== undefined && (!object(input.frame.content) || Object.entries(input.frame.content).some(([name, value]) => !text(name) || !ref(value))))) { add("LK1", "frame", "Invalid frame binding"); return finish(); }
    if (input.body !== undefined) {
      for (const message of instanceBodyFindings(input as unknown as AnyInstanceBinding, registries)) add("LK7", "body", message);
      if ((input.body as { kind?: string }).kind === "canvas") { add("LK2", "body", "Canvas Stage runtime qualification is unavailable; no flow Layout is substituted"); return finish(); }
    }
    if (!object(input.layout) || !fields(input.layout, ["leaf", "config", "members"]) || !text(input.layout.leaf) || !text(input.layout.config) ||
      (input.layout.members !== undefined && (!object(input.layout.members) || !Object.values(input.layout.members).every(text)))) {
      add("LK2", "layout", "A registered layout config is required"); return finish();
    }
    if (!object(input.fills) || Object.values(input.fills).some(value => !Array.isArray(value))) { add("LK3", "fills", "Slots must contain ordered arrays"); return finish(); }
    if (input.states !== undefined && !list(input.states)) { add("LK14", "states", "States must be unique declared names"); return finish(); }
    // An empty request proves no whole-instance state support. Preserve the
    // static verdict while keeping workspace evidence from claiming LK14 passed.
    if (!input.states?.length) unavailableChecks.add("LK14");
    const formats = Object.getOwnPropertyDescriptor(registries, "formats");
    for (const finding of checkFormatBinding(input.format, input.layout.leaf, input.frame.leaf,
      formats && own(formats, "value") ? formats.value : undefined, registries.layouts)) add("LK16", finding.path, finding.message);
    const binding = input as unknown as InstanceBinding;
    const frame = registries.frames.find(leaf => leaf.id === binding.frame.leaf);
    const layout = registries.layouts.find(leaf => leaf.id === binding.layout.leaf);
    if (!active(frame) || !surface(frame!.contract.surface, binding.surface) || (binding.surface === "site" ? binding.frame.leaf !== "frames.site-shell" : binding.frame.leaf !== "frames.app-shell") ||
      (binding.frame.config !== undefined && !frame!.contract.configs.includes(binding.frame.config))) add("LK1", "frame", "Frame must be an active matching page shell and config");
    if (binding.frame.members !== undefined) {
      const declared = frame?.contract.members;
      if (!Array.isArray(declared)) add("LK1", "frame", "Frame member selection requires the frame's declared members");
      else for (const [axis, member] of Object.entries(binding.frame.members)) {
        if (!declared.some(name => typeof name === "string" && name.startsWith(`${axis}.`))) add("LK1", "frame", "Frame member axis is not declared by the frame");
        else if (!declared.includes(`${axis}.${member}`)) add("LK1", "frame", "Frame member is not declared on its axis");
        else if (binding.frame.config?.startsWith(`${axis}.`) && binding.frame.config !== `${axis}.${member}`) add("LK1", "frame", "Frame member conflicts with the frame config");
      }
    }
    if (!active(layout)) { add("LK2", "layout", "Layout is unknown, held or retired"); return finish(); }
    if (!surface(layout!.contract.surface, binding.surface)) add("LK1", "layout", "Layout surface must match the frame");
    let effective: ReturnType<typeof getEffectiveLayoutContract>;
    try { effective = getEffectiveLayoutContract(layout!, binding.layout.config, binding.layout.members); }
    catch { add("LK2", "layout", "Unknown config, member or widening override"); return finish(); }
    if (!effective.configs.some(config => config.id === binding.layout.config)) { add("LK2", "layout.config", "Config must be registered on this leaf"); return finish(); }
    const resolved: { path: string; fill: ConsumerInstanceFill; section?: SectionFill }[] = [];
    const resolve = (leaf: string, config: string | undefined, path: string, section?: SectionFill) => {
      let fill: ConsumerInstanceFill | undefined;
      try { fill = library.resolveFill(leaf, config); } catch { /* A failed port lookup is never a fallback. */ }
      if (library.role !== "consumer" || !text(library.id) || !fill || fill.library !== library.id || fill.leaf !== leaf || !same(fill.config, config) || !Array.isArray(fill.headings) || !fill.headings.every(level => level === 1 || level === 2) || !list(fill.states)) {
        unavailableChecks.add("LK8");
        unavailableChecks.add("LK14");
        add("LK7", path, "Fill must resolve exactly in the consumer library"); return undefined;
      }
      resolved.push({ path, fill, section }); return fill;
    };
    const frameFill = resolve(binding.frame.leaf, binding.frame.config, "frame");
    const layoutFill = resolve(binding.layout.leaf, binding.layout.config, "layout");
    for (const key of Object.keys(binding.fills)) if (!effective.slots.some(slot => slot.id === key)) add("LK3", `fills.${key}`, "Unknown effective layout slot");
    const ordered: { section: SectionFill; fill?: ConsumerInstanceFill; path: string }[] = [];
    const checkSection = (value: unknown, path: string, accepts?: readonly string[], tile?: { readonly spans: readonly string[] }) => {
      if (!object(value) || !fields(value, ["section", "config", "span", "content", "children"]) || !text(value.section) || (value.config !== undefined && !text(value.config)) || !object(value.content)
        || value.children !== undefined && (!Array.isArray(value.children) || !value.children.length || path.split(".children.").length > 8)) {
        add("LK4", path, "Invalid section fill");
        unavailableChecks.add("LK6"); unavailableChecks.add("LK8"); unavailableChecks.add("LK10");
        if (tile) unavailableChecks.add("LK13");
        if (path.startsWith("fills.") && ordered.length === 0) unavailableChecks.add("LK9");
        if (binding.states?.length) unavailableChecks.add("LK14");
        return;
      }
      const fill = value as unknown as SectionFill;
      const leaf = registries.sections.find(entry => entry.id === fill.section);
      if (!active(leaf) || !surface(leaf!.contract.surface, binding.surface) || (accepts && !accepts.includes(fill.section)) || (fill.config !== undefined && !leaf!.contract.configs.includes(fill.config))) add("LK4", path, "Section or config is unregistered, inactive or not accepted");
      if (fill.span !== undefined && (!tile || !tile.spans.includes(fill.span))) add("LK6", `${path}.span`, "Span is only allowed within a tile slot's closed spans");
      if (tile && leaf?.contract.container !== "adaptive") add("LK13", path, "Tile sections must declare adaptive containers");
      const implementation = resolve(fill.section, fill.config, path, fill);
      if (!leaf) { unavailableChecks.add("LK10"); if (binding.states?.length) unavailableChecks.add("LK14"); }
      if (leaf) {
        for (const slot of leaf.contract.slots) if (slot.required && !own(fill.content, slot.name)) add("LK10", `${path}.content.${slot.name}`, "Required content ref is missing");
        for (const [name, reference] of Object.entries(fill.content)) {
          const slot = leaf.contract.slots.find(entry => entry.name === name);
          let found: ContentRef | undefined;
          if (ref(reference)) try { found = library.resolveContent(reference); } catch { /* unresolved */ }
          if (!slot || !ref(reference) || reference.kind !== slot.type || !ref(found) || found.kind !== reference.kind || found.ref !== reference.ref) add("LK10", `${path}.content.${name}`, "Content must resolve by typed reference in the consumer registry");
        }
        for (const state of binding.states ?? []) if (!leaf.contract.states?.includes(state)) add("LK14", path, "Section contract does not declare an instance state");
      }
      fill.children?.forEach((child, index) => checkSection(child, `${path}.children.${index}`));
      return { section: fill, fill: implementation, path };
    };
    for (const [index, slot] of effective.slots.entries()) {
      if ((slot.position === "first" && index !== 0) || (slot.position === "last" && index !== effective.slots.length - 1)) add("LK6", `layout.slots.${slot.id}`, "Slot position conflicts with contract order");
      const fills = binding.fills[slot.id] ?? [];
      if (fills.length < slot.min || fills.length > slot.max) add("LK5", `fills.${slot.id}`, "Slot count falls outside the effective bounds");
      for (const [i, value] of fills.entries()) { const section = checkSection(value, `fills.${slot.id}.${i}`, slot.accepts, slot.tile); if (section) ordered.push(section); }
    }
    if (binding.frame.slotFills !== undefined) {
      if (!object(binding.frame.slotFills) || !fields(binding.frame.slotFills, ["consent", "context", "page-module", "inspector"])) {
        add("LK4", "frame.slotFills", "Unknown frame section slot");
        unavailableChecks.add("LK6"); unavailableChecks.add("LK8"); unavailableChecks.add("LK10");
        if (binding.states?.length) unavailableChecks.add("LK14");
      }
      else for (const [slot, value] of Object.entries(binding.frame.slotFills)) checkSection(value, `frame.slotFills.${slot}`);
    }
    const appHeaderOwns = binding.frame.leaf === "frames.app-shell" && binding.frame.config === "page";
    const first = ordered[0];
    const h1s = resolved.reduce((total, item) => total + item.fill.headings.filter(level => level === 1).length, 0);
    if ((layoutFill?.headings.length ?? 0) !== 0 || h1s !== 1 || (appHeaderOwns ? frameFill?.headings.filter(level => level === 1).length !== 1 :
      !first || !["sections.hero", "sections.page-header"].includes(first.section.section) || first.fill?.headings.filter(level => level === 1).length !== 1)) add("LK8", "outline", "Exactly one h1 must belong to the app header or first hero/page-header");
    for (const item of resolved) {
      const owner = appHeaderOwns ? item.path === "frame" : item.path === first?.path;
      if (!owner && item.fill.headings.some(level => level !== 2)) add("LK8", item.path, "All non-owner section headers must be h2");
    }
    // Ground equality needs both participants; absent optional fields only
    // withhold proof when this frame explicitly consumes the named ground input.
    if (!frameFill || !layoutFill || !first?.fill || (frameFill.groundRead === "leadGround" &&
      (!text(layoutFill.leadGround) || !text(first.fill.bandGround)))) unavailableChecks.add("LK9");
    if (layoutFill && (layoutFill.leadGround !== first?.fill?.bandGround)) add("LK9", "layout.leadGround", "Lead ground must equal the first rendered section band ground");
    if (frameFill && (frameFill.groundRead !== "leadGround" || ((frameFill.headerGround === "glass" || frameFill.headerGround === "transparent") && !text(layoutFill?.leadGround)))) add("LK9", "frame.groundRead", "Frame ground input must be the declared layout leadGround");
    if (!layoutFill?.renderer) add("LK11", "layout.renderer", "Actual layout renderer source is required");
    else for (const message of checkLayoutRendererSource(layoutFill.renderer, effective, registries.tokens, compiler)) add("LK11", "layout.renderer", message);
    for (const state of binding.states ?? []) {
      if (!resolved.some(item => item.fill.states.includes(state))) add("LK14", "states", "Instance state is undeclared");
      for (const item of resolved) if (!item.fill.states.includes(state)) add("LK14", item.path, "Every fill must support every instance state");
    }
    return finish(true);
  } catch { add("LK7", "instance", "Unverifiable binding, registry or consumer lookup"); return finish(); }
}

/** Pure static LK checks. LK12 is a separate rendered harness obligation, always reported pending. */
export function checkInstance(input: unknown, library: ConsumerInstanceLibrary, registries: InstanceRegistries, compiler?: LayoutCompilerPort): InstanceCheckResult {
  return inspectInstanceChecks(input, library, registries, compiler).result;
}

/** Static portion of pack closure; pending LK12 remains visible even when all static rules pass. */
export function checkInstancePack(instances: readonly InstanceBinding[], library: ConsumerInstanceLibrary, registries: InstanceRegistries, compiler?: LayoutCompilerPort): InstanceCheckResult {
  const findings: InstanceFinding[] = [];
  const ids = new Set<string>(), frameLeaves = new Map<string, string>();
  if (!plain(instances) || !Array.isArray(instances)) return result([{ code: "LK15", path: "instances", message: "Pack members must be plain ordered instance bindings" }]);
  for (const [index, binding] of instances.entries()) {
    const checked = checkInstance(binding, library, registries, compiler);
    findings.push(...checked.findings.map(finding => ({ ...finding, path: `instances.${index}.${finding.path}` })));
    if (checked.staticStatus !== "valid") {
      findings.push({ code: "LK15", path: `instances.${index}`, message: "Pack member fails static instance checks" });
      if (!object(binding) || !text(binding.instanceId) || !list(binding.packIds) || !object(binding.frame)) continue;
    }
    if (ids.has(binding.instanceId)) findings.push({ code: "LK15", path: `instances.${index}.instanceId`, message: "Instance ids must be unique" });
    ids.add(binding.instanceId);
    for (const pack of binding.packIds) {
      const key = JSON.stringify([pack, binding.surface]), leaf = binding.frame.leaf;
      if (frameLeaves.has(key) && frameLeaves.get(key) !== leaf) findings.push({ code: "LK15", path: `instances.${index}.frame`, message: "A pack uses one frame leaf per surface" });
      frameLeaves.set(key, leaf);
    }
  }
  return result(findings);
}
