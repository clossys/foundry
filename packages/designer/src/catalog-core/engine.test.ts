import { describe, expect, it } from "vitest";
import { applyLibraryChange, check, consumptionReport, emit, generateSelection, libraryHash, loadCatalog, migrateSelection, resolve, sha256, stableStringify, type CatalogData, type DtcgToken, type FillDoc, type LibraryData, type Slot } from "./index.js";
import { flatten, metaOf } from "./model.js";
import originalFoundryFills from "./__fixtures__/foundry-original-fills.json" with {type:"json"};
const source = { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" } as const;
function slot(id: string, asset = false): Slot { return { id, layer: asset ? "assets" : "tokens", contract: asset ? { kind: "asset", valueKind: "svg", members: { mode: "closed", names: ["default"] }, modes: ["light"] } : { kind: "token", tier: "scale", $type: "number", members: { mode: "open", pattern: "^[a-z0-9-]+$" }, modes: ["light"] }, requires: [], status: "draft" }; }
function fixture() {
  const catalog: CatalogData = { slots: [slot("tokens.sample"),slot("assets.mark",true)], fills: [], sources: [], standards: [], placements: [], retired: [], rules: [{id:"mark@1",slot:"assets.mark",values:{default:{$type:"svg",$value:'<svg><text>{{tokens.sample.paint}}</text></svg>'}}}] };
  let library: LibraryData = {source, fills: [], adoptedAt:"2026-10-23"};
  library = applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"author",slot:"tokens.sample",tokens:{paint:{$type:"number",$value:1}}}]});
  return {catalog,library};
}
function candidate(slotId: string, values: Record<string,DtcgToken>, sourceId="upstream"): FillDoc { return { $extensions: {"com.clossys.fill":{id:`${sourceId}/${slotId}`,slot:slotId,source:sourceId,mode:"implementation",sourceAddress:"fixture",relation:"same-contract",builtOn:[],conforms:[],evidence:[],author:"third-party",trust:"pinned-upstream",license:"MIT",pin:{version:"1"},status:"draft"}},tokens:{[slotId.split(".")[1]!]:values} }; }
const errors = (input: ReturnType<typeof fixture>) => check(input).findings.filter(f => f.severity === "error" && f.rule !== "binding" && f.rule !== "asset").map(f => f.message);
export function adoptFoundry(): {catalog:CatalogData;library:LibraryData} {
  const catalog={...loadCatalog(),fills:structuredClone(originalFoundryFills) as unknown as FillDoc[]}; let library:LibraryData={source,fills:[],adoptedAt:"2026-10-23"};
  library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:catalog.fills.filter(fill=>metaOf(fill).source==="foundry").map(fill=>({op:"adopt" as const,slot:metaOf(fill).slot,source:"foundry"}))});
  const profile=resolve({catalog,library}); library={...library,baseline:Object.fromEntries(Object.values(profile.members).filter(m=>m.emit).map(m=>[m.emit!,{...m.css}]))};
  return {catalog,library};
}
describe("consumer library truth",()=>{
  it("does not resolve candidate fills or legacy defaults",()=>{
    const {catalog,library}=fixture(); catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:99}})];
    expect(resolve({catalog,library}).members["tokens.sample.paint"]?.value.light).toBe(1);
    expect(Object.keys(resolve({catalog,library:{...library,fills:[]}}).members)).toEqual([]);
  });
  it("adopts pinned copies that resolve and emit byte-identically offline",()=>{
    const input=adoptFoundry(); const before=resolve(input); const offline={...input,catalog:{...input.catalog,fills:[],sources:[]}};
    expect(stableStringify(resolve(offline))).toBe(stableStringify(before));
    expect(emit(resolve(offline),["css-brand","css-scales","css-fonts","tailwind-theme","notices"])).toEqual(emit(before,["css-brand","css-scales","css-fonts","tailwind-theme","notices"]));
    const drift=check(offline).findings.filter(f=>f.code==="C10"); expect(drift).toHaveLength(217); expect(drift.every(f=>f.severity==="notice")).toBe(true);
  });
  it("distinguishes adopted-content tamper from upstream drift",()=>{
    const {catalog}=fixture(); catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:2}})];
    let library:LibraryData={source,fills:[],adoptedAt:"2026-10-23"}; library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"adopt",slot:"tokens.sample",source:"upstream"}]});
    const copy=structuredClone(library); (Object.values(flatten(copy.fills[0]!))[0]!).$value=3;
    expect(check({catalog,library:copy}).findings.filter(f=>f.code==="C10").map(f=>f.message)).toContain("provenance: tokens.sample.paint adopted content differs from its recorded sha256; re-kind as authored");
    Object.values(flatten(copy.fills[0]!))[0]!.$extensions!["com.clossys.materializedSha256"]=sha256(stableStringify({$type:"number",$value:3}));
    expect(check({catalog,library:copy}).findings.map(f=>f.message)).toContain("provenance: tokens.sample.paint has inconsistent alias materialization metadata");
    const changed=structuredClone(catalog); (Object.values(flatten(changed.fills[0]!))[0]!).$value=4;
    const drift=check({catalog:changed,library}).findings.filter(f=>f.code==="C10"); expect(drift).toHaveLength(1); expect(drift[0]!.severity).toBe("notice");
    expect(resolve({catalog:changed,library}).members["tokens.sample.paint"]?.value.light).toBe(2);
  });
  it("preserves per-member origins across subset adoptions",()=>{
    const {catalog,library}=fixture(); catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:2},space:{$type:"number",$value:8}})];
    const next=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"adopt",slot:"tokens.sample",source:"upstream",members:["space"]}]});
    const profile=resolve({catalog,library:next}); expect(profile.members["tokens.sample.paint"]?.origin?.kind).toBe("authored"); expect(profile.members["tokens.sample.space"]?.origin?.kind).toBe("adopted");
    expect(metaOf(next.fills[0]!).originKinds).toEqual(["adopted","authored"]); expect(errors({catalog,library:next})).toEqual([]);
  });
  it("keeps resolution, hashes and emitted bytes stable across five ordering seeds",()=>{
    const input=adoptFoundry(); const expected=resolve(input); const files=emit(expected,["css-brand","css-scales","css-fonts","tailwind-theme","notices"]);
    const reorder=(value:unknown,seed:number):unknown=>Array.isArray(value) ? value.map(entry=>reorder(entry,seed)) : value!==null && typeof value==="object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>(a.charCodeAt(a.length-1)!+seed)%7-(b.charCodeAt(b.length-1)!+seed)%7 || b.localeCompare(a)).map(([key,entry])=>[key,reorder(entry,seed)])) : value;
    for(let seed=1;seed<=5;seed++) {
      const library=reorder({...input.library,fills:[...input.library.fills.slice(seed),...input.library.fills.slice(0,seed)]},seed) as LibraryData;
      const catalog={...input.catalog,slots:[...input.catalog.slots].reverse(),fills:[...input.catalog.fills].reverse(),sources:[...input.catalog.sources].reverse()};
      expect(libraryHash(library)).toBe(libraryHash(input.library)); expect(stableStringify(resolve({catalog,library}))).toBe(stableStringify(expected)); expect(emit(resolve({catalog,library}),["css-brand","css-scales","css-fonts","tailwind-theme","notices"])).toEqual(files);
    }
  });
  it("adopts alias closure or materializes a conflicting alias with aliasOf",()=>{
    const {catalog}=fixture(); catalog.slots=[slot("tokens.sample"),slot("tokens.role")];
    catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:2}}),candidate("tokens.role",{default:{$type:"number",$value:"{tokens.sample.paint}"}})];
    let library:LibraryData={source,fills:[],adoptedAt:"2026-10-23"}; library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"adopt",slot:"tokens.role",source:"upstream"}]});
    expect(library.fills).toHaveLength(2); expect(resolve({catalog,library}).members["tokens.role.default"]?.value.light).toBe(2);
    library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"author",slot:"tokens.sample",tokens:{paint:{$type:"number",$value:9}}},{op:"adopt",slot:"tokens.role",source:"upstream"}]});
    const profile=resolve({catalog,library}); expect(profile.members["tokens.role.default"]?.value.light).toBe(2); expect(profile.members["tokens.sample.paint"]?.value.light).toBe(9);
    expect(profile.members["tokens.role.default"]?.origin).toMatchObject({kind:"adopted",aliasOf:"tokens.sample.paint"}); expect(errors({catalog,library})).toEqual([]);
    for(const corruption of ["value","aliasOf","hash"] as const) {
      const damaged=structuredClone(library); const token=flatten(damaged.fills.find(fill=>metaOf(fill).slot==="tokens.role")!)["tokens.role.default"]!;
      if(corruption==="value") token.$value=123;
      else if(corruption==="aliasOf") delete (token.$extensions!["com.clossys.origin"] as Extract<NonNullable<DtcgToken["$extensions"]>["com.clossys.origin"],{kind:"adopted"}>).aliasOf;
      else delete token.$extensions!["com.clossys.materializedSha256"];
      expect(check({catalog,library:damaged}).findings.filter(f=>f.code==="C10" && f.severity==="error").length).toBeGreaterThan(0);
    }
    const plain=structuredClone(library); const plainToken=flatten(plain.fills.find(fill=>metaOf(fill).slot==="tokens.role")!)["tokens.role.default"]!;
    plainToken.$extensions!["com.clossys.origin"]={...profile.members["tokens.role.default"]!.origin!,aliasOf:undefined} as never;
    expect(check({catalog,library:plain}).findings.map(f=>f.message)).toContain("provenance: tokens.role.default has inconsistent alias materialization metadata");
  });
  it("closes member-scoped aliases within the same leaf",()=>{
    const {catalog}=fixture(); catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:"{tokens.sample.other}"},other:{$type:"number",$value:2}})];
    const library=applyLibraryChange(catalog,{source,fills:[],adoptedAt:"2026-10-23"},{baseHash:libraryHash({source,fills:[],adoptedAt:"2026-10-23"}),changes:[{op:"adopt",slot:"tokens.sample",source:"upstream",members:["paint"]}]});
    expect(Object.keys(resolve({catalog,library}).members)).toEqual(["tokens.sample.other","tokens.sample.paint"]); expect(errors({catalog,library})).toEqual([]);
  });
  it("generates selection v2 and catches provenance/rationale drift",()=>{
    const input=fixture(); expect(generateSelection(input.library)).toEqual(input.library.selection);
    const library=structuredClone(input.library); library.selection!.slots=[];
    expect(check({...input,library}).findings.map(f=>f.message)).toContain("provenance: generated selection differs from consumer fills and rationale");
    expect(() => applyLibraryChange(input.catalog,input.library,{baseHash:"stale",changes:[]})).toThrow("changeset baseHash does not match library");
  });
  it("reports missing consumer leaves as errors only when complete",()=>{
    const input=fixture(); expect(check(input).findings.find(f=>f.subject==="assets.mark")?.severity).toBe("notice");
    expect(check({...input,library:{...input.library,complete:true}}).findings.find(f=>f.subject==="assets.mark")?.severity).toBe("error");
    input.catalog.slots=[{...slot("tokens.sample"),contract:{kind:"token",tier:"scale",$type:"number",members:{mode:"closed",names:["paint","missing"]},modes:["light"]}}];
    expect(check(input).findings.map(f=>f.message)).toContain("coverage: tokens.sample.missing has no value in profile example");
  });
  it("rejects non-consumer sources and reference fills in the active library",()=>{
    const input=fixture(); const reference=structuredClone(input.library); metaOf(reference.fills[0]!).mode="reference"; metaOf(reference.fills[0]!).source="upstream";
    expect(check({...input,library:reference}).findings.filter(f=>f.code==="C7").map(f=>f.message)).toEqual(["selection: consumer fill example/tokens.sample has mode reference, expected implementation","selection: consumer fill example/tokens.sample names source upstream, expected example"]);
  });
  it("checks the original Foundry contrast failures without claiming clearance",()=>{
    const findings=check(adoptFoundry()).findings; expect(findings.filter(f=>f.code==="C9" && f.severity==="error")).toHaveLength(11); expect(findings.filter(f=>f.code==="C10" && f.severity==="error")).toEqual([]);
  });
  it("emits origin license notices and refuses unapproved adopted licenses",()=>{
    const input=fixture(); input.catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:2}})]; metaOf(input.catalog.fills[0]!).license="GPL-3.0";
    const library=applyLibraryChange(input.catalog,input.library,{baseHash:libraryHash(input.library),changes:[{op:"adopt",slot:"tokens.sample",source:"upstream"}]});
    expect(check({...input,library}).findings.map(f=>f.message)).toContain("licence: tokens.sample.paint origin licence GPL-3.0 is not on the allow list");
    expect(JSON.parse(emit(resolve({...input,library}),["notices"])[0]!.contents).origins[0]).toMatchObject({kind:"adopted",license:"GPL-3.0",source:"upstream"});
  });
  it("requires external pin receipts and validates their license without rejecting newer upstream pins",()=>{
    const input=fixture(); input.catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:2}})]; input.catalog.sources=[{id:"upstream",kind:"external",author:"third-party",license:"MIT",pin:{version:"1"}}];
    const library=applyLibraryChange(input.catalog,input.library,{baseHash:libraryHash(input.library),changes:[{op:"adopt",slot:"tokens.sample",source:"upstream"}]});
    const unpinned=structuredClone(library); delete (Object.values(flatten(unpinned.fills[0]!))[0]!.$extensions!["com.clossys.origin"] as Extract<NonNullable<DtcgToken["$extensions"]>["com.clossys.origin"],{kind:"adopted"}>).pin;
    expect(check({...input,library:unpinned}).findings.map(f=>f.message)).toContain("pin: tokens.sample.paint adopted external source upstream has no valid pinned receipt");
    const wrongLicense=structuredClone(library); (Object.values(flatten(wrongLicense.fills[0]!))[0]!.$extensions!["com.clossys.origin"] as Extract<NonNullable<DtcgToken["$extensions"]>["com.clossys.origin"],{kind:"adopted"}>).license="ISC";
    expect(check({...input,library:wrongLicense}).findings.map(f=>f.message)).toContain("licence: tokens.sample.paint origin licence ISC differs from source upstream licence MIT");
    const upgraded=structuredClone(input.catalog); upgraded.sources[0]!.pin={version:"2"}; upgraded.sources[0]!.license="ISC"; metaOf(upgraded.fills[0]!).pin={version:"2"}; metaOf(upgraded.fills[0]!).license="ISC";
    const findings=check({catalog:upgraded,library}).findings.filter(f=>f.code==="C6" || f.code==="C10"); expect(findings).toHaveLength(1); expect(findings[0]).toMatchObject({code:"C10",severity:"notice"});
  });
  it("explicitly migrates v1 preferences into materialized fills",()=>{
    const {catalog}=fixture(); catalog.fills=[candidate("tokens.sample",{paint:{$type:"number",$value:2}},"foundry")];
    const library=migrateSelection(catalog,{source,fills:[],adoptedAt:"2026-10-23"},{version:1,consumer:"example",defaultChain:["foundry"],picks:[]});
    expect(resolve({catalog:{...catalog,fills:[]},library}).members["tokens.sample.paint"]?.value.light).toBe(2); expect(library.selection?.version).toBe(2);
  });
});
describe("explicit derived materialization and relationships",()=>{
  it("derives a same-leaf variant without replacing its authored seed or inventing a cycle",()=>{
    const {catalog,library}=fixture(); catalog.slots=[slot("tokens.sample"),{...slot("assets.mark",true),contract:{kind:"asset",valueKind:"svg",members:{mode:"closed",names:["positive","reversed","small"]},optional:["small"],modes:["light"]}}];
    catalog.rules=[{id:"reverse@1",slot:"assets.mark",values:{reversed:{$type:"svg",$value:"{{assets.mark.positive}}"}}}];
    const seeded=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"author",slot:"assets.mark",tokens:{positive:{$type:"svg",$value:"<svg aria-label=\"Example\"/>"}}}]});
    const derived=applyLibraryChange(catalog,seeded,{baseHash:libraryHash(seeded),changes:[{op:"derive",slot:"assets.mark",rule:"reverse@1",inputs:["assets.mark.positive"]}]});
    expect(resolve({catalog,library:derived}).members["assets.mark.positive"]?.origin?.kind).toBe("authored"); expect(resolve({catalog,library:derived}).members["assets.mark.reversed"]?.value.light).toBe("<svg aria-label=\"Example\"/>"); expect(errors({catalog,library:derived})).toEqual([]);
    expect(metaOf(derived.fills.find(fill=>metaOf(fill).slot==="assets.mark")!).reads).toEqual({tokens:[],assets:["assets.mark"]}); expect(consumptionReport({catalog,library:derived}).counts.assetEdges).toBe(1);
    const invalid=structuredClone(catalog); (invalid.slots[1]!.contract as import("./types.js").AssetContract).optional=["unknown"];
    expect(check({catalog:invalid,library:derived}).findings.map(f=>f.message)).toContain("contract: assets.mark optional members must be declared closed members");
  });
  it("keeps outputs until explicit refresh and flags stale inputsHash",()=>{
    let {catalog,library}=fixture(); library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"derive",slot:"assets.mark",rule:"mark@1",inputs:["tokens.sample.paint"]}]});
    expect(resolve({catalog,library}).members["assets.mark.default"]?.value.light).toBe("<svg><text>1</text></svg>"); expect(errors({catalog,library})).toEqual([]);
    library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"author",slot:"tokens.sample",tokens:{paint:{$type:"number",$value:9}}}]});
    expect(resolve({catalog,library}).members["assets.mark.default"]?.value.light).toBe("<svg><text>1</text></svg>"); expect(errors({catalog,library})).toContain("provenance: assets.mark.default has stale inputsHash for mark@1; re-derive explicitly");
    library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"derive",slot:"assets.mark",rule:"mark@1",inputs:["tokens.sample.paint"]}]});
    expect(resolve({catalog,library}).members["assets.mark.default"]?.value.light).toBe("<svg><text>9</text></svg>"); expect(errors({catalog,library})).toEqual([]);
    const report=consumptionReport({catalog,library}); expect(report.counts.tokenEdges).toBe(1); expect(report.leaves.find(l=>l.id==="tokens.sample")?.consumedBy).toEqual(["assets.mark"]);
  });
  it("rejects unknown rules and unresolved or undeclared inputs",()=>{
    const input=fixture(); expect(()=>applyLibraryChange(input.catalog,input.library,{baseHash:libraryHash(input.library),changes:[{op:"derive",slot:"assets.mark",rule:"missing@1",inputs:[]}]})).toThrow("derive: unknown rule missing@1 for assets.mark");
    expect(()=>applyLibraryChange(input.catalog,input.library,{baseHash:libraryHash(input.library),changes:[{op:"derive",slot:"assets.mark",rule:"mark@1",inputs:[]}]})).toThrow("reads undeclared input tokens.sample.paint");
  });
  it("reports malformed origins, unknown persisted rules and unresolved inputs",()=>{
    const input=fixture(); const malformed=structuredClone(input.library); const token=Object.values(flatten(malformed.fills[0]!))[0]!;
    token.$extensions!["com.clossys.origin"]={kind:"adopted"} as never;
    expect(check({...input,library:malformed}).findings.map(f=>f.message)).toContain("provenance: tokens.sample.paint has invalid origin");
    token.$extensions!["com.clossys.origin"]={kind:"derived",rule:"missing@1",inputs:["tokens.sample.absent"],inputsHash:"0".repeat(64)};
    expect(check({...input,library:malformed}).findings.filter(f=>f.code==="C10").map(f=>f.message)).toEqual(expect.arrayContaining(["provenance: tokens.sample.paint uses unknown rule missing@1","provenance: tokens.sample.paint has unresolved inputs for missing@1"]));
    token.$extensions!["com.clossys.origin"]={kind:"derived",rule:"missing@1"} as never;
    expect(check({...input,library:malformed}).findings.map(f=>f.message)).toContain("provenance: tokens.sample.paint has invalid origin");
  });
  it("rejects missing, upward and cyclic dependency edges and forged resolved output",()=>{
    const input=fixture(); const author=(tokens:Record<string,DtcgToken>)=>applyLibraryChange(input.catalog,input.library,{baseHash:libraryHash(input.library),changes:[{op:"author",slot:"tokens.sample",tokens}]});
    const missing=author({paint:{$type:"number",$value:"{tokens.sample.absent}"}});
    expect(check({...input,library:missing}).findings.filter(f=>f.code==="C2").map(f=>f.message)).toContain("reads: tokens.sample.paint in example/tokens.sample reads tokens.sample.absent, which does not resolve in profile example");
    const cycle=author({paint:{$type:"number",$value:"{tokens.sample.other}"},other:{$type:"number",$value:"{tokens.sample.paint}"}});
    expect(check({...input,library:cycle}).findings.filter(f=>f.code==="C2").map(f=>f.message)).toContain("reads: cycle tokens.sample.other -> tokens.sample.paint -> tokens.sample.other");
    const upward=author({paint:{$type:"number",$value:"{assets.mark.default}"}});
    expect(check({...input,library:upward}).findings.filter(f=>f.code==="C2").map(f=>f.message)).toContain("reads: tokens.sample.paint in example/tokens.sample reads upward to assets.mark.default (0.0 may not read 1)");
    const resolved=structuredClone(resolve(input)); resolved.members["tokens.sample.paint"]!.css.light="forged";
    expect(check({...input,resolved}).findings.filter(f=>f.code==="C5").map(f=>f.message)).toContain("uniqueness: resolved member tokens.sample.paint does not match a single implementation");
  });
  it("validates reserved composed shape and includes its declared reverse edges",()=>{
    const input=fixture(); const library=applyLibraryChange(input.catalog,input.library,{baseHash:libraryHash(input.library),changes:[{op:"author",slot:"assets.mark",tokens:{default:{$type:"svg",$value:"<svg/>"}}}]});
    Object.values(flatten(library.fills.find(fill=>metaOf(fill).slot==="assets.mark")!))[0]!.$extensions!["com.clossys.origin"]={kind:"composed",reads:["tokens.sample"]};
    metaOf(library.fills.find(fill=>metaOf(fill).slot==="assets.mark")!).originKinds=["composed"]; library.selection=generateSelection(library);
    expect(check({...input,library}).findings.filter(f=>f.code==="C2" || f.code==="C10")).toEqual([]); expect(consumptionReport({...input,library}).leaves.find(leaf=>leaf.id==="tokens.sample")?.consumedBy).toEqual(["assets.mark"]);
  });
  it("checks SHA-256 against published vectors",()=>{
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"); expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
