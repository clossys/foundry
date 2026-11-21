/**
 * `clossys preview <publication>` (system.md 12.5) on the int2 install-consumer fixture: the
 * `--once --json` view validates against schemas/preview.json, its routes are the routes Studio's
 * publisher preview lists for the same install output, each route serves Studio's bytes on the
 * port asked for, and `--with` swaps exactly one slot without writing under `clossys/`. The real
 * shadcn CLI runs against a loopback registry stub; the substrate's Vite build is a stub.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ShadcnRunner } from "@clossys/publisher/install";
import { runPreviewCli } from "../cli/preview.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { publication, servePreview } from "../server/publication.js";
import { withDesignerSlots } from "../specimen/__fixtures__/canonical-library.js";
import { PREVIEW_PORT, preparePreview, previewPort, startPreviewServer, type PreparedPreview } from "./serve.js";

const PACKAGE = join(import.meta.dirname, "..", "..");
const SCHEMA = JSON.parse(readFileSync(join(PACKAGE, "schemas", "preview.json"), "utf8")) as JsonSchema;
const fixtureSource = join(PACKAGE, "src", "publish", "__fixtures__", "install-consumer");
const temps: string[] = [];
let fixture: string, stub: Server, previous: string | undefined;
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); temps.push(dir); return dir; };
const consumerCopy = () => { const dir = temp("producer-preview-"); cpSync(fixture, dir, { recursive: true }); return dir; };
/** The substrate build's one output a served page needs: a stylesheet under dist/assets. */
const vite: ShadcnRunner = async (_args, { cwd }) => {
  mkdirSync(join(cwd, "dist", "assets"), { recursive: true });
  writeFileSync(join(cwd, "dist", "assets", "index-preview.css"), "h1 { color: rebeccapurple; }");
  return { code: 0, stdout: "", stderr: "" };
};
const deps = { vite };

/** Every file under `dir` with its sha256, for proving a tree unchanged. */
/** The consumer's records: every file under clossys/ but its state folder (where builds live). */
const records = (dir: string): Record<string, string> => Object.fromEntries(Object.entries(tree(dir)).filter(([path]) => path !== ".state" && !path.startsWith(`.state${sep}`)));

function tree(dir: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else rows[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir);
  return rows;
}

function fetchText(port: number, path: string, host = `127.0.0.1:${port}`) {
  return new Promise<{ status: number; text: string }>((done, fail) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { host } }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", chunk => { text += chunk; }); response.on("end", () => done({ status: response.statusCode!, text }));
    });
    req.on("error", fail); req.end();
  });
}

/** Studio's page bytes for one installed page, captured without a server. */
async function studioPage(root: string, path: string, installs: string): Promise<{ status: number; text: string }> {
  const chunks: Buffer[] = [];
  let status = 0;
  const sink = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }) as unknown as ServerResponse;
  Object.assign(sink, { headersSent: false, writeHead(code: number) { status = code; return sink; }, end(body?: Buffer) { if (body) chunks.push(Buffer.from(body)); return sink; } });
  await servePreview(root, path, "GET", sink, installs);
  return { status, text: Buffer.concat(chunks).toString("utf8") };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  await new Promise(done => probe.close(done));
  return typeof address === "object" && address ? address.port : 0;
}

beforeAll(async () => {
  fixture = temp("producer-preview-fixture-");
  cpSync(fixtureSource, fixture, { recursive: true });
  await withDesignerSlots(join(fixture, "clossys"));
  stub = createServer((req, response) => {
    if (req.url?.startsWith("/r/colors/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ inlineColors: { light: {}, dark: {} }, cssVars: { light: {}, dark: {} }, cssVarsV4: { light: {}, dark: {} }, inlineColorsTemplate: "", cssVarsTemplate: "" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>(done => stub.listen(0, "127.0.0.1", done));
  const address = stub.address();
  previous = process.env.REGISTRY_URL;
  process.env.REGISTRY_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/r`;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.REGISTRY_URL; else process.env.REGISTRY_URL = previous;
  await new Promise(done => stub.close(done));
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("clossys preview", () => {
  let root: string, view: any, exitCode: number, message: string;
  beforeAll(async () => {
    root = consumerCopy();
    const result = await runPreviewCli(["example-site", "--once", "--json", "--root", root, "--selection", join(root, "component-selection.ts")], root, deps);
    ({ exitCode, message } = result);
    view = result.output;
  }, 240_000);

  it("--once --json prints a clossys.preview/1 view that validates against schemas/preview.json", () => {
    expect(SCHEMA.$id).toBe("clossys.preview/1");
    expect(exitCode, message).toBe(0);
    expect(validateAgainst(SCHEMA, view)).toEqual([]);
    expect(view).toMatchObject({ schema: "clossys.preview/1", publication: "example-site", url: `http://127.0.0.1:${PREVIEW_PORT}/`, overrides: [], sample: [] });
    expect(view.buildId).toMatch(/^preview-[0-9a-f]{12}$/);
    expect(statSync(join(root, "clossys", ".state", "builds", view.buildId, "installs")).isDirectory()).toBe(true);
  });

  it("lists the routes Studio's publisher preview lists for the same build", async () => {
    const studio = await publication(root, "example-site", join(root, "clossys", ".state", "builds", view.buildId, "installs"));
    expect(studio.state).toBe("ready");
    if (studio.state !== "ready") return;
    expect(studio.pages.every(page => page.emitted)).toBe(true);
    expect(view.routes.map((route: { path: string; page: string }) => [route.path, route.page])).toEqual(studio.pages.map(page => [page.route, page.id]));
    expect(view.routes.map((route: { path: string }) => route.path)).toEqual(["/", "/about"]);
  });

  it("serves each route on the port asked for, with Studio's bytes, and refuses reserved ports", async () => {
    const prepared: PreparedPreview = await preparePreview({ root, publication: "example-site" });
    expect(prepared.buildId).toBe(view.buildId);
    const port = await freePort();
    const served = await startPreviewServer(prepared, port);
    try {
      expect(served.port).toBe(port);
      expect(served.url).toBe(`http://127.0.0.1:${port}/`);
      for (const route of prepared.routes) {
        const page = await fetchText(port, route.path);
        const studio = await studioPage(root, `/preview/example-site/pages/${route.page}.html`, prepared.installs);
        expect(page.status).toBe(200);
        expect(studio.status).toBe(200);
        expect(page.text).toBe(studio.text);
      }
      expect((await fetchText(port, "/")).text).toContain("Every word here comes from a Writer key.");
      const css = /href="([^"]+\.css)"/.exec((await fetchText(port, "/")).text)![1]!;
      expect((await fetchText(port, css)).text).toBe("h1 { color: rebeccapurple; }");
      expect((await fetchText(port, "/missing")).status).toBe(404);
      expect((await fetchText(port, "/", "attacker.example")).status).toBe(421);
    } finally { await served.close(); }
    expect(previewPort(undefined)).toBe(4600);
    for (const reserved of [4380, 4503]) {
      expect(() => previewPort(reserved)).toThrow(/reserved/);
      await expect(startPreviewServer(prepared, reserved)).rejects.toThrow(/reserved/);
      await expect(runPreviewCli(["example-site", "--once", "--root", root, "--port", String(reserved)], root, deps)).rejects.toThrow(/reserved/);
    }
  }, 120_000);

  it("--with swaps exactly one slot in the staged build and writes no record under clossys/ (the build is in clossys/.state/)", async () => {
    const before = records(join(root, "clossys"));
    const result = await runPreviewCli(["example-site", "--once", "--json", "--root", root, "--selection", join(root, "component-selection.ts"), "--with", "designer/sections.hero/simple-hero-v2.json"], root, deps);
    const swapped = result.output as any;
    expect(result.exitCode, result.message).toBe(0);
    expect(validateAgainst(SCHEMA, swapped)).toEqual([]);
    expect(records(join(root, "clossys"))).toEqual(before);
    const sha = createHash("sha256").update(readFileSync(join(root, "clossys", "agents", "designer", "sections.hero", "candidates", "simple-hero-v2.json"))).digest("hex");
    expect(swapped.overrides).toEqual([{ ref: "designer/sections.hero/simple-hero-v2.json", sha256: sha }]);
    expect(swapped.buildId).not.toBe(view.buildId);
    // The staged workspace differs from clossys/ in exactly that slot's pin.
    const staged = tree(join(root, "clossys", ".state", "builds", swapped.buildId, "root", "clossys"));
    const changed = Object.keys({ ...before, ...staged }).filter(file => before[file] !== staged[file]);
    expect(changed).toEqual([join("agents", "designer", "sections.hero", "pin.json")]);
    const pin = JSON.parse(readFileSync(join(root, "clossys", ".state", "builds", swapped.buildId, "root", "clossys", "agents", "designer", "sections.hero", "pin.json"), "utf8"));
    const original = JSON.parse(readFileSync(join(root, "clossys", "agents", "designer", "sections.hero", "pin.json"), "utf8"));
    expect(pin).toEqual({ ...original, candidate: "simple-hero-v2.json", sha256: sha });
    await expect(runPreviewCli(["example-site", "--once", "--root", root, "--with", "writer/strings.site/site-v1.md", "--with", "writer/strings.site/site-v2.md"], root, deps)).rejects.toThrow(/twice/);
    await expect(runPreviewCli(["example-site", "--once", "--root", root, "--with", "writer/strings.site/missing-v9.md"], root, deps)).rejects.toThrow(/no candidate/);
  }, 240_000);
});
