import { deriveDesignerLayerBoardsV1, DESIGNER_LAYER_BOARDS_QUERY } from "@clossys/designer/studio/queries";
import type { DesignerLayerBoardsInput } from "@clossys/designer/studio/queries";
import { libraryHash, resolve, runtimeHash, runtimeSnapshot, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { CompositeEngineInput, RuntimeContent, RuntimeContentRef, RuntimeJson, RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import type { ConsumerInstanceLibrary, ContentRef, InstanceBinding, InstanceRegistries, PublicationBinding, RegionPageBinding } from "../core/instance-binding.js";
import { contentReferenceKey, isRegisteredContentRef, staticContentReference } from "../core/instance-binding.js";
import { projectPageOutline } from "../content/taxonomy.js";
import type { RegisteredPageManifest, RegisteredPageOutline } from "../content/taxonomy.js";
import type { ReactNode } from "react";
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

export type RegisteredFrameRouteState = { readonly main: "loading" | "ready" | "error" | "not-found" | "forbidden"; readonly navigating: boolean };
export interface RegisteredRegionUpdate {
  readonly routeId: string;
  readonly trail: RuntimeJson;
  readonly regions: Readonly<Record<string, readonly ReactNode[]>>;
  readonly inspectorContext?: RuntimeJson;
  readonly headerActions?: ReactNode;
  readonly chunks?: readonly RegisteredPageChunk[];
}
export interface RegisteredPublicationRegions {
  readonly headerTrail: RuntimeJson;
  readonly headerActions?: ReactNode;
  readonly pageModule: readonly ReactNode[];
  readonly main?: readonly ReactNode[];
  readonly inspectorContext?: RuntimeJson;
}
export interface RegisteredPageChunk {
  readonly id: string;
  readonly estimate: number;
  readonly status: "unrequested" | "pending" | "ready" | "error";
  readonly content?: readonly ReactNode[];
  load(): Promise<void>;
}
export interface RegisteredPageCommandGroup { readonly id: string; readonly label: string; readonly count: number; readonly items: readonly { readonly id: string; readonly label: string; readonly href: string }[] }
export interface RegisteredPublicationFramePorts {
  navigate(href: string): Promise<void>;
  onCommandQueryChange(query: string): void;
}
/** Injected Designer-owned persistent frame. These ports receive only selected
 * Section output; a consumer cannot supply a page body renderer. */
export interface RegisteredPublicationHost {
  bind(publication: PublicationBinding, ports: RegisteredPublicationFramePorts): void;
  setRegions(update: RegisteredPublicationRegions): void;
  setState(state: RegisteredFrameRouteState): void;
  setCommands(groups: readonly RegisteredPageCommandGroup[]): void;
  setChunks(chunks: readonly RegisteredPageChunk[]): void;
}
export interface RegisteredPublicationSession {
  readonly publication: PublicationBinding;
  readonly host: RegisteredPublicationHost;
  setPage(update: RegisteredRegionUpdate, source?: RegisteredPageSession): void;
  setState(state: RegisteredFrameRouteState, source?: RegisteredPageSession): void;
  activate(routeId: string): void;
  isCurrent(routeId: string, page?: RegisteredPageSession): boolean;
  attachPage(page: RegisteredPageSession): void;
}
const publicationHosts = new WeakMap<RegisteredPublicationHost, RegisteredPublicationSession>();
/** The same frame host binds once for a publication lifetime. Page navigation
 * replaces main/trail/page-module only; inspector data changes context, not chat. */
export function createRegisteredPublicationSession(publication: PublicationBinding, host: RegisteredPublicationHost): RegisteredPublicationSession {
  const snapshot = runtimeSnapshot(publication);
  if (!snapshot.id?.trim() || !snapshot.mainSlot?.trim() || !snapshot.frame?.leaf?.startsWith("frames.") || !snapshot.layout?.leaf || !snapshot.layout.config || !snapshot.context.consumer || snapshot.format !== "web.page.responsive") throw new TypeError("Selected publication frame and arrangement required");
  const current = publicationHosts.get(host);
  if (current) {
    if (runtimeHash(current.publication) !== runtimeHash(snapshot)) throw new TypeError("A bound publication frame cannot be replaced");
    return current;
  }
  if (!host || typeof host.bind !== "function" || typeof host.setRegions !== "function" || typeof host.setState !== "function" || typeof host.setCommands !== "function" || typeof host.setChunks !== "function") throw new TypeError("Persistent Designer frame ports required");
  let active: string | undefined, bound = false, activePage: RegisteredPageSession | undefined, unsubscribe: (() => void) | undefined, commandsHash: string | undefined;
  const ports: RegisteredPublicationFramePorts = Object.freeze({
    async navigate(href: string) {
      if (!activePage?.isCurrent()) return;
      if (href.startsWith("#")) await activePage.navigate(href);
      else { if (!activePage.options.navigation.navigate) throw new TypeError("Client page navigation port required"); await activePage.options.navigation.navigate(href); }
    },
    onCommandQueryChange(query: string) { if (activePage?.isCurrent()) void activePage.search(query).catch(() => {}); },
  });
  const bind = () => { if (!bound) { host.bind(snapshot, ports); bound = true; } };
  const session: RegisteredPublicationSession = Object.freeze({ publication: snapshot, host,
    activate(routeId: string) { if (!routeId.trim()) throw new TypeError("Page route identity required"); bind(); active = routeId; },
    isCurrent(routeId: string, page?: RegisteredPageSession) { return (active === undefined || active === routeId) && (page === undefined || activePage === undefined || activePage === page); },
    attachPage(page: RegisteredPageSession) {
      bind(); active = page.options.routeId ?? page.options.page.instanceId;
      if (activePage === page) return;
      unsubscribe?.(); activePage = page;
      const update = () => { if (!page.isCurrent()) return; const groups = page.commandGroups(), hash = runtimeHash(groups); if (hash !== commandsHash) { commandsHash = hash; host.setCommands(groups); } };
      unsubscribe = page.subscribe(update); update();
    },
    setPage(update: RegisteredRegionUpdate, source?: RegisteredPageSession) {
      if (source && !session.isCurrent(update.routeId, source)) return;
      if (active !== undefined && active !== update.routeId) return;
      if (Object.keys(update.regions).some(key => !["main", "page-module"].includes(key))) throw new TypeError("Page navigation cannot replace persistent frame regions");
      bind();
      active = update.routeId;
      host.setRegions({ headerTrail: update.trail, ...(update.chunks ? {} : { main: update.regions.main ?? [] }), pageModule: update.regions["page-module"] ?? [], ...(update.headerActions === undefined ? {} : { headerActions: update.headerActions }), ...(update.inspectorContext === undefined ? {} : { inspectorContext: update.inspectorContext }) });
      if (update.chunks) host.setChunks(update.chunks);
    },
    setState(state: RegisteredFrameRouteState, source?: RegisteredPageSession) {
      if (source && !session.isCurrent(source.options.routeId ?? source.options.page.instanceId, source)) return;
      if (Object.keys(state).some(key => !["main", "navigating"].includes(key)) || !["ready", "loading", "error", "not-found", "forbidden"].includes(state.main) || typeof state.navigating !== "boolean") throw new TypeError("Invalid frame route state");
      bind(); host.setState(Object.freeze({ ...state }));
    },
  });
  publicationHosts.set(host, session); return session;
}
export interface RegisteredPageSearchHit { readonly l0: string; readonly anchor?: string; readonly href?: string; readonly label: string; readonly kind: string }
export interface RegisteredPageLoaders {
  chunk(args: { readonly l0: string; readonly l1?: string }): Promise<readonly RuntimeContent[]>;
  search(query: string): Promise<readonly RegisteredPageSearchHit[]>;
  item(l0: string, id: string): Promise<RegisteredPageItem | undefined>;
}
export interface RegisteredPageItem { readonly record: RuntimeJson; readonly content: readonly RuntimeContent[] }
export interface RegisteredPageNavigation {
  hash(): string;
  path?(): string;
  scroll(anchor: string): void | Promise<void>;
  focus(anchor: string): void;
  replaceState(hash: string): void;
  pushState?(hash: string): void;
  navigate?(href: string): void | Promise<void>;
}
export interface RegisteredPageSessionOptions {
  readonly routeId?: string;
  readonly page: InstanceBinding | RegionPageBinding;
  readonly path: string;
  readonly manifest: RegisteredPageManifest;
  readonly query: ContentRef & { readonly kind: "records" };
  readonly loaders: RegisteredPageLoaders;
  readonly navigation: RegisteredPageNavigation;
  readonly chat?: { pin(context: { readonly l0: string; readonly id: string; readonly record: RuntimeJson }): void };
  readonly publication?: RegisteredPublicationSession;
}
export type RegisteredItemResult = { readonly status: "ready"; readonly code: 200; readonly l0: string; readonly id: string; readonly record: RuntimeJson }
  | { readonly status: "not-found"; readonly code: 404 };
export interface RegisteredPageSession {
  readonly options: RegisteredPageSessionOptions;
  readonly outline: RegisteredPageOutline;
  readonly subscribe: (listener: () => void) => () => void;
  readonly revision: () => number;
  isCurrent(): boolean;
  activate(): void;
  deactivate(): void;
  activeAnchor(): string | undefined;
  frameState(): RegisteredFrameRouteState | undefined;
  read(reference: ContentRef): { readonly status: "pending" } | { readonly status: "ready"; readonly content: RuntimeContent };
  request(reference: ContentRef): Promise<void>;
  requestChunk(args: { readonly l0: string; readonly l1?: string }): Promise<void>;
  chunkStatus(args: { readonly l0: string; readonly l1?: string }): RegisteredPageChunk["status"];
  start(): Promise<void>;
  navigate(href: string): Promise<void>;
  scrollSpy(anchor: string): void;
  search(query: string): Promise<void>;
  commandGroups(): readonly RegisteredPageCommandGroup[];
  loadItem(path: string): Promise<RegisteredItemResult>;
  selectionHost(l0: string, existing?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> & { onSelectionChange(ids: readonly string[]): Promise<void> };
}
/** Consumer loader session: no eager chunk requests, no render-time fetching,
 * and no retained result is ever authenticated source/lifecycle evidence. */
export function createRegisteredPageSession(input: RegisteredPageSessionOptions): RegisteredPageSession {
  const page = runtimeSnapshot(input.page), manifest = runtimeSnapshot(input.manifest), outline = projectPageOutline(page, manifest);
  if (!/^\/(?:[^/?#\\]+\/?)*$/.test(input.path) || input.path.includes("//") || input.path.includes("%") || input.path.split("/").some(part => part === "." || part === "..") || !isRegisteredContentRef(input.query) || input.query.kind !== "records" || input.query.lazy) throw new TypeError("Canonical page path and records query reference required");
  if (input.publication && !input.routeId?.trim()) throw new TypeError("Publication page session requires its registered route identity");
  const options = Object.freeze({ ...input, page, manifest }), contents = new Map<string, RuntimeContent>(), owners = new Map<string, string>(), lazyScopes = new Map<string, string>();
  const requests = new Map<string, Promise<void>>(), chunkStates = new Map<string, RegisteredPageChunk["status"]>(), listeners = new Set<() => void>();
  let revision = 0, sequence = 0, navigationSequence = 0, selectionSequence = 0, active = true, activeAnchor: string | undefined, frameState: RegisteredFrameRouteState | undefined, started: Promise<void> | undefined, groups = outline.groups;
  const publish = () => { revision++; for (const listener of [...listeners]) listener(); };
  const currentPage = () => active && (options.publication?.isCurrent(options.routeId ?? page.instanceId, session) ?? true);
  const state = (value: RegisteredFrameRouteState) => { if (currentPage() && runtimeHash(frameState ?? null) !== runtimeHash(value)) { frameState = Object.freeze({ ...value }); options.publication?.setState(value, session); publish(); } };
  const fail = (error: unknown): never => { state({ main: "error", navigating: false }); throw error; };
  const save = (current: RuntimeContent, owner: string, replaceItem = false) => {
    if (!isRegisteredContentRef(current.reference) || current.reference.lazy || current.hash !== runtimeHash(current.value)) throw new TypeError("Chunk returned stale or invalid content");
    const key = contentReferenceKey(current.reference), previous = contents.get(key);
    if (previous && owners.get(key) !== owner && !(replaceItem && owner.startsWith("item:") && owners.get(key)?.startsWith("item:"))) throw new TypeError("Consumer content belongs to another scope");
    contents.set(key, runtimeSnapshot(current)); owners.set(key, owner);
  };
  const validArgs = (args: { readonly l0: string; readonly l1?: string }) => {
    if (!args || Object.keys(args).some(key => !["l0", "l1"].includes(key))) throw new TypeError("Invalid chunk arguments");
    const l0 = manifest.l0.find(row => row.id === args.l0);
    if (!l0 || args.l1 !== undefined && !l0.l1.some(row => row.id === args.l1)) throw new TypeError("Chunk is outside the supplied page manifest");
  };
  const itemParams = (path: string): { l0: string; id: string } | undefined => {
    const prefix = options.path.replace(/\/\[l0\]\/\[id\]$/, "").replace(/\/$/, "") + "/";
    if (!path.startsWith(prefix) || /[?#\\]/.test(path)) return;
    const segments = path.slice(prefix.length).split("/");
    if (segments.length !== 2) return;
    try {
      const [l0, id] = segments.map(segment => decodeURIComponent(segment));
      if (!l0 || !id || [l0, id].some(segment => segment.trim() !== segment || /[/\\]/.test(segment) || segment === "." || segment === "..") || !manifest.l0.some(row => row.id === l0)) return;
      return { l0, id };
    } catch { return; }
  };
  const session: RegisteredPageSession = {
    options, outline,
    activate() { active = true; options.publication?.attachPage(session); },
    deactivate() { active = false; sequence++; navigationSequence++; selectionSequence++; },
    isCurrent: currentPage, activeAnchor: () => activeAnchor, frameState: () => frameState,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, revision: () => revision,
    read(reference) {
      if (!isRegisteredContentRef(reference)) throw new TypeError("Invalid page content reference");
      if (reference.lazy) {
        validArgs(reference.lazy.args);
        const key = contentReferenceKey(reference), scope = JSON.stringify([reference.lazy.args.l0, reference.lazy.args.l1 ?? null]), previous = lazyScopes.get(key), owner = owners.get(key);
        if (previous !== undefined && previous !== scope || owner !== undefined && owner !== scope) throw new TypeError("Lazy reference belongs to another chunk scope");
        lazyScopes.set(key, scope);
      }
      const current = contents.get(contentReferenceKey(reference)); return current ? { status: "ready", content: current } : { status: "pending" };
    },
    async request(reference) {
      if (!isRegisteredContentRef(reference) || !reference.lazy) throw new TypeError("Only a declared lazy chunk reference can be requested");
      session.read(reference);
      try { await session.requestChunk(reference.lazy.args); if (session.read(reference).status !== "ready") throw new TypeError("Chunk omitted its requested content reference"); }
      catch (error) { fail(error); }
    },
    requestChunk(args) {
      validArgs(args); const key = JSON.stringify([args.l0, args.l1 ?? null]);
      const existing = requests.get(key); if (existing) return existing;
      chunkStates.set(key, "pending"); publish();
      const promise = (async () => {
        try { const data = await options.loaders.chunk({ ...args }); if (!Array.isArray(data)) throw new TypeError("Chunk loader must return content records"); for (const current of data) save(current, key); chunkStates.set(key, "ready"); publish(); }
        catch (error) { chunkStates.set(key, "error"); publish(); return fail(error); }
      })();
      requests.set(key, promise); return promise;
    },
    chunkStatus(args) { validArgs(args); return chunkStates.get(JSON.stringify([args.l0, args.l1 ?? null])) ?? "unrequested"; },
    start() {
      return started ??= (async () => { const hash = options.navigation.hash(); if (hash) await go(hash, false); else if (options.navigation.path && (options.path.endsWith("/[l0]/[id]") || itemParams(options.navigation.path()))) await session.loadItem(options.navigation.path()); })();
    },
    navigate: href => go(href, true),
    scrollSpy(anchor) { if (!Object.hasOwn(outline.targets, anchor)) throw new TypeError("Unknown scroll-spy anchor"); if (!currentPage()) return; activeAnchor = anchor; options.navigation.replaceState(`#${anchor}`); publish(); },
    async search(query) {
      const request = ++sequence, reference = staticContentReference(options.query), value = [{ query }];
      save({ reference, value, hash: runtimeHash(value) }, "query"); publish();
      try {
        const hits = await options.loaders.search(query), next = new Map<string, { id: string; label: string; count: number; items: { id: string; label: string; href: string }[] }>();
        const ids = new Set<string>();
        for (const hit of hits) {
          const l0 = manifest.l0.find(row => row.id === hit.l0), target = hit.anchor ? outline.targets[hit.anchor] : undefined;
          if (!l0 || typeof hit.label !== "string" || !hit.label.trim() || !hit.kind || (!!hit.anchor === !!hit.href) || hit.anchor && (!target || target.l0 !== hit.l0) || hit.href && itemParams(hit.href)?.l0 !== hit.l0) throw new TypeError("Search hit is outside the supplied page");
          const id = hit.anchor ?? hit.href!;
          if (ids.has(id)) throw new TypeError("Duplicate page search target"); ids.add(id);
          let group = next.get(l0.id); if (!group) { group = { id: l0.id, label: l0.label, count: 0, items: [] }; next.set(l0.id, group); }
          group.items.push({ id, label: hit.label, href: hit.anchor ? `#${hit.anchor}` : hit.href! }); group.count++;
        }
        if (request === sequence && currentPage()) { groups = manifest.l0.flatMap(row => next.has(row.id) ? [next.get(row.id)!] : []); publish(); }
      } catch (error) { if (request === sequence && currentPage()) fail(error); }
    },
    commandGroups: () => groups,
    async loadItem(path) {
      const request = ++navigationSequence;
      const params = itemParams(path);
      if (!params) { state({ main: "not-found", navigating: false }); return { status: "not-found", code: 404 }; }
      state({ main: "loading", navigating: true });
      try {
        const item = await options.loaders.item(params.l0, params.id);
        if (item === undefined) { if (request === navigationSequence) state({ main: "not-found", navigating: false }); return { status: "not-found", code: 404 }; }
        if (!item || !Array.isArray(item.content) || item.record === undefined) throw new TypeError("Item loader must return its actual record and content bindings");
        const current = runtimeSnapshot(item.record);
        if (request === navigationSequence && currentPage()) { for (const value of item.content) save(value, `item:${params.l0}/${params.id}`, true); state({ main: "ready", navigating: false }); publish(); }
        return { status: "ready", code: 200, ...params, record: current };
      } catch (error) { if (request === navigationSequence && currentPage()) return fail(error); throw error; }
    },
    selectionHost(l0, existing = {}) {
      if (!manifest.l0.some(row => row.id === l0)) throw new TypeError("Selection scope is outside the supplied page");
      return { ...existing, async onSelectionChange(ids: readonly string[]) {
        const request = ++selectionSequence;
        if (!Array.isArray(ids) || ids.length > 1 || ids.some(id => typeof id !== "string" || !id.trim())) throw new TypeError("Page table selection is single-select");
        if (!ids.length) return;
        const item = await options.loaders.item(l0, ids[0]!);
        if (item !== undefined && (!item || !Array.isArray(item.content) || item.record === undefined)) throw new TypeError("Selection item loader must return its actual record and content bindings");
        if (item !== undefined && request === selectionSequence && currentPage()) options.chat?.pin({ l0, id: ids[0]!, record: runtimeSnapshot(item.record) });
      } };
    },
  };
  async function go(href: string, history: boolean): Promise<void> {
    const anchor = href.startsWith("#") ? href.slice(1) : "", target = outline.targets[anchor], request = ++navigationSequence;
    if (!target) throw new TypeError("Hash target is outside the supplied page outline");
    state({ main: "loading", navigating: true });
    try {
      await session.requestChunk({ l0: target.l0, ...(target.l1 ? { l1: target.l1 } : {}) });
      if (request !== navigationSequence || !currentPage()) return;
      state({ main: "ready", navigating: true });
      await options.navigation.scroll(anchor);
      if (request !== navigationSequence || !currentPage()) return;
      activeAnchor = anchor;
      if (history) (options.navigation.pushState ?? options.navigation.replaceState)(`#${anchor}`);
      options.navigation.focus(anchor); state({ main: "ready", navigating: false }); publish();
    } catch (error) { if (request === navigationSequence && currentPage()) fail(error); }
  }
  return Object.freeze(session);
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
