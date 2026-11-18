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
 *
 * With a `states` module, the install also writes the publication's shell at the app root
 * (`NEXT_SHELL_FILES`): the root `layout.tsx` mounts the assembly's document export and re-exports
 * its metadata, and `loading.tsx`, `not-found.tsx`, `error.tsx` and `global-error.tsx` each mount
 * the states module's state export for that state. No App Router file is then left to a hand.
 *
 * With more than one locale the shell installs once per locale, so no locale is served another
 * locale's document, title or states: the app has no root layout, the default locale's routes sit in
 * the route group `(<default>)` with its own `layout.tsx` and states, and every other locale's first
 * segment holds its own. Each layout passes its locale to the document export and serves the
 * assembly's metadata for that locale (`publishedLocaleMetadata`); each state passes its locale to
 * the states export. Only `global-error.tsx` stays at the app root (Next allows one).
 */
import { projectStaticParams } from "../content-map/projections.js";
import { contentMapPath } from "../content-map/check.js";
import type { ContentMap, ContentMapEntry } from "../content-map/contract.js";
import { relativeSpecifier } from "./host.js";
import { checkJsonLd } from "./page-meta.js";
import type { InstallFinding } from "./index.js";

/** The first line of every route file Publisher installs into a Next app. */
export const NEXT_ROUTE_MARKER = "// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.";
/** The assembly export a page route mounts: `({ page, slug? })` renders that page's frame and sections. */
export const NEXT_PAGE_EXPORT = "PublishedPage";
/** The assembly export a live leaf route asks: `(page, slug) => Promise<boolean>`, whether the leaf exists. */
export const NEXT_LEAF_EXPORT = "publishedLeaf";

/** The assembly export the root layout mounts: `({ children })` renders the publication's document around the routes. */
export const NEXT_DOCUMENT_EXPORT = "PublishedDocument";
/** The assembly export the root layout serves as its Next `metadata`. */
export const NEXT_METADATA_EXPORT = "publishedMetadata";
/** With more than one locale: the assembly export `(locale) => metadata` each locale's layout serves. */
export const NEXT_LOCALE_METADATA_EXPORT = "publishedLocaleMetadata";
/** The states module export every state file mounts: `({ state })` renders that state of the publication. */
export const NEXT_STATE_EXPORT = "PublishedState";
/** A publication state Next serves from an app-root file instead of a route. */
export type NextShellState = "document" | "loading" | "not-found" | "error" | "global-error";
/**
 * The app-root files one publication's shell installs, and the state each serves. Error states are client modules (Next's rule).
 * With more than one locale every file but `global-error.tsx` installs once per locale instead (see the module comment).
 */
export const NEXT_SHELL_FILES: readonly { readonly file: string; readonly state: NextShellState; readonly client: boolean }[] = Object.freeze([
  Object.freeze({ file: "layout.tsx", state: "document", client: false }),
  Object.freeze({ file: "loading.tsx", state: "loading", client: false }),
  Object.freeze({ file: "not-found.tsx", state: "not-found", client: false }),
  Object.freeze({ file: "error.tsx", state: "error", client: true }),
  Object.freeze({ file: "global-error.tsx", state: "global-error", client: true }),
] as const);

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
  /**
   * The consumer's states module (a client module exporting `PublishedState`), relative to the app
   * directory. When set, the publication's shell (`NEXT_SHELL_FILES`) installs at the app root.
   */
  readonly states?: string;
  /**
   * The publication's locales (`outputs.locales`). The default locale serves the root routes; every
   * other locale serves each page again under its own first segment. Every page route then passes
   * its `locale` to the assembly's page export.
   */
  readonly locales?: { readonly default: string; readonly all: readonly string[] };
  /** Checked JSON-LD (`buildJsonLd`) the installed layout mounts; needs `states`, so the shell installs. */
  readonly jsonLd?: string;
  /**
   * With more than one locale, the checked JSON-LD each locale's layout mounts, keyed by every locale
   * (`planSiteOutputs` `jsonLdByLocale`). A locale it does not hold is refused, never served another's.
   */
  readonly localeJsonLd?: Readonly<Record<string, string>>;
}
/** One installed route file, relative to the app directory. */
export interface NextRouteFile {
  readonly file: string;
  readonly pageId: string;
  /** `output` is a publication output (`./site-outputs.ts`): a form endpoint, a share image or page meta. `shell` is an app-root file of the publication (its document or a state), not a page route. */
  readonly kind: "page" | "leaf" | "shell" | "output";
  /** The state a shell file serves. */
  readonly state?: NextShellState;
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

const localeProp = (locale: string | undefined) => (locale === undefined ? "" : `, locale: ${literal(locale)}`);

function pageModule(file: string, assembly: string, pageId: string, locale?: string): string {
  return `${NEXT_ROUTE_MARKER}
import { createElement } from "react";
import { ${NEXT_PAGE_EXPORT} } from ${literal(relativeSpecifier(file, assembly))};

export default function Page() {
  return createElement(${NEXT_PAGE_EXPORT}, { page: ${literal(pageId)}${localeProp(locale)} });
}
`;
}

function leafModule(file: string, assembly: string, pageId: string, slugs: readonly string[], live: boolean, locale?: string): string {
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
  return createElement(${NEXT_PAGE_EXPORT}, { page: ${literal(pageId)}, slug${localeProp(locale)} });
}
`;
}

const SHELL_NAMES: Record<NextShellState, string> = { document: "Layout", loading: "Loading", "not-found": "NotFound", error: "StateError", "global-error": "GlobalError" };

function layoutModule(file: string, assembly: string, live: boolean, jsonLd?: string, locale?: string): string {
  const body = jsonLd === undefined
    ? "createElement(" + NEXT_DOCUMENT_EXPORT + ", { " + (locale === undefined ? "" : `locale: ${literal(locale)}, `) + "children })"
    : "createElement(" + NEXT_DOCUMENT_EXPORT + ", { " + (locale === undefined ? "" : `locale: ${literal(locale)}, `) + "children: createElement(Fragment, null, createElement(\"script\", { type: \"application/ld+json\", dangerouslySetInnerHTML: { __html: jsonLd } }), children) })";
  const metadata = locale === undefined ? NEXT_METADATA_EXPORT : NEXT_LOCALE_METADATA_EXPORT;
  return `${NEXT_ROUTE_MARKER}
import { createElement${jsonLd === undefined ? "" : ", Fragment"}, type ReactNode } from "react";
import { ${NEXT_DOCUMENT_EXPORT}, ${metadata} } from ${literal(relativeSpecifier(file, assembly))};

export const metadata = ${locale === undefined ? metadata : `${metadata}(${literal(locale)})`};
${live ? `export const dynamic = "force-dynamic";
` : ""}${jsonLd === undefined ? "" : `/** Checked at install (checkJsonLd): script-safe JSON, no raw markup. */
const jsonLd = ${literal(jsonLd)};
`}
export default function ${SHELL_NAMES.document}({ children }: { children: ReactNode }) {
  return ${body};
}
`;
}

function stateModule(file: string, states: string, state: NextShellState, client: boolean, locale?: string): string {
  return `${NEXT_ROUTE_MARKER}
${client ? `"use client";
` : ""}import { createElement } from "react";
import { ${NEXT_STATE_EXPORT} } from ${literal(relativeSpecifier(file, states))};

export default function ${SHELL_NAMES[state]}() {
  return createElement(${NEXT_STATE_EXPORT}, { state: ${literal(state)}${localeProp(locale)} });
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
    // Case-folded: on a case-insensitive file system (the macOS default) two spellings are one file.
    if (seen.has(row.file.toLowerCase())) { findings.push({ code: "site-route-duplicate", slot: row.pageId, detail: `${row.pageId}: ${row.file} is installed by another page` }); return; }
    seen.add(row.file.toLowerCase());
    files.push(row);
  };
  const locales = options.locales;
  /** `undefined` serves the root routes with no locale prop (a single-locale install). */
  const variants: readonly (string | undefined)[] = locales ? [locales.default, ...locales.all.filter(locale => locale !== locales.default)] : [undefined];
  const under = (locale: string | undefined) => (locale === undefined || locale === locales?.default ? [] : [locale]);
  /** More than one locale with the shell: one document per locale, the default's routes in its route group. */
  const split = options.states !== undefined && locales !== undefined && locales.all.length > 1;
  const group = (locale: string | undefined) => (split && locale === locales!.default ? [`(${locale})`] : []);
  if (locales) {
    // Case-folded: `en-US` and `en-us`, or a locale `fr` and a page at `/FR`, are one folder on a case-insensitive file system.
    const firsts = new Set(pages.map(page => segmentsOf(contentMapPath(page))[0]?.toLowerCase()).filter((segment): segment is string => segment !== undefined));
    if (!locales.all.includes(locales.default) || new Set(locales.all.map(locale => locale.toLowerCase())).size !== locales.all.length) findings.push({ code: "site-contract", detail: `${options.map.publicationId}: locales must list each locale once (case-insensitively) and include the default ${locales.default}` });
    for (const locale of locales.all) {
      if (locale === locales.default) continue;
      if (!SEGMENT.test(locale) || locale.startsWith("_")) findings.push({ code: "site-contract", detail: `${options.map.publicationId}: locale ${locale} is not a static route segment` });
      else if (firsts.has(locale.toLowerCase())) findings.push({ code: "site-contract", detail: `${options.map.publicationId}: locale ${locale} collides with a page path segment of the same name` });
    }
  }
  for (const page of pages) {
    const segments = segmentsOf(contentMapPath(page));
    const bad = segments.find(segment => !SEGMENT.test(segment));
    if (bad !== undefined) { findings.push({ code: "site-contract", slot: page.id, detail: `${page.id}: path segment "${bad}" is not a static route segment` }); continue; }
    for (const locale of variants) {
      const served = [...under(locale), ...segments];
      const file = [...group(locale), ...folder(served), "page.tsx"].join("/");
      add({ file, pageId: page.id, kind: "page", route: `/${served.join("/")}`, content: pageModule(file, options.assembly, page.id, locale) });
    }
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
    for (const locale of variants) {
      const served = [...under(locale), ...segments];
      const file = [...group(locale), ...folder(served), "[slug]", "page.tsx"].join("/");
      add({ file, pageId: page.id, kind: "leaf", route: `/${[...served, "[slug]"].join("/")}`, content: leafModule(file, options.assembly, page.id, slugs, options.live === true, locale) });
    }
  }
  // The JSON-LD each document mounts: the one checked string, or with one document per locale that locale's own.
  const documents: readonly (string | undefined)[] = split ? variants : [undefined];
  const jsonLd = new Map<string | undefined, string>();
  if (options.jsonLd !== undefined || options.localeJsonLd !== undefined) {
    if (options.states === undefined) findings.push({ code: "site-contract", detail: `${options.map.publicationId}: JSON-LD mounts in the installed layout; name a states module so the shell installs` });
    else for (const locale of documents) {
      const ld = locale === undefined ? options.jsonLd : options.localeJsonLd !== undefined && Object.hasOwn(options.localeJsonLd, locale) ? options.localeJsonLd[locale] : undefined;
      const issues = ld === undefined ? [locale === undefined ? "no JSON-LD" : `no ${locale} JSON-LD (each locale's layout mounts its own)`] : checkJsonLd(ld);
      if (issues.length) findings.push({ code: "site-contract", detail: `${options.map.publicationId}: JSON-LD refused: ${issues.join("; ")}` });
      else jsonLd.set(locale, ld!);
    }
  }
  if (options.states !== undefined) {
    for (const locale of documents) {
      const base = locale === undefined ? [] : [...group(locale), ...under(locale)];
      const route = `/${under(locale).join("/")}`;
      for (const shell of NEXT_SHELL_FILES) {
        if (shell.state === "global-error" && locale !== undefined) continue;
        const file = [...base, shell.file].join("/");
        const content = shell.state === "document"
          ? layoutModule(file, options.assembly, options.live === true, jsonLd.get(locale), locale)
          : stateModule(file, options.states, shell.state, shell.client, locale);
        add({ file, pageId: options.map.publicationId, kind: "shell", state: shell.state, route, content });
      }
    }
    // The one app-root global error (Next allows one), outside every locale's document.
    if (split) {
      const shell = NEXT_SHELL_FILES.find(row => row.state === "global-error")!;
      add({ file: shell.file, pageId: options.map.publicationId, kind: "shell", state: shell.state, route: "/", content: stateModule(shell.file, options.states, shell.state, shell.client) });
    }
  }
  return { files, findings };
}
