import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { adminContentMap } from "./__fixtures__/admin.js";
import { contentMapFromCells, contentMapToCells } from "./cells.js";
import type { ContentMap } from "./contract.js";
import { pageId } from "./page-identity.js";
import { readPinnedPublication } from "./slots.js";

type JsonObject = Record<string, any>;
const roots: string[] = [];
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const path = await realpath(await mkdtemp(join(tmpdir(), "publisher-pinned-"))); roots.push(path); return path; }
const dir = (path: string, id: string) => join(path, "catalog", "bindings", id);
const candidatePath = (path: string, id: string) => join(dir(path, id), "candidates", "record-v1.json");
async function put(path: string, value: unknown) { await writeFile(path, json(value)); }
async function edit(path: string, change: (value: JsonObject) => void) { const value = JSON.parse(await readFile(path, "utf8")); change(value); await put(path, value); }
async function repin(path: string, id: string) {
  await put(join(dir(path, id), "pin.json"), {
    candidate: "record-v1.json", sha256: createHash("sha256").update(await readFile(candidatePath(path, id))).digest("hex"),
    pinnedBy: "migration:SLOT-MODEL", at: "2026-10-31T00:00:00Z",
  });
}
function ordinary(): ContentMap {
  const map = adminContentMap();
  return { ...map, redirects: [{ from: "/former", to: "/agents/designer", permanent: false }], entries: map.entries.map(entry => {
    const id = entry.id === "writer" ? "writerPanel" : entry.id === "publisher" ? "library.item" : entry.id;
    return { ...entry, id, ...(entry.kind !== "page" ? {} : { keywords: ["records", id], indexing: { mode: "noindex" as const, reason: "Preview" }, lastModified: "2026-10-30",
      ...(entry.id !== "designer" ? {} : { pageConfig: "designer", actions: [{ id: "browse", label: "Browse", icon: "assets.icon-folder", defaultOpen: true, module: { section: "sections.data-table" } }] }),
      ...(entry.id !== "writer" ? {} : { source: { frameId: "frames.app-shell", sectionIds: ["sections.data-table"] } }) }) };
  }) };
}
async function fixture(map = ordinary(), withRoutes = true) {
  const path = await root(), pages = map.entries.filter(entry => entry.kind !== "group");
  const pack = withRoutes ? { packId: map.publicationId, homeRouteId: pages[0]!.id, root: { kind: "local-origin", note: "Fixture origin" },
    roots: { documentation: "https://example.com" }, headers: [{ name: "x-fixture", value: "native" }],
    routes: pages.map(entry => ({ instanceId: entry.id, path: entry.path ?? `/${entry.slug}`, label: entry.title, ...(entry.keywords === undefined ? {} : { keywords: entry.keywords }),
      entry: { file: `views/${entry.id}.tsx`, export: "default" }, body: "plain", data: { loader: entry.id }, inputs: {}, manifest: { modules: [], actions: [] } })) } : undefined;
  await contentMapToCells(map, path, { date: "2026-10-30", routePack: pack });
  const oracle = await contentMapFromCells(path, map.publicationId);
  const routePack = pack === undefined ? undefined : JSON.parse(await readFile(join(path, "route-pack", `${map.publicationId}.json`), "utf8"));
  const oldTree = JSON.parse(await readFile(join(path, "tree.json"), "utf8"));
  const pubId = `publication.${map.publicationId}`, ids = [...pages.map(entry => pageId(entry.id)), pubId];
  await put(join(path, "ia.json"), { schema: "clossys.ia/1", source: "consumer#publisher", extensions: [], nodes: [{ id: "catalog", label: "Catalog", children: [{ id: "bindings", label: "Bindings", slots: ids }] }] });
  for (const [order, id] of ids.entries()) {
    await mkdir(join(dir(path, id), "candidates"), { recursive: true });
    const publication = id === pubId;
    await put(join(dir(path, id), "slot.json"), { schema: "clossys.slot/1", id, agent: "publisher", ia: { l1: "catalog", l2: "bindings", order }, kind: publication ? "publication" : "page", contract: {},
      inputs: publication ? ids.slice(0, -1) : [], uses: publication ? ids.slice(0, -1) : [] });
    if (publication) {
      const { routes: _routes, ...header } = pack ?? {};
      await put(candidatePath(path, id), { schema: "clossys.publication/1", format: map.format, entryOrder: map.entries.map(entry => entry.id), ...(pack ? { routePack: header } : {}),
        ...(map.actions === undefined ? {} : { actions: map.actions }), ...(map.redirects === undefined ? {} : { redirects: map.redirects }),
        meta: { source: { kind: "derived", ref: ["publisher:fixture"] }, tree: oldTree.tree[0] } });
    } else {
      const entry = pages.find(entry => pageId(entry.id) === id)!;
      const fields: JsonObject = { kind: entry.kind };
      for (const key of ["pageConfig", "icon", "description", "keywords", "lastModified"] as const) if (entry[key] !== undefined) fields[key] = entry[key];
      if (entry.kind === "external") fields.href = entry.href;
      if (entry.kind !== "external" && "planItemId" in entry.source) fields.planItemId = entry.source.planItemId;
      if (entry.indexing) { fields.indexing = entry.indexing.mode; if (entry.indexing.reason !== undefined) fields.indexingReason = entry.indexing.reason; }
      const route = pack?.routes.find(route => route.instanceId === entry.id);
      const { instanceId: _id, path: _path, label: _label, keywords: _keywords, ...extras } = route ?? {};
      await put(candidatePath(path, id), { schema: "clossys.page/1", title: entry.title, ...(entry.path === undefined ? { slug: entry.slug } : { path: entry.path }),
        frame: entry.kind !== "external" && "frameId" in entry.source ? entry.source.frameId : null,
        sections: entry.kind !== "external" && "sectionIds" in entry.source ? entry.source.sectionIds : [], copy: { heading: "strings.headings" }, ...(entry.pin ? { nav: entry.pin } : {}),
        meta: { source: { kind: "original", ref: [] }, entry: { publication: map.publicationId, entryId: entry.id, fields,
          entryMeta: entry.pin ? { pin: entry.pin } : {}, blocks: { ...(entry.constructs === undefined ? {} : { Constructs: entry.constructs }), ...(entry.manifest === undefined ? {} : { Manifest: entry.manifest }),
            ...(entry.actions === undefined ? {} : { Actions: entry.actions }), ...(route === undefined ? {} : { Route: extras }) } } } });
    }
    await repin(path, id);
  }
  return { path, map: oracle, routePack, pubId, ids };
}
async function selectedBytes(path: string, ids: string[]) {
  return await Promise.all(ids.flatMap(id => [candidatePath(path, id), join(dir(path, id), "pin.json")]).map(file => readFile(file)));
}

it("NATIVE projection equals the legacy oracle exactly, then survives removal of all legacy stores without changing candidate or pin bytes", async () => {
  const f = await fixture(), before = await selectedBytes(f.path, f.ids);
  expect(f.map).toEqual(ordinary());
  expect(await readPinnedPublication(f.path, f.map.publicationId)).toEqual({ map: f.map, routePack: f.routePack });
  for (const name of ["tree.json", "cells", "content-map", "route-pack", "compile.json"]) await rm(join(f.path, name), { recursive: true, force: true });
  expect(await readPinnedPublication(f.path, f.map.publicationId)).toEqual({ map: f.map, routePack: f.routePack });
  expect(await selectedBytes(f.path, f.ids)).toEqual(before);
  expect(JSON.parse((await readFile(candidatePath(f.path, "page.designer"))).toString()).copy).toEqual({ heading: "strings.headings" });
});

it("NATIVE preserves a nonweb format, slide kind and slug without inventing a route pack", async () => {
  const map: ContentMap = { version: 1, publicationId: "example.deck", format: "deck.16x9", entries: [{ id: "openingSlide", kind: "slide", title: "Opening", slug: "opening", order: 0, source: { frameId: "frames.deck", sectionIds: [] } }] };
  const f = await fixture(map, false);
  expect(await readPinnedPublication(f.path, map.publicationId)).toEqual({ map });
});

it("NATIVE preserves external href and publication headers", async () => {
  const map: ContentMap = { version: 1, publicationId: "example.external", format: "web.page.responsive", entries: [{ id: "external.docs", kind: "external", title: "Docs", path: "/docs", order: 0, href: "https://example.com/docs", pin: { nav: true } }] };
  const f = await fixture(map);
  expect(await readPinnedPublication(f.path, map.publicationId)).toEqual({ map, routePack: f.routePack });
});

it("NATIVE ignores a newer unselected candidate and preserves exact migration identities", async () => {
  const f = await fixture();
  await put(join(dir(f.path, "page.writer-panel"), "candidates", "record-v99.json"), { title: "Unselected" });
  expect((await readPinnedPublication(f.path, f.map.publicationId)).map.entries.map(entry => entry.id)).toEqual(["agents", "designer", "writerPanel", "library.item"]);
  expect(await contentMapFromCells(f.path, f.map.publicationId)).toEqual(f.map);
});

it("NATIVE reads the repository's actual selected Studio publication and page payloads", async () => {
  const path = fileURLToPath(new URL("../../../../clossys/agents/publisher/", import.meta.url));
  const ia = JSON.parse(await readFile(join(path, "ia.json"), "utf8"));
  const locations = new Map<string, string>();
  for (const node of ia.nodes) for (const child of node.children) for (const id of child.slots) locations.set(id, join(path, node.id, child.id, id));
  const selected = async (id: string) => {
    const folder = locations.get(id)!, pin = JSON.parse(await readFile(join(folder, "pin.json"), "utf8"));
    return JSON.parse(await readFile(join(folder, "candidates", pin.candidate), "utf8"));
  };
  const publication = await selected("publication.studio"), result = await readPinnedPublication(path, "studio");
  expect(result.map.format).toBe(publication.format);
  expect(result.map.entries.map(entry => entry.id)).toEqual(publication.entryOrder);
  const { routes, ...header } = result.routePack as JsonObject;
  expect(header).toEqual(publication.routePack);
  for (const entry of result.map.entries.filter(entry => entry.kind !== "group")) {
    const page = await selected(pageId(entry.id));
    expect(entry.title).toBe(page.title);
    expect(entry.path).toBe(page.path);
    expect(entry.source).toEqual({ frameId: page.frame, sectionIds: page.sections });
    expect(routes.find((route: JsonObject) => route.instanceId === entry.id)).toEqual({ ...page.meta.entry.blocks.Route, instanceId: entry.id, path: entry.path, label: entry.title,
      ...(entry.keywords === undefined ? {} : { keywords: entry.keywords }) });
  }
});

it("NATIVE hash-verification mutation control refuses tampered selected bytes even while valid legacy fallback exists", async () => {
  const f = await fixture();
  await edit(candidatePath(f.path, "page.designer"), value => { value.title = "Tampered"; });
  expect(await contentMapFromCells(f.path, f.map.publicationId)).toEqual(f.map);
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/hash drift/);
});

it("NATIVE legacy-fallback-restoration mutation control refuses an unpinned page despite valid legacy and generated outputs", async () => {
  const f = await fixture();
  await rm(join(dir(f.path, "page.designer"), "pin.json"));
  expect(await contentMapFromCells(f.path, f.map.publicationId)).toEqual(f.map);
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/pin.json.*Missing native record/);
});

it.each([
  ["invalid format", (v: JsonObject) => { v.format = "unknown"; }, /format/],
  ["colliding entry identities", (v: JsonObject) => { v.entryOrder.push("writer-panel"); }, /collision/],
  ["duplicate entry identity", (v: JsonObject) => { v.entryOrder.push("designer"); }, /Duplicate/],
  ["unplaced page", (v: JsonObject) => { v.entryOrder.push("unplaced"); }, /Unplaced/],
  ["unknown tree reference", (v: JsonObject) => { v.meta.tree.children[0].cells.push("page.foreign"); }, /stable entryOrder/],
  ["duplicate placement", (v: JsonObject) => { v.meta.tree.children[0].cells.push("page.designer"); }, /Duplicate page/],
  ["missing tree", (v: JsonObject) => { delete v.meta.tree; }, /tree snapshot/],
  ["conflicting route header", (v: JsonObject) => { v.routePack.packId = "foreign"; }, /route pack header/],
] as const)("NATIVE rejects %s with an intact publication hash", async (_name, mutate, message) => {
  const f = await fixture(); await edit(candidatePath(f.path, f.pubId), mutate); await repin(f.path, f.pubId);
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(message);
});

it.each([
  ["foreign publication", (v: JsonObject) => { v.meta.entry.publication = "foreign"; }, /identity/],
  ["foreign entry", (v: JsonObject) => { v.meta.entry.entryId = "foreign"; }, /identity/],
  ["conflicting title", (v: JsonObject) => { v.meta.entry.fields.title = "Conflicting"; }, /Conflicting title/],
  ["missing route", (v: JsonObject) => { delete v.meta.entry.blocks.Route; }, /Missing Route/],
  ["invalid source", (v: JsonObject) => { v.meta.source = { kind: "derived", ref: [] }; }, /source/],
  ["conflicting source", (v: JsonObject) => { v.frame = "frames.extra"; }, /source/],
  ["invalid copy", (v: JsonObject) => { v.copy.heading = 7; }, /page contract/],
  ["wrong group", (v: JsonObject) => { v.nav.group = "foreign"; }, /navigation/],
] as const)("NATIVE rejects selected page %s after repinning its bytes", async (_name, mutate, message) => {
  const f = await fixture(); await edit(candidatePath(f.path, "page.designer"), mutate); await repin(f.path, "page.designer");
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(message);
});

it("NATIVE cannot borrow a page not declared by the publication slot", async () => {
  const f = await fixture();
  await edit(join(dir(f.path, f.pubId), "slot.json"), value => { value.inputs = value.inputs.filter((id: string) => id !== "page.designer"); });
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/not declared by this publication/);
});

it.each(["wrong kind", "wrong agent", "wrong IA position", "wrong slot identity"])("NATIVE refuses %s in slot.json", async name => {
  const f = await fixture();
  await edit(join(dir(f.path, "page.designer"), "slot.json"), value => {
    if (name === "wrong kind") value.kind = "publication";
    if (name === "wrong agent") value.agent = "writer";
    if (name === "wrong IA position") value.ia.order = 99;
    if (name === "wrong slot identity") value.id = "page.foreign";
  });
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/slot identity/);
});

it("NATIVE rejects duplicate IA placement and unsafe paths", async () => {
  const f = await fixture(), path = join(f.path, "ia.json"), original = await readFile(path);
  await edit(path, value => { value.nodes[0].children[0].slots.push("page.designer"); });
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/Duplicate IA/);
  await writeFile(path, original);
  await edit(path, value => { value.nodes[0].id = "../foreign"; });
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/Unsafe/);
});

it.each(["missing candidate", "malformed pin", "unsafe candidate name", "malformed selected candidate", "candidate symlink", "slot folder symlink"])("NATIVE rejects %s without a legacy fallback", async name => {
  const f = await fixture(), id = "page.designer", pin = join(dir(f.path, id), "pin.json"), selected = candidatePath(f.path, id);
  if (name === "missing candidate") await rm(selected);
  if (name === "malformed pin") await writeFile(pin, "{");
  if (name === "unsafe candidate name") await edit(pin, value => { value.candidate = "../../foreign-v1.json"; });
  if (name === "malformed selected candidate") { await writeFile(selected, "{"); await repin(f.path, id); }
  if (name === "candidate symlink") { const source = join(await root(), "candidate.json"); await writeFile(source, await readFile(selected)); await rm(selected); await symlink(source, selected); }
  if (name === "slot folder symlink") { const source = await root(); await rm(dir(f.path, id), { recursive: true }); await symlink(source, dir(f.path, id)); }
  await expect(readPinnedPublication(f.path, f.map.publicationId)).rejects.toThrow(/Missing native record|Malformed JSON|Unsafe|Symbolic/);
});
