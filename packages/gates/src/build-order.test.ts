import { describe, expect, it } from "vitest";
import { evaluateCatalog } from "@vespeneventures/catalog";
import type { Catalog, CatalogEntry } from "@vespeneventures/catalog";
import { computeBuildOrder } from "./build-order.js";

// computeBuildOrder is pure — no I/O — so these fixtures are plain in-memory
// Catalog objects, never a real packages/ directory on disk. Only `name` and
// `dependencies` matter to the function under test; other fields are filled
// in with harmless placeholders. All fixture names use the synthetic
// "@gates-fixture" scope, never a real package name.

interface FixtureSpec {
  name: string;
  internalDependencies?: string[];
}

function makeCatalog(specs: FixtureSpec[]): Catalog {
  const entries: CatalogEntry[] = specs.map((spec) => {
    const internalDependencies = spec.internalDependencies ?? [];
    const dependencies = Object.fromEntries(internalDependencies.map((dep) => [dep, "^1.0.0"]));
    const packageJson: Record<string, unknown> = { name: spec.name, version: "1.0.0", dependencies };
    return {
      name: spec.name,
      version: "1.0.0",
      dir: `packages/${spec.name.split("/")[1]}`,
      private: false,
      packageJson,
    };
  });
  return { root: "/gates-fixture-root", entries, skipped: [] };
}

function orderOf(result: ReturnType<typeof computeBuildOrder>): string[] {
  if (!result.ok) throw new Error("expected ok:true, got a cycle result");
  return result.order;
}

describe("computeBuildOrder — straight chain", () => {
  it("builds a straight chain a -> b -> c in dependency-first order", () => {
    // a depends on b, b depends on c, c depends on nothing.
    const catalog = makeCatalog([
      { name: "@gates-fixture/a", internalDependencies: ["@gates-fixture/b"] },
      { name: "@gates-fixture/b", internalDependencies: ["@gates-fixture/c"] },
      { name: "@gates-fixture/c" },
    ]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(true);
    expect(orderOf(result)).toEqual(["@gates-fixture/c", "@gates-fixture/b", "@gates-fixture/a"]);
  });
});

describe("computeBuildOrder — diamond", () => {
  it("builds both branches after their shared dependency, without pinning their relative order", () => {
    // a depends on c, b depends on c; a and b have no relationship to each other.
    const catalog = makeCatalog([
      { name: "@gates-fixture/a", internalDependencies: ["@gates-fixture/c"] },
      { name: "@gates-fixture/b", internalDependencies: ["@gates-fixture/c"] },
      { name: "@gates-fixture/c" },
    ]);

    const result = computeBuildOrder(catalog);
    const order = orderOf(result);

    expect(result.ok).toBe(true);
    // BOTH branches must come after c — that is the only thing a diamond
    // guarantees. Deliberately not asserting exact array equality for the
    // a/b pair: which of the two independent branches is emitted first is
    // not a contract this function makes, even though the current
    // alphabetical tie-break happens to be deterministic.
    const indexOf = (name: string) => order.indexOf(name);
    expect(indexOf("@gates-fixture/c")).toBeLessThan(indexOf("@gates-fixture/a"));
    expect(indexOf("@gates-fixture/c")).toBeLessThan(indexOf("@gates-fixture/b"));
    expect(order).toContain("@gates-fixture/a");
    expect(order).toContain("@gates-fixture/b");
  });
});

describe("computeBuildOrder — independent siblings", () => {
  it("tie-breaks packages with no dependency relationship alphabetically by name", () => {
    // beta and alpha have no edges between them at all — nothing depends on
    // the other. Only a strict alphabetical tie-break makes this precisely
    // testable rather than "some order".
    const catalog = makeCatalog([
      { name: "@gates-fixture/beta" },
      { name: "@gates-fixture/alpha" },
      { name: "@gates-fixture/gamma" },
    ]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(true);
    expect(orderOf(result)).toEqual(["@gates-fixture/alpha", "@gates-fixture/beta", "@gates-fixture/gamma"]);
  });
});

describe("computeBuildOrder — genuine cycle", () => {
  it("returns ok:false carrying evaluateCatalog's own dependency-cycle finding(s), not a reimplementation", () => {
    const catalog = makeCatalog([
      { name: "@gates-fixture/a", internalDependencies: ["@gates-fixture/b"] },
      { name: "@gates-fixture/b", internalDependencies: ["@gates-fixture/a"] },
    ]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");

    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.rule).toBe("dependency-cycle");
    }

    // The load-bearing assertion: these findings are not a parallel
    // implementation of cycle detection — they are literally the same
    // findings evaluateCatalog itself produces for this graph.
    const expected = evaluateCatalog(catalog).filter((f) => f.rule === "dependency-cycle");
    expect(result.findings).toEqual(expected);
  });
});

describe("computeBuildOrder — self-dependency", () => {
  it("treats a package depending on itself as a cycle, not a valid order", () => {
    // A self-loop is a strongly connected component of size 1 with an edge
    // to itself — findCyclicGroups (in @vespeneventures/catalog) reports
    // this as a dependency-cycle finding, so computeBuildOrder must refuse
    // it the same way it refuses any other cycle rather than, say, treating
    // a self-edge as trivially satisfied and building the package anyway.
    const catalog = makeCatalog([{ name: "@gates-fixture/self", internalDependencies: ["@gates-fixture/self"] }]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.rule).toBe("dependency-cycle");
    }

    const expected = evaluateCatalog(catalog).filter((f) => f.rule === "dependency-cycle");
    expect(result.findings).toEqual(expected);
  });
});

describe("computeBuildOrder — duplicate names (B1)", () => {
  it("refuses to compute an order over a catalog with duplicate names, rather than silently dropping one and reporting ok:true", () => {
    // The exact reproduction from the audit: a 3-entry catalog where two
    // entries share the name "dup". Before this fix, computeBuildOrder
    // filtered evaluateCatalog's findings for "dependency-cycle" ONLY,
    // throwing away the "duplicate-name" finding that was sitting right
    // there in the same result — and returned `{ ok: true, order: ["dup",
    // "x"] }`: 2 of 3 entries, success reported.
    const catalog = makeCatalog([
      { name: "@gates-fixture/dup" },
      { name: "@gates-fixture/dup" },
      { name: "@gates-fixture/x" },
    ]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — the bug this test guards against returns ok:true here");

    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.rule).toBe("duplicate-name");
    }

    // Not a reimplementation: these are literally evaluateCatalog's own
    // duplicate-name findings for this graph.
    const expected = evaluateCatalog(catalog).filter((f) => f.rule === "duplicate-name");
    expect(result.findings).toEqual(expected);
  });

  it("still gates on duplicate names even when the duplicated entries also participate in a real cycle", () => {
    // Both a duplicate-name AND a dependency-cycle finding exist for this
    // catalog at once — computeBuildOrder's ok:false findings must include
    // both, not just whichever one the (former) single-rule filter happened
    // to keep.
    const catalog = makeCatalog([
      { name: "@gates-fixture/dup", internalDependencies: ["@gates-fixture/other"] },
      { name: "@gates-fixture/dup" },
      { name: "@gates-fixture/other", internalDependencies: ["@gates-fixture/dup"] },
    ]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");

    const rules = new Set(result.findings.map((f) => f.rule));
    expect(rules.has("duplicate-name")).toBe(true);
  });
});

describe("computeBuildOrder — entries with no dependencies", () => {
  it("treats a dependency-free entry as having no internal dependencies, so it is immediately ready", () => {
    const catalog = makeCatalog([{ name: "@gates-fixture/no-deps" }]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(true);
    expect(orderOf(result)).toEqual(["@gates-fixture/no-deps"]);
  });

  it("does not block a package that depends on a name outside the catalog (internal-dep-missing territory)", () => {
    // "b" declares a dependency that is not present in this catalog at all.
    // computeBuildOrder must not hang or throw — the edge is simply dropped,
    // same convention evaluateCatalog's own cycle detection uses.
    const catalog = makeCatalog([
      { name: "@gates-fixture/b", internalDependencies: ["@gates-fixture/does-not-exist"] },
    ]);

    const result = computeBuildOrder(catalog);

    expect(result.ok).toBe(true);
    expect(orderOf(result)).toEqual(["@gates-fixture/b"]);
  });
});

describe("computeBuildOrder — scope filtering", () => {
  it("only treats scope-matching dependencies as graph edges when a scope is given", () => {
    // "a" has a real dependency on an out-of-scope name; it must not be
    // treated as an internal edge (and therefore must not be flagged
    // missing, and must not block "a" from being immediately ready).
    const catalog = makeCatalog([{ name: "@gates-fixture/a", internalDependencies: ["@other-scope/thing"] }]);

    const result = computeBuildOrder(catalog, { scope: "@gates-fixture" });

    expect(result.ok).toBe(true);
    expect(orderOf(result)).toEqual(["@gates-fixture/a"]);
  });
});
