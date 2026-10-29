/** Consumer-owned runtime seams. This module imports no renderer or execution tool. */
import { runtimeSnapshotCopies } from "./runtime-snapshot-identity.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import type { FramePageHeader } from "../frame-page-header.js";
import type { RuntimeFillSelection } from "./runtime-assembly.js";
import type { FrameContract } from "./frames-contract.js";
import type { SectionContract } from "./sections-contract.js";
import type { BuildCatalogData, CompositeResolved } from "./types.js";
import type { CompositionBody, FrameStageContract } from "./body-substrate.js";
import type { RuntimeLayoutPort } from "./runtime-assembly.js";

export type RuntimeJson = null | boolean | number | string | readonly RuntimeJson[] | { readonly [key: string]: RuntimeJson };
export type RuntimeDigest = `sha256:${string}`;
export interface RuntimeSourceClosure {
  readonly entry: string;
  /** Exact UTF-8 source bytes, keyed by relative path. */
  readonly files: Readonly<Record<string, string>>;
  /** Exact external versions and artifact bytes; no ambient/latest resolution. */
  readonly dependencies: Readonly<Record<string, { readonly version: string; readonly artifact: RuntimeDigest }>>;
}
export interface RuntimeRendererDescriptor {
  readonly id: string;
  readonly source: RuntimeSourceClosure;
  readonly sourceHash: RuntimeDigest;
}
/** Exact public module identity supported by the selected Frame renderer. */
export interface RuntimePageHeaderModule {
  readonly package: "@clossys/designer/shell";
  readonly export: "PageHeaderModule";
  readonly renderer: RuntimeRendererDescriptor;
}
/** One exact public Stage identity shared by runtime and source validation. */
export const runtimeStageModuleIdentity = Object.freeze({ package: "@clossys/designer/frames", export: "FrameStage" } as const);
/** Source declaration for the one public Stage. It cannot render a host body. */
export interface RuntimeStageModule {
  readonly package: typeof runtimeStageModuleIdentity.package;
  readonly export: typeof runtimeStageModuleIdentity.export;
  readonly renderer: RuntimeRendererDescriptor;
}
export interface RuntimeStageCamera {
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly fitPadding: number;
}
export interface RuntimeStageModules {
  readonly map?: { readonly id: string; readonly label: string };
  readonly zoom?: { readonly id: string; readonly labels: { readonly group: string; readonly out: string; readonly in: string; readonly fit: string; readonly percent: string } };
}
/** Finite selected inputs, not another body or a node-producing callback. */
export interface RuntimeStageDescriptor {
  readonly module: RuntimeStageModule;
  readonly bodyDigest: RuntimeDigest;
  readonly label: RuntimeContentRef;
  readonly labels: Readonly<Record<string, RuntimeContentRef>>;
  readonly controller: RuntimeRendererDescriptor;
  readonly state: { readonly camera?: RuntimeStageCamera; readonly modules?: RuntimeStageModules; readonly currentBoardId?: string };
}
/** Only assembly creates this value, delivered exclusively to the selected Frame.
 * The closed package adapter constructs the imported Stage inside that Frame. */
export type RuntimeFrameStage<Node> = {
  readonly module: RuntimeStageModule;
  readonly contract: FrameStageContract;
  readonly label: string;
  readonly sectionNodes: readonly { readonly reference: { readonly slot: string; readonly index: number }; readonly label: string; readonly node: Node }[];
  readonly cell: RuntimeCell;
  readonly profile: CompositeResolved;
} & ({ readonly body: Extract<CompositionBody<{ readonly slot: string; readonly index: number }>, { kind: "flow" }>; readonly layout: RuntimeLayoutPort<Node> }
  | { readonly body: Extract<CompositionBody<{ readonly slot: string; readonly index: number }>, { kind: "canvas" }>; readonly collapseBelowPx: number; readonly camera: RuntimeStageCamera; readonly modules?: RuntimeStageModules; readonly currentBoardId?: string; readonly onViewportChange: (value: RuntimeStageCamera["viewport"]) => void; readonly onCurrentBoardChange?: (id: string) => void });
/** Bounded lease data and the existing compact action contract. No body node,
 * context slot, replacement header or page-render callback exists on this port. */
export interface RuntimeFramePageHeader<Node> {
  /** Existing Frame brand destination, projected from the registered home route. */
  readonly brand?: { readonly href: string; readonly label: string };
  readonly id: string;
  readonly data: Omit<FramePageHeader, "actions">;
  readonly module: RuntimePageHeaderModule;
  readonly actions?: {
    readonly renderer: RuntimeRendererDescriptor;
    readonly state: RuntimeJson;
    readonly render: (options: { readonly compact: boolean }) => Node;
  };
}
export interface RuntimeFillDescriptor {
  readonly kind: "frame" | "section";
  readonly library: string;
  readonly fill: string;
  readonly leaf: `frames.${string}` | `sections.${string}`;
  /** Null means the leaf has no selected configuration; never a fallback. */
  readonly config: string | null;
  readonly slots: readonly string[];
  readonly members: readonly string[];
  readonly states: readonly string[];
  readonly renderer: RuntimeRendererDescriptor;
  readonly surface?: import("./surface-types.js").SurfaceRuntimeIdentity;
  /** Only frame fills may support this imported header lease. */
  readonly headerModule?: RuntimePageHeaderModule;
  readonly stageModule?: RuntimeStageModule;
}
/** Serializable declarations only. Functions live exclusively on ConsumerRuntimePorts. */
export interface ConsumerRuntimeManifest {
  readonly version: 1;
  readonly consumer: string;
  readonly libraryHash: RuntimeDigest;
  readonly selectionHash: RuntimeDigest;
  readonly fills: readonly RuntimeFillDescriptor[];
  /** All assets actually read by these runtime callbacks; completeness is caller-owned. */
  readonly assetClosure: { readonly complete: boolean; readonly ids: readonly string[] };
}
export interface RuntimeContentRef { readonly kind: "copy" | "media" | "records" | "action" | "region"; readonly ref: string }
export interface RuntimeContent {
  readonly reference: RuntimeContentRef;
  readonly value: RuntimeJson;
  readonly hash: RuntimeDigest;
}
export interface RuntimeCell { readonly theme: string; readonly state: string; readonly width: number }
/** Public exports of the consumer's emitted component-index module. */
export type RuntimeComponentIndex = Readonly<Record<string, unknown>>;
export interface RuntimeRenderInput<Node> {
  /** Selected component exports; supplied by runtime assembly, never snapshotted. */
  readonly components?: RuntimeComponentIndex;
  /** Canonical page locale supplied by the host through Writer. */
  readonly locale?: string;
  readonly path: string;
  readonly fill: RuntimeFillDescriptor;
  readonly selection: RuntimeFillSelection;
  readonly cell: RuntimeCell;
  readonly content: Readonly<Record<string, RuntimeContent>>;
  readonly slots: Readonly<Record<string, readonly Node[]>>;
  readonly profile: CompositeResolved;
  /** Supplied only to the exact selected Frame renderer, never a Section. */
  readonly pageHeader?: RuntimeFramePageHeader<Node>;
  readonly stage?: RuntimeFrameStage<Node>;
  /** The host interaction port, supplied only to the exact selected Frame renderer. */
  readonly host?: RuntimeFrameHost<Node>;
  /** The live port registered for this Section's leaf (ConsumerRuntimePorts.sectionHosts), never a Frame's. */
  readonly sectionHost?: RuntimeSectionHost;
}
/**
 * Content key carrying a Section's anatomy header copy when its contract names `anatomy.header` and has no
 * contract slot of that name. Its value is one object keyed by the header contract's slot names
 * (sections.section-header: eyebrow, heading, description, actions), checked against that contract.
 */
export const SECTION_HEADER_CONTENT_KEY = "header";
/**
 * Live behaviour for one Section leaf, keyed by leaf in ConsumerRuntimePorts.sectionHosts (for example the
 * comparison library-board's checked previews and board commands). Behaviour, not data: never snapshotted.
 * Each renderer that reads one owns and checks its exact shape.
 */
export type RuntimeSectionHost = Readonly<Record<string, unknown>>;
export type RuntimeThemePreference = "system" | "light" | "dark";
/** Host interaction port for the selected Frame. A Frame's props split in
 * two: JSON content (the fill's host-node slots, resolved through RuntimeContent) and
 * this behaviour port. Functions and nodes never travel as RuntimeJson; assembly
 * delivers this port to the exact selected Frame renderer only, never a Section. */
export interface RuntimeFrameState {
  readonly navigating: boolean;
  readonly main: "ready" | "loading" | "error" | "not-found" | "forbidden";
}
export interface RuntimeFrameHost<Node> {
  /** Publication navigation updates these values without replacing its selected Frame. */
  readonly state?: RuntimeFrameState;
  /** Real query events; async search never runs inside the render-time filter. */
  onCommandQueryChange?(query: string): void;
  /** Performs one in-frame navigation (nav tree, account links, command hrefs, breadcrumb). */
  navigate(href: string): void | Promise<void>;
  /** Pending-save guard awaited before every navigate; `false` keeps the current page. */
  beforeNavigate?(href: string): boolean | Promise<boolean>;
  /** Runs a command item whose JSON content names `action` (an id) instead of `href`. */
  onCommand?(id: string): void;
  /** Runs an account entry of kind `action` or `destructive`, by entry id. */
  onAccountAction?(id: string): void;
  /** Applies an account entry of kind `preference`, by entry id. */
  onAccountPreference?(id: string, checked: boolean): void;
  /** Decorative icon nodes keyed by the icon ids JSON content names (navigation, commands). */
  readonly icons?: Readonly<Record<string, Node>>;
  /** Navigation-footer theme control: omitted keeps the package control, null removes it. */
  readonly themeControl?: Node | null;
  /** Theme state port; omitted, the Frame's provider owns and stores the preference. */
  readonly theme?: { readonly preference?: RuntimeThemePreference; readonly onPreferenceChange?: (preference: RuntimeThemePreference) => void; readonly storageKey?: string };
  /** Host modules mounted in the Frame's host-node regions, keyed by contract slot id
   * (e.g. `inspector` panel body, `header` start-of-bar context). Never a page body. */
  readonly panels?: Readonly<Record<string, Node>>;
  /** Host-owned toast viewport, mounted outside main. */
  readonly toasts?: Node;
  /** Live Frame notices docked above the stage, oldest first. */
  readonly notices?: readonly RuntimeFrameNotice<Node>[];
  /** Replaces the default case-insensitive label match of command search. */
  commandFilter?(item: { readonly id: string; readonly label: string; readonly description?: string }, query: string): boolean;
}
export interface RuntimeFrameNotice<Node> {
  readonly id: string;
  readonly severity: "error" | "warning" | "success" | "info";
  readonly text: Node;
  readonly action?: { readonly label: string; readonly onAction: () => void };
  readonly dismissible?: boolean;
}
export const RUNTIME_FRAME_HOST_KEYS = Object.freeze(["state", "onCommandQueryChange", "navigate", "beforeNavigate", "onCommand", "onAccountAction", "onAccountPreference", "commandFilter", "icons", "themeControl", "theme", "panels", "toasts", "notices"] as const);
/** Shape check only: the port carries behaviour, so it is never snapshotted or hashed. */
export function runtimeFrameHostFindings(host: unknown): string[] {
  if (host === undefined) return [];
  if (!host || typeof host !== "object") return ["frame host port must be an object"];
  const value = host as Record<string, unknown>, findings: string[] = [];
  if (Object.keys(value).some(key => !(RUNTIME_FRAME_HOST_KEYS as readonly string[]).includes(key))) findings.push("frame host port carries an unknown key");
  if (typeof value.navigate !== "function") findings.push("frame host navigate is required");
  for (const key of ["onCommandQueryChange", "beforeNavigate", "onCommand", "onAccountAction", "onAccountPreference", "commandFilter"] as const) if (value[key] !== undefined && typeof value[key] !== "function") findings.push(`frame host ${key} must be a function`);
  for (const key of ["icons", "panels", "theme"] as const) if (value[key] !== undefined && (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key]))) findings.push(`frame host ${key} must be a record`);
  if (value.notices !== undefined && !Array.isArray(value.notices)) findings.push("frame host notices must be a list");
  if (value.state !== undefined) {
    const state = value.state as Record<string, unknown> | null;
    if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).some(key => key !== "navigating" && key !== "main") || typeof state.navigating !== "boolean" || !["ready", "loading", "error", "not-found", "forbidden"].includes(String(state.main))) findings.push("frame state port is invalid");
  }
  const theme = value.theme as Record<string, unknown> | undefined;
  if (theme && (theme.preference !== undefined && !["system", "light", "dark"].includes(theme.preference as string) || theme.onPreferenceChange !== undefined && typeof theme.onPreferenceChange !== "function")) findings.push("frame host theme port is invalid");
  return findings;
}
/** Shape check only: one record per `sections.*` leaf, each a non-array object. */
export function runtimeSectionHostFindings(hosts: unknown): string[] {
  if (hosts === undefined) return [];
  if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) return ["section hosts must be a record keyed by Section leaf"];
  return Object.entries(hosts as Record<string, unknown>).flatMap(([leaf, host]) => [
    ...(/^sections\.[a-z0-9-]+$/.test(leaf) ? [] : [`section host key ${leaf} is not a Section leaf`]),
    ...(host && typeof host === "object" && !Array.isArray(host) ? [] : [`section host ${leaf} must be a record`]),
  ]);
}
export interface ConsumerRuntimePorts<Node> {
  readonly components: RuntimeComponentIndex;
  readonly manifest: ConsumerRuntimeManifest;
  readonly renderers: Readonly<Record<string, (input: RuntimeRenderInput<Node>) => Node>>;
  /** Behaviour for the selected Frame only (navigation guard, actions, icons, theme, panels). */
  readonly frameHost?: RuntimeFrameHost<Node>;
  /** Live behaviour per Section leaf; delivered only to Sections of that leaf. */
  readonly sectionHosts?: Readonly<Record<string, RuntimeSectionHost>>;
  resolveContent(reference: RuntimeContentRef): RuntimeContent | undefined;
  /** Required when frame section slots exist: complete order including layout and frame fills. */
  frameOrder?(input: { readonly cell: RuntimeCell; readonly layout: readonly string[]; readonly slots: Readonly<Record<string, readonly string[]>> }): readonly string[];
  /** Existing camera/current-board controller only; it never creates nodes. */
  readonly stageActions?: { readonly onViewportChange: (value: RuntimeStageCamera["viewport"]) => void; readonly onCurrentBoardChange?: (id: string) => void };
}
export interface RuntimePortFinding { readonly path: string; readonly message: string }
export interface RuntimePortCheck { readonly status: "valid" | "refused"; readonly findings: readonly RuntimePortFinding[] }

/** Both modes inspect the same descriptors; only a requested snapshot allocates copies. */
function walkRuntimeSnapshot(input: unknown, snapshot: boolean): unknown {
  const active = new Set<object>();
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || active.has(value)) throw new TypeError("runtime: plain finite snapshot required");
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) throw new TypeError("runtime: exotic snapshot object");
    const fields = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(fields).filter(key => !(array && key === "length"));
    if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw new TypeError("runtime: sparse snapshot array");
    active.add(value);
    const entries: [string, unknown][] | undefined = snapshot ? [] : undefined;
    for (const key of keys) {
      const field = fields[key as string]!;
      if (typeof key !== "string" || !field.enumerable || !("value" in field)) throw new TypeError("runtime: snapshot accessor or hidden field");
      if (field.value === undefined && !array) continue;
      const item = copy(field.value);
      if (entries) entries.push([key, item]);
    }
    active.delete(value);
    if (!entries) return undefined;
    const result = Object.freeze(array ? entries.map(([, item]) => item) : Object.fromEntries(entries));
    runtimeSnapshotCopies.add(result);
    return result;
  };
  return copy(input);
}
/** Validate snapshot data without copying, freezing or changing the caller's input.
 * Accepted object fields may contain undefined, so this does not narrow to RuntimeJson. */
export function assertRuntimeSnapshot(input: unknown): void { walkRuntimeSnapshot(input, false); }
/** Reject accessors, functions, exotic objects, cycles, sparse arrays and non-finite data. */
export function runtimeSnapshot<T>(input: T): T { return walkRuntimeSnapshot(input, true) as T; }
export function runtimeHash(value: unknown): RuntimeDigest { return `sha256:${sha256(stableStringify(runtimeSnapshot(value)))}`; }
export function isRuntimeDigest(value: unknown): value is RuntimeDigest { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value); }
export function runtimeSourceFindings(renderer: RuntimeRendererDescriptor): string[] {
  const findings: string[] = [];
  if (!renderer.id?.trim() || !renderer.source || !renderer.source.entry || !renderer.source.files || !renderer.source.dependencies) return ["missing renderer source identity"];
  const { source } = renderer;
  const path = (name: string) => /^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(name) && !name.split("/").some(part => part === "." || part === "..");
  if (!Object.hasOwn(source.files, source.entry) || Object.keys(source.files).some(file => !path(file) || typeof source.files[file] !== "string")) findings.push("invalid source closure");
  if (Object.values(source.dependencies).some(dep => !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(dep.version) || !isRuntimeDigest(dep.artifact))) findings.push("unbound dependency version or artifact");
  if (!isRuntimeDigest(renderer.sourceHash) || renderer.sourceHash !== runtimeHash(source)) findings.push("stale source hash");
  return findings;
}
/** Structural conformance, never a claim that a callback implements its descriptor. */
export function checkConsumerRuntimeManifest(input: ConsumerRuntimeManifest, catalog: Pick<BuildCatalogData, "slots">, expected: { consumer: string; libraryHash: string; selectionHash: string }): RuntimePortCheck {
  const findings: RuntimePortFinding[] = [];
  const add = (path: string, message: string) => findings.push({ path, message });
  try {
    const manifest = runtimeSnapshot(input);
    if (manifest.version !== 1 || manifest.consumer !== expected.consumer || manifest.libraryHash !== expected.libraryHash || manifest.selectionHash !== expected.selectionHash || !isRuntimeDigest(manifest.libraryHash) || !isRuntimeDigest(manifest.selectionHash)) add("manifest", "consumer or fresh whole-library/selection binding differs");
    if (!manifest.assetClosure || !Array.isArray(manifest.assetClosure.ids) || new Set(manifest.assetClosure.ids).size !== manifest.assetClosure.ids.length || manifest.assetClosure.ids.some(id => !id.startsWith("assets."))) add("manifest.assetClosure", "explicit unique asset closure required");
    const ids = new Set<string>(), keys = new Set<string>(), rendererIds = new Map<string, string>();
    for (const [index, fill] of manifest.fills.entries()) {
      const at = `fills.${index}`;
      if (fill.library !== manifest.consumer || !fill.fill?.trim() || ids.has(fill.fill)) add(at, "foreign, missing or duplicate fill identity");
      ids.add(fill.fill);
      const key = JSON.stringify([fill.leaf, fill.config]);
      if (keys.has(key)) add(at, "ambiguous leaf/config runtime fill");
      keys.add(key);
      const contract = catalog.slots.find(slot => slot.id === fill.leaf)?.contract;
      if (!contract || contract.kind !== fill.kind || !(fill.kind === "frame" || fill.kind === "section")) { add(at, "unknown leaf or wrong runtime kind"); continue; }
      const selected = contract as FrameContract | SectionContract;
      const slots = selected.kind === "frame" ? selected.slots.map(slot => slot.id) : selected.slots.map(slot => slot.name);
      if (typeof fill.config !== "string" && fill.config !== null || fill.config === "") add(at, "invalid explicit configuration");
      for (const [name, values, allowed] of [["slots", fill.slots, slots], ["members", fill.members, selected.members.names], ["states", fill.states.filter(state => state !== "default"), selected.kind === "section" ? selected.states ?? [] : selected.statePorts.map(port => port.id)]] as const) {
        if (new Set(values).size !== values.length || values.some(value => !allowed.some(option => option === value))) add(`${at}.${name}`, "unknown or duplicate supported value");
      }
      const required = selected.kind === "frame" ? selected.slots.filter(slot => slot.required).map(slot => slot.id) : selected.slots.filter(slot => slot.required).map(slot => slot.name);
      if (required.some(slot => !fill.slots.includes(slot))) add(`${at}.slots`, "required contract slot unsupported");
      if (!fill.states.includes("default") || new Set(fill.states).size !== fill.states.length) add(`${at}.states`, "default state required and states must be unique");
      if(fill.surface!==undefined){const keys=Object.keys(fill.surface).sort();if(keys.join(",")!=="apiHash,descriptorHash,inputsHash,outputHash,version"||fill.surface.version!==1||![fill.surface.descriptorHash,fill.surface.outputHash,fill.surface.apiHash,fill.surface.inputsHash].every(isRuntimeDigest))add(`${at}.surface`,"invalid surface runtime identity");}
      if (fill.headerModule !== undefined) {
        if (fill.kind !== "frame" || Object.keys(fill.headerModule).sort().join(",") !== "export,package,renderer" || fill.headerModule.package !== "@clossys/designer/shell" || fill.headerModule.export !== "PageHeaderModule") add(`${at}.headerModule`, "only the canonical imported Frame header module is supported");
        else for (const reason of runtimeSourceFindings(fill.headerModule.renderer)) add(`${at}.headerModule.renderer`, reason);
      }
      if (fill.stageModule !== undefined) {
        if (fill.kind !== "frame" || Object.keys(fill.stageModule).sort().join(",") !== "export,package,renderer" || fill.stageModule.package !== runtimeStageModuleIdentity.package || fill.stageModule.export !== runtimeStageModuleIdentity.export) add(`${at}.stageModule`, "only the canonical imported FrameStage is supported");
        else for (const reason of runtimeSourceFindings(fill.stageModule.renderer)) add(`${at}.stageModule.renderer`, reason);
      }
      for (const reason of runtimeSourceFindings(fill.renderer)) add(`${at}.renderer`, reason);
      const rendererHash = runtimeHash(fill.renderer);
      if (rendererIds.has(fill.renderer.id) && rendererIds.get(fill.renderer.id) !== rendererHash) add(at, "renderer id has conflicting source descriptors");
      rendererIds.set(fill.renderer.id, rendererHash);
    }
  } catch { add("manifest", "invalid runtime manifest or ports"); }
  return { status: findings.length ? "refused" : "valid", findings };
}

/** Callback presence is checked in addition to the same canonical manifest rules. */
export function checkConsumerRuntimePorts<Node>(ports: ConsumerRuntimePorts<Node>, catalog: BuildCatalogData, expected: { consumer: string; libraryHash: string; selectionHash: string }): RuntimePortCheck {
  const findings = [...checkConsumerRuntimeManifest(ports?.manifest, catalog, expected).findings];
  try {
    for (const [index, fill] of ports.manifest.fills.entries()) if (typeof ports.renderers[fill.renderer.id] !== "function") findings.push({ path: `fills.${index}.renderer`, message: "runtime callback missing" });
    if (!ports.components || typeof ports.components !== "object" || Array.isArray(ports.components)) findings.push({ path: "components", message: "consumer component index is required" });
    for (const message of runtimeFrameHostFindings(ports.frameHost)) findings.push({ path: "frameHost", message });
    for (const message of runtimeSectionHostFindings(ports.sectionHosts)) findings.push({ path: "sectionHosts", message });
  }
  catch { findings.push({ path: "manifest", message: "invalid runtime manifest or ports" }); }
  return { status: findings.length ? "refused" : "valid", findings };
}
