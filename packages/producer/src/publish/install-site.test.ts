/**
 * `clossys publish --install --site <pack id>` on the fixture consumer: its content map routes
 * `/` and `/about`, its route pack fills both with the pinned hero, and each route's Publisher
 * page cell binds its copy. The real shadcn CLI runs against a loopback registry stub; the
 * Vite build is a stub runner so no bundler runs here.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { parseArgs } from "../cli/args.js";
import { publishSite } from "./install-site.js";
import { migrateFixtureLibrary } from "../specimen/__fixtures__/canonical-library.js";
import { contentMapToCells } from "@clossys/publisher/content-map/cells";
import { planMigration, writePlan } from "../migrate/slots.js";
import { listSlots } from "../records/slots.js";

const fixtureSource = join(import.meta.dirname, "__fixtures__", "install-consumer");
let fixture: string;
const base = join("clossys", "agents", "publisher");
const temps: string[] = [];
let stub: Server, previous: string | undefined;
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); temps.push(dir); return dir; };

/** Migrate neutral authored inputs with the native writer; pins exist only in this temp fixture. */
async function nativeFixture(removeLegacy = true): Promise<string> {
  const consumer = temp("producer-site-native-");
  cpSync(fixture, consumer, { recursive: true });
  const publisher = join(consumer, base);
  const map = JSON.parse(readFileSync(join(publisher, "content-map", "example-site.json"), "utf8"));
  const pack = JSON.parse(readFileSync(join(publisher, "route-pack", "example-site.json"), "utf8"));
  rmSync(publisher, { recursive: true });
  await contentMapToCells(map, publisher, { date: "2026-10-31", routePack: pack });
  for (const id of ["home", "about"]) {
    const path = join(publisher, "cells", `page.${id}`, "v1.md");
    const copy = id === "home"
      ? "- frame.title = name: writer:site.studio\n- hero.heading = heading: writer:home.hero\n- hero.body = body: writer:home.hero\n"
      : "- frame.title = name: writer:site.studio\n- hero.heading = heading: writer:site.studio\n";
    writeFileSync(path, readFileSync(path, "utf8").replace("## Copy\n", `## Copy\n${copy}`));
  }
  const plan = await planMigration(join(consumer, "clossys"));
  writePlan({ ...plan, files: new Map([...plan.files].filter(([path]) => path.startsWith("agents/publisher/"))) });
  if (removeLegacy) for (const name of ["tree.json", "cells", "content-map", "route-pack", "compile.json"]) {
    rmSync(join(publisher, name), { recursive: true, force: true });
  }
  return consumer;
}

beforeAll(async () => {
  fixture = temp("producer-install-site-fixture-");
  cpSync(fixtureSource, fixture, { recursive: true });
  await migrateFixtureLibrary(join(fixture, "clossys"));
  stub = createServer((request, response) => {
    if (request.url?.startsWith("/r/colors/")) {
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

describe("clossys publish --install --site", () => {
  it("parses --site and --build, and refuses them without --install or with --page", () => {
    expect(parseArgs(["publish", "--install", "--site", "example-site", "--build"])).toMatchObject({ site: "example-site", build: true });
    expect(() => parseArgs(["publish", "--site", "example-site"])).toThrow("--page and --site require --install");
    expect(() => parseArgs(["publish", "--install", "--site", "a", "--page", "b"])).toThrow("not both");
    expect(() => parseArgs(["publish", "--install", "--page", "home", "--build"])).toThrow("--build and --origin require --site");
    expect(parseArgs(["publish", "--install", "--site", "s", "--origin", "https://example.test"]).origin).toBe("https://example.test");
  });

  it("builds real HTML and Writer text from a migrated native site without legacy Publisher stores", async () => {
    const consumer = await nativeFixture();
    const out = join(temp("producer-site-"), "out");
    const calls: string[][] = [];
    const result = await publishSite({ root: consumer, site: "example-site", out, build: true, origin: "https://example.test", selection: { module: join(consumer, "component-selection.ts") }, vite: async (args, { cwd }) => { calls.push([...args, cwd]); return { code: 0, stdout: "", stderr: "" }; } });
    expect(result.findings.filter(row => row.severity !== "info")).toEqual([]);
    const map = JSON.parse(readFileSync(join(fixture, base, "content-map", "example-site.json"), "utf8"));
    const paths = map.entries.filter((entry: { kind: string }) => entry.kind === "page").map((entry: { path: string }) => entry.path);
    const table = JSON.parse(readFileSync(join(result.substrate, "clossys", "site.json"), "utf8"));
    expect(table.routes.map((route: { path: string }) => route.path)).toEqual(paths);
    expect(Object.keys(result.html)).toEqual(paths);
    expect(table.routes.map((route: { title?: string }) => route.title)).toEqual(["About Example Studio", "Read straight from the page cell"]);
    // One shared substrate: the hero is installed once and mounted by both routes.
    expect(result.installed.map(row => row.slot).sort()).toEqual(["frames.plain", "sections.hero"]);
    for (const id of ["home", "about"]) expect(existsSync(join(result.substrate, "clossys", "pages", `${id}.tsx`))).toBe(true);
    expect(readFileSync(join(out, "site", "index.html"), "utf8")).toContain("Pages assembled from records");
    const about = readFileSync(join(out, "site", "about", "index.html"), "utf8");
    expect(readFileSync(result.html["/"]!, "utf8")).toContain("Every word here comes from a Writer key.");
    for (const text of ["About Example Studio", "Read straight from the page cell"]) expect(about).toContain(text);
    expect(readFileSync(join(result.substrate, "main.tsx"), "utf8")).toContain("location.pathname");
    expect(calls).toEqual([["build", result.substrate]]);
    expect(result.dist).toBe(join(result.substrate, "dist"));
    // The resolved route list Studio reads, and a sitemap under the target origin only.
    const routes = JSON.parse(readFileSync(join(out, "site-routes.json"), "utf8"));
    expect(routes.routes.map((route: { path: string; id: string; frame: string; sections: string[] }) => [route.path, route.id, route.frame, route.sections])).toEqual([["/", "home", "frames.plain", ["sections.hero"]], ["/about", "about", "frames.plain", ["sections.hero"]]]);
    expect(routes.origin).toBe("https://example.test");
    expect(readFileSync(join(result.substrate, "public", "sitemap.xml"), "utf8")).toContain("<loc>https://example.test/about</loc>");
    expect(readFileSync(join(result.substrate, "vite.config.ts"), "utf8")).not.toMatch(/localhost|example\.test|clossys\.com/);
  }, 180_000);

  it.each(["missing pin", "hash drift"])("refuses native %s even with legacy outputs present", async problem => {
    const consumer = await nativeFixture(false);
    const publication = listSlots(join(consumer, "clossys"), "publisher").find(slot => slot.id === "publication.example-site")!;
    if (problem === "missing pin") rmSync(join(publication.dir, "pin.json"));
    else {
      const path = join(publication.dir, "candidates", publication.pin!.candidate);
      writeFileSync(path, readFileSync(path, "utf8") + "\n");
    }
    const out = join(temp("producer-site-refused-"), "out");
    await expect(publishSite({ root: consumer, site: "example-site", out })).rejects.toThrow(problem === "hash drift" ? /hash drift/ : /Missing native record/);
    expect(existsSync(out)).toBe(false);
  });

  it("requires the exact native publication id without falling back to an available site", async () => {
    const consumer = await nativeFixture();
    await expect(publishSite({ root: consumer, site: "missing-site" })).rejects.toThrow(/Slot is not declared/);
  });

  it("refuses legacy publication outputs once another agent has an IA", async () => {
    await expect(publishSite({ root: fixture, site: "example-site" })).rejects.toThrow(/Missing native record/);
  });

  it("exits 1 before installing when the route pack and content map disagree", async () => {
    const consumer = temp("producer-site-consumer-");
    cpSync(fixture, consumer, { recursive: true });
    // Exercise the legacy JSON branch: no agent has opted into the native model.
    rmSync(join(consumer, "clossys", "agents", "designer", "ia.json"));
    const packPath = join(consumer, base, "route-pack", "example-site.json");
    const pack = JSON.parse(readFileSync(packPath, "utf8"));
    writeFileSync(packPath, JSON.stringify({ ...pack, routes: pack.routes.slice(0, 1) }));
    const out = join(temp("producer-site-out-"), "out");
    const result = await runCli(["publish", "--install", "--site", "example-site", "--root", consumer, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("site-route-missing: about (/about)");
    expect(existsSync(join(out, "substrate"))).toBe(false);
  }, 30_000);
});
