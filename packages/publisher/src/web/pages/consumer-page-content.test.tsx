/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from "vitest";
import examples from "../../../examples/admin-pages.config.json" with { type: "json" };
import strategyExamples from "../../../examples/strategy-pages.config.json" with { type: "json" };
import { strategyPageFixture, strategyExampleRef } from "./__fixtures__/strategy-page.mjs";
import { prepareStrategyPageRegistry, type PreparedStrategyPage } from "./strategy-page.js";
import { adminCopyFixture } from "./__fixtures__/copy.mjs";
import { fixtureSources } from "./__fixtures__/consumer-pages.mjs";
import { contentRouteCandidate, contentRouteContent, contentRouteFixture } from "../__fixtures__/content-route.js";
import { consumerPageContentSelection, prepareConsumerPageRegistry, prepareConsumerPageRoute } from "./consumer-page-content.js";
import { createRegisteredPublicationSession } from "../registered-route-query.js";
import type { CandidateContent, ContentRegistry } from "../../content/model.js";
import { checkConsumerPageConfig } from "./consumer-page-contract.js";
import type { ConsumerPageConfig } from "./consumer-page-contract.js";
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type FixtureConfig = Mutable<ConsumerPageConfig & { item: NonNullable<ConsumerPageConfig["item"]> }>;

function fixture(options: {consumer?:string;libraryVersion?:string;frameContent?:Record<string,any>;pageModule?:any;member?:string;strategy?:PreparedStrategyPage} = {}) {
  const copy = options.strategy?.copy ?? adminCopyFixture(), config = structuredClone(options.strategy ? strategyExamples[0]! : examples[1]!) as unknown as FixtureConfig;
  if (!options.strategy) {
    Object.assign(config, { id: "archive", entryId: "catalog.archive", namespace: "consumer.archive" }); config.item.entryId = "catalog.archive.item";
    config.item.sections = config.item.sections.filter(section => section.fill.section === "sections.record-detail");
    config.columns = [{key:"edition",kind:"text",label:{id:"strings.admin.column.text"}}];
  }
  const publicationId = options.strategy ? "strategy-example-publication" : "archive-publication";
  const pageId = config.id, path = options.strategy ? "/strategy" : "/archive", itemTitle = options.strategy?.selectedTitle ?? config.title;
  Object.assign(config,{pageModule:options.pageModule ?? null});
  for (const section of config.item.sections) for (const reference of Object.values(section.fill.content)) reference.ref = reference.ref.replace("admin.writer/","consumer.archive/");
  config.levels.l0.header.members = { align: options.member ?? "center", density: "compact" };
  config.levels.l0.header.config = "level-3"; config.levels.l1.header.config = "level-3";
  const snapshot = { version: 1 as const, publication: { id: publicationId, mainSlot: "body", frame: { leaf: "frames.app-shell" as const, ...(options.frameContent ? {content:options.frameContent} : {}) }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: options.consumer ?? "example", medium: "web" as const }, packIds: [] }, channel: "site" as const,
    configs: [config], manifests: { [pageId]: { l0: [{ id: "collection", label: config.title, count: options.strategy?.snapshot.status.counts.total ?? 2, estimate: 100, l1: [{ id: "editions", label: config.title, count: options.strategy?.snapshot.status.counts.total ?? 2, estimate: 50, l2: [{ id: "recent", label: config.title, count: options.strategy?.snapshot.status.counts.total ?? 2, estimate: 40 }] }] }] } }, sources: { [pageId]: options.strategy ? { list: { entry: { file: "src/web/registered-route-pages.tsx", export: "RegisteredRoutePage" }, source: { file: "src/web/pages/admin-page.ts", export: "createConsumerPageRecords" } }, item: { entry: { file: "src/web/registered-route-pages.tsx", export: "RegisteredRoutePage" }, source: { file: "src/web/pages/admin-page.ts", export: "createConsumerPageRecords" } }, runtime: { file: "src/web/pages/strategy-page.ts", export: "prepareStrategyPageRegistry" } } : fixtureSources("archive") },
    map: { version: 1 as const, publicationId, format: "web.page.responsive" as const, entries: [{ id: config.entryId, order: 0, title: copy(config.title), path, kind: "page" as const, source: { planItemId: `site.${pageId}` }, pageConfig: config.id }, { id: config.item.entryId, parentId: config.entryId, order: 0, title: copy(itemTitle), path: `${path}/[l0]/[id]`, kind: "page" as const, source: { planItemId: `site.${pageId}.item` }, pageConfig: config.id }] }, itemTitles: { [pageId]: itemTitle } };
  const base = contentRouteFixture(), selections = snapshot.map.entries.map((entry,index) => ({ routeId: entry.id, slotId: index ? "sl_bbbbbbbbbb" as const : "sl_aaaaaaaaaa" as const, candidateId: `${pageId}-${index}`, revision: "r1" as const, digest: "" }));
  const candidates = selections.map(selection => {
    const selected = consumerPageContentSelection(snapshot, selection.routeId, copy);
    const typeSettings: CandidateContent["typeSettings"] = options.strategy ? { consumerPage: snapshot as never, strategyPage: options.strategy.sourceSnapshot as never } : { consumerPage: snapshot as never };
    const content = contentRouteContent({ name:copy(config.title), composition: { ...selected, libraryVersion: options.libraryVersion ?? "library-1", sections: selected.sections.map(section => ({ ...section, intent: "continues", fields: [] })) }, typeSettings });
    const candidate = contentRouteCandidate(content, selection.candidateId, selection.slotId); selection.digest = candidate.history[0]!.digest; return candidate;
  });
  const registry: ContentRegistry = { workspace: {...base.registry.workspace,consumerId:options.consumer ?? "example"}, slots: selections.map((selection,index) => ({ ...base.registry.slots[0]!, id: selection.slotId, route: snapshot.map.entries[index]!.path, activeCandidateId: selection.candidateId, aliases: [`websites/${pageId}/${index ? "item" : "list"}`] })), candidates };
  return { copy, config, snapshot, registry:structuredClone(registry), selections, locale: "en" };
}
it("derives non-admin taxonomy and item composition from active Publisher candidate revisions", () => {
  const f = fixture(), before = JSON.stringify(f.registry), result = prepareConsumerPageRegistry(f);
  expect(result.registry.routes.map(route => route.routeId)).toEqual(["catalog.archive", "catalog.archive.item"]);
  expect(result.pages.archive.manifest.l0[0]).toMatchObject({ id: "collection", l1: [{ id: "editions", l2: [{ id: "recent" }] }] });
  expect(result.pages.archive.item!.composition.binding.regions.main.slice(1)).toEqual(f.config.item.sections.map(section => section.fill));
  expect(result.identities["catalog.archive.item"]).toMatchObject({ slotId: "sl_bbbbbbbbbb", candidateId: "archive-1", revision: "r1", digest: f.selections[1]!.digest });
  expect(JSON.stringify(f.registry)).toBe(before);
});
it("refuses foreign, stale, missing and crossed Publisher selections rather than attaching claimed IDs", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.selections[0]!.candidateId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { f.selections[0]!.digest = "0".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.selections.pop(); },
    (f: ReturnType<typeof fixture>) => { f.selections[0]!.slotId = f.selections[1]!.slotId; },
    (f: ReturnType<typeof fixture>) => { (f.registry.candidates[0]!.typeSettings.consumerPage as any).configs[0].namespace = "changed"; },
    (f: ReturnType<typeof fixture>) => { (f.registry.slots[0] as any).route = "/foreign"; },
    (f: ReturnType<typeof fixture>) => { (f.registry.slots[0] as any).kind = "status"; },
    (f: ReturnType<typeof fixture>) => { [f.selections[0],f.selections[1]]=[{...f.selections[1]!,routeId:f.selections[0]!.routeId},{...f.selections[0]!,routeId:f.selections[1]!.routeId}]; },
  ]) { const f = fixture(); mutate(f); expect(() => prepareConsumerPageRegistry(f)).toThrow(); }
});
it("keeps outward ownership and composition claims immutable", () => {
  const f = fixture(), bound = prepareConsumerPageRegistry(f);
  for (const change of [() => { (bound as any).identities = {}; }, () => { (bound as any).map = {}; }, () => { (bound.pages as any).archive = {}; }, () => { (bound.identities["catalog.archive"] as any).candidateId = "foreign"; }]) expect(change).toThrow(TypeError);
  expect(bound.identities["catalog.archive"]!.candidateId).toBe("archive-0");
  expect(Object.isFrozen((f.registry.candidates[1]!.typeSettings.consumerPage as any).sources.archive.list.entry)).toBe(false);
  expect(()=>prepareConsumerPageRoute({...bound},"catalog.archive",{} as never)).toThrow(/checked.*selection/);
});
it("accepts explicit consumer module choices as composition data", () => {
  const config = structuredClone(examples[1]!);
  Object.assign(config,{pageModule:null});
  expect(checkConsumerPageConfig(config)).toEqual([]);
  Object.assign(config,{pageModule:{section:"sections.table-of-contents",content:{headings:{kind:"records",ref:"archive/outline"}}}});
  expect(checkConsumerPageConfig(config)).toEqual([]);
  Object.assign(config,{pageModule:{section:"sections.table-of-contents",content:{headings:{kind:"copy",ref:""}}}});
  expect(checkConsumerPageConfig(config).length).toBeGreaterThan(0);
});
it("keeps selected module bytes under the same immutable candidate revision", () => {
  const pageModule={section:"sections.table-of-contents",content:{headings:{kind:"records",ref:"consumer.archive/outline"},label:{kind:"copy",ref:"strings.admin.outline.label"}}};
  const f=fixture({pageModule}),bound=prepareConsumerPageRegistry(f);
  expect(bound.pages.archive!.list.composition.binding.regions["page-module"]).toEqual([pageModule]);
  (f.registry.candidates[0]!.typeSettings.consumerPage as any).configs[0].pageModule.content.label.ref="changed";
  expect(()=>prepareConsumerPageRoute(bound,"catalog.archive",{} as never)).toThrow(/revision|snapshot|content/);
});
it("rechecks caller mutation before handing the selected page to native preparation", () => {
  const f = fixture(), bound = prepareConsumerPageRegistry(f);
  (f.registry.candidates[0]!.typeSettings.consumerPage as any).configs[0].namespace = "changed";
  expect(() => prepareConsumerPageRoute(bound,"catalog.archive",{} as never)).toThrow(/selection|snapshot|revision|content/i);
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { applyLibraryChange, libraryHash, loadBuildCatalog, planSurfaceRuntime, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContent, RuntimeJson } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { surfaceRuntimeRenderers, ShellCopyProvider } from "@clossys/designer/frames";
import { resolveAdminCopyRef } from "@clossys/writer/admin-copy";
import { packageSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { selectedPackageClosure } from "../../../../designer/src/catalog-core/__fixtures__/surface-engine/selected-package-closure.js";
import { importFoundryComponents } from "../../../../designer/src/importers/foundry-components.js";
import { componentOf } from "../../../../designer/src/catalog-core/resolve-components.js";
import { registeredLayoutSourcePin } from "../../core/layout-fill-source.js";
import { flowStageStyleSheet } from "../../core/flow-stage.js";
import { FORMAT_LEAVES } from "../../formats/index.js";
import { LAYOUT_LEAVES } from "../../layouts/resolve.js";
import { adminPageContent, writerCopy } from "./admin-copy.js";
import type { RegisteredRouteRuntime } from "../registered-route-binding.js";
let adopted: Awaited<ReturnType<typeof packageSurfaceLibrary>>;
let packageEvidence: Awaited<ReturnType<typeof readSurfacePackageEvidence>>;
beforeAll(async () => {
  adopted = await packageSurfaceLibrary();
  packageEvidence = await readSurfacePackageEvidence(["@clossys/designer/frames","@clossys/designer/shell"].map(module=>({frames:{pointer:{impl:{kind:"package",module}}}})) as never);
},120000);
it("refuses a genuinely selected member outside the authentic native contract",async()=>{
  const f=nativeFixture({member:"outside-native-contract"}),pair=f.bound.pages.archive!;
  const bundle=pair.createSession({publication:f.publication,loaders:{chunk:async()=>f.listData,search:async()=>[],item:async()=>undefined},navigation:{hash:()=>"",scroll:vi.fn(),focus:vi.fn(),replaceState:vi.fn()}});
  bundle.page.activate();await bundle.page.requestChunk({l0:"collection"});
  const runtime={...f.runtime,page:bundle.page,assembly:{...f.runtime.assembly,ports:{...f.runtime.assembly.ports,resolveContent:(ref:RuntimeContent["reference"])=>bundle.resolveContent(ref)??f.values.get(ref.ref),sectionHosts:bundle.sectionHosts()}}};
  const result=prepareConsumerPageRoute(f.bound,pair.list.routeId,runtime);
  expect(result.status).toBe("refused");expect(result.findings.join(" ")).toMatch(/member/);
});
it("refuses stale selected native source evidence after canonical content selection",async()=>{
  const f=nativeFixture(),pair=f.bound.pages.archive!,bundle=pair.createSession({item:true,itemPath:"/archive/collection/edition",publication:f.publication,loaders:{chunk:async()=>[],search:async()=>[],item:async()=>({record:{id:"edition"},content:f.itemData})},navigation:{hash:()=>"",scroll:vi.fn(),focus:vi.fn(),replaceState:vi.fn()}});
  bundle.page.activate();await bundle.page.loadItem("/archive/collection/edition");
  const manifest=structuredClone(f.runtime.assembly.ports.manifest);manifest.fills.find(fill=>fill.kind==="frame")!.renderer.sourceHash=`sha256:${"0".repeat(64)}`;
  const runtime={...f.runtime,page:bundle.page,itemPath:bundle.itemPath,assembly:{...f.runtime.assembly,ports:{...f.runtime.assembly.ports,manifest,resolveContent:(ref:RuntimeContent["reference"])=>bundle.resolveContent(ref)??f.values.get(ref.ref),sectionHosts:bundle.sectionHosts()}}};
  const result=prepareConsumerPageRoute(f.bound,pair.item!.routeId,runtime);expect(result.status).toBe("refused");expect(result.findings.join(" ")).toMatch(/source|hash/);
});
function nativeFixture(options: {member?:string;strategy?:PreparedStrategyPage} = {}) {
  const catalog = options.strategy ? { ...adopted.catalog, components: { ...adopted.catalog.components, fills: [...importFoundryComponents().fills] } } : adopted.catalog;
  const closure = options.strategy ? selectedPackageClosure(catalog) : undefined;
  const surfaceOptions = {...adopted.options,packages:[...adopted.packages.filter(row=>!packageEvidence.some(owned=>owned.module===row.module)),...packageEvidence]};
  const ordered: string[] = [], visited = new Set<string>(), visiting = new Set<string>();
  if (closure) {
    const selected = new Map(closure.library.components.fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, componentOf(doc)]));
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Component dependency cycle: ${id}`);
      const component = selected.get(id); if (!component) throw new Error(`Missing consumer dependency: ${id}`);
      visiting.add(id); [...component.reads.components, ...component.composes].forEach(visit);
      visiting.delete(id); visited.add(id); ordered.push(id);
    };
    [...selected.keys()].forEach(visit);
  }
  const library = closure ? applyLibraryChange(catalog, adopted.library, { baseHash: libraryHash(adopted.library), changes: ordered.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot: slot as `components.${string}`, source: "foundry" } })) }, { componentOptions: closure.componentOptions, surfaceOptions }) : adopted.library;
  const engine = {catalog,library,...(closure ? { componentOptions: closure.componentOptions } : {}),surfaceOptions};
  const profile = resolve(engine);
  if (options.strategy) expect(profile.check.ok, JSON.stringify(profile.check.findings.filter(finding => finding.severity === "error").slice(0, 8))).toBe(true);
  const frameContent = {"skip-link":{kind:"copy",ref:"archive.frame/skip"},sidebar:{kind:"region",ref:"archive.frame/sidebar"},command:{kind:"region",ref:"archive.frame/command"}};
  const f = fixture({...options,consumer:profile.consumer,libraryVersion:libraryHash(engine.library),frameContent}), bound = options.strategy ? prepareStrategyPageRegistry({ ...f, page: options.strategy }) : prepareConsumerPageRegistry(f);
  const leaves = ["frames.app-shell","sections.section-header","sections.band","sections.data-table","sections.record-detail","sections.table-of-contents", ...(options.strategy ? ["sections.article"] : [])];
  const planned = planSurfaceRuntime({engine,packages:engine.surfaceOptions.packages,leaves,renderers:Object.fromEntries(leaves.map(leaf=>[leaf,{module:"@clossys/designer/frames",export:"surfaceRuntimeRenderers"}]))});
  expect(planned.gaps).toEqual([]);
  const manifest = {...planned.manifest,fills:planned.manifest.fills.map(fill=>fill.leaf==="sections.section-header"?{...fill,config:"level-3"}:fill)};
  // Authentic package source/descriptors and callbacks; flow substrate declarations
  // are local fixture evidence, not exhaustive Designer conformance or adoption.
  const contracts = {...loadBuildCatalog(),slots:adopted.catalog.surfaces!.slots.map(slot=>slot.contract.kind==="section"?{...slot,contract:{...slot.contract,substrates:["flow"],substrateTests:[{substrate:"flow",file:"SYNTHETIC-consumer-page-content.test.tsx",name:"local native input proof"}]}}:slot)};
  const registries = {formats:FORMAT_LEAVES,layouts:LAYOUT_LEAVES,tokens:[],frames:[{id:"frames.app-shell",status:"draft",contract:{surface:"app",configs:[],stage:{accepts:["flow"],scroll:"region"}}}],sections:contracts.slots.filter(slot=>slot.contract.kind==="section").map(slot=>({id:slot.id,status:"draft",contract:{surface:"both",configs:slot.id==="sections.section-header"?["level-2","level-3"]:[],members:slot.contract.members.names,slots:(slot.contract as any).slots,substrates:["flow"],substrateTests:[{substrate:"flow",file:"SYNTHETIC-consumer-page-content.test.tsx",name:"local native input proof"}]}}))};
  const pin = registeredLayoutSourcePin("layouts.stack")!, source = {entry:pin.entry,files:Object.fromEntries(Object.keys(pin.files).map(file=>[file,readFileSync(resolvePath("src",file),"utf8")])),dependencies:{}};
  const layoutRenderer = {id:"Stack",source,sourceHash:runtimeHash(source)}, values = new Map<string,RuntimeContent>();
  const put = (reference:RuntimeContent["reference"],value:RuntimeJson) => { const current={reference,value,hash:runtimeHash(value)}; values.set(reference.ref,current);return current; };
  const title = f.copy(f.config.title);
  put(frameContent["skip-link"] as never,options.strategy ? f.copy(strategyExampleRef("skipLink")) : title);
  put(frameContent.sidebar as never,{brand:{markSrc:"/mark.svg",name:title},tree:[],account:{signedOutLabel:title,sections:[]}});
  put(frameContent.command as never,{triggerLabel:title,heading:title,searchLabel:title,closeLabel:title,emptyMessage:title,groups:[]});
  const sectionRenderers = Object.fromEntries(manifest.fills.map(fill=>[fill.renderer.id,surfaceRuntimeRenderers[fill.leaf]!.render]));
  const pixels = Object.fromEntries(Object.entries(profile.values.members).filter(([id])=>id.startsWith("tokens.breakpoint.")).map(([id,member])=>{const v=member.value.light as {unit:string;value:number};return [id,v.value*(v.unit==="px"?1:16)];}));
  const runtime:RegisteredRouteRuntime={assembly:{identity:{kind:"git",head:"a".repeat(40),tree:"b".repeat(40)},engine,contracts:contracts as never,ports:{manifest,renderers:sectionRenderers,resolveContent:reference=>values.get(reference.ref),frameOrder:({layout,slots})=>[...Object.values(slots).flat(),...layout],frameHost:{navigate:vi.fn()}},themes:["light"],states:["default"],breakpointPixels:pixels,breakpointBasis:{renderer:layoutRenderer,environment:{kind:"SYNTHETIC 16px root font"}},css:[{id:"publisher-flow-stage.css",contents:flowStageStyleSheet(profile,"layouts.stack","stack.workspace")}],assets:[],stageMeasurements:{renderer:layoutRenderer,environment:{kind:"SYNTHETIC width basis"},cells:runtimeAssemblyCells(profile,["light"],["default"],[],pixels).map(cell=>({cell,width:cell.width-80}))}},instanceLibrary:{id:profile.consumer,role:"consumer",resolveFill:(leaf,config)=>leaf==="layouts.stack"&&config==="stack.workspace"?{library:profile.consumer,leaf,config,headings:[],states:["default"],renderer:source}:undefined,resolveContent:reference=>reference},registries:registries as never,layoutRenderer,cell:{theme:"light",state:"default",width:320}};
  const publication = createRegisteredPublicationSession(bound.registry.publication!,{bind:vi.fn(),setRegions:vi.fn(),setState:vi.fn(),setCommands:vi.fn(),setChunks:vi.fn()});
  const reference=(name:string,kind:RuntimeContent["reference"]["kind"]="records")=>({kind,ref:`${f.config.namespace}/${name}`});
  const count = options.strategy?.snapshot.status.counts.total ?? 2;
  const totalCopy = (count: number) => options.strategy ? {...f.config.copy.count,values:{count}} : {id:"strings.admin.stats.total",values:{count}};
  const itemData = [
    adminPageContent(f.copy,reference("item/heading","copy"),{text:writerCopy(options.strategy?.selectedTitle ?? f.config.title),id:"collection"}),
    adminPageContent(f.copy,reference("item/stats"),[{id:"total",label:writerCopy(totalCopy(1))}]),
    ...(options.strategy ? [options.strategy.body] : [
      adminPageContent(f.copy,reference("item/fields"),[{label:writerCopy({id:"strings.admin.column.key"}),value:writerCopy(f.config.title)}]),
      adminPageContent(f.copy,reference("item/status","copy"),writerCopy({id:"strings.admin.status.draft"})),
    ]),
  ];
  const listValues: { reference: RuntimeContent["reference"]; value: RuntimeJson }[] = [
    {reference:reference("collection/editions/band"),value:[{id:"editions",references:{[`${f.config.namespace}/band.heading`]:reference("loaded/band.heading","copy"),[`${f.config.namespace}/band.stats`]:reference("loaded/band.stats"),[`${f.config.namespace}/cards`]:reference("loaded/cards")}}]},
    {reference:reference("loaded/band.heading","copy"),value:{text:writerCopy(f.config.title),id:"collection--editions"}},
    {reference:reference("loaded/band.stats"),value:[{id:"count",label:writerCopy(totalCopy(count))}]},
    {reference:reference("loaded/cards"),value:[{id:"recent",references:{[`${f.config.namespace}/card.header`]:reference("loaded/header","copy"),[`${f.config.namespace}/card.rows`]:options.strategy ? { kind: options.strategy.rows.reference.kind, ref: options.strategy.rows.reference.ref } : reference("loaded/rows"),[`${f.config.namespace}/card.pagination`]:reference("loaded/pagination","region")}}]},
    {reference:reference("loaded/header","copy"),value:{heading:writerCopy(f.config.title),id:"collection--editions--recent",level:4,count}},
    ...(options.strategy ? [] : [{reference:reference("loaded/rows"),value:[{id:"edition",edition:writerCopy(f.config.title)}]}]),
    {reference:reference("loaded/pagination","region"),value:{label:writerCopy(f.config.copy.table.paginationLabel),showAll:writerCopy(options.strategy ? totalCopy(count) : {id:"strings.admin.action.showAll",values:{count}}),previous:writerCopy(options.strategy ? strategyExampleRef("previous") : {id:"strings.admin.pagination.previous"}),next:writerCopy(options.strategy ? strategyExampleRef("next") : {id:"strings.admin.pagination.next"})}},
  ];
  const listData = listValues.map(({reference,value})=>adminPageContent(f.copy,reference,value));
  if (options.strategy) listData.push(options.strategy.rows);
  return {...f,bound,runtime,publication,profile,values,itemData,listData,reference,planned};
}
it("binds exact list/item Publisher identities to authentic native frame and consumer-selected Sections",async()=>{
  const f=nativeFixture(), pair=f.bound.pages.archive!;
  for(const item of [false,true]) {
    const route=item?pair.item!:pair.list, bundle=pair.createSession({item,itemPath:item?"/archive/collection/edition":undefined,publication:f.publication,loaders:{chunk:async()=>f.listData,search:async()=>[],item:async()=>({record:{id:"edition"},content:f.itemData})},navigation:{hash:()=>"",scroll:vi.fn(),focus:vi.fn(),replaceState:vi.fn()}});
    bundle.page.activate();if(item)expect(await bundle.page.loadItem("/archive/collection/edition")).toMatchObject({status:"ready"});
    else await bundle.page.requestChunk({l0:"collection"});
    const runtime={...f.runtime,page:bundle.page,itemPath:bundle.itemPath,assembly:{...f.runtime.assembly,ports:{...f.runtime.assembly.ports,resolveContent:(ref:RuntimeContent["reference"])=>bundle.resolveContent(ref)??f.values.get(ref.ref),sectionHosts:bundle.sectionHosts()}}};
    const result=prepareConsumerPageRoute(f.bound,route.routeId,runtime);
    expect(result.status,JSON.stringify(result)).toBe("stream");if(result.status!=="stream")continue;
    const ready=result.chunks.filter(chunk=>chunk.result.status==="ready");expect(ready.length).toBeGreaterThan(0);
    const full=ready[0]!.result;
    if(full.status==="ready") {
      const shellProvenance: NonNullable<ReturnType<typeof resolveAdminCopyRef>>[]=[];
      const shellCopy=(reference:Parameters<typeof resolveAdminCopyRef>[0])=>{const value=resolveAdminCopyRef(reference,undefined,{target:"preview"});if(value)shellProvenance.push(value);return value&&{ref:reference,text:value.text};};
      const frameHtml=renderToStaticMarkup(<ShellCopyProvider resolver={shellCopy}>{full.assembly.render(runtime.cell)}</ShellCopyProvider>);
      expect(frameHtml).toContain('data-application-frame=""');
      expect(frameHtml).toContain(f.copy(f.config.title));
      expect(frameHtml).toContain('data-ds-leaf="sections.section-header"');
      expect(frameHtml).not.toContain('data-application-frame-region="page-module"');
      expect(shellProvenance.length).toBeGreaterThan(0);
      expect(shellProvenance.every(value=>value.status==="draft"&&value.activation==="none")).toBe(true);
      expect(resolveAdminCopyRef(shellProvenance[0]!.ref)).toBeUndefined();
    }
    const html=renderToStaticMarkup(<>{result.renderRegions!(runtime.cell).chunks?.flatMap(chunk=>chunk.content??[])}</>);
    expect(html).toContain(f.copy(f.config.title));expect(html).toContain('data-ds-leaf="sections.section-header"');
    if(item)expect(html).toContain('data-ds-leaf="sections.record-detail"');else expect(html).toContain("text-center");
    const frame=f.planned.manifest.fills.find(fill=>fill.leaf==="frames.app-shell")!;
    expect(frame.renderer.source.files[frame.renderer.source.entry]).toContain('surfaceRuntimeRenderers["frames.app-shell"].render');
    expect(runtime.assembly.ports.renderers[frame.renderer.id]).toBe(surfaceRuntimeRenderers["frames.app-shell"]!.render);
    expect(f.bound.identities[route.routeId]!.candidateId).toBe(item?"archive-1":"archive-0");
    expect(()=>prepareConsumerPageRoute(f.bound,route.routeId,{...runtime,assembly:{...runtime.assembly,engine:{...runtime.assembly.engine,library:{...runtime.assembly.engine.library,adoptedAt:"changed"}}}})).toThrow(/library/);
  }
},120000);

it.each([{ label: "list", item: false }, { label: "detail", item: true }])("renders actual ST2 strategy $label through Writer and exact canonical native selections",async({ item })=>{
  const strategy = strategyPageFixture(), f = nativeFixture({ strategy }), pair = f.bound.pages.strategy!;
  const output: Record<string, string> = {};
  {
    const route = item ? pair.item! : pair.list;
    const itemPath = item ? "/strategy/collection/focus.segment.core" : undefined;
    const itemLoader = vi.fn(async () => ({ record: { id: "focus.segment.core" }, content: f.itemData }));
    const bundle = pair.createSession({ item, itemPath, publication: f.publication,
      loaders: { chunk: async () => f.listData, search: async () => [], item: itemLoader },
      navigation: { hash: () => "", scroll: vi.fn(), focus: vi.fn(), replaceState: vi.fn() } });
    bundle.page.activate();
    if (item) {
      expect(await bundle.page.loadItem(itemPath!)).toMatchObject({ status: "ready" });
      expect(itemLoader).toHaveBeenCalledWith("collection", "focus.segment.core");
    } else await bundle.page.requestChunk({ l0: "collection" });
    const runtime = { ...f.runtime, page: bundle.page, itemPath: bundle.itemPath,
      assembly: { ...f.runtime.assembly, ports: { ...f.runtime.assembly.ports,
        resolveContent: (ref: RuntimeContent["reference"]) => bundle.resolveContent(ref) ?? f.values.get(ref.ref), sectionHosts: bundle.sectionHosts() } } };
    const result = prepareConsumerPageRoute(f.bound, route.routeId, runtime);
    expect(result.status, JSON.stringify(result)).toBe("stream");
    if (result.status !== "stream") throw new Error("Native strategy route was not prepared");
    const ready = result.chunks.find(chunk => chunk.result.status === "ready")?.result;
    expect(ready?.status, JSON.stringify(result.chunks.map(chunk => ({ id: chunk.id, status: chunk.result.status, findings: chunk.result.findings })))).toBe("ready");
    if (ready?.status !== "ready") throw new Error("Native strategy route has no ready chunk");
    const shellCopy = (reference: Parameters<typeof resolveAdminCopyRef>[0]) => {
      const value = resolveAdminCopyRef(reference, undefined, { target: "preview" });
      return value && { ref: reference, text: value.text };
    };
    const regions = result.renderRegions!(runtime.cell), main = regions.chunks?.flatMap(chunk => chunk.content ?? []) ?? [];
    // This example has one L0 partition; its checked assembly owns the complete
    // frame, layout and main content. Render it without replacing any port.
    const html = renderToStaticMarkup(<ShellCopyProvider resolver={shellCopy}>{ready.assembly.render(runtime.cell)}</ShellCopyProvider>);
    const regionHtml = renderToStaticMarkup(<>{main}</>);
    expect((html.match(/data-application-frame=""/g) ?? []).length).toBe(1);
    expect(html).toContain("Skip to strategy content");
    expect(html).not.toContain('data-application-frame-region="page-module"');
    expect(f.bound.identities[route.routeId]).toEqual(f.selections[item ? 1 : 0]);
    if (item) {
      expect(regionHtml).toContain('data-ds-leaf="sections.article"');
      expect(regionHtml).toContain('data-ds-leaf="sections.band"');
      const dom = document.createElement("div"); dom.innerHTML = regionHtml;
      expect(dom.textContent).toContain("Storyline: not judged");
      expect(dom.textContent).toContain("Canonical active: false");
      for (const region of ["direction", "because", "watch"] as const) for (const bullet of strategy.snapshot.selected![region]) {
        const text = bullet.key === undefined ? bullet.text : `${bullet.key}: ${bullet.text}`;
        expect([...dom.querySelectorAll("li")].filter(node => node.textContent === text)).toHaveLength(1);
      }
    } else {
      expect(regionHtml).toContain('data-ds-leaf="sections.data-table"');
      expect(regionHtml).toContain("Strategy cell");
      expect(regionHtml).toContain("focus.segment.core");
      expect(regionHtml).toContain("Pointer version");
    }
    output[item ? "detail" : "list"] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${f.copy(f.config.title)}</title><style>${readFileSync(resolvePath("../designer/styles/tokens.css"), "utf8")}${readFileSync(resolvePath("styles/preview.css"), "utf8")}${flowStageStyleSheet(f.profile,"layouts.stack","stack.workspace")}</style></head><body data-copy-target="preview" data-copy-status="draft">${html}</body></html>`;
  }
  const previewDir = process.env.STRATEGY_PAGE_PREVIEW_DIR;
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    for (const [name, html] of Object.entries(output)) writeFileSync(resolvePath(previewDir, `strategy-${name}.html`), html);
    writeFileSync(resolvePath(previewDir, "strategy-provenance.json"), JSON.stringify({ identities: f.bound.identities, source: strategy.sourceSnapshot, provenance: strategy.provenance, snapshot: strategy.snapshot, proofScope: "Foundry example with synthetic substrate declarations; no consumer adoption or production approval" }, null, 2));
  }
},120000);

it("refuses crossed strategy fingerprints, Writer sources and fabricated projection capabilities",()=>{
  const strategy = strategyPageFixture();
  for (const key of ["snapshotHash", "envelopeHash", "source", "copySources", "briefFingerprints"] as const) {
    const f = fixture({ strategy });
    const snapshot = f.registry.candidates[0]!.typeSettings.strategyPage as Record<string, unknown>;
    snapshot[key] = key === "source" ? { id: "foreign", revision: 1 } : key.endsWith("Hash") ? `sha256:${"0".repeat(64)}` : [];
    expect(() => prepareStrategyPageRegistry({ ...f, page: strategy })).toThrow(/strategy|Writer.*snapshot/i);
  }
  const f = fixture({ strategy });
  expect(() => prepareStrategyPageRegistry({ ...f, page: { ...strategy } })).toThrow(/authentic/);
  expect(() => prepareStrategyPageRegistry({ ...f, locale: "fr", page: strategy })).toThrow(/locale/);
  const changed = { ...f, selections: f.selections.map((selection, index) => index ? selection : { ...selection, digest: "0".repeat(64) }) };
  expect(() => prepareStrategyPageRegistry({ ...changed, page: strategy })).toThrow(/revision/);
});
