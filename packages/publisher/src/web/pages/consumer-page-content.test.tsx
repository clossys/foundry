/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from "vitest";
import examples from "../../../examples/admin-pages.config.json" with { type: "json" };
import { adminCopyFixture } from "./__fixtures__/copy.mjs";
import { fixtureSources } from "./__fixtures__/consumer-pages.mjs";
import { contentRouteCandidate, contentRouteContent, contentRouteFixture } from "../__fixtures__/content-route.js";
import { consumerPageContentSelection, prepareConsumerPageRegistry, prepareConsumerPageRoute } from "./consumer-page-content.js";
import { createRegisteredPublicationSession } from "../registered-route-query.js";
import type { ContentRegistry } from "../../content/model.js";
import { checkConsumerPageConfig } from "./consumer-page-contract.js";

function fixture(options: {consumer?:string;libraryVersion?:string;frameContent?:Record<string,any>;pageModule?:any;member?:string} = {}) {
  const copy = adminCopyFixture(), config = structuredClone(examples[1]!);
  Object.assign(config, { id: "archive", entryId: "catalog.archive", namespace: "consumer.archive" }); config.item.entryId = "catalog.archive.item";
  config.item.sections = config.item.sections.filter(section => section.fill.section === "sections.record-detail");
  Object.assign(config,{pageModule:options.pageModule ?? null});
  config.columns = [{key:"edition",kind:"text",label:{id:"strings.admin.column.text"}}];
  for (const section of config.item.sections) for (const reference of Object.values(section.fill.content)) reference.ref = reference.ref.replace("admin.writer/","consumer.archive/");
  config.levels.l0.header.members = { align: options.member ?? "center", density: "compact" };
  config.levels.l0.header.config = "level-3"; config.levels.l1.header.config = "level-3";
  const snapshot = { version: 1 as const, publication: { id: "archive-publication", mainSlot: "body", frame: { leaf: "frames.app-shell" as const, ...(options.frameContent ? {content:options.frameContent} : {}) }, layout: { leaf: "layouts.stack" as const, config: "stack.workspace" }, format: "web.page.responsive" as const, surface: "app" as const, context: { consumer: options.consumer ?? "example", medium: "web" as const }, packIds: [] }, channel: "site" as const,
    configs: [config], manifests: { archive: { l0: [{ id: "collection", label: config.title, count: 2, estimate: 100, l1: [{ id: "editions", label: config.title, count: 2, estimate: 50, l2: [{ id: "recent", label: config.title, count: 2, estimate: 40 }] }] }] } }, sources: { archive: fixtureSources("archive") },
    map: { version: 1 as const, publicationId: "archive-publication", format: "web.page.responsive" as const, entries: [{ id: config.entryId, order: 0, title: copy(config.title), path: "/archive", kind: "page" as const, source: { planItemId: "site.archive" }, pageConfig: config.id }, { id: config.item.entryId, parentId: config.entryId, order: 0, title: copy(config.title), path: "/archive/[l0]/[id]", kind: "page" as const, source: { planItemId: "site.archive.item" }, pageConfig: config.id }] }, itemTitles: { archive: config.title } };
  const base = contentRouteFixture(), selections = snapshot.map.entries.map((entry,index) => ({ routeId: entry.id, slotId: index ? "sl_bbbbbbbbbb" : "sl_aaaaaaaaaa", candidateId: `archive-${index}`, revision: "r1" as const, digest: "" }));
  const candidates = selections.map(selection => {
    const selected = consumerPageContentSelection(snapshot, selection.routeId, copy);
    const content = contentRouteContent({ name:copy(config.title), composition: { ...selected, libraryVersion: options.libraryVersion ?? "library-1", sections: selected.sections.map(section => ({ ...section, intent: "continues", fields: [] })) }, typeSettings: { consumerPage: snapshot as never } });
    const candidate = contentRouteCandidate(content, selection.candidateId, selection.slotId); selection.digest = candidate.history[0]!.digest; return candidate;
  });
  const registry: ContentRegistry = { workspace: {...base.registry.workspace,consumerId:options.consumer ?? "example"}, slots: selections.map((selection,index) => ({ ...base.registry.slots[0]!, id: selection.slotId, route: snapshot.map.entries[index]!.path, activeCandidateId: selection.candidateId, aliases: [index ? "websites/archive/item" : "websites/archive/list"] })), candidates };
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

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { libraryHash, loadBuildCatalog, planSurfaceRuntime, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContent, RuntimeJson } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { surfaceRuntimeRenderers, ShellCopyProvider } from "@clossys/designer/frames";
import { resolveAdminCopyRef } from "@clossys/writer/admin-copy";
import { packageSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
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
function nativeFixture(options: {member?:string} = {}) {
  const engine = {catalog:adopted.catalog,library:adopted.library,surfaceOptions:{...adopted.options,packages:[...adopted.packages.filter(row=>!packageEvidence.some(owned=>owned.module===row.module)),...packageEvidence]}};
  const profile = resolve(engine);
  const frameContent = {"skip-link":{kind:"copy",ref:"archive.frame/skip"},sidebar:{kind:"region",ref:"archive.frame/sidebar"},command:{kind:"region",ref:"archive.frame/command"}};
  const f = fixture({...options,consumer:profile.consumer,libraryVersion:libraryHash(engine.library),frameContent}), bound = prepareConsumerPageRegistry(f);
  const leaves = ["frames.app-shell","sections.section-header","sections.band","sections.data-table","sections.record-detail","sections.table-of-contents"];
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
  put(frameContent["skip-link"] as never,title);
  put(frameContent.sidebar as never,{brand:{markSrc:"/mark.svg",name:title},tree:[],account:{signedOutLabel:title,sections:[]}});
  put(frameContent.command as never,{triggerLabel:title,heading:title,searchLabel:title,closeLabel:title,emptyMessage:title,groups:[]});
  const sectionRenderers = Object.fromEntries(manifest.fills.map(fill=>[fill.renderer.id,surfaceRuntimeRenderers[fill.leaf]!.render]));
  const pixels = Object.fromEntries(Object.entries(profile.values.members).filter(([id])=>id.startsWith("tokens.breakpoint.")).map(([id,member])=>{const v=member.value.light as {unit:string;value:number};return [id,v.value*(v.unit==="px"?1:16)];}));
  const runtime:RegisteredRouteRuntime={assembly:{identity:{kind:"git",head:"a".repeat(40),tree:"b".repeat(40)},engine,contracts:contracts as never,ports:{manifest,renderers:sectionRenderers,resolveContent:reference=>values.get(reference.ref),frameOrder:({layout,slots})=>[...Object.values(slots).flat(),...layout],frameHost:{navigate:vi.fn()}},themes:["light"],states:["default"],breakpointPixels:pixels,breakpointBasis:{renderer:layoutRenderer,environment:{kind:"SYNTHETIC 16px root font"}},css:[{id:"publisher-flow-stage.css",contents:flowStageStyleSheet(profile,"layouts.stack","stack.workspace")}],assets:[],stageMeasurements:{renderer:layoutRenderer,environment:{kind:"SYNTHETIC width basis"},cells:runtimeAssemblyCells(profile,["light"],["default"],[],pixels).map(cell=>({cell,width:cell.width-80}))}},instanceLibrary:{id:profile.consumer,role:"consumer",resolveFill:(leaf,config)=>leaf==="layouts.stack"&&config==="stack.workspace"?{library:profile.consumer,leaf,config,headings:[],states:["default"],renderer:source}:undefined,resolveContent:reference=>reference},registries:registries as never,layoutRenderer,cell:{theme:"light",state:"default",width:320}};
  const publication = createRegisteredPublicationSession(bound.registry.publication!,{bind:vi.fn(),setRegions:vi.fn(),setState:vi.fn(),setCommands:vi.fn(),setChunks:vi.fn()});
  const reference=(name:string,kind:RuntimeContent["reference"]["kind"]="records")=>({kind,ref:`consumer.archive/${name}`});
  const itemData = [
    adminPageContent(f.copy,reference("item/heading","copy"),{text:writerCopy(f.config.title),id:"collection"}),
    adminPageContent(f.copy,reference("item/stats"),[{id:"total",label:writerCopy({id:"strings.admin.stats.total",values:{count:1}})}]),
    adminPageContent(f.copy,reference("item/fields"),[{label:writerCopy({id:"strings.admin.column.key"}),value:writerCopy(f.config.title)}]),
    adminPageContent(f.copy,reference("item/status","copy"),writerCopy({id:"strings.admin.status.draft"})),
  ];
  const listData = [
    {reference:reference("collection/editions/band"),value:[{id:"editions",references:{"consumer.archive/band.heading":reference("loaded/band.heading","copy"),"consumer.archive/band.stats":reference("loaded/band.stats"),"consumer.archive/cards":reference("loaded/cards")}}]},
    {reference:reference("loaded/band.heading","copy"),value:{text:writerCopy(f.config.title),id:"collection--editions"}},
    {reference:reference("loaded/band.stats"),value:[{id:"count",label:writerCopy({id:"strings.admin.stats.total",values:{count:2}})}]},
    {reference:reference("loaded/cards"),value:[{id:"recent",references:{"consumer.archive/card.header":reference("loaded/header","copy"),"consumer.archive/card.rows":reference("loaded/rows"),"consumer.archive/card.pagination":reference("loaded/pagination","region")}}]},
    {reference:reference("loaded/header","copy"),value:{heading:writerCopy(f.config.title),id:"collection--editions--recent",level:4,count:2}},
    {reference:reference("loaded/rows"),value:[{id:"edition",edition:writerCopy(f.config.title)}]},
    {reference:reference("loaded/pagination","region"),value:{label:writerCopy({id:"strings.admin.pagination.label"}),showAll:writerCopy({id:"strings.admin.action.showAll",values:{count:2}}),previous:writerCopy({id:"strings.admin.pagination.previous"}),next:writerCopy({id:"strings.admin.pagination.next"})}},
  ].map(({reference,value})=>adminPageContent(f.copy,reference,value));
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
