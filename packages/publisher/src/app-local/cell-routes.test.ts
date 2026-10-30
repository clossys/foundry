import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contentMapToCells } from "../content-map/cells.js";
import type { ContentMap } from "../content-map/contract.js";
import { contentRouteFixture } from "../web/__fixtures__/content-route.js";
import { createContentRouteManifest } from "../web/content-route-manifest.js";
import { emitContentRoutePage } from "../web/content-route-source.js";
import { readServingPublication } from "./cell-routes.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(metadata = true) {
  const root = await mkdtemp(join(tmpdir(), "app-local-serving-")); roots.push(root);
  const input = contentRouteFixture();
  input.registry.slots[0] = { ...input.registry.slots[0]!, route: "/" };
  const manifest = createContentRouteManifest({ registry: input.registry, locale: "en", loader: { file: "src/content-loader.ts", export: "loadContentRoute" } });
  const map: ContentMap = { version: 1, publicationId: "example", format: "web.page.responsive", entries: [{ id: "home", order: 0, title: "Home", path: "/", kind: "page", source: { frameId: "frames.auth-shell", sectionIds: ["sections.empty-state"] } }] };
  await contentMapToCells(map, root, { date: "2026-10-29", ...(metadata ? { routePack: { ...manifest, packId: "example", routes: manifest.routes.map(route => ({ ...route, instanceId: "home", label: "Home" })) } } : {}) });
  return { root, manifest, map };
}
it("derives a complete native serving manifest exclusively from active Route cells", async () => {
  const { root, manifest, map } = await fixture();
  const before = await readFile(join(root, "tree.json"), "utf8");
  await writeFile(join(root, "route-pack/example.json"), '{"stale":true}\n');
  const cell = join(root, "cells/page.home/v1.md"), source = await readFile(cell, "utf8");
  await writeFile(cell.replace("v1.md", "v2.md"), source.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace(/^confirmed:.*\n/m, "").replace('"candidateId": "sign-in"', '"candidateId": "draft"'));
  const result = await readServingPublication(root, "example", "example");
  expect(result).toEqual({ map, manifest });
  expect(emitContentRoutePage(result.manifest.routes[0]!)).toContain("requireContentRoutePublishing(bindContentRoute(input, route))");
  expect(emitContentRoutePage(result.manifest.routes[0]!)).toContain("await loadContentRoute()");
  expect(await readFile(join(root, "tree.json"), "utf8")).toBe(before);
});
it("refuses topology without serving Route authority and legacy pass-through packs", async () => {
  const { root } = await fixture(false);
  await expect(readServingPublication(root, "example", "example")).rejects.toThrow(/serving.*Route/i);
  const tree = JSON.parse(await readFile(join(root, "tree.json"), "utf8"));
  tree.meta.publications[0].routePack = { packId: "example", archetype: "app" };
  await writeFile(join(root, "tree.json"), JSON.stringify(tree));
  await expect(readServingPublication(root, "example", "example")).rejects.toThrow(/native.*version 2/i);
});
it("rejects wrong consumers, incomplete Route metadata, path drift and missing page coverage", async () => {
  const { root } = await fixture();
  await expect(readServingPublication(root, "example", "another")).rejects.toThrow(/consumer/i);
  const cell = join(root, "cells/page.home/v1.md"), source = await readFile(cell, "utf8");
  await writeFile(cell, source.replace(/"loader": \{[\s\S]*?\n  \}/, '"loader": {}'));
  await expect(readServingPublication(root, "example", "example")).rejects.toThrow(/loader/i);
  await writeFile(cell, source.replace("path: /", "path: /moved"));
  await expect(readServingPublication(root, "example", "example")).rejects.toThrow(/source|output path/i);
  await writeFile(cell, source.replace("frame: frames.auth-shell", "frame: frames.site-shell"));
  await expect(readServingPublication(root, "example", "example")).rejects.toThrow(/composition/i);
  await writeFile(cell, source.slice(0, source.indexOf("## Route")));
  await expect(readServingPublication(root, "example", "example")).rejects.toThrow(/Route metadata/i);
});
