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
import { createAdminPageRegistry, adminPageRef, adminPageStaticContent, configs, fixtureSources } from "./__fixtures__/consumer-pages.mjs";
import { adminPageContent, writerCopy, createConsumerPageRegistry, consumerPageRef, type ConsumerPageConfig, type ConsumerPageSkeleton as AdminPageSkeleton } from "./index.js";
import { adminCopyFixture } from "./__fixtures__/copy.mjs";
import { createRegisteredPublicationSession } from "../registered-route-query.js";
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
const skeleton = { l0: [{ id: "strings", label: {id:"strings.admin.group.writer.strings"}, count: 1, estimate: 300, l1: [] }] };
const content = (reference: RuntimeContent["reference"], value: RuntimeJson): RuntimeContent => ({ reference, value, hash: runtimeHash(value) });
function setup(skeleton: AdminPageSkeleton = { l0: [{ id: "strings", label: {id:"strings.admin.group.writer.strings"}, count: 1, estimate: 300, l1: [] }] }, custom?: ConsumerPageConfig) {
  const engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: { ...fixture.options, packages: [...fixture.packages.filter(row => !packages.some(owned => owned.module === row.module)), ...packages] } };
  const profile = resolve(engine), copy = adminCopyFixture();
  const publication = { id: "admin", mainSlot: "body", frame: { leaf: "frames.app-shell" as const, content: { "skip-link": { kind: "copy" as const, ref: "admin.frame/skip-link" } } }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: profile.consumer, medium: "web" as const }, packIds: ["pack.admin"] };
  const { registry, pages, publicationHosts } = custom
    ? createConsumerPageRegistry({ publication, channel: "app", copy, configs: [custom], manifests: { [custom.id]: skeleton }, sources: { [custom.id]: fixtureSources(custom.id) }, map: { version: 1, publicationId: publication.id, format: "web.page.responsive", entries: [{ id: custom.entryId, title: copy(custom.title), path: "/catalog/inventory", kind: "page", order: 0, source: { planItemId: "app.inventory" }, pageConfig: custom.id }] } })
    : createAdminPageRegistry({ publication, copy, manifests: { designer: skeleton, writer: skeleton, publisher: skeleton }, itemTitles: { designer: {id:"strings.admin.page.designer"}, writer: {id:"strings.admin.page.writer"}, publisher: {id:"strings.admin.page.publisher"} } });
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
    for (const [name, value] of Object.entries({ "item/heading": { text: writerCopy({id:`strings.admin.page.${kind}`}), id: "strings" }, "item/stats": [{ id: "status", label: writerCopy({id:"strings.admin.status.draft"}) }], "item/fields": [{ label: writerCopy({id:"strings.admin.column.name"}), value: writerCopy({id:`strings.admin.page.${kind}`}) }], "item/status": writerCopy({id:"strings.admin.status.draft"}), "item/context": { id: "sample" }, context: { kind } })) values.set(adminPageRef(kind, name).ref, adminPageContent(copy, adminPageRef(kind, name, name.endsWith("heading") || name.endsWith("status") ? "copy" : "records"), value));
    for (const table of ["preview", "locales", "sections", "releases"]) {
      for (const [name, value] of Object.entries({ header: { heading: writerCopy({id:table === "preview" ? "strings.admin.column.preview" : `strings.admin.item.${table}`}) }, columns: [{ key: "name", label: writerCopy({id:"strings.admin.column.name"}), kind: "text" }], rows: [{ id: "sample", name: writerCopy({id:"strings.admin.page.writer"}), href: `/agents/${kind}/strings/sample` }], pagination: {} })) {
        const reference = adminPageRef(kind, `item/${table}/${name}`, name === "header" ? "copy" : name === "pagination" ? "region" : "records"); values.set(reference.ref, adminPageContent(copy, reference, value));
      }
    }
  }
  values.set("admin.frame/skip-link", content({ kind: "copy", ref: "admin.frame/skip-link" }, copy("strings.admin.action.backToPage", {page:copy("strings.admin.page.writer")})));
  const pixels = Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).map(([id, member]) => { const value = member.value.light as { unit: string; value: number }; return [id, value.value * (value.unit === "px" ? 1 : 16)]; }));
  const renderers = Object.fromEntries(manifest.fills.map(fill => [fill.renderer.id, fill.kind === "frame" ? (input: any) => input.slots.main : surfaceRuntimeRenderers[fill.leaf]!.render]));
  const runtime: RegisteredRouteRuntime = { assembly: { identity: { kind: "git", head: "a".repeat(40), tree: "b".repeat(40) }, engine, contracts: contracts as never, ports: { manifest, renderers, resolveContent: reference => values.get(reference.ref), frameOrder: ({layout,slots}) => [...Object.values(slots).flat(), ...layout], frameHost: { navigate: vi.fn() } }, themes: ["light"], states: ["default"], breakpointPixels: pixels, breakpointBasis: { renderer: layoutRenderer, environment: { kind: "SYNTHETIC 16px root font" } }, css: [{ id: "publisher-flow-stage.css", contents: flowStageStyleSheet(profile, "layouts.stack", "stack.workspace") }], assets: [], stageMeasurements: { renderer: layoutRenderer, environment: { kind: "SYNTHETIC width basis" }, cells: runtimeAssemblyCells(profile, ["light"], ["default"], [], pixels).map(cell => ({ cell, width: cell.width - 80 })) } }, instanceLibrary: { id: profile.consumer, role: "consumer", resolveFill: (leaf, config) => leaf === "layouts.stack" && config === "stack.workspace" ? { library: profile.consumer, leaf, config, headings: [], states: ["default"], renderer: layoutSource } : undefined, resolveContent: reference => reference }, registries, layoutRenderer, cell: { theme: "light", state: "default", width: 320 } };
  return { registry, pages, runtime, session, host, values, copy, publicationHosts };
}
describe("six native admin records through prepareRegisteredRoute (fixture declarations)", () => {
  it("refuses a consumer config member absent from the selected native header", () => {
    const config = structuredClone(configs[1]); delete config.item;
    Object.assign(config, { id: "inventory", entryId: "catalog.inventory", namespace: "inventory.records" });
    config.levels.l0.header.members.align = "unselected-consumer-member";
    const f = setup(skeleton, config), pair = f.pages.inventory;
    const bundle = pair.createSession({ publication: f.session, loaders: { chunk: async () => [], search: async () => [], item: async () => undefined }, navigation: { hash: () => "", scroll: vi.fn(), focus: vi.fn(), replaceState: vi.fn() } });
    bundle.page.activate();
    const result = prepareRegisteredRoute(f.registry, pair.list.routeId, { ...f.runtime, page: bundle.page, assembly: { ...f.runtime.assembly, ports: { ...f.runtime.assembly.ports, resolveContent: reference => bundle.resolveContent(reference) ?? f.values.get(reference.ref), sectionHosts: bundle.sectionHosts() } } });
    expect(result.status).toBe("refused");
    expect(result.findings.join(" ")).toMatch(/member/i);
  });
  it("loads a band on demand, resolves two native card repeats, and renders h2/h3/h4 with consumer rows", async () => {
    const inventory = structuredClone(configs[1]); delete inventory.item;
    Object.assign(inventory, { id: "inventory", entryId: "catalog.inventory", namespace: "inventory.records", columns: [{ key: "text", kind: "text", label: { id: "strings.admin.column.text" } }] });
    for (const custom of [undefined, inventory]) {
    const f = setup({ l0: [{ id: "strings", label: {id:"strings.admin.group.writer.strings"}, count: 4, estimate: 80, partition: "l1", l1: [{ id: "names", label: {id:"strings.admin.ia.writer.strings.identity-names"}, count: 4, estimate: 400, l2: ["primary", "secondary"].map(id => ({ id, label: {id:id === "primary" ? "strings.admin.column.key" : "strings.admin.column.text"}, count: 2, estimate: 200 })) }] }] }, custom);
    const pair = f.pages[custom?.id ?? "writer"], route = pair.list;
    const namespace = custom?.namespace ?? "admin.writer";
    if (custom) expect(route.routeId).toBe("catalog.inventory");
    const ref = (name: string, kind: RuntimeContent["reference"]["kind"] = "records") => ({ kind, ref: `fixture.writer/${name}` });
    const data: RuntimeContent[] = [
      content(consumerPageRef(namespace, "strings/names/band"), [{ id: "names", references: {
        [`${namespace}/band.heading`]: ref("band.heading", "copy"), [`${namespace}/band.stats`]: ref("band.stats"), [`${namespace}/cards`]: ref("cards"),
      } }]),
      content(ref("band.heading", "copy"), { text: writerCopy({id:"strings.admin.ia.writer.strings.identity-names"}), id: "strings--names" }),
      content(ref("band.stats"), [{ id: "count", label: writerCopy({id:"strings.admin.stats.total",values:{count:4}}) }]),
      content(ref("cards"), ["primary", "secondary"].map(id => ({ id, references: {
        [`${namespace}/card.header`]: ref(`${id}/header`, "copy"), [`${namespace}/card.rows`]: ref(`${id}/rows`), [`${namespace}/card.pagination`]: ref(`${id}/pagination`, "region"),
      } }))),
      ...["primary", "secondary"].flatMap(id => [
        content(ref(`${id}/header`, "copy"), { heading: writerCopy({id:id === "primary" ? "strings.admin.column.key" : "strings.admin.column.text"}), id:`strings--names--${id}`, level:4, count:2 }),
        content(ref(`${id}/rows`), [1, 2].map(index => ({ id: `${id}-${index}`, key: `${id}-${index}`, text: writerCopy({id:index === 1 ? "strings.admin.page.writer" : "strings.admin.column.text",locale:"ar"}), href: `/agents/writer/strings/${id}-${index}` }))),
        content(ref(`${id}/pagination`, "region"), { label: writerCopy({id:"strings.admin.pagination.label"}), showAll: writerCopy({id:"strings.admin.action.showAll",values:{count:2}}), previous: writerCopy({id:"strings.admin.pagination.previous"}), next: writerCopy({id:"strings.admin.pagination.next"}) }),
      ]),
    ];
    const loader = vi.fn(async () => data);
    const bundle = pair.createSession({ publication:f.session, loaders: {chunk:loader,search:async()=>[],item:async()=>undefined}, navigation:{hash:()=>"",scroll:vi.fn(),focus:vi.fn(),replaceState:vi.fn()} });
    const page = bundle.page; page.activate();
    const runtime = { ...f.runtime, page, assembly:{...f.runtime.assembly,ports:{...f.runtime.assembly.ports,resolveContent:reference=>bundle.resolveContent(reference) ?? f.values.get(reference.ref),sectionHosts:bundle.sectionHosts()}} };
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
    expect(html).toMatch(/<h2[^>]*[^]*Strings[^]*<h3[^>]*[^]*Names[^]*<h4[^>]*[^]*Key[^]*<h4[^>]*[^]*Text/);
    expect(html).toContain("الكاتب");
    expect(html).toContain("النص");
    }
  }, 120_000);
  it("prepares and renders every list and item through the selected existing Section renderers", async () => {
    const f = setup();
    for (const kind of ["designer", "writer", "publisher"] as const) for (const item of [false, true]) {
      const pair = f.pages[kind], route = item ? pair.item : pair.list;
      const bundle = pair.createSession({item,itemPath:item?`/agents/${kind}/strings/sample`:undefined,publication:f.session,loaders:{chunk:async()=>[],search:async()=>[],item:async(_l0,id)=>id === "sample"?{record:{id},content:[...f.values.values()].filter(row=>row.reference.ref.startsWith(`admin.${kind}/item/`))}:undefined},navigation:{hash:()=>"",scroll:vi.fn(),focus:vi.fn(),replaceState:vi.fn()}});
      const page=bundle.page;
      page.activate();
      if (item) {
        expect(await page.loadItem(`/agents/${kind}/strings/unknown`)).toMatchObject({ status: "not-found", code: 404 });
        expect(await page.loadItem(`/agents/${kind}/strings/sample`)).toMatchObject({ status: "ready", code: 200 });
      }
      const result = prepareRegisteredRoute(f.registry, route.routeId, { ...f.runtime, page, itemPath:bundle.itemPath, assembly:{...f.runtime.assembly,ports:{...f.runtime.assembly.ports,resolveContent:reference=>bundle.resolveContent(reference) ?? f.values.get(reference.ref),sectionHosts:bundle.sectionHosts()}} });
      expect(result.status, `${route.routeId}: ${JSON.stringify(result)}`).toBe("stream"); if (result.status !== "stream") continue;
      expect(result.chunks.map(chunk => chunk.result.status), JSON.stringify(result.chunks)).toEqual(["ready"]);
      const regions = result.renderRegions!(f.runtime.cell);
      const html = renderToStaticMarkup(<>{regions.chunks?.flatMap(chunk => chunk.content ?? [])}</>);
      expect(html).toContain(item ? f.copy(`strings.admin.page.${kind}`) : "Strings");
      expect(html).not.toContain("Order 1042");
      expect(regions.regions["page-module"]?.length).toBeGreaterThan(0);
      f.session.setPage(regions, page);
    }
    expect(f.host.bind).toHaveBeenCalledTimes(1);
    expect(f.host.bind.mock.calls[0]![0].inspector).toMatchObject({section:"sections.chat"});
  }, 120_000);
});
