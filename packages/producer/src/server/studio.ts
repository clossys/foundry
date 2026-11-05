import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, readFile, realpath } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isAbsent } from "../errors.js";

export interface StudioChild { port: number; process: ChildProcess; stop: () => Promise<void> }
export async function studioEntry(explicit?: string): Promise<string> {
  const base = fileURLToPath(new URL("../studio/", import.meta.url));
  if (!explicit) {
    let source: string | undefined;
    try { source = await readFile(join(base, "manifest.json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (source !== undefined) {
      const manifest = JSON.parse(source);
      const entry = manifest.serverEntry;
      if (manifest.schemaVersion !== 1 || typeof entry !== "string" || !entry || isAbsolute(entry) || entry.includes("\\") || entry.split("/").includes("..")) {
        throw new Error("Studio manifest serverEntry must remain under dist/studio");
      }
      const target = await realpath(resolve(base, entry));
      const rel = relative(await realpath(base), target);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Studio manifest serverEntry must remain under dist/studio");
      return target;
    }
  }
  for (const path of explicit ? [explicit] : [join(base, "server.js"), join(base, "packages/producer/studio/server.js")]) {
    // An absent layout tries the other one; any other access failure surfaces.
    try { await access(path); return path; } catch (error) { if (!isAbsent(error)) throw error; }
  }
  throw new Error("Studio build dependency is missing: build the Next standalone application into dist/studio before running produce");
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
function responds(port: number): Promise<boolean> {
  return new Promise(resolve => {
    // Dynamic root rendering can compile the consumer selection. Probe the shipped
    // static asset so readiness does not start and abort that work repeatedly.
    const request = get({ hostname: "127.0.0.1", port, path: "/studio-mark.svg", timeout: 250 }, response => { response.resume(); resolve(true); });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

export async function startStudio(entry: string, origin: string, signal: AbortSignal, timeoutMs = 20_000): Promise<StudioChild> {
  const port = await availablePort();
  if (signal.aborted) throw new Error("Producer startup cancelled");
  const child = spawn(process.execPath, [entry], {
    cwd: dirname(entry), stdio: "ignore",
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", CLOSSYS_PRODUCER_ORIGIN: origin },
  });
  let failure = false;
  child.once("error", () => { failure = true; });
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => stopped ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    const exited = once(child, "exit").then(() => undefined);
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 1000); force.unref();
    try { await exited; } finally { clearTimeout(force); }
  })();
  const abort = () => { void stop(); };
  signal.addEventListener("abort", abort, { once: true });
  child.once("exit", () => signal.removeEventListener("abort", abort));
  const deadline = Date.now() + timeoutMs;
  try {
    while (!signal.aborted && Date.now() < deadline) {
      if (failure || child.exitCode !== null || child.signalCode !== null) throw new Error("Studio child failed during startup");
      if (await responds(port)) return { port, process: child, stop };
      await delay(40);
    }
    throw new Error(signal.aborted ? "Producer startup cancelled" : "Studio child did not become ready before the startup deadline");
  } catch (error) { signal.removeEventListener("abort", abort); await stop(); throw error; }
}

/** The Studio app source Producer builds and serves; Publisher installs Studio's own routes into it. */
export const STUDIO_APP = fileURLToPath(new URL("../../studio/app/", import.meta.url));

/**
 * One served Studio route's HTML, as the child renders it for a GET; undefined unless it answers 200.
 * A page with group tabs lands on its first tab (a same-origin redirect), so the render follows
 * up to `MAX_ROUTE_REDIRECTS` redirects to a path on the same child; any other redirect is undefined.
 */
export const MAX_ROUTE_REDIRECTS = 3;
export function renderStudioRoute(port: number, path: string, timeoutMs = 20_000, redirects = MAX_ROUTE_REDIRECTS): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const origin = `http://127.0.0.1:${port}`;
    const request = get({ hostname: "127.0.0.1", port, path, timeout: timeoutMs, headers: { Accept: "text/html", Host: `127.0.0.1:${port}` } }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && redirects > 0 && response.headers.location) {
        response.resume();
        let next: URL;
        try { next = new URL(response.headers.location, origin + path); }
        catch (error) { reject(new Error(`Studio route ${path} redirected to an unparsable location: ${error instanceof Error ? error.message : String(error)}`)); return; }
        resolve(next.origin === origin ? renderStudioRoute(port, next.pathname + next.search, timeoutMs, redirects - 1) : undefined);
        return;
      }
      if (status !== 200 || !String(response.headers["content-type"] ?? "").startsWith("text/html")) { response.resume(); resolve(undefined); return; }
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", () => resolve(undefined));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(undefined));
  });
}
