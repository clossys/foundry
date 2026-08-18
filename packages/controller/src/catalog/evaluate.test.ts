import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog } from "./build.js";
import { cleanupFixtureRoots, makeFixtureRoot } from "./build.test.js";
import { closureOf, evaluateCatalog, findByName, internalDependencyNamesOf } from "./evaluate.js";
import type { Catalog, CatalogEntry } from "./types.js";

// Fixtures below use the synthetic "@catalog-fixture" scope only — never a
// real package name. Each `describe` block builds its own isolated fixture
// root so one rule's test assertions never have to filter out another
// rule's findings.

afterEach(() => {
  cleanupFixtureRoots();
});

interface ManifestOptions {
  internalDependencies?: string[];
  peerInternalDependencies?: string[];
  extraDeps?: Record<string, string>;
}

/** A manifest whose real `dependencies` (and optionally `peerDependencies`) carry the given internal names. */
function validManifest(name: string, options: ManifestOptions = {}) {
  const { internalDependencies = [], peerInternalDependencies = [], extraDeps = {} } = options;

  const dependencies: Record<string, string> = { ...extraDeps };
  for (const dep of internalDependencies) dependencies[dep] = "^1.0.0";

  const manifest: Record<string, unknown> = {
    name,
    version: "1.0.0",
    private: false,
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    dependencies,
  };

  if (peerInternalDependencies.length > 0) {
    manifest.peerDependencies = Object.fromEntries(peerInternalDependencies.map((dep) => [dep, "^1.0.0"]));
  }

  return manifest;
}

/** Builds a bare-bones CatalogEntry directly, for tests that need control over packageJson shape build.test's fixture writer can't express (e.g. a non-object dependencies field). */
function makeEntry(name: string, packageJson: Record<string, unknown>): CatalogEntry {
  return { name, version: "1.0.0", dir: `packages/${name.split("/")[1]}`, private: false, packageJson };
}

describe("internalDependencyNamesOf", () => {
  it("merges dependencies and peerDependencies, deduplicated", () => {
    const entry = makeEntry("@x/a", {
      name: "@x/a",
      dependencies: { "@x/b": "^1.0.0", "@x/c": "^1.0.0" },
      peerDependencies: { "@x/c": "^1.0.0", "@x/d": "^1.0.0" },
    });

    expect(new Set(internalDependencyNamesOf(entry))).toEqual(new Set(["@x/b", "@x/c", "@x/d"]));
  });

  it("filters to names starting with '<scope>/' when a scope is given", () => {
    const entry = makeEntry("@x/a", {
      name: "@x/a",
      dependencies: { "@x/b": "^1.0.0", "typescript": "~6.0.0" },
    });

    expect(internalDependencyNamesOf(entry, "@x")).toEqual(["@x/b"]);
  });

  it("returns every dependency name when scope is omitted", () => {
    const entry = makeEntry("@x/a", {
      name: "@x/a",
      dependencies: { "@x/b": "^1.0.0", "typescript": "~6.0.0" },
    });

    expect(new Set(internalDependencyNamesOf(entry))).toEqual(new Set(["@x/b", "typescript"]));
  });

  it("is total against a non-object dependencies/peerDependencies field", () => {
    const entry = makeEntry("@x/a", { name: "@x/a", dependencies: "not-an-object", peerDependencies: 42 });

    expect(() => internalDependencyNamesOf(entry)).not.toThrow();
    expect(internalDependencyNamesOf(entry)).toEqual([]);
  });

  it("returns [] when neither field is present", () => {
    const entry = makeEntry("@x/a", { name: "@x/a" });

    expect(internalDependencyNamesOf(entry)).toEqual([]);
  });
});

describe("evaluateCatalog — duplicate-name", () => {
  it("reports one finding per duplicated name, listing every directory", () => {
    const root = makeFixtureRoot([
      { dirName: "widgets-a", manifest: validManifest("@catalog-fixture/dup") },
      { dirName: "widgets-b", manifest: validManifest("@catalog-fixture/dup") },
      { dirName: "unique", manifest: validManifest("@catalog-fixture/unique") },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));
    const duplicateFindings = findings.filter((f) => f.rule === "duplicate-name");

    expect(duplicateFindings).toHaveLength(1);
    expect(duplicateFindings[0]?.severity).toBe("error");
    expect(duplicateFindings[0]?.message).toContain("packages/widgets-a");
    expect(duplicateFindings[0]?.message).toContain("packages/widgets-b");
  });

  it("reports nothing when every name is unique", () => {
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a") },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b") },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));

    expect(findings.filter((f) => f.rule === "duplicate-name")).toEqual([]);
  });
});

describe("evaluateCatalog — internal-dep-missing", () => {
  it("errors when a real dependency isn't any package in the catalog", () => {
    const root = makeFixtureRoot([
      {
        dirName: "widgets",
        manifest: validManifest("@catalog-fixture/widgets", { internalDependencies: ["@catalog-fixture/does-not-exist"] }),
      },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));

    expect(findings).toEqual([
      {
        rule: "internal-dep-missing",
        severity: "error",
        message: '"@catalog-fixture/widgets" depends on "@catalog-fixture/does-not-exist", which is not a package in this catalog.',
        package: "@catalog-fixture/widgets",
        path: "@catalog-fixture/does-not-exist",
      },
    ]);
  });

  it("does not fire for an entry with no dependencies at all", () => {
    const root = makeFixtureRoot([{ dirName: "bare", manifest: validManifest("@catalog-fixture/bare") }]);

    const findings = evaluateCatalog(buildCatalog(root));

    expect(findings.filter((f) => f.rule === "internal-dep-missing")).toEqual([]);
  });

  it("fires for a missing peerDependency too", () => {
    const root = makeFixtureRoot([
      {
        dirName: "widgets",
        manifest: validManifest("@catalog-fixture/widgets", { peerInternalDependencies: ["@catalog-fixture/missing-peer"] }),
      },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));

    expect(findings.filter((f) => f.rule === "internal-dep-missing")).toEqual([
      expect.objectContaining({ path: "@catalog-fixture/missing-peer" }),
    ]);
  });

  it("only considers scope-matching dependencies when a scope is given", () => {
    const root = makeFixtureRoot([
      {
        dirName: "widgets",
        manifest: validManifest("@catalog-fixture/widgets", { extraDeps: { "typescript": "~6.0.0" } }),
      },
    ]);

    // "typescript" is a real dependency but does not match the scope, so it
    // is never treated as internal and never flagged as missing.
    const findings = evaluateCatalog(buildCatalog(root), { scope: "@catalog-fixture" });

    expect(findings.filter((f) => f.rule === "internal-dep-missing")).toEqual([]);
  });
});

describe("evaluateCatalog — dependency-cycle", () => {
  it("reports a genuine 2-node cycle exactly once", () => {
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/a"] }) },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));
    const cycleFindings = findings.filter((f) => f.rule === "dependency-cycle");

    expect(cycleFindings).toHaveLength(1);
    expect(cycleFindings[0]).toEqual({
      rule: "dependency-cycle",
      severity: "error",
      message:
        "dependency cycle: 2 packages form a cyclic group — @catalog-fixture/a, @catalog-fixture/b " +
        "(example path: @catalog-fixture/a -> @catalog-fixture/b -> @catalog-fixture/a).",
    });
  });

  it("reports a genuine 3-node cycle exactly once, regardless of which node is visited first", () => {
    const root = makeFixtureRoot([
      { dirName: "c", manifest: validManifest("@catalog-fixture/c", { internalDependencies: ["@catalog-fixture/a"] }) },
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/c"] }) },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));
    const cycleFindings = findings.filter((f) => f.rule === "dependency-cycle");

    expect(cycleFindings).toHaveLength(1);
    expect(cycleFindings[0]?.message).toBe(
      "dependency cycle: 3 packages form a cyclic group — @catalog-fixture/a, @catalog-fixture/b, @catalog-fixture/c " +
        "(example path: @catalog-fixture/a -> @catalog-fixture/b -> @catalog-fixture/c -> @catalog-fixture/a).",
    );
  });

  it("reports nothing for an acyclic chain", () => {
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/c"] }) },
      { dirName: "c", manifest: validManifest("@catalog-fixture/c") },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));

    expect(findings.filter((f) => f.rule === "dependency-cycle")).toEqual([]);
  });

  it("a self-dependency is reported as a 1-member cyclic group", () => {
    const root = makeFixtureRoot([
      { dirName: "self", manifest: validManifest("@catalog-fixture/self", { internalDependencies: ["@catalog-fixture/self"] }) },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));
    const cycleFindings = findings.filter((f) => f.rule === "dependency-cycle");

    expect(cycleFindings).toHaveLength(1);
    expect(cycleFindings[0]?.message).toContain("1 packages form a cyclic group");
  });

  it("ignores a dependency edge that does not match the given scope", () => {
    // "a" depends on "b" via a real dependency, but only "@other-scope" is
    // being treated as internal here — so no cycle is seen even though "b"
    // depends back on "a" under the fixture scope.
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/a"] }) },
    ]);

    const findings = evaluateCatalog(buildCatalog(root), { scope: "@other-scope" });

    expect(findings.filter((f) => f.rule === "dependency-cycle")).toEqual([]);
    expect(findings.filter((f) => f.rule === "internal-dep-missing")).toEqual([]);
  });
});

describe("closureOf", () => {
  it("returns the transitive closure of an acyclic chain, excluding the starting entry", () => {
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/c"] }) },
      { dirName: "c", manifest: validManifest("@catalog-fixture/c") },
      { dirName: "d", manifest: validManifest("@catalog-fixture/d") },
    ]);

    const { reachable, missing } = closureOf(buildCatalog(root), "@catalog-fixture/a");

    expect(new Set(reachable)).toEqual(new Set(["@catalog-fixture/b", "@catalog-fixture/c"]));
    expect(reachable).not.toContain("@catalog-fixture/a");
    expect(reachable).not.toContain("@catalog-fixture/d");
    expect(missing).toEqual([]);
  });

  it("splits missing names out of the closure", () => {
    const root = makeFixtureRoot([
      {
        dirName: "e",
        manifest: validManifest("@catalog-fixture/e", { internalDependencies: ["@catalog-fixture/missing-in-closure"] }),
      },
    ]);

    const { reachable, missing } = closureOf(buildCatalog(root), "@catalog-fixture/e");

    expect(reachable).toEqual([]);
    expect(missing).toEqual(["@catalog-fixture/missing-in-closure"]);
  });

  it("is safe against a cycle and still excludes the starting entry", () => {
    const root = makeFixtureRoot([
      { dirName: "f", manifest: validManifest("@catalog-fixture/f", { internalDependencies: ["@catalog-fixture/g"] }) },
      { dirName: "g", manifest: validManifest("@catalog-fixture/g", { internalDependencies: ["@catalog-fixture/f"] }) },
    ]);

    const { reachable, missing } = closureOf(buildCatalog(root), "@catalog-fixture/f");

    expect(reachable).toEqual(["@catalog-fixture/g"]);
    expect(missing).toEqual([]);
  });

  it("returns empty lists for a name not in the catalog", () => {
    const root = makeFixtureRoot([{ dirName: "a", manifest: validManifest("@catalog-fixture/a") }]);

    const { reachable, missing } = closureOf(buildCatalog(root), "@catalog-fixture/not-in-catalog");

    expect(reachable).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("respects scope filtering, matching evaluateCatalog's own graph", () => {
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b") },
    ]);

    const { reachable } = closureOf(buildCatalog(root), "@catalog-fixture/a", "@other-scope");

    expect(reachable).toEqual([]);
  });
});

describe("findByName", () => {
  it("finds an entry that exists", () => {
    const root = makeFixtureRoot([{ dirName: "a", manifest: validManifest("@catalog-fixture/a") }]);

    const entry = findByName(buildCatalog(root), "@catalog-fixture/a");

    expect(entry?.name).toBe("@catalog-fixture/a");
  });

  it("returns undefined for a name that doesn't exist", () => {
    const root = makeFixtureRoot([{ dirName: "a", manifest: validManifest("@catalog-fixture/a") }]);

    expect(findByName(buildCatalog(root), "@catalog-fixture/nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateCatalog turning catalog.skipped into findings.
// ---------------------------------------------------------------------------

describe("evaluateCatalog — skipped:* ('I could not check this' is representable)", () => {
  it("emits an error for an 'unreadable' skip and a warning for an 'unusable' skip", () => {
    const catalog: Catalog = {
      root: "/fake/root",
      entries: [],
      skipped: [
        { path: "packages/locked", reason: "unreadable-directory", kind: "unreadable", detail: "EACCES" },
        { path: "packages/bad-json", reason: "unparseable-manifest", kind: "unusable", detail: "Unexpected token" },
      ],
    };

    const findings = evaluateCatalog(catalog);
    const skippedFindings = findings.filter((f) => f.rule.startsWith("skipped:"));

    expect(skippedFindings).toEqual([
      expect.objectContaining({
        rule: "skipped:unreadable-directory",
        severity: "error",
        path: "packages/locked",
      }),
      expect.objectContaining({
        rule: "skipped:unparseable-manifest",
        severity: "warning",
        path: "packages/bad-json",
      }),
    ]);
  });

  it("emits nothing when catalog.skipped is empty", () => {
    const catalog: Catalog = { root: "/fake/root", entries: [], skipped: [] };

    expect(evaluateCatalog(catalog).filter((f) => f.rule.startsWith("skipped:"))).toEqual([]);
  });

  it("does not throw when catalog.skipped is absent entirely (a hand-built Catalog predating this field)", () => {
    // Catalog is a plain data shape a caller can construct directly — as,
    // for example, a consuming package's own unit tests do (see
    // @vespeneventures/gates' build-order.test.ts, which builds Catalog
    // fixtures in-memory without ever calling buildCatalog). Adding
    // `skipped` to the type must not turn every such hand-built object into
    // a runtime crash.
    const legacyShapedCatalog = { root: "/fake/root", entries: [] } as unknown as Catalog;

    expect(() => evaluateCatalog(legacyShapedCatalog)).not.toThrow();
    expect(evaluateCatalog(legacyShapedCatalog).filter((f) => f.rule.startsWith("skipped:"))).toEqual([]);
  });

  it("packages-dir-missing is a warning, not an error — a fresh/differently-laid-out workspace must not fail a check-style gate outright", () => {
    const root = mkdtempSync(join(tmpdir(), "catalog-fixture-evaluate-missing-"));
    try {
      const findings = evaluateCatalog(buildCatalog(root));

      expect(findings).toEqual([
        {
          rule: "skipped:packages-dir-missing",
          severity: "warning",
          message: '"packages" was skipped (packages-dir-missing) — this catalog may be missing packages that live there.',
          path: "packages",
        },
      ]);
      expect(findings.some((f) => f.severity === "error")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("motivating reproduction: a real error-severity finding survives next to an unreadable sibling directory, and the unreadable directory itself is now reported as an error rather than silently producing a clean report", () => {
    const root = makeFixtureRoot([
      {
        dirName: "widgets",
        manifest: validManifest("@catalog-fixture/widgets", {
          internalDependencies: ["@catalog-fixture/does-not-exist"],
        }),
      },
      { dirName: "locked", manifest: validManifest("@catalog-fixture/locked") },
    ]);
    const lockedDir = join(root, "packages", "locked");
    chmodSync(lockedDir, 0o000);
    try {
      const findings = evaluateCatalog(buildCatalog(root));

      const missingDep = findings.filter((f) => f.rule === "internal-dep-missing");
      expect(missingDep).toHaveLength(1); // BEFORE the fix: buildCatalog silently dropped "locked" entirely, but this finding survived regardless (it's about "widgets", unaffected) — the real regression this guards is below.

      const skippedError = findings.filter((f) => f.rule === "skipped:unreadable-directory");
      expect(skippedError).toHaveLength(1);
      expect(skippedError[0]?.severity).toBe("error"); // BEFORE the fix: no such finding existed at all — "chmod 000" produced a clean report.
    } finally {
      chmodSync(lockedDir, 0o755);
    }
  });
});

// ---------------------------------------------------------------------------
// Cyclic groups, not elementary-cycle enumeration.
// ---------------------------------------------------------------------------

describe("evaluateCatalog — dependency-cycle: cyclic groups, not elementary cycles", () => {
  it("reports ONE finding naming all four members when two elementary cycles share a node", () => {
    // A -> [B, C], B -> D, C -> D, D -> A: two elementary cycles sharing
    // node D (A-B-D-A and A-C-D-A). All four of A/B/C/D can reach every
    // other, so they are ONE strongly connected component — the correct
    // reporting unit is one finding naming all four, not two findings (one
    // per elementary cycle). See findCyclicGroups' doc comment for why "one
    // per component" replaced "one per elementary cycle" outright, rather
    // than just fixing the enumeration to be exhaustive.
    const root = makeFixtureRoot([
      {
        dirName: "a",
        manifest: validManifest("@catalog-fixture/a", {
          internalDependencies: ["@catalog-fixture/b", "@catalog-fixture/c"],
        }),
      },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/d"] }) },
      { dirName: "c", manifest: validManifest("@catalog-fixture/c", { internalDependencies: ["@catalog-fixture/d"] }) },
      { dirName: "d", manifest: validManifest("@catalog-fixture/d", { internalDependencies: ["@catalog-fixture/a"] }) },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));
    const cycleFindings = findings.filter((f) => f.rule === "dependency-cycle");

    expect(cycleFindings).toHaveLength(1);
    const message = cycleFindings[0]?.message ?? "";
    expect(message).toContain("4 packages form a cyclic group");
    for (const name of ["@catalog-fixture/a", "@catalog-fixture/b", "@catalog-fixture/c", "@catalog-fixture/d"]) {
      expect(message).toContain(name);
    }
    expect(message).toContain("example path:");
  });

  it("reports TWO separate findings for two genuinely independent cyclic groups (A<->B and C<->D, unconnected)", () => {
    // This is the case that actually proves "per component", not "per
    // graph": if this reported only 1 finding, the implementation would be
    // merging unrelated cyclic groups together; if it reported the SCC
    // sharing-a-node case above as 2, it would be back to enumerating
    // elementary cycles. Two disjoint 2-cycles must produce exactly 2
    // findings, each naming only its own 2 members.
    const root = makeFixtureRoot([
      { dirName: "a", manifest: validManifest("@catalog-fixture/a", { internalDependencies: ["@catalog-fixture/b"] }) },
      { dirName: "b", manifest: validManifest("@catalog-fixture/b", { internalDependencies: ["@catalog-fixture/a"] }) },
      { dirName: "c", manifest: validManifest("@catalog-fixture/c", { internalDependencies: ["@catalog-fixture/d"] }) },
      { dirName: "d", manifest: validManifest("@catalog-fixture/d", { internalDependencies: ["@catalog-fixture/c"] }) },
    ]);

    const findings = evaluateCatalog(buildCatalog(root));
    const cycleFindings = findings.filter((f) => f.rule === "dependency-cycle");

    expect(cycleFindings).toHaveLength(2);
    const messages = cycleFindings.map((f) => f.message);
    expect(messages.some((m) => m.includes("@catalog-fixture/a") && m.includes("@catalog-fixture/b"))).toBe(true);
    expect(messages.some((m) => m.includes("@catalog-fixture/c") && m.includes("@catalog-fixture/d"))).toBe(true);
    // Neither finding's member list crosses over into the other group.
    const abFinding = messages.find((m) => m.includes("@catalog-fixture/a"));
    expect(abFinding).not.toContain("@catalog-fixture/c");
    expect(abFinding).not.toContain("@catalog-fixture/d");
    const cdFinding = messages.find((m) => m.includes("@catalog-fixture/c"));
    expect(cdFinding).not.toContain("@catalog-fixture/a");
    expect(cdFinding).not.toContain("@catalog-fixture/b");
  });

  it("PERFORMANCE GUARD: a complete digraph of ~15 mutually-dependent packages evaluates in well under a second", () => {
    // A complete digraph (every package depends on every other) is the
    // worst case for elementary-cycle enumeration — n=9 alone produced
    // 125,664 cycles in over 2 seconds under the old approach, and n=12 was
    // on the order of an hour. SCC-based reporting is O(V+E) regardless: 15
    // fully mutually-dependent packages are still just ONE strongly
    // connected component, found and reported in one pass. This test
    // exists specifically to catch a future reintroduction of exhaustive
    // enumeration — it would time out (or take visibly, drastically longer)
    // long before this budget is threatened by anything else.
    const n = 15;
    const names = Array.from({ length: n }, (_, i) => `@catalog-fixture/node${i}`);
    const packages = names.map((name, i) => ({
      dirName: `node${i}`,
      manifest: validManifest(name, { internalDependencies: names.filter((other) => other !== name) }),
    }));
    const root = makeFixtureRoot(packages);
    const catalog = buildCatalog(root);

    const start = performance.now();
    const findings = evaluateCatalog(catalog);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    const cycleFindings = findings.filter((f) => f.rule === "dependency-cycle");
    expect(cycleFindings).toHaveLength(1); // one giant cyclic group, not one finding per elementary cycle
    expect(cycleFindings[0]?.message).toContain(`${n} packages form a cyclic group`);
  });
});
