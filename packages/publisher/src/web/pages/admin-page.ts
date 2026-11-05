import { runtimeHash, runtimeSnapshot, type RuntimeContent, type RuntimeJson } from "@clossys/designer/catalog";
import type { ContentRef, PublicationBinding, SectionFill } from "../../core/instance-binding.js";
import type { RegionPageRouteRegistration, RegionPageRouteRegistry, RouteSourceExport } from "../../core/route-registry.js";
import type { RegisteredPageManifest } from "../../content/taxonomy.js";
import type { ContentMap, ContentMapEntry } from "../../content-map/contract.js";
import { checkedContentMap, contentMapPath } from "../../content-map/check.js";
import { assertAdminPageCopy, bindAdminPageLoaders, type AdminPageCopy, type AdminPageCopyRef, type AdminPageLoaders } from "./admin-copy.js";
import { adminPageChatHost, adminPageSectionHosts } from "./admin-copy-ports.js";
import { checkConsumerPageConfig, type ConsumerPageConfig } from "./consumer-page-contract.js";
import { createRegisteredPageSession, type RegisteredPageSessionOptions } from "../registered-route-query.js";
import { PUBLISHER_CHANNELS, type PublisherChannelId } from "../../planning/channel-ids.js";
import { routeSourcePath } from "../../core/route-identities.js";
export { checkConsumerPageConfig } from "./consumer-page-contract.js";
export type { ConsumerPageConfig, ConsumerPageColumn, ConsumerPageSectionStyle } from "./consumer-page-contract.js";

export interface ConsumerPageNode { readonly id: string; readonly label: AdminPageCopyRef; readonly count: number; readonly estimate: number }
export interface ConsumerPageSkeleton { readonly l0: readonly (ConsumerPageNode & { readonly partition?: "l1"; readonly l1: readonly (ConsumerPageNode & { readonly l2: readonly ConsumerPageNode[] })[] })[] }
export interface ConsumerPageSources { readonly list?: { readonly entry: RouteSourceExport; readonly source: RouteSourceExport }; readonly item?: { readonly entry: RouteSourceExport; readonly source: RouteSourceExport }; readonly runtime?: RouteSourceExport }
export interface ConsumerPageRecordOptions {
  readonly publicationId: string; readonly entry: ContentMapEntry; readonly itemEntry?: ContentMapEntry;
  readonly channel: PublisherChannelId;
  readonly brand: RegionPageRouteRegistration["brand"]; readonly manifest: ConsumerPageSkeleton; readonly copy: AdminPageCopy;
  readonly sources?: ConsumerPageSources; readonly itemL0?: string; readonly itemTitle?: AdminPageCopyRef;
}
export function consumerPageRef(namespace: string, name: string, type: ContentRef["kind"] = "records"): ContentRef {
  if (!namespace.trim() || !name.trim()) throw new TypeError("Consumer content namespace and reference name are required");
  return { kind: type, ref: `${namespace}/${name}` };
}
function lazy(namespace: string, name: string, l0: string, l1?: string, type: ContentRef["kind"] = "records"): ContentRef {
  return { ...consumerPageRef(namespace, name, type), lazy: { loader: "chunk", args: { l0, ...(l1 ? { l1 } : {}) } } };
}
export function consumerPageColumns(config: ConsumerPageConfig, copy: AdminPageCopy) {
  assertAdminPageCopy(copy);
  return config.columns.map(column => ({ key: column.key, label: copy(column.label), kind: column.kind }));
}
export function consumerPageStaticContent(config: ConsumerPageConfig, manifest: ConsumerPageSkeleton, copy: AdminPageCopy): readonly RuntimeContent[] {
  assertAdminPageCopy(copy);
  const values: [ContentRef, RuntimeJson][] = [[consumerPageRef(config.namespace, "columns"), consumerPageColumns(config, copy)], [{ kind: "copy", ref: config.copy.outline.id }, copy(config.copy.outline)]];
  for (const row of manifest.l0) values.push(
    [consumerPageRef(config.namespace, `${row.id}/heading`, "copy"), { text: copy(row.label), id: row.id }],
    [consumerPageRef(config.namespace, `${row.id}/stats`), [{ id: "count", label: copy({ ...config.copy.count, values: { ...config.copy.count.values, count: row.count } }) }]],
  );
  return values.map(([reference, value]) => ({ reference, value, hash: runtimeHash(value) }));
}
export function createConsumerPageRecords(config: ConsumerPageConfig, options: ConsumerPageRecordOptions) {
  const findings = checkConsumerPageConfig(config);
  if (findings.length) throw new TypeError(`Consumer page config refused: ${findings.join("; ")}`);
  config = runtimeSnapshot(config);
  const kind = config.namespace;
  assertAdminPageCopy(options.copy);
  const main: SectionFill[] = [], title = options.copy(config.title);
  if (options.entry.id !== config.entryId || options.entry.pageConfig !== config.id || options.entry.title !== title) throw new TypeError("Consumer page config identity/title differs from its content-map entry");
  if (!!config.item !== !!options.itemEntry || config.item && (options.itemEntry!.id !== config.item.entryId || options.itemEntry!.pageConfig !== config.id)) throw new TypeError("Consumer item config differs from its content-map entry");
  const module: SectionFill | null = config.pageModule === undefined ? { section: "sections.table-of-contents", content: { headings: consumerPageRef(kind, "outline"), "active-id": consumerPageRef(kind, "active-id"), label: { kind: "copy", ref: config.copy.outline.id } } } : config.pageModule;
  const manifest: RegisteredPageManifest = { l0: options.manifest.l0.map(l0 => {
    const index = main.length;
    main.push({ ...config.levels.l0.header, content: { heading: consumerPageRef(kind, `${l0.id}/heading`, "copy"), stats: consumerPageRef(kind, `${l0.id}/stats`) } });
    if (!l0.count) {
      if (!config.levels.l0.empty) throw new TypeError("An empty consumer level requires a selected empty Section");
      main.push({ ...config.levels.l0.empty, content: { header: lazy(kind, `${l0.id}/empty`, l0.id, undefined, "copy") } });
    }
    const l1 = l0.l1.map(band => {
      const bandIndex = main.length, partition = l0.partition === "l1" ? band.id : undefined;
      const prefix = `${l0.id}/${band.id}`;
      main.push({ ...config.levels.l1.band, content: {},
        repeat: { over: lazy(kind, `${prefix}/band`, l0.id, partition) as ContentRef & { kind: "records" }, key: config.levels.l1.key }, children: [
          { ...config.levels.l1.header, content: { heading: consumerPageRef(kind, "band.heading", "copy"), stats: consumerPageRef(kind, "band.stats") } },
          { ...config.levels.l2.table, repeat: { over: consumerPageRef(kind, "cards") as ContentRef & { kind: "records" }, key: config.levels.l2.key }, content: {
            header: consumerPageRef(kind, "card.header", "copy"), columns: consumerPageRef(kind, "columns"), rows: consumerPageRef(kind, "card.rows"),
            pagination: consumerPageRef(kind, "card.pagination", "region"),
          } },
        ] });
      return { ...band, label: options.copy(band.label), section: { slot: "main", index: bandIndex, children: [0], key: band.id }, l2: band.l2.map(card => ({ ...card, label: options.copy(card.label), section: { slot: "main", index: bandIndex, children: [1], keys: [band.id, card.id] } })) };
    });
    return { ...l0, label: options.copy(l0.label), section: { slot: "main", index }, l1 };
  }) };

  const itemL0 = options.itemL0 ?? options.manifest.l0[0]?.id;
  if (config.item && (!itemL0 || !options.manifest.l0.some(row => row.id === itemL0))) throw new TypeError("Item outline requires one consumer manifest L0");
  const itemMain: SectionFill[] = config.item ? [
    { ...config.levels.l0.header, content: { heading: consumerPageRef(kind, "item/heading", "copy"), stats: consumerPageRef(kind, "item/stats") } },
    ...config.item.sections.map(section => runtimeSnapshot(section.fill)),
  ] : [];
  const selected = options.manifest.l0.find(row => row.id === itemL0);
  const itemManifest: RegisteredPageManifest | undefined = config.item && selected ? { l0: [{
    id: selected.id, label: options.copy(options.itemTitle ?? config.title), count: 1, estimate: selected.estimate, section: { slot: "main", index: 0 },
    l1: config.item.sections.map((section, index) => ({ id: section.id, label: options.copy(section.label), count: 1, estimate: section.estimate, section: { slot: "main", index: index + 1 }, l2: [] })),
  }] } : undefined;
  const route = (item: boolean): RegionPageRouteRegistration => {
    const entry = item ? options.itemEntry! : options.entry, sources = options.sources?.[item ? "item" : "list"], runtimeSource = options.sources?.runtime;
    const routeId = entry.id, path = contentMapPath(entry), routeTitle = item && options.itemTitle ? options.copy(options.itemTitle) : title;
    if (entry.title !== routeTitle) throw new TypeError("Writer route title differs from its content-map entry");
    const sourceRef = (value: RouteSourceExport | undefined): value is RouteSourceExport => !!value && Object.keys(value).every(key => ["file", "export"].includes(key)) && routeSourcePath(value.file) && /^[A-Za-z_$][\w$]*$/.test(value.export) && /\.[cm]?[jt]sx?$/.test(value.file) && !value.file.endsWith(".d.ts");
    if (!sources || !sourceRef(sources.entry) || !sources.entry.file.endsWith(".tsx") || !sourceRef(sources.source) || !sourceRef(runtimeSource) || !("planItemId" in entry.source) || !entry.source.planItemId) throw new TypeError("Consumer page requires actual source modules and mapped plan ownership");
    return { routeId, path, title: routeTitle, channel: options.channel, brand: { ...options.brand }, planItemId: entry.source.planItemId,
      entry: sources.entry,
      composition: { source: sources.source, runtime: runtimeSource,
        header: { id: `header.${routeId}`, data: { title: routeTitle } },
        binding: { instanceId: routeId, label: routeTitle, path, publicationId: options.publicationId, regions: { main: item ? itemMain : main, ...(module ? {"page-module":[runtimeSnapshot(module)]} : {}), inspector: consumerPageRef(kind, item ? "item/context" : "context") } },
      } };
  };
  const list = route(false), item = config.item ? route(true) : undefined, query = consumerPageRef(kind, "search") as ContentRef & { kind: "records" };
  const staticContent = consumerPageStaticContent(config, options.manifest, options.copy);
  const createSession = (input: Omit<RegisteredPageSessionOptions, "routeId" | "page" | "path" | "manifest" | "query" | "loaders"> & { readonly item?: boolean; readonly itemPath?: string; readonly loaders: AdminPageLoaders }) => {
    if (input.item && !options.itemTitle) throw new TypeError("An item route requires its bound Writer item title");
    const selectedRoute = input.item ? item : list;
    if (!selectedRoute) throw new TypeError("Consumer page has no declared item config");
    const { item: isItem, itemPath, loaders, ...sessionInput } = input;
    const concretePath = itemPath ?? input.navigation.path?.();
    if (isItem && !concretePath) throw new TypeError("An item session requires its concrete router path");
    const page = createRegisteredPageSession({ ...sessionInput, navigation: { ...input.navigation, ...(itemPath ? { path: () => itemPath } : {}) }, routeId: selectedRoute.routeId, page: selectedRoute.composition.binding, path: selectedRoute.path, manifest: isItem ? itemManifest! : manifest, query, loaders: bindAdminPageLoaders(options.copy, loaders) });
    const resolveContent = (reference: ContentRef) => {
      const read = page.read(reference); return read.status === "ready" ? read.content : staticContent.find(content => content.reference.kind === reference.kind && content.reference.ref === reference.ref);
    };
    const sectionHosts = (existing: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {}) => {
      const fieldRef = config.item?.sections.find(section => section.fill.section === "sections.record-detail")?.fill.content.fields;
      const fields = fieldRef ? resolveContent(fieldRef) : undefined;
      if (isItem && fieldRef && !fields && page.frameState()?.main === "ready") throw new TypeError("Ready item omitted Writer-bound fields");
      const hosts = adminPageSectionHosts({ copy: options.copy, title: isItem ? options.itemTitle! : config.title, bindings: config.copy, item: isItem, includeRecordDetail: !!fieldRef && !(isItem && !fields), fields });
      return { ...existing, ...Object.fromEntries(Object.entries(hosts).map(([leaf, host]) => [leaf, { ...existing[leaf], ...host }])) };
    };
    return { page, itemPath: concretePath, resolveContent, sectionHosts, copyProvenance: options.copy.provenance };
  };
  return { list, item, manifest, itemManifest, query, staticContent, createSession, copyProvenance: options.copy.provenance, levels: { l0: config.levels.l0.verb, l1: config.levels.l1.verb, l2: config.levels.l2.verb, l3: config.levels.l3.verb } };
}

export interface ConsumerPageRegistryOptions {
  readonly publication: PublicationBinding; readonly map: ContentMap<"web.page.responsive">;
  readonly channel: PublisherChannelId;
  readonly configs: readonly ConsumerPageConfig[]; readonly copy: AdminPageCopy;
  readonly manifests: Readonly<Record<string, ConsumerPageSkeleton>>;
  readonly brand?: { readonly homeRouteId: string; readonly label: AdminPageCopyRef };
  readonly sources?: Readonly<Record<string, ConsumerPageSources>>;
  readonly itemL0?: Readonly<Record<string, string>>;
  readonly itemTitles?: Readonly<Record<string, AdminPageCopyRef>>;
}
export function createConsumerPageRegistry(options: ConsumerPageRegistryOptions) {
  assertAdminPageCopy(options.copy); checkedContentMap(options.map);
  if (options.publication.id !== options.map.publicationId || options.map.format !== "web.page.responsive" || !options.publication.context.consumer || !PUBLISHER_CHANNELS.some(channel => channel.id === options.channel)) throw new TypeError("Consumer publication, channel and content map must agree");
  const configs = new Map<string, ConsumerPageConfig>(), namespaces = new Set<string>();
  for (const config of options.configs) {
    const findings = checkConsumerPageConfig(config);
    if (findings.length || configs.has(config.id) || namespaces.has(config.namespace)) throw new TypeError("Consumer page config is malformed or duplicated");
    configs.set(config.id, config); namespaces.add(config.namespace);
  }
  const mapped = options.map.entries.filter(entry => entry.pageConfig !== undefined);
  if (options.map.entries.some(entry => entry.kind === "page" && entry.pageConfig === undefined)) throw new TypeError("Every consumer page requires its config reference");
  for (const entry of mapped) if (!configs.has(entry.pageConfig!)) throw new TypeError("Content-map page config is missing");
  const home = options.brand?.homeRouteId ?? options.configs[0]?.entryId;
  const homeConfig = options.configs.find(config => config.entryId === home);
  if (!home || !homeConfig) throw new TypeError("Consumer home entry requires one page config");
  const brand = { homeRouteId: home, label: options.copy(options.brand?.label ?? homeConfig.title) };
  const publication = options.publication;
  const pages: Record<string, ReturnType<typeof createConsumerPageRecords>> = {};
  for (const config of options.configs) {
    const entries = mapped.filter(entry => entry.pageConfig === config.id);
    const entry = entries.find(entry => entry.id === config.entryId), itemEntry = config.item ? entries.find(entry => entry.id === config.item!.entryId) : undefined;
    if (!entry || entries.length !== (config.item ? 2 : 1) || !!config.item !== !!itemEntry || !options.manifests[config.id]) throw new TypeError("Orphan or mismatched consumer page config reference");
    pages[config.id] = createConsumerPageRecords(config, { publicationId: publication.id, channel: options.channel, entry, itemEntry, brand, manifest: options.manifests[config.id]!, copy: options.copy, sources: options.sources?.[config.id], itemL0: options.itemL0?.[config.id], itemTitle: options.itemTitles?.[config.id] });
  }
  const registry: RegionPageRouteRegistry = { version: 1, consumer: publication.context.consumer!, publication, routes: Object.values(pages).flatMap(page => [page.list, ...(page.item ? [page.item] : [])]) };
  // One placement-backed outline serves both native pages and map projections.
  const map: ContentMap<"web.page.responsive"> = { ...options.map, entries: options.map.entries.map(entry => {
    if (!entry.pageConfig) return entry;
    const page = pages[entry.pageConfig]!, isItem = entry.id !== page.list.routeId;
    const route = isItem ? page.item! : page.list;
    const manifest = isItem ? page.itemManifest! : page.manifest;
    const constructs = { main: route.composition.binding.regions.main };
    if (entry.manifest && (runtimeHash(entry.manifest) !== runtimeHash(manifest) || runtimeHash(entry.constructs) !== runtimeHash(constructs))) throw new TypeError("Content-map manifest or constructs conflict with the native consumer page outline");
    return { ...entry, manifest, constructs };
  }) };
  checkedContentMap(map);
  const first = options.configs[0];
  if (publication.inspector?.section === "sections.chat" && options.configs.some(config => runtimeHash(config.copy.chat) !== runtimeHash(first?.copy.chat))) throw new TypeError("A persistent Chat requires consistent consumer copy bindings");
  return { registry, pages, map, manifests: Object.fromEntries(Object.entries(pages).map(([id, page]) => [id, page.manifest])), publicationHosts: first && publication.inspector?.section === "sections.chat" ? { "sections.chat": adminPageChatHost(options.copy, first.copy) } : {}, copyProvenance: options.copy.provenance, copyPreview: options.copy.previewState() };
}
