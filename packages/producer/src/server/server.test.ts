import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentModule, agentRoot, compileCells, inventory } from "./cells.js";
import { startProducerServer, type ProducerServer } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const childEntry = join(here, "__fixtures__/studio-child.mjs");
let root: string;
let server: ProducerServer | undefined;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "producer-server-")); await mkdir(join(root, "clossys")); });
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
async function directorDraft(id = "identity.purpose.promise", version = 1) {
  const cellRoot = agentRoot(root, "director");
  await mkdir(join(cellRoot, "cells", id), { recursive: true });
  await writeFile(join(cellRoot, "tree.json"), JSON.stringify({ schemaVersion: 1, active: {}, tree: [{ id: "identity", name: "Identity", children: [{ id: "purpose", name: "Purpose", cells: [id] }] }], meta: { archetype: "service" } }));
  await writeFile(join(cellRoot, "cells", id, `v${version}.md`), `---\nid: ${id}\nversion: ${version}\nstatus: draft\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\n---\n\n## Direction\n- A useful direction.\n\n## Because\n- A stated reason.\n\n## Watch\n- A measurable signal.\n`);
}

describe("loopback Producer", () => {
  it("serves health, structured missing agents and latest real Director drafts with tree metadata", async () => {
    await directorDraft(); await directorDraft("identity.purpose.promise", 2); await launch();
    expect((await request("/api/health")).body).toEqual({ ok: true, studio: "ready" });
    const result = await request("/api/cells");
    expect(result.status).toBe(200);
    expect(result.body.agents[0]).toMatchObject({ agent: "director", state: "ready", packageName: "@clossys/strategist", tree: { meta: { archetype: "service" } }, cells: [{ id: "identity.purpose.promise", version: 2, status: "draft" }] });
    expect(result.body.agents.slice(1).every((agent: any) => agent.state === "missing" && agent.cells.length === 0)).toBe(true);
    expect((await request("/api/cells/director/identity.purpose.promise")).body.cell.source).toContain("version: 2");
    expect((await request("/api/cells/director/identity.purpose.promise?version=1")).body.cell.version).toBe(1);
    expect((await request("/api/cells/writer/example.page")).status).toBe(404);
  });

  it("guards every local route, mutations, ambiguous headers and traversal before proxying", async () => {
    await launch();
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
    for (const path of ["/api/cells/writer/%2e%2e", "/api/cells/unknown/example.page", "/api/cells/writer/%2fetc", "/%5cexample.test", "/api/cells/writer/example.page?version=0"]) expect((await request(path)).status).toBeOneOf([400, 404]);
    expect((await request(`/studio?token=${token}`)).status).toBe(400);
    const encodedToken = [...token].map(letter => `%${letter.charCodeAt(0).toString(16)}`).join("");
    expect((await request(`/studio?token=${encodedToken}`)).status).toBe(400);
  });

  it("reverse proxies the real child, strips hop headers and isolates the token per run", async () => {
    await launch();
    const firstToken = (await request("/api/config")).body.token;
    const result = await request("/nested/path?hello=world", { headers: { "X-Forwarded-Host": "example.test", Connection: "x-custom", "X-Custom": "hidden", "X-Clossys-Token": firstToken } });
    expect(result.body).toMatchObject({ studio: true, path: "/nested/path?hello=world", origin: server!.url });
    expect(result.body.headers["x-forwarded-host"]).toBeUndefined(); expect(result.body.headers["x-custom"]).toBeUndefined(); expect(result.body.headers["x-clossys-token"]).toBeUndefined();
    await server!.close(); await launch(); expect((await request("/api/config")).body.token).not.toBe(firstToken);
  });

  it("watches actual files even when agents is initially absent and closes SSE deterministically", async () => {
    await launch();
    const req = httpRequest({ hostname: "127.0.0.1", port: server!.port, path: "/api/events" });
    req.end(); const [response] = await once(req, "response");
    response.setEncoding("utf8"); let received = "";
    const ready = new Promise<void>(resolve => response.on("data", (part: string) => { received += part; if (received.includes("event: ready")) resolve(); }));
    await ready;
    const change = new Promise<void>(resolve => response.on("data", () => { if (received.includes('"id":"identity.purpose.promise"')) resolve(); }));
    await directorDraft();
    // Creation can race a recursive watcher's new-directory subscription; writing
    // an existing file exercises the permanent watched cell boundary too.
    const cell = join(agentRoot(root, "director"), "cells/identity.purpose.promise/v1.md");
    await writeFile(cell, await readFile(cell, "utf8"));
    await change; expect(received).toContain("event: change"); expect(received).toContain('"agent":"director"');
    const ended = once(response, "end"); await server!.close(); await ended; await server!.closed; req.destroy();
  });

  it("refuses aliases without reading outside the consumer root", async () => {
    await directorDraft();
    await symlink(agentRoot(root, "director"), agentRoot(root, "writer"));
    expect(await inventory(root, "writer")).toMatchObject({ state: "error", cells: [] });
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
    await writeFile(join(runtime, "package.json"), '{"type":"module"}\n');
    await symlink(join(repo, "node_modules"), join(runtime, "node_modules"));
    await mkdir(join(runtime, "dist/studio/standalone/apps/studio"), { recursive: true });
    await cp(childEntry, join(runtime, "dist/studio/standalone/apps/studio/server.js"));
    await writeFile(join(runtime, "dist/studio/manifest.json"), JSON.stringify({ schemaVersion: 1, serverEntry: "standalone/apps/studio/server.js", staticDir: "standalone/apps/studio/.next/static", publicDir: null }));
    await writeFile(join(root, "clossys/clossys.config.ts"), "export default {};\n");
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
      expect(config.compilation).toEqual([{ agent: "designer", state: "missing" }, { agent: "writer", state: "missing" }]);
      expect((await (await fetch(`${url}/api/cells`)).json() as any).agents.every((agent: any) => agent.state === "missing")).toBe(true);
      const exited = once(cli, "exit"); cli.kill("SIGTERM");
      expect((await exited)[0]).toBe(0); expect(stderr).toBe("");
      expect(stdout).toContain("Producer stopped; designer: missing, writer: missing");
      expect(stdout).not.toContain(config.token); expect(stdout).not.toContain("token=");
      await expect(stat(opened)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fetch(`${url}/api/health`)).rejects.toThrow();
      await writeFile(join(runtime, "dist/studio/manifest.json"), JSON.stringify({ schemaVersion: 1, serverEntry: "../outside.js" }));
      const invalid = spawnSync(process.execPath, [join(runtime, "dist/cli/index.js"), "produce", "--no-open", "--json"], { cwd: root, encoding: "utf8" });
      expect(invalid.status).toBe(2); expect(JSON.parse(invalid.stdout).message).toContain("Studio manifest serverEntry must remain under dist/studio");
    } finally { if (cli.exitCode === null) { const exited = once(cli, "exit"); cli.kill("SIGKILL"); await exited; } }
  });
});

describe("real agent projections", () => {
  it("compiles Designer and Writer cells into agent-local outputs through their shipped APIs", async () => {
    await cp(join(repo, "packages/designer/src/library-cli/__fixtures__/agent-receipted-cells/clossys/agents/designer"), agentRoot(root, "designer"), { recursive: true });
    const writer = await agentModule("writer", "cells/migrate.js");
    await writer.migrateWriterCells(join(repo, "packages/writer/src/cells/__fixtures__/generic-admin"), agentRoot(root, "writer"), { date: "2026-10-29" });
    expect(await compileCells(root)).toMatchObject([{ agent: "designer", state: "compiled" }, { agent: "writer", state: "compiled" }]);
    expect(await inventory(root, "designer")).toMatchObject({ state: "ready" });
    expect(await inventory(root, "writer")).toMatchObject({ state: "ready" });
    expect(await compileCells(root, true)).toMatchObject([{ state: "compiled" }, { state: "compiled" }]);
    expect(JSON.parse(await readFile(join(agentRoot(root, "writer"), "compiled/example-common.r1.en.json"), "utf8")).records[0].text).toBe("Cancel");
    await writeFile(join(root, "clossys/clossys.config.ts"), "export default {};\n");
    const cli = spawnSync(process.execPath, [join(repo, "packages/producer/dist/cli/index.js"), "produce", "--once", "--no-open", "--json"], { cwd: root, encoding: "utf8" });
    expect(cli.status).toBe(0); expect(JSON.parse(cli.stdout)).toMatchObject({ exitCode: 0, verb: "produce", message: "designer: compiled, writer: compiled" });
    expect(cli.stderr).toBe("");
  });
  it("reports required missing compile inputs as exit 2 without creating records", async () => {
    await writeFile(join(root, "clossys/clossys.config.ts"), "export default {};\n");
    const cli = spawnSync(process.execPath, [join(repo, "packages/producer/dist/cli/index.js"), "produce", "--once", "--json"], { cwd: root, encoding: "utf8" });
    expect(cli.status).toBe(2); expect(JSON.parse(cli.stdout)).toMatchObject({ exitCode: 2, message: "designer: missing, writer: missing" });
  });
});
