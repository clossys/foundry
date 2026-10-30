import { expect, it } from "vitest";
import { emptyChanges, type Candidate } from "./model.js";
import { matrixRows, matrixBoards, matrixSummary, purePlacementTree } from "./matrix-model.js";
import { createStudioEvaluation } from "./evaluation.js";
import { catalog, smallCatalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";
it("covers every canonical token and asset leaf exactly once in rows and boards", () => {
 const library=emptyLibrary(); const rows=matrixRows({catalog,library,working:library,changes:emptyChanges(library),expanded:new Set()}); const boards=matrixBoards({catalog,library,working:library},rows);
 const expected = catalog.slots.map(slot => slot.id);
 expect(rows.filter(r=>r.scope==="slot")).toHaveLength(expected.length); expect(new Set(rows.filter(row=>row.scope==="slot").map(row=>row.id))).toEqual(new Set(expected)); expect(new Set(boards.flatMap(b=>b.leaves))).toEqual(new Set(expected)); expect(boards.flatMap(b=>b.leaves)).toHaveLength(expected.length);
 expect(purePlacementTree(catalog.placements).some(n=>n.id.startsWith("assets/"))).toBe(true);
});
it("summarizes resolved from consumer fills instead of candidate availability", () => {
 const empty=emptyLibrary(); const a=matrixSummary({catalog,library:empty,working:empty}); expect(a.total).toBe(catalog.slots.length); expect(a.resolved).toBe(0);
 const working=adopt(); const b=matrixSummary({catalog,library:empty,working,layer:"tokens"}); expect(b.total).toBe(catalog.slots.filter(slot=>slot.layer==="tokens").length); expect(b.resolved).toBe(1); expect(b.categories.every(c=>c.supported)).toBe(true);
});
it("accepts new placement layers through the catalog seam without token filters", () => {
 const library=emptyLibrary(); const placements=[...smallCatalog.placements,{layer:"components" as const,nodes:[{id:"incoming",label:"Incoming registry",leaves:[]}]}]; expect(purePlacementTree(placements).map(n=>n.id)).toContain("components/incoming");
});
it("expands member rows only on demand and keeps asset tiers absent", () => {
 const library=emptyLibrary(); const rows=matrixRows({catalog:smallCatalog,library,working:library,changes:emptyChanges(library),expanded:new Set(["assets.icon-search"])}); expect(rows.some(r=>r.scope==="member"&&r.target.startsWith("assets.icon-search."))).toBe(true); expect(rows.find(r=>r.id==="assets.icon-search")?.tier).toBeUndefined();
});

it("keeps selected-only projection separate from demanded candidate caching and scoped indices", () => {
 const library = adopt(); const cache = new Map<string, Candidate[]>();
 const input = { catalog: smallCatalog, library, working: library, changes: emptyChanges(library), expanded: new Set<string>(), cache, evaluation: createStudioEvaluation({ catalog: smallCatalog, working: library }) };
 const partial = matrixRows({ ...input, evaluateRows: new Set() });
 const selected = partial.find(row => row.id === "tokens.surface-color")!;
 expect(selected.candidatesReady).toBe(false); expect(selected.candidates).toHaveLength(1);
 expect(selected.candidates[0]?.selected).toBe(true); expect(selected.candidates[0]?.members.length).toBeGreaterThan(0);
 expect(cache.size).toBe(0);
 expect(partial.filter(row => row.scope !== "slot").every(row => row.candidates.length === 0)).toBe(true);
 const demanded = matrixRows({ ...input, evaluateRows: new Set(["tokens.surface-color"]) });
 expect(demanded.find(row => row.id === selected.id)?.candidates.length).toBeGreaterThan(1);
 expect(demanded.find(row => row.id === selected.id)?.candidatesReady).toBe(true);
 for (const rows of [partial, demanded, matrixRows({ ...input, evaluateRows: new Set() })]) {
   const indices = rows.flatMap(row => row.candidates.map(candidate => candidate.index));
   expect(new Set(indices).size).toBe(indices.length);
   expect(rows.find(row => row.id === selected.id)?.candidates[0]?.members).toEqual(selected.candidates[0]?.members);
 }
});
