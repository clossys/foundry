/**
 * `clossys check --render` (Reviewer's Production stage, rule R-RENDER-AUDIT): capture each route of a built site in
 * a real browser and audit what renders (check/render-audit.ts): visible glyphs, empty icons, overflow, accessible
 * names, Writer copy keys and `data-slot` attribution. It fails closed: no routes, no route captured, no browser or
 * no build is FAIL with its reason, never PASS. Findings become requests (cli/render-check.ts --file); this check
 * gates no merge.
 *
 * Where the routes come from:
 *   --routes <file>  a `clossys.render-routes/1` file: `site` (a built static folder, relative to the file, each route
 *                    `{ path, file? }`), `origin` (a loopback server already running, each route `{ path }`), or
 *                    `preview` (the file `clossys preview` writes beside its build, served with the preview's server).
 *   (none)           the newest `clossys/.state/builds/preview-* /render-routes.json` in the workspace.
 *
 * Each capture is measured in the browser (render-audit.ts measureRender), saved as HTML under `--out` (default
 * `clossys/.state/render/<stamp>/` in a workspace), and audited from those marks, so a saved capture re-audits to
 * the same findings without a browser.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { STATE_DIR } from "../engine/state-dir.js";
import { PREVIEW_BUILDS, RENDER_ROUTES_FILE, startPreviewServer, type PreparedPreview } from "../preview/serve.js";
import { MODEL_AGENTS } from "../records/slot-model/types.js";
import { auditExpression, MEASURE_EXPRESSION, type RenderAuditOptions, type RenderFinding } from "./render-audit.js";

export const RENDER_SCHEMA = "clossys.render-check/1";
export const ROUTES_SCHEMA = "clossys.render-routes/1";
/** Desktop and phone: overflow shows at the narrow one. */
export const DEFAULT_VIEWPORTS: readonly Viewport[] = [{ width: 1280, height: 800 }, { width: 375, height: 812 }];
export const AUDIT_OPTIONS: RenderAuditOptions = { agents: [...MODEL_AGENTS], fallbackAgent: "publisher" };

export interface Viewport { readonly width: number; readonly height: number }
export type RenderReason = "no-routes" | "no-browser" | "no-build" | "capture-error" | "findings";

export interface RenderRouteResult {
  readonly path: string;
  readonly url: string;
  readonly viewport: string;
  readonly captured: boolean;
  /** The saved capture, relative to the record's `out` folder. */
  readonly capture?: string;
  readonly findings: number;
  readonly error?: string;
}

export interface RenderRouteFinding extends RenderFinding {
  readonly route: string;
  readonly viewport: string;
}

export interface RenderRecord {
  readonly schema: typeof RENDER_SCHEMA;
  readonly owner_agent: "reviewer";
  readonly verdict: "PASS" | "FAIL";
  /** Why a FAIL failed; absent on a PASS. */
  readonly reason?: RenderReason;
  readonly detail?: string;
  readonly source: string;
  /** Captures taken (the record's "commands"), and what was missing (a browser, a build). */
  readonly ran: { readonly commands: number; readonly missing: readonly string[] };
  readonly routes: readonly RenderRouteResult[];
  readonly findings: readonly RenderRouteFinding[];
  readonly out?: string;
  /** The requests `--file` wrote, one line each. */
  readonly requests?: readonly string[];
  /** The last printed line: `RENDER: PASS|FAIL <captured>/<asked> capture(s) <n> finding(s)`. */
  readonly line: string;
}

// The browser surface the capture needs (Playwright's), kept out of this package's type graph as page-lint.ts does.
export interface CapturePage {
  goto(url: string, options: { timeout: number; waitUntil: "load" }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
}
export interface CaptureContext { newPage(): Promise<CapturePage>; close(): Promise<void> }
export interface CaptureBrowser { newContext(options: { viewport: Viewport; serviceWorkers: "block" }): Promise<CaptureContext>; close(): Promise<void> }
export interface CaptureRuntime { chromium: { launch(options: { headless: true; executablePath?: string; timeout: number }): Promise<CaptureBrowser> } }

export class RenderUsageError extends Error {}

export interface RenderCheckOptions {
  /** The workspace root (holding clossys/), when there is one. */
  readonly root?: string;
  readonly routes?: string;
  readonly out?: string;
  readonly executablePath?: string;
  readonly timeoutMs?: number;
  /** The browser driver; defaults to the `playwright` package. A test passes a saved-HTML runtime. */
  readonly runtime?: CaptureRuntime | (() => CaptureRuntime);
  readonly stamp?: string;
}

interface Targets {
  readonly source: string;
  readonly routes: readonly { path: string; url: string }[];
  readonly viewports: readonly Viewport[];
  readonly missingBuild: readonly string[];
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

function loopback(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && (url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname));
  } catch { return false; }
}

/** The file a static route reads: its own `file`, else `<path>/index.html`, else `<path>.html`. */
function routeFile(site: string, path: string, file?: string): string | undefined {
  const inside = (candidate: string) => { const full = resolve(site, candidate); return full === site || full.startsWith(`${site}${sep}`) ? full : undefined; };
  if (file !== undefined) { const full = inside(file); return full && existsSync(full) && statSync(full).isFile() ? full : undefined; }
  const bare = path.replace(/^\/+|\/+$/g, "");
  for (const candidate of [join(bare, "index.html"), `${bare}.html`]) { const full = inside(candidate); if (full && existsSync(full) && statSync(full).isFile()) return full; }
  return undefined;
}

/** Serves a built static folder on 127.0.0.1 (a free port); each route path answers with its own file. */
async function serveSite(site: string, files: ReadonlyMap<string, string>): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://site.invalid").pathname;
    const full = files.get(path) ?? (() => { const candidate = resolve(site, `.${decodeURIComponent(path)}`); return candidate.startsWith(`${site}${sep}`) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : undefined; })();
    if (!full) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found\n"); return; }
    response.writeHead(200, { "Content-Type": TYPES[extname(full).toLowerCase()] ?? "application/octet-stream" });
    response.end(readFileSync(full));
  });
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => { server.off("error", fail); done(); }); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) };
}

function viewportsOf(doc: { viewports?: unknown }, where: string): Viewport[] {
  if (doc.viewports === undefined) return [...DEFAULT_VIEWPORTS];
  if (!Array.isArray(doc.viewports) || !doc.viewports.every(item => item && Number.isInteger(item.width) && Number.isInteger(item.height) && item.width >= 200 && item.height >= 200)) {
    throw new RenderUsageError(`${where}: viewports must be a list of { width, height } in whole pixels, at least 200`);
  }
  return doc.viewports.map(item => ({ width: item.width, height: item.height }));
}

/** The newest preview build's routes file in the workspace, if any. */
export function newestPreviewRoutes(root: string): string | undefined {
  const builds = join(root, PREVIEW_BUILDS);
  if (!existsSync(builds)) return undefined;
  return readdirSync(builds).filter(name => name.startsWith("preview-")).map(name => join(builds, name, RENDER_ROUTES_FILE)).filter(path => existsSync(path))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

async function targetsOf(file: string): Promise<Targets> {
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; }
  catch (error) { throw new RenderUsageError(`--routes ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  if (doc?.schema !== ROUTES_SCHEMA || !Array.isArray(doc.routes)) throw new RenderUsageError(`--routes ${file}: not a ${ROUTES_SCHEMA} file (schema and a routes list)`);
  const routes = doc.routes as { path?: unknown; file?: unknown; page?: unknown; built?: unknown }[];
  for (const route of routes) if (typeof route?.path !== "string" || !route.path.startsWith("/")) throw new RenderUsageError(`--routes ${file}: every route has a path starting with /`);
  const viewports = viewportsOf(doc, `--routes ${file}`);
  const kinds = ["site", "origin", "preview"].filter(key => doc[key] !== undefined);
  if (kinds.length !== 1) throw new RenderUsageError(`--routes ${file}: name exactly one of site, origin or preview`);
  const none = { close: async () => {} };
  if (typeof doc.origin === "string") {
    if (!loopback(doc.origin)) throw new RenderUsageError(`--routes ${file}: origin must be a loopback http(s) URL without credentials`);
    const origin = doc.origin.replace(/\/+$/, "");
    return { source: `origin ${origin}`, routes: routes.map(route => ({ path: route.path as string, url: `${origin}${route.path}` })), viewports, missingBuild: [], ...none };
  }
  if (typeof doc.site === "string") {
    const site = resolve(dirname(file), doc.site);
    if (!existsSync(site) || !statSync(site).isDirectory()) return { source: `site ${doc.site}`, routes: [], viewports, missingBuild: [`the built site ${doc.site} (no such folder)`], ...none };
    const real = realpathSync(site);
    const files = new Map<string, string>(), missing: string[] = [];
    for (const route of routes) {
      const found = routeFile(real, route.path as string, typeof route.file === "string" ? route.file : undefined);
      if (found) files.set(route.path as string, found); else missing.push(`${route.path} (no ${typeof route.file === "string" ? route.file : "built page"} in ${doc.site})`);
    }
    if (missing.length) return { source: `site ${doc.site}`, routes: [], viewports, missingBuild: missing, ...none };
    const served = await serveSite(real, files);
    return { source: `site ${doc.site}`, routes: routes.map(route => ({ path: route.path as string, url: `${served.origin}${route.path}` })), viewports, missingBuild: [], close: served.close };
  }
  const preview = doc.preview as { publication?: unknown; buildId?: unknown } | null;
  if (typeof preview?.publication !== "string" || typeof preview.buildId !== "string") throw new RenderUsageError(`--routes ${file}: preview names its publication and buildId`);
  const dir = dirname(resolve(file));
  const unbuilt = routes.filter(route => route.built !== true || typeof route.page !== "string").map(route => `${route.path} (page ${String(route.page)} not built: run clossys preview ${preview.publication} --once)`);
  if (unbuilt.length) return { source: `preview ${preview.buildId}`, routes: [], viewports, missingBuild: unbuilt, ...none };
  const prepared: PreparedPreview = {
    root: resolve(dir, "..", "..", "..", ".."), publication: preview.publication, buildId: preview.buildId, inputsSha256: "", dir,
    staged: join(dir, "root"), installs: join(dir, "installs"), overrides: [], sample: [],
    routes: routes.map(route => ({ path: route.path as string, page: route.page as string, locales: [] })),
  };
  const served = await startPreviewServer(prepared, 0);
  const origin = served.url.replace(/\/+$/, "");
  return { source: `preview ${preview.buildId}`, routes: routes.map(route => ({ path: route.path as string, url: `${origin}${route.path}` })), viewports, missingBuild: [], close: served.close };
}

const label = (viewport: Viewport) => `${viewport.width}x${viewport.height}`;
const captureName = (path: string, viewport: Viewport) => `${(path.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_") || "index")}@${label(viewport)}.html`;

function record(fields: Omit<RenderRecord, "schema" | "owner_agent" | "line">): RenderRecord {
  const captured = fields.routes.filter(route => route.captured).length;
  const line = `RENDER: ${fields.verdict} ${captured}/${fields.routes.length} capture(s) ${fields.findings.length} finding(s)`;
  return { schema: RENDER_SCHEMA, owner_agent: "reviewer", ...fields, line };
}

const fail = (reason: RenderReason, detail: string, source: string, missing: readonly string[] = [], routes: readonly RenderRouteResult[] = [], findings: readonly RenderRouteFinding[] = [], out?: string): RenderRecord =>
  record({ verdict: "FAIL", reason, detail, source, ran: { commands: routes.filter(route => route.captured).length, missing: [...missing] }, routes, findings, ...(out ? { out } : {}) });

/** The verdict over what was captured. Zero captures is never a pass. */
export function renderVerdict(routes: readonly RenderRouteResult[], findings: readonly RenderRouteFinding[]): { verdict: "PASS" | "FAIL"; reason?: RenderReason; detail?: string } {
  const captured = routes.filter(route => route.captured).length;
  if (captured === 0) return { verdict: "FAIL", reason: "no-routes", detail: routes.length ? `none of ${routes.length} capture(s) completed` : "no route to capture" };
  const errors = routes.filter(route => !route.captured);
  if (errors.length) return { verdict: "FAIL", reason: "capture-error", detail: `${errors.length} of ${routes.length} capture(s) failed: ${errors.map(route => `${route.path}@${route.viewport}: ${route.error}`).slice(0, 3).join("; ")}` };
  if (findings.length) return { verdict: "FAIL", reason: "findings", detail: `${findings.length} finding(s) on ${new Set(findings.map(item => item.route)).size} route(s)` };
  return { verdict: "PASS" };
}

function loadRuntime(option: RenderCheckOptions["runtime"]): CaptureRuntime {
  if (option) return typeof option === "function" ? option() : option;
  const runtime = createRequire(import.meta.url)("playwright") as CaptureRuntime;
  if (typeof runtime?.chromium?.launch !== "function") throw new Error("the playwright package has no Chromium driver");
  return runtime;
}

/** Captures and audits every route at every viewport, and returns the verdict record. */
export async function runRenderCheck(options: RenderCheckOptions = {}): Promise<RenderRecord> {
  const root = options.root;
  const routesFile = options.routes !== undefined ? resolve(options.routes) : root ? newestPreviewRoutes(root) : undefined;
  if (routesFile === undefined) {
    return fail("no-build", root ? `no built preview in ${relative(process.cwd(), join(root, PREVIEW_BUILDS)) || PREVIEW_BUILDS}: run clossys preview <publication> --once, or pass --routes <file>` : "no workspace and no --routes file: nothing names a built site", "none", ["a built site"]);
  }
  if (!existsSync(routesFile)) return fail("no-build", `the routes file ${options.routes} does not exist`, "none", ["a built site"]);
  const targets = await targetsOf(routesFile);
  try {
    if (targets.missingBuild.length) return fail("no-build", `the build is missing: ${targets.missingBuild.slice(0, 3).join("; ")}`, targets.source, targets.missingBuild);
    if (targets.routes.length === 0) return fail("no-routes", "the routes file lists no route: zero routes captured", targets.source);
    const timeoutMs = options.timeoutMs ?? 30_000;
    let browser: CaptureBrowser;
    try {
      browser = await loadRuntime(options.runtime).chromium.launch({ headless: true, timeout: timeoutMs, ...(options.executablePath ?? process.env.CHROMIUM_PATH ? { executablePath: options.executablePath ?? process.env.CHROMIUM_PATH } : {}) });
    } catch (error) {
      return fail("no-browser", `no browser to capture with: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`, targets.source, ["a Chromium browser (the playwright package and its browser)"]);
    }
    const out = options.out !== undefined ? resolve(options.out) : root ? join(root, STATE_DIR, "render", options.stamp ?? new Date().toISOString().replace(/[:.]/g, "-")) : undefined;
    if (out) mkdirSync(out, { recursive: true });
    const results: RenderRouteResult[] = [], findings: RenderRouteFinding[] = [];
    try {
      for (const viewport of targets.viewports) {
        for (const route of targets.routes) {
          let context: CaptureContext | undefined;
          try {
            context = await browser.newContext({ viewport, serviceWorkers: "block" });
            const page = await context.newPage();
            await page.goto(route.url, { timeout: timeoutMs, waitUntil: "load" });
            await page.evaluate<number>(MEASURE_EXPRESSION);
            const audited = await page.evaluate<{ findings: RenderFinding[]; html: string }>(auditExpression(AUDIT_OPTIONS));
            const name = captureName(route.path, viewport);
            if (out) writeFileSync(join(out, name), audited.html);
            const rows = audited.findings.map(item => ({ ...item, route: route.path, viewport: label(viewport) }));
            findings.push(...rows);
            results.push({ path: route.path, url: route.url, viewport: label(viewport), captured: true, ...(out ? { capture: name } : {}), findings: rows.length });
          } catch (error) {
            results.push({ path: route.path, url: route.url, viewport: label(viewport), captured: false, findings: 0, error: (error instanceof Error ? error.message : String(error)).split("\n")[0]! });
          } finally {
            await context?.close().catch(() => {});
          }
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
    const verdict = renderVerdict(results, findings);
    return record({ ...verdict, source: targets.source, ran: { commands: results.filter(item => item.captured).length, missing: [] }, routes: results, findings, ...(out ? { out } : {}) });
  } finally {
    await targets.close();
  }
}

/** The printed form: one line per capture, the findings with their slot and agent, then the verdict line. */
export function formatRender(rec: RenderRecord): string {
  const lines = [`render: ${rec.source}`];
  for (const route of rec.routes) lines.push(`  ${route.path} @${route.viewport}: ${route.captured ? `${route.findings} finding(s)` : `not captured (${route.error})`}`);
  if (rec.findings.length) {
    lines.push("findings:");
    for (const item of rec.findings) lines.push(`  ${item.rule} ${item.route} @${item.viewport} slot ${item.slot ?? "(none)"} -> ${item.agent}: ${item.message} [${item.selector}]${item.evidence ? ` ${item.evidence}` : ""}`);
  }
  if (rec.requests?.length) lines.push("requests:", ...rec.requests.map(line => `  ${line}`));
  if (rec.reason && rec.reason !== "findings") lines.push(`${rec.reason}: ${rec.detail}`);
  if (rec.out) lines.push(`captures: ${rec.out}`);
  lines.push(rec.line);
  return lines.join("\n");
}
