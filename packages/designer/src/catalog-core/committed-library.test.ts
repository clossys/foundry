/**
 * The committed library and the portion memo (PERF-STUDIO). `committedCompositeLibrary` yields what an empty change
 * set applies (deep-equal, same hash, the same error), without applying one. The value and component portions resolve
 * once per library digest and everything else they read: an unchanged input reuses its resolution, a changed library
 * (another object, or the same object changed in place) or a replaced catalog field never does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ components: 0 }));
vi.mock("./resolve-components.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./resolve-components.js")>();
  // Only a portion resolution resolves the component portion, so each call is one portion computation.
  return { ...actual, resolveComponents: (...args: Parameters<typeof actual.resolveComponents>) => { calls.components++; return actual.resolveComponents(...args); } };
});

import { applyLibraryChange, libraryHash, resolve } from "./index.js";
import { committedCompositeLibrary } from "./library-components.js";
import { adoptedSurface } from "./__fixtures__/surface-engine/synthetic.js";
import { adoptedComponentIntegration, componentIntegration } from "./__fixtures__/component-integration.js";
import type { CompositeEngineInput, CompositeLibraryData } from "./types.js";

const optionsOf = (input: CompositeEngineInput) => input.surfaceOptions ? { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions } : undefined;
/** The old mount path: an empty change set applied to the committed library. */
const applied = (input: CompositeEngineInput, options: ReturnType<typeof optionsOf>): CompositeLibraryData =>
  applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [] }, options);
const outcome = (run: () => CompositeLibraryData): { library: CompositeLibraryData } | { error: string } => {
  try { return { library: run() }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
};
/** A fresh library object with the same content never meets a memo entry, so it resolves from scratch. */
const fresh = (input: CompositeEngineInput) => resolve({ ...input, library: structuredClone(input.library) });

beforeEach(() => { calls.components = 0; });

describe("committed composite library", () => {
  const inputs: [string, () => CompositeEngineInput][] = [
    ["components only", () => componentIntegration()],
    ["an adopted component", () => adoptedComponentIntegration()],
    ["an adopted surface", () => adoptedSurface().input],
  ];
  it.each(inputs)("with %s equals the empty change set's result, with the same hash", (_name, make) => {
    const input = make(), before = structuredClone(input.library);
    const old = applied(input, optionsOf(input));
    for (const library of [
      committedCompositeLibrary(input.catalog, input.library, optionsOf(input)),
      committedCompositeLibrary(input.catalog, input.library, optionsOf(input), result => resolve({ ...input, library: result })),
    ]) {
      expect(library).toEqual(old);
      expect(libraryHash(library)).toBe(libraryHash(old));
      expect(library.values).not.toHaveProperty("source");
      expect(library.components).not.toHaveProperty("adoptedAt");
    }
    // Neither path changes the committed library it was given.
    expect(input.library).toEqual(before);
  });

  it("resolves a surface library once, through the caller's resolution", () => {
    const input = adoptedSurface().input;
    let seen: CompositeLibraryData | undefined;
    calls.components = 0;
    const library = committedCompositeLibrary(input.catalog, input.library, optionsOf(input), result => { seen = result; return resolve({ ...input, library: result }); });
    expect(seen).toBe(library);
    expect(calls.components).toBe(1);
  });

  it("throws exactly what the empty change set throws", () => {
    const missing = adoptedSurface().input;
    const tampered = adoptedSurface().input;
    tampered.catalog.surfaces!.materializations = [];
    const nonConsumer = componentIntegration();
    const cases: [CompositeEngineInput, ReturnType<typeof optionsOf>][] = [[missing, undefined], [tampered, optionsOf(tampered)], [nonConsumer, undefined]];
    for (const [input, options] of cases) {
      const old = outcome(() => applied(input, options));
      expect(outcome(() => committedCompositeLibrary(input.catalog, input.library, options))).toEqual(old);
      // A failing caller resolution falls back to the apply's own check, never to the caller's error.
      expect(outcome(() => committedCompositeLibrary(input.catalog, input.library, options, () => { throw new Error("caller resolution"); }))).toEqual(old);
    }
    expect(outcome(() => applied(missing, undefined))).toEqual({ error: expect.stringContaining("S8") });
    expect(outcome(() => applied(tampered, optionsOf(tampered)))).toHaveProperty("error");
  });
});

describe("portion memo", () => {
  it("resolves an unchanged input's portions once", () => {
    const input = componentIntegration();
    calls.components = 0;
    const first = resolve(input), second = resolve(input), third = resolve({ ...input });
    expect(calls.components).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Each resolution is its own profile: a caller annotating one never reaches another.
    expect(second).not.toBe(first);
  });

  it("resolves a changed library afresh, never from the earlier library's entry", () => {
    const input = componentIntegration();
    resolve(input);
    const changed = { ...input, library: adoptedComponentIntegration().library };
    calls.components = 0;
    const profile = resolve(changed);
    expect(calls.components).toBe(1);
    expect(profile.selectionHash).toBe(libraryHash(changed.library));
    expect(profile.selectionHash).not.toBe(libraryHash(input.library));
    expect(profile).toEqual(fresh(changed));
  });

  it("resolves a library changed in place afresh", () => {
    const input = componentIntegration(), adopted = adoptedComponentIntegration();
    const before = resolve(input);
    input.library.components = adopted.library.components;
    calls.components = 0;
    const after = resolve(input);
    expect(calls.components).toBe(1);
    expect(after.selectionHash).not.toBe(before.selectionHash);
    expect(after.components).toEqual(resolve(adopted).components);
    expect(after).toEqual(fresh(input));
  });

  it("resolves afresh when a catalog field or option is replaced in place", () => {
    const input = componentIntegration();
    resolve(input);
    input.catalog.components.fills = [...input.catalog.components.fills];
    calls.components = 0;
    resolve(input);
    expect(calls.components).toBe(1);
    input.catalog.values = { ...input.catalog.values };
    resolve(input);
    expect(calls.components).toBe(2);
    input.fileExists = () => true;
    const probed = resolve(input);
    expect(calls.components).toBe(3);
    expect(probed).toEqual(fresh(input));
  });
});
