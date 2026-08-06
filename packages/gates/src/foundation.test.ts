import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFoundationCheck } from "./foundation.js";

// Real file I/O against a temp directory, matching @vespeneventures/catalog's
// own build.test.ts and @vespeneventures/release's preflight/pack-round-trip
// tests — the point here is proving that `runFoundationCheck`'s
// `packagesDir`/`maxDepth` options actually reach `buildCatalog`, which only
// a real filesystem fixture can prove. A test built entirely from mocks would
// pass identically whether or not `runFoundationCheck` dropped the options on
// the floor, which is exactly the bug this is guarding against.

const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

function validLeafManifest(name: string) {
  return {
    name,
    version: "1.0.0",
    private: false,
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    dependencies: {},
  };
}

/** Writes a single synthetic package into `<root>/<packagesDirName>/<dirName>/package.json`. */
function makeFixtureRoot(packagesDirName: string, dirName: string, name: string): string {
  const root = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-"));
  createdRoots.push(root);
  const pkgDir = join(root, packagesDirName, dirName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(validLeafManifest(name), null, 2), "utf8");
  return root;
}

describe("runFoundationCheck — options passthrough to buildCatalog", () => {
  it("does NOT find packages in a non-default directory when packagesDir is omitted", () => {
    const root = makeFixtureRoot("modules", "widgets", "@gates-fixture/widgets");

    const report = runFoundationCheck(root);

    expect(report.catalog.entries).toEqual([]);
  });

  it("finds packages in a non-default directory only when packagesDir is passed through", () => {
    const root = makeFixtureRoot("modules", "widgets", "@gates-fixture/widgets");

    const report = runFoundationCheck(root, { packagesDir: "modules" });

    expect(report.catalog.entries).toHaveLength(1);
    expect(report.catalog.entries[0]).toMatchObject({
      name: "@gates-fixture/widgets",
      dir: "modules/widgets",
    });
  });

  it("still honours scope alongside packagesDir — both reach their respective downstream calls", () => {
    // A package with a real dependency on a scoped package not present in
    // the catalog. With `scope` passed through, evaluateCatalog's
    // internal-dep-missing rule has something to run against; this proves
    // `scope` still works exactly as before now that `options` also carries
    // `packagesDir`/`maxDepth`.
    const root = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-"));
    createdRoots.push(root);
    const pkgDir = join(root, "modules", "widgets");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "@gates-fixture/widgets",
          version: "1.0.0",
          private: false,
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
          dependencies: { "@gates-fixture/missing": "^1.0.0" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const report = runFoundationCheck(root, { packagesDir: "modules", scope: "@gates-fixture" });

    expect(report.catalog.entries).toHaveLength(1);
    const missingDepFindings = report.findings.filter((f) => f.rule === "internal-dep-missing");
    expect(missingDepFindings).toHaveLength(1);
    expect(missingDepFindings[0]).toMatchObject({ package: "@gates-fixture/widgets", path: "@gates-fixture/missing" });
  });

  it("respects maxDepth passed through alongside packagesDir", () => {
    const root = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-"));
    createdRoots.push(root);
    const pkgDir = join(root, "modules", "a", "b", "c", "d", "deep");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(validLeafManifest("@gates-fixture/deep")), "utf8");

    // Depth 5 under "modules" — default maxDepth (4) must not find it even
    // with packagesDir set...
    const shallow = runFoundationCheck(root, { packagesDir: "modules" });
    expect(shallow.catalog.entries).toEqual([]);

    // ...but raising maxDepth to 5 must.
    const deep = runFoundationCheck(root, { packagesDir: "modules", maxDepth: 5 });
    expect(deep.catalog.entries.map((e) => e.name)).toEqual(["@gates-fixture/deep"]);
  });
});

describe("runFoundationCheck — options.packagesDir must be relative to root (B2)", () => {
  it("throws rather than silently scanning an absolute packagesDir outside root", () => {
    // The exact reproduction: an absolute packagesDir pointing at a
    // completely different tree. Before this fix, `buildCatalog`'s own
    // `path.resolve(root, packagesDir)` silently discarded `root` — this
    // would have returned a report about `otherRoot`, not `root`, with
    // nothing in the return value revealing that root was ignored.
    const root = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-root-"));
    createdRoots.push(root);
    const otherRoot = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-other-"));
    createdRoots.push(otherRoot);
    const otherPkgDir = join(otherRoot, "packages", "widgets");
    mkdirSync(otherPkgDir, { recursive: true });
    writeFileSync(join(otherPkgDir, "package.json"), JSON.stringify(validLeafManifest("@gates-fixture/other-tree-widgets")), "utf8");

    expect(() => runFoundationCheck(root, { packagesDir: resolve(otherRoot, "packages") })).toThrow(/relative to root/);
  });

  it("still works normally with a relative packagesDir", () => {
    const root = makeFixtureRoot("modules", "widgets", "@gates-fixture/widgets");
    expect(() => runFoundationCheck(root, { packagesDir: "modules" })).not.toThrow();
  });
});

describe("runFoundationCheck — report.complete (Part A4)", () => {
  it("is true when nothing was skipped", () => {
    const root = makeFixtureRoot("packages", "widgets", "@gates-fixture/widgets");
    const report = runFoundationCheck(root);
    expect(report.catalog.skipped).toEqual([]);
    expect(report.complete).toBe(true);
  });

  it("is false when buildCatalog recorded a skip (packages dir missing)", () => {
    const root = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-nopkgdir-"));
    createdRoots.push(root);
    // No "packages" directory created at all.
    const report = runFoundationCheck(root);
    expect(report.catalog.skipped.length).toBeGreaterThan(0);
    expect(report.complete).toBe(false);
  });

  it("is false — and an unreadable directory drives exit-1-worthy severity — for a real chmod-000 fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "gates-foundation-fixture-chmod-"));
    createdRoots.push(root);
    const cleanDir = join(root, "packages", "clean");
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(join(cleanDir, "package.json"), JSON.stringify(validLeafManifest("@gates-fixture/clean")), "utf8");
    const lockedDir = join(root, "packages", "locked");
    mkdirSync(lockedDir, { recursive: true });
    chmodSync(lockedDir, 0o000);
    try {
      const report = runFoundationCheck(root);

      expect(report.complete).toBe(false);
      expect(report.catalog.entries.map((e) => e.name)).toEqual(["@gates-fixture/clean"]);
      const skipFindings = report.findings.filter((f) => f.rule.startsWith("skipped:"));
      expect(skipFindings.length).toBeGreaterThan(0);
      expect(skipFindings.every((f) => f.severity === "error")).toBe(true);
    } finally {
      chmodSync(lockedDir, 0o755);
    }
  });
});
