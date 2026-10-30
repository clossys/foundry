import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { contentMapFromCells, contentMapToCells, compileContentMaps, routePackToCells } from "./cells.js";
import { checkContentMap, projectBreadcrumbs, projectCommands, projectNavigation, projectOutline, projectRoutes, projectSitemap, projectToc } from "./index.js";
import type { ContentMap } from "./index.js";
import { adminContentMap, adminRouteOptions } from "./__fixtures__/admin.js";

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "publisher-cells-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
async function treeAt(path: string): Promise<any> { return JSON.parse(await readFile(join(path, "tree.json"), "utf8")); }
async function writeTree(path: string, tree: unknown) { await writeFile(join(path, "tree.json"), json(tree)); }
async function cellBytes(path: string) {
  const result: Record<string, string> = {};
  for (const id of (await readdir(join(path, "cells"))).sort()) {
    for (const version of (await readdir(join(path, "cells", id))).sort()) {
      result[`${id}/${version}`] = await readFile(join(path, "cells", id, version), "utf8");
    }
  }
  return result;
}

it("keeps pure content-map projections browser-bundleable while authoring is a Node-only public subpath", async () => {
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const bundled = await build({
    absWorkingDir: cwd, stdin: { contents: 'import * as map from "@clossys/publisher/content-map"; export { map };', resolveDir: cwd },
    bundle: true, write: false, platform: "browser", format: "esm", metafile: true,
  });
  expect(Object.keys(bundled.metafile!.inputs).some(path => /(?:content-map\/cells|cell-format\/store)\./.test(path))).toBe(false);
  expect(bundled.outputFiles[0]!.text).not.toMatch(/(?:node:fs|node:path)/);
  await expect(build({
    absWorkingDir: cwd, stdin: { contents: 'import { compileContentMaps } from "@clossys/publisher/content-map/cells"; export { compileContentMaps };', resolveDir: cwd },
    bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent",
  })).rejects.toThrow();
  const node = await import("@clossys/publisher/content-map/cells");
  expect(node.compileContentMaps).toBeTypeOf("function");
  expect(node.contentMapFromCells).toBeTypeOf("function");
  expect(node.contentMapToCells).toBeTypeOf("function");
});
function findGroup(nodes: any[], id: string): any {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findGroup(node.children ?? [], id);
    if (child) return child;
  }
}
function projections(map: ContentMap) {
  return {
    routes: projectRoutes(map, adminRouteOptions()),
    navigation: projectNavigation(map, "designer"),
    commands: projectCommands(map),
    breadcrumbs: projectBreadcrumbs(map, "designer"),
    outline: projectOutline(map),
    toc: projectToc(map),
    sitemap: projectSitemap(map, { channel: "site", origin: "https://example.com" }),
  };
}

it("round-trips the existing content map semantically and retains every existing projection", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path, { date: "2026-10-29" });
  const compiled = await contentMapFromCells(path, map.publicationId);
  expect(compiled).toEqual(map);
  expect(checkContentMap(compiled)).toEqual([]);
  expect(projections(compiled)).toEqual(projections(map));
  const files = await cellBytes(path);
  expect(Object.keys(files)).toEqual(["page.designer/v1.md", "page.publisher/v1.md", "page.writer/v1.md"]);
  for (const source of Object.values(files)) {
    expect(source).toMatch(/^status: active$/m);
    expect(source).toMatch(/^confirmed: migration:2026-10-29$/m);
    expect(source).not.toMatch(/^parentId:|^order:/m);
  }
  expect((await treeAt(path)).active).toEqual({ "page.designer": 1, "page.writer": 1, "page.publisher": 1 });
  const result = await compileContentMaps(path, { check: true });
  expect(result.maps).toEqual([map]);
});

it("derives parent and order from tree placement, regrouping without moving or rewriting any cell", async () => {
  const path = await root();
  const original: ContentMap = { ...adminContentMap(), entries: [
    ...adminContentMap().entries,
    { id: "other", order: 1, title: "Other", slug: "other", kind: "group", pin: { nav: true }, source: { planItemId: "app.other" } },
  ] };
  await contentMapToCells(original, path);
  const before = await cellBytes(path), tree = await treeAt(path);
  const agents = findGroup(tree.tree, "agents"), other = findGroup(tree.tree, "other");
  expect(agents.cells).toEqual(["page.designer", "page.writer", "page.publisher"]);
  agents.cells = ["page.publisher", "page.writer"];
  other.cells = ["page.designer"];
  await writeTree(path, tree);
  const changed = await contentMapFromCells(path, original.publicationId);
  expect(changed.entries.find(entry => entry.id === "designer")).toMatchObject({ parentId: "other", order: 0 });
  expect(changed.entries.find(entry => entry.id === "publisher")).toMatchObject({ parentId: "agents", order: 0 });
  expect(changed.entries.find(entry => entry.id === "writer")).toMatchObject({ parentId: "agents", order: 1 });
  expect(projectNavigation(changed, "designer")).not.toEqual(projectNavigation(original, "designer"));
  expect(projectBreadcrumbs(changed, "designer").map(row => row.id)).toEqual(["other", "designer"]);
  for (const entry of original.entries.filter(entry => entry.kind === "page")) {
    const current = changed.entries.find(row => row.id === entry.id)!;
    expect(current.manifest).toEqual(entry.manifest);
    expect(current.constructs).toEqual(entry.constructs);
    expect(current.source).toEqual(entry.source);
    expect(current.path).toBe(entry.path);
  }
  expect(await cellBytes(path)).toEqual(before);
});

it("compiles only active pointers, ignoring a higher draft version and null pointers", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  const source = await readFile(join(path, "cells/page.designer/v1.md"), "utf8");
  const draft = source.replace(/^version: 1$/m, "version: 2").replace(/^status: active$/m, "status: draft").replace(/^confirmed:.*\n/m, "").replace(/^title:.*$/m, "title: Draft title");
  await writeFile(join(path, "cells/page.designer/v2.md"), draft);
  const tree = await treeAt(path);
  tree.active["page.writer"] = null;
  await writeTree(path, tree);
  const compiled = await contentMapFromCells(path, map.publicationId);
  expect(compiled.entries.find(row => row.id === "designer")?.title).toBe("Designer");
  expect(compiled.entries.some(row => row.id === "writer")).toBe(false);
  expect(compiled.entries.some(row => row.title === "Draft title")).toBe(false);
});

it("reports a cell path and source line when frontmatter disagrees with the permanent path", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  const file = join(path, "cells/page.designer/v1.md");
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace(/^id:.*$/m, "id: page.other"));
  await expect(contentMapFromCells(path, map.publicationId)).rejects.toThrow(/(?:path|id|page\.designer)/i);
});

it("rejects group entries authored as page cells instead of tree nodes", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  const file = join(path, "cells/page.designer/v1.md");
  await writeFile(file, (await readFile(file, "utf8")).replace(/^kind: page$/m, "kind: group"));
  await expect(contentMapFromCells(path, map.publicationId)).rejects.toThrow(/(?:kind|group)/i);
});

it("refuses undeclared publication placements and duplicate publication identities before changing outputs", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  const original = await treeAt(path), output = join(path, "content-map", `${map.publicationId}.json`);
  const before = await readFile(output, "utf8");
  await writeTree(path, { ...original, meta: { ...original.meta, publications: [] } });
  await expect(compileContentMaps(path)).rejects.toThrow(/active cell.*declared publication/i);
  expect(await readFile(output, "utf8")).toBe(before);
  await writeTree(path, { ...original, meta: { ...original.meta, publications: [...original.meta.publications, ...original.meta.publications] } });
  await expect(compileContentMaps(path)).rejects.toThrow(/duplicate publication/i);
  expect(await readFile(output, "utf8")).toBe(before);
});

it("rejects authored order metadata so regrouping remains the only order source", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  const file = join(path, "cells/page.designer/v1.md");
  await writeFile(file, (await readFile(file, "utf8")).replace(/^kind:/m, "order: 99\nkind:"));
  await expect(contentMapFromCells(path, map.publicationId)).rejects.toThrow(/(?:order|unknown)/i);
});

it("reports unresolved links against an available neighboring agent tree", async () => {
  const path = await root(), writer = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  await mkdir(join(writer, "cells"), { recursive: true });
  await writeFile(join(writer, "tree.json"), json({ schemaVersion: 1, tree: [], active: {}, retired: [] }));
  const file = join(path, "cells/page.designer/v1.md");
  await writeFile(file, (await readFile(file, "utf8")).replace(/^links:.*$/m, "links: [writer:copy.missing@1]"));
  const result = await compileContentMaps(path, { agentRoots: { writer } });
  expect(result.findings).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/copy\.missing/) }));
});

it("detects hand edits in generated content maps without rewriting them during check", async () => {
  const path = await root(), map = adminContentMap();
  await contentMapToCells(map, path);
  const output = join(path, "content-map", `${map.publicationId}.json`);
  const before = await readFile(output, "utf8");
  const edited = JSON.parse(before); edited.entries[1].title = "Hand edit";
  const bytes = json(edited); await writeFile(output, bytes);
  await expect(compileContentMaps(path, { check: true })).rejects.toThrow(/(?:drift|differ|generated)/i);
  expect(await readFile(output, "utf8")).toBe(bytes);
  expect(await contentMapFromCells(path, map.publicationId)).toEqual(map);
});

it("round-trips a static admin-shaped route pack and compiles edited page identities over its preserved extras", async () => {
  const path = await root();
  const pack = {
    packId: "example.workbench",
    archetype: "app",
    defaultRoute: "library.list",
    aliases: [{ from: "/library", to: "/library/list" }],
    frame: { id: "frames.app-shell", config: { sidebar: "expanded", inspector: false } },
    headers: [{ name: "x-example-mode", value: "preview" }],
    routes: [
      { instanceId: "library.list", path: "/library/list", label: "Library", keywords: ["catalog", "selection"], frame: { id: "frames.app-shell", config: { sidebar: "expanded" } }, view: { id: "views.library", config: { columns: ["name", "status"], groups: ["tokens", "assets"] } }, headers: [{ title: "Library", actions: ["refresh"] }] },
      { instanceId: "library.item", path: "/library/item", label: "Library item", frame: { id: "frames.app-shell", config: { sidebar: "compact" } }, view: { id: "views.record", config: { tabs: ["details", "history"], editable: false } } },
    ],
  };
  await routePackToCells(pack, path, { date: "2026-10-29" });
  const output = join(path, "route-pack", `${pack.packId}.json`);
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(pack);
  await expect(compileContentMaps(path, { check: true })).resolves.toMatchObject({ maps: [expect.objectContaining({ publicationId: pack.packId })] });
  const file = join(path, "cells/page.library-list/v1.md");
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace(/^path:.*$/m, "path: /library/overview").replace(/^title:.*$/m, "title: Library overview"));
  await compileContentMaps(path);
  const compiledPack = JSON.parse(await readFile(output, "utf8"));
  expect(compiledPack).toEqual({ ...pack, routes: [{ ...pack.routes[0], path: "/library/overview", label: "Library overview" }, pack.routes[1]] });
  const compiledMap = await contentMapFromCells(path, pack.packId);
  expect(compiledMap.entries[0]).toMatchObject({ id: "library.list", path: "/library/overview", title: "Library overview" });
});

it("rejects colliding kebab-case cell identities before writing migration files", async () => {
  const path = await root();
  const pack = { packId: "example.collision", routes: [
    { instanceId: "libraryList", path: "/first", label: "First" },
    { instanceId: "library-list", path: "/second", label: "Second" },
  ] };
  await expect(routePackToCells(pack, path)).rejects.toThrow(/(?:collision|identity)/i);
  expect(await readdir(path)).toEqual([]);
});


function externalPublication(): ContentMap {
  return {
    version: 1, publicationId: "example.external", format: "web.page.responsive",
    entries: [
      { id: "home", order: 0, title: "Home", path: "/", kind: "page", source: { frameId: "frames.home", sectionIds: [] },
        pageConfig: "home", indexing: { mode: "noindex", reason: "Draft: awaiting review, then publish" }, lastModified: "2026-10-28T14:30:00-07:00" },
      { id: "docs", order: 1, title: "Documentation", path: "/docs", kind: "external", href: "https://example.com/docs?view=guide#start",
        pin: { nav: true }, icon: "book", description: "External documentation", keywords: ["guide"],
        indexing: { mode: "index" }, lastModified: "2026-10-29" },
    ],
    actions: [{ id: "help", label: "Help", group: "Support", intent: "open-help" }],
    redirects: [{ from: "/old-home", to: "/", permanent: false }, { from: "/old-docs", to: "/docs", permanent: true }],
  };
}

it("round-trips sourced and external cells losslessly with indexing, dates and redirects", async () => {
  const path = await root(), map = externalPublication();
  await contentMapToCells(map, path, { date: "2026-10-29" });
  const compiled = await contentMapFromCells(path, map.publicationId);
  expect(compiled).toEqual(map);
  expect(checkContentMap(compiled)).toEqual([]);
  expect(JSON.parse(await readFile(join(path, "content-map", `${map.publicationId}.json`), "utf8"))).toEqual(map);
  await expect(compileContentMaps(path, { check: true })).resolves.toMatchObject({ maps: [map] });
  const source = await readFile(join(path, "cells/page.docs/v1.md"), "utf8");
  expect(source).toMatch(/^kind: external$/m);
  expect(source).toMatch(/^href: https:\/\/example.com\/docs\?view=guide#start$/m);
  expect(source).not.toMatch(/^(?:planItemId|frame|sections):/m);
});

it.each(["javascript:alert(1)", "//example.com/docs", "https://user:password@example.com/docs"])("refuses malformed external href %s before migration writes", async href => {
  const path = await root(), map = externalPublication();
  const invalid = { ...map, entries: map.entries.map(entry => entry.kind === "external" ? { ...entry, href } : entry) };
  await expect(contentMapToCells(invalid, path)).rejects.toThrow(/refused/i);
  expect(await readdir(path)).toEqual([]);
});

it.each([
  ["unsafe href", (source: string) => source.replace(/^href:.*$/m, "href: javascript:alert(1)")],
  ["forbidden source", (source: string) => source.replace(/^kind: external$/m, "kind: external\nplanItemId: docs")],
  ["forbidden constructs", (source: string) => `${source}\n## Constructs\n\`\`\`json\n{}\n\`\`\`\n`],
  ["invalid indexing", (source: string) => source.replace(/^indexing:.*$/m, "indexing: invalid")],
  ["invalid date", (source: string) => source.replace(/^lastModified:.*$/m, "lastModified: 2026-02-30")],
])("refuses an external cell with %s without changing any generated output", async (_label, mutate) => {
  const path = await root(), map = externalPublication();
  await contentMapToCells(map, path);
  const outputs = ["compile.json", `content-map/${map.publicationId}.json`];
  const before = await Promise.all(outputs.map(file => readFile(join(path, file), "utf8")));
  const cell = join(path, "cells/page.docs/v1.md");
  await writeFile(cell, mutate(await readFile(cell, "utf8")));
  await expect(compileContentMaps(path)).rejects.toThrow();
  expect(await Promise.all(outputs.map(file => readFile(join(path, file), "utf8")))).toEqual(before);
});
