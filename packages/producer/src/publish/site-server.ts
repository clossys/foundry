/**
 * Static file server for a rendered preview site: clean URLs (`/a` → `/a/index.html`),
 * loopback only, confined to the site directory. Run as `node site-server.js <dir> <port>`.
 */
import { createServer, type Server } from "node:http";
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

export function startSiteServer(dir: string, port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
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
  const [dir, port] = process.argv.slice(2);
  if (!dir || !port || !/^\d+$/.test(port)) { console.error("usage: site-server <dir> <port>"); process.exit(2); }
  await startSiteServer(resolve(dir), Number(port));
}
