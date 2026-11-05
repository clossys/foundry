import { expect, it } from "vitest";
import { applyLibraryChange, libraryHash, resolve, emit, generateSelection } from "../catalog-core/index.js";
import { buildCandidates, changesFor, emptyChanges, addChanges, workingLibrary, scopeTargets, sourcesAt, buildSlotTree, allNodes, describePreview } from "./model.js";
import { catalog, smallCatalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";

it("never resolves or emits a catalog candidate without a consumer operation", () => {
 const library=emptyLibrary(); const cards=buildCandidates({catalog,library,working:library,slotId:"themes.background",scope:"slot",target:"themes.background"});
 expect(cards[0]?.source).toBe("example"); expect(cards[0]?.members).toEqual([]); expect(cards.find(c=>c.source==="shadcn@aria")?.members.length).toBeGreaterThan(0);
 expect(resolve({catalog,library}).members).toEqual({}); expect(emit(resolve({catalog,library}),["css-brand"],{header:false})[0]?.contents).toBe("");
});
it("forms member, leaf and placement adoption operations, never stored tree scopes", () => {
 const library=emptyLibrary(); expect(changesFor({catalog,library,scope:"member",target:"themes.background.default",source:"shadcn@aria"})).toEqual([{op:"adopt",slot:"themes.background",source:"shadcn@aria",members:["themes.background.default"]}]);
 const node=allNodes(smallCatalog.placements).find(n=>n.leaves.includes("themes.background"))!;
 const changes=changesFor({catalog:smallCatalog,library,scope:"node",target:node.id,source:"shadcn@aria"}); expect(changes.length).toBeGreaterThan(0); expect(changes.every(c=>c.op==="adopt"&&c.slot.includes("."))).toBe(true);
 expect(changesFor({catalog,library,scope:"slot",target:"themes.background"})).toEqual([{op:"remove",slot:"themes.background"}]);
});
it("applies pending operations against libraryHash and regenerates v2 provenance", () => {
 const base=emptyLibrary(); const list=changesFor({catalog,library:base,scope:"slot",target:"themes.background",source:"shadcn@aria"}); const changes=addChanges({base,changes:emptyChanges(base),list});
 expect(changes.baseHash).toBe(libraryHash(base)); const library=workingLibrary({catalog,base,changes}); expect(library.selection).toEqual(generateSelection(library)); expect(library.selection?.version).toBe(2); expect(library.selection).not.toHaveProperty("picks"); expect(library.selection).not.toHaveProperty("defaultChain"); expect(base.fills).toEqual([]);
 expect(sourcesAt(library,"slot","themes.background")).toEqual(["shadcn@aria"]);
 const isolated=resolve({catalog:{...catalog,fills:[]},library}); expect(isolated).toEqual(resolve({catalog,library})); expect(emit(isolated,["css-brand"])).toEqual(emit(resolve({catalog,library}),["css-brand"]));
});
it("supports mixed member origins, reset and last operation replacement", () => {
 // Every themes leaf ships one source with one member, so the open two-source ratio leaf carries the mixed-origin case.
 const base=adopt(emptyLibrary(),"assets.image-ratio","foundry"); let changes=emptyChanges(base);
 changes=addChanges({base,changes,list:[{op:"adopt",slot:"assets.image-ratio",source:"open-props",members:["assets.image-ratio.landscape"]}]});
 const working=workingLibrary({catalog,base,changes}); expect(sourcesAt(working,"member","assets.image-ratio.landscape")).toEqual(["open-props"]); expect(sourcesAt(working,"slot","assets.image-ratio")).toEqual(["foundry","open-props"]);
 changes=addChanges({base,changes,list:[{op:"remove",slot:"assets.image-ratio"}]}); expect(workingLibrary({catalog,base,changes}).fills.some(f=>f.$extensions["com.clossys.fill"].slot==="assets.image-ratio")).toBe(false);
});
it("does not expose reference candidates as usable or turn their content into consumer fills", () => {
 const library=emptyLibrary(); const fill=catalog.fills.find(f=>f.$extensions["com.clossys.fill"].slot==="themes.background")!;
 const reference={...fill,$extensions:{"com.clossys.fill":{...fill.$extensions["com.clossys.fill"],mode:"reference" as const}}}; const c={...catalog,fills:[reference]};
 const candidate=buildCandidates({catalog:c,library,working:library,slotId:"themes.background",scope:"slot",target:"themes.background"})[1]!; expect(candidate.usable).toBe(false); expect(candidate.reason).toBe("reference"); expect(candidate.members).toEqual([]);
});
it("enumerates theme and asset members and preserves placement order", () => {
 const library=emptyLibrary(); expect(scopeTargets({catalog,library,slotId:"themes.shadow",scope:"member"})).toHaveLength(7); expect(scopeTargets({catalog,library,slotId:"assets.image-ratio",scope:"member"}).length).toBeGreaterThan(5); expect(scopeTargets({catalog,library,slotId:"assets.icon-search",scope:"member"}).length).toBeGreaterThan(0);
 expect(buildSlotTree(catalog.placements).map(n=>n.id)).toEqual(["themes","assets"]);
});
it("keeps the consumer as the only active column after adoption", () => {
 const library=adopt(); const cards=buildCandidates({catalog,library,working:library,slotId:"themes.background",scope:"slot",target:"themes.background"}); expect(cards.filter(c=>c.selected).map(c=>c.source)).toEqual(["example"]); expect(cards.every(c=>!c.inUseByDefault)).toBe(true);
});

it("routes registered identity recipes at explicit leaf and node scope to derive", () => {
 const library=emptyLibrary();
 expect(changesFor({catalog,library,scope:"slot",target:"assets.mark",source:"foundry"})).toEqual([{op:"derive",slot:"assets.mark",rule:"identity-mark@1",inputs:["assets.mark.positive","themes.foreground.default"]}]);
 expect(changesFor({catalog,library,scope:"node",target:"assets/logo-artwork",source:"foundry"})).toEqual([
  {op:"derive",slot:"assets.lockup",rule:"identity-lockup@1",inputs:["assets.lockup.positive","themes.foreground.default"]},
  {op:"derive",slot:"assets.mark",rule:"identity-mark@1",inputs:["assets.mark.positive","themes.foreground.default"]},
 ]);
});
it("refuses member recipes visibly without widening to the other rule outputs", () => {
 const library=emptyLibrary();
 expect(()=>changesFor({catalog,library,scope:"member",target:"assets.mark.reversed",source:"foundry"})).toThrow(/whole leaf|whole-leaf/);
 const cards=buildCandidates({catalog,library,working:library,slotId:"assets.mark",scope:"member",target:"assets.mark.reversed"});
 const recipe=cards.find(c=>c.source==="foundry")!;
 expect(recipe.usable).toBe(false);expect(recipe.members).toEqual([]);
 expect(recipe.findings.some(f=>f.code==="C7"&&/whole leaf|whole-leaf/.test(f.message))).toBe(true);
 expect(library.fills).toEqual([]);
});
it("refuses missing, ambiguous, wrong-leaf and mismatched registered recipe inputs before evaluation", () => {
 for(const fault of ["missing","ambiguous","wrong-leaf","inputs","missing-inputs"] as const){
  const changed=structuredClone(catalog);const rule=changed.rules!.find(r=>r.id==="identity-mark@1")!;
  if(fault==="missing") changed.rules=changed.rules!.filter(r=>r!==rule);
  if(fault==="ambiguous") changed.rules=[...changed.rules!,structuredClone(rule)];
  if(fault==="wrong-leaf") rule.slot="assets.lockup";
  if(fault==="inputs") rule.inputs=["assets.mark.positive"];
  if(fault==="missing-inputs") delete rule.inputs;
  const library=emptyLibrary();
  expect(()=>changesFor({catalog:changed,library,scope:"slot",target:"assets.mark",source:"foundry"}),fault).toThrow(/recipe|rule|inputs/);
  const recipe=buildCandidates({catalog:changed,library,working:library,slotId:"assets.mark",scope:"slot",target:"assets.mark"}).find(c=>c.source==="foundry")!;
  expect(recipe.usable,fault).toBe(false);expect(recipe.findings.some(f=>f.code==="C7"),fault).toBe(true);
 }
});
it("keeps a missing consumer artwork input as a real C7 refusal without creating a seed", () => {
 const library=emptyLibrary();
 const recipe=buildCandidates({catalog,library,working:library,slotId:"assets.mark",scope:"slot",target:"assets.mark"}).find(c=>c.source==="foundry")!;
 expect(recipe.usable).toBe(false);expect(recipe.members).toEqual([]);
 expect(recipe.findings.some(f=>f.code==="C7"&&f.message.includes("missing consumer input assets.mark.positive"))).toBe(true);
 expect(library.fills).toEqual([]);
});
