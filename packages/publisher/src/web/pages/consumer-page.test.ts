import { describe, expect, it } from "vitest";
import examples from "../../../examples/admin-pages.config.json" with { type: "json" };
import { adminCopyFixture } from "./__fixtures__/copy.mjs";
import { createConsumerPageRegistry, checkConsumerPageConfig } from "./admin-page.js";
import { checkContentMap } from "../../content-map/check.js";
import { fixtureSources } from "./__fixtures__/consumer-pages.mjs";
import { projectOutline, projectToc, projectNavigation, projectCommands, projectSitemap } from "../../content-map/projections.js";
import { projectPageOutline } from "../../content/taxonomy.js";

const copy = adminCopyFixture();
const publication = { id: "catalog", mainSlot: "body", frame: { leaf: "frames.app-shell" as const }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: "example", medium: "web" as const }, packIds: [] };
const skeleton = { l0: [{ id: "records", label: { id: "strings.admin.group.writer.strings" }, count: 0, estimate: 120, l1: [] }] };
function fixture() {
  const config = structuredClone(examples[1]!);
  Object.assign(config, { id: "inventory", entryId: "catalog.inventory", namespace: "catalog.inventory" });
  config.item.entryId = "catalog.inventory.item";
  const entries = [{ id: config.entryId, order: 0, title: copy(config.title), path: "/catalog/inventory", kind: "page" as const, source: { planItemId: "app.inventory" }, pageConfig: config.id }, { id: config.item.entryId, parentId: config.entryId, order: 0, title: copy(config.title), path: "/catalog/inventory/[l0]/[id]", kind: "page" as const, source: { planItemId: "app.inventory.item" }, pageConfig: config.id }];
  return { config, map: { version: 1 as const, publicationId: publication.id, format: publication.format, entries } };
}
describe("consumer-owned page composition", () => {
  it("builds a fourth consumer publication from explicit levels and a checked map reference", () => {
    const { config, map } = fixture();
    expect(checkContentMap(map)).toEqual([]);
    const result = createConsumerPageRegistry({ publication, channel: "site", copy, map, configs: [config], manifests: { inventory: skeleton }, sources: { inventory: fixtureSources("inventory") } });
    expect(result.registry.routes.map(route => route.path)).toEqual(["/catalog/inventory", "/catalog/inventory/[l0]/[id]"]);
    expect(result.pages.inventory.list.routeId).toBe("catalog.inventory");
    expect(result.pages.inventory.list.channel).toBe("site");
    expect(result.copyPreview).toEqual({ target: "preview", draft: true });
    expect(result.pages.inventory.list.composition.binding.regions.main[0]).toMatchObject(config.levels.l0.header);
    expect(result.pages.inventory.levels).toEqual({ l0: "normalize", l1: "unlock", l2: "cohere", l3: "create" });
    expect(result.pages.inventory.staticContent.some(row => row.reference.ref.startsWith("catalog.inventory/"))).toBe(true);
  });
  it("refuses malformed level verbs and missing, duplicate or orphan page configs", () => {
    const { config, map } = fixture();
    expect(checkConsumerPageConfig({ ...config, levels: { ...config.levels, l2: { ...config.levels.l2, verb: "create" } } })).not.toEqual([]);
    expect(checkConsumerPageConfig({ ...config, levels: { ...config.levels, l0: { ...config.levels.l0, header: { section: "components.button" } } } })).not.toEqual([]);
    const options = { publication, channel: "site" as const, copy, map, manifests: { inventory: skeleton }, sources: { inventory: fixtureSources("inventory") } };
    expect(() => createConsumerPageRegistry({ ...options, configs: [] })).toThrow(/config/i);
    expect(() => createConsumerPageRegistry({ ...options, configs: [config, config] })).toThrow(/config/i);
    expect(() => createConsumerPageRegistry({ ...options, configs: [{ ...config, id: "orphan" }] })).toThrow(/config/i);
    expect(() => createConsumerPageRegistry({ ...options, configs: [config], map: { ...map, entries: map.entries.map(entry => ({ ...entry, title: "Unbound title" })) } })).toThrow(/title|Writer/i);
    expect(() => createConsumerPageRegistry({ ...options, configs: [config], sources: { inventory: { ...fixtureSources("inventory"), runtime: { file: "../escape.ts", export: "useRuntime" } } } })).toThrow(/source/i);
  });
  it("joins native placements, counts and Writer titles to all map projections and refuses conflicting trees", () => {
    const { config, map } = fixture();
    const populated = { l0: [{ ...skeleton.l0[0]!, count: 2, l1: [{ id: "active", label: config.title, count: 2, estimate: 80, l2: [{ id: "current", label: config.title, count: 2, estimate: 40 }] }] }] };
    const options = { publication, channel: "site" as const, copy, configs: [config], manifests: { inventory: populated }, sources: { inventory: fixtureSources("inventory") } };
    const result = createConsumerPageRegistry({ ...options, map: { ...map, entries: map.entries.map(entry => ({ ...entry, pin: { nav: true as const } })) } });
    const entry = result.map.entries[0]!, native = result.pages.inventory;
    expect(entry.manifest).toEqual(native.manifest);
    expect(entry.constructs).toEqual({ main: native.list.composition.binding.regions.main });
    const outline = projectPageOutline({ fills: entry.constructs! }, entry.manifest!);
    expect(entry.manifest!.l0[0]).toMatchObject({ count: 2, label: copy(skeleton.l0[0]!.label), section: { slot: "main", index: 0 } });
    expect(outline.anchors).toHaveLength(3);
    const projected = projectOutline(result.map)[0]!;
    expect(projected).toMatchObject({ id: entry.id, label: entry.title, href: entry.path });
    expect(projected.children![0]).toMatchObject({ id: `${entry.id}#${outline.anchors[0]}`, label: outline.headings[0]!.label });
    expect(projectToc(result.map).filter(row => row.id.startsWith(`${entry.id}#`)).map(row => row.id)).toEqual(outline.anchors.map(id => `${entry.id}#${id}`));
    expect(projectNavigation(result.map, entry.id).tree[0]).toMatchObject({ id: entry.id, label: entry.title });
    expect(projectCommands(result.map)[0]!.items[0]).toMatchObject({ id: entry.id, label: entry.title });
    expect(projectSitemap(result.map, { channel: "site", origin: "https://example.test" })[0]!.url).toBe(`https://example.test${entry.path}`);
    expect(() => createConsumerPageRegistry({ ...options, map: result.map })).not.toThrow();
    const changed = structuredClone(result.map);
    changed.entries[0]!.manifest!.l0[0]!.count = 99;
    expect(() => createConsumerPageRegistry({ ...options, map: changed })).toThrow(/conflict/);
  });
  it("permits pageConfig only on page entries", () => {
    const { map } = fixture();
    expect(checkContentMap({ ...map, entries: [{ ...map.entries[0], kind: "group" }] }).some(finding => finding.code === "contract")).toBe(true);
  });
});
