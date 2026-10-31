/**
 * `/__specimen?element=<id>&v=<n>&theme=<light|dark|id>&width=<px>`: the one preview URL.
 *
 * The handler is mountable in any Node HTTP server (it answers only `/__specimen` paths and
 * returns false for everything else); `startSpecimenServer` runs it alone on loopback.
 * A missing record or a failed build still answers with a page, so the health reporter can
 * tell the embedding card what went wrong.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createSpecimenBuilder, type SpecimenBuilder, type SpecimenBuilderOptions } from "./build.js";
import { renderSpecimenPage, type SpecimenProblem } from "./render.js";
import { validSpecimenId } from "./source.js";
import { parseThemeParam } from "./theme.js";
import type { SpecimenQuery, SpecimenRecordSource } from "./types.js";

export const SPECIMEN_PATH = "/__specimen";
const ASSET = /^\/__specimen\/assets\/([0-9a-f]{24})\.(js|css)$/;

export interface SpecimenHandlerOptions extends SpecimenBuilderOptions {
  readonly source: SpecimenRecordSource;
  readonly builder?: SpecimenBuilder;
}

export type SpecimenQueryResult = { ok: true; query: SpecimenQuery } | { ok: false; error: string };

/** Validate the four URL parameters. */
export function parseSpecimenQuery(params: URLSearchParams): SpecimenQueryResult {
  const element = params.get("element") ?? "";
  if (!validSpecimenId(element)) return { ok: false, error: "element must be a record id" };
  const v = params.get("v");
  if (v !== null && !/^[1-9]\d{0,5}$/.test(v)) return { ok: false, error: "v must be a positive integer" };
  const width = params.get("width");
  if (width !== null && (!/^\d{3,4}$/.test(width) || Number(width) < 200 || Number(width) > 3840)) return { ok: false, error: "width must be 200-3840" };
  const theme = params.get("theme");
  if (theme !== null && !parseThemeParam(theme)) return { ok: false, error: "theme must be light, dark, <id> or <id>:<light|dark>" };
  return { ok: true, query: { element, ...(v ? { version: Number(v) } : {}), ...(theme ? { theme } : {}), ...(width ? { width: Number(width) } : {}) } };
}

/** The page's security policy: scripts only from this origin or this response's nonce. */
export function specimenCsp(nonce: string): string {
  return [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
    "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
  ].join("; ");
}

/** Render one specimen page for a parsed query. */
export async function renderSpecimen(options: { source: SpecimenRecordSource; builder: SpecimenBuilder; query: SpecimenQuery; nonce: string }): Promise<{ status: number; html: string }> {
  const { source, builder, query, nonce } = options;
  const problems: SpecimenProblem[] = [];
  let record;
  try { record = await source.read(query.element, query.version); } catch (error) { problems.push({ source: "record", message: error instanceof Error ? error.message : String(error) }); }
  const request = parseThemeParam(query.theme)!;
  let theme;
  try { theme = await source.theme(request.id ?? record?.preview.theme); } catch (error) { problems.push({ source: "record", message: `theme: ${error instanceof Error ? error.message : String(error)}` }); }
  if (request.id && !theme) problems.push({ source: "record", message: `theme ${request.id} not found` });
  if (!record && !problems.length) problems.push({ source: "record", message: `element ${query.element}${query.version ? `@v${query.version}` : ""} not found` });
  let build;
  if (record) {
    try { build = await builder.build(record, source); } catch (error) { problems.push({ source: "build", message: error instanceof Error ? error.message : String(error) }); }
  }
  const html = renderSpecimenPage({ query, ...(record ? { record } : {}), ...(theme ? { theme } : {}), ...(build ? { build } : {}), mode: request.mode, assetBase: `${SPECIMEN_PATH}/assets/`, nonce, problems });
  return { status: record ? 200 : 404, html };
}

/** A request handler for `/__specimen` and its assets; resolves false for other paths. */
export function createSpecimenHandler(options: SpecimenHandlerOptions) {
  const builder = options.builder ?? createSpecimenBuilder(options);
  return async function handleSpecimen(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== SPECIMEN_PATH && !url.pathname.startsWith(`${SPECIMEN_PATH}/`)) return false;
    const base = { "x-content-type-options": "nosniff", "cache-control": "no-cache" };
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { ...base, allow: "GET, HEAD" }).end(); return true; }
    const asset = ASSET.exec(url.pathname);
    if (asset) {
      const body = await builder.asset(asset[1]!, asset[2] as "js" | "css");
      if (body === undefined) { response.writeHead(404, base).end(); return true; }
      // Content-addressed: the hash names the bytes, so the asset can be cached for good.
      response.writeHead(200, { ...base, "content-type": asset[2] === "js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" });
      response.end(request.method === "HEAD" ? undefined : body);
      return true;
    }
    if (url.pathname !== SPECIMEN_PATH) { response.writeHead(404, base).end(); return true; }
    const parsed = parseSpecimenQuery(url.searchParams);
    if (!parsed.ok) { response.writeHead(400, { ...base, "content-type": "text/plain; charset=utf-8" }).end(`${parsed.error}\n`); return true; }
    const nonce = randomBytes(16).toString("base64");
    const page = await renderSpecimen({ source: options.source, builder, query: parsed.query, nonce });
    response.writeHead(page.status, { ...base, "content-type": "text/html; charset=utf-8", "content-security-policy": specimenCsp(nonce), "referrer-policy": "no-referrer" });
    response.end(request.method === "HEAD" ? undefined : page.html);
    return true;
  };
}

/** Serve specimens alone on a loopback port (0 picks a free one). */
export function startSpecimenServer(options: SpecimenHandlerOptions & { port?: number; host?: string }): Promise<{ server: Server; url: string }> {
  const handle = createSpecimenHandler(options);
  const server = createServer((request, response) => {
    handle(request, response).then(handled => { if (!handled) response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found\n"); })
      .catch(error => { if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }); response.end(`${error instanceof Error ? error.message : String(error)}\n`); });
  });
  const host = options.host ?? "127.0.0.1";
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      done({ server, url: `http://${host}:${port}` });
    });
  });
}

/** The specimen URL for one element. */
export function specimenUrl(base: string, query: SpecimenQuery): string {
  const params = new URLSearchParams({ element: query.element });
  if (query.version) params.set("v", String(query.version));
  if (query.theme) params.set("theme", query.theme);
  if (query.width) params.set("width", String(query.width));
  return `${base.replace(/\/$/, "")}${SPECIMEN_PATH}?${params}`;
}
