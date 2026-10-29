import { expect, it } from "vitest";
import { checkContentMap, projectNavigation, projectCommands, projectBreadcrumbs, projectRoutes, projectOutline, projectToc } from "./index.js";
import { adminContentMap, adminRouteOptions } from "./__fixtures__/admin.js";

it("projects navigation, commands, breadcrumbs, routes and outline from one consumer JSON fixture", () => {
  const map = adminContentMap();
  expect(checkContentMap(map)).toEqual([]);
  for (const page of map.entries.filter(entry => entry.kind === "page")) {
    const destination = { id: page.id, label: page.title, href: page.path };
    expect(projectNavigation(map, page.id).tree[0]!.children).toContainEqual(destination);
    expect(projectCommands(map)[0]!.items).toContainEqual(destination);
    expect(projectBreadcrumbs(map, page.id).at(-1)).toEqual(destination);
    expect(projectRoutes(map, adminRouteOptions()).routes).toContainEqual(expect.objectContaining({ routeId: page.id, title: page.title, path: page.path }));
    expect(projectOutline(map)[0]!.children).toContainEqual(expect.objectContaining(destination));
  }
  expect(projectOutline(map)[0]!.children![0]!.children).toEqual([
    { id: "designer#library", label: "Library", href: "/agents/designer#library", children: [
      { id: "designer#library--surfaces", label: "Surfaces", href: "/agents/designer#library--surfaces", children: [
        { id: "designer#library--surfaces--frames", label: "Frames", href: "/agents/designer#library--surfaces--frames" },
      ] },
    ] },
  ]);
});

it("reflects a changed consumer page and manifest in every projection without mutating the map", () => {
  const map = adminContentMap();
  const page = map.entries[1]! as any;
  page.title = "Design library"; page.path = "/agents/design"; page.manifest.l0[0].label = "Collections";
  const before = JSON.stringify(map);
  expect(projectNavigation(map, page.id).tree[0]!.children![0]).toMatchObject({ label: page.title, href: page.path });
  expect(projectCommands(map)[0]!.items[0]).toMatchObject({ label: page.title, href: page.path });
  expect(projectBreadcrumbs(map, page.id).at(-1)).toMatchObject({ label: page.title, href: page.path });
  expect(projectRoutes(map, adminRouteOptions()).routes[0]).toMatchObject({ title: page.title, path: page.path });
  expect(projectOutline(map)[0]!.children![0]).toMatchObject({ label: page.title, href: page.path, children: [
    { label: "Collections", href: "/agents/design#library" },
  ] });
  const shuffled = { ...map, entries: [...map.entries].reverse() };
  expect(projectOutline(shuffled)).toEqual(projectOutline(map));
  expect(projectToc(shuffled)).toEqual(projectToc(map));
  const outline = projectOutline(map) as any;
  outline[0].children[0].children[0].label = "Changed output";
  expect(JSON.stringify(map)).toBe(before);
});

it("projects finite deck outlines and PDF TOCs without claiming rendered slides or page numbers", () => {
  const entries = [
    { id: "part", order: 0, title: "Part", slug: "part", kind: "group" as const, source: { planItemId: "part" } },
    { id: "slide", parentId: "part", order: 0, title: "Slide", slug: "slide", kind: "slide" as const, source: { planItemId: "slide" } },
  ];
  const deck = { version: 1 as const, publicationId: "example.deck", format: "deck.16x9" as const, entries };
  expect(projectOutline(deck)).toEqual([{ id: "part", label: "Part", children: [{ id: "slide", label: "Slide", href: "/slide" }] }]);
  expect(projectToc({ ...deck, format: "document.pdf-a4" })).toEqual([
    { id: "part", label: "Part", level: 1 }, { id: "slide", label: "Slide", href: "/slide", level: 2 },
  ]);
  expect(projectOutline({ ...deck, entries: [] })).toEqual([]);
});

it("derives TOC anchors from the same placement-backed L1/L2 outline", () => {
  const toc = projectToc(adminContentMap());
  expect(new Set(toc.map(entry => entry.id)).size).toBe(toc.length);
  expect(toc.slice(0, 5)).toEqual([
    { id: "agents", label: "Agents", level: 1 },
    { id: "designer", label: "Designer", href: "/agents/designer", level: 2 },
    { id: "designer#library", label: "Library", href: "/agents/designer#library", level: 3 },
    { id: "designer#library--surfaces", label: "Surfaces", href: "/agents/designer#library--surfaces", level: 4 },
    { id: "designer#library--surfaces--frames", label: "Frames", href: "/agents/designer#library--surfaces--frames", level: 5 },
  ]);
});

it.each(["before", "after"])("refuses a map entry %s its colliding generated heading identity", position => {
  const original = adminContentMap();
  const entry = { id: "designer#library", order: 1, title: "Separate page", path: "/separate", kind: "page" as const, source: { planItemId: "app.separate" } };
  const map = { ...original, entries: position === "before" ? [entry, ...original.entries] : [...original.entries, entry] };
  expect(checkContentMap(map)).toContainEqual(expect.objectContaining({ code: "duplicate-id", severity: "P0", entryId: "designer" }));
  for (const project of [() => projectNavigation(map, "designer"), () => projectCommands(map), () => projectBreadcrumbs(map, "designer"), () => projectRoutes(map, adminRouteOptions()), () => projectOutline(map), () => projectToc(map)]) {
    expect(project).toThrow(/Content map refused:.*duplicate-id/);
  }
});

it.each(["cycle", "orphan"])("refuses a %s before any of the five projections or TOC can escape", defect => {
  const map = adminContentMap();
  (map.entries[0]! as any).parentId = defect === "cycle" ? "designer" : "missing";
  expect(checkContentMap(map)).toContainEqual(expect.objectContaining({ code: defect }));
  for (const project of [() => projectNavigation(map, "designer"), () => projectCommands(map), () => projectBreadcrumbs(map, "designer"), () => projectRoutes(map, adminRouteOptions()), () => projectOutline(map), () => projectToc(map)]) {
    expect(project).toThrow(/Content map refused/);
  }
});

it("refuses malformed manifests, orphan placements and invalid construct references", () => {
  const mutations = [
    (page: any) => { delete page.constructs; },
    (page: any) => { delete page.manifest; },
    (page: any) => { page.manifest.l0[0].section.slot = "missing"; },
    (page: any) => { page.manifest.l0[0].l1[0].section.children = [2]; },
    (page: any) => { page.manifest.l0[0].l1.push(page.manifest.l0[0].l1[0]); },
    (page: any) => { page.manifest.l0[0].l1[0].l2[0].section.key = "unrepeated"; },
    (page: any) => { page.constructs.main[0].content = { label: "handwritten" }; },
    (page: any) => { page.constructs.main[0].content = { rows: { kind: "records", ref: "" } }; },
    (page: any) => { page.constructs.main[0].repeat = { over: { kind: "copy", ref: "copy" }, key: "id" }; },
    (page: any) => { page.constructs.main[0].section = "frames.app-shell"; },
    (page: any) => { page.constructs.main[0].unexpected = true; },
  ];
  for (const mutate of mutations) {
    const map = adminContentMap(); mutate(map.entries[1]);
    expect(checkContentMap(map)).toContainEqual(expect.objectContaining({ code: "contract", entryId: "designer" }));
    expect(() => projectOutline(map)).toThrow(/Content map refused/);
  }
});

it("keeps maps without optional in-page content compatible", () => {
  const map = adminContentMap();
  for (const entry of map.entries as any) { delete entry.manifest; delete entry.constructs; }
  expect(checkContentMap(map)).toEqual([]);
  expect(projectOutline(map)[0]!.children![0]).toEqual({ id: "designer", label: "Designer", href: "/agents/designer" });
});
