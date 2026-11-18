/**
 * The install outputs a publication records (`outputs`, `../content-map/outputs.ts`), planned as
 * marked App Router files beside its page routes (`planNextRoutes`):
 *
 * - `api/forms/<id>/route.ts` per form: `createFormEndpoint` over the recorded form. The delivery
 *   target is the environment variable the record names, read at request time; no value is written.
 * - `opengraph-image.tsx` and `twitter-image.tsx` per locale: `createShareCardRoute` over the
 *   Designer's mark (the caller resolves the pinned `assets.mark`) and the Writer's name and summary.
 * - `llms.txt/route.ts`, and `feed.xml/route.ts` (RSS) or `atom.xml/route.ts` per locale: checked
 *   text built at install from the content map and Writer text.
 * - JSON-LD (Organization, WebSite) as checked text the installed layout mounts (`jsonLd`).
 *
 * Every visible string comes from `text(key, locale)`, the caller's pinned Writer copy. A key a
 * locale does not hold is a blocking `missing-copy-key` finding, never a fallback to another
 * locale: the Writer drafts it. Blocking findings mean nothing installs.
 */
import { contentMapOrigin, contentMapPath } from "../content-map/check.js";
import type { ContentMap, ContentMapEntry } from "../content-map/contract.js";
import { checkPublicationOutputs, type PublicationForm, type PublicationOutputs } from "../content-map/outputs.js";
import type { InstallFinding } from "./index.js";
import { NEXT_ROUTE_MARKER, type NextRouteFile } from "./next-routes.js";
import { buildFeed, buildJsonLd, buildLlmsTxt, checkFeed, checkJsonLd, checkLlmsTxt, type FeedItem, type LlmsTxtPage } from "./page-meta.js";

export { buildFeed, buildJsonLd, buildLlmsTxt, checkFeed, checkJsonLd, checkLlmsTxt } from "./page-meta.js";
export type { FeedFormat, FeedInput, FeedItem, JsonLdInput, LlmsTxtInput, LlmsTxtPage } from "./page-meta.js";

/** A Writer key's text in one locale, or `undefined` when that locale does not hold it. */
export type SiteOutputText = (key: string, locale: string) => string | undefined;
/** The Designer visuals a share card draws: the pinned mark as a data URL, plus optional brand overrides. */
export interface SiteShareVisual {
  readonly markSrc: string;
  readonly wordmark?: string;
  readonly tokenOverrides?: Readonly<Record<string, string>>;
  readonly displayFontFamily?: string;
}
export interface SiteOutputsOptions {
  readonly map: ContentMap;
  readonly outputs: PublicationOutputs;
  readonly text: SiteOutputText;
  readonly share?: SiteShareVisual;
  /** The locale when the record declares none: the Writer's source locale. Default `en`. */
  readonly locale?: string;
  /** The package specifier the installed modules import the web runtime from. */
  readonly web?: string;
}
export interface SiteOutputsPlan {
  readonly files: readonly NextRouteFile[];
  readonly findings: readonly InstallFinding[];
  /** Checked JSON-LD for `planNextRoutes({ jsonLd })` to mount in the layout. */
  readonly jsonLd?: string;
}

export const SITE_OUTPUT_WEB = "@clossys/publisher/web";
const MARK_SRC = /^data:image\/(?:svg\+xml(?:;base64)?|png;base64),/;
const literal = (value: unknown) => JSON.stringify(value);

function formModule(form: PublicationForm, web: string): string {
  return `${NEXT_ROUTE_MARKER}
import { createFormEndpoint } from ${literal(web)};

// The delivery target is read per request from the environment variable ${form.targetEnv}.
// Set it in the host's environment; it never belongs in the repository.
const endpoint = createFormEndpoint({ form: ${literal(form)} });
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return endpoint.POST(request);
}
`;
}

function shareModule(card: Record<string, unknown>, web: string): string {
  return `${NEXT_ROUTE_MARKER}
import { ImageResponse } from "next/og";
import { createShareCardRoute } from ${literal(web)};

const route = createShareCardRoute({ ImageResponse, card: ${literal(card)} });
export const alt = route.alt;
export const size = route.size;
export const contentType = route.contentType;
export default route.Image;
`;
}

function textModule(body: string, contentType: string): string {
  return `${NEXT_ROUTE_MARKER}
export const dynamic = "force-static";
const body = ${literal(body)};
export function GET(): Response {
  return new Response(body, { headers: { "content-type": ${literal(contentType)} } });
}
`;
}

/** Plan a publication's install outputs; an outputs record that opts into nothing plans nothing. */
export function planSiteOutputs(options: SiteOutputsOptions): SiteOutputsPlan {
  const { map, outputs } = options;
  const findings: InstallFinding[] = [];
  const files: NextRouteFile[] = [];
  const issues = checkPublicationOutputs(outputs);
  if (issues.length) return { files, findings: [{ code: "site-contract", slot: map.publicationId, detail: `${map.publicationId}: outputs refused: ${issues.join("; ")}` }] };
  const web = options.web ?? SITE_OUTPUT_WEB;
  const locales = outputs.locales ?? { default: options.locale ?? "en", all: [options.locale ?? "en"] };
  const missing = new Set<string>();
  const text = (key: string, locale: string, optional = false): string => {
    const value = options.text(key, locale);
    if (typeof value === "string" && value.trim()) return value;
    if (!optional && !missing.has(`${locale}\u0000${key}`)) {
      missing.add(`${locale}\u0000${key}`);
      findings.push({ code: "missing-copy-key", slot: map.publicationId, detail: `${map.publicationId}: Writer key ${key} has no ${locale} text; the Writer drafts it before ${locale} installs` });
    }
    return "";
  };
  const prefix = (locale: string) => (locale === locales.default ? [] : [locale]);
  const origin = outputs.origin === undefined ? undefined : contentMapOrigin(outputs.origin).origin;
  const url = (locale: string, entry: ContentMapEntry) => {
    const segments = [...prefix(locale), ...contentMapPath(entry).split("/").filter(Boolean)];
    return `${origin}/${segments.join("/")}`;
  };
  const indexed = map.entries.filter((entry): entry is ContentMapEntry => entry.kind === "page" && entry.indexing?.mode !== "noindex").sort((a, b) => a.order - b.order);
  const add = (file: string, route: string, content: string) => files.push({ file, pageId: map.publicationId, kind: "output", route, content });

  for (const form of outputs.forms ?? []) add(`api/forms/${form.id}/route.ts`, `/api/forms/${form.id}`, formModule(form, web));

  if (outputs.share) {
    const visual = options.share;
    if (!visual || typeof visual.markSrc !== "string" || !MARK_SRC.test(visual.markSrc)) {
      findings.push({ code: "site-contract", slot: map.publicationId, detail: `${map.publicationId}: share images draw the Designer's pinned assets.mark as an svg or png data URL, and none was resolved; request assets.mark from the Designer` });
    } else {
      for (const locale of locales.all) {
        const headline = text(outputs.identity!.name, locale), supporting = text(outputs.identity!.summary, locale);
        for (const name of ["opengraph-image", "twitter-image"]) {
          const route = `/${[...prefix(locale), name].join("/")}`;
          const card = { markSrc: visual.markSrc, ...(visual.wordmark ? { wordmark: visual.wordmark } : {}), headline, supporting, path: route,
            ...(visual.tokenOverrides ? { tokenOverrides: visual.tokenOverrides } : {}), ...(visual.displayFontFamily ? { displayFontFamily: visual.displayFontFamily } : {}) };
          add([...prefix(locale), `${name}.tsx`].join("/"), route, shareModule(card, web));
        }
      }
    }
  }

  const refuse = (what: string, problems: readonly string[]) => { if (problems.length) findings.push({ code: "site-contract", slot: map.publicationId, detail: `${map.publicationId}: ${what} refused: ${problems.join("; ")}` }); return problems.length === 0; };
  const pagesOf = (locale: string) => indexed.map(entry => ({ entry, title: text(entry.title, locale), description: entry.description === undefined ? "" : text(entry.description, locale, true) }));

  if (outputs.llms) {
    const locale = locales.default;
    const pages: LlmsTxtPage[] = pagesOf(locale).map(page => ({ title: page.title, url: url(locale, page.entry), ...(page.description ? { description: page.description } : {}) }));
    const name = text(outputs.identity!.name, locale), summary = text(outputs.identity!.summary, locale);
    if (!missing.size) {
      const body = buildLlmsTxt({ name, summary, pages });
      if (refuse("llms.txt", checkLlmsTxt(body))) add("llms.txt/route.ts", "/llms.txt", textModule(body, "text/plain; charset=utf-8"));
    }
  }

  if (outputs.feed) {
    const format = outputs.feed;
    const file = format === "rss" ? "feed.xml" : "atom.xml";
    for (const locale of locales.all) {
      const before = missing.size;
      const items: FeedItem[] = pagesOf(locale).map(page => ({ title: page.title, url: url(locale, page.entry), ...(page.description ? { summary: page.description } : {}), ...(page.entry.lastModified ? { updated: page.entry.lastModified } : {}) }));
      const title = text(outputs.identity!.name, locale), summary = text(outputs.identity!.summary, locale);
      if (missing.size !== before) continue;
      let body: string;
      try { body = buildFeed({ format, origin: origin!, title, summary, locale, items }); }
      catch (error) { refuse(`${locale} ${file}`, [error instanceof Error ? error.message : String(error)]); continue; }
      if (refuse(`${locale} ${file}`, checkFeed(body, format))) add([...prefix(locale), file, "route.ts"].join("/"), `/${[...prefix(locale), file].join("/")}`, textModule(body, format === "rss" ? "application/rss+xml; charset=utf-8" : "application/atom+xml; charset=utf-8"));
    }
  }

  let jsonLd: string | undefined;
  if (outputs.jsonLd) {
    const locale = locales.default;
    const name = text(outputs.identity!.name, locale), summary = text(outputs.identity!.summary, locale);
    if (name && summary) {
      const built = buildJsonLd({ origin: origin!, name, summary, locale });
      if (refuse("JSON-LD", checkJsonLd(built))) jsonLd = built;
    }
  }

  if (findings.length) return { files: [], findings };
  return { files, findings, ...(jsonLd === undefined ? {} : { jsonLd }) };
}
