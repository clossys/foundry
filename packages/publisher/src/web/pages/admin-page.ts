import { runtimeHash, type RuntimeContent, type RuntimeJson } from "@clossys/designer/catalog";
import type { ContentRef, PublicationBinding, SectionFill } from "../../core/instance-binding.js";
import type { RegionPageRouteRegistration, RegionPageRouteRegistry, RouteSourceExport } from "../../core/route-registry.js";
import type { RegisteredPageManifest } from "../../content/taxonomy.js";
import { assertAdminPageCopy, bindAdminPageLoaders, type AdminPageCopy, type AdminPageCopyRef, type AdminPageLoaders } from "./admin-copy.js";
import { adminPageChatHost, adminPageSectionHosts } from "./admin-copy-ports.js";
import { createRegisteredPageSession, type RegisteredPageSessionOptions } from "../registered-route-query.js";

export type AdminPageKind = "designer" | "writer" | "publisher";
export interface AdminPageNode { readonly id: string; readonly label: AdminPageCopyRef; readonly count: number; readonly estimate: number }
export interface AdminPageSkeleton { readonly l0: readonly (AdminPageNode & { readonly partition?: "l1"; readonly l1: readonly (AdminPageNode & { readonly l2: readonly AdminPageNode[] })[] })[] }
export interface AdminPageSources { readonly list?: { readonly entry: RouteSourceExport; readonly source: RouteSourceExport }; readonly item?: { readonly entry: RouteSourceExport; readonly source: RouteSourceExport }; readonly runtime?: RouteSourceExport }
export interface AdminPageRecordOptions {
  readonly publicationId: string;
  readonly manifest: AdminPageSkeleton;
  /** Resolve Writer aliases in the consumer's locale. No English store is imported. */
  readonly copy: AdminPageCopy;
  readonly sources?: AdminPageSources;
  readonly homeRouteId?: string;
  /** Concrete item L0 selects the item's outline; the registered path remains parameterized. */
  readonly itemL0?: string;
  /** Consumer-owned item name, already resolved through Writer in its locale. */
  readonly itemTitle?: AdminPageCopyRef;
}
const copyRef = (ref: string): ContentRef => ({ kind: "copy", ref: `strings.admin.${ref}` });
export const ADMIN_PAGE_COPY_REFS = {
  showAll: copyRef("action.showAll"), pinToChat: copyRef("action.pinToChat"), openItem: copyRef("action.openItem"),
  outline: copyRef("outline.label"), emptyTitle: copyRef("empty.title"), emptyDescription: copyRef("empty.description"),
  noResultsTitle: copyRef("noResults.title"), noResultsDescription: copyRef("noResults.description"),
  previous: copyRef("pagination.previous"), next: copyRef("pagination.next"), pagination: copyRef("pagination.label"),
  search: copyRef("search.label"), searchPlaceholder: copyRef("search.placeholder"),
  outlineToggle: copyRef("toggle.outline"), chatToggle: copyRef("toggle.chat"),
} as const;
export function adminPageRef(kind: AdminPageKind, name: string, type: ContentRef["kind"] = "records"): ContentRef { return { kind: type, ref: `admin.${kind}/${name}` }; }
function lazy(kind: AdminPageKind, name: string, l0: string, l1?: string, type: ContentRef["kind"] = "records"): ContentRef {
  return { ...adminPageRef(kind, name, type), lazy: { loader: "chunk", args: { l0, ...(l1 ? { l1 } : {}) } } };
}
export const ADMIN_PAGE_COLUMNS = {
  designer: [["preview", "preview"], ["name", "text"], ["source", "text"], ["status", "status"], ["usedBy", "list"]],
  writer: [["key", "text"], ["text", "text"], ["localeCoverage", "list"], ["status", "status"], ["usedIn", "list"]],
  publisher: [["item", "text"], ["contentSource", "list"], ["positionRoute", "text"], ["status", "status"], ["lastPublished", "date"]],
} as const;
/** Loader helpers keep all audience labels in W1. Rows, anchors and formatted dates remain consumer data. */
export function adminPageColumns(kind: AdminPageKind, copy: AdminPageRecordOptions["copy"]) {
  assertAdminPageCopy(copy);
  return ADMIN_PAGE_COLUMNS[kind].map(([key, columnKind]) => ({ key, label: copy(`strings.admin.column.${key}`), kind: columnKind }));
}
/** Synchronous manifest content is required before requesting any lazy chunk. */
export function adminPageStaticContent(kind: AdminPageKind, manifest: AdminPageSkeleton, copy: AdminPageRecordOptions["copy"]): readonly RuntimeContent[] {
  assertAdminPageCopy(copy);
  const values: [ContentRef, RuntimeJson][] = [[adminPageRef(kind, "columns"), adminPageColumns(kind, copy)], [ADMIN_PAGE_COPY_REFS.outline, copy(ADMIN_PAGE_COPY_REFS.outline.ref)]];
  for (const row of manifest.l0) {
    values.push([adminPageRef(kind, `${row.id}/heading`, "copy"), { text: copy(row.label), id: row.id }], [adminPageRef(kind, `${row.id}/stats`), [{ id: "count", label: copy("strings.admin.stats.total", { count: row.count }) }]]);
  }
  return values.map(([reference, value]) => ({ reference, value, hash: runtimeHash(value) }));
}
export function createAdminPageRecords(kind: AdminPageKind, options: AdminPageRecordOptions) {
  assertAdminPageCopy(options.copy);
  const main: SectionFill[] = [], title = options.copy(`strings.admin.page.${kind}`);
  const module: SectionFill = { section: "sections.table-of-contents", content: { headings: adminPageRef(kind, "outline"), "active-id": adminPageRef(kind, "active-id"), label: ADMIN_PAGE_COPY_REFS.outline } };
  const manifest: RegisteredPageManifest = { l0: options.manifest.l0.map(l0 => {
    const index = main.length;
    main.push({ section: "sections.section-header", config: "level-2", members: { align: "start", density: "compact" }, content: { heading: adminPageRef(kind, `${l0.id}/heading`, "copy"), stats: adminPageRef(kind, `${l0.id}/stats`) } });
    if (!l0.count) main.push({ section: "sections.empty-state", members: { kind: "empty", scope: "region" }, content: { header: lazy(kind, `${l0.id}/empty`, l0.id, undefined, "copy") } });
    const l1 = l0.l1.map(band => {
      const bandIndex = main.length, partition = l0.partition === "l1" ? band.id : undefined;
      const prefix = `${l0.id}/${band.id}`;
      main.push({ section: "sections.band", members: { ground: "sunken", measure: "wide" }, content: {},
        repeat: { over: lazy(kind, `${prefix}/band`, l0.id, partition) as ContentRef & { kind: "records" }, key: "id" }, children: [
          { section: "sections.section-header", config: "level-3", members: { align: "start", density: "compact" }, content: { heading: adminPageRef(kind, "band.heading", "copy"), stats: adminPageRef(kind, "band.stats") } },
          { section: "sections.data-table", repeat: { over: adminPageRef(kind, "cards") as ContentRef & { kind: "records" }, key: "id" }, content: {
            header: adminPageRef(kind, "card.header", "copy"), columns: adminPageRef(kind, "columns"), rows: adminPageRef(kind, "card.rows"),
            pagination: adminPageRef(kind, "card.pagination", "region"),
          } },
        ] });
      return { ...band, label: options.copy(band.label), section: { slot: "main", index: bandIndex, children: [0], key: band.id }, l2: band.l2.map(card => ({ ...card, label: options.copy(card.label), section: { slot: "main", index: bandIndex, children: [1], keys: [band.id, card.id] } })) };
    });
    return { ...l0, label: options.copy(l0.label), section: { slot: "main", index }, l1 };
  }) };
  const itemL0 = options.itemL0 ?? options.manifest.l0[0]?.id;
  if (!itemL0 || !options.manifest.l0.some(row => row.id === itemL0)) throw new TypeError("Item outline requires one consumer manifest L0");
  const itemMain: SectionFill[] = [
    { section: "sections.section-header", config: "level-2", members: { align: "start", density: "compact" }, content: { heading: adminPageRef(kind, "item/heading", "copy"), stats: adminPageRef(kind, "item/stats") } },
    { section: "sections.record-detail", content: { fields: adminPageRef(kind, "item/fields"), status: adminPageRef(kind, "item/status", "copy") } },
  ];
  const tables = kind === "designer" ? ["preview"] : kind === "writer" ? ["locales"] : ["sections", "releases"];
  for (const table of tables) itemMain.push({ section: "sections.data-table", content: {
    header: adminPageRef(kind, `item/${table}/header`, "copy"), columns: adminPageRef(kind, `item/${table}/columns`), rows: adminPageRef(kind, `item/${table}/rows`),
    pagination: adminPageRef(kind, `item/${table}/pagination`, "region"),
  } });
  const selected = options.manifest.l0.find(row => row.id === itemL0)!;
  const itemManifest: RegisteredPageManifest = { l0: [{ id: selected.id, label: options.copy(options.itemTitle ?? selected.label), count: 1, estimate: selected.estimate, section: { slot: "main", index: 0 }, l1: [
    { id: "details", label: options.copy("strings.admin.item.details"), count: 1, estimate: 200, section: { slot: "main", index: 1 }, l2: [] },
    ...tables.map((table, index) => ({ id: table, label: options.copy(`strings.admin.${table === "preview" ? "column.preview" : `item.${table}`}`), count: 0, estimate: 200, section: { slot: "main", index: index + 2 }, l2: [] })),
  ] }] };
  const route = (item: boolean): RegionPageRouteRegistration => {
    const routeId = `admin.${kind}${item ? ".item" : ""}`, path = `/agents/${kind}${item ? "/[l0]/[id]" : ""}`, sources = options.sources?.[item ? "item" : "list"], routeTitle = item && options.itemTitle ? options.copy(options.itemTitle) : title;
    return { routeId, path, title: routeTitle, channel: "admin", brand: { homeRouteId: options.homeRouteId ?? "admin.designer", label: options.copy("strings.admin.page.designer") }, planItemId: `app.${routeId}`,
      entry: sources?.entry ?? { file: `app/agents/${kind}/${item ? "[l0]/[id]/" : ""}page.tsx`, export: "default" },
      composition: { source: sources?.source ?? { file: `src/generated/${routeId}.tsx`, export: "default" }, runtime: options.sources?.runtime ?? { file: "src/admin/runtime.ts", export: "useAdminPageRuntime" },
        header: { id: `header.${routeId}`, data: { title: routeTitle } },
        binding: { instanceId: routeId, label: routeTitle, path, publicationId: options.publicationId, regions: { main: item ? itemMain : main, "page-module": [module], inspector: adminPageRef(kind, item ? "item/context" : "context") } },
      } };
  };
  const list = route(false), item = route(true), query = adminPageRef(kind, "search") as ContentRef & { kind: "records" };
  const staticContent = adminPageStaticContent(kind, options.manifest, options.copy);
  const createSession = (input: Omit<RegisteredPageSessionOptions, "routeId" | "page" | "path" | "manifest" | "query" | "loaders"> & { readonly item?: boolean; readonly itemPath?: string; readonly loaders: AdminPageLoaders }) => {
    if (input.item && !options.itemTitle) throw new TypeError("An item route requires its bound Writer item title");
    const selectedRoute = input.item ? item : list;
    const { item: isItem, itemPath, loaders, ...sessionInput } = input;
    const concretePath = itemPath ?? input.navigation.path?.();
    if (isItem && !concretePath) throw new TypeError("An item session requires its concrete router path");
    const page = createRegisteredPageSession({ ...sessionInput, navigation: { ...input.navigation, ...(itemPath ? { path: () => itemPath } : {}) }, routeId: selectedRoute.routeId, page: selectedRoute.composition.binding, path: selectedRoute.path, manifest: isItem ? itemManifest : manifest, query, loaders: bindAdminPageLoaders(options.copy, loaders) });
    const resolveContent = (reference: ContentRef) => {
      const read = page.read(reference); return read.status === "ready" ? read.content : staticContent.find(content => content.reference.kind === reference.kind && content.reference.ref === reference.ref);
    };
    const sectionHosts = (existing: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {}) => {
      const fields = resolveContent(adminPageRef(kind, "item/fields"));
      if (isItem && !fields && page.frameState()?.main === "ready") throw new TypeError("Ready item omitted Writer-bound fields");
      const hosts = adminPageSectionHosts({ copy: options.copy, title: isItem ? options.itemTitle! : { id: `strings.admin.page.${kind}` }, item: isItem, includeRecordDetail: !(isItem && !fields), fields });
      return { ...existing, ...Object.fromEntries(Object.entries(hosts).map(([leaf, host]) => [leaf, { ...existing[leaf], ...host }])) };
    };
    return { page, itemPath: concretePath, resolveContent, sectionHosts, copyProvenance: options.copy.provenance };
  };
  return { list, item, manifest, itemManifest, query, staticContent, createSession, copyProvenance: options.copy.provenance };
}
export interface AdminPageRegistryOptions {
  readonly publication: PublicationBinding;
  readonly copy: AdminPageRecordOptions["copy"];
  readonly manifests: Readonly<Record<AdminPageKind, AdminPageSkeleton>>;
  readonly sources?: Readonly<Partial<Record<AdminPageKind, AdminPageSources>>>;
  readonly itemL0?: Readonly<Partial<Record<AdminPageKind, string>>>;
  readonly itemTitles?: Readonly<Partial<Record<AdminPageKind, AdminPageCopyRef>>>;
}
export function createAdminPageRegistry(options: AdminPageRegistryOptions) {
  const consumer = options.publication.context.consumer;
  if (!consumer) throw new TypeError("Admin page publication requires its selected consumer");
  const publication: PublicationBinding = { ...options.publication, inspector: options.publication.inspector ?? { section: "sections.chat", members: { part: "message" }, content: { parts: { kind: "records", ref: "admin.chat/parts" }, composer: { kind: "region", ref: "admin.chat/composer" } } } };
  const pages = Object.fromEntries((["designer", "writer", "publisher"] as const).map(kind => [kind, createAdminPageRecords(kind, { publicationId: publication.id, manifest: options.manifests[kind], copy: options.copy, sources: options.sources?.[kind], itemL0: options.itemL0?.[kind], itemTitle: options.itemTitles?.[kind] })])) as Record<AdminPageKind, ReturnType<typeof createAdminPageRecords>>;
  const registry: RegionPageRouteRegistry = { version: 1, consumer, publication, routes: Object.values(pages).flatMap(page => [page.list, page.item]) };
  return { registry, pages, publicationHosts: { "sections.chat": adminPageChatHost(options.copy) }, copyProvenance: options.copy.provenance, manifests: Object.fromEntries(Object.entries(pages).map(([kind, page]) => [kind, page.manifest])) as Record<AdminPageKind, RegisteredPageManifest> };
}
