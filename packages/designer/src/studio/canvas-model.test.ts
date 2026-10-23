import { expect, it } from "vitest";
import { loadCatalog } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { emptyChanges } from "./model.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { boardMatches, canvasDomains } from "./canvas-model.js";

const input = { catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, changes: emptyChanges(DEMO_SELECTION), expanded: new Set<string>() };
it("lays out all19 shipped L2 boards in seven signed domain rows without copying catalog data", () => {
 const catalog = loadCatalog(); const boards = matrixBoards({ ...input, catalog }, matrixRows({ ...input, catalog }));
 const domains = canvasDomains(catalog, boards); expect(domains).toHaveLength(7); expect(domains.flatMap(domain => domain.boards)).toHaveLength(19);
 expect(new Set(domains.flatMap(domain => domain.boards.map(board => board.id))).size).toBe(19);
});
it("dims by the five truthful filter predicates without deleting boards or manufacturing warnings", () => {
 const boards = matrixBoards(input, matrixRows(input)); const board = boards.find(board => board.id === "tokens/role-color")!;
 const base = { board, domain: "Role", query: "", filter: "all" as const, working: DEMO_SELECTION, changes: input.changes, groupChoices: {}, warnings: 0 };
 expect(boardMatches(base)).toBe(true); expect(boardMatches({ ...base, query: "spacing" })).toBe(false);
 expect(boardMatches({ ...base, query: "ACCENT" })).toBe(true); expect(boardMatches({ ...base, filter: "undecided" })).toBe(true);
 expect(boardMatches({ ...base, filter: "pending" })).toBe(false); expect(boardMatches({ ...base, filter: "warnings" })).toBe(false); expect(boardMatches({ ...base, filter: "differs" })).toBe(false);
 const pick = { scope: "slot" as const, target: "tokens.accent-color", source: "example" };
 expect(boardMatches({ ...base, filter: "pending", changes: { ...input.changes, changes: [{ op: "set", pick }] } })).toBe(true);
 expect(boardMatches({ ...base, filter: "differs", working: { ...DEMO_SELECTION, picks: [pick] }, groupChoices: { [board.id]: "foundry" } })).toBe(true);
});
