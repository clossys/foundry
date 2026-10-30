import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ContentMap } from "@clossys/publisher/content-map";
import { agentModule, agentRoot } from "./cells.js";
import { startProducerServer, type ProducerServer } from "./index.js";
import { consumerApps } from "./publications.js";

let root: string;
let server: ProducerServer | undefined;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "producer-publications-")); });
afterEach(async () => { await server?.close(); server = undefined; await rm(root, { recursive: true, force: true }); });
const map = (): ContentMap => ({ version: 1, publicationId: "consumer.portal", format: "web.page.responsive", entries: [
  { id: "start", kind: "page", title: "Portal", order: 0, path: "/", source: { planItemId: "portal.start" }, pin: { nav: true } },
  { id: "guide", kind: "page", title: "Guide", order: 1, path: "/guide", source: { planItemId: "portal.guide" } },
] });
async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(base: string, prefix = "") {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = join(prefix, entry.name);
      if (entry.isDirectory()) await walk(join(base, entry.name), path);
      else files[path] = (await readFile(join(base, entry.name))).toString("base64");
    }
  }
  await walk(directory); return files;
}
async function author(routeMetadata?: Record<string, unknown>) {
  const api = await agentModule("publisher", "content-map/cells.js");
  const routePack = routeMetadata === undefined ? undefined : { packId: map().publicationId, ...routeMetadata, routes: map().entries.map(entry => ({ instanceId: entry.id, path: entry.path, label: entry.title })) };
  await api.contentMapToCells(map(), agentRoot(root, "publisher"), { date: "2026-10-30", ...(routePack ? { routePack } : {}) });
}

it("projects active consumer cells on each GET without compiling or writing the consumer", async () => {
  await author();
  const path = join(agentRoot(root, "publisher"), "tree.json");
  const tree = JSON.parse(await readFile(path, "utf8"));
  tree.tree[0].name = "Customer portal";
  await writeFile(path, JSON.stringify(tree));
  const childEntry = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/studio-child.mjs");
  server = await startProducerServer({ root, port: 0, studioEntry: childEntry, handleSignals: false });
  const before = await snapshot(root);
  const first = await (await fetch(`${server.url}/api/apps`)).json() as any;
  expect(first).toMatchObject({ state: "ready", publications: [{ id: "consumer.portal", title: "Customer portal", source: "cells", entryId: "start", navigation: { tree: [{ id: "start", label: "Portal", href: "/" }] } }] });
  const projections = await agentModule("publisher", "content-map/index.js");
  expect(first.publications[0].commands).toEqual(projections.projectCommands(map()));
  expect(first.publications[0].breadcrumbs.guide).toEqual(projections.projectBreadcrumbs(map(), "guide"));
  expect(await snapshot(root)).toEqual(before);

  const cellPath = join(agentRoot(root, "publisher"), "cells/page.start/v1.md");
  await writeFile(cellPath, (await readFile(cellPath, "utf8")).replace("title: Portal", "title: Dashboard"));
  tree.meta.publications[0].entryMeta["page.guide"] = { pin: { nav: true } };
  await writeFile(path, JSON.stringify(tree));
  const changed = await snapshot(root);
  const second = await (await fetch(`${server.url}/api/apps`)).json() as any;
  expect(second.publications[0].navigation.tree[0].label).toBe("Dashboard");
  expect(second.publications[0].navigation.tree).toHaveLength(2);
  expect(second.publications[0].navigation.tree[1]).toMatchObject({ id: "guide", label: "Guide", href: "/guide" });
  expect(second.publications[0].commands[0].items[0].label).toBe("Dashboard");
  expect(second.publications[0].breadcrumbs.start[0].label).toBe("Dashboard");
  expect(await snapshot(root)).toEqual(changed);
  expect(JSON.parse(await readFile(join(agentRoot(root, "publisher"), "content-map/consumer.portal.json"), "utf8")).entries[0].title).toBe("Portal");
  await writeFile(path, JSON.stringify({ ...tree, active: {}, meta: { publications: [] } }));
  const removed = await snapshot(root);
  expect(await (await fetch(`${server.url}/api/apps`)).json()).toMatchObject({ state: "missing", publications: [] });
  expect(await snapshot(root)).toEqual(removed);
});

it("discovers published maps in the canonical consumer root and retains only declared app targets", async () => {
  const publisher = agentRoot(root, "publisher");
  await mkdir(join(publisher, "content-map"), { recursive: true });
  await writeFile(join(publisher, "content-map/consumer.portal.json"), JSON.stringify(map()));
  const before = await snapshot(root);
  const result = await consumerApps(root);
  expect(result).toMatchObject({ state: "ready", publications: [{ id: "consumer.portal", source: "content-map" }] });
  expect(result.publications[0]!.target).toBeUndefined();
  expect(await snapshot(root)).toEqual(before);
  await mkdir(join(root, "apps/portal"), { recursive: true });
  await mkdir(join(publisher, "route-pack"));
  await writeFile(join(publisher, "route-pack/consumer.portal.json"), JSON.stringify({ appDir: "apps/portal", defaultRoute: "guide" }));
  expect((await consumerApps(root)).publications[0]).toMatchObject({ entryId: "guide", target: { appDirectory: "apps/portal", entryId: "guide", path: "/guide" } });
});

it("reports missing publications and fails closed for malformed maps, identities and linked paths", async () => {
  expect(await consumerApps(root)).toMatchObject({ state: "missing", publications: [] });
  const publisher = agentRoot(root, "publisher");
  await mkdir(join(publisher, "content-map"), { recursive: true });
  const path = join(publisher, "content-map/consumer.portal.json");
  await writeFile(path, JSON.stringify({ ...map(), publicationId: "different" }));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  await writeFile(path, "{}");
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  await rm(path);
  const outside = join(root, "outside.json"); await writeFile(outside, JSON.stringify(map()));
  await symlink(outside, path);
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  await rm(join(publisher, "content-map"), { recursive: true });
  await symlink(join(root, "missing"), join(publisher, "content-map"));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
});

it("refuses an invalid cell declaration instead of serving its stale compiled map", async () => {
  await author();
  const treePath = join(agentRoot(root, "publisher"), "tree.json");
  const tree = JSON.parse(await readFile(treePath, "utf8"));
  tree.meta.publications[0].id = "../escape";
  await writeFile(treePath, JSON.stringify(tree));
  const before = await snapshot(root);
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  expect(await snapshot(root)).toEqual(before);
});

it("refuses unavailable, escaping and aliased app mappings", async () => {
  await author({ defaultRoute: "start" });
  const treePath = join(agentRoot(root, "publisher"), "tree.json");
  const tree = JSON.parse(await readFile(treePath, "utf8"));
  tree.meta.publications[0].routePack = { appDir: "../escape" };
  await writeFile(treePath, JSON.stringify(tree));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  tree.meta.publications[0].routePack = { defaultRoute: "unknown" };
  await writeFile(treePath, JSON.stringify(tree));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  await mkdir(join(root, "apps")); await symlink(root, join(root, "apps/portal"));
  tree.meta.publications[0].routePack = { appDir: "apps/portal" };
  await writeFile(treePath, JSON.stringify(tree));
  expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
});

it("exposes only an explicitly declared local app server URL", async () => {
  await author({ devServerUrl: "http://127.0.0.1:4329" });
  expect((await consumerApps(root)).publications[0]!.target?.devServerUrl).toBe("http://127.0.0.1:4329/");
  const path = join(agentRoot(root, "publisher"), "tree.json");
  const tree = JSON.parse(await readFile(path, "utf8"));
  for (const devServerUrl of ["https://example.test", "javascript:alert(1)", "http://user@localhost:4329/"]) {
    tree.meta.publications[0].routePack.devServerUrl = devServerUrl;
    await writeFile(path, JSON.stringify(tree));
    expect(await consumerApps(root)).toMatchObject({ state: "error", publications: [] });
  }
});
