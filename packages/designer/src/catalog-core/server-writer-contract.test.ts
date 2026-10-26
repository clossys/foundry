// @vitest-environment node
import { describe, expect, expectTypeOf, it } from "vitest";
import * as server from "./server.js";
import * as disk from "../library-cli/fs-library.js";
import type { CompositeCatalogData, CompositeChangeSet, CompositeLibraryData } from "./server.js";

describe("public composite writer contract", () => {
  it("exports the existing atomic writer and validator unchanged through the server entry", () => {
    expect(server.writeCompositeLibrary).toBe(disk.writeCompositeLibrary);
    expect(server.isCompositeChangeSet).toBe(disk.isCompositeChangeSet);
    expectTypeOf(server.writeCompositeLibrary).parameter(1).toEqualTypeOf<CompositeCatalogData>();
    expectTypeOf(server.writeCompositeLibrary).parameter(2).toEqualTypeOf<CompositeChangeSet>();
    expectTypeOf(server.writeCompositeLibrary).returns.toEqualTypeOf<Promise<CompositeLibraryData>>();
  });

  it("retains fail-closed changeset validation at the public entry", () => {
    const catalog: CompositeCatalogData = { values: server.loadCatalog(), components: { slots: [], fills: [] } };
    expect(server.isCompositeChangeSet({ baseHash: `sha256:${"0".repeat(64)}`, changes: [] }, catalog)).toBe(true);
    expect(server.isCompositeChangeSet({ baseHash: "stale", changes: [] }, catalog)).toBe(false);
    expect(server.isCompositeChangeSet({ baseHash: `sha256:${"0".repeat(64)}`, changes: [], restore: true }, catalog)).toBe(false);
    expect(server.isCompositeChangeSet({ baseHash: `sha256:${"0".repeat(64)}`, changes: [{ portion: "components", change: { op: "remove", slot: "components.unknown" } }] }, catalog)).toBe(false);
  });
});
