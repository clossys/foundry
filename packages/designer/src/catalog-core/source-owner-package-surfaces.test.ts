// @vitest-environment node
/** Record association recognises package-pointer Sections and Frames, in the library and among catalog offers. */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareSourceOwnerClosure } from "../catalog-bundles.js";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";

let fixture: PackageSurfaceLibrary;
let library: PackageSurfaceLibrary["library"];
beforeAll(async () => {
  fixture = await packageSurfaceLibrary();
  // Surfaces only: closing a completed values library holds one full document copy per token member, which this test does not exercise.
  library = { ...fixture.library, values: { fills: [], complete: fixture.library.values.complete } };
}, 120_000);

describe("source-owner records for package-pointer surfaces", { timeout: 120_000 }, () => {
  it("offers every catalog package candidate without a schema refusal", () => {
    const result = prepareSourceOwnerClosure({ catalog: fixture.catalog, library: { ...library, surfaces: undefined }, surfaceOptions: fixture.options });
    const needs = result.status === "pending" ? result.needs : [];
    expect(needs.filter(row => /closed object schema/.test(row.message))).toEqual([]);
    const offers = result.records.filter(row => row.kind === "offer" && row.portion === "surfaces" && (row.descriptor as { impl?: { kind?: string } } | undefined)?.impl?.kind === "package");
    expect(offers.length).toBeGreaterThan(40);
  });

  it("associates each adopted pointer with its catalog candidate and installed export evidence, owning no bytes", () => {
    const result = prepareSourceOwnerClosure({ catalog: fixture.catalog, library, surfaceOptions: fixture.options });
    const needs = result.status === "pending" ? result.needs : [];
    expect(needs.filter(row => row.slot?.startsWith("sections.") || row.slot?.startsWith("frames.") || /surfaces:|closed object schema|inventory/.test(row.message))).toEqual([]);
    const owned = result.records.filter(row => row.kind === "surface");
    expect(owned).toHaveLength(library.surfaces!.fills.length);
    for (const row of owned) {
      expect(row.files, row.slot).toEqual([]);
      expect(row.packages, row.slot).toHaveLength(1);
      const impl = (row.descriptor as { impl: { module: string; export: string } }).impl;
      expect(row.packages[0], row.slot).toMatchObject({ module: impl.module });
      expect(row.packages[0]!.values, row.slot).toContain(impl.export);
      expect(row.candidate?.$extensions["com.clossys.fill"].id, row.slot).toBe(row.upstream?.fill);
      expect(row.source, row.slot).toBe(row.candidate?.$extensions["com.clossys.fill"].source);
    }
    // Without the installed export evidence, a pointer is not associated.
    const bare = prepareSourceOwnerClosure({ catalog: fixture.catalog, library, surfaceOptions: { packages: [], measurements: [] } });
    expect(bare.status === "pending" && bare.needs.some(row => row.slot?.startsWith("sections.") && row.code === "SOURCE_RECORD_MISSING")).toBe(true);
  });
});
