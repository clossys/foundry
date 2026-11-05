/**
 * A composite changeset resolves its value and component portions once, not
 * once per surface operation, and lands exactly the library the per-operation
 * path lands.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ resolve: 0 }));
vi.mock("./resolve.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./resolve.js")>();
  return { ...actual, resolve: (...args: Parameters<typeof actual.resolve>) => { calls.resolve++; return actual.resolve(...args); } };
});

import { applyCompositeLibraryChange, compositeLibraryHash, resolveComposite } from "./library-components.js";
import { resolveSurfaces } from "./surface-check.js";
import { applySurfaceOperation } from "./surface-library.js";
import { stableStringify } from "./stable.js";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import type { CompositeCatalogData, CompositeChangeSet, CompositeLibraryData } from "./types.js";
import type { SurfaceOperation, SurfaceResolutionOptions } from "./surface-types.js";

let fixture: PackageSurfaceLibrary;
let empty: CompositeLibraryData;
let operations: CompositeChangeSet["changes"];
beforeAll(async () => {
  fixture = await packageSurfaceLibrary();
  empty = { ...structuredClone(fixture.library), surfaces: { version: 1, fills: [], files: [] } };
  operations = fixture.decisions.map(row => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: row.slot as `sections.${string}`, source: row.source } }));
}, 300_000);

const apply = (library: CompositeLibraryData, changes: CompositeChangeSet["changes"]) =>
  applyCompositeLibraryChange(fixture.catalog, library, { baseHash: compositeLibraryHash(library), changes }, { surfaceOptions: fixture.options });
const counted = <T>(run: () => T): { result: T; resolves: number } => { calls.resolve = 0; const result = run(); return { result, resolves: calls.resolve }; };

/** The per-operation path as it stood: a fresh whole-library resolve before every surface operation, then a final one. */
function perOperation(catalog: CompositeCatalogData, library: CompositeLibraryData, changes: readonly SurfaceOperation[], options: SurfaceResolutionOptions): CompositeLibraryData {
  let staged = structuredClone(library);
  for (const change of changes) {
    const { surfaces: _deferred, ...withoutSurfaces } = staged;
    const pending = { catalog, library: staged, componentOptions: undefined, surfaceOptions: options };
    const profile = resolveComposite({ ...pending, library: withoutSurfaces });
    profile.surfaces = resolveSurfaces(pending, profile, false);
    staged = applySurfaceOperation(catalog, staged, change, [], profile, options);
  }
  resolveComposite({ catalog, library: staged, surfaceOptions: options });
  return staged;
}

describe("composite changeset batching", { timeout: 300_000 }, () => {
  it("resolves values once per changeset however many surface operations it carries", () => {
    expect(operations.length).toBeGreaterThan(20);
    const one = counted(() => apply(empty, operations.slice(0, 1)));
    const all = counted(() => apply(empty, operations));
    expect(one.resolves).toBeGreaterThan(0);
    expect(all.resolves).toBe(one.resolves);
    // The batched changeset lands the fixture's own adopted surfaces, byte for byte.
    expect(stableStringify(all.result.surfaces)).toBe(stableStringify(fixture.library.surfaces));
  });

  it("lands exactly what the per-operation path lands, with fewer resolves", () => {
    const changes = operations.slice(0, 12);
    const batched = counted(() => apply(empty, changes));
    const reference = counted(() => perOperation(fixture.catalog, empty, changes.map(row => row.change as SurfaceOperation), fixture.options));
    // The facade returns its portions without source and adoption date, exactly as before; surfaces are compared whole.
    expect(stableStringify(batched.result.surfaces)).toBe(stableStringify(reference.result.surfaces));
    expect(stableStringify(batched.result.values)).toBe(stableStringify(empty.values));
    expect(stableStringify(batched.result.components)).toBe(stableStringify(empty.components));
    expect(compositeLibraryHash(batched.result)).toBe(compositeLibraryHash(reference.result));
    expect(reference.resolves).toBeGreaterThan(batched.resolves * changes.length);
  });

  it("re-resolves after a values operation replaces the values portion", () => {
    // Removing an absent value slot leaves the content as it was but replaces the values portion object.
    const changes: CompositeChangeSet["changes"] = [operations[0]!, { portion: "values", change: { op: "remove", slot: "themes.batch-absent" } }, operations[1]!];
    const mixed = counted(() => apply(empty, changes));
    const surfacesOnly = counted(() => apply(empty, operations.slice(0, 2)));
    expect(mixed.resolves).toBeGreaterThan(surfacesOnly.resolves);
    expect(stableStringify(mixed.result.surfaces)).toBe(stableStringify(surfacesOnly.result.surfaces));
  });
});
