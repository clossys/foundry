import { describe, expect, it } from "vitest";
import { applyLibraryChange, emit, libraryHash, loadCatalog, resolve, type LibraryData } from "./index.js";
import { TOKENS } from "../tokens/tokens.js";

describe("public dock content-size emission", () => {
  it("adopts the actual Foundry cell and emits the three shipped semantic CSS properties", () => {
    const catalog = loadCatalog();
    let library: LibraryData = { source: { id: "dock-fixture", kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" }, fills: [], adoptedAt: "2026-10-25" };
    library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "adopt", slot: "tokens.content-size", source: "foundry" }] });
    const profile = resolve({ catalog, library });
    const css = emit(profile, ["css-brand"], { full: true, header: false })[0]!.contents;
    for (const [member, value] of [["min", "160px"], ["default", "240px"], ["max", "480px"]] as const) {
      const property = `--ui-layout-dock-${member}-block` as const;
      expect(profile.members[`tokens.content-size.dock-${member}`]).toMatchObject({ emit: property, css: { light: value } });
      expect(TOKENS[property].value).toBe(value);
      expect(css).toContain(`${property}: ${value};`);
    }
  });
});
