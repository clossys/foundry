/**
 * Interactive backdrops (foundry-build-0048 A4, owner narrowing 2026-11-18): a small fixed set of
 * Foundry-shipped decorative backdrop components, and the one data-only descriptor a consumer pins to
 * pick one: `{ component: <id>, params: {...} }`. A consumer never authors backdrop code; the
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
 * Pure data in, messages out: the Producer slot-model validator, the criterion interactive.backdrop
 * and the React `InteractiveBackdrop` (which throws on an invalid descriptor) all call
 * `interactiveBackdropDescriptorIssues`, so the three cannot diverge.
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
/** One descriptor as a consumer pins it (`meta.backdrop`): a component id and some of its params. */
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
  const component = descriptor.component;
  if (typeof component !== "string" || !Object.hasOwn(INTERACTIVE_BACKDROP_COMPONENTS, component)) {
    issues.push(`the interactive backdrop component is ${show(component)}, not one of the Foundry components ${INTERACTIVE_BACKDROP_COMPONENT_IDS.join(", ")}`);
    return issues;
  }
  const params = descriptor.params;
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

/** The Designer candidate source kind that pins one descriptor (`meta.source.kind`). */
export const INTERACTIVE_BACKDROP_KIND = "interactive-backdrop";
/** The registry-item keys an interactive backdrop candidate may carry: no installer field (dependencies, css, cssVars, tailwind, envVars, docs, ...). */
export const INTERACTIVE_BACKDROP_ITEM_KEYS = Object.freeze(["$schema", "name", "type", "files", "meta"] as const);
/** The `meta` keys of an interactive backdrop candidate; the descriptor is `meta.backdrop`. */
export const INTERACTIVE_BACKDROP_META_KEYS = Object.freeze(["slot", "source", "element", "backdrop"] as const);
/** The `meta.source` keys of an interactive backdrop candidate (its `ref` is always []: it adopts and cites nothing). */
export const INTERACTIVE_BACKDROP_SOURCE_KEYS = Object.freeze(["kind", "ref", "license"] as const);
/** The registry type of an interactive backdrop candidate. */
export const INTERACTIVE_BACKDROP_ITEM_TYPE = "registry:block";

/**
 * Why the registry-item envelope of an interactive backdrop candidate is outside its allowlist; []
 * when it is inside. The candidate carries no code and no file (`files: []`), no installer key, and
 * a `meta.source` of kind interactive-backdrop that cites nothing. The Designer's ref-verbatim check
 * (scripts/check-ref-verbatim.mjs `interactiveEnvelopeIssues`) keeps an identical copy, pinned by a
 * parity test.
 */
export function interactiveBackdropEnvelopeIssues(candidate: unknown): string[] {
  if (!record(candidate)) return ["the interactive backdrop is not a registry item object"];
  const issues: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (!(INTERACTIVE_BACKDROP_ITEM_KEYS as readonly string[]).includes(key)) issues.push(`the interactive backdrop carries ${key}; its registry item is only ${INTERACTIVE_BACKDROP_ITEM_KEYS.join(", ")}`);
  }
  if (candidate.type !== INTERACTIVE_BACKDROP_ITEM_TYPE) issues.push(`the interactive backdrop's type is ${JSON.stringify(candidate.type ?? null)}, not ${INTERACTIVE_BACKDROP_ITEM_TYPE}`);
  if (!Array.isArray(candidate.files) || candidate.files.length !== 0) issues.push("the interactive backdrop carries files: it is a descriptor over a Foundry component, never code or a file, so files is []");
  const meta = candidate.meta;
  if (!record(meta)) return [...issues, "the interactive backdrop carries no meta object"];
  for (const key of Object.keys(meta)) {
    if (!(INTERACTIVE_BACKDROP_META_KEYS as readonly string[]).includes(key)) issues.push(`the interactive backdrop's meta carries ${key}; its meta is only ${INTERACTIVE_BACKDROP_META_KEYS.join(", ")}`);
  }
  const source = meta.source;
  if (!record(source)) issues.push("the interactive backdrop's meta.source is not an object");
  else {
    for (const key of Object.keys(source)) {
      if (!(INTERACTIVE_BACKDROP_SOURCE_KEYS as readonly string[]).includes(key)) issues.push(`the interactive backdrop's meta.source carries ${key}; its source is only ${INTERACTIVE_BACKDROP_SOURCE_KEYS.join(", ")}`);
    }
    if (source.kind !== INTERACTIVE_BACKDROP_KIND) issues.push(`the interactive backdrop's meta.source.kind is ${JSON.stringify(source.kind ?? null)}, not ${INTERACTIVE_BACKDROP_KIND}`);
    if (!Array.isArray(source.ref) || source.ref.length !== 0) issues.push(`the interactive backdrop's meta.source.ref is ${JSON.stringify(source.ref ?? null)}, not []: it adopts and cites nothing`);
  }
  return issues;
}

/**
 * Why `candidate` is not a valid interactive backdrop candidate; [] when it is: its envelope
 * (`interactiveBackdropEnvelopeIssues`) and its one descriptor `meta.backdrop`, judged by
 * `interactiveBackdropDescriptorIssues`.
 */
export function interactiveBackdropCandidateIssues(candidate: unknown): string[] {
  const issues = interactiveBackdropEnvelopeIssues(candidate);
  const meta = record(candidate) ? candidate.meta : undefined;
  if (!record(meta)) return issues;
  if (!Object.hasOwn(meta, "backdrop")) return [...issues, "the interactive backdrop carries no meta.backdrop descriptor {component, params}"];
  return [...issues, ...interactiveBackdropDescriptorIssues(meta.backdrop)];
}
