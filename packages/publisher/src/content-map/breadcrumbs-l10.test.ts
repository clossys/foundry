import { expect, it } from "vitest";
import { projectBreadcrumbs } from "./projections.ts";
import { checkContentMap } from "./check.js";
import { expandCollections } from "./collections.js";
import { adminContentMap } from "./__fixtures__/admin.js";
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

const designer = { id: "designer", label: "Designer", href: "/designer" };
const hero = { id: "hero", label: "Hero", href: "/designer/hero" };

it("L10 keeps the admin Designer destination without its Agents group", () => {
  expect(projectBreadcrumbs(adminContentMap(), "designer")).toEqual([
    { id: "designer", label: "Designer", href: "/agents/designer" },
  ]);
});
it("L10 collection page has no synthetic Agents prefix", () => {
  expect(projectBreadcrumbs(fixture(), "designer")).toEqual([designer]);
});
it("L10 anchored nested L0-L2 groups leave Designer then Hero", () => {
  expect(projectBreadcrumbs(fixture(), "hero")).toEqual([designer, hero]);
});
it("L10 regrouping Hero preserves its URL and breadcrumbs", () => {
  const before = fixture();
  const after = structuredClone(before);
  (after.entries[0] as any).collection.leaves[0].parentId = "typography";
  expect(checkContentMap(after)).toEqual([]);
  expect(expandCollections(after).entries.find(entry => entry.id === "hero")?.path)
    .toBe(expandCollections(before).entries.find(entry => entry.id === "hero")?.path);
  expect(projectBreadcrumbs(after, "hero")).toEqual([designer, hero]);
  expect(projectBreadcrumbs(after, "hero")).toEqual(projectBreadcrumbs(before, "hero"));
});
it("L10 group title changes cannot affect breadcrumbs", () => {
  const map = fixture();
  const before = projectBreadcrumbs(map, "hero");
  for (const group of (map.entries[0] as any).collection.groups) group.title = `Renamed ${group.title}`;
  expect(projectBreadcrumbs(map, "hero")).toEqual(before);
});
it("L10 preserves actual external, page and section ancestor titles and hrefs in order", () => {
  const map: ContentMap = { version: 1, publicationId: "example.guide", format: "web.page.responsive", entries: [
    { id: "reference", title: "Reference", order: 0, kind: "external", path: "/reference", href: "https://example.com/reference" },
    { id: "guide", title: "Guide", order: 0, kind: "page", parentId: "reference", path: "/guide", source: { planItemId: "guide" } },
    { id: "overview", title: "Overview", order: 0, kind: "section", parentId: "guide", path: "/guide?view=overview", source: { planItemId: "guide" } },
  ] };
  expect(checkContentMap(map)).toEqual([]);
  expect(projectBreadcrumbs(map, "overview")).toEqual([
    { id: "reference", label: "Reference", href: "https://example.com/reference" },
    { id: "guide", label: "Guide", href: "/guide" },
    { id: "overview", label: "Overview", href: "/guide?view=overview" },
  ]);
});
it("L10 preserves map validation and missing entry refusal", () => {
  const invalid = fixture();
  (invalid.entries[0] as any).collection.leaves[0].parentId = "missing";
  expect(() => projectBreadcrumbs(invalid, "hero")).toThrow();
  expect(() => projectBreadcrumbs(fixture(), "missing")).toThrow(/missing/);
  expect(() => projectBreadcrumbs({ ...fixture(), format: "deck.16x9" }, "hero")).toThrow();
});
it("L10 leaves input maps unchanged and projections deterministic", () => {
  for (const map of [fixture(), adminContentMap()]) {
    const before = structuredClone(map);
    const id = map.entries[0]!.kind === "collection" ? "hero" : "designer";
    const first = projectBreadcrumbs(map, id);
    expect(projectBreadcrumbs(map, id)).toEqual(first);
    expect(map).toEqual(before);
  }
});
