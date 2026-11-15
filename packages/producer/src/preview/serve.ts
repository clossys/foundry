/**
 * `clossys preview <publication>` (system.md 12.5): build a publication from resolved pins into
 * `.clossys/builds/preview-<inputsSha256 first 12>/` and serve it on one loopback port.
 *
 * The consumer's `clossys/` is read, never written: the build stages a copy of it under the build
 * folder, and each `--with <agent>/<slot>/<candidate>` rewrites only the staged slot's pin. Pages
 * are built by the same install path Studio's publisher preview reads (`publishInstall`), and each
 * route serves the bytes Studio serves for `/preview/<publication>/pages/<page>.html`
 * (`servePreview`), so the two never disagree on routes or HTML.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import type { InstallFinding, PageHostSelection, ShadcnRunner } from "@clossys/publisher/install";
import { publishInstall } from "../publish/install.js";
import { viteRunner } from "../publish/install-site.js";
import { readPinnedPublication, resolvePublicationTitles } from "../publish/pinned-publication.js";
import { listSlots, readCandidate, readSlotEntry } from "../records/slots.js";
import { SLOT_AGENTS, type SlotAgent } from "../records/slot-model/types.js";
import type { PreviewView } from "../records/types.js";
import { PREVIEW_PREFIX, servePreview } from "./publication.js";

/** The preview's own port (system.md 12.5). */
export const PREVIEW_PORT = 4600;
/** Ports a preview never binds: the workspace's standing Studio and admin servers. */
export const REFUSED_PORTS: readonly number[] = [4380, 4503];
/** The folder every preview build is written under, relative to the workspace root. */
export const PREVIEW_BUILDS = join(".clossys", "builds");

const IDENTITY = /^[a-z0-9][a-z0-9-]*$/;
/** Generated or tool state inside clossys/ that is not a record input. */
const SKIPPED = new Set(["node_modules", ".git", ".producer"]);

export interface PreviewOverride { readonly ref: string; readonly agent: SlotAgent; readonly slot: string; readonly candidate: string; readonly sha256: string }

export interface PreviewInputs {
  readonly root: string;
  readonly publication: string;
  /** `--with <agent>/<slot>/<candidate>` refs; at most one per slot. */
  readonly with?: readonly string[];
  readonly locales?: readonly string[];
}

export interface PreparedPreview {
  readonly root: string;
  readonly publication: string;
  readonly buildId: string;
  readonly inputsSha256: string;
  /** `<root>/.clossys/builds/<buildId>` */
  readonly dir: string;
  /** The staged workspace root the build reads (`<dir>/root`, holding the staged `clossys/`). */
  readonly staged: string;
  /** Per-page install output, in the layout Studio's publisher preview reads. */
  readonly installs: string;
  readonly overrides: readonly PreviewOverride[];
  readonly routes: PreviewView["routes"];
  readonly sample: readonly string[];
}

/** Checks a port the caller asked for: an integer port, never one of REFUSED_PORTS (0 asks the OS for a free one). */
export function previewPort(value: number | string | undefined): number {
  const port = value === undefined ? PREVIEW_PORT : typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`preview: --port needs a port number (0-65535), got ${String(value)}`);
  if (REFUSED_PORTS.includes(port)) throw new Error(`preview: port ${port} is reserved (${REFUSED_PORTS.join(", ")} are never bound by a preview)`);
  return port;
}

/** Parses `<agent>/<slot>/<candidate>` against the workspace's slot model; the candidate must exist. */
export function previewOverride(consumer: string, ref: string): PreviewOverride {
  const parts = ref.split("/");
  const [agent, slot, candidate] = parts;
  if (parts.length !== 3 || !agent || !slot || !candidate) throw new Error(`preview: --with needs <agent>/<slot>/<candidate>, got ${ref}`);
  if (!(SLOT_AGENTS as readonly string[]).includes(agent)) throw new Error(`preview: --with ${ref}: agent must be ${SLOT_AGENTS.join(", ")}`);
  const entry = readSlotEntry(consumer, agent as SlotAgent, slot);
  if (!entry) throw new Error(`preview: --with ${ref}: ${agent} has no slot ${slot}`);
  if (!entry.candidates.includes(candidate)) throw new Error(`preview: --with ${ref}: ${agent}/${slot} has no candidate ${candidate}`);
  const { sha256 } = readCandidate(consumer, agent as SlotAgent, slot, candidate);
  return { ref, agent: agent as SlotAgent, slot, candidate, sha256 };
}

/** Every record file under `clossys/`, as sorted [relative path, sha256] rows. */
function recordFiles(consumer: string): [string, string][] {
  const rows: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`preview: ${relative(consumer, path)} is a symbolic link; the slot model follows none`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) rows.push([relative(consumer, path).split(sep).join("/"), createHash("sha256").update(readFileSync(path)).digest("hex")]);
    }
  };
  walk(consumer);
  return rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The pinned publication's routes: every page entry with a configured path, in content-map order. */
export async function previewRoutes(consumer: string, publication: string, locales: readonly string[] = []): Promise<PreviewView["routes"]> {
  const pinned = resolvePublicationTitles(consumer, await readPinnedPublication(consumer, publication));
  if (pinned.map.format !== "web.page.responsive") throw new Error(`preview: publication ${publication} is ${pinned.map.format}; only web.page.responsive publications preview`);
  return pinned.map.entries
    .filter(entry => entry.kind === "page" && typeof entry.path === "string" && entry.path.startsWith("/"))
    .map(entry => ({ path: entry.path!, page: entry.id, locales: [...locales] }));
}

/** Refs still resolving to a package default (pin basis `package-default`), in agent then slot order. */
function sampleRefs(consumer: string): string[] {
  const refs: string[] = [];
  for (const agent of SLOT_AGENTS) {
    if (!existsSync(join(consumer, "agents", agent, "ia.json"))) continue;
    for (const slot of listSlots(consumer, agent)) {
      if ((slot.pin?.basis as string | undefined) === "package-default") refs.push(`${agent}/${slot.id}/${slot.pin!.candidate}`);
    }
  }
  return refs;
}

/**
 * Resolves the inputs, writes the staged workspace (with each override's pin) and returns the
 * build's identity and route list. Writes only under `<root>/.clossys/builds/`.
 */
export async function preparePreview(inputs: PreviewInputs): Promise<PreparedPreview> {
  const root = realpathSync(resolve(inputs.root));
  const publication = inputs.publication;
  if (!IDENTITY.test(publication)) throw new Error(`preview: ${publication} needs a publication id ([a-z0-9-])`);
  const consumer = join(root, "clossys");
  const overrides = (inputs.with ?? []).map(ref => previewOverride(consumer, ref));
  const seen = new Set<string>();
  for (const row of overrides) {
    const key = `${row.agent}/${row.slot}`;
    if (seen.has(key)) throw new Error(`preview: --with names ${key} twice; one candidate per slot`);
    seen.add(key);
  }
  const locales = [...(inputs.locales ?? [])];
  const files = recordFiles(consumer);
  const inputsSha256 = createHash("sha256").update(JSON.stringify({ publication, locales, overrides: overrides.map(row => [row.ref, row.sha256]), files })).digest("hex");
  const buildId = `preview-${inputsSha256.slice(0, 12)}`;
  const dir = join(root, PREVIEW_BUILDS, buildId), staged = join(dir, "root"), installs = join(dir, "installs");
  mkdirSync(staged, { recursive: true });
  mkdirSync(installs, { recursive: true });
  // Same inputs, same staged bytes: an existing build of this id is overwritten in place.
  cpSync(consumer, join(staged, "clossys"), { recursive: true, force: true, filter: source => !SKIPPED.has(source.split(sep).pop()!) });
  const stagedConsumer = join(staged, "clossys");
  for (const row of overrides) {
    const entry = readSlotEntry(stagedConsumer, row.agent, row.slot)!;
    if (!entry.pin) throw new Error(`preview: --with ${row.ref}: ${row.agent}/${row.slot} has no pin to swap`);
    writeFileSync(join(entry.dir, "pin.json"), `${JSON.stringify({ ...entry.pin, candidate: row.candidate, sha256: row.sha256 }, null, 2)}\n`);
  }
  const routes = await previewRoutes(stagedConsumer, publication, locales);
  return { root, publication, buildId, inputsSha256, dir, staged, installs, overrides, routes, sample: sampleRefs(stagedConsumer) };
}

export interface PreviewBuildOptions {
  readonly selection?: PageHostSelection;
  /** Resolves a relative `selection.module`; defaults to process.cwd(). */
  readonly cwd?: string;
  readonly runner?: ShadcnRunner;
  readonly npm?: ShadcnRunner;
  /** Runs the substrate's Vite build (`["build"]`), which writes the stylesheet a served page links. */
  readonly vite?: ShadcnRunner;
}

export interface PreviewBuildResult { readonly findings: readonly (InstallFinding & { page: string })[]; readonly built: readonly string[] }

/** Installs every route's page from the staged pins into `installs/install-<page>/` and builds its substrate. */
export async function buildPreview(prepared: PreparedPreview, options: PreviewBuildOptions = {}): Promise<PreviewBuildResult> {
  const findings: (InstallFinding & { page: string })[] = [], built: string[] = [];
  const vite = options.vite ?? viteRunner();
  for (const route of prepared.routes) {
    const result = await publishInstall({
      root: prepared.staged, page: route.page, out: join(prepared.installs, `install-${route.page}`),
      ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.selection ? { selection: options.selection } : {}),
      ...(options.runner ? { runner: options.runner } : {}), ...(options.npm ? { npm: options.npm } : {}),
    });
    findings.push(...result.findings.map(row => ({ ...row, page: route.page })));
    if (!result.html) continue;
    const run = await vite(["build"], { cwd: result.substrate });
    if (run.code !== 0) { findings.push({ page: route.page, code: "build-failed", detail: `vite build exited ${run.code}: ${(run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ")}` }); continue; }
    built.push(route.page);
  }
  return { findings, built };
}

/** The clossys.preview/1 view of a prepared build served at `url`. */
export function previewView(prepared: PreparedPreview, url: string): PreviewView {
  return {
    schema: "clossys.preview/1", publication: prepared.publication, buildId: prepared.buildId, url,
    routes: prepared.routes.map(route => ({ ...route, locales: [...route.locales] })),
    overrides: prepared.overrides.map(row => ({ ref: row.ref, sha256: row.sha256 })),
    sample: [...prepared.sample],
  };
}

export const previewUrl = (port: number) => `http://127.0.0.1:${port}/`;

export interface PreviewServer { readonly port: number; readonly url: string; readonly server: Server; close(): Promise<void> }

/**
 * Serves a built preview on 127.0.0.1:`port`: each route path answers with its page as Studio
 * serves it, and `/preview/<publication>/...` (the pages' own asset links) passes through. A
 * request for another host is refused, so the port cannot be reached through a rebound name.
 */
export async function startPreviewServer(prepared: PreparedPreview, port: number): Promise<PreviewServer> {
  const asked = previewPort(port);
  const pages = new Map(prepared.routes.map(route => [route.path, route.page]));
  let bound = asked;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://preview.invalid");
    const host = request.headers.host ?? "";
    if (host !== `127.0.0.1:${bound}` && host !== `localhost:${bound}`) { response.writeHead(421, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Misdirected request\n"); return; }
    const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    const page = pages.get(path);
    const pathname = page !== undefined ? `${PREVIEW_PREFIX}${encodeURIComponent(prepared.publication)}/pages/${encodeURIComponent(page)}.html` : url.pathname;
    if (page === undefined && !pathname.startsWith(`${PREVIEW_PREFIX}${prepared.publication}/`)) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not a route of this preview\n"); return; }
    servePreview(prepared.staged, pathname, request.method ?? "GET", response, prepared.installs, url.searchParams).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end();
    });
  });
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(asked, "127.0.0.1", () => { server.off("error", fail); done(); }); });
  const address = server.address();
  bound = typeof address === "object" && address ? address.port : -1;
  if (asked !== 0 && bound !== asked) { await new Promise(done => server.close(done)); throw new Error(`preview: asked for port ${asked}, bound ${bound}`); }
  return { port: bound, url: previewUrl(bound), server, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) };
}
