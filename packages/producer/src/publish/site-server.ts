/**
 * Static file server for a rendered preview site: clean URLs (`/a` → `/a/index.html`),
 * loopback only, confined to the site directory. With library roots it also serves
 * element specimens at `/__specimen` (Publisher's renderer over records read through the
 * slot engine loaders). Run as
 * `node site-server.js <dir> <port> [--records <dir>]... [--workspace <dir>] [--default-theme <id>]`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
};

/** The file a request path names inside `dir`, or undefined (missing, traversal or a symlink out). */
export async function siteFile(dir: string, url: string): Promise<string | undefined> {
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(url, "http://localhost").pathname); } catch { return undefined; }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === ".." || part.includes("\\") || part.includes("\0") || part.startsWith("."))) return undefined;
  const root = await realpath(dir);
  for (const candidate of extname(pathname) ? [join(root, ...parts)] : [join(root, ...parts, "index.html"), join(root, ...parts)]) {
    try {
      const target = await realpath(candidate);
      const inside = relative(root, target);
      if (isAbsolute(inside) || inside.startsWith("..")) continue;
      if ((await stat(target)).isFile()) return target;
    } catch { /* next candidate */ }
  }
  return undefined;
}

export interface SiteServerOptions {
  /** Library roots (`<root>/<slot>/<element>/v<n>/`); when present `/__specimen` is mounted. */
  readonly records?: readonly string[];
  /** Where payload npm imports resolve from when a specimen is bundled. */
  readonly workspace?: string;
  readonly defaultTheme?: string;
}

type Mount = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

/** The `/__specimen` handler over library roots, loaded only when there are roots to serve. */
export async function specimenMount(options: SiteServerOptions): Promise<Mount | undefined> {
  if (!options.records?.length) return undefined;
  const [{ createSpecimenHandler }, { libraryRecordSource }] = await Promise.all([import("@clossys/publisher/specimen"), import("../specimen/library-source.js")]);
  const source = libraryRecordSource({ roots: options.records, ...(options.defaultTheme ? { defaultTheme: options.defaultTheme } : {}) });
  return createSpecimenHandler({ source, workspace: options.workspace ?? process.cwd() });
}

export async function startSiteServer(dir: string, port: number, options: SiteServerOptions = {}): Promise<Server> {
  const specimen = await specimenMount(options);
  const server = createServer(async (request, response) => {
    if (specimen) {
      try { if (await specimen(request, response)) return; } catch (error) {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { allow: "GET, HEAD" }).end(); return; }
    const file = await siteFile(dir, request.url ?? "/");
    if (!file) { response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  return new Promise((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", () => done(server)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, port, ...rest] = process.argv.slice(2);
  const usage = "usage: site-server <dir> <port> [--records <dir>]... [--workspace <dir>] [--default-theme <id>]";
  if (!dir || !port || !/^\d+$/.test(port)) { console.error(usage); process.exit(2); }
  const records: string[] = [];
  let workspace: string | undefined, defaultTheme: string | undefined;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index], value = rest[index + 1];
    if (!value) { console.error(usage); process.exit(2); }
    if (flag === "--records") records.push(resolve(value));
    else if (flag === "--workspace") workspace = resolve(value);
    else if (flag === "--default-theme") defaultTheme = value;
    else { console.error(usage); process.exit(2); }
  }
  await startSiteServer(resolve(dir), Number(port), { records, ...(workspace ? { workspace } : {}), ...(defaultTheme ? { defaultTheme } : {}) });
}
