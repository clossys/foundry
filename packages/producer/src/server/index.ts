import { attachStudioUpgrade } from "./studio-upgrade.js";
import { sendWriterText } from "./writer-text.js";
import { studioChecks } from './studio-checks.js';
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentKind } from "../agents.js";
import { resolveAgent } from "../agents.js";
import { AGENT_KINDS } from "./cells.js";
import { TOKEN_HEADER } from "./contract.js";
import { renderStudioRoute, startStudio, STUDIO_APP, studioEntry, type StudioChild } from "./studio.js";
import { watchCells } from "./watch.js";
import { studioTheme } from "./theme.js";
import { publication, servePreview, type ServedApp } from "./publication.js";
import { selectionProfile, selectionRuntime, studioSelection } from "./selection.js";
import { consumerApps } from "./publications.js";
import { DESIGNER_FONT_PREFIX, consumerBrand, consumerFontFile, consumerGlobals } from "./designer-globals.js";
import { installedSpecimens } from "./installed-specimens.js";
import { opaqueSpecimenRequest } from "./specimen-frame.js";
import { designerStylesheet } from "./publisher-preview-render.js";
import { slotGallery } from "./slot-gallery.js";
import { slotDetail } from "./slot-detail.js";
import { SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { slotCensus } from "./slot-census.js";
import { withSlotReadScope } from "../records/slots.js";
import { DEFAULT_AVATAR_PATH, defaultAvatarSvg } from "./default-avatar.js";
import { specimenMount } from "../publish/site-server.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hasAgentModel } from "../records/slots.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BRAND_MARK_CACHE = "private, max-age=60, stale-while-revalidate=300";
/** The pipeline graph Producer ships (`check:pipeline` keeps it current): the one file `/api/pipeline` reads. */
const PIPELINE_GRAPH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "pipeline", "graph.json");

export type { ChangeEvent } from "./contract.js";
export { TOKEN_HEADER } from "./contract.js";
export interface ProducerServerOptions {
  root: string; port?: number; studioEntry?: string; startupTimeoutMs?: number;
  /** Tests and embedding applications can own process signals themselves. */
  handleSignals?: boolean;
  /** Consumer `clossys/` root whose Designer slot model (`agents/designer`) feeds the gallery; defaults to `<root>/clossys`. */
  library?: string;
  /** Folder of `clossys publish --install` out dirs read by `/api/publication`; defaults to the install pipeline's own default. */
  installOut?: string;
}
export interface ProducerServer {
  port: number; url: string; closed: Promise<void>; close: () => Promise<void>;
  readonly failure?: string;
}
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}
function headerCount(request: IncomingMessage, name: string): number {
  return request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === name).length;
}
function equalToken(actual: unknown, token: string): boolean {
  return typeof actual === "string" && Buffer.byteLength(actual) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(actual), Buffer.from(token));
}
function cleanHeaders(headers: IncomingMessage["headers"]): IncomingMessage["headers"] {
  const blocked = new Set([...HOP, ...String(headers.connection ?? "").toLowerCase().split(",").map(value => value.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name) && name !== TOKEN_HEADER.toLowerCase() && !name.startsWith("x-forwarded-") && name !== "forwarded"));
}

/** Where payload npm imports resolve: the library workspace's own install when it has React, else Producer's. */
function specimenNpmRoot(workspace: string): string {
  return existsSync(join(workspace, "node_modules", "react", "package.json")) ? workspace : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The public listener always binds IPv4 loopback; Next remains a supervised child. */
export async function startProducerServer(options: ProducerServerOptions): Promise<ProducerServer> {
  const entry = await studioEntry(options.studioEntry);
  const library = resolve(options.root, options.library ?? "clossys");
  const hasLibrary = hasAgentModel(library, "designer");
  // Pinned items render through the install pipeline; the record handler stays for other versions.
  const installed = hasLibrary ? installedSpecimens({ root: options.root, library }) : undefined;
  // No default theme id: a specimen that names none renders in the consumer's whole pinned theme.
  const specimen = hasLibrary ? await specimenMount({ records: [library], workspace: specimenNpmRoot(library) }) : undefined;
  const token = randomBytes(32).toString("base64url");
  const aborter = new AbortController();
  const streams = new Set<ServerResponse>();
  let port = 0, child: StudioChild | undefined, stopWatch: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let failure: string | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const server = createServer((request, response) => { void handle(request, response).catch(() => {
    if (!response.headersSent) sendWriterText(response, 500, library, "studio.error.request-failed"); else response.destroy();
  }); });
  const closeUpgrades = attachStudioUpgrade(server, { publicPort: () => port, childPort: () => child?.port, token });
  const close = (): Promise<void> => closing ??= (async () => {
    aborter.abort(); stopWatch?.(); closeUpgrades();
    for (const stream of streams) stream.end(); streams.clear();
    if (options.handleSignals !== false) { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); }
    const stopServer = server.listening ? new Promise<void>(resolve => {
      server.close(() => resolve()); server.closeAllConnections();
    }) : Promise.resolve();
    await Promise.all([stopServer, child?.stop()]); resolveClosed();
  })();
  const onSignal = () => { void close(); };
  if (options.handleSignals !== false) { process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal); }

  // Studio's own publication previews through the Studio this server runs.
  const served: ServedApp = { app: STUDIO_APP, render: async path => child ? renderStudioRoute(child.port, path) : undefined };
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = request.headers.host;
    if (headerCount(request, "host") !== 1 || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      json(response, 403, { error: "Invalid local Host" }); return;
    }
    const origin = `http://${host}`;
    // A specimen framed by a served preview page runs in an opaque origin, so its module script,
    // crossorigin stylesheet and fonts arrive as CORS requests with `Origin: null`.
    const opaqueSpecimen = opaqueSpecimenRequest(request);
    if (opaqueSpecimen) { response.setHeader("Access-Control-Allow-Origin", "null"); response.setHeader("Vary", "Origin"); }
    else if (request.headers.origin !== undefined && (headerCount(request, "origin") !== 1 || request.headers.origin !== origin)) {
      json(response, 403, { error: "Invalid same-origin request" }); return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "")) {
      if (request.headers.origin !== origin || headerCount(request, "origin") !== 1 || headerCount(request, TOKEN_HEADER.toLowerCase()) !== 1 || !equalToken(request.headers[TOKEN_HEADER.toLowerCase()], token)) {
        json(response, 403, { error: "Same-origin Origin and run token are required" }); return;
      }
    }
    const raw = request.url ?? "";
    let pathname: string;
    try { pathname = decodeURIComponent(raw.split("?")[0]!); } catch { json(response, 400, { error: "Invalid request path" }); return; }
    if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\") || pathname.split("/").includes("..") || /[\x00-\x1f\x7f]/.test(pathname)) {
      json(response, 400, { error: "Invalid request path" }); return;
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      if (request.method !== "GET") { json(response, 405, { error: "API is read-only" }); return; }
      if (pathname === "/api/slots/census") { json(response, 200, withSlotReadScope(() => slotCensus(library))); return; }
      // The pipeline graph as committed: steps, edges, lanes and seats, read from graph.json only.
      if (pathname === "/api/pipeline") {
        const graph = await readFile(PIPELINE_GRAPH, "utf8").then(text => JSON.parse(text) as unknown).catch(() => undefined);
        json(response, graph ? 200 : 404, graph ? { state: "ready", graph } : { state: "missing" }); return;
      }
      if (pathname === "/api/health") { json(response, 200, { ok: !!child, studio: child ? "ready" : "starting" }); return; }
      // One agent's slots in IA order, grouped as the Studio tabs place them (`<l1>/<l2>` sections).
      const galleryMatch = /^\/api\/slots\/([a-z]+)$/.exec(pathname);
      if (galleryMatch) {
        if (!(SLOT_AGENTS as readonly string[]).includes(galleryMatch[1]!)) { json(response, 404, { state: "missing" }); return; }
        json(response, 200, { state: "ready", ...withSlotReadScope(() => slotGallery(library, galleryMatch[1] as SlotAgent)) }); return;
      }
      const slotMatch = /^\/api\/slots\/([a-z]+)\/([a-z0-9][a-z0-9.-]*)$/.exec(pathname);
      if (slotMatch) {
        if (!(SLOT_AGENTS as readonly string[]).includes(slotMatch[1]!)) { json(response, 404, { state: "missing" }); return; }
        // One read scope per request: the detail's many reads share one symlink walk per folder.
        const detail = withSlotReadScope(() => slotDetail(options.root, slotMatch[1] as SlotAgent, slotMatch[2]!));
        json(response, detail ? 200 : 404, detail ? { state: "ready", detail } : { state: "missing" }); return;
      }
      if (pathname === "/api/config") {
        const [theme, selection] = await Promise.all([studioTheme(options.root), studioSelection(options.root)]);
        json(response, 200, { token, tokenHeader: TOKEN_HEADER, readOnly: true, theme, selection, agents: AGENT_KINDS.map(agent => ({ agent, packageName: resolveAgent(agent).packageName })) }); return;
      }
      if (pathname === "/api/designer/globals.css") {
        const globals = await consumerGlobals(options.root).catch(() => undefined);
        response.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(globals ? { ETag: `"${globals.hash}"` } : {}) });
        response.end(globals?.css ?? "/* The consumer has no Designer globals; Studio keeps its stock component theme. */\n"); return;
      }
      if (pathname.startsWith(DESIGNER_FONT_PREFIX)) {
        const font = await consumerFontFile(options.root, pathname).catch(() => undefined);
        if (!font) { json(response, 404, { error: "Font is not part of the consumer's Designer globals" }); return; }
        response.writeHead(200, { "Content-Type": font.type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
        response.end(font.body); return;
      }
      if (pathname === "/api/brand") {
        const brand = await consumerBrand(options.root, library);
        json(response, 200, { ...(brand.name ? { name: brand.name } : {}), mark: !!brand.mark, favicon: !!brand.favicon, appIcon: !!brand.appIcon, lockup: !!brand.lockup }); return;
      }
      const brandAsset = /^\/api\/brand\/(mark|lockup|favicon|app-icon)\.svg$/.exec(pathname)?.[1];
      if (brandAsset) {
        const brand = await consumerBrand(options.root, library);
        const ground = new URL(raw, origin).searchParams.get("ground") === "dark" ? "dark" : "light";
        // Every brand file is the consumer's own pinned asset; a consumer that pins none has none.
        const svg = brandAsset === "mark" ? brand.mark?.[ground] : brandAsset === "lockup" ? brand.lockup?.[ground] : brandAsset === "favicon" ? brand.favicon : brand.appIcon;
        if (!svg) { json(response, 404, { state: "missing", error: `The workspace pins no ${brandAsset}` }); return; }
        // Revalidated by content hash: a changed mark shows within a minute, an unchanged one is a 304.
        const etag = `"${createHash("sha256").update(svg).digest("base64url")}"`;
        const headers = { "Cache-Control": BRAND_MARK_CACHE, ETag: etag, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" };
        if ((request.headers["if-none-match"] ?? "").split(",").map(value => value.trim().replace(/^W\//, "")).includes(etag)) { response.writeHead(304, headers); response.end(); return; }
        response.writeHead(200, { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" });
        response.end(svg); return;
      }
      if (pathname === "/api/selection/runtime.js") {
        const hash = new URL(raw, origin).searchParams.get("hash") ?? "";
        const runtime = /^sha256:[a-f0-9]{64}$/.test(hash) ? selectionRuntime(hash) : undefined;
        if (!runtime) { json(response, 404, { error: "Selected runtime is unavailable; reload the Producer config" }); return; }
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        response.end(runtime); return;
      }
      if (pathname === "/api/selection/profile") {
        const hash = new URL(raw, origin).searchParams.get("hash") ?? "";
        const profile = /^sha256:[a-f0-9]{64}$/.test(hash) ? selectionProfile(hash) : undefined;
        if (!profile) { json(response, 404, { error: "Selected profile is unavailable; reload the Producer config" }); return; }
        json(response, 200, profile); return;
      }
      if (pathname === "/api/publication") { json(response, 200, await publication(options.root, new URL(raw, origin).searchParams.get("publication") ?? undefined, options.installOut, served)); return; }
      if (pathname === "/api/apps") { json(response, 200, await consumerApps(options.root)); return; }
      if (pathname === "/api/checks") {
        const requested = new URL(raw, origin).searchParams.get("agent");
        if (requested !== null && !AGENT_KINDS.includes(requested as AgentKind)) { json(response, 400, { error: "Unknown check agent" }); return; }
        json(response, 200, await studioChecks(options.root, requested === null ? undefined : requested as AgentKind)); return;
      }
      if (pathname === "/api/events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        streams.add(response); response.write(`event: ready\ndata: ${JSON.stringify({ reload: true })}\n\n`);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000); heartbeat.unref();
        response.once("close", () => { clearInterval(heartbeat); streams.delete(response); }); return;
      }
      json(response, 404, { error: "Unknown API route" }); return;
    }
    // Run tokens are header-only; do not forward a token accidentally placed in a URL.
    const decodedQuery = [...new URL(raw, origin).searchParams].flat().join(" ");
    if (raw.includes(token) || decodedQuery.includes(token)) { json(response, 400, { error: "Run tokens must use the request header" }); return; }
    // Served pages link Designer's shipped stylesheets (the specimen frame, compiled utilities); none inlines a style.
    if (pathname.startsWith("/__designer/")) {
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Designer stylesheets are read-only" }); return; }
      const css = await designerStylesheet(pathname.slice("/__designer/".length));
      if (!css) { json(response, 404, { error: "Unknown Designer stylesheet" }); return; }
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" });
      response.end(request.method === "HEAD" ? undefined : css); return;
    }
    if (installed && (pathname === "/__specimen" || pathname.startsWith("/__specimen-site/"))) {
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Specimens are read-only" }); return; }
      if (await installed.handle(request, response, pathname)) return;
    }
    if (specimen && (pathname === "/__specimen" || pathname.startsWith("/__specimen/"))) {
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Specimens are read-only" }); return; }
      if (await specimen(request, response)) return;
    }
    // The opaque-origin read is for specimen files only; nothing else answers it.
    if (opaqueSpecimen) { response.removeHeader("Access-Control-Allow-Origin"); json(response, 404, { error: "Specimen file is unavailable" }); return; }
    if (DEFAULT_AVATAR_PATH.test(pathname)) {
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Avatars are read-only" }); return; }
      // Stock blocks' sample avatars (e.g. /avatars/shadcn.jpg) are not shipped: every one is the pinned placeholder image.
      const svg = await defaultAvatarSvg(options.root, library);
      if (!svg) { json(response, 404, { state: "missing", error: "The workspace pins no placeholder image or mark" }); return; }
      const etag = `"${createHash("sha256").update(svg).digest("base64url")}"`;
      const headers = { "Cache-Control": BRAND_MARK_CACHE, ETag: etag, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" };
      if ((request.headers["if-none-match"] ?? "").split(",").map(value => value.trim().replace(/^W\//, "")).includes(etag)) { response.writeHead(304, headers); response.end(); return; }
      response.writeHead(200, { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : svg); return;
    }
    if (pathname === "/preview" || pathname.startsWith("/preview/")) { await servePreview(options.root, pathname, request.method ?? "", response, options.installOut, new URL(raw, origin).searchParams, served, origin); return; }
    // A page request a person makes: the failure is Writer copy, never a JSON literal.
    if (!child) { sendWriterText(response, 503, library, "studio.error.studio-not-ready"); return; }
    const headers = cleanHeaders(request.headers);
    headers.host = `127.0.0.1:${child.port}`;
    // A fresh loopback connection per request: the shared keep-alive agent can hand out a socket the child already closed (ECONNRESET, served as 502).
    const upstream = httpRequest({ hostname: "127.0.0.1", port: child.port, path: raw, method: request.method, headers, agent: false }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, cleanHeaders(upstreamResponse.headers)); upstreamResponse.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) sendWriterText(response, 502, library, "studio.error.studio-unavailable"); else response.destroy(); });
    request.once("aborted", () => upstream.destroy());
    response.once("close", () => upstream.destroy());
    request.pipe(upstream);
  }
  try {
    server.listen(options.port ?? 4300, "127.0.0.1"); await once(server, "listening");
    port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    child = await startStudio(entry, url, aborter.signal, options.startupTimeoutMs);
    if (aborter.signal.aborted) throw new Error("Producer startup cancelled");
    child.process.once("exit", () => {
      if (!aborter.signal.aborted) failure = "Studio child stopped unexpectedly";
      void close();
    });
    stopWatch = await watchCells(options.root, event => {
      for (const stream of streams) {
        if (stream.writableLength > 64 * 1024) stream.destroy();
        else stream.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      }
    });
    if (aborter.signal.aborted || child.process.exitCode !== null || child.process.signalCode !== null) {
      stopWatch(); throw new Error("Studio child stopped during startup");
    }
    return { port, url, closed, close, get failure() { return failure; } };
  } catch (error) { await close(); throw error; }
}
