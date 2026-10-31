import { readdir, realpath, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { confinedPreviewFile, generatedBody, previewSource, renderNativePreview } from "./publisher-preview-render.js";
import { inventory } from "./cells.js";
import { INSTALL_MARKER, installOutRoot } from "../publish/install-out.js";
import { SPECIMEN_FRAME_CSP, specimenFramePage, specimenWidth } from "./specimen-frame.js";

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
export async function publication(root: string, requested?: string, installOut?: string): Promise<PublicationResponse> {
  try {
    if (requested !== undefined && !identity(requested)) throw new Error("Invalid publication identity");
    const entries = await readdir(previewRoot(root), { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
    const publications = entries.filter(entry => entry.isDirectory() && identity(entry.name)).map(entry => entry.name).sort();
    if (!publications.length) return await installPublication(root, requested, installOut);
    const selected = requested ?? publications[0];
    if (!selected) return { state: "missing", message: "Not published yet", command: PREVIEW_COMMAND };
    const manifest = await descriptor(root, selected);
    const publisher = await inventory(root, "publisher");
    const meta = publisher.tree?.meta as Record<string, unknown> | undefined;
    const declared = Array.isArray(meta?.publications) ? meta.publications.find((value: any) => value?.id === selected) as Record<string, any> | undefined : undefined;
    const pages = await Promise.all(manifest.routes.map(async route => {
      const entry = manifest.contentMap.entries.find(entry => entry.id === route.id);
      const cellId = object(declared?.entryIds) ? Object.entries(declared.entryIds).find(([, id]) => id === route.id)?.[0] : publisher.cells.find(cell => cell.fields.path === route.path)?.id;
      let emitted = false;
      try { await confinedPreviewFile(previewRoot(root, selected), route.source.file); emitted = true; } catch { /* Descriptor metadata does not prove source exists. */ }
      return { id: route.id, route: route.path, emitted, ...pageRoutes(selected, route.id),
        ...(cellId === undefined ? {} : { cellId }),
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
/** One page written by `clossys publish --install` (paths relative to the install out root). */
interface InstallPage { id: string; html?: string; css: string[]; written: number }
interface InstallPublication { base: string; manifest: PublicationManifest; pages: PublicationPage[]; installs: InstallPage[] }
const blockingFinding = (finding: unknown) => object(finding) && finding.severity !== "info";
/** The install out root holds one dir per page (`install-<id>` by default, or each `--out`). */
async function installPages(base: string): Promise<InstallPage[]> {
  const found = new Map<string, InstallPage>();
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || /[\\\x00-\x1f%?#]/.test(entry.name)) continue;
    const dir = entry.name;
    try {
      await confinedPreviewFile(base, `${dir}/${INSTALL_MARKER}`);
      const reportFile = `${dir}/install-report.json`;
      const report = JSON.parse((await previewSource(base, reportFile)).toString("utf8"));
      if (!object(report) || typeof report.page !== "string" || !identity(report.page)) continue;
      const written = (await stat(await confinedPreviewFile(base, reportFile))).mtimeMs;
      if ((found.get(report.page)?.written ?? -1) > written) continue;
      let html: string | undefined = `${dir}/site/${report.page}/index.html`;
      // A failed rerun leaves the last page on disk; its report decides whether it is current.
      try { await confinedPreviewFile(base, html); } catch { html = undefined; }
      if (Array.isArray(report.findings) && report.findings.some(blockingFinding)) html = undefined;
      const css: string[] = [];
      try { for (const file of (await readdir(join(base, dir, "substrate", "dist", "assets"))).sort()) if (file.endsWith(".css")) css.push(`${dir}/substrate/dist/assets/${file}`); } catch { /* Unbuilt substrate: the page is served unstyled. */ }
      found.set(report.page, { id: report.page, ...(html ? { html } : {}), css, written });
    } catch { /* Not a readable install out dir. */ }
  }
  return [...found.values()];
}
async function readInstallPublication(root: string, installOut?: string): Promise<InstallPublication | undefined> {
  let base: string;
  try { base = await realpath(installOut ?? installOutRoot(root)); } catch { return undefined; }
  const installs = await installPages(base);
  if (!installs.length) return undefined;
  const publisher = await inventory(root, "publisher");
  const meta = publisher.tree?.meta as Record<string, unknown> | undefined;
  const declared = (Array.isArray(meta?.publications) ? meta.publications : []).find((value: any) => object(value?.entryIds) && identity(String(value.id)) && installs.some(page => Object.values(value.entryIds).includes(page.id))) as Record<string, any> | undefined;
  const id = typeof declared?.id === "string" ? declared.id : "site";
  const order: string[] = Array.isArray(declared?.entryOrder) ? declared.entryOrder : [];
  installs.sort((a, b) => ((order.indexOf(a.id) + 1) || Infinity) - ((order.indexOf(b.id) + 1) || Infinity) || a.id.localeCompare(b.id));
  const pages = installs.map(install => {
    const cellId = object(declared?.entryIds) ? Object.entries(declared.entryIds).find(([, entry]) => entry === install.id)?.[0] : publisher.cells.find(cell => cell.id === `page.${install.id}`)?.id;
    const path = publisher.cells.find(cell => cell.id === cellId)?.fields.path;
    return { id: install.id, route: typeof path === "string" && path.startsWith("/") ? path : install.id === "home" ? "/" : `/${install.id}`, emitted: !!install.html,
      ...pageRoutes(id, install.id), title: install.id, ...(cellId === undefined ? {} : { cellId }) } as PublicationPage;
  });
  const manifest: PublicationManifest = {
    schemaVersion: 1, publication: id, sourceApp: typeof declared?.routePack?.app === "string" ? declared.routePack.app : "clossys publish --install", format: "web.page.responsive",
    routes: pages.map(page => ({ id: page.id, path: page.route, source: { file: installs.find(install => install.id === page.id)!.html ?? `${page.id}.html`, export: "default" } })),
    contentMap: { version: 1, publicationId: id, entries: pages.map(page => ({ id: page.id, title: page.title!, kind: "page", path: page.route })) },
  };
  return { base, manifest, pages, installs };
}
/** Studio's publication view over `clossys publish --install` output. */
async function installPublication(root: string, requested?: string, installOut?: string): Promise<PublicationResponse> {
  const found = await readInstallPublication(root, installOut);
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
export type PreviewTheme = "light" | "dark";
export const previewTheme = (value: string | null | undefined): PreviewTheme => value === "dark" ? "dark" : "light";
/**
 * Apply the theme the way the substrate does (`.dark` on <html>), server side, since the page runs
 * no script. Existing classes on <html> are kept; a stale `dark`/`light` class is replaced.
 */
export function themePage(html: string, theme: PreviewTheme): string {
  const tag = /<html\b[^>]*>/i.exec(html);
  if (!tag) return `<html${theme === "dark" ? ' class="dark"' : ""} style="color-scheme:${theme}">${html}</html>`;
  let open = tag[0];
  const classes = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(open);
  const kept = (classes ? (classes[2] ?? classes[3] ?? "") : "").split(/\s+/).filter(name => /^[^"'<>&]+$/.test(name) && name !== "dark" && name !== "light");
  const value = [...kept, ...(theme === "dark" ? ["dark"] : [])].join(" ");
  const attribute = value ? ` class="${value}"` : "";
  open = classes ? open.replace(classes[0], attribute) : open.replace(/^<html\b/i, `<html${attribute}`);
  open = /\sstyle\s*=/i.test(open) ? open.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i, (_all, _q, a, b) => ` style="color-scheme:${theme};${a ?? b ?? ""}"`) : open.replace(/>$/, ` style="color-scheme:${theme}">`);
  return html.slice(0, tag.index) + open + html.slice(tag.index + tag[0].length);
}
const FRAME_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SPECIMEN_FRAME_CSP, "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };
/** Called after the server's existing Host, Origin and run-token guards. */
export async function servePreview(root: string, pathname: string, method: string, response: ServerResponse, installOut?: string, query: URLSearchParams = new URLSearchParams()): Promise<void> {
  const fail = (status: number, message: string) => { response.writeHead(status, { ...SECURITY, "Content-Type": "text/plain; charset=utf-8" }); response.end(message); };
  if (method !== "GET" && method !== "HEAD") { fail(405, "Publication preview is read-only"); return; }
  const match = /^\/preview\/([^/]+)\/(pages|assets|frame)\/(.+)$/.exec(pathname);
  if (!match || !identity(match[1]!)) { fail(404, "Publication preview is unavailable"); return; }
  const selected = match[1]!, kind = match[2]!, file = match[3]!;
  const theme = previewTheme(query.get("theme"));
  if (kind === "frame") {
    // The frame page loads the page itself (sandboxed, same origin) at the specimen width.
    const page = /^([a-z][a-z0-9.-]*)\.html$/.exec(file)?.[1];
    if (!page || page.includes("..")) { fail(404, "Publication page is unavailable"); return; }
    const src = `${PREVIEW_PREFIX}${encodeURIComponent(selected)}/pages/${encodeURIComponent(page)}.html${theme === "dark" ? "?theme=dark" : ""}`;
    const html = Buffer.from(specimenFramePage({ src, width: specimenWidth(query.get("width")), title: `${page} page preview`, sandbox: "allow-same-origin" }));
    response.writeHead(200, { ...FRAME_HEADERS, "Content-Type": TYPES[".html"]!, "Content-Length": html.length });
    response.end(method === "HEAD" ? undefined : html); return;
  }
  try {
    let type: string, bytes: Buffer;
    const base = previewRoot(root, selected);
    if (!await stat(base).then(() => true, () => false)) { await serveInstall(root, selected, kind, file, method, response, fail, installOut, theme); return; }
    if (kind === "pages") {
      const manifest = await descriptor(root, selected);
      const route = manifest.routes.find(route => `${route.id}.html` === file);
      if (!route) { fail(404, "Publication page is unavailable"); return; }
      const entry = manifest.contentMap.entries.find(entry => entry.id === route.id);
      type = TYPES[".html"]!;
      const page = /\.html?$/.test(route.source.file) ? await previewSource(base, route.source.file) : await renderNativePreview({ root: base, entry: route.source.file, exportName: route.source.export, title: entry?.title, description: entry?.description });
      bytes = Buffer.from(themePage(page.toString("utf8"), theme));
    } else {
      type = TYPES[extname(file).toLowerCase()] ?? "";
      if (!type || file.split("/").some(part => part.startsWith("."))) { fail(415, "Unsupported preview content type"); return; }
      bytes = await previewSource(base, file);
      if (file.endsWith(".css")) bytes = Buffer.from(generatedBody(bytes.toString("utf8")));
    }
    response.writeHead(200, { ...SECURITY, "Content-Type": type, "Content-Length": bytes.length });
    response.end(method === "HEAD" ? undefined : bytes);
  } catch (error) { fail((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 403, "Publication preview could not be rendered"); }
}

/** Install output: the page's static HTML with its own substrate build's stylesheets, and those build assets. */
async function serveInstall(root: string, selected: string, kind: string, file: string, method: string, response: ServerResponse, fail: (status: number, message: string) => void, installOut?: string, theme: PreviewTheme = "light"): Promise<void> {
  const found = await readInstallPublication(root, installOut);
  if (!found || found.manifest.publication !== selected) { fail(404, "Publication preview is unavailable"); return; }
  let type: string, bytes: Buffer;
  if (kind === "pages") {
    const install = found.installs.find(page => `${page.id}.html` === file);
    if (!install?.html) { fail(404, "Publication page is unavailable"); return; }
    const links = install.css.map(css => `<link rel="stylesheet" href="${PREVIEW_PREFIX}${encodeURIComponent(selected)}/assets/${css.split("/").map(encodeURIComponent).join("/")}">`).join("");
    const html = (await previewSource(found.base, install.html)).toString("utf8");
    type = TYPES[".html"]!;
    bytes = Buffer.from(themePage(links && html.includes("</head>") ? html.replace("</head>", `${links}</head>`) : html, theme));
  } else {
    type = TYPES[extname(file).toLowerCase()] ?? "";
    if (!type || file.split("/").some(part => part.startsWith("."))) { fail(415, "Unsupported preview content type"); return; }
    if (!/^[^/]+\/substrate\/dist\/assets\/[^/]+$/.test(file)) { fail(404, "Publication asset is unavailable"); return; }
    bytes = await previewSource(found.base, file);
  }
  response.writeHead(200, { ...SECURITY, "Content-Type": type, "Content-Length": bytes.length });
  response.end(method === "HEAD" ? undefined : bytes);
}
