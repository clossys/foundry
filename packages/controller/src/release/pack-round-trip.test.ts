import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { packRoundTrip, subprocessEnv } from "./pack-round-trip.js";

// Real subprocess integration tests. No mocking of npm pack/install/import
// here — that would defeat the entire point of this package, which exists
// specifically to prove installability with real I/O, not declared shape.
// These are correspondingly slower than a unit test; see vitest.config.ts's
// generous timeouts.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("packRoundTrip — real subprocess round trip", () => {
  // This used to target packages/governance, back when governance was its
  // own package with these package-process subpaths. Issue #282 folded
  // governance's source into @clossys/controller directly and
  // deleted the `governance` compatibility stub with zero consumers left
  // behind, so controller is now the package that declares these subpaths
  // and must ship built files for every one of them.
  it("controller declares built files for every package-process subpath", () => {
    const controllerDir = join(repoRoot, "packages", "controller");
    const manifest = JSON.parse(readFileSync(join(controllerDir, "package.json"), "utf8")) as {
      exports: Record<string, { import: string; types: string }>;
    };

    for (const subpath of [
      "./catalog",
      "./gates",
      "./release",
      "./repository",
      "./review",
      "./review/github",
      "./artifacts",
      "./cleanup",
      "./composition",
    ]) {
      const entry = manifest.exports[subpath];
      expect(entry).toBeDefined();
      if (entry === undefined) throw new Error(`missing ${subpath} export`);
      expect(existsSync(join(controllerDir, entry.import))).toBe(true);
      expect(existsSync(join(controllerDir, entry.types))).toBe(true);
    }
  });

  // This used to target packages/policy, back when policy was its own
  // zero-external-dependency package. Since issue #282 folded policy's
  // source into @clossys/controller as its `./policy` subpath, the
  // deprecated `@example/policy` compatibility stub now genuinely
  // depends on `@clossys/controller`, which a real isolated-install
  // round trip cannot resolve until controller is itself published.
  // Controller inherited the zero-external-dependency property that used to
  // make policy the natural fixture for this test, so this test now targets
  // controller instead — also covering, for the first time in a real
  // subprocess install, controller's `./conventions/documents/*` and
  // `./conventions/adapters/*` static-asset wildcard subpaths.
  // controller ships many more exports subpaths than policy did (catalog,
  // gates, release, repository, review, review/github, artifacts, cleanup,
  // composition, conventions, conventions/documents/*, conventions/adapters/*,
  // policy), so the real npm install + per-subpath import checks below take
  // longer than the suite's default 5s timeout.
  it("packages/controller installs and imports cleanly from a genuinely isolated directory", { timeout: 120_000 }, async () => {
    const result = await packRoundTrip(join(repoRoot, "packages", "controller"));

    expect(result.packageName).toBe("@clossys/controller");
    expect(result.tarballPath).not.toBe("");
    expect(result.findings).toEqual([]);
    expect(result.imports.length).toBeGreaterThan(0);
    for (const check of result.imports) {
      expect(check.ok).toBe(true);
      expect(check.error).toBeUndefined();
    }
    expect(result.ok).toBe(true);
  });

});

// Fixture packages for the shape/behavior tests below. Each fixture is a
// real, on-disk package directory -- packRoundTrip genuinely `npm pack`s and
// `npm install`s it, so there is no way to fake these with in-memory
// objects. Every fixture directory created by a test is removed afterward.
const fixtureDirs: string[] = [];

function makeFixture(name: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), `release-fixture-${name}-`));
  fixtureDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

afterEach(() => {
  while (fixtureDirs.length > 0) {
    const dir = fixtureDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// Every fixture performs real npm pack/install subprocess work. During the
// complete Controller suite those subprocesses contend with other test files,
// so use an install-scale budget rather than Vitest's generic 5s unit budget.
describe("packRoundTrip — exports shape handling (fixture packages)", { timeout: 30_000 }, () => {
  // Regression for defect 1: an empty `exports` object previously produced
  // zero import attempts and `ok: true` -- a package whose entire purpose is
  // proving importability reporting success having imported nothing. The
  // fixture's own index.js unconditionally throws, so if the old bug were
  // still present this would still pass (it never gets far enough to import
  // index.js at all), which is exactly the point: `ok` must not depend on
  // whether the throw is ever reached.
  it("reports NOT ok for a package with empty exports, even though nothing failed to import", async () => {
    const dir = makeFixture("empty-exports", {
      "package.json": JSON.stringify(
        {
          name: "empty-exports-fixture",
          version: "1.0.0",
          type: "module",
          exports: {},
        },
        null,
        2,
      ),
      "index.js": "throw new Error('this must never be reached by a correct round trip');\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-no-exports");
    expect(result.findings[0]?.severity).toBe("error");
    expect(result.findings[0]?.message).toContain("empty-exports-fixture");
  });

  // Regression for defect 2: a flat conditions object with no "." wrapper
  // is a single root export, not subpaths named "types"/"import". The old
  // subpathsOf() treated every object key as a subpath and produced two
  // spurious round-trip-import-failed findings for this exact, common shape.
  it("passes for a package with a flat conditional exports object (no explicit \".\" key)", async () => {
    const dir = makeFixture("flat-conditional", {
      "package.json": JSON.stringify(
        {
          name: "flat-conditional-fixture",
          version: "1.0.0",
          type: "module",
          exports: {
            types: "./index.d.ts",
            import: "./index.js",
          },
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
      "index.d.ts": "export declare const ok: boolean;\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([{ subpath: ".", mode: "import", ok: true }]);
    expect(result.declarations).toEqual([{ subpath: ".", target: "./index.d.ts", ok: true }]);
    expect(result.ok).toBe(true);
  });

  // `exports` as an array is npm's fallback-list form of the root export --
  // it must resolve to a single "." import, not subpaths "0", "1".
  it("passes for a package with an exports array", async () => {
    const dir = makeFixture("array-exports", {
      "package.json": JSON.stringify(
        {
          name: "array-exports-fixture",
          version: "1.0.0",
          type: "module",
          exports: ["./index.js"],
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([{ subpath: ".", mode: "import", ok: true }]);
    expect(result.ok).toBe(true);
  });

  it("checks CSS and JSONC export files without trying to import them or install optional peers", async () => {
    const dir = makeFixture("static-assets", {
      "package.json": JSON.stringify(
        {
          name: "static-assets-fixture",
          version: "1.0.0",
          type: "module",
          exports: {
            "./tokens.css": "./styles/tokens.css",
            "./record.template.jsonc": "./templates/record.template.jsonc",
          },
          // This is intentionally nonexistent. Its optional declaration
          // means npm does not install it with the tarball; a static-only
          // package must still be verifiable without runtime peers.
          peerDependencies: { "peer-that-must-not-be-installed": "^1.0.0" },
          peerDependenciesMeta: { "peer-that-must-not-be-installed": { optional: true } },
        },
        null,
        2,
      ),
      "styles/tokens.css": ":root { --fixture-token: 1; }\n",
      "templates/record.template.jsonc": "{ // fixture\n  \"ok\": true\n}\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([
      { subpath: "./tokens.css", mode: "static", ok: true },
      { subpath: "./record.template.jsonc", mode: "static", ok: true },
    ]);
  });

  it("reports a clear finding when a declared static export was omitted from the tarball", async () => {
    const dir = makeFixture("missing-static-asset", {
      "package.json": JSON.stringify(
        {
          name: "missing-static-asset-fixture",
          version: "1.0.0",
          type: "module",
          exports: { "./tokens.css": "./styles/tokens.css" },
        },
        null,
        2,
      ),
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([
      {
        subpath: "./tokens.css",
        mode: "static",
        ok: false,
        error: 'static export target "./styles/tokens.css" is absent from the isolated installed tarball',
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-asset-missing");
    expect(result.findings[0]?.message).toContain("./tokens.css");
    expect(result.findings[0]?.message).toContain("./styles/tokens.css");
  });

  // Wildcard `exports` subpaths are standard Node syntax, and were previously
  // resolved as literal filesystem paths -- the verifier looked for a file
  // named `documents/*`, never found one, and reported a package that shipped
  // every promised file as missing its assets. This fired for real on an
  // already-published tarball: the publish itself succeeded and the isolated
  // install check that runs after it failed, which is the worst point in the
  // pipeline to discover a verifier defect.
  it("expands a static wildcard subpath against the files that actually shipped", async () => {
    const dir = makeFixture("wildcard-static", {
      "package.json": JSON.stringify(
        {
          name: "wildcard-static-fixture",
          version: "1.0.0",
          type: "module",
          exports: { "./documents/*": "./documents/*" },
          files: ["documents"],
        },
        null,
        2,
      ),
      "documents/first.txt": "# first\n",
      "documents/nested/second.txt": "# second\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    // The pattern itself, then one entry per file it expanded to -- under the
    // concrete subpath a consumer would actually write, not the pattern.
    expect(result.imports).toEqual([
      { subpath: "./documents/*", mode: "pattern", ok: true },
      { subpath: "./documents/first.txt", mode: "static", ok: true },
      { subpath: "./documents/nested/second.txt", mode: "static", ok: true },
    ]);
  });

  // An expanded runtime match is imported for real, through Node's own
  // resolver, from the isolated consumer -- so this also proves the expansion
  // produces subpaths a consumer can genuinely import, not just strings that
  // happen to name files. Its declaration pattern expands the same way.
  it("imports every executable match of a runtime wildcard subpath and expands its declaration pattern", async () => {
    const dir = makeFixture("wildcard-runtime", {
      "package.json": JSON.stringify(
        {
          name: "wildcard-runtime-fixture",
          version: "1.0.0",
          type: "module",
          exports: { "./adapters/*": { types: "./adapters/*.d.ts", import: "./adapters/*.js" } },
        },
        null,
        2,
      ),
      "adapters/one.js": "export const adapter = 'one';\n",
      "adapters/one.d.ts": "export declare const adapter: string;\n",
      "adapters/two.js": "export const adapter = 'two';\n",
      "adapters/two.d.ts": "export declare const adapter: string;\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.imports).toEqual([
      { subpath: "./adapters/*", mode: "pattern", ok: true },
      { subpath: "./adapters/one", mode: "import", ok: true },
      { subpath: "./adapters/two", mode: "import", ok: true },
    ]);
    expect(result.declarations).toEqual([
      { subpath: "./adapters/one", target: "./adapters/one.d.ts", ok: true },
      { subpath: "./adapters/two", target: "./adapters/two.d.ts", ok: true },
    ]);
  });

  // The other half of the fix: expanding a pattern must not become a way to
  // stop checking it. A wildcard that matches nothing exports nothing to a
  // consumer -- a real defect (a renamed directory, a `files` entry that
  // stopped shipping the contents), and it must still fail.
  it("fails for a wildcard subpath that matches nothing in the packed tarball", async () => {
    const dir = makeFixture("wildcard-unmatched", {
      "package.json": JSON.stringify(
        {
          name: "wildcard-unmatched-fixture",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./index.js", "./documents/*": "./documents/*" },
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
      // Deliberately no documents/ directory at all.
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([
      { subpath: ".", mode: "import", ok: true },
      {
        subpath: "./documents/*",
        mode: "pattern",
        ok: false,
        error: 'its target "./documents/*" matched no file in the isolated installed tarball',
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-pattern-unmatched");
    expect(result.findings[0]?.severity).toBe("error");
    expect(result.findings[0]?.message).toContain("./documents/*");
    expect(result.findings[0]?.message).toContain("exports nothing to a consumer");
  });

  // Node's resolver only ever selects a pattern key carrying exactly one `*`,
  // so a key with two is unreachable for every consumer. Expanding it must
  // report that, not quietly treat an unmatchable key as satisfied.
  it("fails for a wildcard key carrying more than one \"*\", which no consumer specifier can select", async () => {
    const dir = makeFixture("wildcard-two-stars", {
      "package.json": JSON.stringify(
        {
          name: "wildcard-two-stars-fixture",
          version: "1.0.0",
          type: "module",
          exports: { "./*/*": "./documents/*" },
        },
        null,
        2,
      ),
      "documents/first.txt": "# first\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([
      {
        subpath: "./*/*",
        mode: "pattern",
        ok: false,
        error:
          'the key declares more than one "*", and Node\'s resolver only ever selects a pattern key carrying exactly one',
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-pattern-unmatched");
  });

  it("fails when a declared TypeScript target was omitted even though its runtime export imports", async () => {
    const dir = makeFixture("missing-declaration", {
      "package.json": JSON.stringify(
        {
          name: "missing-declaration-fixture",
          version: "1.0.0",
          type: "module",
          exports: { ".": { types: "./dist/index.d.ts", import: "./index.js" } },
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([{ subpath: ".", mode: "import", ok: true }]);
    expect(result.declarations).toEqual([
      {
        subpath: ".",
        target: "./dist/index.d.ts",
        ok: false,
        error: 'declaration target "./dist/index.d.ts" is absent from the isolated installed tarball',
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-declaration-missing");
  });

  it("executes an explicitly advertised CommonJS branch as well as its ESM import branch", async () => {
    const dir = makeFixture("dual-module", {
      "package.json": JSON.stringify(
        {
          name: "dual-module-fixture",
          version: "1.0.0",
          type: "module",
          exports: { ".": { import: "./index.js", require: "./index.cjs" } },
        },
        null,
        2,
      ),
      "index.js": "export const format = 'esm';\n",
      "index.cjs": "module.exports = { format: 'cjs' };\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([
      { subpath: ".", mode: "import", ok: true },
      { subpath: ".", mode: "require", ok: true },
    ]);
  });

  it("installs declared runtime peers before importing executable exports", async () => {
    const dir = makeFixture("runtime-peer", {
      "package.json": JSON.stringify(
        {
          name: "runtime-peer-fixture",
          version: "1.0.0",
          type: "module",
          exports: "./index.js",
          peerDependencies: { "is-number": "^7.0.0" },
          // Optional prevents npm's initial local-tarball install from
          // satisfying it automatically; packRoundTrip must add it before
          // importing this runtime subpath.
          peerDependenciesMeta: { "is-number": { optional: true } },
        },
        null,
        2,
      ),
      "index.js": "import isNumber from 'is-number';\nexport const ok = isNumber(1);\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([{ subpath: ".", mode: "import", ok: true }]);
  });

  // Partial failure: one good subpath and one genuinely broken one. The
  // broken subpath must not hide the good one, and vice versa.
  it("reports a partial failure for a package with one good subpath and one broken subpath", async () => {
    const dir = makeFixture("partial-failure", {
      "package.json": JSON.stringify(
        {
          name: "partial-failure-fixture",
          version: "1.0.0",
          type: "module",
          exports: {
            ".": "./index.js",
            "./broken": "./broken.js",
          },
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
      "broken.js": "throw new Error('broken on purpose');\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.imports).toHaveLength(2);
    const good = result.imports.find((i) => i.subpath === ".");
    const broken = result.imports.find((i) => i.subpath === "./broken");
    expect(good).toEqual({ subpath: ".", mode: "import", ok: true });
    expect(broken?.ok).toBe(false);
    expect(broken?.error).toContain("broken on purpose");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-import-failed");
    expect(result.findings[0]?.message).toContain("./broken");
  });

  // Regression for defect 5: a manifest with no "name" field. npm pack
  // itself refuses to pack it, and the resulting finding must read as an
  // actual sentence, never the literal "undefined: npm pack failed...".
  it("reports a clean pack-failure finding for a manifest with no \"name\", not a literal 'undefined'", async () => {
    const dir = makeFixture("no-name", {
      "package.json": JSON.stringify(
        {
          version: "1.0.0",
          type: "module",
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    const result = await packRoundTrip(dir);

    expect(result.ok).toBe(false);
    expect(result.packageName).toBeUndefined();
    expect(result.tarballPath).toBe("");
    expect(result.imports).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-install-failed");
    expect(result.findings[0]?.message).not.toContain("undefined:");
    expect(result.findings[0]?.message).toContain("<unnamed package>");
  });

  it("throws for a directory with no package.json at all, as documented", async () => {
    const dir = mkdtempSync(join(tmpdir(), "release-fixture-no-manifest-"));
    fixtureDirs.push(dir);

    await expect(packRoundTrip(dir)).rejects.toThrow(/no package\.json/);
  });

  it("keeps the temporary pack directory when keepTempDir is true, and removes it by default", async () => {
    const dir = makeFixture("keep-temp-dir", {
      "package.json": JSON.stringify(
        { name: "keep-temp-dir-fixture", version: "1.0.0", type: "module", exports: "./index.js" },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    const kept = await packRoundTrip(dir, { keepTempDir: true });
    expect(kept.tarballPath).not.toBe("");
    expect(existsSync(kept.tarballPath)).toBe(true);
    // Clean up by hand since keepTempDir deliberately skipped it.
    rmSync(dirname(kept.tarballPath), { recursive: true, force: true });

    const cleaned = await packRoundTrip(dir);
    expect(cleaned.tarballPath).not.toBe("");
    expect(existsSync(cleaned.tarballPath)).toBe(false);
  });

  // Regression for defect 4: a subpath whose import never resolves must
  // time out with a clear finding, not hang the round trip forever. Uses the
  // configurable timeoutsMs override (see PackRoundTripOptions) so this test
  // takes milliseconds instead of the real default 30s import budget.
  it("reports a clear timeout finding for a subpath whose import never resolves", async () => {
    const dir = makeFixture("hangs-forever", {
      "package.json": JSON.stringify(
        { name: "hangs-forever-fixture", version: "1.0.0", type: "module", exports: "./index.js" },
        null,
        2,
      ),
      // A never-settling top-level await, PLUS a live timer to keep the
      // event loop open. A bare `await new Promise(() => {})` with nothing
      // else scheduled lets Node's "unsettled top-level await" detection
      // exit the process on its own once the event loop drains -- it would
      // not actually hang, and so would not exercise the timeout at all.
      // The live interval is what makes this a genuine hang.
      "index.js": "setInterval(() => {}, 1_000_000);\nawait new Promise(() => {});\n",
    });

    const result = await packRoundTrip(dir, { timeoutsMs: { import: 500 } });

    expect(result.ok).toBe(false);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]?.ok).toBe(false);
    expect(result.imports[0]?.error).toContain("timeout");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-import-failed");
    expect(result.findings[0]?.message).toContain("timeout");
  }, 20_000);
});

// `tarballPath` is the mechanism the publish workflow's reordering (see
// AGENTS.md / issue #191) depends on: it lets `packRoundTrip` check a tarball
// that was already packed once, instead of packing `packageDir` again. These
// tests pack a fixture EXACTLY the way the workflow's own "Pack tarball for
// publish" step does — a plain `npm pack --pack-destination <dir>` run
// entirely separately from the `packRoundTrip` call under test — and hand the
// resulting file to `tarballPath`, so what's actually being proven is the
// same thing the workflow's pre-publish gate proves: does checking THAT
// tarball block a broken release, and pass a valid one, before anything is
// published.
describe("packRoundTrip — tarballPath option (pre-publish gate proof)", () => {
  function packFixtureTarball(dir: string): string {
    const packDestination = mkdtempSync(join(tmpdir(), "release-fixture-packed-"));
    fixtureDirs.push(packDestination);
    const stdout = execFileSync("npm", ["pack", "--pack-destination", packDestination], {
      cwd: dir,
      encoding: "utf8",
    });
    const tarballName = stdout.trim().split("\n").filter(Boolean).pop();
    if (!tarballName) throw new Error("npm pack produced no output");
    return join(packDestination, tarballName);
  }

  // Acceptance criterion: "a package whose export map names a path absent
  // from its tarball fails the workflow with nothing reaching the registry."
  // This is the pre-publish gate itself -- a literal (non-wildcard) subpath
  // whose target was never shipped, checked the way the reordered workflow
  // step checks it: against an already-packed tarball, via `tarballPath`.
  it("blocks: a tarball whose export map names a path absent from it fails via tarballPath", async () => {
    const dir = makeFixture("tarballpath-broken", {
      "package.json": JSON.stringify(
        {
          name: "tarballpath-broken-fixture",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./index.js", "./missing-asset.txt": "./missing-asset.txt" },
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
      // Deliberately never created: "./missing-asset.txt" is declared but
      // nothing ships it, and nothing lists it in `files` either.
    });

    const tarballPath = packFixtureTarball(dir);
    const result = await packRoundTrip(dir, { tarballPath });

    expect(result.tarballPath).toBe(resolve(tarballPath));
    expect(result.ok).toBe(false);
    const missing = result.imports.find((check) => check.subpath === "./missing-asset.txt");
    expect(missing).toEqual({
      subpath: "./missing-asset.txt",
      mode: "static",
      ok: false,
      error: 'static export target "./missing-asset.txt" is absent from the isolated installed tarball',
    });
    expect(result.findings.some((f) => f.rule === "round-trip-asset-missing")).toBe(true);
    // The blocking mechanism itself: the reordered workflow step exits
    // non-zero on `!result.ok`, and GitHub Actions skips every subsequent
    // step (including `npm publish`) once one fails without `if: always()`
    // or `continue-on-error`. `ok: false` here is exactly the signal that
    // stops the job before the registry is ever touched.
  });

  // Acceptance criterion: "a fixture with a VALID wildcard export subpath
  // must pass, so the reordering cannot silently reintroduce the [false
  // positive] bug that #193 removed" -- checked here through the identical
  // tarballPath mechanism the pre-publish gate uses, not merely through a
  // fresh auto-pack (already covered separately above).
  it("passes: a tarball with a valid wildcard export subpath passes via tarballPath", async () => {
    const dir = makeFixture("tarballpath-valid-wildcard", {
      "package.json": JSON.stringify(
        {
          name: "tarballpath-valid-wildcard-fixture",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./index.js", "./documents/*": "./documents/*" },
          files: ["index.js", "documents"],
        },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
      "documents/first.txt": "# first\n",
      "documents/second.txt": "# second\n",
    });

    const tarballPath = packFixtureTarball(dir);
    const result = await packRoundTrip(dir, { tarballPath });

    expect(result.tarballPath).toBe(resolve(tarballPath));
    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([
      { subpath: ".", mode: "import", ok: true },
      { subpath: "./documents/*", mode: "pattern", ok: true },
      { subpath: "./documents/first.txt", mode: "static", ok: true },
      { subpath: "./documents/second.txt", mode: "static", ok: true },
    ]);
    expect(result.ok).toBe(true);
  });

  // `tarballPath` must actually be used, not silently ignored in favor of a
  // fresh re-pack of `packageDir` -- exactly the latent defect this option
  // fixes (see its doc comment on `PackRoundTripOptions`). Proven by packing
  // a GOOD tarball, then breaking the source on disk in a way a fresh pack
  // would visibly fail on, and confirming the round trip still passes: it
  // can only be checking the untouched, already-packed bytes.
  it("checks the supplied tarball's bytes, not a fresh re-pack of a since-broken source tree", async () => {
    const dir = makeFixture("tarballpath-honored", {
      "package.json": JSON.stringify(
        { name: "tarballpath-honored-fixture", version: "1.0.0", type: "module", exports: "./index.js" },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    const tarballPath = packFixtureTarball(dir);

    // Break the source tree AFTER packing: the export target no longer
    // exists on disk at all. A fresh `npm pack` from this directory would
    // still succeed (npm pack does not require listed files to exist) but
    // would ship nothing at "./index.js", so an import of it would fail.
    rmSync(join(dir, "index.js"));

    const result = await packRoundTrip(dir, { tarballPath });

    expect(result.tarballPath).toBe(resolve(tarballPath));
    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([{ subpath: ".", mode: "import", ok: true }]);
    expect(result.ok).toBe(true);
  });

  it("throws when tarballPath does not exist, since there is nothing meaningful to check", async () => {
    const dir = makeFixture("tarballpath-missing-file", {
      "package.json": JSON.stringify(
        { name: "tarballpath-missing-file-fixture", version: "1.0.0", type: "module", exports: "./index.js" },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    await expect(
      packRoundTrip(dir, { tarballPath: join(dir, "does-not-exist.tgz") }),
    ).rejects.toThrow(/tarballPath.*does not exist/);
  });
});

describe("subprocessEnv — subprocess environment sanitization (defect 3)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("never passes through credential- or registry-shaped variables, even when this process has them set", () => {
    process.env.NODE_AUTH_TOKEN = "fixture-token-value-should-never-appear";
    process.env.NPM_TOKEN = "fixture-npm-token-should-never-appear";
    process.env.npm_config_registry = "https://malicious-registry.invalid/";
    process.env.npm_config__authToken = "fixture-auth-should-never-appear";

    const env = subprocessEnv("/tmp/does-not-need-to-exist-for-this-check");

    expect(env.NODE_AUTH_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.npm_config__authToken).toBeUndefined();
    // The registry IS set by subprocessEnv -- deliberately overridden to the
    // public default, not inherited from this process's own override.
    expect(env.npm_config_registry).toBe("https://registry.npmjs.org/");
  });

  it("points npm_config_userconfig away from the real $HOME/.npmrc", () => {
    const isolationDir = "/tmp/release-env-test-isolation-dir";
    const env = subprocessEnv(isolationDir);

    expect(env.npm_config_userconfig).toBeDefined();
    expect(env.npm_config_userconfig).not.toBe(join(process.env.HOME ?? "", ".npmrc"));
    expect(env.npm_config_userconfig).toContain(isolationDir);
  });

  it("still passes through PATH and HOME, needed for npm/node themselves to run", () => {
    const env = subprocessEnv("/tmp/does-not-need-to-exist-for-this-check");

    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });

  it("uses an explicit caller-provided registry without inheriting the ambient registry", () => {
    process.env.npm_config_registry = "https://ambient-registry.invalid/";

    const env = subprocessEnv("/tmp/does-not-need-to-exist-for-this-check", "https://configured-registry.invalid/");

    expect(env.npm_config_registry).toBe("https://configured-registry.invalid/");
    expect(env.npm_config_registry).not.toBe(process.env.npm_config_registry);
    expect(env.NODE_AUTH_TOKEN).toBeUndefined();
  });
});
