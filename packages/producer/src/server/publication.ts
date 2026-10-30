import { readdir } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { confinedPreviewFile, generatedBody, previewSource, renderNativePreview } from "./publisher-preview-render.js";
import { inventory } from "./cells.js";

export const PREVIEW_PREFIX = "/preview/";
export const PREVIEW_COMMAND = "clossys publish --target preview";
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
  indexing?: "index" | "noindex"; inSitemap?: boolean; lastPublished?: string; previewUrl: string; emitted: boolean;
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
export async function publication(root: string, requested?: string): Promise<PublicationResponse> {
  try {
    if (requested !== undefined && !identity(requested)) throw new Error("Invalid publication identity");
    const entries = await readdir(previewRoot(root), { withFileTypes: true });
    const publications = entries.filter(entry => entry.isDirectory() && identity(entry.name)).map(entry => entry.name).sort();
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
      return { id: route.id, route: route.path, emitted, previewUrl: `${PREVIEW_PREFIX}${encodeURIComponent(selected)}/pages/${encodeURIComponent(route.id)}.html`,
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
const SECURITY = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; connect-src 'none'",
  "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
};
/** Called after the server's existing Host, Origin and run-token guards. */
export async function servePreview(root: string, pathname: string, method: string, response: ServerResponse): Promise<void> {
  const fail = (status: number, message: string) => { response.writeHead(status, { ...SECURITY, "Content-Type": "text/plain; charset=utf-8" }); response.end(message); };
  if (method !== "GET" && method !== "HEAD") { fail(405, "Publication preview is read-only"); return; }
  const match = /^\/preview\/([^/]+)\/(pages|assets)\/(.+)$/.exec(pathname);
  if (!match || !identity(match[1]!)) { fail(404, "Publication preview is unavailable"); return; }
  const selected = match[1]!, kind = match[2]!, file = match[3]!;
  try {
    let type: string, bytes: Buffer;
    const base = previewRoot(root, selected);
    if (kind === "pages") {
      const manifest = await descriptor(root, selected);
      const route = manifest.routes.find(route => `${route.id}.html` === file);
      if (!route) { fail(404, "Publication page is unavailable"); return; }
      const entry = manifest.contentMap.entries.find(entry => entry.id === route.id);
      type = TYPES[".html"]!;
      bytes = /\.html?$/.test(route.source.file) ? await previewSource(base, route.source.file) : await renderNativePreview({ root: base, entry: route.source.file, exportName: route.source.export, title: entry?.title, description: entry?.description });
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
