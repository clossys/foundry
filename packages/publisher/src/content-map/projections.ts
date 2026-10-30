import { isLegacyRouteRegistration, routeSourcePath } from "../core/route-identities.js";
import { isCompleteRouteMetadataKind } from "./complete-route-metadata.js";
import type { CompleteRouteMetadata } from "./complete-route-metadata.js";
import type { AnyRouteRegistration, RouteRegistration, RouteSourceExport } from "../core/route-registry.js";
import { PUBLISHER_CHANNELS } from "../planning/channel-ids.js";
import { checkedContentMap, contentMapPath, contentMapOrigin, contentMapLastModified } from "./check.js";
import { projectContentMapRedirects } from "./redirects.js";
import { projectPageOutline } from "../content/taxonomy.js";
import type { PageOutlineHeading } from "../content/taxonomy.js";
import type { ContentMap, ContentMapBreadcrumb, ContentMapCommand, ContentMapCommandGroup, ContentMapEntry, ContentMapNode, ContentMapRedirect, ContentMapStaticParams, ContentMapNavigation, ContentMapNavigationNode, ContentMapOutlineNode, ContentMapTocEntry, ContentMapRouteOptions, ContentMapRoutes, ContentMapSitemapEntry, ContentMapSitemapOptions } from "./contract.js";

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const sameBrand = (left: RouteRegistration["brand"], right: RouteRegistration["brand"]) => left.homeRouteId === right.homeRouteId && left.label === right.label;
const navigable = (entry: ContentMapNode) => entry.kind === "page" || entry.kind === "section";
function web(map: ContentMap): void {
  checkedContentMap(map);
  if (map.format !== "web.page.responsive") throw new TypeError("Web projection requires web.page.responsive");
}
function ordered(map: ContentMap, parentId?: string): ContentMapNode[] {
  return map.entries.filter(entry => entry.parentId === parentId).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function preorder(map: ContentMap): ContentMapNode[] {
  const visit = (parentId?: string): ContentMapNode[] => ordered(map, parentId).flatMap(entry => [entry, ...visit(entry.id)]);
  return visit();
}
function ancestry(map: ContentMap, id: string): ContentMapNode[] {
  const byId = new Map(map.entries.map(entry => [entry.id, entry]));
  let entry = byId.get(id);
  if (!entry) throw new TypeError(`Content-map entry is missing: ${id}`);
  const rows: ContentMapNode[] = [];
  while (entry) { rows.unshift(entry); entry = entry.parentId === undefined ? undefined : byId.get(entry.parentId); }
  return rows;
}
function presentation(entry: ContentMapNode) {
  return { id: entry.id, label: entry.title, ...(entry.icon ? { icon: entry.icon } : {}) };
}
/** Data only: the complete group > page > section hierarchy is preserved.
 * Older two-level frame renderers must not truncate this three-level contract. */
export function projectNavigation(map: ContentMap, activeId: string): ContentMapNavigation {
  web(map);
  const active = map.entries.find(entry => entry.id === activeId);
  if (!active || !navigable(active)) throw new TypeError("An existing page or section is required as the active entry");
  const visit = (parentId?: string): ContentMapNavigationNode[] => ordered(map, parentId).flatMap(entry => {
    if (!entry.pin) return [];
    const children = visit(entry.id);
    if (entry.kind === "group" && !children.length) return [];
    return [{ ...presentation(entry), ...(entry.kind === "external" ? { href: entry.href, external: true as const } : navigable(entry) ? { href: contentMapPath(entry) } : {}), ...(children.length ? { children } : {}) }];
  });
  return { tree: visit(), activeId };
}
/** Every page/section is discoverable, including unpinned destinations. Groups
 * use their top-level map identity; root pages use the publication identity.
 * Action groups with an existing group identity merge, keeping IDs unique. */
export function projectCommands(map: ContentMap): readonly ContentMapCommandGroup[] {
  web(map);
  const groups = new Map<string, { id: string; label: string; items: ContentMapCommand[] }>();
  const group = (id: string, label: string) => {
    let value = groups.get(id);
    if (!value) { value = { id, label, items: [] }; groups.set(id, value); }
    return value;
  };
  for (const entry of preorder(map).filter(entry => navigable(entry) || entry.kind === "external")) {
    const top = ancestry(map, entry.id).find(row => row.kind === "group");
    group(top?.id ?? map.publicationId, top?.title ?? map.publicationId).items.push({ ...presentation(entry), href: entry.kind === "external" ? entry.href : contentMapPath(entry), ...(entry.description ? { description: entry.description } : {}) });
  }
  for (const action of map.actions ?? []) group(action.group, action.group).items.push({ id: action.id, label: action.label, action: action.intent });
  return [...groups.values()];
}
export function projectBreadcrumbs(map: ContentMap, currentId: string): readonly ContentMapBreadcrumb[] {
  web(map);
  return ancestry(map, currentId).map(entry => ({ id: entry.id, label: entry.title, ...(entry.kind === "external" ? { href: entry.href } : navigable(entry) ? { href: contentMapPath(entry) } : {}) }));
}
/** Only public site page URLs enter a sitemap. Sections are query/subpath views
 * of their owning pages; admin, app and other channels cannot emit a sitemap. */
export function projectSitemap(map: ContentMap, options: ContentMapSitemapOptions): readonly ContentMapSitemapEntry[] {
  web(map);
  if (options.channel !== "site") throw new TypeError(`Sitemap refused for ${options.channel} channel`);
  const origin = contentMapOrigin(options.origin);
  return preorder(map).filter(entry => entry.kind === "page" && entry.indexing?.mode !== "noindex").map(entry => {
    const url = new URL(contentMapPath(entry), origin);
    if (url.origin !== origin.origin) throw new TypeError("Sitemap target must stay on the publication origin");
    return { url: url.href, ...(entry.lastModified !== undefined ? { lastModified: contentMapLastModified(entry.lastModified) } : {}) };
  });
}
function sourceExport(value: RouteSourceExport): boolean {
  return !!value && Object.keys(value).every(key => ["file", "export"].includes(key)) && routeSourcePath(value.file) && /^[A-Za-z_$][\w$]*$/.test(value.export);
}
const NEXT_FILE = /(?:^|\/)(?:page|layout|template|route|default|loading|error|global-error|not-found|middleware|instrumentation)\.[cm]?[jt]sx?$/;
function registered(mapEntry: ContentMapEntry, options: ContentMapRouteOptions): AnyRouteRegistration | CompleteRouteMetadata {
  const matches = (options.registrations ?? []).filter(route => {
    if (mapEntry.source.planItemId !== undefined) return route.planItemId === mapEntry.source.planItemId;
    if (!isLegacyRouteRegistration(route)) return false;
    const binding = route.composition.binding;
    const sections = [...new Set([...Object.values(binding.fills).flat().map(fill => fill.section), ...Object.values(binding.frame.slotFills ?? {}).map(fill => fill.section)])].sort();
    return binding.frame.leaf === mapEntry.source.frameId && equal(sections, [...mapEntry.source.sectionIds].sort());
  });
  if (matches.length !== 1) throw new TypeError(`One registered source required for ${mapEntry.id}`);
  const route = matches[0]!;
  if (route.routeId !== mapEntry.id || route.path !== contentMapPath(mapEntry) || route.title !== mapEntry.title || route.channel !== options.channel || !sameBrand(route.brand, options.brand)
    || (isLegacyRouteRegistration(route) && (route.composition.binding.path !== route.path || route.composition.binding.context.consumer !== options.consumer))) throw new TypeError(`Registered source disagrees with content map: ${mapEntry.id}`);
  return structuredClone(route);
}
/** Pure publication metadata only, never executable registration. Content lives
 * in the map; source metadata supplies kind and registered module identities.
 * Historical projection bytes remain readable without authorizing a page.
 * Existing completeRoute plan fields are compatibility input only, and must
 * agree exactly with map identity/title/path/brand before they can project. */
export function projectRoutes(map: ContentMap, options: ContentMapRouteOptions): ContentMapRoutes {
  web(map);
  if (!text(options.consumer) || !PUBLISHER_CHANNELS.some(channel => channel.id === options.channel) || !options.brand || !text(options.brand.label)
    || !map.entries.some(entry => entry.kind === "page" && entry.id === options.brand.homeRouteId)) throw new TypeError("Actual consumer/channel and one mapped home page are required");
  const routes = preorder(map).filter((entry): entry is ContentMapEntry => entry.kind === "page").map(entry => {
    const id = entry.source.planItemId;
    const source = id === undefined ? undefined : options.completeRoutes?.[id];
    const plans = id === undefined ? [] : (options.planItems ?? []).filter(item => item.id === id && item.completeRoute !== undefined);
    if (plans.length > 1 || (source && plans.length)) throw new TypeError(`Ambiguous complete route source: ${entry.id}`);
    const plan = plans[0], complete = source ?? plan?.completeRoute;
    if (!complete) return registered(entry, options);
    if (plan && (plan.appRouteId !== entry.id || plan.completeRoute!.title !== entry.title || plan.completeRoute!.path !== contentMapPath(entry) || !sameBrand(plan.completeRoute!.brand, options.brand))) throw new TypeError(`Plan completeRoute disagrees with content map: ${entry.id}`);
    if (!isCompleteRouteMetadataKind(complete.kind) || !sourceExport(complete.entry) || complete.entry.export !== "default" || !complete.entry.file.endsWith(".tsx") || !sourceExport(complete.loader)
      || !/\.[jt]sx?$/.test(complete.loader.file) || complete.loader.file.endsWith(".d.ts") || NEXT_FILE.test(complete.loader.file) || complete.entry.file === complete.loader.file) throw new TypeError(`Registered complete route exports required: ${entry.id}`);
    return { routeId: entry.id, planItemId: id!, path: contentMapPath(entry), title: entry.title, channel: options.channel, brand: { ...options.brand }, entry: { ...complete.entry }, composition: { complete: { kind: complete.kind }, loader: { ...complete.loader } } };
  });
  if (new Set(routes.map(route => route.entry.file)).size !== routes.length) throw new TypeError("Each page requires its own registered executable entry");
  return { version: 1, consumer: options.consumer, routes };
}
/** Finite data for web, deck and document consumers. This is an outline, not an
 * exporter: only the manifest's actual Section placements produce page anchors. */
export function projectOutline(map: ContentMap): readonly ContentMapOutlineNode[] {
  checkedContentMap(map);
  const heading = (entry: ContentMapEntry, value: PageOutlineHeading): ContentMapOutlineNode => ({
    id: `${entry.id}#${value.id}`, label: value.label, href: `${contentMapPath(entry)}#${value.id}`,
    ...(value.children?.length ? { children: value.children.map(child => heading(entry, child)) } : {}),
  });
  const visit = (parentId?: string): ContentMapOutlineNode[] => ordered(map, parentId).map(entry => {
    const headings = entry.kind !== "external" && entry.manifest ? projectPageOutline({ fills: entry.constructs! }, entry.manifest).headings.map(value => heading(entry, value)) : [];
    const children = [...headings, ...visit(entry.id)];
    return { id: entry.id, label: entry.title, ...(entry.kind === "external" ? { href: entry.href } : entry.kind !== "group" ? { href: contentMapPath(entry) } : {}), ...(children.length ? { children } : {}) };
  });
  return visit();
}
/** Depth-first table of contents from exactly the same map and page anchors.
 * Page numbers remain the responsibility of the document renderer. */
export function projectToc(map: ContentMap): readonly ContentMapTocEntry[] {
  const visit = (nodes: readonly ContentMapOutlineNode[], level: number): ContentMapTocEntry[] => nodes.flatMap(({ children, ...node }) => [
    { ...node, level }, ...visit(children ?? [], level + 1),
  ]);
  return visit(projectOutline(map), 1);
}

/** Next-compatible redirects from explicit declarations and external entries. */
export function projectRedirects(map: ContentMap): readonly ContentMapRedirect[] {
  web(map);
  return projectContentMapRedirects(map);
}
/** Catch-all route parameters include noindex pages; external destinations and
 * structural groups never acquire local executable routes. Root uses []. */
export function projectStaticParams(map: ContentMap): readonly ContentMapStaticParams[] {
  web(map);
  return preorder(map).filter(entry => entry.kind === "page").map(entry => ({ slug: contentMapPath(entry).split("/").filter(Boolean) }));
}
