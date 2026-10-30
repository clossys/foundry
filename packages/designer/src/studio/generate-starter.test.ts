// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog-core/index.js";
import { applyLibraryChange } from "../catalog-core/library.js";
import { libraryHash } from "../catalog-core/resolve.js";
import type { LibraryData } from "../catalog-core/types.js";
import { withAssetCatalog } from "../catalog-assets/catalog.js";
import { identityStarterChange } from "../catalog-assets/identity.js";
import { IDENTITY_STARTER_SLOTS } from "../tokens/identity-kit.js";
import { rosterStarter, sourceRoster } from "../catalog-core/token-contract.js";

const catalog = withAssetCatalog(loadCatalog());
const library = (): LibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "MIT", extends: "foundry" }, fills: [], adoptedAt: "2026-10-26" });

describe("Generate starter (brand rows)", () => {
  it("covers every brand slot the roster gives the identity-kit starter", () => {
    const brand = ["logo-artwork", "app-identity-browser", "app-identity-application"].flatMap(l2 => sourceRoster.assets.find(row => row.l2 === l2)!.leaves);
    expect(Object.keys(IDENTITY_STARTER_SLOTS).sort()).toEqual([...brand].sort());
    for (const slot of brand) expect(rosterStarter(sourceRoster, slot)).toBe("identity-kit");
  });

  for (const [slot, names] of Object.entries(IDENTITY_STARTER_SLOTS)) it(`writes an authored Custom fill for ${slot}, never an adopted one`, () => {
    const change = identityStarterChange(catalog, library(), slot);
    expect(change.op).toBe("author");
    expect(Object.keys(change.tokens).sort()).toEqual([...names].sort());
    for (const token of Object.values(change.tokens)) {
      expect(token.$extensions?.["com.clossys.origin"]).toMatchObject({ kind: "authored", license: "MIT" });
      expect(String(token.$value)).toMatch(/^<svg\b/);
    }
    const next = applyLibraryChange(catalog, library(), { baseHash: libraryHash(library()), changes: [change] });
    const fill = next.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!;
    expect(fill.$extensions["com.clossys.fill"].source).toBe("example");
    expect(JSON.stringify(fill)).not.toContain("\"adopted\"");
    expect(JSON.stringify(fill)).toContain("\"authored\"");
  });

  it("names the starter after the brand an existing brand member carries", () => {
    const seeded = applyLibraryChange(catalog, library(), { baseHash: libraryHash(library()), changes: [identityStarterChange(catalog, library(), "assets.mark")] });
    const renamed = { ...seeded, fills: seeded.fills.map(doc => JSON.parse(JSON.stringify(doc).replaceAll("aria-label=\\\"example\\\"", "aria-label=\\\"Northwind\\\""))) };
    expect(String(identityStarterChange(catalog, renamed, "assets.lockup").tokens.positive!.$value)).toContain("aria-label=\"Northwind\"");
  });

  it("refuses a slot the identity kit does not start", () => {
    expect(() => identityStarterChange(catalog, library(), "assets.pattern")).toThrow(/no identity starter/);
  });
});
