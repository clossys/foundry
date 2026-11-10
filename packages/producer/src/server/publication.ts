import { readdir, realpath, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, relative } from "node:path";
import { BUNDLE_STYLES, bundledPreviewStylesheet, confinedPreviewFile, generatedBody, previewSource, renderNativePreview } from "./publisher-preview-render.js";
import { readIa, listSlots, readCandidate, type SlotEntry } from "../records/slots.js";
import { readPinnedPublication, resolvePublicationTitles } from "../publish/pinned-publication.js";
import { sendWriterText, writerText } from "./writer-text.js";
import { INSTALL_MARKER, installOutRoot } from "../publish/install-out.js";
import { isInstalledRoute, NEXT_INSTALL_KIND, NEXT_INSTALL_REPORT } from "../publish/install-next.js";
import { SPECIMEN_FRAME_CSP, specimenFramePage, specimenWidth } from "./specimen-frame.js";
import { isAbsent } from "../errors.js";
import { applyThemeAttributes } from "@clossys/designer/theme/server";

export const PREVIEW_PREFIX = "/preview/";
export const PREVIEW_COMMAND = "clossys publish --install --page <page id>";
/** Producer owns both preview routes for a page: the emitted page and its sized, themed frame. */
function pageRoutes(publication: string, page: string): { previewUrl: string; frameUrl: string } {
  const base = `${PREVIEW_PREFIX}${encodeURIComponent(publication)}`, file = `${encodeURIComponent(page)}.html`;
  return { previewUrl: `${base}/pages/${file}`, frameUrl: `${base}/frame/${file}` };
}
export interface PreviewRoute { id: string; path: string; locale?: string; source: { file: string; export: string } }
export interface PreviewEntry { id: string; title: string; kind: string; parentId?: string; path?: string; slug?: string; description?: string; [key: string]: unknown }
/** Exact descriptor emitted by Publisher's producer-preview destination. */
export interface PublicationManifest {
  schemaVersion: 1; publication: string; sourceApp: string; format: "web.page.responsive";
  routes: PreviewRoute[]; contentMap: { version: 1; publicationId: string; entries: PreviewEntry[]; [key: string]: unknown };
  publishedAt?: string;
}
export interface PublicationPage {
  id: string; cellId?: string; route: string; title?: string; description?: string; ogImage?: string;
  indexing?: "index" | "noindex"; inSitemap?: boolean; lastPublished?: string; previewUrl: string; frameUrl: string; emitted: boolean;
}
export type PublicationResponse =
  | { state: "ready"; publication: string; manifest: PublicationManifest; pages: PublicationPage[]; publications: string[] }
  | { state: "missing" | "error"; message: string; command: typeof PREVIEW_COMMAND };
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
};
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const identity = (value: string) => /^[a-z][a-z0-9.-]*$/.test(value) && !value.includes("..");
export function previewRoot(root: string, publication?: string): string {
  const base = join(root, "clossys", ".producer", "preview");
  if (publication === undefined) return base;
  if (!identity(publication)) throw new Error("Invalid publication identity");
  return join(base, publication, "src", "clossys");
}
export function parsePublicationManifest(value: unknown, publication: string): PublicationManifest {
  if (!object(value) || value.schemaVersion !== 1 || value.publication !== publication || typeof value.sourceApp !== "string" || value.format !== "web.page.responsive"
    || !Array.isArray(value.routes) || !object(value.contentMap) || value.contentMap.version !== 1 || value.contentMap.publicationId !== publication || !Array.isArray(value.contentMap.entries)) throw new Error("Invalid publication descriptor");
  const ids = new Set<string>(), paths = new Set<string>();
  for (const route of value.routes) {
    if (!object(route) || typeof route.id !== "string" || !identity(route.id) || typeof route.path !== "string" || !route.path.startsWith("/") || route.path.startsWith("//") || /[\\\x00-\x1f?#]/.test(route.path)
      || ids.has(route.id) || paths.has(route.path) || !object(route.source) || typeof route.source.file !== "string" || !/\.(?:tsx?|jsx?|mjs|html?)$/.test(route.source.file)
      || typeof route.source.export !== "string" || !/^(?:default|[A-Za-z_$][\w$]*)$/.test(route.source.export)) throw new Error("Invalid publication route");
    ids.add(route.id); paths.add(route.path);
  }
  for (const entry of value.contentMap.entries) if (!object(entry) || typeof entry.id !== "string" || typeof entry.title !== "string" || typeof entry.kind !== "string") throw new Error("Invalid publication content map");
  return value as PublicationManifest;
}
async function descriptor(root: string, publication: string): Promise<PublicationManifest> {
  const source = await previewSource(previewRoot(root, publication), "preview.json");
  return parsePublicationManifest(JSON.parse(generatedBody(source.toString("utf8"))), publication);
}
/**
 * The Next app this Producer serves (Studio). A publication installed into it with
 * `publish --install --next` previews through it: its page HTML is the served route's own render.
 */
export interface ServedApp { readonly app: string; readonly render: (path: string) => Promise<string | undefined> }
export async function publication(root: string, requested?: string, installOut?: string, served?: ServedApp): Promise<PublicationResponse> {
  try {
    if (requested !== undefined && !identity(requested)) throw new Error("Invalid publication identity");
    const entries = await readdir(previewRoot(root), { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
    const publications = entries.filter(entry => entry.isDirectory() && identity(entry.name)).map(entry => entry.name).sort();
    if (!publications.length) return await installPublication(root, requested, installOut, served);
    const selected = requested ?? publications[0];
    if (!selected) return { state: "missing", message: "Not published yet", command: PREVIEW_COMMAND };
    const manifest = await descriptor(root, selected);
    const pages = await Promise.all(manifest.routes.map(async route => {
      const entry = manifest.contentMap.entries.find(entry => entry.id === route.id);
      let emitted = false;
      // Descriptor metadata does not prove source exists: an absent source is not emitted, any other failure surfaces.
      try { await confinedPreviewFile(previewRoot(root, selected), route.source.file); emitted = true; } catch (error) { if (!isAbsent(error)) throw error; }
      return { id: route.id, route: route.path, emitted, ...pageRoutes(selected, route.id),
        ...(entry?.title === undefined ? {} : { title: entry.title }), ...(typeof entry?.description === "string" ? { description: entry.description } : {}),
        ...(typeof entry?.ogImage === "string" ? { ogImage: entry.ogImage } : {}), ...(entry?.indexing === "index" || entry?.indexing === "noindex" ? { indexing: entry.indexing } : {}),
        ...(typeof entry?.inSitemap === "boolean" ? { inSitemap: entry.inSitemap } : {}), ...(typeof entry?.lastPublished === "string" ? { lastPublished: entry.lastPublished } : {}),
      } as PublicationPage;
    }));
    return { state: "ready", publication: selected, manifest, pages, publications };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing", message: "Not published yet", command: PREVIEW_COMMAND };
    return { state: "error", message: "Publication preview could not be read; publish a valid browser preview", command: PREVIEW_COMMAND };
  }
}
/**
 * One page written by `clossys publish --install` (paths relative to the install out root). A page
 * installed into a Next app (`publish --install --next`) has no static HTML: it names its route
 * file and served path instead, and previews only through the app Producer serves.
 */
interface InstallPage { id: string; html?: string; css: string[]; written: number; next?: { app: string; file: string; route: string } }
interface InstallPublication { base: string; manifest: PublicationManifest; pages: PublicationPage[]; installs: InstallPage[] }
const blockingFinding = (finding: unknown) => object(finding) && finding.severity !== "info";
/** The install out root holds one dir per page (`install-<id>` by default, or each `--out`). */
async function installPages(base: string): Promise<InstallPage[]> {
  const found = new Map<string, InstallPage>();
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || /[\\\x00-\x1f%?#]/.test(entry.name)) continue;
    const dir = entry.name;
    // Only a folder carrying the install marker is an install out dir; a marked one must read.
    try { await confinedPreviewFile(base, `${dir}/${INSTALL_MARKER}`); } catch (error) { if (isAbsent(error)) continue; throw error; }
    const reportFile = `${dir}/install-report.json`;
    const report = JSON.parse((await previewSource(base, reportFile)).toString("utf8"));
    const written = (await stat(await confinedPreviewFile(base, reportFile))).mtimeMs;
    if (object(report) && report.kind === NEXT_INSTALL_KIND) {
      if (typeof report.app !== "string" || !Array.isArray(report.pages) || (Array.isArray(report.findings) && report.findings.some(blockingFinding))) continue;
      for (const row of report.pages) {
        if (!object(row) || typeof row.page !== "string" || !identity(row.page) || typeof row.file !== "string" || typeof row.route !== "string" || !row.route.startsWith("/")) continue;
        if ((found.get(row.page)?.written ?? -1) > written) continue;
        found.set(row.page, { id: row.page, css: [], written, next: { app: report.app, file: row.file, route: row.route } });
      }
      continue;
    }
    if (!object(report) || typeof report.page !== "string" || !identity(report.page)) continue;
    if ((found.get(report.page)?.written ?? -1) > written) continue;
    let html: string | undefined = `${dir}/site/${report.page}/index.html`;
    // A failed rerun leaves the last page on disk; its report decides whether it is current.
    try { await confinedPreviewFile(base, html); } catch (error) { if (!isAbsent(error)) throw error; html = undefined; }
    if (Array.isArray(report.findings) && report.findings.some(blockingFinding)) html = undefined;
    const css: string[] = [];
    // Unbuilt substrate: without its stylesheet the page is not the install's render, so it is not served.
    try { for (const file of (await readdir(join(base, dir, "substrate", "dist", "assets"))).sort()) if (file.endsWith(".css")) css.push(`${dir}/substrate/dist/assets/${file}`); }
    catch (error) { if (!isAbsent(error)) throw error; html = undefined; }
    found.set(report.page, { id: report.page, ...(html ? { html } : {}), css, written });
  }
  return [...found.values()];
}
/** Native publication ownership and presentation come only from intact Publisher pins. */
/** A Next-installed page renders when its marked route file is in place in the app Producer serves. */
async function servedRoute(page: InstallPage, served?: ServedApp): Promise<boolean> {
  if (!page.next || !served) return false;
  try {
    const app = await realpath(page.next.app);
    if (app !== await realpath(served.app)) return false;
    const file = join(app, ...page.next.file.split("/"));
    return !relative(app, file).startsWith("..") && await isInstalledRoute(file);
  } catch { return false; }
}
async function nativeInstallPublication(root: string, base: string, installs: InstallPage[], requested?: string, served?: ServedApp): Promise<InstallPublication | undefined> {
  const consumer = join(root, "clossys"), installed = new Map(installs.map(page => [page.id, page]));
  const slots = listSlots(consumer, "publisher");
  const publications = await Promise.all(slots.filter(slot => slot.id.startsWith("publication.")).map(async slot => ({
    ...resolvePublicationTitles(consumer, await readPinnedPublication(consumer, slot.id.slice("publication.".length))), slot,
  })));
  const web = publications.filter(value => value.map.format === "web.page.responsive");
  const matches = web.filter(value => value.map.entries.some(entry => entry.kind === "page" && installed.has(entry.id)));
  if (installs.some(page => matches.filter(value => value.map.entries.some(entry => entry.kind === "page" && entry.id === page.id)).length > 1)) return undefined;
  const choices = requested === undefined ? matches : matches.filter(value => value.map.publicationId === requested);
  if (choices.length !== 1) return undefined;
  const { map, routePack, slot } = choices[0]!, id = map.publicationId;
  const entries = map.entries.filter(entry => entry.kind === "page" && installed.has(entry.id));
  // An absent configured path is unavailable, never reconstructed from a page id.
  if (entries.some(entry => typeof entry.path !== "string" || !entry.path.startsWith("/"))) return undefined;
  const selectedRecord = (slot: SlotEntry) => {
    if (!slot.pin) throw new Error("Native publication metadata is unpinned");
    const source = readCandidate(consumer, "publisher", slot.id, slot.pin.candidate);
    if (source.sha256 !== slot.pin.sha256) throw new Error("Native publication metadata hash drift");
    return JSON.parse(source.bytes);
  };
  const references = (node: Record<string, any>): string[] => [
    ...(node.cells ?? []), ...(node.children ?? []).flatMap(references),
  ];
  const bySlot = new Map(slots.map(slot => [slot.id, slot])), cellIds = new Map<string, string>();
  // Only the validated publication tree names page slots; explicit entry metadata supplies the join.
  for (const slotId of references(selectedRecord(slot).meta.tree)) {
    const pageSlot = bySlot.get(slotId);
    if (!pageSlot) return undefined;
    const metadata = selectedRecord(pageSlot).meta?.entry;
    if (!object(metadata) || metadata.publication !== id || typeof metadata.entryId !== "string" || !entries.some(entry => entry.id === metadata.entryId)) continue;
    if (cellIds.has(metadata.entryId)) return undefined;
    cellIds.set(metadata.entryId, pageSlot.id);
  }
  if (entries.some(entry => !cellIds.has(entry.id))) return undefined;
  const routed = new Map(await Promise.all(entries.map(async entry => [entry.id, await servedRoute(installed.get(entry.id)!, served)] as const)));
  const pages: PublicationPage[] = entries.map(entry => ({ id: entry.id, cellId: cellIds.get(entry.id)!, route: entry.path!, title: entry.title,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    ...(entry.indexing === undefined ? {} : { indexing: entry.indexing.mode }),
    emitted: !!installed.get(entry.id)!.html || routed.get(entry.id)!, ...pageRoutes(id, entry.id) }));
  return { base, installs: pages.map(page => installed.get(page.id)!), pages, manifest: {
    schemaVersion: 1, publication: id, sourceApp: typeof routePack?.app === "string" ? routePack.app : "clossys publish --install", format: "web.page.responsive",
    routes: pages.flatMap(page => {
      const install = installed.get(page.id)!;
      const file = install.html ?? (routed.get(page.id) ? install.next!.file : undefined);
      return file === undefined ? [] : [{ id: page.id, path: page.route, source: { file, export: "default" } }];
    }),
    contentMap: { ...map, entries: map.entries.map(entry => ({ ...entry })) },
  } };
}
async function readInstallPublication(root: string, installOut?: string, requested?: string, served?: ServedApp): Promise<InstallPublication | undefined> {
  let base: string;
  try { base = await realpath(installOut ?? installOutRoot(root)); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
  const installs = await installPages(base);
  if (!installs.length) return undefined;
  // Installed pages publish under the pinned Publisher slot model; without one there is no publication.
  return readIa(join(root, "clossys"), "publisher") ? nativeInstallPublication(root, base, installs, requested, served) : undefined;
}
/** Studio's publication view over `clossys publish --install` output. */
async function installPublication(root: string, requested?: string, installOut?: string, served?: ServedApp): Promise<PublicationResponse> {
  const found = await readInstallPublication(root, installOut, requested, served);
  if (!found || (requested !== undefined && requested !== found.manifest.publication)) return { state: "missing", message: "Not published yet", command: PREVIEW_COMMAND };
  return { state: "ready", publication: found.manifest.publication, manifest: found.manifest, pages: found.pages, publications: [found.manifest.publication] };
}
/**
 * Page sandbox without an opaque origin. `allow-same-origin` keeps the page on Studio's origin so
 * its own stylesheets and fonts pass `Cross-Origin-Resource-Policy: same-origin`; scripts stay
 * off twice over (no `allow-scripts` sandbox flag and no `script-src`, so `default-src 'none'`
 * blocks them), as do forms, popups and top navigation. A page that cannot run script cannot use
 * the shared origin, so the pair that would defeat the sandbox (`allow-same-origin` with
 * `allow-scripts`) never occurs.
 */
export const PREVIEW_PAGE_CSP = "sandbox allow-same-origin; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; connect-src 'none'";
const SECURITY = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": PREVIEW_PAGE_CSP,
  "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
};
/** The one route a specimen frame loads from. Without a trailing slash a CSP path matches exactly. */
export const SPECIMEN_ROUTE = "/__specimen";
const LOCAL_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/;
/**
 * The policy for a served Studio page (`publish --install --next`): Studio's own Designer and
 * Publisher pages show specimens, so the page may frame exactly two same-origin paths and nothing
 * else. `frame-src 'self'` would admit every Studio route (the app shell, `/api/*`), so each
 * entry is a host-source with a path: `<origin>/__specimen` matches that one path (any query),
 * and `<origin>/preview/<publication>/pages/` matches this publication's own page previews.
 *
 * Every other directive is PREVIEW_PAGE_CSP's, with one forced change: a sandbox flag a document
 * lacks is lacking in every frame it nests, so a specimen can only run its bundle if this page's
 * sandbox carries `allow-scripts`. The page itself still runs no script: there is no `script-src`,
 * so `default-src 'none'` blocks every script, inline handler and `javascript:` URL, and the
 * served render is stripped of its scripts first (staticPage). Each frame it nests is pinned by
 * sandboxSpecimenFrames: a specimen runs script in an opaque origin, never on Studio's origin.
 */
export function specimenHostCsp(origin: string, publication: string): string {
  if (!LOCAL_ORIGIN.test(origin) || !identity(publication)) return PREVIEW_PAGE_CSP;
  return [
    "sandbox allow-same-origin allow-scripts", "default-src 'none'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:",
    `frame-src ${origin}${SPECIMEN_ROUTE} ${origin}${PREVIEW_PREFIX}${publication}/pages/`,
    "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'", "connect-src 'none'",
  ].join("; ");
}
const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "").replace(/&amp;/g, "&") : undefined;
};
/**
 * Pin the sandbox of every frame in a served page, replacing any sandbox the render carried:
 *   - a specimen (`/__specimen?...`) gets `allow-scripts` and never `allow-same-origin`: its bundle
 *     runs in an opaque origin that cannot reach this page, Studio or the run token, and with no
 *     `allow-top-navigation`, `allow-popups` or `allow-forms` it cannot leave its frame;
 *   - a nested page preview of the same publication (a Publisher card) is a static page that
 *     runs no script, so it loads directly (not through the scaling frame page, which would need
 *     script on this origin) with `allow-same-origin` only, the sandbox every preview page has;
 *   - any other frame gets an empty sandbox (every restriction), and the CSP refuses it anyway.
 */
export function sandboxSpecimenFrames(html: string, publication: string): string {
  const nested = new RegExp(`^${PREVIEW_PREFIX}${publication.replace(/\./g, "\\.")}/(?:frame|pages)/([a-z][a-z0-9.-]*)\\.html$`);
  return html.replace(/<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    const src = attribute(tag, "src") ?? "";
    const [pathname = "", search = ""] = src.split("#")[0]!.split("?");
    let open = tag.replace(/\ssandbox(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?(?=[\s/>])/gi, "");
    let sandbox = "";
    const page = identity(publication) ? nested.exec(pathname)?.[1] : undefined;
    if (pathname === SPECIMEN_ROUTE) sandbox = "allow-scripts";
    else if (page && !page.includes("..")) {
      sandbox = "allow-same-origin";
      const href = `${PREVIEW_PREFIX}${publication}/pages/${page}.html${new URLSearchParams(search).get("theme") === "dark" ? "?theme=dark" : ""}`;
      open = open.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i, ` src="${href}"`);
    }
    return open.replace(/^<iframe\b/i, `<iframe sandbox="${sandbox}"`);
  });
}
export type PreviewTheme = "light" | "dark";
export const previewTheme = (value: string | null | undefined): PreviewTheme => value === "dark" ? "dark" : "light";
/**
 * Apply the theme the way the substrate does (`.dark` on <html>), server side, since the page runs
 * no script. The attributes come from Designer's theme API (`applyThemeAttributes`), not from
 * literals here: existing classes on <html> are kept; a stale `dark`/`light` class is replaced.
 */
export function themePage(html: string, theme: PreviewTheme): string {
  return applyThemeAttributes(html, theme);
}
/**
 * A served route's render as the static page a preview publishes: the app's client runtime (its
 * script tags, inline bootstrap and script preloads) is not part of the page. The preview runs no
 * script, so emitting chunk references would only ask the sandbox to block them. A refresh meta is
 * not part of it either: a static preview never navigates its own frame (to a live route).
 */
export function staticPage(html: string): string {
  return html
    .replace(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?refresh\b)[^>]*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<link\b(?=[^>]*\brel\s*=\s*["']?(?:modulepreload|preload)\b)(?=[^>]*\bas\s*=\s*["']?script\b|[^>]*\brel\s*=\s*["']?modulepreload\b)[^>]*>/gi, "");
}
const FRAME_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SPECIMEN_FRAME_CSP, "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };
/**
 * Called after the server's existing Host, Origin and run-token guards. `origin` is the request's
 * own (guarded) origin: with it, a served Studio page previews with its specimens (specimenHostCsp).
 */
export async function servePreview(root: string, pathname: string, method: string, response: ServerResponse, installOut?: string, query: URLSearchParams = new URLSearchParams(), served?: ServedApp, origin?: string): Promise<void> {
  // A failure body is Writer copy (the key's text): a preview frame shows it to a person.
  const fail = (status: number, key: string) => sendWriterText(response, status, join(root, "clossys"), key, SECURITY);
  if (method !== "GET" && method !== "HEAD") { fail(405, "studio.error.preview-read-only"); return; }
  const match = /^\/preview\/([^/]+)\/(pages|assets|frame)\/(.+)$/.exec(pathname);
  if (!match || !identity(match[1]!)) { fail(404, "studio.error.preview-unavailable"); return; }
  const selected = match[1]!, kind = match[2]!, file = match[3]!;
  const theme = previewTheme(query.get("theme"));
  if (kind === "frame") {
    // The frame page loads the page itself (sandboxed, same origin) at the specimen width.
    const page = /^([a-z][a-z0-9.-]*)\.html$/.exec(file)?.[1];
    if (!page || page.includes("..")) { fail(404, "studio.error.preview-page-unavailable"); return; }
    const src = `${PREVIEW_PREFIX}${encodeURIComponent(selected)}/pages/${encodeURIComponent(page)}.html${theme === "dark" ? "?theme=dark" : ""}`;
    // A served page nests specimens, whose scripts need the flag here too (a frame cannot regain a
    // flag its parent lacks); the page's own CSP still blocks every script it carries.
    const sandbox = origin !== undefined && await servedPage(root, selected, page, installOut, served) ? "allow-same-origin allow-scripts" : "allow-same-origin";
    const html = Buffer.from(specimenFramePage({ src, width: specimenWidth(query.get("width")), title: writerText(join(root, "clossys"), "studio.preview.frame-title", { page }), sandbox }));
    response.writeHead(200, { ...FRAME_HEADERS, "Content-Type": TYPES[".html"]!, "Content-Length": html.length });
    response.end(method === "HEAD" ? undefined : html); return;
  }
  try {
    let type: string, bytes: Buffer;
    const base = previewRoot(root, selected);
    if (!await stat(base).then(() => true, () => false)) { await serveInstall(root, selected, kind, file, method, response, fail, installOut, theme, served, origin); return; }
    if (kind === "pages") {
      const manifest = await descriptor(root, selected);
      const route = manifest.routes.find(route => `${route.id}.html` === file);
      if (!route) { fail(404, "studio.error.preview-page-unavailable"); return; }
      const entry = manifest.contentMap.entries.find(entry => entry.id === route.id);
      type = TYPES[".html"]!;
      const page = /\.html?$/.test(route.source.file) ? await previewSource(base, route.source.file) : await renderNativePreview({ root: base, entry: route.source.file, exportName: route.source.export, title: entry?.title, description: entry?.description });
      bytes = Buffer.from(themePage(page.toString("utf8"), theme));
    } else {
      type = TYPES[extname(file).toLowerCase()] ?? "";
      if (!type || file.split("/").some(part => part.startsWith("."))) { fail(415, "studio.error.preview-content-type"); return; }
      if (file.startsWith(BUNDLE_STYLES)) {
        // A native page's bundled CSS, linked by its render (never inlined).
        const css = bundledPreviewStylesheet(file.slice(BUNDLE_STYLES.length));
        if (css === undefined) { fail(404, "studio.error.preview-stylesheet-unavailable"); return; }
        bytes = Buffer.from(css);
      } else {
        bytes = await previewSource(base, file);
        if (file.endsWith(".css")) bytes = Buffer.from(generatedBody(bytes.toString("utf8")));
      }
    }
    response.writeHead(200, { ...SECURITY, "Content-Type": type, "Content-Length": bytes.length });
    response.end(method === "HEAD" ? undefined : bytes);
  } catch (error) { fail((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 403, "studio.error.preview-not-rendered"); }
}

/** Install output: the page's static HTML with its own substrate build's stylesheets, and those build assets. */
/** A page of `selected` installed into the Next app Producer serves (no descriptor preview shadows it). */
async function servedPage(root: string, selected: string, page: string, installOut?: string, served?: ServedApp): Promise<boolean> {
  if (!served || await stat(previewRoot(root, selected)).then(() => true, () => false)) return false;
  const found = await readInstallPublication(root, installOut, selected, served).catch(() => undefined);
  return found?.manifest.publication === selected && !!found.installs.find(install => install.id === page)?.next;
}
async function serveInstall(root: string, selected: string, kind: string, file: string, method: string, response: ServerResponse, fail: (status: number, key: string) => void, installOut?: string, theme: PreviewTheme = "light", served?: ServedApp, origin?: string): Promise<void> {
  const found = await readInstallPublication(root, installOut, selected, served);
  if (!found || found.manifest.publication !== selected) { fail(404, "studio.error.preview-unavailable"); return; }
  let type: string, bytes: Buffer, csp = PREVIEW_PAGE_CSP;
  const install = kind === "pages" ? found.installs.find(page => `${page.id}.html` === file) : undefined;
  if (install?.next) {
    // The installed route's own render, without its scripts; it runs none (its CSP has no script-src).
    const html = found.pages.find(page => page.id === install.id)?.emitted && served ? await served.render(install.next.route) : undefined;
    if (html === undefined) { fail(404, "studio.error.preview-page-unavailable"); return; }
    type = TYPES[".html"]!;
    bytes = Buffer.from(themePage(sandboxSpecimenFrames(staticPage(html), selected), theme));
    if (origin !== undefined) csp = specimenHostCsp(origin, selected);
  } else if (kind === "pages") {
    if (!install?.html) { fail(404, "studio.error.preview-page-unavailable"); return; }
    const links = install.css.map(css => `<link rel="stylesheet" href="${PREVIEW_PREFIX}${encodeURIComponent(selected)}/assets/${css.split("/").map(encodeURIComponent).join("/")}">`).join("");
    const html = (await previewSource(found.base, install.html)).toString("utf8");
    type = TYPES[".html"]!;
    bytes = Buffer.from(themePage(links && html.includes("</head>") ? html.replace("</head>", `${links}</head>`) : html, theme));
  } else {
    type = TYPES[extname(file).toLowerCase()] ?? "";
    if (!type || file.split("/").some(part => part.startsWith("."))) { fail(415, "studio.error.preview-content-type"); return; }
    if (!/^[^/]+\/substrate\/dist\/assets\/[^/]+$/.test(file)) { fail(404, "studio.error.preview-asset-unavailable"); return; }
    bytes = await previewSource(found.base, file);
  }
  response.writeHead(200, { ...SECURITY, "Content-Security-Policy": csp, "Content-Type": type, "Content-Length": bytes.length });
  response.end(method === "HEAD" ? undefined : bytes);
}
