/**
 * Interactive backdrops (foundry-build-0048 A4, owner narrowing 2026-11-18): a small fixed set of
 * Foundry-shipped decorative backdrop components, and the one data-only descriptor a hero candidate
 * carries to pick one: `{ component: <id>, params: {...} }`. A consumer never authors backdrop code; the
 * components are Foundry code (`@clossys/designer/blocks`), and the descriptor is plain JSON judged
 * here, against the component's own param schema.
 *
 * A param is one of three shapes: a finite number inside its range (`integer` when it must be
 * whole), a colour from the closed token list `INTERACTIVE_BACKDROP_COLORS` (each a theme slot whose
 * `--color-<name>` key the theme projects), or a boolean. Everything else is refused: an unknown
 * component, an unknown descriptor or param key, a string that is not one of the listed values (so a
 * URL, a CSS expression or code never reaches a component), a number out of range, NaN or a
 * wrong type. Every param is optional; an absent one takes the schema default.
 *
 * The descriptor rides as `meta.backdrop` on the hero's own code candidate (never a candidate of its
 * own). Pure data in, messages out: the Producer slot-model validator (submit), the criterion
 * interactive.backdrop (pin), Publisher install (compile) and the React `InteractiveBackdrop` (which
 * renders nothing for an invalid descriptor) all call `interactiveBackdropDescriptorIssues`, so they
 * cannot diverge.
 */

/**
 * The theme colours an interactive backdrop may paint with: theme slots (`themes.<name>`) the hero
 * contract reads, each projected by the theme as the stock key `--color-<name>`.
 */
export const INTERACTIVE_BACKDROP_COLORS = Object.freeze([
  "primary",
  "secondary",
  "accent",
  "foreground",
  "muted-foreground",
  "border",
] as const);
export type InteractiveBackdropColor = (typeof INTERACTIVE_BACKDROP_COLORS)[number];

export interface InteractiveBackdropNumberParam { readonly type: "number"; readonly min: number; readonly max: number; readonly integer?: true; readonly default: number }
export interface InteractiveBackdropColorParam { readonly type: "color"; readonly default: InteractiveBackdropColor }
export interface InteractiveBackdropBooleanParam { readonly type: "boolean"; readonly default: boolean }
export type InteractiveBackdropParam = InteractiveBackdropNumberParam | InteractiveBackdropColorParam | InteractiveBackdropBooleanParam;

/** The fixed Foundry list: each component id and its param schema. Defaults are DRAFT (owner may retune). */
export const INTERACTIVE_BACKDROP_COMPONENTS = Object.freeze({
  /** Drifting points on a canvas, optionally linked when near; a still scatter under reduced motion. */
  "particle-field": Object.freeze({
    color: { type: "color", default: "primary" },
    density: { type: "number", min: 8, max: 160, integer: true, default: 48 },
    speed: { type: "number", min: 0, max: 2, default: 0.5 },
    size: { type: "number", min: 1, max: 4, default: 2 },
    links: { type: "boolean", default: false },
  }),
  /** Three soft colour fields that slowly drift; fixed in place under reduced motion. */
  "gradient-mesh": Object.freeze({
    from: { type: "color", default: "primary" },
    via: { type: "color", default: "accent" },
    to: { type: "color", default: "secondary" },
    speed: { type: "number", min: 0, max: 2, default: 0.5 },
    intensity: { type: "number", min: 0.1, max: 1, default: 0.5 },
  }),
  /** A line grid with a glow that follows the pointer (and may pulse); centred and still under reduced motion. */
  "grid-glow": Object.freeze({
    line: { type: "color", default: "muted-foreground" },
    glow: { type: "color", default: "primary" },
    cell: { type: "number", min: 16, max: 96, integer: true, default: 40 },
    follow: { type: "boolean", default: true },
    pulse: { type: "boolean", default: false },
  }),
} satisfies Record<string, Readonly<Record<string, InteractiveBackdropParam>>>);

export type InteractiveBackdropComponent = keyof typeof INTERACTIVE_BACKDROP_COMPONENTS;
/** The component ids, in list order. */
export const INTERACTIVE_BACKDROP_COMPONENT_IDS = Object.freeze(Object.keys(INTERACTIVE_BACKDROP_COMPONENTS) as InteractiveBackdropComponent[]);
/** The descriptor's own keys. */
export const INTERACTIVE_BACKDROP_DESCRIPTOR_KEYS = Object.freeze(["component", "params"] as const);

type ParamValue<P> = P extends InteractiveBackdropNumberParam ? number : P extends InteractiveBackdropColorParam ? InteractiveBackdropColor : P extends InteractiveBackdropBooleanParam ? boolean : never;
/** The params of one component, every key resolved (absent keys take the schema default). */
export type InteractiveBackdropParams<C extends InteractiveBackdropComponent> = { readonly [K in keyof (typeof INTERACTIVE_BACKDROP_COMPONENTS)[C]]: ParamValue<(typeof INTERACTIVE_BACKDROP_COMPONENTS)[C][K]> };
/** One descriptor as a hero code candidate carries it (`meta.backdrop`): a component id and some of its params. */
export type InteractiveBackdropDescriptor = { [C in InteractiveBackdropComponent]: { readonly component: C; readonly params: Partial<InteractiveBackdropParams<C>> } }[InteractiveBackdropComponent];

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const show = (value: unknown): string => {
  const text = typeof value === "string" ? JSON.stringify(value) : typeof value === "number" || typeof value === "boolean" ? String(value) : value === null ? "null" : Array.isArray(value) ? "a list" : typeof value;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** Why one param value is outside its schema; undefined when it is inside. */
function paramIssue(component: string, key: string, spec: InteractiveBackdropParam, value: unknown): string | undefined {
  const at = `${component} param ${key}`;
  if (spec.type === "boolean") return typeof value === "boolean" ? undefined : `${at} is ${show(value)}, not a boolean`;
  if (spec.type === "color") {
    return typeof value === "string" && (INTERACTIVE_BACKDROP_COLORS as readonly string[]).includes(value)
      ? undefined
      : `${at} is ${show(value)}, not one of the token colours ${INTERACTIVE_BACKDROP_COLORS.join(", ")}`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return `${at} is ${show(value)}, not a finite number`;
  if (value < spec.min || value > spec.max) return `${at} is ${value}, outside ${spec.min}..${spec.max}`;
  if (spec.integer && !Number.isInteger(value)) return `${at} is ${value}, not a whole number`;
  return undefined;
}

/**
 * Why `descriptor` is not a valid interactive backdrop descriptor; [] when it is. It must be exactly
 * `{component, params}`: `component` one of `INTERACTIVE_BACKDROP_COMPONENT_IDS`, `params` an object
 * whose every key is in that component's schema and every value inside its param.
 */
export function interactiveBackdropDescriptorIssues(descriptor: unknown): string[] {
  if (!record(descriptor)) return [`the interactive backdrop descriptor is ${show(descriptor)}, not an object {component, params}`];
  const issues: string[] = [];
  for (const key of Object.keys(descriptor)) {
    if (!(INTERACTIVE_BACKDROP_DESCRIPTOR_KEYS as readonly string[]).includes(key)) issues.push(`the interactive backdrop descriptor carries ${JSON.stringify(key)}; it is only ${INTERACTIVE_BACKDROP_DESCRIPTOR_KEYS.join(", ")}`);
  }
  const component = Object.hasOwn(descriptor, "component") ? descriptor.component : undefined;
  if (typeof component !== "string" || !Object.hasOwn(INTERACTIVE_BACKDROP_COMPONENTS, component)) {
    issues.push(`the interactive backdrop component is ${show(component)}, not one of the Foundry components ${INTERACTIVE_BACKDROP_COMPONENT_IDS.join(", ")}`);
    return issues;
  }
  const params = Object.hasOwn(descriptor, "params") ? descriptor.params : undefined;
  if (!record(params)) { issues.push(`${component} params is ${show(params)}, not an object`); return issues; }
  const schema = INTERACTIVE_BACKDROP_COMPONENTS[component as InteractiveBackdropComponent] as Readonly<Record<string, InteractiveBackdropParam>>;
  for (const [key, value] of Object.entries(params)) {
    if (!Object.hasOwn(schema, key)) { issues.push(`${component} has no param ${JSON.stringify(key)}; its params are ${Object.keys(schema).join(", ")}`); continue; }
    const issue = paramIssue(component, key, schema[key]!, value);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Whether `value` is a valid descriptor. */
export function isInteractiveBackdropDescriptor(value: unknown): value is InteractiveBackdropDescriptor {
  return interactiveBackdropDescriptorIssues(value).length === 0;
}

/** The descriptor's params with every absent key at its schema default. Throws TypeError on an invalid descriptor. */
export function resolveInteractiveBackdropParams<C extends InteractiveBackdropComponent>(descriptor: { readonly component: C; readonly params: Partial<InteractiveBackdropParams<C>> }): InteractiveBackdropParams<C> {
  const issues = interactiveBackdropDescriptorIssues(descriptor);
  if (issues.length) throw new TypeError(`Invalid interactive backdrop descriptor: ${issues[0]}`);
  const schema = INTERACTIVE_BACKDROP_COMPONENTS[descriptor.component] as Readonly<Record<string, InteractiveBackdropParam>>;
  const params = descriptor.params as Readonly<Record<string, unknown>>;
  return Object.fromEntries(Object.entries(schema).map(([key, spec]) => [key, Object.hasOwn(params, key) ? params[key] : spec.default])) as InteractiveBackdropParams<C>;
}

/**
 * The one slot whose own code candidate may carry an interactive backdrop descriptor (`meta.backdrop`).
 * The descriptor never stands as a candidate of its own: it rides on the hero's code candidate, so
 * pinning that candidate still installs and mounts the hero, and Publisher passes the descriptor to
 * the hero's `backdrop` prop for this slot only (never for another section that also renders Hero).
 * The provenance rule's `interactiveBackdrops.slots` lists the same slot (pinned by a test).
 */
export const INTERACTIVE_BACKDROP_SLOT = "sections.hero";

/** Whether a registry item carries its own `meta.backdrop` (judged or not). */
export function carriesInteractiveBackdrop(item: unknown): item is { meta: { backdrop: unknown } } {
  return record(item) && record(item.meta) && Object.hasOwn(item.meta, "backdrop");
}

/**
 * Why the `meta.backdrop` a candidate of `slot` carries is not a valid interactive backdrop; [] when
 * it carries none or a valid one. Only an `INTERACTIVE_BACKDROP_SLOT` candidate may carry one, and its
 * descriptor is judged by `interactiveBackdropDescriptorIssues`. Submit (Producer slot-model
 * validator, which certify re-runs at pin) and compile (Publisher install) call this; the pin
 * criterion interactive.backdrop judges the same descriptor function against the slot contract,
 * which only the hero's lists. So the three cannot diverge.
 */
export function interactiveBackdropMetaIssues(item: unknown, slot: string): string[] {
  if (!carriesInteractiveBackdrop(item)) return [];
  if (slot !== INTERACTIVE_BACKDROP_SLOT) return [`meta.backdrop rides only on a ${INTERACTIVE_BACKDROP_SLOT} code candidate, not on a ${slot} candidate`];
  return interactiveBackdropDescriptorIssues(item.meta.backdrop);
}

/**
 * Whether `value`, met at `key` of a props tree, is an interactive backdrop prop: a
 * `{kind: "interactive"}` record at a `backdrop` key, or any `{kind: "interactive", backdrop}`
 * record (Hero's interactive shape under another prop name a candidate's code could forward).
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
 * `meta.backdrop` on the `INTERACTIVE_BACKDROP_SLOT` code candidate is the only channel: preview
 * props reach the mount unjudged, so any slot's candidate (a CTA whose code renders Hero, or a hero
 * shipping an out-of-schema descriptor) is refused there at submit and at pin, and Publisher install
 * strips such props from every mount before it applies the judged `meta.backdrop`.
 */
export function previewInteractiveBackdropIssues(item: unknown): string[] {
  if (!record(item) || !record(item.meta) || !Object.hasOwn(item.meta, "preview")) return [];
  return interactiveBackdropPropPaths(item.meta.preview, "meta.preview").map(path =>
    `${path} is an interactive backdrop in preview props; it rides only as meta.backdrop on the ${INTERACTIVE_BACKDROP_SLOT} code candidate`);
}
