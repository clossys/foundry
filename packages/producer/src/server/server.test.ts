import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { readIa } from "../records/slots.js";
import { agentRoot } from "./cells.js";
import { startProducerServer, type ProducerServer } from "./index.js";
import { writeFixtureNames } from "./__fixtures__/writer-names.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const childEntry = join(here, "__fixtures__/studio-child.mjs");
let root: string;
let server: ProducerServer | undefined;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "producer-server-"))); await mkdir(join(root, "clossys")); });
afterEach(async () => { await server?.close(); server = undefined; await rm(root, { recursive: true, force: true }); });
async function launch() { server = await startProducerServer({ root, port: 0, studioEntry: childEntry, handleSignals: false }); return server; }
async function request(path: string, options: { method?: string; headers?: Record<string, string | string[]> } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: any }>((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: server!.port, path, method: options.method ?? "GET", headers: options.headers }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", data => { text += data; });
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: JSON.parse(text) }));
    }); req.on("error", reject); req.end();
  });
}
/** The repository's flat Director IA plus one pinned slot (`agents/director/<slot-id>/...`). */
async function director(): Promise<string> {
  const source = join(repoConsumer, "agents", "director"), target = agentRoot(root, "director");
  await mkdir(target, { recursive: true }); await cp(join(source, "ia.json"), join(target, "ia.json"));
  for (const id of (await readdir(source)).sort()) {
    if (!await stat(join(source, id, "pin.json")).then(() => true, () => false)) continue;
    await cp(join(source, id), join(target, id), { recursive: true }); return id;
  }
  throw new Error("No pinned Director slot");
}

/**
 * A Designer slot model with no pins: /api/config then reads the consumer's (empty) pinned
 * selection instead of compiling the whole Foundry default fill (about 38 s measured
 * 2026-11-06), which the guard and proxy tests below do not exercise.
 */
async function designerModel(): Promise<void> {
  await mkdir(agentRoot(root, "designer"), { recursive: true });
  await cp(join(repoConsumer, "agents", "designer", "ia.json"), join(agentRoot(root, "designer"), "ia.json"));
}

describe("loopback Producer", () => {
  it("serves health and the flat Director slot model over /api/slots", async () => {
    // The gallery labels its slots by their Writer names, which have no fallback.
    const id = await director(); writeFixtureNames(root); await launch();
    expect((await request("/api/health")).body).toEqual({ ok: true, studio: "ready" });
    const gallery = await request("/api/slots/director");
    expect(gallery.status).toBe(200); expect(gallery.body.state).toBe("ready");
    const detail = await request(`/api/slots/director/${id}`);
    expect(detail.status).toBe(200); expect(detail.body).toMatchObject({ state: "ready" });
    expect((await request("/api/slots/unknown/example.page")).status).toBe(404);
    expect((await request("/api/cells")).status).toBe(404);
  });

  it("guards every local route, mutations, ambiguous headers and traversal before proxying", async () => {
    await designerModel(); await launch();
    for (const path of ["/api/health", "/api/config", "/api/events", "/studio"]) {
      for (const host of ["example.test", "localhost", `127.0.0.1:${server!.port + 1}`, `LOCALHOST:${server!.port}`]) expect((await request(path, { headers: { Host: host } })).status).toBe(403);
    }
    expect((await request("/api/config", { headers: { Origin: "https://example.test" } })).status).toBe(403);
    const token = (await request("/api/config")).body.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const origin = server!.url;
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "TRACE"]) {
      expect((await request("/studio", { method })).status).toBe(403);
      expect((await request("/studio", { method, headers: { Origin: origin } })).status).toBe(403);
      expect((await request("/studio", { method, headers: { Origin: origin, "X-Clossys-Token": "wrong" } })).status).toBe(403);
      expect((await request("/studio", { method, headers: { Origin: "http://localhost:1", "X-Clossys-Token": token } })).status).toBe(403);
    }
    expect((await request("/studio", { method: "POST", headers: { Origin: [origin, origin], "X-Clossys-Token": token } })).status).toBe(403);
    expect((await request("/studio", { method: "POST", headers: { Origin: origin, "X-Clossys-Token": [token, token] } })).status).toBe(403);
    const accepted = await request("/studio", { method: "POST", headers: { Origin: origin, "X-Clossys-Token": token } });
    expect(accepted.status).toBe(200); expect(accepted.body.method).toBe("POST"); expect(accepted.body.headers["x-clossys-token"]).toBeUndefined();
    for (const path of ["/api/slots/writer/%2e%2e", "/api/slots/unknown/example.page", "/api/slots/writer/%2fetc", "/%5cexample.test", "/api/slots/writer/..%2fdirector"]) expect((await request(path)).status).toBeOneOf([400, 404]);
    expect((await request(`/studio?token=${token}`)).status).toBe(400);
    const encodedToken = [...token].map(letter => `%${letter.charCodeAt(0).toString(16)}`).join("");
    expect((await request(`/studio?token=${encodedToken}`)).status).toBe(400);
  }, 60_000);

  it("reverse proxies the real child, strips hop headers and isolates the token per run", async () => {
    await designerModel(); await launch();
    const firstToken = (await request("/api/config")).body.token;
    const result = await request("/nested/path?hello=world", { headers: { "X-Forwarded-Host": "example.test", Connection: "x-custom", "X-Custom": "hidden", "X-Clossys-Token": firstToken } });
    expect(result.body).toMatchObject({ studio: true, path: "/nested/path?hello=world", origin: server!.url });
    expect(result.body.headers["x-forwarded-host"]).toBeUndefined(); expect(result.body.headers["x-custom"]).toBeUndefined(); expect(result.body.headers["x-clossys-token"]).toBeUndefined();
    await server!.close(); await launch(); expect((await request("/api/config")).body.token).not.toBe(firstToken);
  }, 20_000);

  it("watches actual files even when agents is initially absent and closes SSE deterministically", async () => {
    await launch();
    const req = httpRequest({ hostname: "127.0.0.1", port: server!.port, path: "/api/events" });
    req.end(); const [response] = await once(req, "response");
    response.setEncoding("utf8"); let received = "";
    const ready = new Promise<void>(resolve => response.on("data", (part: string) => { received += part; if (received.includes("event: ready")) resolve(); }));
    await ready;
    const change = new Promise<void>(resolve => response.on("data", () => { if (received.includes('"id":"identity.purpose.promise"')) resolve(); }));
    const slot = join(agentRoot(root, "director"), "identity.purpose.promise");
    await mkdir(slot, { recursive: true }); await writeFile(join(slot, "slot.json"), "{}\n");
    // Creation can race a recursive watcher's new-directory subscription; writing
    // an existing file exercises the permanent watched slot boundary too.
    await writeFile(join(slot, "slot.json"), await readFile(join(slot, "slot.json"), "utf8"));
    await change; expect(received).toContain("event: change"); expect(received).toContain('"agent":"director"');
    const ended = once(response, "end"); await server!.close(); await ended; await server!.closed; req.destroy();
  });

  it("refuses aliases without reading outside the consumer root", async () => {
    await director();
    await symlink(agentRoot(root, "director"), agentRoot(root, "writer"));
    expect(() => readIa(join(root, "clossys"), "writer")).toThrow();
  });

  it("reports a missing standalone build and a failed child without a fake UI", async () => {
    await expect(startProducerServer({ root, port: 0, studioEntry: join(root, "missing.js"), handleSignals: false })).rejects.toThrow("Studio build dependency");
    const failed = join(root, "failed.mjs"); await writeFile(failed, "process.exit(1);\n");
    await expect(startProducerServer({ root, port: 0, studioEntry: failed, handleSignals: false })).rejects.toThrow("Studio child failed");
  });

  it("shuts down the listener and watcher when the real child exits unexpectedly", async () => {
    await launch();
    expect((await request("/fixture-exit")).status).toBe(200);
    await server!.closed;
    expect(server!.failure).toBe("Studio child stopped unexpectedly");
    await expect(request("/api/health")).rejects.toThrow();
    await server!.close();
  });

  it("runs the installed CLI with initial compile gaps, honors no-open, and stops on SIGTERM", async () => {
    const runtime = join(root, "runtime");
    await cp(join(repo, "packages/producer/dist"), join(runtime, "dist"), { recursive: true });
    await cp(join(repo, "packages/producer/pipeline"), join(runtime, "pipeline"), { recursive: true });
    await writeFile(join(runtime, "package.json"), '{"type":"module"}\n');
    await symlink(join(repo, "node_modules"), join(runtime, "node_modules"));
    await mkdir(join(runtime, "dist/studio/standalone/apps/studio"), { recursive: true });
    await cp(childEntry, join(runtime, "dist/studio/standalone/apps/studio/server.js"));
    await writeFile(join(runtime, "dist/studio/manifest.json"), JSON.stringify({ schemaVersion: 1, serverEntry: "standalone/apps/studio/server.js", staticDir: "standalone/apps/studio/.next/static", publicDir: null }));
    await writeFile(join(root, "clossys/clossys.config.ts"), "export default {};\n");
    // Without a Designer slot model /api/config compiles the whole Foundry default fill
    // (226 s measured 2026-11-12 at load 6-17, 37.8 s on 2026-11-06), which this CLI
    // lifecycle test does not exercise; the pinless model keeps every compile input a gap.
    await designerModel();
    const bin = join(root, "bin"); await mkdir(bin);
    const opened = join(root, "browser-opened");
    // A browser launch would invoke this marker program, even without a desktop.
    await writeFile(join(bin, "xdg-open"), `#!/bin/sh\ntouch '${opened}'\n`, { mode: 0o755 });
    const cli = spawn(process.execPath, [join(runtime, "dist/cli/index.js"), "produce", "--port", "0", "--no-open"], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    cli.stderr.setEncoding("utf8"); cli.stderr.on("data", part => { stderr += part; });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        cli.stdout.setEncoding("utf8"); cli.stdout.on("data", part => { stdout += part; const match = /Producer Studio: (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout); if (match) resolve(match[1]!); });
        cli.once("error", reject); cli.once("exit", code => reject(new Error(`CLI exited before readiness: ${code}; ${stderr}`)));
      });
      const config = await (await fetch(`${url}/api/config`)).json() as any;
      expect(config).toMatchObject({ readOnly: true }); expect(config.compilation).toBeUndefined();
      expect((await fetch(`${url}/api/cells`)).status).toBe(404);
      const exited = once(cli, "exit"); cli.kill("SIGTERM");
      expect((await exited)[0]).toBe(0); expect(stderr).toBe("");
      expect(stdout).toContain("Producer stopped; director: missing, designer: slot model, writer: missing, publisher: missing");
      expect(stdout).not.toContain(config.token); expect(stdout).not.toContain("token=");
      await expect(stat(opened)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fetch(`${url}/api/health`)).rejects.toThrow();
      await writeFile(join(runtime, "dist/studio/manifest.json"), JSON.stringify({ schemaVersion: 1, serverEntry: "../outside.js" }));
      const invalid = spawnSync(process.execPath, [join(runtime, "dist/cli/index.js"), "produce", "--no-open", "--json"], { cwd: root, encoding: "utf8" });
      expect(invalid.status).toBe(2); expect(JSON.parse(invalid.stdout).message).toContain("Studio manifest serverEntry must remain under dist/studio");
    } finally { if (cli.exitCode === null) { const exited = once(cli, "exit"); cli.kill("SIGKILL"); await exited; } }
  }, 20_000);
});

describe("produce --once over the slot model", () => {
  it("reports each agent's flat slot model and exits 0 when one exists", async () => {
    for (const agent of ["designer", "writer"] as const) { await mkdir(agentRoot(root, agent), { recursive: true }); await cp(join(repoConsumer, "agents", agent, "ia.json"), join(agentRoot(root, agent), "ia.json")); }
    await writeFile(join(root, "clossys/clossys.config.ts"), "export default {};\n");
    const cli = spawnSync(process.execPath, [join(repo, "packages/producer/dist/cli/index.js"), "produce", "--once", "--no-open", "--json"], { cwd: root, encoding: "utf8" });
    expect(cli.status).toBe(0); expect(JSON.parse(cli.stdout)).toMatchObject({ exitCode: 0, verb: "produce", message: "director: missing, designer: slot model, writer: slot model, publisher: missing" });
    expect(cli.stderr).toBe("");
  });
  it("exits 2 when no agent has a slot model, without creating records", async () => {
    await writeFile(join(root, "clossys/clossys.config.ts"), "export default {};\n");
    const cli = spawnSync(process.execPath, [join(repo, "packages/producer/dist/cli/index.js"), "produce", "--once", "--json"], { cwd: root, encoding: "utf8" });
    expect(cli.status).toBe(2); expect(JSON.parse(cli.stdout)).toMatchObject({ exitCode: 2, message: "director: missing, designer: missing, writer: missing, publisher: missing" });
    expect(await readdir(join(root, "clossys"))).toEqual(["clossys.config.ts"]);
  });
});
