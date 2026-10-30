import { expect, it } from "vitest";
import { checkContentMap, projectRoutes, projectNavigation, projectCommands, projectBreadcrumbs, projectSitemap, projectOutline, projectToc } from "./index.js";
import type { ContentMap } from "./index.js";
import { adminContentMap, adminRouteOptions } from "./__fixtures__/admin.js";

type Mutable = any;
/** Synthetic capacity case; application-internal IA is not publication data. */
function sectionContentMap(): ContentMap {
  return { version: 1, publicationId: "example.guide", format: "web.page.responsive", entries: [
    { id: "guides", order: 0, title: "Guides", slug: "guides", kind: "group", pin: { nav: true }, source: { planItemId: "guides" } },
    { id: "guide", parentId: "guides", order: 0, title: "Guide", path: "/guides/guide", kind: "page", pin: { nav: true }, source: { planItemId: "guide" } },
    { id: "guide.overview", parentId: "guide", order: 0, title: "Overview", path: "/guides/guide/overview", kind: "section", pin: { nav: true }, source: { planItemId: "guide" } },
  ] };
}
function proof(code: string, mutate: (map: Mutable) => void, original: ContentMap = adminContentMap()) {
  expect(checkContentMap(original)).toEqual([]);
  const changed = structuredClone(original); mutate(changed);
  expect(checkContentMap(changed)).toContainEqual(expect.objectContaining({ code, severity: "P0" }));
  expect(() => projectNavigation(changed, "writer")).toThrow();
  expect(checkContentMap(original)).toEqual([]);
}
it("rejects duplicate IDs with a mutation proof", () => proof("duplicate-id", m => { m.entries[2].id = "designer"; }));
it("rejects duplicate resolved paths with a mutation proof", () => proof("duplicate-path", m => { m.entries[2].path = "/agents/designer"; }));
it("rejects a missing parent with a mutation proof", () => proof("missing-parent", m => { m.entries[2].parentId = "missing"; }));
it("rejects a cycle with a mutation proof", () => proof("cycle", m => { m.entries[0].parentId = "designer"; }));
it("rejects an orphan descendant even when its direct parent exists", () => {
  const map = adminContentMap();
  proof("orphan", m => { m.entries[0].parentId = "missing"; }, map);
  const changed = structuredClone(map); (changed.entries[0] as Mutable).parentId = "missing";
  expect(checkContentMap(changed)).toContainEqual(expect.objectContaining({ code: "orphan", entryId: "writer" }));
  expect(checkContentMap(changed)).not.toContainEqual(expect.objectContaining({ code: "missing-parent", entryId: "writer" }));
});
it("rejects a pin on a slide with a mutation proof", () => proof("pin", m => { m.entries[2].kind = "slide"; }));
it("rejects a missing pinned group target with a mutation proof", () => proof("pin", m => { m.entries[2].pin.group = "missing"; }));
it("rejects a pin with a missing entry identity", () => proof("pin", m => { delete m.entries[2].id; }));
it("rejects a relative web path with a mutation proof", () => proof("web-path", m => { m.entries[2].path = "agents/writer"; }));
it("refuses page paths outside the existing registered-route canonical contract and URL escapes", () => {
  for (const path of ["/agents/writer?mode=edit", "/agents/writer#copy", "/agents/../writer", "/agents/./writer", "/agents/writer/", "/agents/%77riter", "/\\evil.example/writer", "/\n/evil.example/writer"]) {
    proof("web-path", m => { m.entries[2].path = path; });
  }
  proof("web-path", m => { m.entries[2].path = "/guides/guide/\\evil.example"; }, sectionContentMap());
  const map = adminContentMap();
  expect(projectSitemap(map, { channel: "site", origin: "https://example.com" }).every(row => new URL(row.url).origin === "https://example.com")).toBe(true);
});
it("rejects web nesting deeper than three with a mutation proof", () => proof("depth", m => {
  m.entries.push({ ...m.entries[2], id: "deep", parentId: "guide.overview", path: "/guides/guide/overview/deep" });
}, sectionContentMap()));
it("rejects deck nesting deeper than two with a mutation proof", () => {
  const deck: ContentMap = { version: 1, publicationId: "example.deck", format: "deck.16x9", entries: [
    { id: "part", order: 0, title: "Part", slug: "part", kind: "group", source: { planItemId: "part" } },
    { id: "slide", parentId: "part", order: 0, title: "Slide", slug: "slide", kind: "slide", source: { planItemId: "slide" } },
  ] };
  expect(checkContentMap(deck)).toEqual([]);
  const changed = structuredClone(deck); (changed.entries as Mutable).push({ ...changed.entries[1], id: "deep", parentId: "slide", slug: "deep" });
  expect(checkContentMap(changed)).toContainEqual(expect.objectContaining({ code: "depth", severity: "P0" }));
  expect(checkContentMap(deck)).toEqual([]);
});
it("rejects action/entry ID collisions with a mutation proof", () => proof("action-id", m => { m.actions[0].id = "writer"; }));
it("rejects unknown formats with a mutation proof", () => proof("format", m => { m.format = "unknown"; }));
it("reports P0 without coercing malformed formats into property keys", () => {
  for (const format of [{ toString: "x" }, null, 2, "__proto__", "constructor"]) proof("format", m => { m.format = format; });
});
it("rejects unknown fields, malformed sources and executable action intents", () => {
  proof("contract", m => { m.executable = true; });
  proof("contract", m => { m.entries[2].source = { frameId: "frames.app-shell" }; });
  proof("contract", m => { m.actions[0].intent = () => {}; });
});
it("reports P0 instead of throwing on malformed section or parent paths", () => {
  proof("contract", m => { m.entries[2].path = 2; }, sectionContentMap());
  proof("contract", m => { m.entries[1].path = 2; }, sectionContentMap());
  proof("contract", m => { delete m.entries[2].path; m.entries[2].slug = 2; }, sectionContentMap());
});

it("projects the fixed admin route registry golden without inventing bindings", () => {
  expect(projectRoutes(adminContentMap(), adminRouteOptions())).toEqual({
    version: 1, consumer: "example", routes: [
      { routeId: "designer", planItemId: "app.designer", path: "/agents/designer", title: "Designer", channel: "admin", brand: { homeRouteId: "designer", label: "Example" }, entry: { file: "src/app/agents/designer/page.tsx", export: "default" }, composition: { complete: { kind: "designer" }, loader: { file: "src/data/designer.ts", export: "loadRoute" } } },
      { routeId: "writer", planItemId: "app.writer", path: "/agents/writer", title: "Writer", channel: "admin", brand: { homeRouteId: "designer", label: "Example" }, entry: { file: "src/app/agents/writer/page.tsx", export: "default" }, composition: { complete: { kind: "writer" }, loader: { file: "src/data/writer.ts", export: "loadRoute" } } },
      { routeId: "publisher", planItemId: "app.publisher", path: "/agents/publisher", title: "Publisher", channel: "admin", brand: { homeRouteId: "designer", label: "Example" }, entry: { file: "src/app/agents/publisher/page.tsx", export: "default" }, composition: { complete: { kind: "publisher" }, loader: { file: "src/data/publisher.ts", export: "loadRoute" } } },
    ],
  });
});
it("projects the fixed two-level admin navigation golden", () => {
  expect(projectNavigation(adminContentMap(), "designer")).toEqual({ tree: [
    { id: "agents", label: "Agents", children: [
      { id: "designer", label: "Designer", href: "/agents/designer" },
      { id: "writer", label: "Writer", href: "/agents/writer" },
      { id: "publisher", label: "Publisher", href: "/agents/publisher" },
    ] },
  ], activeId: "designer" });
});
it("projects the fixed command golden including every page and section, plus action groups", () => {
  expect(projectCommands(adminContentMap())).toEqual([
    { id: "agents", label: "Agents", items: [
      { id: "designer", label: "Designer", href: "/agents/designer" },
      { id: "writer", label: "Writer", href: "/agents/writer" },
      { id: "publisher", label: "Publisher", href: "/agents/publisher" },
    ] },
    { id: "Records", label: "Records", items: [{ id: "refresh", label: "Refresh records", action: "records.refresh" }] },
  ]);
});
it("keeps left navigation as the pinned subset of command destinations", () => {
  const map = adminContentMap(); delete (map.entries[2] as Mutable).pin;
  const nav = projectNavigation(map, "writer");
  const flat = (rows: readonly Mutable[]): string[] => rows.flatMap(row => [row.id, ...flat(row.children ?? [])]);
  const ids = flat(nav.tree).filter(id => map.entries.find(entry => entry.id === id)?.kind !== "group");
  const commands = projectCommands(map).flatMap(group => group.items.map(item => item.id));
  expect(ids).not.toContain("writer"); expect(commands).toContain("writer");
  expect(ids.every(id => commands.includes(id))).toBe(true);
});
it("projects breadcrumb and public-only sitemap goldens", () => {
  const map = adminContentMap();
  expect(projectBreadcrumbs(map, "designer")).toEqual([{ id: "agents", label: "Agents" }, { id: "designer", label: "Designer", href: "/agents/designer" }]);
  expect(() => projectSitemap(map, { channel: "admin", origin: "https://example.com" })).toThrow(/admin/);
  expect(projectSitemap(map, { channel: "site", origin: "https://example.com" })).toEqual([
    { url: "https://example.com/agents/designer" }, { url: "https://example.com/agents/writer" }, { url: "https://example.com/agents/publisher" },
  ]);
});
it("keeps projection outputs deterministic and map data immutable", () => {
  const map = adminContentMap(), before = JSON.stringify(map), shuffled = { ...map, entries: [...map.entries].reverse() };
  expect(projectNavigation(shuffled, "writer")).toEqual(projectNavigation(map, "writer"));
  expect(projectCommands(shuffled)).toEqual(projectCommands(map));
  expect(JSON.stringify(map)).toBe(before);
});
it("merges action groups by identity and rejects disconnected or foreign pins", () => {
  const map = adminContentMap(); (map.actions![0] as Mutable).group = "agents";
  const groups = projectCommands(map);
  expect(groups).toHaveLength(1); expect(groups[0]!.items.at(-1)).toEqual({ id: "refresh", label: "Refresh records", action: "records.refresh" });
  proof("pin", m => { delete m.entries[1].pin; }, sectionContentMap());
  proof("pin", m => { m.entries.push({ ...m.entries[0], id: "other", slug: "other" }); m.entries[2].pin.group = "other"; });
});
it("retains generic section capacity at depth three without publishing application-internal IA", () => {
  const map = sectionContentMap();
  expect(checkContentMap(map)).toEqual([]);
  expect(projectNavigation(map, "guide.overview")).toEqual({ tree: [{ id: "guides", label: "Guides", children: [
    { id: "guide", label: "Guide", href: "/guides/guide", children: [{ id: "guide.overview", label: "Overview", href: "/guides/guide/overview" }] },
  ] }], activeId: "guide.overview" });
  expect(projectCommands(map)).toEqual([{ id: "guides", label: "Guides", items: [{ id: "guide", label: "Guide", href: "/guides/guide" }, { id: "guide.overview", label: "Overview", href: "/guides/guide/overview" }] }]);
  expect(projectBreadcrumbs(map, "guide.overview")).toEqual([{ id: "guides", label: "Guides" }, { id: "guide", label: "Guide", href: "/guides/guide" }, { id: "guide.overview", label: "Overview", href: "/guides/guide/overview" }]);
  const query = { ...map, entries: map.entries.map(entry => entry.id === "guide.overview" ? { ...entry, path: "/guides/guide?view=overview" } : entry) };
  expect(checkContentMap(query)).toEqual([]);
});
it("adapts pinned completeRoute plan input only when content identities agree", () => {
  const map = adminContentMap(), options = adminRouteOptions();
  const planItems = map.entries.filter(entry => entry.kind === "page").map(entry => ({ id: entry.source.planItemId!, appRouteId: entry.id, completeRoute: { ...options.completeRoutes![entry.source.planItemId!]!, title: entry.title, path: entry.path!, brand: options.brand } }));
  const compatibility = { ...options, completeRoutes: undefined, planItems };
  expect(projectRoutes(map, compatibility)).toEqual(projectRoutes(map, options));
  expect(() => projectRoutes(map, { ...compatibility, planItems: planItems.map((item, i) => i === 1 ? { ...item, appRouteId: "wrong" } : item) })).toThrow(/disagrees/);
  expect(() => projectRoutes(map, { ...compatibility, planItems: planItems.map((item, i) => i === 1 ? { ...item, completeRoute: { ...item.completeRoute, path: "/wrong" } } : item) })).toThrow(/disagrees/);
});
it("uses an actual registered frame/section source and refuses fabricated or ambiguous sources", async () => {
  const { syntheticRoute } = await import("../core/__fixtures__/registered-route.js");
  const route = syntheticRoute();
  const map: ContentMap = { version: 1, publicationId: "tools", format: "web.page.responsive", entries: [
    { id: route.routeId, order: 0, title: route.title, path: route.path, kind: "page", pin: { nav: true }, source: { frameId: "frames.app-shell", sectionIds: ["sections.content"] } },
  ] };
  const options = { consumer: "example", channel: "admin" as const, brand: route.brand, registrations: [route] };
  expect(projectRoutes(map, options)).toEqual({ version: 1, consumer: "example", routes: [route] });
  expect(() => projectRoutes(map, { ...options, registrations: [] })).toThrow(/registered source/);
  expect(() => projectRoutes(map, { ...options, registrations: [route, route] })).toThrow(/registered source/);
  expect(() => projectRoutes({ ...map, entries: [{ ...map.entries[0]!, source: { frameId: "frames.app-shell", sectionIds: ["sections.missing"] } }] }, options)).toThrow(/registered source/);
});

it("accepts ordered page-local Section modules and host intents independently of publication commands", () => {
  const map: Mutable = adminContentMap();
  map.entries[1].actions = [
    { id: "explorer", label: "Explorer", icon: "assets.icon-folder", defaultOpen: true, module: { section: "sections.cell-explorer" } },
    { id: "open-app", label: "Open app", icon: "assets.icon-external-link", defaultOpen: false, intent: "open-app-dev-server" },
  ];
  expect(checkContentMap(map)).toEqual([]);
  expect(projectCommands(map)).toEqual(projectCommands(adminContentMap()));
  // An unavailable Section remains a reference for host NEED handling.
  map.entries[1].actions[0].module.section = "sections.unavailable-section";
  map.entries[1].actions[0].module.source = "designer.selection-needs";
  expect(checkContentMap(map)).toEqual([]);
});

it("rejects malformed page action unions, defaults, identities and unsupported fields", () => {
  const action = { id: "explorer", label: "Explorer", icon: "assets.icon-folder", defaultOpen: true, module: { section: "sections.cell-explorer" } };
  const invalid = [null, {}, "explorer", { ...action, id: "" }, { ...action, label: " " },
    { ...action, icon: "folder" }, { ...action, defaultOpen: "true" }, { ...action, callback: "run" },
    { ...action, module: "sections.cell-explorer" }, { ...action, module: { section: "sections.check-findings", source: "" } }, { ...action, module: { section: "components.button" } },
    { ...action, module: { section: "sections.cell-explorer", config: {} } },
    { ...action, intent: "open-app-dev-server" }, { ...action, module: undefined },
    { ...action, module: undefined, intent: "open-app-dev-server" },
    { ...action, module: undefined, defaultOpen: false, intent: "" }];
  for (const value of invalid) {
    proof("contract", map => { map.entries[1].actions = [value]; });
  }
  proof("contract", map => { map.entries[1].actions = {}; });
  proof("contract", map => { map.entries[0].actions = [action]; });
  proof("action-id", map => { map.entries[1].actions = [action, action]; });
});
