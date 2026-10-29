/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBuildCatalog, planSurfaceRuntime, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContent, RuntimeJson } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { surfaceRuntimeRenderers } from "@clossys/designer/frames";
import { packageSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { createAdminPageRegistry, adminPageRef, adminPageStaticContent, type AdminPageSkeleton } from "./index.js";
import { createRegisteredPageSession, createRegisteredPublicationSession } from "../registered-route-query.js";
import { prepareRegisteredRoute } from "../registered-route-binding.js";
import type { RegisteredRouteRuntime } from "../registered-route-binding.js";
import { registeredLayoutSourcePin } from "../../core/layout-fill-source.js";
import { flowStageStyleSheet } from "../../core/flow-stage.js";
import { FORMAT_LEAVES } from "../../formats/index.js";
import { LAYOUT_LEAVES } from "../../layouts/resolve.js";
import type { InstanceRegistries } from "../../core/instance-binding.js";

let fixture: Awaited<ReturnType<typeof packageSurfaceLibrary>>;
let packages: Awaited<ReturnType<typeof readSurfacePackageEvidence>>;
beforeAll(async () => {
  fixture = await packageSurfaceLibrary();
  packages = await readSurfacePackageEvidence(["@clossys/designer/frames", "@clossys/designer/shell"].map(module => ({ frames: { pointer: { impl: { kind: "package", module } } } })) as Parameters<typeof readSurfacePackageEvidence>[0]);
}, 120_000);
const skeleton = { l0: [{ id: "strings", label: "Strings", count: 1, estimate: 300, l1: [] }] };
const content = (reference: RuntimeContent["reference"], value: RuntimeJson): RuntimeContent => ({ reference, value, hash: runtimeHash(value) });
function setup(skeleton: AdminPageSkeleton = { l0: [{ id: "strings", label: "Strings", count: 1, estimate: 300, l1: [] }] }) {
  const engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: { ...fixture.options, packages: [...fixture.packages.filter(row => !packages.some(owned => owned.module === row.module)), ...packages] } };
  const profile = resolve(engine), copy = (id: string) => id.split(".").at(-1)!;
  const publication = { id: "admin", mainSlot: "body", frame: { leaf: "frames.app-shell" as const, content: { "skip-link": { kind: "copy" as const, ref: "admin.frame/skip-link" } } }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: profile.consumer, medium: "web" as const }, packIds: ["pack.admin"] };
  const { registry, pages } = createAdminPageRegistry({ publication, copy, manifests: { designer: skeleton, writer: skeleton, publisher: skeleton } });
  // Real adopted renderer sources; SYNTHETIC flow declarations do not qualify the catalog's substrate coverage.
  const leaves = ["frames.app-shell", "sections.section-header", "sections.band", "sections.data-table", "sections.record-detail", "sections.table-of-contents", "sections.chat"];
  const plan = planSurfaceRuntime({ engine, packages: engine.surfaceOptions.packages, leaves, renderers: Object.fromEntries(leaves.map(leaf => [leaf, { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" }])) });
  expect(plan.gaps).toEqual([]);
  const manifest = { ...plan.manifest, fills: plan.manifest.fills.flatMap(fill => fill.leaf === "sections.section-header" ? [fill, ...["level-2", "level-3"].map(config => ({ ...fill, config }))] : [fill]) };
  const contracts = { ...loadBuildCatalog(), slots: fixture.catalog.surfaces!.slots.map(slot => slot.contract.kind === "section" ? { ...slot, contract: { ...slot.contract, substrates: ["flow" as const], substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC-admin-pages-runtime.test.tsx", name: "fixture declaration only" }] } } : slot) };
  const registries: InstanceRegistries = { formats: FORMAT_LEAVES, layouts: LAYOUT_LEAVES, tokens: [], frames: [{ id: "frames.app-shell", status: "draft", contract: { surface: "app", configs: [], stage: { accepts: ["flow"], scroll: "region" } } }], sections: contracts.slots.filter(slot => slot.contract.kind === "section").map(slot => ({ id: slot.id as `sections.${string}`, status: "draft", contract: { surface: "both", configs: slot.id === "sections.section-header" ? ["level-2", "level-3"] : [], slots: (slot.contract as { slots: readonly { name: string; type: "records"; required: boolean }[] }).slots, substrates: ["flow"], substrateTests: [{ substrate: "flow", file: "SYNTHETIC-admin-pages-runtime.test.tsx", name: "fixture declaration only" }] } })) };
  const layoutPin = registeredLayoutSourcePin("layouts.stack")!;
  const layoutSource = { entry: layoutPin.entry, files: Object.fromEntries(Object.keys(layoutPin.files).map(file => [file, readFileSync(resolvePath("src", file), "utf8")])), dependencies: {} };
  const layoutRenderer = { id: "Stack", source: layoutSource, sourceHash: runtimeHash(layoutSource) };
  const host = { bind: vi.fn(), setRegions: vi.fn(), setState: vi.fn(), setCommands: vi.fn(), setChunks: vi.fn() }, session = createRegisteredPublicationSession(registry.publication!, host);
  const values = new Map<string, RuntimeContent>();
  for (const kind of ["designer", "writer", "publisher"] as const) {
    for (const value of adminPageStaticContent(kind, skeleton, copy)) values.set(value.reference.ref, value);
    for (const [name, value] of Object.entries({ "item/heading": { text: "Selected item", id: "strings" }, "item/stats": [{ id: "status", label: "Draft" }], "item/fields": [{ id: "name", label: "Name", value: "Sample" }], "item/status": "Draft", "item/context": { id: "sample" }, context: { kind } })) values.set(adminPageRef(kind, name).ref, content(adminPageRef(kind, name, name.endsWith("heading") || name.endsWith("status") ? "copy" : "records"), value));
    for (const table of ["preview", "locales", "sections", "releases"]) {
      for (const [name, value] of Object.entries({ header: { heading: table }, columns: [{ key: "name", label: "Name", kind: "text" }], rows: [{ id: "sample", name: "Sample", href: `/agents/${kind}/strings/sample` }], pagination: {} })) {
        const reference = adminPageRef(kind, `item/${table}/${name}`, name === "header" ? "copy" : name === "pagination" ? "region" : "records"); values.set(reference.ref, content(reference, value));
      }
    }
  }
  values.set("admin.frame/skip-link", content({ kind: "copy", ref: "admin.frame/skip-link" }, "Skip to content"));
  values.set("admin.chat/parts", content({ kind: "records", ref: "admin.chat/parts" }, [{id:"welcome",role:"assistant",content:"Hello"}]));
  values.set("admin.chat/composer", content({ kind: "region", ref: "admin.chat/composer" }, { label: "Chat", placeholder: "Message" }));
  const pixels = Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).map(([id, member]) => { const value = member.value.light as { unit: string; value: number }; return [id, value.value * (value.unit === "px" ? 1 : 16)]; }));
  const renderers = Object.fromEntries(manifest.fills.map(fill => [fill.renderer.id, fill.kind === "frame" ? (input: any) => input.slots.main : surfaceRuntimeRenderers[fill.leaf]!.render]));
  const runtime: RegisteredRouteRuntime = { assembly: { identity: { kind: "git", head: "a".repeat(40), tree: "b".repeat(40) }, engine, contracts: contracts as never, ports: { manifest, renderers, resolveContent: reference => values.get(reference.ref), frameOrder: ({layout,slots}) => [...Object.values(slots).flat(), ...layout], frameHost: { navigate: vi.fn() } }, themes: ["light"], states: ["default"], breakpointPixels: pixels, breakpointBasis: { renderer: layoutRenderer, environment: { kind: "SYNTHETIC 16px root font" } }, css: [{ id: "publisher-flow-stage.css", contents: flowStageStyleSheet(profile, "layouts.stack", "stack.workspace") }], assets: [], stageMeasurements: { renderer: layoutRenderer, environment: { kind: "SYNTHETIC width basis" }, cells: runtimeAssemblyCells(profile, ["light"], ["default"], [], pixels).map(cell => ({ cell, width: cell.width - 80 })) } }, instanceLibrary: { id: profile.consumer, role: "consumer", resolveFill: (leaf, config) => leaf === "layouts.stack" && config === "stack.workspace" ? { library: profile.consumer, leaf, config, headings: [], states: ["default"], renderer: layoutSource } : undefined, resolveContent: reference => reference }, registries, layoutRenderer, cell: { theme: "light", state: "default", width: 320 } };
  return { registry, pages, runtime, session, host, values };
}
describe("six native admin records through prepareRegisteredRoute (fixture declarations)", () => {
  it("loads a band on demand, resolves two native card repeats, and renders h2/h3/h4 with consumer rows", async () => {
    const f = setup({ l0: [{ id: "strings", label: "Strings", count: 4, estimate: 80, partition: "l1", l1: [{ id: "names", label: "Names", count: 4, estimate: 400, l2: ["primary", "secondary"].map(id => ({ id, label: id, count: 2, estimate: 200 })) }] }] });
    const pair = f.pages.writer, route = pair.list;
    const ref = (name: string, kind: RuntimeContent["reference"]["kind"] = "records") => ({ kind, ref: `fixture.writer/${name}` });
    const data: RuntimeContent[] = [
      content(adminPageRef("writer", "strings/names/band"), [{ id: "names", references: {
        "admin.writer/band.heading": ref("band.heading", "copy"), "admin.writer/band.stats": ref("band.stats"), "admin.writer/cards": ref("cards"),
      } }]),
      content(ref("band.heading", "copy"), { text: "Names", id: "strings--names" }),
      content(ref("band.stats"), [{ id: "count", label: "4 records" }]),
      content(ref("cards"), ["primary", "secondary"].map(id => ({ id, references: {
        "admin.writer/card.header": ref(`${id}/header`, "copy"), "admin.writer/card.rows": ref(`${id}/rows`), "admin.writer/card.pagination": ref(`${id}/pagination`, "region"),
      } }))),
      ...["primary", "secondary"].flatMap(id => [
        content(ref(`${id}/header`, "copy"), { heading: id }),
        content(ref(`${id}/rows`), [1, 2].map(index => ({ id: `${id}-${index}`, key: `${id}-${index}`, text: `Copy ${id} ${index}`, href: `/agents/writer/strings/${id}-${index}` }))),
        content(ref(`${id}/pagination`, "region"), { label: "Pages", showAll: "Show all (2)", previous: "Previous", next: "Next", summary: "Page" }),
      ]),
    ];
    const loader = vi.fn(async () => data);
    const page = createRegisteredPageSession({ routeId: route.routeId, page: route.composition.binding, path: route.path, manifest: pair.manifest, query: pair.query, publication: f.session, loaders: { chunk: loader, search: async () => [], item: async () => undefined }, navigation: { hash: () => "", scroll: vi.fn(), focus: vi.fn(), replaceState: vi.fn() } });
    page.activate();
    const runtime = { ...f.runtime, page };
    const before = prepareRegisteredRoute(f.registry, route.routeId, runtime);
    expect(before.status).toBe("stream");
    if (before.status === "stream") expect(before.chunks.map(chunk => chunk.result.status)).toEqual(["ready", "pending"]);
    expect(loader).not.toHaveBeenCalled();
    await page.requestChunk({ l0: "strings", l1: "names" });
    const after = prepareRegisteredRoute(f.registry, route.routeId, runtime);
    expect(after.status, JSON.stringify(after)).toBe("stream"); if (after.status !== "stream") return;
    expect(after.chunks.map(chunk => chunk.result.status), JSON.stringify(after.chunks)).toEqual(["ready", "ready"]);
    expect(loader).toHaveBeenCalledExactlyOnceWith({ l0: "strings", l1: "names" });
    const html = renderToStaticMarkup(<>{after.renderRegions!(runtime.cell).chunks?.flatMap(chunk => chunk.content ?? [])}</>);
    expect(html).toMatch(/<h2[^>]*[^]*Strings[^]*<h3[^>]*[^]*Names[^]*<h4[^>]*[^]*primary[^]*<h4[^>]*[^]*secondary/);
    expect(html).toContain("Copy primary 1");
    expect(html).toContain("Copy secondary 2");
  }, 120_000);
  it("prepares and renders every list and item through the selected existing Section renderers", async () => {
    const f = setup();
    for (const kind of ["designer", "writer", "publisher"] as const) for (const item of [false, true]) {
      const pair = f.pages[kind], route = item ? pair.item : pair.list;
      const page = createRegisteredPageSession({ routeId: route.routeId, page: route.composition.binding, path: route.path, manifest: item ? pair.itemManifest : pair.manifest, query: pair.query, publication: f.session, loaders: { chunk: async () => [], search: async () => [], item: async () => ({ record: { id: "sample" }, content: [] }) }, navigation: { hash: () => "", scroll: vi.fn(), focus: vi.fn(), replaceState: vi.fn() } });
      page.activate();
      const result = prepareRegisteredRoute(f.registry, route.routeId, { ...f.runtime, page });
      expect(result.status, `${route.routeId}: ${JSON.stringify(result)}`).toBe("stream"); if (result.status !== "stream") continue;
      expect(result.chunks.map(chunk => chunk.result.status), JSON.stringify(result.chunks)).toEqual(["ready"]);
      const regions = result.renderRegions!(f.runtime.cell);
      const html = renderToStaticMarkup(<>{regions.chunks?.flatMap(chunk => chunk.content ?? [])}</>);
      expect(html).toContain(item ? "Selected item" : "Strings");
      expect(regions.regions["page-module"]?.length).toBeGreaterThan(0);
      f.session.setPage(regions, page);
    }
    expect(f.host.bind).toHaveBeenCalledTimes(1);
    expect(f.host.bind.mock.calls[0]![0].inspector).toMatchObject({section:"sections.chat"});
  }, 120_000);
});
