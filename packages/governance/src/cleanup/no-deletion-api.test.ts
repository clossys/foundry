import { describe, expect, it } from "vitest";
import * as cleanup from "./index.js";

/**
 * Guards the issue #215 acceptance criterion called out explicitly for a
 * reviewer to check: "no deletion API is exported." Two independent
 * guards, deliberately redundant:
 *
 *  1. An EXACT allowlist of this subpath's runtime export names. Adding
 *     *any* new runtime export — deletion-shaped or not — fails this test
 *     until the allowlist is deliberately updated, so a reviewer cannot
 *     land a new export by accident, silently, in an unrelated diff.
 *  2. A name-shape guard that fails specifically on anything that reads as
 *     deletion, removal, mutation, or applying a proposal — independent of
 *     the allowlist, so it still catches the dangerous case even if a
 *     future edit updates the allowlist without reading this file's intent.
 *
 * Type-only exports are not included here: `import * as cleanup` at
 * runtime only ever observes the VALUE bindings a module actually emits —
 * `export type { ... }` is erased entirely by both `tsc` and the `esbuild`
 * transform Vitest uses to run this file directly from source (no build
 * step), so there is nothing here to accidentally under- or over-count by
 * checking `Object.keys` this way. See `../root-entry-boundary.test.ts`'s
 * own doc comment for the same reasoning applied to import-graph tracing.
 */
describe("./cleanup exports no deletion API", () => {
  it("exports exactly the documented, pure runtime surface — nothing more", () => {
    expect(Object.keys(cleanup).sort()).toEqual(["CLEANUP_CLASSIFICATION_VERSION", "classifyCleanupCandidate"]);
  });

  it("exports nothing whose name reads as deletion, removal, mutation, or guarded application", () => {
    const dangerous = /delete|remove|prune|purge|destroy|rimraf|unlink|apply|execute|mutate|write|rm(?![a-z])/i;
    const offending = Object.keys(cleanup).filter((name) => dangerous.test(name));
    expect(offending).toEqual([]);
  });

  it("the one function export is exactly the pure classifier, and it is a function", () => {
    expect(typeof cleanup.classifyCleanupCandidate).toBe("function");
  });

  it("the one constant export is a frozen-shape schema version, not a mutable registry or handle", () => {
    expect(cleanup.CLEANUP_CLASSIFICATION_VERSION).toBe(1);
  });
});
