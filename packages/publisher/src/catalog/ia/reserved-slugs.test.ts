import { describe, expect, it } from "vitest";
import { FIXED_PUBLICATIONS, PUBLISHER_TREES, reservedSlugs, slotContract, type L0Tree, type PageSlot } from "./tree.js";

// foundry-build-0048 (A1): the admin workspace is a publication every consumer holds, so its routes are reserved for
// every other publication's <slug> page (page.site-page), derived from the directory contracts.
describe("reserved slugs", () => {
  it("reserves the first segment of each fixed publication's page routes for every other publication", () => {
    expect(FIXED_PUBLICATIONS).toEqual(["admin"]);
    expect((slotContract("page.site-page") as PageSlot).path).toBe("/<slug>");
    expect(reservedSlugs("site")).toEqual(["admin"]);
    expect(reservedSlugs()).toEqual(["admin"]);
    expect(reservedSlugs("admin")).toEqual([]);
  });

  it("mutation: an admin page moved to another route reserves that route instead (derived, not listed)", () => {
    const moved = PUBLISHER_TREES.map(tree => tree.l0 !== "directory" ? tree : {
      ...tree, slots: Object.fromEntries(Object.entries(tree.slots).map(([id, contract]) => [id, contract.kind === "page" && contract.publication === "admin" ? { ...contract, path: (contract.path ?? "").replace(/^\/admin/, "/console") } : contract])),
    }) as readonly L0Tree[];
    expect(reservedSlugs("site", moved)).toEqual(["console"]);
  });
});
