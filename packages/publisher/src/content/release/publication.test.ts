/** @vitest-environment node */
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { computeCopyFingerprint } from "@clossys/writer";
import { packageSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { compilePublication, publicationLibraryPins, assertCompiledPublication, publicationDigest, publicationLayoutPin, stampPublication } from "./publication.js";
import { prepareContentRelease, computeReleaseDigest } from "./prepare.js";
import { releaseInput, refreshReleaseInput } from "./__fixtures__/release.js";
import { appendContentRevision } from "../revisions.js";
import { checkContentApproval } from "../approval.js";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeContentRelease, selectContentRelease, rollbackContentRelease } from "../store/release.js";
import examples from "../../../examples/admin-pages.config.json" with { type: "json" };
vi.mock("node:fs/promises", async original => ({ ...(await original<typeof import("node:fs/promises")>()) }));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true}); });
async function directory() { const root = await fs.mkdtemp(join(tmpdir(),"publication-release-")); roots.push(root); return root; }
async function tree(root: string): Promise<Record<string,string>> { const found: Record<string,string> = {}; async function visit(path: string,prefix="") { for (const entry of await fs.readdir(path,{withFileTypes:true})) { const key=prefix+entry.name; if(entry.isDirectory()) await visit(join(path,entry.name),key+"/"); else found[key]=await fs.readFile(join(path,entry.name),"utf8"); } } await visit(root); return found; }

let fixture: Awaited<ReturnType<typeof packageSurfaceLibrary>>;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); }, 120000);
function setup() {
  const engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options };
  const pins = publicationLibraryPins(engine);
  const label = "Publication";
  const source = { id: "publication", revision: "r1", locale: "en", source: { kind: "consumer", reference: "synthetic/publication" }, entries: [{ id: "publication.title", text: label, context: "Synthetic release title", status: "approved", approval: { approvedBy: "owner", approvedAt: "2026-01-01T00:00:00Z", textFingerprint: computeCopyFingerprint(label), fingerprintAlgorithm: "sha256" } }] };
  const writer = { registry: source, at: "2026-02-04T05:06:07Z" };
  const map: any = { version: 1, publicationId: "publication", format: "web.page.responsive", entries: [{ id: "home", order: 0, title: label, kind: "page", path: "/agents/sample", pin: { nav: true }, source: { planItemId: "home" }, constructs: { main: [{ section: "sections.section-header", config: "default", content: { heading: { kind: "copy", ref: "heading" } } }] }, manifest: { l0: [] } }] };
  const bindings: any = { consumer: engine.library.source.id, channel: "site", brand: { homeRouteId: "home", label }, completeRoutes: { home: { kind: "designer", entry: { file: "src/app/page.tsx", export: "default" }, loader: { file: "src/data/home.ts", export: "loadRoute" } } } };
  const copy = { ref: { id: "publication.title", locale: "en" }, fingerprint: computeCopyFingerprint(label) };
  source.entries.push({ ...source.entries[0]!,id:"publication.identity",text:"publication",approval:{...source.entries[0]!.approval,textFingerprint:computeCopyFingerprint("publication")} });
  const snapshot: any = { version: 1, map, bindings, origin: "https://example.com", libraryVersion: pins.version, configPins: [structuredClone(pins.configs.find(p => p.leaf === "sections.section-header" && p.config === "default"))], copyPins: { "map/entries/0/title": copy, "bindings/brand/label": structuredClone(copy), heading: structuredClone(copy), "map/publicationId":{ref:{id:"publication.identity",locale:"en"},fingerprint:computeCopyFingerprint("publication")} } };
  return { engine, writer, snapshot };
}
it("compiles all seven products from one snapshot, immutable and deterministic", () => {
  const f = setup(), before = JSON.stringify(f.snapshot);
  const a = compilePublication(f.snapshot, f.engine, f.writer);
  expect(a.products.routes.routes[0]).toMatchObject({ routeId: "home", title: "Publication" });
  expect(a.products.nav.home.activeId).toBe("home");
  expect(a.products.cmdk[0]!.items[0]!.label).toBe("Publication");
  expect(a.products.breadcrumbs.home[0]!.label).toBe("Publication");
  expect(a.products.outline[0]!.id).toBe("home");
  expect(a.products.sitemap).toEqual([{ url: "https://example.com/agents/sample" }]);
  expect(a.products.deckOutline[0]).toMatchObject({ entryId: "home", slot: "main", index: 0, section: "sections.section-header", config: "default" });
  expect(compilePublication(JSON.parse(before), f.engine, f.writer)).toEqual(a);
  expect(Object.isFrozen(a.products.deckOutline)).toBe(true);
  expect(JSON.stringify(f.snapshot)).toBe(before);
});
it("refuses draft, missing approval, stale text, wrong fingerprint, unknown copy and caller switches", () => {
  for (const mutate of [
    (f: any) => { f.writer.registry.entries[0].status = "draft"; },
    (f: any) => { delete f.writer.registry.entries[0].approval; },
    (f: any) => { f.writer.registry.entries[0].text += " changed"; },
    (f: any) => { f.snapshot.copyPins.heading.fingerprint = "0".repeat(64); },
    (f: any) => { f.snapshot.copyPins.heading.ref.id = "missing"; },
    (f: any) => { f.writer.target = "preview"; },
    (f: any) => { delete f.snapshot.copyPins["map/entries/0/title"]; },
  ]) { const f = setup(); mutate(f); expect(() => compilePublication(f.snapshot, f.engine, f.writer)).toThrow(); }
});
it("refuses config/source/version drift and unknown config rather than silently repinning", () => {
  for (const mutate of [
    (f: any) => { f.snapshot.configPins[0].configHash = "0".repeat(64); },
    (f: any) => { f.snapshot.libraryVersion = "sha256:" + "0".repeat(64); },
    (f: any) => { f.snapshot.map.entries[0].constructs.main[0].config = "missing"; },
    (f: any) => { f.snapshot.configPins[0].descriptorHash = "sha256:" + "0".repeat(64); },
  ]) { const f = setup(); mutate(f); expect(() => compilePublication(f.snapshot, f.engine, f.writer)).toThrow(); }
});
it("revisions bind every publication input and invalidate old owner approval", () => {
  const f = setup(), input = releaseInput();
  (input.registry.candidates[0]!.typeSettings as any).publication = f.snapshot;
  refreshReleaseInput(input);
  const candidate = input.registry.candidates[0]!;
  for (const mutate of [
    (s: any) => { s.map.entries[0].order = 1; },
    (s: any) => { s.bindings.completeRoutes.home.loader.export = "other"; },
    (s: any) => { s.copyPins.heading.fingerprint = "0".repeat(64); },
    (s: any) => { s.configPins[0].config = "level-2"; },
  ]) { const changed = structuredClone(candidate); mutate(changed.typeSettings.publication); const history = appendContentRevision(candidate.history, changed, input.at); const next = { ...changed, revision: history.at(-1)!.revision, history }; expect(history).toHaveLength(2); expect(checkContentApproval(next, "publish").length).toBeGreaterThan(0); }
});
it("uses existing owner/review release gates and stamps seven outputs with final manifest digest", () => {
  const f = setup(), input: any = releaseInput();
  input.registry.candidates[0].typeSettings.publication = f.snapshot;
  refreshReleaseInput(input);
  input.publicationLibrary = f.engine; input.writer = { registry: f.writer.registry };
  const result = prepareContentRelease(input);
  expect(result.findings).toEqual([]); expect(result.ok).toBe(true);
  if (!result.ok) return;
  const bundle = result.releases[0]!;
  const products = bundle.build.publications![0]!.products;
  expect(Object.keys(products)).toHaveLength(7);
  for (const value of Object.values(products)) expect(value.releaseDigest).toBe(bundle.manifest.digest);
  const original = JSON.stringify(result);
  input.writer.registry.entries[0].status = "draft";
  expect(prepareContentRelease(input)).toMatchObject({ ok: false, releases: [] });
  expect(JSON.stringify(result)).toBe(original);
});

function releaseFixture(f = setup()): any {
  const input: any=releaseInput(); input.registry.candidates[0].typeSettings.publication=f.snapshot;
  refreshReleaseInput(input); input.publicationLibrary=f.engine; input.writer={registry:f.writer.registry}; return input;
}
function repin(f: any) {
  const copyPins: any = {}, configs = publicationLibraryPins(f.engine).configs, selected = new Map<string,unknown>();
  const pin = (path: string,id="publication.title",literal?: string) => {
    const entry = literal === undefined ? f.writer.registry.entries.find((row: any)=>row.id===id) : f.writer.registry.entries.find((row: any)=>row.text===literal);
    if (!entry) throw new Error("Missing synthetic Writer record for "+path);
    copyPins[path]={ref:{id:entry.id,locale:"en"},fingerprint:computeCopyFingerprint(entry.text)};
  };
  function walk(value: any,path: string) {
    if(Array.isArray(value)) return value.forEach((row,i)=>walk(row,path+"/"+i)); if(!value || typeof value!=="object") return;
    if(value.kind==="copy") pin(value.ref);
    if(typeof value.id==="string" && Object.keys(value).every(k=>["id","locale","values"].includes(k))) { pin(path,value.id); return; }
    const leaf=value.section ?? (value.leaf?.startsWith("frames.")?value.leaf:undefined);
    if(leaf) { const config=value.config??null,key=JSON.stringify([leaf,config]); const row=configs.find((p: any)=>p.leaf===leaf && p.config===config); if(!row) throw new Error("Missing config "+key); selected.set(key,structuredClone(row)); }
    for(const [key,row] of Object.entries(value)) { if(["title","label","description","group"].includes(key) && typeof row==="string") pin(path+"/"+key,undefined,row); walk(row,path+"/"+key); }
  }
  walk(f.snapshot.map,"map"); walk(f.snapshot.bindings,"bindings"); walk(f.snapshot.pageConfigs??[],"pageConfigs"); if(f.snapshot.publication) walk(f.snapshot.publication,"publication"); pin("map/publicationId",undefined,f.snapshot.map.publicationId);
  f.snapshot.copyPins=copyPins; f.snapshot.configPins=[...selected.values()]; return f;
}
function consumerFixture(region = false) {
  const f=setup(); const config: any=structuredClone(examples[1]); delete config.item;
  function replace(value: any): any { if(Array.isArray(value)) return value.map(replace); if(value && typeof value==="object") { if(typeof value.id==="string" && Object.keys(value).every(k=>["id","locale","values"].includes(k))) return {id:"publication.title",locale:"en"}; return Object.fromEntries(Object.entries(value).map(([key,row])=>[key,replace(row)])); } return value; }
  const a=replace(config),b=replace(config); Object.assign(a,{id:"inventory",entryId:"home",namespace:"inventory"}); Object.assign(b,{id:"archive",entryId:"archive",namespace:"archive"});
  f.snapshot.pageConfigs=[a,b];
  const first=f.snapshot.map.entries[0]; first.pageConfig=a.id; first.constructs.main[0]={...a.levels.l0.header,content:{heading:{kind:"copy",ref:"heading"}}};
  f.snapshot.map.entries.push({...structuredClone(first),id:"archive",pageConfig:b.id,order:1,path:"/archive",source:{planItemId:"archive"}});
  if(region) { f.snapshot.publication={id:"publication",mainSlot:"body",frame:{leaf:"frames.app-shell"},layout:{leaf:"layouts.stack",config:"stack.workspace"},format:"web.page.responsive",surface:"app",context:{consumer:f.engine.library.source.id,medium:"web"},packIds:[]};
  delete f.snapshot.bindings.completeRoutes;
  f.snapshot.bindings.registrations=f.snapshot.map.entries.map((entry: any)=>({routeId:entry.id,path:entry.path,title:entry.title,channel:"site",brand:{...f.snapshot.bindings.brand},planItemId:entry.id,entry:{file:`src/${entry.id}/page.tsx`,export:"default"},composition:{source:{file:`src/${entry.id}/data.ts`,export:"data"},runtime:{file:"src/runtime.ts",export:"runtime"},header:{id:"header."+entry.id,data:{title:entry.title}},binding:{instanceId:entry.id,label:entry.title,path:entry.path,publicationId:"publication",regions:{main:entry.constructs.main}}}}));
  f.snapshot.layoutPin=publicationLayoutPin(f.snapshot.publication);
  } else { f.snapshot.bindings.completeRoutes.archive={kind:"publisher",entry:{file:"src/archive/page.tsx",export:"default"},loader:{file:"src/archive/data.ts",export:"loadRoute"}}; }
  return repin(f);
}
it("compiles two consumer configs with source metadata (no runtime qualification) and binds their config/ref bytes",()=>{
  const f=consumerFixture(); const compiled=compilePublication(f.snapshot,f.engine,f.writer); expect(compiled.products.routes.routes.map(row=>row.routeId)).toEqual(["home","archive"]); expect(compiled.snapshot.pageConfigs).toHaveLength(2); assertCompiledPublication(compiled);
  for(const mutate of [(x:any)=>{delete x.snapshot.pageConfigs;},(x:any)=>{x.snapshot.pageConfigs[0].entryId="foreign";},(x:any)=>{x.snapshot.pageConfigs[0].levels.l0.header.config="level-3";},(x:any)=>{x.snapshot.map.entries[0].constructs.main[0].content.heading={kind:"copy",ref:"heading",forged:true};},(x:any)=>{x.snapshot.pageConfigs[0].title.id="unrelated.title";}]) { const changed=consumerFixture(); mutate(changed); expect(()=>compilePublication(changed.snapshot,changed.engine,changed.writer)).toThrow(); }
});
it("valid map/binding/copy/config edits change content identity, while key insertion order does not",()=>{
  const f=setup(),original=compilePublication(f.snapshot,f.engine,f.writer).snapshotDigest;
  for(const mutate of [(x:any)=>{x.snapshot.map.entries[0].order=2;},(x:any)=>{x.snapshot.bindings.completeRoutes.home.loader.export="loadOther";},(x:any)=>{x.writer.registry.entries[0].text="Changed";x.writer.registry.entries[0].approval.textFingerprint=computeCopyFingerprint("Changed");x.snapshot.map.entries[0].title="Changed";x.snapshot.bindings.brand.label="Changed";repin(x);},(x:any)=>{x.snapshot.map.entries[0].constructs.main[0].config="level-3";repin(x); }]) {const next=setup();mutate(next);expect(compilePublication(next.snapshot,next.engine,next.writer).snapshotDigest).not.toBe(original);}
  const reverse=(v:any):any=>Array.isArray(v)?v.map(reverse):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).reverse().map(([k,row])=>[k,reverse(row)])):v; expect(compilePublication(reverse(f.snapshot),f.engine,f.writer).snapshotDigest).toBe(original);
});
it("requires Writer proof for action groups and publication fallback labels",()=>{
  const f=setup();delete f.snapshot.copyPins["map/publicationId"];expect(()=>compilePublication(f.snapshot,f.engine,f.writer)).toThrow(/copy pin/);
  const g=setup();g.snapshot.map.actions=[{id:"action",label:"Publication",group:"Publication",intent:"open"}];repin(g);expect(compilePublication(g.snapshot,g.engine,g.writer).products.cmdk).toHaveLength(2); delete g.snapshot.copyPins["map/actions/0/group"];expect(()=>compilePublication(g.snapshot,g.engine,g.writer)).toThrow(/copy pin/);
});
it("rejects forged historical seven-product schemas even with recomputed hashes",()=>{
  const f=setup(),compiled=compilePublication(f.snapshot,f.engine,f.writer);assertCompiledPublication(compiled);
  for(const mutate of [(x:any)=>{delete x.products.nav;},(x:any)=>{x.products.extra=[];},(x:any)=>{x.products.deckOutline=[];},(x:any)=>{x.evidence.copy.heading.resolution.entryId="foreign";},(x:any)=>{x.snapshot.version=2;},(x:any)=>{x.snapshot.configPins[0].extra=true;}]) {const value:any=structuredClone(compiled);mutate(value);value.snapshotDigest=publicationDigest({snapshot:value.snapshot,evidence:value.evidence,products:value.products});expect(()=>assertCompiledPublication(value)).toThrow();}
});
it("requires every multi-page route to join a selected active candidate on the same target",()=>{
  const f=consumerFixture(),input=releaseFixture(f);expect(prepareContentRelease(input)).toMatchObject({ok:false,releases:[]});
  const slot=structuredClone(input.registry.slots[0]),candidate=structuredClone(input.registry.candidates[0]);slot.id="sl_bbbbbbbbbb";slot.aliases=["websites/admin/archive"];slot.route="/archive";slot.activeCandidateId="archive-candidate";candidate.id="archive-candidate";candidate.slotId=slot.id;delete candidate.typeSettings.publication;input.registry.slots.push(slot);input.registry.candidates.push(candidate);input.selections.push({candidateId:candidate.id,review:input.selections[0].review});refreshReleaseInput(input);const result=prepareContentRelease(input);expect(result.findings).toEqual([]);expect(result.ok).toBe(true);if(result.ok)expect(result.releases[0]!.build.routes.map(row=>row.path).sort()).toEqual(["/agents/sample","/archive"]);
  input.registry.slots[1].deployTarget="foreign";expect(prepareContentRelease(input)).toMatchObject({ok:false,releases:[]});
});
it("store snapshots validated bytes before await, including producer callback closure changes",async()=>{
  const f=setup(),input=releaseFixture(f),root=await directory(); const expected=prepareContentRelease(input); let fileExists=true; input.publicationLibrary={...f.engine,fileExists:()=>fileExists};const pending=writeContentRelease(root,input); fileExists=false;input.writer.registry.entries[0].status="draft";input.registry.candidates[0].typeSettings.publication.map.entries[0].title="tampered";const result=await pending;expect(result.ok).toBe(true);expect(result).toEqual(expected);
});
it("selects releases and rolls back only previously selected digests without changing history",async()=>{
  const root=await directory(),input=releaseFixture();const first=await writeContentRelease(root,input);expect(first.ok).toBe(true);if(!first.ok)return;const one=first.releases[0]!.manifest;expect((await rollbackContentRelease(root,one.targetId,one.digest)).ok).toBe(false);expect((await selectContentRelease(root,one.targetId,one.digest)).ok).toBe(true);
  const second=await writeContentRelease(root,input);expect(second.ok).toBe(true);if(!second.ok)return;const two=second.releases[0]!.manifest;expect((await rollbackContentRelease(root,one.targetId,two.digest)).ok).toBe(false);expect((await selectContentRelease(root,two.targetId,two.digest)).ok).toBe(true);const before=await tree(root);expect((await rollbackContentRelease(root,one.targetId,"0".repeat(64))).ok).toBe(false);expect(await tree(root)).toEqual(before);const rollback=await rollbackContentRelease(root,one.targetId,one.digest);expect(rollback).toMatchObject({ok:true,pointer:{current:{digest:one.digest},released:[{digest:one.digest},{digest:two.digest}]}});const after=await tree(root);for(const [name,bytes] of Object.entries(before))if(name.startsWith("_releases/"))expect(after[name]).toBe(bytes);
});
it("refuses corrupt prior bundles and pointer writes atomically",async()=>{
  const root=await directory(),input=releaseFixture(),first=await writeContentRelease(root,input);expect(first.ok).toBe(true);if(!first.ok)return;const manifest=first.releases[0]!.manifest;const before=await tree(root);const original=fs.rename;vi.spyOn(fs,"rename").mockImplementation(async (...args:Parameters<typeof fs.rename>)=>{if(String(args[1]).includes("_release-pointers"))throw new Error("disk full");return original(...args);});expect((await selectContentRelease(root,manifest.targetId,manifest.digest)).ok).toBe(false);vi.restoreAllMocks();for(const [name,bytes]of Object.entries(before))expect((await tree(root))[name]).toBe(bytes);expect(await fs.readdir(join(root,"_release-pointers"))).toEqual([]);
  await fs.writeFile(join(root,"_releases",manifest.targetId,"1.build.json"),"{}");const corrupted=await tree(root);expect((await selectContentRelease(root,manifest.targetId,manifest.digest)).ok).toBe(false);expect(await tree(root)).toEqual(corrupted);
});

it("refuses actual consumer region production while its real Publisher layout is draft",()=>{ const f=consumerFixture(true);expect(()=>compilePublication(f.snapshot,f.engine,f.writer)).toThrow(/stable Publisher layout/); f.snapshot.layoutPin.hash="0".repeat(64);expect(()=>compilePublication(f.snapshot,f.engine,f.writer)).toThrow(/layout.*drift/); });
it("consumer config bytes invalidate the same revision owner approval",()=>{const f=consumerFixture(),input=releaseFixture(f),candidate=input.registry.candidates[0];const changed=structuredClone(candidate);changed.typeSettings.publication.pageConfigs[0].columns[0].key="other";const history=appendContentRevision(candidate.history,changed,input.at);expect(history).toHaveLength(2);expect(checkContentApproval({...changed,revision:history.at(-1)!.revision,history},"publish").length).toBeGreaterThan(0);});
it("release rechecks current config pins and never emits partial products",()=>{const input=releaseFixture();expect(prepareContentRelease(input).ok).toBe(true);input.registry.candidates[0].typeSettings.publication.configPins[0].sourceHash="0".repeat(64);refreshReleaseInput(input);expect(prepareContentRelease(input)).toMatchObject({ok:false,releases:[]});});
