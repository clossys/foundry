/**
 * Publisher install for a Next App Router app: one publication becomes one route file per page.
 *
 * Every page entry of the content map installs as `<path>/page.tsx`. A page that carries a leaf
 * template also installs `<path>/[slug]/page.tsx`, a dynamic route whose `generateStaticParams`
 * is the content map's own static-params projection (`projectStaticParams`) over the map plus
 * one entry per leaf the record store holds. Each installed file only names what Publisher
 * placed (the page id, and for a leaf the slug) and mounts the consumer's assembly module:
 * Publisher assembles, the consumer's module renders the frame and sections for that id.
 *
 * A `live` install keeps `dynamicParams` on and asks the assembly's leaf export whether a slug
 * exists at request time, so a leaf recorded after the install still resolves and an unknown
 * slug is a 404. A static install serves exactly the leaves it was installed with.
 * Installed files carry `NEXT_ROUTE_MARKER`; anything without it was not written by Publisher.
 */
import { projectStaticParams } from "../content-map/projections.js";
import { contentMapPath } from "../content-map/check.js";
import type { ContentMap, ContentMapEntry } from "../content-map/contract.js";
import { relativeSpecifier } from "./host.js";
import type { InstallFinding } from "./index.js";

/** The first line of every route file Publisher installs into a Next app. */
export const NEXT_ROUTE_MARKER = "// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.";
/** The assembly export a page route mounts: `({ page, slug? })` renders that page's frame and sections. */
export const NEXT_PAGE_EXPORT = "PublishedPage";
/** The assembly export a live leaf route asks: `(page, slug) => Promise<boolean>`, whether the leaf exists. */
export const NEXT_LEAF_EXPORT = "publishedLeaf";

/** One leaf the record store holds under a gallery page. */
export interface NextRouteLeaf { readonly slug: string; readonly title: string }
/** A page whose leaves install as one dynamic route. */
export interface NextRouteLeafTemplate {
  readonly pageId: string; readonly param: "slug"; readonly leaves: readonly NextRouteLeaf[];
  /** The map entry the leaves hang under, when not the page itself (a tab's leaves under its record, keeping the map within its depth). */
  readonly parentId?: string;
}
export interface NextRoutesOptions {
  readonly map: ContentMap;
  readonly leafTemplates?: readonly NextRouteLeafTemplate[];
  /** The consumer's assembly module, relative to the app directory (`../components/Page.tsx`). */
  readonly assembly: string;
  /** Resolve leaves at request time through the assembly's `publishedLeaf`. */
  readonly live?: boolean;
}
/** One installed route file, relative to the app directory. */
export interface NextRouteFile {
  readonly file: string;
  readonly pageId: string;
  readonly kind: "page" | "leaf";
  /** The served route, `[slug]` standing for the leaf parameter. */
  readonly route: string;
  readonly content: string;
}
export interface NextRoutesPlan { readonly files: readonly NextRouteFile[]; readonly findings: readonly InstallFinding[] }

/** A leaf slug is one path segment; the same rule the content map's runtime projection holds. */
const LEAF_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** A static route segment Next serves verbatim: no route groups, parameters, private or reserved folders. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const pageEntries = (map: ContentMap) => map.entries.filter((entry): entry is ContentMapEntry => entry.kind === "page");
const segmentsOf = (path: string) => path.split("/").filter(Boolean);
const folder = (segments: readonly string[]) => segments.map(segment => (segment.startsWith("_") ? `%5F${segment.slice(1)}` : segment));
const literal = (value: unknown) => JSON.stringify(value);

function pageModule(file: string, assembly: string, pageId: string): string {
  return `${NEXT_ROUTE_MARKER}
import { createElement } from "react";
import { ${NEXT_PAGE_EXPORT} } from ${literal(relativeSpecifier(file, assembly))};

export default function Page() {
  return createElement(${NEXT_PAGE_EXPORT}, { page: ${literal(pageId)} });
}
`;
}

function leafModule(file: string, assembly: string, pageId: string, slugs: readonly string[], live: boolean): string {
  const imports = live ? `${NEXT_PAGE_EXPORT}, ${NEXT_LEAF_EXPORT}` : NEXT_PAGE_EXPORT;
  const known = live ? `await ${NEXT_LEAF_EXPORT}(${literal(pageId)}, slug)` : "leaves.some(leaf => leaf.slug === slug)";
  return `${NEXT_ROUTE_MARKER}
import { createElement } from "react";
import { notFound } from "next/navigation";
import { ${imports} } from ${literal(relativeSpecifier(file, assembly))};

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = ${slugs.length ? `[\n${slugs.map(slug => `  { slug: ${literal(slug)} },`).join("\n")}\n]` : "[]"};
export const dynamicParams = ${live};
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(${known})) notFound();
  return createElement(${NEXT_PAGE_EXPORT}, { page: ${literal(pageId)}, slug });
}
`;
}

/** Plan the route files a publication installs into a Next app; blocking findings mean nothing installs. */
export function planNextRoutes(options: NextRoutesOptions): NextRoutesPlan {
  const findings: InstallFinding[] = [];
  const files: NextRouteFile[] = [];
  const pages = pageEntries(options.map);
  const byId = new Map(pages.map(page => [page.id, page]));
  const seen = new Set<string>();
  const add = (row: NextRouteFile) => {
    if (seen.has(row.file)) { findings.push({ code: "site-route-duplicate", slot: row.pageId, detail: `${row.pageId}: ${row.file} is installed by another page` }); return; }
    seen.add(row.file);
    files.push(row);
  };
  for (const page of pages) {
    const segments = segmentsOf(contentMapPath(page));
    const bad = segments.find(segment => !SEGMENT.test(segment));
    if (bad !== undefined) { findings.push({ code: "site-contract", slot: page.id, detail: `${page.id}: path segment "${bad}" is not a static route segment` }); continue; }
    const file = [...folder(segments), "page.tsx"].join("/");
    add({ file, pageId: page.id, kind: "page", route: `/${segments.join("/")}`, content: pageModule(file, options.assembly, page.id) });
  }
  const extra: ContentMapEntry[] = [];
  const templates: { page: ContentMapEntry; segments: string[] }[] = [];
  for (const template of options.leafTemplates ?? []) {
    const page = byId.get(template.pageId);
    if (!page) { findings.push({ code: "site-route-missing", slot: template.pageId, detail: `${template.pageId}: a leaf template names a page the content map does not hold` }); continue; }
    if (template.param !== "slug") { findings.push({ code: "site-contract", slot: page.id, detail: `${page.id}: leaf templates take one "slug" parameter` }); continue; }
    const base = contentMapPath(page) === "/" ? "" : contentMapPath(page);
    const slugs = new Set<string>();
    template.leaves.forEach((leaf, order) => {
      if (!LEAF_SLUG.test(leaf.slug)) { findings.push({ code: "site-contract", slot: page.id, detail: `${page.id}: leaf slug "${leaf.slug}" is not one path segment` }); return; }
      if (slugs.has(leaf.slug)) return;
      slugs.add(leaf.slug);
      extra.push({ id: `${page.id}:${leaf.slug}`, parentId: template.parentId ?? page.id, order, title: leaf.title.trim() || leaf.slug, kind: "page", path: `${base}/${leaf.slug}`, ...(page.source ? { source: page.source } : {}) } as ContentMapEntry);
    });
    templates.push({ page, segments: segmentsOf(base) });
  }
  let params: readonly { slug: readonly string[] }[] = [];
  try { params = projectStaticParams({ ...options.map, entries: [...options.map.entries, ...extra] }); }
  catch (error) { findings.push({ code: "site-contract", detail: `the publication's content map does not project static params: ${error instanceof Error ? error.message : String(error)}` }); }
  for (const { page, segments } of templates) {
    const prefix = segments.join("/");
    const slugs = params.filter(row => row.slug.length === segments.length + 1 && row.slug.slice(0, -1).join("/") === prefix).map(row => row.slug.at(-1)!);
    const file = [...folder(segments), "[slug]", "page.tsx"].join("/");
    add({ file, pageId: page.id, kind: "leaf", route: `/${[...segments, "[slug]"].join("/")}`, content: leafModule(file, options.assembly, page.id, slugs, options.live === true) });
  }
  return { files, findings };
}
