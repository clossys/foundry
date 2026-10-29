// Uses the existing P1b runtime fixture with explicit shared copy sources.
/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createElement, Fragment } from "react";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBuildCatalog, planSurfaceRuntime, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContent, RuntimeJson } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { surfaceRuntimeRenderers } from "@clossys/designer/frames";
import { packageSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { createAdminPageRegistry, adminPageRef, adminPageStaticContent, adminPageContent, writerCopy, type AdminPageSkeleton } from "../../../../publisher/src/web/pages/index.js";
import { createAdminPageCopy } from "../../../../publisher/src/web/pages/admin-copy.js";
import { prepareAdminPageCopyEnvelopes } from "../../../../publisher/src/web/pages/admin-copy-source.js";
import { ADMIN_COMMON_COPY_EN } from "../../admin-common.js";
import { ADMIN_PAGES_COPY_EN } from "../../admin-pages.js";
const readCopy = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const copySources = () => [
  { source: "admin-pages.r1.en.json", envelope: ADMIN_PAGES_COPY_EN },
  ...["admin-studio.r1.en.json", "admin-chat.r1.en.json", "admin-writer-paging.r1.en.json"].map(source => ({ source, envelope: readCopy(`../records/${source}`) })),
  { source: "common-labels.r1.en.json", envelope: ADMIN_COMMON_COPY_EN },
];
const adminCopyFixture = () => createAdminPageCopy({ locale: "en", envelopes: prepareAdminPageCopyEnvelopes([...copySources(), { source: "admin-pages.r1.ar.json", envelope: readCopy("./admin-pages.r1.ar.json") }]) });
const everyPageCell = () => {
  const sources = copySources(), pages = sources[0]!.envelope, records = sources.flatMap(source => source.envelope.records);
  return pages.bindings.map((binding: { cellId: string; recordId: string }, index: number) => {
    const record = records.find(record => record.id === binding.recordId)!;
    const values = Object.fromEntries((record.args ?? []).map((arg: { name: string; type: string }) => [arg.name, ["number", "plural", "date"].includes(arg.type) ? 2 : "Writer"]));
    return { id: `binding-${index}`, key: binding.cellId, text: writerCopy({ id: binding.cellId, ...(Object.keys(values).length ? { values } : {}) }) };
  });
};
import { createRegisteredPublicationSession } from "../../../../publisher/src/web/registered-route-query.js";
import { prepareRegisteredRoute } from "../../../../publisher/src/web/registered-route-binding.js";
import type { RegisteredRouteRuntime } from "../../../../publisher/src/web/registered-route-binding.js";
import { registeredLayoutSourcePin } from "../../../../publisher/src/core/layout-fill-source.js";
import { flowStageStyleSheet } from "../../../../publisher/src/core/flow-stage.js";
import { FORMAT_LEAVES } from "../../../../publisher/src/formats/index.js";
import { LAYOUT_LEAVES } from "../../../../publisher/src/layouts/resolve.js";
import type { InstanceRegistries } from "../../../../publisher/src/core/instance-binding.js";

let fixture: Awaited<ReturnType<typeof packageSurfaceLibrary>>;
let packages: Awaited<ReturnType<typeof readSurfacePackageEvidence>>;
beforeAll(async () => {
  fixture = await packageSurfaceLibrary();
  packages = await readSurfacePackageEvidence(["@clossys/designer/frames", "@clossys/designer/shell"].map(module => ({ frames: { pointer: { impl: { kind: "package", module } } } })) as Parameters<typeof readSurfacePackageEvidence>[0]);
}, 120_000);
const skeleton = { l0: [{ id: "strings", label: {id:"strings.admin.group.writer.strings"}, count: 1, estimate: 300, l1: [] }] };
const content = (reference: RuntimeContent["reference"], value: RuntimeJson): RuntimeContent => ({ reference, value, hash: runtimeHash(value) });
function setup(skeleton: AdminPageSkeleton = { l0: [{ id: "strings", label: {id:"strings.admin.group.writer.strings"}, count: 1, estimate: 300, l1: [] }] }) {
  const engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: { ...fixture.options, packages: [...fixture.packages.filter(row => !packages.some(owned => owned.module === row.module)), ...packages] } };
  const profile = resolve(engine), copy = adminCopyFixture();
  const publication = { id: "admin", mainSlot: "body", frame: { leaf: "frames.app-shell" as const, content: { "skip-link": { kind: "copy" as const, ref: "admin.frame/skip-link" } } }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: profile.consumer, medium: "web" as const }, packIds: ["pack.admin"] };
  const { registry, pages, publicationHosts } = createAdminPageRegistry({ publication, copy, manifests: { designer: skeleton, writer: skeleton, publisher: skeleton }, itemTitles: { designer: {id:"strings.admin.page.designer"}, writer: {id:"strings.admin.page.writer"}, publisher: {id:"strings.admin.page.publisher"} } });
  // Real adopted renderer sources; SYNTHETIC flow declarations do not qualify the catalog's substrate coverage.
  const leaves = ["frames.app-shell", "sections.section-header", "sections.band", "sections.data-table", "sections.record-detail", "sections.table-of-contents", "sections.chat"];
  const plan = planSurfaceRuntime({ engine, packages: engine.surfaceOptions.packages, leaves, renderers: Object.fromEntries(leaves.map(leaf => [leaf, { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" }])) });
  expect(plan.gaps).toEqual([]);
  const manifest = { ...plan.manifest, fills: plan.manifest.fills.flatMap(fill => fill.leaf === "sections.section-header" ? [fill, ...["level-2", "level-3"].map(config => ({ ...fill, config }))] : [fill]) };
  const contracts = { ...loadBuildCatalog(), slots: fixture.catalog.surfaces!.slots.map(slot => slot.contract.kind === "section" ? { ...slot, contract: { ...slot.contract, substrates: ["flow" as const], substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC-admin-pages-runtime.test.tsx", name: "fixture declaration only" }] } } : slot) };
  const registries: InstanceRegistries = { formats: FORMAT_LEAVES, layouts: LAYOUT_LEAVES, tokens: [], frames: [{ id: "frames.app-shell", status: "draft", contract: { surface: "app", configs: [], stage: { accepts: ["flow"], scroll: "region" } } }], sections: contracts.slots.filter(slot => slot.contract.kind === "section").map(slot => ({ id: slot.id as `sections.${string}`, status: "draft", contract: { surface: "both", configs: slot.id === "sections.section-header" ? ["level-2", "level-3"] : [], slots: (slot.contract as { slots: readonly { name: string; type: "records"; required: boolean }[] }).slots, substrates: ["flow"], substrateTests: [{ substrate: "flow", file: "SYNTHETIC-admin-pages-runtime.test.tsx", name: "fixture declaration only" }] } })) };
  const layoutPin = registeredLayoutSourcePin("layouts.stack")!;
  // Vite treats static `new URL(..., import.meta.url)` as a browser asset URL
  // under jsdom. This is a filesystem directory, so retain Node's URL unchanged.
  const publisherSource = new NodeURL("../../../../publisher/src/", import.meta.url);
  expect(publisherSource.protocol).toBe("file:");
  const layoutSource = { entry: layoutPin.entry, files: Object.fromEntries(Object.keys(layoutPin.files).map(file => [file, readFileSync(resolvePath(fileURLToPath(publisherSource), file), "utf8")])), dependencies: {} };
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
describe("WX-2 shared copy on six native routes through prepareRegisteredRoute (fixture declarations)", () => {
  it("resolves all 363 page binding cells in prepared route data and renders the collapsed table plus both Arabic records", async () => {
    const f = setup({ l0: [{ id: "strings", label: {id:"strings.admin.group.writer.strings"}, count: 4, estimate: 80, partition: "l1", l1: [{ id: "names", label: {id:"strings.admin.ia.writer.strings.identity-names"}, count: 4, estimate: 400, l2: ["primary", "secondary"].map(id => ({ id, label: {id:id === "primary" ? "strings.admin.column.key" : "strings.admin.column.text"}, count: 2, estimate: 200 })) }] }] });
    const pair = f.pages.writer, route = pair.list;
    const ref = (name: string, kind: RuntimeContent["reference"]["kind"] = "records") => ({ kind, ref: `fixture.writer/${name}` });
    const data: RuntimeContent[] = [
      content(adminPageRef("writer", "strings/names/band"), [{ id: "names", references: {
        "admin.writer/band.heading": ref("band.heading", "copy"), "admin.writer/band.stats": ref("band.stats"), "admin.writer/cards": ref("cards"),
      } }]),
      content(ref("band.heading", "copy"), { text: writerCopy({id:"strings.admin.ia.writer.strings.identity-names"}), id: "strings--names" }),
      content(ref("band.stats"), [{ id: "count", label: writerCopy({id:"strings.admin.stats.total",values:{count:4}}) }]),
      content(ref("cards"), ["primary", "secondary"].map(id => ({ id, references: {
        "admin.writer/card.header": ref(`${id}/header`, "copy"), "admin.writer/card.rows": ref(`${id}/rows`), "admin.writer/card.pagination": ref(`${id}/pagination`, "region"),
      } }))),
      ...["primary", "secondary"].flatMap(id => [
        content(ref(`${id}/header`, "copy"), { heading: writerCopy({id:id === "primary" ? "strings.admin.column.key" : "strings.admin.column.text"}), id:`strings--names--${id}`, level:4, count:2 }),
        content(ref(`${id}/rows`), [...(id === "primary" ? everyPageCell() : []), ...[1, 2].map(index => ({ id: `${id}-${index}`, key: `${id}-${index}`, text: writerCopy({id:index === 1 ? "strings.admin.page.writer" : "strings.admin.column.text",locale:"ar"}), href: `/agents/writer/strings/${id}-${index}` }))]),
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
    // Coverage is measured in the real loader's Writer-resolved cache, before
    // the existing table renderer applies its collapsed/paginated presentation.
    const cells = everyPageCell(), bindings = ADMIN_PAGES_COPY_EN.bindings;
    const prepared = bundle.resolveContent(ref("primary/rows"))!;
    expect(prepared.hash).toBe(runtimeHash(prepared.value));
    const preparedRows = prepared.value as readonly { id: string; key: string; text: string }[];
    const bindingRows = preparedRows.filter(row => row.id.startsWith("binding-"));
    expect(bindings).toHaveLength(363);
    expect(cells).toHaveLength(363);
    expect(bindingRows).toHaveLength(363);
    expect(new Set(bindingRows.map(row => row.id)).size).toBe(363);
    expect(new Set(bindingRows.map(row => row.key)).size).toBe(363);
    expect(bindingRows.map(row => row.id)).toEqual(cells.map(cell => cell.id));
    expect(bindingRows.map(row => row.key)).toEqual(bindings.map(binding => binding.cellId));
    expect(Object.keys(ADMIN_PAGES_COPY_EN.aliases).sort()).toEqual(bindingRows.map(row => row.key).sort());
    // The public server boundary projects binding metadata before hashing it.
    // Compare against that authentic prepared source, retaining its raw records.
    const rawSources = copySources(), sources = prepareAdminPageCopyEnvelopes(rawSources), proofs = bundle.copyProvenance();
    for (const [index, binding] of bindings.entries()) {
      const row = bindingRows[index]!;
      const owners = sources.filter(source => source.envelope.records.some((record: { id: string }) => record.id === binding.recordId));
      expect(owners, binding.cellId).toHaveLength(1);
      const owner = owners[0]!, record = owner.envelope.records.find((record: { id: string }) => record.id === binding.recordId)!;
      expect(ADMIN_PAGES_COPY_EN.aliases[binding.cellId as keyof typeof ADMIN_PAGES_COPY_EN.aliases]).toBe(record.id);
      if (owner.source !== "admin-pages.r1.en.json") expect(ADMIN_PAGES_COPY_EN.externalRecords).toContainEqual({ recordId: record.id, source: owner.source, sourceContext: record.context });
      const marker = cells[index]!.text as { $copy: { values?: Record<string, string | number> } };
      const proof = proofs.find(proof => proof.provenance.cellId === binding.cellId && proof.provenance.locale === "en"
        && runtimeHash(proof.ref.values ?? {}) === runtimeHash(marker.$copy.values ?? {}));
      expect(proof, binding.cellId).toBeDefined();
      expect(proof!.text, binding.cellId).toBe(row.text);
      expect(row.text.trim(), binding.cellId).not.toBe("");
      expect(proof!.ref).toMatchObject({ id: record.id, locale: "en" });
      expect(record).toEqual(rawSources.find(source => source.source === owner.source)!.envelope.records.find((record: { id: string }) => record.id === binding.recordId));
      expect(proof!.provenance).toMatchObject({ cellId: binding.cellId, recordId: record.id, locale: "en", status: "draft", activation: "none", bindingSource: "admin-pages.r1.en.json", recordSource: owner.source, envelopeHash: runtimeHash(owner.envelope), bindingEnvelopeHash: runtimeHash(sources[0]!.envelope) });
    }
    const arabic = readCopy("./admin-pages.r1.ar.json");
    expect(arabic.records).toHaveLength(2);
    for (const binding of arabic.bindings) {
      const record = arabic.records.find((record: { id: string }) => record.id === binding.recordId)!;
      expect(preparedRows.find(row => row.key === `primary-${binding.cellId === "strings.admin.page.writer" ? 1 : 2}`)?.text).toBe(record.text);
      expect(proofs).toContainEqual(expect.objectContaining({ text: record.text, provenance: expect.objectContaining({ cellId: binding.cellId, recordId: record.id, locale: "ar", recordSource: "admin-pages.r1.ar.json", envelopeHash: runtimeHash(arabic), status: "draft", activation: "none" }) }));
    }
    const html = renderToStaticMarkup(createElement(Fragment, null, after.renderRegions!(runtime.cell).chunks?.flatMap(chunk => chunk.content ?? [])));
    expect(html).toMatch(/<h2[^>]*[^]*Strings[^]*<h3[^>]*[^]*Names[^]*<h4[^>]*[^]*Key[^]*<h4[^>]*[^]*Text/);
    expect(html).toContain("الكاتب");
    expect(html).toContain("النص");
    const root = document.createElement("div"); root.innerHTML = html;
    const rows = root.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(12); // Ten collapsed primary rows, two secondary Arabic rows.
    for (const [index, row] of [...rows].entries()) {
      const expected = index < 10 ? bindingRows[index]! : { key: `secondary-${index - 9}`, text: arabic.records[index - 10]!.text };
      expect(row.textContent).toContain(expected.key);
      expect(row.textContent).toContain(expected.text);
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
      const html = renderToStaticMarkup(createElement(Fragment, null, regions.chunks?.flatMap(chunk => chunk.content ?? [])));
      expect(html).toContain(item ? f.copy(`strings.admin.page.${kind}`) : "Strings");
      expect(html).not.toContain("Order 1042");
      expect(regions.regions["page-module"]?.length).toBeGreaterThan(0);
      f.session.setPage(regions, page);
    }
    expect(f.host.bind).toHaveBeenCalledTimes(1);
    expect(f.host.bind.mock.calls[0]![0].inspector).toMatchObject({section:"sections.chat"});
  }, 120_000);
});
