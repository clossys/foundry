import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentKind } from "../agents.js";
import { resolveAgent } from "../agents.js";
import { AGENT_KINDS, CELL_ID, agentRoot, hasCellTree, inventory, readCells, summary, type CompileResult } from "./cells.js";
import { TOKEN_HEADER } from "./contract.js";
import { startStudio, studioEntry, type StudioChild } from "./studio.js";
import { watchCells } from "./watch.js";
import { studioTheme } from "./theme.js";
import { selectionProfile, selectionRuntime, studioSelection } from "./selection.js";

export type { AgentCells, CellSummary, CellsResponse, ChangeEvent } from "./contract.js";
export { TOKEN_HEADER } from "./contract.js";
export interface ProducerServerOptions {
  root: string; port?: number; studioEntry?: string; startupTimeoutMs?: number;
  /** Tests and embedding applications can own process signals themselves. */
  handleSignals?: boolean;
  compilation?: CompileResult[];
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

/** The public listener always binds IPv4 loopback; Next remains a supervised child. */
export async function startProducerServer(options: ProducerServerOptions): Promise<ProducerServer> {
  const entry = await studioEntry(options.studioEntry);
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
      if (pathname === "/api/health") { json(response, 200, { ok: !!child, studio: child ? "ready" : "starting" }); return; }
      if (pathname === "/api/config") {
        const [theme, selection] = await Promise.all([studioTheme(options.root), studioSelection(options.root)]);
        json(response, 200, { token, tokenHeader: TOKEN_HEADER, readOnly: true, theme, selection, compilation: options.compilation ?? [], agents: AGENT_KINDS.map(agent => ({ agent, packageName: resolveAgent(agent).packageName })) }); return;
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
      if (pathname === "/api/cells") { json(response, 200, { agents: await Promise.all(AGENT_KINDS.map(agent => inventory(options.root, agent))) }); return; }
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
        const candidates = (await readCells(options.root, agent)).filter(cell => cell.id === id && (versionText === null || cell.version === Number(versionText))).sort((a, b) => b.version - a.version);
        const cell = candidates[0];
        if (!cell) { json(response, 404, { agent, state: "missing", message: "Cell version is missing" }); return; }
        json(response, 200, { agent, state: "ready", cell: { ...summary(cell), source: cell.source } }); return;
      }
      json(response, 404, { error: "Unknown API route" }); return;
    }
    if (!child) { json(response, 503, { error: "Studio child is not ready" }); return; }
    // Run tokens are header-only; do not forward a token accidentally placed in a URL.
    const decodedQuery = [...new URL(raw, origin).searchParams].flat().join(" ");
    if (raw.includes(token) || decodedQuery.includes(token)) { json(response, 400, { error: "Run tokens must use the request header" }); return; }
    const headers = cleanHeaders(request.headers); headers.host = `127.0.0.1:${child.port}`;
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
