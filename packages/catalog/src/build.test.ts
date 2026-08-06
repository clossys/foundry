import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog } from "./build.js";

// This test file does real file I/O against temp directories — that's the
// point of testing buildCatalog, the one function in this package that
// reads disk. Every fixture uses the synthetic "@catalog-fixture" scope,
// never a real package name.

/** One synthetic package to write into a fixture root's packages/ directory. */
export interface FixturePackage {
  dirName: string;
  /** Written as JSON.stringify(manifest), unless already a string (for malformed-JSON fixtures). */
  manifest: unknown;
}

const createdRoots: string[] = [];

/** Writes a synthetic packages/ tree to a fresh temp directory. Tracked for cleanup via cleanupFixtureRoots(). */
export function makeFixtureRoot(packages: FixturePackage[], packagesDirName = "packages"): string {
  const root = mkdtempSync(join(tmpdir(), "catalog-fixture-"));
  createdRoots.push(root);
  const packagesDir = join(root, packagesDirName);
  mkdirSync(packagesDir, { recursive: true });
  for (const pkg of packages) {
    const dir = join(packagesDir, pkg.dirName);
    mkdirSync(dir, { recursive: true });
    const contents = typeof pkg.manifest === "string" ? pkg.manifest : JSON.stringify(pkg.manifest, null, 2);
    writeFileSync(join(dir, "package.json"), contents, "utf8");
  }
  return root;
}

/** Removes every fixture root created via makeFixtureRoot since the last call. Call from afterEach. */
export function cleanupFixtureRoots(): void {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  cleanupFixtureRoots();
});

function validLeafManifest(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    version: "1.0.0",
    private: false,
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    dependencies: {},
    ...extra,
  };
}

describe("buildCatalog — gathering real packages", () => {
  it("finds a well-formed package and records its summary fields", () => {
    const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);

    const catalog = buildCatalog(root);

    expect(catalog.entries).toHaveLength(1);
    const entry = catalog.entries[0];
    expect(entry).toMatchObject({
      name: "@catalog-fixture/widgets",
      version: "1.0.0",
      dir: "packages/widgets",
      private: false,
    });
    expect(entry?.packageJson).toMatchObject({ name: "@catalog-fixture/widgets" });
  });

  it("resolves root itself, not process.cwd()", () => {
    const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const catalog = buildCatalog(root);
      expect(catalog.entries).toHaveLength(1);
      expect(catalog.entries[0]?.name).toBe("@catalog-fixture/widgets");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("defaults private to false when the field is absent", () => {
    const manifest = validLeafManifest("@catalog-fixture/no-private-field");
    delete (manifest as Record<string, unknown>).private;
    const root = makeFixtureRoot([{ dirName: "pkg", manifest }]);

    const catalog = buildCatalog(root);

    expect(catalog.entries[0]?.private).toBe(false);
  });

  it("carries private: true through unchanged", () => {
    const root = makeFixtureRoot([
      { dirName: "pkg", manifest: validLeafManifest("@catalog-fixture/priv", { private: true }) },
    ]);

    const catalog = buildCatalog(root);

    expect(catalog.entries[0]?.private).toBe(true);
  });

  it("honours a custom packagesDir option", () => {
    const root = makeFixtureRoot(
      [{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }],
      "modules",
    );

    const defaultCatalog = buildCatalog(root);
    const customCatalog = buildCatalog(root, { packagesDir: "modules" });

    expect(defaultCatalog.entries).toHaveLength(0); // no packages/ directory at all
    expect(customCatalog.entries).toHaveLength(1);
    expect(customCatalog.entries[0]?.dir).toBe("modules/widgets");
  });

  it("returns an empty catalog, not an error, when the packages directory does not exist at all", () => {
    const root = mkdtempSync(join(tmpdir(), "catalog-fixture-empty-"));
    createdRoots.push(root);

    const catalog = buildCatalog(root);

    expect(catalog.entries).toEqual([]);
    expect(catalog.root).toBe(root);
  });

  describe("skip behaviour — malformed/missing package.json is skipped silently, never thrown", () => {
    it("skips a plain file sibling that isn't a directory", () => {
      const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);
      writeFileSync(join(root, "packages", "NOTES.txt"), "not a package directory", "utf8");

      expect(() => buildCatalog(root)).not.toThrow();
      const catalog = buildCatalog(root);
      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    });

    it("skips a directory with no package.json", () => {
      const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);
      mkdirSync(join(root, "packages", "empty-dir"), { recursive: true });

      const catalog = buildCatalog(root);

      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    });

    it("skips a directory whose package.json does not parse as JSON", () => {
      const root = makeFixtureRoot([
        { dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") },
        { dirName: "broken", manifest: "{ this is not valid JSON" },
      ]);

      expect(() => buildCatalog(root)).not.toThrow();
      const catalog = buildCatalog(root);
      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    });

    it("skips a package.json that parses but isn't a plain object", () => {
      const root = makeFixtureRoot([
        { dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") },
        { dirName: "array-manifest", manifest: JSON.stringify(["not", "an", "object"]) },
      ]);

      const catalog = buildCatalog(root);

      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    });

    it("skips a package.json missing a usable name or version", () => {
      const root = makeFixtureRoot([
        { dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") },
        { dirName: "no-name", manifest: { version: "1.0.0" } },
        { dirName: "no-version", manifest: { name: "@catalog-fixture/no-version" } },
      ]);

      const catalog = buildCatalog(root);

      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    });
  });
});

describe("buildCatalog — recursive walk", () => {
  it("still finds a depth-1 package (regression guard on the pre-recursive behaviour)", () => {
    const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    expect(catalog.entries[0]?.dir).toBe("packages/widgets");
  });

  it("finds a depth-2 package (packages/<tier>/<pkg>/package.json) — this is the bug being fixed", () => {
    const root = makeFixtureRoot([
      { dirName: "tier/widgets", manifest: validLeafManifest("@catalog-fixture/widgets") },
    ]);

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    expect(catalog.entries[0]?.dir).toBe("packages/tier/widgets");
  });

  it("finds packages in a MIXED tree with both depth-1 and depth-2 layouts", () => {
    const root = makeFixtureRoot([
      { dirName: "flat", manifest: validLeafManifest("@catalog-fixture/flat") },
      { dirName: "tier/nested", manifest: validLeafManifest("@catalog-fixture/nested") },
    ]);

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name).sort()).toEqual(["@catalog-fixture/flat", "@catalog-fixture/nested"]);
    const byName = new Map(catalog.entries.map((e) => [e.name, e]));
    expect(byName.get("@catalog-fixture/flat")?.dir).toBe("packages/flat");
    expect(byName.get("@catalog-fixture/nested")?.dir).toBe("packages/tier/nested");
  });

  it("does not record a package nested inside another package's own directory (rule 1: a found package is not descended into)", () => {
    const root = makeFixtureRoot([{ dirName: "outer", manifest: validLeafManifest("@catalog-fixture/outer") }]);
    // A fixture/test-workspace living inside "outer" that itself looks like
    // a package. Because "outer" already has its own package.json, the walk
    // must never look inside it.
    const innerDir = join(root, "packages", "outer", "fixtures", "inner");
    mkdirSync(innerDir, { recursive: true });
    writeFileSync(
      join(innerDir, "package.json"),
      JSON.stringify(validLeafManifest("@catalog-fixture/inner")),
      "utf8",
    );

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/outer"]);
  });

  it("skips node_modules, dist, build, and dot-directories even when they contain a valid package.json", () => {
    const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);
    for (const skippedName of ["node_modules", "dist", "build", ".hidden"]) {
      const dir = join(root, "packages", skippedName, "sneaky");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify(validLeafManifest(`@catalog-fixture/${skippedName}-sneaky`)),
        "utf8",
      );
    }

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
  });

  it("does not follow a symlinked directory (lstatSync, not statSync)", () => {
    const root = makeFixtureRoot([
      { dirName: "real-group/widgets", manifest: validLeafManifest("@catalog-fixture/widgets") },
    ]);
    // A symlink inside packages/ pointing at the real tier directory. If the
    // walk followed it, "linked/widgets" would also be found, and a symlink
    // cycle (a link pointing back up its own ancestry) could loop forever.
    symlinkSync(join(root, "packages", "real-group"), join(root, "packages", "linked"), "dir");

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    expect(catalog.entries[0]?.dir).toBe("packages/real-group/widgets");
  });

  it("respects maxDepth: a package deeper than the limit is not found", () => {
    const root = makeFixtureRoot([
      { dirName: "a/b/c/d/deep", manifest: validLeafManifest("@catalog-fixture/deep") },
    ]);

    // "packages/a/b/c/d/deep/package.json" is depth 5. maxDepth 4 (the
    // default) must not find it...
    const defaultCatalog = buildCatalog(root);
    expect(defaultCatalog.entries).toEqual([]);

    // ...but raising the bound to 5 must.
    const raisedCatalog = buildCatalog(root, { maxDepth: 5 });
    expect(raisedCatalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/deep"]);
  });

  it("falls back to the default bound when maxDepth is not a positive integer", () => {
    const root = makeFixtureRoot([
      { dirName: "a/b/c/d/deep", manifest: validLeafManifest("@catalog-fixture/deep") },
      { dirName: "shallow", manifest: validLeafManifest("@catalog-fixture/shallow") },
    ]);

    // NaN is the case that actually matters: the bound is applied as
    // `depth > maxDepth`, which is false for NaN, so an unvalidated NaN would
    // disable the bound and pull in the depth-5 package. Every one of these
    // must behave exactly like the default bound of 4 — depth-1 found,
    // depth-5 not.
    for (const bad of [Number.NaN, 0, -1, 2.5, undefined]) {
      const catalog = buildCatalog(root, { maxDepth: bad as number | undefined });
      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/shallow"]);
    }
  });

  it("still returns an empty catalog, not a throw, when the packages directory is missing (recursive walk edition)", () => {
    const root = mkdtempSync(join(tmpdir(), "catalog-fixture-empty-"));
    createdRoots.push(root);

    expect(() => buildCatalog(root)).not.toThrow();
    expect(buildCatalog(root).entries).toEqual([]);
  });

  it("an unparseable package.json is skipped AND not descended into", () => {
    const root = makeFixtureRoot([{ dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") }]);
    const brokenDir = join(root, "packages", "broken-group");
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, "package.json"), "{ this is not valid JSON", "utf8");
    // If the walk treated the unparseable package.json as "not a package"
    // rather than "a claimed-but-broken package", it would wrongly descend
    // and find this nested valid manifest too.
    const nestedDir = join(brokenDir, "nested");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(nestedDir, "package.json"),
      JSON.stringify(validLeafManifest("@catalog-fixture/should-not-be-found")),
      "utf8",
    );

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
  });

  it("returns entries in a deterministic, sorted order regardless of creation order", () => {
    const root = makeFixtureRoot([
      { dirName: "zebra", manifest: validLeafManifest("@catalog-fixture/zebra") },
      { dirName: "alpha/nested-z", manifest: validLeafManifest("@catalog-fixture/alpha-nested-z") },
      { dirName: "alpha/nested-a", manifest: validLeafManifest("@catalog-fixture/alpha-nested-a") },
      { dirName: "beta", manifest: validLeafManifest("@catalog-fixture/beta") },
    ]);

    const first = buildCatalog(root).entries.map((e) => e.dir);
    const second = buildCatalog(root).entries.map((e) => e.dir);

    // Directory entries are sorted before recursing, so a directory named
    // "alpha" (and everything found beneath it) always sorts, and is
    // therefore always walked, before "beta" and "zebra" — independent of
    // whatever order the OS happened to hand back from readdirSync.
    expect(first).toEqual([
      "packages/alpha/nested-a",
      "packages/alpha/nested-z",
      "packages/beta",
      "packages/zebra",
    ]);
    expect(second).toEqual(first);
  });
});

describe("buildCatalog — catalog.skipped (Part A: representing 'could not check this')", () => {
  it("records an unreadable-directory skip for a chmod-000 package directory, without losing a sibling package's entry", () => {
    // The motivating reproduction: a clean package next to one whose
    // directory cannot be read at all. Before this fix, the unreadable
    // directory's readdirSync failure was swallowed identically to a benign
    // "vanished mid-walk" race, so it — and anything it might have declared
    // — vanished from the catalog with zero trace.
    const root = makeFixtureRoot([
      { dirName: "clean", manifest: validLeafManifest("@catalog-fixture/clean") },
      { dirName: "locked", manifest: validLeafManifest("@catalog-fixture/locked") },
    ]);
    const lockedDir = join(root, "packages", "locked");
    chmodSync(lockedDir, 0o000);
    try {
      const catalog = buildCatalog(root);

      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/clean"]);
      expect(catalog.skipped).toEqual([
        {
          path: "packages/locked",
          reason: "unreadable-directory",
          kind: "unreadable",
          detail: expect.any(String),
        },
      ]);
    } finally {
      // Restore permissions so cleanupFixtureRoots' recursive rmSync can
      // actually delete this directory's contents.
      chmodSync(lockedDir, 0o755);
    }
  });

  it("records an unreadable-manifest skip when only the manifest file itself is unreadable (directory stays listable)", () => {
    const root = makeFixtureRoot([
      { dirName: "clean", manifest: validLeafManifest("@catalog-fixture/clean") },
      { dirName: "locked-manifest", manifest: validLeafManifest("@catalog-fixture/locked-manifest") },
    ]);
    const manifestPath = join(root, "packages", "locked-manifest", "package.json");
    chmodSync(manifestPath, 0o000);
    try {
      const catalog = buildCatalog(root);

      expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/clean"]);
      expect(catalog.skipped).toEqual([
        {
          path: "packages/locked-manifest",
          reason: "unreadable-manifest",
          kind: "unreadable",
          detail: expect.any(String),
        },
      ]);
    } finally {
      chmodSync(manifestPath, 0o644);
    }
  });

  it("records skipped entries for each of the pre-existing 'unusable manifest' shapes, all kind: unusable", () => {
    const root = makeFixtureRoot([
      { dirName: "widgets", manifest: validLeafManifest("@catalog-fixture/widgets") },
      { dirName: "broken-json", manifest: "{ this is not valid JSON" },
      { dirName: "array-manifest", manifest: JSON.stringify(["not", "an", "object"]) },
      { dirName: "no-name", manifest: { version: "1.0.0" } },
      { dirName: "no-version", manifest: { name: "@catalog-fixture/no-version" } },
    ]);

    const catalog = buildCatalog(root);

    expect(catalog.entries.map((e) => e.name)).toEqual(["@catalog-fixture/widgets"]);
    const byPath = new Map(catalog.skipped.map((s) => [s.path, s]));
    expect(byPath.get("packages/broken-json")).toMatchObject({ reason: "unparseable-manifest", kind: "unusable" });
    expect(byPath.get("packages/array-manifest")).toMatchObject({ reason: "manifest-not-object", kind: "unusable" });
    expect(byPath.get("packages/no-name")).toMatchObject({
      reason: "manifest-missing-name-or-version",
      kind: "unusable",
    });
    expect(byPath.get("packages/no-version")).toMatchObject({
      reason: "manifest-missing-name-or-version",
      kind: "unusable",
    });
    expect(catalog.skipped).toHaveLength(4);
  });

  it("distinguishes a genuinely missing packages directory from an existing, empty one", () => {
    // The other reproduction: a typo'd packagesDir (or a missing default
    // "packages" directory) previously returned `{ entries: [] }`, byte-
    // identical to a real, existing, empty packages directory — so a
    // config typo was structurally indistinguishable from a normal empty
    // workspace.
    const missingRoot = mkdtempSync(join(tmpdir(), "catalog-fixture-missing-"));
    createdRoots.push(missingRoot);
    const missingCatalog = buildCatalog(missingRoot);

    expect(missingCatalog.entries).toEqual([]);
    expect(missingCatalog.skipped).toEqual([
      { path: "packages", reason: "packages-dir-missing", kind: "unusable" },
    ]);

    const emptyRoot = mkdtempSync(join(tmpdir(), "catalog-fixture-empty-existing-"));
    createdRoots.push(emptyRoot);
    mkdirSync(join(emptyRoot, "packages"), { recursive: true });
    const emptyCatalog = buildCatalog(emptyRoot);

    expect(emptyCatalog.entries).toEqual([]);
    expect(emptyCatalog.skipped).toEqual([]); // exists and is genuinely empty — nothing to report

    // The two are no longer structurally identical.
    expect(missingCatalog.skipped).not.toEqual(emptyCatalog.skipped);
  });

  it("still never throws when the packages directory is missing, and records the skip under the custom packagesDir name (typo reproduction)", () => {
    const root = mkdtempSync(join(tmpdir(), "catalog-fixture-typo-"));
    createdRoots.push(root);
    mkdirSync(join(root, "packages"), { recursive: true }); // the REAL directory, never consulted below

    expect(() => buildCatalog(root, { packagesDir: "package" })).not.toThrow(); // "package", not "packages" — a typo
    const catalog = buildCatalog(root, { packagesDir: "package" });

    expect(catalog.entries).toEqual([]);
    expect(catalog.skipped).toEqual([{ path: "package", reason: "packages-dir-missing", kind: "unusable" }]);
  });
});
