import { expect, it } from "vitest";
import { canvasDomains, boardMatches, boardSources } from "./canvas-model.js";
import { matrixRows, matrixBoards } from "./matrix-model.js";
import { emptyChanges } from "./model.js";
import { catalog, smallCatalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";
it("constructs asset domains and measures pending/source/differs from library operations", () => {
 const library=emptyLibrary(), working=adopt(); const changes={baseHash:"test",changes:[{op:"adopt" as const,slot:"tokens.surface-color",source:"foundry"}]}; const rows=matrixRows({catalog:smallCatalog,library,working,changes,expanded:new Set()}); const boards=matrixBoards({catalog:smallCatalog,library,working},rows);
 const board=boards.find(b=>b.leaves.includes("tokens.surface-color"))!; expect(boardSources(board,working)).toEqual(["foundry"]);
 const input={board,domain:"Color",query:"surface",filter:"pending" as const,working,changes,groupChoices:{},warnings:0}; expect(boardMatches(input)).toBe(true); expect(boardMatches({...input,changes:emptyChanges(working)})).toBe(false);
 expect(canvasDomains(catalog,boards).some(d=>d.id.startsWith("assets/"))).toBe(true);
});
