import registryDocument from "../catalog/rules/backdrop-components.json" with { type: "json" };

/**
 * Interactive backdrops (foundry-build-0048 A4, U23 owner 2026-11-18): Foundry owns the slot contract
 * and the candidate recipe, the engine is adopted OSS. The components a backdrop descriptor may name
 * are the adopted records of `catalog/rules/backdrop-components.json` (each a vendored registry item
 * copied byte-for-byte, or a Foundry part with a recorded no-alternative basis); the component list
 * and every param schema derive from those records only, never from a list in code. A consumer
 * never authors backdrop code; the descriptor is plain JSON judged here, against the record's own
 * param schema: `{ component: <id>, params: {...} }`.
 *
 * A param is one of three shapes: a finite number inside its range (`integer` when it must be
 * whole), a colour from the registry's closed token list (each a theme slot whose `--color-<name>`
 * key the theme projects), or a boolean. Everything else is refused: an unknown component, an
 * unknown descriptor or param key, a string that is not one of the listed values (so a URL, a CSS
 * expression or code never reaches a component), a number out of range, NaN or a wrong type. Every
 * param is optional; an absent one takes the schema default.
 *
 * A surface accepts a descriptor only when its own contract declares a backdrop-placed slot
 * (`placement: "backdrop"`, catalog-core/media-placement.ts): the descriptor rides as `meta.backdrop`
 * on that surface's own code candidate (never a candidate of its own). Pure data in, messages out:
 * the Producer slot-model validator (submit), the criterion interactive.backdrop and certify's
 * backdrop fit (pin), Publisher install (compile) and the React `InteractiveBackdrop` (which renders
 * nothing for an invalid descriptor) all call these functions, so they cannot diverge.
 */

export type InteractiveBackdropColor = string;
export type InteractiveBackdropComponent = string;

/** How a colour param reaches the adopted component: a resolved hex string, the layer's CSS `color`, or the token name itself. */
export type BackdropColorDelivery = "hex" | "currentColor" | "token";
export interface InteractiveBackdropNumberParam { readonly type: "number"; readonly min: number; readonly max: number; readonly integer?: boolean; readonly default: number; readonly prop?: string }
export interface InteractiveBackdropColorParam { readonly type: "color"; readonly default: InteractiveBackdropColor; readonly prop?: string; readonly as: BackdropColorDelivery }
export interface InteractiveBackdropBooleanParam { readonly type: "boolean"; readonly default: boolean; readonly prop?: string }
export type InteractiveBackdropParam = InteractiveBackdropNumberParam | InteractiveBackdropColorParam | InteractiveBackdropBooleanParam;

/** Where an adopted component's code comes from: a vendored registry item and its byte-exact copy, or a Foundry part. */
export type BackdropComponentSource =
  | { readonly registry: string; readonly item: string; readonly version: string; readonly file: string; readonly copy: string; readonly export: string }
  | { readonly foundry: string; readonly export: string };
/** What a reduced-motion visitor gets: no layer (`omit`), the same component with fixed props (`props`), or the component's own still frame (`component`). */
export type BackdropReducedMotion = { readonly mode: "omit" } | { readonly mode: "props"; readonly props: Readonly<Record<string, string | number | boolean>> } | { readonly mode: "component" };
export interface BackdropComponentRecord {
  readonly id: InteractiveBackdropComponent;
  readonly source: BackdropComponentSource;
  readonly motion: "animated" | "static";
  /** Required when `motion` is animated. */
  readonly reducedMotion?: BackdropReducedMotion;
  /** Fixed props passed on every render (never a descriptor param). */
  readonly props?: Readonly<Record<string, string | number | boolean>>;
  readonly params: Readonly<Record<string, InteractiveBackdropParam>>;
  /** The source-ladder record check:source-ladder judges. */
  readonly ladder: unknown;
}
export interface BackdropRegistry {
  readonly schema: "clossys.backdrop-components/1";
  readonly colors: readonly InteractiveBackdropColor[];
  readonly components: readonly BackdropComponentRecord[];
}

/** The descriptor's own keys. */
export const INTERACTIVE_BACKDROP_DESCRIPTOR_KEYS = Object.freeze(["component", "params"] as const);

export type InteractiveBackdropParamValue = number | string | boolean;
/** The params of one component, every key resolved (absent keys take the schema default). */
export type InteractiveBackdropParams = Readonly<Record<string, InteractiveBackdropParamValue>>;
/** One descriptor as a surface's code candidate carries it (`meta.backdrop`): a component id and some of its params. */
export interface InteractiveBackdropDescriptor { readonly component: InteractiveBackdropComponent; readonly params: Readonly<Record<string, InteractiveBackdropParamValue>> }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const show = (value: unknown): string => {
  const text = typeof value === "string" ? JSON.stringify(value) : typeof value === "number" || typeof value === "boolean" ? String(value) : value === null ? "null" : Array.isArray(value) ? "a list" : typeof value;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};
const isFixedValue = (value: unknown): boolean => typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const PROP_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** Why one param spec of a registry record is malformed; [] when it is well formed. */
function paramSpecFindings(at: string, spec: unknown, colors: readonly string[]): string[] {
  if (!record(spec)) return [`${at} is not an object`];
  const findings: string[] = [];
  if (spec.prop !== undefined && (typeof spec.prop !== "string" || !PROP_NAME.test(spec.prop))) findings.push(`${at}.prop is not a prop name`);
  if (spec.type === "number") {
    const { min, max } = spec;
    if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max) || min > max) findings.push(`${at} needs finite min <= max`);
    else if (typeof spec.default !== "number" || spec.default < min || spec.default > max) findings.push(`${at}.default is outside ${String(min)}..${String(max)}`);
    if (spec.integer !== undefined && typeof spec.integer !== "boolean") findings.push(`${at}.integer is not a boolean`);
    if (spec.integer === true && typeof spec.default === "number" && !Number.isInteger(spec.default)) findings.push(`${at}.default is not a whole number`);
  } else if (spec.type === "color") {
    if (typeof spec.default !== "string" || !colors.includes(spec.default)) findings.push(`${at}.default is not one of the registry colours`);
    if (spec.as !== "hex" && spec.as !== "currentColor" && spec.as !== "token") findings.push(`${at}.as is not hex, currentColor or token`);
    if (spec.as !== "currentColor" && spec.prop === undefined) findings.push(`${at} delivers ${String(spec.as)} and needs a prop`);
  } else if (spec.type === "boolean") {
    if (typeof spec.default !== "boolean") findings.push(`${at}.default is not a boolean`);
  } else findings.push(`${at}.type is not number, color or boolean`);
  return findings;
}

/**
 * Structural findings for a backdrop component registry document; [] when every record is well
 * formed: a unique id, a source (a vendored registry item with its byte-exact copy, or a Foundry
 * part), a motion, a reduced-motion policy on every animated record, fixed props of plain values
 * and a param schema whose props never collide. The ladder record is judged by check:source-ladder.
 */
export function backdropRegistryFindings(document: unknown): string[] {
  if (!record(document)) return ["backdrop registry is not an object"];
  const findings: string[] = [];
  if (document.schema !== "clossys.backdrop-components/1") findings.push("backdrop registry schema is not clossys.backdrop-components/1");
  const colors = Array.isArray(document.colors) && document.colors.every(color => typeof color === "string" && color.length > 0) ? document.colors as string[] : [];
  if (!colors.length) findings.push("backdrop registry colors is not a list of token names");
  if (new Set(colors).size !== colors.length) findings.push("backdrop registry colors repeat");
  if (!Array.isArray(document.components) || !document.components.length) return [...findings, "backdrop registry components is not a non-empty list"];
  const ids = new Set<string>();
  for (const [index, entry] of document.components.entries()) {
    if (!record(entry)) { findings.push(`components[${index}] is not an object`); continue; }
    const id = typeof entry.id === "string" && /^[a-z][a-z0-9-]*$/.test(entry.id) ? entry.id : undefined;
    const at = id ?? `components[${index}]`;
    if (!id) findings.push(`${at}.id is not a kebab-case id`);
    else if (ids.has(id)) findings.push(`${at} is listed twice`);
    else ids.add(id);
    const source = entry.source;
    if (!record(source)) findings.push(`${at}.source is not an object`);
    else if (typeof source.foundry === "string") {
      if (!source.foundry.startsWith("src/") || typeof source.export !== "string") findings.push(`${at}.source names no Foundry file and export`);
    } else if (!["registry", "item", "version", "file", "copy", "export"].every(key => typeof source[key] === "string" && (source[key] as string).length > 0)) {
      findings.push(`${at}.source needs registry, item, version, file, copy and export`);
    }
    if (entry.motion !== "animated" && entry.motion !== "static") findings.push(`${at}.motion is not animated or static`);
    const reduced = entry.reducedMotion;
    if (entry.motion === "animated") {
      if (!record(reduced) || !["omit", "props", "component"].includes(reduced.mode as string)) findings.push(`${at} is animated and declares no reducedMotion mode (omit, props or component)`);
      else if (reduced.mode === "props" && (!record(reduced.props) || !Object.keys(reduced.props).length || !Object.values(reduced.props).every(isFixedValue))) findings.push(`${at}.reducedMotion.props is not a map of plain values`);
    } else if (reduced !== undefined) findings.push(`${at} is static and carries a reducedMotion policy`);
    if (entry.props !== undefined && (!record(entry.props) || !Object.values(entry.props).every(isFixedValue))) findings.push(`${at}.props is not a map of plain values`);
    if (!record(entry.params)) { findings.push(`${at}.params is not an object`); continue; }
    const props = new Set(record(entry.props) ? Object.keys(entry.props) : []);
    const inks = Object.values(entry.params).filter(spec => record(spec) && spec.type === "color" && spec.as === "currentColor").length;
    if (inks > 1) findings.push(`${at} delivers ${inks} colours as currentColor; the layer has one`);
    for (const [key, spec] of Object.entries(entry.params)) {
      findings.push(...paramSpecFindings(`${at}.params.${key}`, spec, colors));
      const prop = record(spec) && typeof spec.prop === "string" ? spec.prop : undefined;
      if (prop && props.has(prop)) findings.push(`${at}.params.${key} maps to prop ${prop}, which another param or a fixed prop already sets`);
      if (prop) props.add(prop);
    }
    if (entry.ladder === undefined) findings.push(`${at} carries no source-ladder record`);
  }
  return findings;
}

/** A judged registry: throws on any structural finding, so a malformed record never reaches a gate. */
export function loadBackdropRegistry(document: unknown = registryDocument): BackdropRegistry {
  const findings = backdropRegistryFindings(document);
  if (findings.length) throw new Error(`backdrop components registry: ${findings.join("; ")}`);
  return document as BackdropRegistry;
}

/** The adopted records (catalog/rules/backdrop-components.json). */
export const BACKDROP_REGISTRY: BackdropRegistry = loadBackdropRegistry();
/** The theme colours an interactive backdrop may paint with, from the registry. */
export const INTERACTIVE_BACKDROP_COLORS: readonly InteractiveBackdropColor[] = Object.freeze([...BACKDROP_REGISTRY.colors]);
/** The component ids, in registry order. */
export const INTERACTIVE_BACKDROP_COMPONENT_IDS: readonly InteractiveBackdropComponent[] = Object.freeze(BACKDROP_REGISTRY.components.map(entry => entry.id));

/** The registry record for `id`; undefined when the registry adopts no such component. */
export function backdropComponentRecord(id: unknown, registry: BackdropRegistry = BACKDROP_REGISTRY): BackdropComponentRecord | undefined {
  return typeof id === "string" ? registry.components.find(entry => entry.id === id) : undefined;
}

/** Why one param value is outside its schema; undefined when it is inside. */
function paramIssue(component: string, key: string, spec: InteractiveBackdropParam, value: unknown, colors: readonly string[]): string | undefined {
  const at = `${component} param ${key}`;
  if (spec.type === "boolean") return typeof value === "boolean" ? undefined : `${at} is ${show(value)}, not a boolean`;
  if (spec.type === "color") {
    return typeof value === "string" && colors.includes(value) ? undefined : `${at} is ${show(value)}, not one of the token colours ${colors.join(", ")}`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return `${at} is ${show(value)}, not a finite number`;
  if (value < spec.min || value > spec.max) return `${at} is ${value}, outside ${spec.min}..${spec.max}`;
  if (spec.integer && !Number.isInteger(value)) return `${at} is ${value}, not a whole number`;
  return undefined;
}

/**
 * Why `descriptor` is not a valid interactive backdrop descriptor; [] when it is. It must be exactly
 * `{component, params}`: `component` one of the registry's component ids, `params` an object whose
 * every key is in that record's schema and every value inside its param.
 */
export function interactiveBackdropDescriptorIssues(descriptor: unknown, registry: BackdropRegistry = BACKDROP_REGISTRY): string[] {
  if (!record(descriptor)) return [`the interactive backdrop descriptor is ${show(descriptor)}, not an object {component, params}`];
  const issues: string[] = [];
  for (const key of Object.keys(descriptor)) {
    if (!(INTERACTIVE_BACKDROP_DESCRIPTOR_KEYS as readonly string[]).includes(key)) issues.push(`the interactive backdrop descriptor carries ${JSON.stringify(key)}; it is only ${INTERACTIVE_BACKDROP_DESCRIPTOR_KEYS.join(", ")}`);
  }
  const component = Object.hasOwn(descriptor, "component") ? descriptor.component : undefined;
  const entry = backdropComponentRecord(component, registry);
  if (!entry) {
    issues.push(`the interactive backdrop component is ${show(component)}, not one of the adopted backdrop components ${registry.components.map(item => item.id).join(", ")}`);
    return issues;
  }
  const params = Object.hasOwn(descriptor, "params") ? descriptor.params : undefined;
  if (!record(params)) { issues.push(`${entry.id} params is ${show(params)}, not an object`); return issues; }
  for (const [key, value] of Object.entries(params)) {
    if (!Object.hasOwn(entry.params, key)) { issues.push(`${entry.id} has no param ${JSON.stringify(key)}; its params are ${Object.keys(entry.params).join(", ")}`); continue; }
    const issue = paramIssue(entry.id, key, entry.params[key]!, value, registry.colors);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Whether `value` is a valid descriptor. */
export function isInteractiveBackdropDescriptor(value: unknown, registry: BackdropRegistry = BACKDROP_REGISTRY): value is InteractiveBackdropDescriptor {
  return interactiveBackdropDescriptorIssues(value, registry).length === 0;
}

/** The descriptor's params with every absent key at its schema default. Throws TypeError on an invalid descriptor. */
export function resolveInteractiveBackdropParams(descriptor: InteractiveBackdropDescriptor, registry: BackdropRegistry = BACKDROP_REGISTRY): InteractiveBackdropParams {
  const issues = interactiveBackdropDescriptorIssues(descriptor, registry);
  if (issues.length) throw new TypeError(`Invalid interactive backdrop descriptor: ${issues[0]}`);
  const entry = backdropComponentRecord(descriptor.component, registry)!;
  return Object.fromEntries(Object.entries(entry.params).map(([key, spec]) => [key, Object.hasOwn(descriptor.params, key) ? descriptor.params[key]! : spec.default]));
}

/** A surface contract as far as backdrop opt-in reads it: section slots carry `name`, frame slots `id`. */
export interface BackdropSurfaceContract { readonly slots?: readonly { readonly name?: string; readonly id?: string; readonly placement?: string }[] }

/**
 * The name of the one slot a surface contract places as a backdrop (`placement: "backdrop"`);
 * undefined when it declares none. A surface accepts an interactive backdrop descriptor only then.
 */
export function contractBackdropSlot(contract: unknown): string | undefined {
  if (!record(contract) || !Array.isArray(contract.slots)) return undefined;
  for (const slot of contract.slots as unknown[]) {
    if (!record(slot) || slot.placement !== "backdrop") continue;
    const name = typeof slot.name === "string" ? slot.name : typeof slot.id === "string" ? slot.id : undefined;
    if (name) return name;
  }
  return undefined;
}

/** Whether a registry item carries its own `meta.backdrop` (judged or not). */
export function carriesInteractiveBackdrop(item: unknown): item is { meta: { backdrop: unknown } } {
  return record(item) && record(item.meta) && Object.hasOwn(item.meta, "backdrop");
}

/**
 * Why the `meta.backdrop` a candidate of `slot` carries is not a valid interactive backdrop; [] when
 * it carries none or a valid one. Only a candidate of a surface whose `contract` declares a
 * backdrop-placed slot may carry one (an absent contract declares none), and its descriptor is
 * judged by `interactiveBackdropDescriptorIssues`. Submit (Producer slot-model validator, which
 * certify re-runs at pin), pin (certify's backdrop fit) and compile (Publisher install) call this.
 */
export function interactiveBackdropMetaIssues(item: unknown, slot: string, contract: unknown, registry: BackdropRegistry = BACKDROP_REGISTRY): string[] {
  if (!carriesInteractiveBackdrop(item)) return [];
  if (contractBackdropSlot(contract) === undefined) return [`meta.backdrop rides only on the code candidate of a surface whose contract declares a backdrop-placed slot; the ${slot} contract declares none`];
  return interactiveBackdropDescriptorIssues(item.meta.backdrop, registry);
}

/**
 * Whether `value`, met at `key` of a props tree, is an interactive backdrop prop: a
 * `{kind: "interactive"}` record at a `backdrop` key, or any `{kind: "interactive", backdrop}`
 * record (the interactive shape under another prop name a candidate's code could forward).
 */
export function isInteractiveBackdropProp(key: string | undefined, value: unknown): boolean {
  return record(value) && value.kind === "interactive" && (key === "backdrop" || Object.hasOwn(value, "backdrop"));
}

/** Dot paths (from `at`) of every interactive backdrop prop in a props tree: a preview's fixtures, a mount's props. */
export function interactiveBackdropPropPaths(value: unknown, at = ""): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, key: string | undefined, path: string) => {
    if (key !== undefined && isInteractiveBackdropProp(key, node)) { paths.push(path); return; }
    if (Array.isArray(node)) node.forEach((child, index) => walk(child, String(index), path ? `${path}.${index}` : String(index)));
    else if (record(node)) for (const child of Object.keys(node)) walk(node[child], child, path ? `${path}.${child}` : child);
  };
  walk(value, undefined, at);
  return paths;
}

/**
 * Why a candidate's own `meta.preview` carries an interactive backdrop; [] when it carries none.
 * `meta.backdrop` on a backdrop-declaring surface's code candidate is the only channel: preview
 * props reach the mount unjudged, so any slot's candidate is refused there at submit and at pin,
 * and Publisher install strips such props from every mount before it applies the judged
 * `meta.backdrop`.
 */
export function previewInteractiveBackdropIssues(item: unknown): string[] {
  if (!record(item) || !record(item.meta) || !Object.hasOwn(item.meta, "preview")) return [];
  return interactiveBackdropPropPaths(item.meta.preview, "meta.preview").map(path =>
    `${path} is an interactive backdrop in preview props; it rides only as meta.backdrop on the code candidate of a surface whose contract declares a backdrop-placed slot`);
}
