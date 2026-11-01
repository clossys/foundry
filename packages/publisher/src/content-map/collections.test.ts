import { expect, it } from "vitest";
import { checkContentMap, projectBreadcrumbs, projectCommands, projectNavigation, projectStaticParams, projectRoutes } from "./index.js";
import { expandCollections } from "./collections.js";
import { syntheticRoute } from "../core/__fixtures__/registered-route.js";
import type { ContentMap } from "./contract.js";

function fixture(): ContentMap {
  return { version: 1, publicationId: "example.studio", format: "web.page.responsive", entries: [{
    id: "designer", title: "Designer", order: 0, path: "/designer", kind: "collection", pin: { nav: true },
    source: { frameId: "frames.detail", sectionIds: ["sections.detail"] },
    collection: { agent: "designer", groups: [
      { id: "structure", title: "Structure", anchor: "structure", order: 0 },
      { id: "layout", title: "Layout", anchor: "layout", parentId: "structure", order: 0 },
      { id: "grids", title: "Grids", anchor: "grids", parentId: "layout", order: 0 },
      { id: "typography", title: "Typography", anchor: "typography", order: 1 },
    ], leaves: [
      { id: "hero", title: "Hero", slug: "hero", parentId: "grids", order: 0 },
      { id: "rows", title: "Rows", slug: "rows", parentId: "grids", order: 1 },
    ] },
  }] };
}
function mutable(): any { return structuredClone(fixture()); }

it("expands one frame and sections template across slot leaves with flat URLs", () => {
  const map = fixture();
  expect(checkContentMap(map)).toEqual([]);
  const pages = expandCollections(map).entries.filter(entry => entry.kind === "page");
  expect(pages.map(entry => entry.path)).toEqual(["/designer", "/designer/hero", "/designer/rows"]);
  expect(pages.every(entry => entry.source === map.entries[0]!.source)).toBe(true);
  expect(projectStaticParams(map)).toEqual([{ slug: ["designer"] }, { slug: ["designer", "hero"] }, { slug: ["designer", "rows"] }]);
});
it("projects agent and leaf breadcrumbs without grouping labels", () => {
  expect(projectBreadcrumbs(fixture(), "hero").map(row => [row.label, row.href])).toEqual([
    ["Designer", "/designer"], ["Hero", "/designer/hero"],
  ]);
});
it("indexes agents, group anchors and leaves in cmdk and pinned navigation", () => {
  const items = projectCommands(fixture()).flatMap(group => group.items);
  expect(items.map(item => item.href)).toEqual(["/designer", "/designer#structure", "/designer#layout", "/designer#grids", "/designer/hero", "/designer/rows", "/designer#typography"]);
  expect(projectNavigation(fixture(), "hero").tree[0]?.children?.[0]?.href).toBe("/designer#structure");
});
it("keeps leaf URLs and breadcrumbs stable while regrouping", () => {
  const map = mutable();
  const before = projectStaticParams(map);
  map.entries[0].collection.leaves[0].parentId = "typography";
  expect(projectStaticParams(map).map(row => row.slug.join("/")).sort()).toEqual(before.map(row => row.slug.join("/")).sort());
  expect(projectBreadcrumbs(map, "hero").map(row => row.href)).toEqual(["/designer", "/designer/hero"]);
});
it("rejects duplicate leaf slugs per agent", () => {
  const map = mutable();
  map.entries[0].collection.leaves[1].slug = "hero";
  expect(checkContentMap(map)).toContainEqual(expect.objectContaining({ message: "Collection leaf slugs must be unique per agent" }));
  expect(() => projectStaticParams(map)).toThrow();
});
it("rejects an agent named settings", () => {
  const map = mutable();
  map.entries[0].collection.agent = "settings";
  map.entries[0].path = "/settings";
  expect(checkContentMap(map)).not.toEqual([]);
  expect(() => projectCommands(map)).toThrow();
});
it.each(["", "/", "__specimen", "sign-in", "auth"])("rejects reserved or invalid agent %s", agent => {
  const map = mutable(); map.entries[0].collection.agent = agent; map.entries[0].path = `/${agent}`;
  expect(checkContentMap(map)).not.toEqual([]);
});
it("allows the same leaf slug for different agents", () => {
  const map = mutable(), other = structuredClone(map.entries[0]);
  other.id = "composer"; other.title = "Composer"; other.path = "/composer"; other.collection.agent = "composer";
  for (const row of [...other.collection.groups, ...other.collection.leaves]) {
    row.id = `composer.${row.id}`;
    if (row.parentId) row.parentId = `composer.${row.parentId}`;
  }
  map.entries.push(other);
  expect(checkContentMap(map)).toEqual([]);
  expect(projectStaticParams(map).some(row => row.slug.join("/") === "composer/hero")).toBe(true);
});
it("rejects missing parents, cycles, deep groups and identity or path collisions", () => {
  const mutations = [
    (map: any) => { map.entries[0].collection.leaves[0].parentId = "missing"; },
    (map: any) => { map.entries[0].collection.groups[0].parentId = "grids"; },
    (map: any) => { map.entries[0].collection.groups.push({ id: "deep", title: "Deep", order: 0, anchor: "deep", parentId: "grids" }); },
    (map: any) => { map.entries[0].collection.leaves[0].id = "designer"; },
    (map: any) => { map.entries.push({ id: "existing", title: "Existing", order: 1, path: "/designer/hero", kind: "page", source: { planItemId: "existing" } }); },
  ];
  for (const mutate of mutations) { const map = mutable(); mutate(map); expect(checkContentMap(map)).not.toEqual([]); }
});
it("projects the agent alone for collections without groups", () => {
  const map = mutable(); map.entries[0].collection.groups = []; map.entries[0].collection.leaves = [];
  expect(projectBreadcrumbs(map, "designer").map(row => row.label)).toEqual(["Designer"]);
});

it("projects gallery and leaf routes from the same registered frame template", () => {
  const map = fixture();
  const brand = { homeRouteId: "designer", label: "Example" };
  const registrations = expandCollections(map).entries.filter(entry => entry.kind === "page").map(entry => {
    const route = syntheticRoute(entry.id);
    return { ...route, title: entry.title, path: entry.path!, brand,
      entry: { file: "app/designer/[[...slug]]/page.tsx", export: "default" },
      composition: { ...route.composition, binding: { ...route.composition.binding,
        path: entry.path!, frame: { leaf: "frames.detail" }, fills: { body: [{ section: "sections.detail", content: {} }] },
      } },
    };
  });
  const routes = projectRoutes(map, { consumer: "example", channel: "admin", brand, registrations }).routes;
  expect(routes.map(route => route.path)).toEqual(["/designer", "/designer/hero", "/designer/rows"]);
  expect(new Set(routes.map(route => route.entry.file)).size).toBe(1);
  expect(() => projectRoutes(map, { consumer: "example", channel: "admin", brand, registrations: [] })).toThrow(/registered source/);
});
