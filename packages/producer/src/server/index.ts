import { studioChecks } from './studio-checks.js';
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentKind } from "../agents.js";
import { resolveAgent } from "../agents.js";
import { AGENT_KINDS, CELL_ID, agentRoot, hasCellTree, inventory, readStudioCells, summary, type CompileResult } from "./cells.js";
import type { StudioGateReport } from './studio-render-policy.js';
import { TOKEN_HEADER } from "./contract.js";
import { startStudio, studioEntry, type StudioChild } from "./studio.js";
import { watchCells } from "./watch.js";
import { studioTheme } from "./theme.js";
import { publication, servePreview } from "./publication.js";
import { selectionProfile, selectionRuntime, studioSelection } from "./selection.js";
import { consumerApps } from "./publications.js";
import { DESIGNER_FONT_PREFIX, consumerBrand, consumerFontFile, consumerGlobals } from "./designer-globals.js";
import { installedSpecimens } from "./installed-specimens.js";
import { designerDefaultTheme, designerGallery, designerLeaf } from "./designer-library.js";
import { agentGallery, agentLeaf, isLibraryAgent } from "./agent-library.js";
import { recordSpecimenViewport, RECORD_SPECIMEN_THEME_HEADER, RECORD_SPECIMEN_WIDTH_HEADER } from "./record-specimens.js";
import { recordSpecimenInput } from "./slot-gallery.js";
import { slotDetail } from "./slot-detail.js";
import { hasSlotModel } from "../records/slots.js";
import { SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { slotCensus } from "./slot-census.js";
import { specimenMount } from "../publish/site-server.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BRAND_MARK_CACHE = "private, max-age=60, stale-while-revalidate=300";

export type { AgentCells, CellSummary, CellsResponse, ChangeEvent } from "./contract.js";
export { TOKEN_HEADER } from "./contract.js";
export interface ProducerServerOptions {
  root: string; port?: number; studioEntry?: string; startupTimeoutMs?: number;
  /** Tests and embedding applications can own process signals themselves. */
  handleSignals?: boolean;
  compilation?: CompileResult[];
  /** Workspace holding `library/`, `selection.json` and `releases/` for the Designer gallery; defaults to `<root>/clossys`. */
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
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name) && name !== TOKEN_HEADER.toLowerCase() && name !== RECORD_SPECIMEN_THEME_HEADER && name !== RECORD_SPECIMEN_WIDTH_HEADER && !name.startsWith("x-forwarded-") && name !== "forwarded"));
}

/** Where payload npm imports resolve: the library workspace's own install when it has React, else Producer's. */
function specimenNpmRoot(workspace: string): string {
  return existsSync(join(workspace, "node_modules", "react", "package.json")) ? workspace : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The public listener always binds IPv4 loopback; Next remains a supervised child. */
export async function startProducerServer(options: ProducerServerOptions): Promise<ProducerServer> {
  const entry = await studioEntry(options.studioEntry);
  const library = resolve(options.root, options.library ?? "clossys");
  const hasLibrary = existsSync(join(library, "agents", "designer", "ia.json"));
  const defaultTheme = hasLibrary ? designerDefaultTheme(library) : undefined;
  // Pinned items render through the install pipeline; the record handler stays for other versions.
  const installed = hasLibrary ? installedSpecimens({ root: options.root, library }) : undefined;
  const specimen = hasLibrary ? await specimenMount({ records: [library], workspace: specimenNpmRoot(library), ...(defaultTheme ? { defaultTheme } : {}) }) : undefined;
  const token = randomBytes(32).toString("base64url");
  const aborter = new AbortController();
  const streams = new Set<ServerResponse>();
  let port = 0, child: StudioChild | undefined, stopWatch: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let failure: string | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const server = createServer((request, response) => { void handle(request, response).catch(() => {
    if (!response.headersSent) json(response, 500, { error: "Request could not be completed" }); else response.destroy();
  }); });
  const close = (): Promise<void> => closing ??= (async () => {
    aborter.abort(); stopWatch?.();
    for (const stream of streams) stream.end(); streams.clear();
    if (options.handleSignals !== false) { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); }
    const stopServer = server.listening ? new Promise<void>(resolve => {
      server.close(() => resolve()); server.closeAllConnections();
    }) : Promise.resolve();
    await Promise.all([stopServer, child?.stop()]); resolveClosed();
  })();
  const onSignal = () => { void close(); };
  if (options.handleSignals !== false) { process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal); }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = request.headers.host;
    if (headerCount(request, "host") !== 1 || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      json(response, 403, { error: "Invalid local Host" }); return;
    }
    const origin = `http://${host}`;
    if (request.headers.origin !== undefined && (headerCount(request, "origin") !== 1 || request.headers.origin !== origin)) {
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
      if (pathname === "/api/slots/census") { json(response, 200, slotCensus(library)); return; }
      if (pathname === "/api/health") { json(response, 200, { ok: !!child, studio: child ? "ready" : "starting" }); return; }
      const recordMatch = /^\/api\/slots\/(director|writer)\/([a-z0-9][a-z0-9.-]*)\/specimen$/.exec(pathname);
      if (recordMatch) {
        const input = recordSpecimenInput(library, recordMatch[1] as "director" | "writer", recordMatch[2]!, new URL(raw, origin).searchParams.get("candidate") ?? undefined);
        json(response, input ? 200 : 404, input ?? { state: "missing" }); return;
      }
      const slotMatch = /^\/api\/slots\/([a-z]+)\/([a-z0-9][a-z0-9.-]*)$/.exec(pathname);
      if (slotMatch) {
        if (!(SLOT_AGENTS as readonly string[]).includes(slotMatch[1]!)) { json(response, 404, { state: "missing" }); return; }
        if (!hasSlotModel(join(options.root, "clossys"))) { json(response, 200, { state: "legacy" }); return; }
        const detail = slotDetail(options.root, slotMatch[1] as SlotAgent, slotMatch[2]!);
        json(response, detail ? 200 : 404, detail ? { state: "ready", detail } : { state: "missing" }); return;
      }
      if (pathname === "/api/config") {
        const [theme, selection] = await Promise.all([studioTheme(options.root), studioSelection(options.root)]);
        json(response, 200, { token, tokenHeader: TOKEN_HEADER, readOnly: true, theme, selection, compilation: options.compilation ?? [], agents: AGENT_KINDS.map(agent => ({ agent, packageName: resolveAgent(agent).packageName })) }); return;
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
      // REPLACE (PROOF-2 route table): the Publisher content-map projection supersedes these two routes.
      if (pathname === "/api/designer/library") {
        json(response, 200, hasLibrary ? { state: "ready", ...designerGallery(library) } : { state: "missing", sections: [], count: 0 }); return;
      }
      const leafMatch = /^\/api\/designer\/library\/([a-z0-9][a-z0-9.-]*)$/.exec(pathname);
      if (leafMatch) {
        const leaf = hasLibrary ? designerLeaf(library, leafMatch[1]!) : undefined;
        if (!leaf) { json(response, 404, { state: "missing", error: "No Designer leaf with that name" }); return; }
        json(response, 200, { state: "ready", leaf }); return;
      }
      // REPLACE with the Publisher content-map projection, as for the Designer library routes.
      const agentMatch = /^\/api\/agents\/([a-z]+)\/library(?:\/([a-z0-9][a-z0-9.-]*))?$/.exec(pathname);
      if (agentMatch) {
        const agent = agentMatch[1]!;
        if (!isLibraryAgent(agent)) { json(response, 404, { state: "missing", error: "No agent library with that name" }); return; }
        if (agentMatch[2] === undefined) {
          const gallery = await agentGallery(options.root, agent);
          json(response, 200, gallery ? { state: "ready", ...gallery } : { state: "missing", agent, sections: [], count: 0 }); return;
        }
        const leaf = await agentLeaf(options.root, agent, agentMatch[2]);
        if (!leaf) { json(response, 404, { state: "missing", error: "No leaf with that name" }); return; }
        json(response, 200, { state: "ready", leaf }); return;
      }
      if (pathname === "/api/brand") {
        const brand = await consumerBrand(options.root);
        json(response, 200, { ...(brand.name ? { name: brand.name } : {}), mark: !!brand.mark }); return;
      }
      if (pathname === "/api/brand/mark.svg") {
        const brand = await consumerBrand(options.root);
        const ground = new URL(raw, origin).searchParams.get("ground") === "dark" ? "dark" : "light";
        // Without a consumer mark, Studio's own shipped mark stands in.
        if (!brand.mark) { response.writeHead(302, { Location: "/studio-mark.svg", "Cache-Control": BRAND_MARK_CACHE }); response.end(); return; }
        // Revalidated by content hash: a changed mark shows within a minute, an unchanged one is a 304.
        const svg = brand.mark[ground];
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
      if (pathname === "/api/cells") {
        const gateReports: StudioGateReport[] = [];
        json(response, 200, { agents: await Promise.all(AGENT_KINDS.map(agent => inventory(options.root, agent, finding => gateReports.push(finding)))), gateReports }); return;
      }
      if (pathname === "/api/publication") { json(response, 200, await publication(options.root, new URL(raw, origin).searchParams.get("publication") ?? undefined, options.installOut)); return; }
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
      const match = /^\/api\/cells\/([^/]+)\/([^/]+)$/.exec(pathname);
      if (match) {
        const agent = match[1] as AgentKind, id = match[2]!;
        if (!AGENT_KINDS.includes(agent) || !CELL_ID.test(id)) { json(response, 400, { error: "Invalid agent or cell id" }); return; }
        if (!await hasCellTree(agentRoot(options.root, agent))) { json(response, 404, { agent, state: "missing", message: "Agent cells are not initialized" }); return; }
        const query = new URL(raw, origin).searchParams;
        const versionText = query.get("version");
        if (versionText !== null && (!/^[1-9]\d*$/.test(versionText) || !Number.isSafeInteger(Number(versionText)))) { json(response, 400, { error: "Invalid cell version" }); return; }
        const gateReports: StudioGateReport[] = [];
        const candidates = (await readStudioCells(options.root, agent, finding => gateReports.push(finding))).filter(cell => cell.id === id && (versionText === null || cell.version === Number(versionText))).sort((a, b) => b.version - a.version);
        const cell = candidates[0];
        if (!cell) { json(response, 404, { agent, state: "missing", message: "Cell version is missing" }); return; }
        json(response, 200, { agent, state: "ready", cell: { ...summary(cell), source: cell.source }, gateReports }); return;
      }
      json(response, 404, { error: "Unknown API route" }); return;
    }
    // Run tokens are header-only; do not forward a token accidentally placed in a URL.
    const decodedQuery = [...new URL(raw, origin).searchParams].flat().join(" ");
    if (raw.includes(token) || decodedQuery.includes(token)) { json(response, 400, { error: "Run tokens must use the request header" }); return; }
    const recordAgent = new URL(raw, origin).searchParams.get("agent");
    const recordSpecimen = pathname === "/__specimen" && (recordAgent === "director" || recordAgent === "writer");
    if (recordSpecimen && request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Specimens are read-only" }); return; }
    if (!recordSpecimen && installed && (pathname === "/__specimen" || pathname.startsWith("/__specimen-site/"))) {
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Specimens are read-only" }); return; }
      if (await installed.handle(request, response, pathname)) return;
    }
    if (!recordSpecimen && specimen && (pathname === "/__specimen" || pathname.startsWith("/__specimen/"))) {
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Specimens are read-only" }); return; }
      if (await specimen(request, response)) return;
    }
    if (pathname === "/preview" || pathname.startsWith("/preview/")) { await servePreview(options.root, pathname, request.method ?? "", response, options.installOut, new URL(raw, origin).searchParams); return; }
    if (!child) { json(response, 503, { error: "Studio child is not ready" }); return; }
    const headers = cleanHeaders(request.headers);
    if (recordSpecimen) {
      const viewport = recordSpecimenViewport(new URL(raw, origin).searchParams);
      headers[RECORD_SPECIMEN_THEME_HEADER] = viewport.theme;
      headers[RECORD_SPECIMEN_WIDTH_HEADER] = String(viewport.width);
    }
    headers.host = `127.0.0.1:${child.port}`;
    const upstream = httpRequest({ hostname: "127.0.0.1", port: child.port, path: raw, method: request.method, headers }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, cleanHeaders(upstreamResponse.headers)); upstreamResponse.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) json(response, 502, { error: "Studio child is unavailable" }); else response.destroy(); });
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
