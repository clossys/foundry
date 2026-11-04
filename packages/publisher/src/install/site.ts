/**
 * Publisher site plan: a consumer's content map plus its route pack become one routed site.
 *
 * Publisher only assembles. The content map owns paths, titles and navigation pins; the route
 * pack owns each route's ordered section slots. `planSite` joins the two and reports every
 * disagreement as a finding: each content-map page needs exactly one route-pack route (same
 * id, same path), the route's active slots must be the page's sections, and every route
 * shares one frame. `applySiteNavigation` then points a bound page's frame links at the
 * content map, and `siteLinkFindings` reports any internal link that leads to no route.
 * Nothing here writes page markup; the routed app is generated from the bound pages.
 */
import { checkContentMap, contentMapOrigin, contentMapPath } from "../content-map/check.js";
import { projectNavigation, projectSitemap } from "../content-map/projections.js";
import type { ContentMap, ContentMapEntry, ContentMapNavigationNode } from "../content-map/contract.js";
import type { BoundPage, BoundSlot, InstallFinding } from "./index.js";

/** One route-pack slot: the section it mounts and the config that fills it. */
export interface SiteRouteSlot { readonly section: string; readonly config?: string; readonly state?: string }
/** One route-pack route, keyed to its content-map page by `instanceId`. */
export interface SiteRoutePackRoute {
  readonly instanceId: string;
  readonly path?: string;
  readonly label?: string;
  readonly writerCell?: string;
  readonly state?: string;
  readonly slots: readonly SiteRouteSlot[];
}
/** A consumer route pack: the pinned `publication.<packId>` slot's projection (`projectPinnedPublication`), or a legacy `route-pack/<packId>.json`. */
export interface SiteRoutePack {
  readonly packId: string;
  readonly app?: string;
  /** The deployment origin the site is served from (`https://example.com`); every route path resolves under it. */
  readonly origin?: string;
  readonly routes: readonly SiteRoutePackRoute[];
}
/** Target config for one install: `origin` overrides the route pack's (a local preview, a staging host). */
export interface SitePlanOptions { readonly origin?: string }

/** A navigation link: `label` is the content-map title (a Writer key), `href` a content-map path. */
export interface SiteLink { readonly id: string; readonly label: string; readonly href: string }
export interface SitePlanRoute {
  /** The content-map entry id; also the Publisher page cell id (`page.<id>`). */
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly frame: string;
  /** The route pack's active slots, in order. */
  readonly sections: readonly string[];
}
export interface SitePlan {
  readonly schema: "clossys.site-plan/1";
  readonly publicationId: string;
  readonly packId: string;
  readonly app?: string;
  /** The one frame every route shares. */
  readonly frame: string;
  /** Content-map order. */
  readonly routes: readonly SitePlanRoute[];
  /** `primary`: nav-pinned entries (header); `secondary`: every other page (footer). */
  readonly navigation: { readonly primary: readonly SiteLink[]; readonly secondary: readonly SiteLink[] };
  /** The deployment origin, from target config or the route pack; never assumed. */
  readonly origin?: string;
  /** Absolute page URLs under `origin` (indexable pages only); absent without an origin. */
  readonly sitemap?: readonly string[];
}

const finding = (code: InstallFinding["code"], detail: string, severity?: "info"): InstallFinding => ({ code, detail, ...(severity ? { severity } : {}) });
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

function flatten(nodes: readonly ContentMapNavigationNode[]): SiteLink[] {
  return nodes.flatMap(node => [...(node.href && !node.external ? [{ id: node.id, label: node.label, href: node.href }] : []), ...flatten(node.children ?? [])]);
}

/** Join a content map and a route pack into one site plan; any blocking finding means no plan. */
export function planSite(map: ContentMap, pack: SiteRoutePack, options: SitePlanOptions = {}): { plan?: SitePlan; findings: InstallFinding[] } {
  const findings: InstallFinding[] = [];
  for (const row of checkContentMap(map)) findings.push(finding("site-contract", `content map ${row.path}: ${row.message}`));
  if (findings.length) return { findings };
  if (map.format !== "web.page.responsive") return { findings: [finding("site-contract", `content map ${map.publicationId} is ${map.format}; a routed site needs web.page.responsive`)] };
  if (!isRecord(pack) || typeof pack.packId !== "string" || !Array.isArray(pack.routes)) return { findings: [finding("site-contract", "route pack needs a packId and routes")] };

  const pages = map.entries.filter((entry): entry is ContentMapEntry => entry.kind === "page")
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  if (!pages.length) return { findings: [finding("site-contract", `content map ${map.publicationId} has no pages`)] };
  const byId = new Map<string, SiteRoutePackRoute[]>();
  for (const route of pack.routes) byId.set(route.instanceId, [...(byId.get(route.instanceId) ?? []), route]);

  const routes: SitePlanRoute[] = [];
  for (const page of pages) {
    const path = contentMapPath(page);
    const matches = byId.get(page.id) ?? [];
    if (matches.length !== 1) { findings.push(finding(matches.length ? "site-route-duplicate" : "site-route-missing", `${page.id} (${path}): the route pack has ${matches.length} routes for it; it needs exactly one`)); continue; }
    const route = matches[0]!;
    if (route.path !== undefined && route.path !== path) findings.push(finding("site-path-mismatch", `${page.id}: the route pack path ${route.path} is not the content-map path ${path}`));
    if (!page.source.frameId) { findings.push(finding("site-contract", `${page.id}: the content-map page names no frameId`)); continue; }
    const active = route.slots.filter(slot => slot.state === undefined || slot.state === "active");
    for (const slot of route.slots) if (!active.includes(slot)) findings.push(finding("site-inactive-slot", `${page.id}: route-pack slot ${slot.section} is ${slot.state}; it is not mounted`, "info"));
    const sections = active.map(slot => slot.section);
    const declared = page.source.sectionIds ?? [];
    if (JSON.stringify(sections) !== JSON.stringify(declared)) findings.push(finding("site-sections-mismatch", `${page.id}: route-pack slots [${sections.join(", ")}] are not the content-map sections [${declared.join(", ")}]`));
    routes.push({ id: page.id, path, title: page.title, frame: page.source.frameId, sections });
  }
  for (const route of pack.routes) if (!pages.some(page => page.id === route.instanceId)) findings.push(finding("site-route-extra", `route-pack route ${route.instanceId} has no content-map page`));
  const frames = [...new Set(routes.map(route => route.frame))];
  if (frames.length > 1) findings.push(finding("site-frame-mismatch", `routes use ${frames.length} frames (${frames.join(", ")}); a routed site shares one`));
  const origin = options.origin ?? pack.origin;
  let site: URL | undefined;
  if (origin !== undefined) {
    try { site = contentMapOrigin(origin); } catch { findings.push(finding("site-contract", `origin ${origin} is not an HTTP(S) origin with no path, query or hash`)); }
  } else findings.push(finding("site-contract", "no deployment origin (route pack `origin` or --origin); the site uses root-relative paths and writes no sitemap", "info"));
  if (findings.some(row => row.severity !== "info") || !routes.length) return { findings };

  const primary = flatten(projectNavigation(map, routes[0]!.id).tree);
  const pinned = new Set(primary.map(link => link.href));
  const secondary = routes.filter(route => !pinned.has(route.path)).map(route => ({ id: route.id, label: route.title, href: route.path }));
  return {
    plan: { schema: "clossys.site-plan/1", publicationId: map.publicationId, packId: pack.packId, ...(pack.app ? { app: pack.app } : {}), frame: frames[0]!, routes, navigation: { primary, secondary },
      ...(site ? { origin: site.origin, sitemap: projectSitemap(map, { channel: "site", origin: site.origin }).map(row => row.url) } : {}) },
    findings,
  };
}

const linksOf = (props: Readonly<Record<string, unknown>>): string[] | undefined =>
  Array.isArray(props.links) && props.links.length && props.links.every(link => isRecord(link) && typeof link.href === "string") ? props.links.map(link => (link as { href: string }).href) : undefined;

/**
 * Point every frame-layer `links` prop (`[{ label, href }]`) of a bound page at the content
 * map. A slot whose declared links include a nav-pinned path gets the primary navigation; any
 * other gets the secondary (unpinned pages). Labels are the content-map titles' Writer text.
 */
export function applySiteNavigation(page: BoundPage, plan: SitePlan, copy: Readonly<Record<string, string>>): { page: BoundPage; findings: InstallFinding[] } {
  const findings: InstallFinding[] = [];
  const primary = new Set(plan.navigation.primary.map(link => link.href));
  const label = (link: SiteLink, slot: string) => {
    if (Object.hasOwn(copy, link.label)) return copy[link.label]!;
    findings.push({ code: "missing-copy-key", slot, detail: `${page.id}: Writer has no key ${link.label} (content-map title of ${link.id})` });
    return "";
  };
  const visit = (slot: BoundSlot): BoundSlot => {
    if (!slot.slot.startsWith("frames.")) return slot;
    const declared = linksOf(slot.props);
    if (!declared) return slot;
    const links = (declared.some(href => primary.has(href)) ? plan.navigation.primary : plan.navigation.secondary).map(link => ({ label: label(link, slot.slot), href: link.href }));
    return { ...slot, props: { ...slot.props, links } };
  };
  return { page: { ...page, frame: visit(page.frame), sections: page.sections.map(visit), parts: page.parts.map(visit) }, findings };
}

const HREF = /href$/i;
/** Every internal link (an `*href` prop starting with `/`) in a bound page that resolves to no site route. */
export function siteLinkFindings(page: BoundPage, plan: SitePlan): InstallFinding[] {
  const paths = new Set(plan.routes.map(route => route.path));
  const findings: InstallFinding[] = [];
  const walk = (value: unknown, slot: string, key = ""): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item, slot, key); return; }
    if (isRecord(value)) { for (const [name, item] of Object.entries(value)) walk(item, slot, name); return; }
    if (typeof value !== "string" || !HREF.test(key) || !value.startsWith("/") || value.startsWith("//")) return;
    const path = value.replace(/[?#].*$/, "").replace(/(.)\/$/, "$1") || "/";
    if (!paths.has(path)) findings.push({ code: "site-dead-link", slot, detail: `${page.id}: ${slot} links to ${value}, which is no site route` });
  };
  for (const slot of [page.frame, ...page.sections, ...page.parts]) walk(slot.props, slot.slot);
  return findings;
}
