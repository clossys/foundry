import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("packRoundTrip — real subprocess round trip", () => {
  it("packages/policy installs and imports cleanly from a genuinely isolated directory", async () => {
    const result = await packRoundTrip(join(repoRoot, "packages", "policy"));

    expect(result.packageName).toBe("@vespeneventures/policy");
    expect(result.tarballPath).not.toBe("");
    expect(result.findings).toEqual([]);
    expect(result.imports.length).toBeGreaterThan(0);
    for (const check of result.imports) {
      expect(check.ok).toBe(true);
      expect(check.error).toBeUndefined();
    }
    expect(result.ok).toBe(true);
  });

  it("packages/comms installs both its root and Resend exports from a genuinely isolated directory", async () => {
    const result = await packRoundTrip(join(repoRoot, "packages", "comms"));

    expect(result.packageName).toBe("@vespeneventures/comms");
    expect(result.tarballPath).not.toBe("");
    expect(result.findings).toEqual([]);
    expect(result.imports).toEqual([
      { subpath: ".", ok: true },
      { subpath: "./resend", ok: true },
    ]);
    expect(result.ok).toBe(true);
  });

  // EXPECTED AND CORRECT, given this repository's real state today — not a
  // bug in @vespeneventures/gates and not a bug in this test.
  //
  // @vespeneventures/gates declares two real npm dependencies with semver
  // ranges — @vespeneventures/catalog, @vespeneventures/policy — in its own
  // package.json. None of the packages in this small foundation has ever
  // been published to any registry. Installing gates' packed tarball into a
  // directory with no workspace file and no sibling node_modules to fall
  // back on means npm has nowhere at all it can resolve those two names
  // from, so the install has to fail.
  //
  // That failure is exactly the gap this whole package exists to surface: a
  // declared dependency and a clean catalog both describe SHAPE — neither
  // proves installability. Proving installability needs a real publish
  // first. Until gates' own runtime dependencies are published, this
  // assertion is the honest, current state of this repository. Do not
  // weaken this into a skip or a workaround; the failure itself is the point.
  it("packages/gates currently fails to install in isolation — its internal dependencies are unpublished", async () => {
    const result = await packRoundTrip(join(repoRoot, "packages", "gates"));

    expect(result.ok).toBe(false);
    expect(result.packageName).toBe("@vespeneventures/gates");
    expect(result.imports).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("round-trip-install-failed");
    expect(result.findings[0]?.severity).toBe("error");
    expect(result.findings[0]?.message).toContain("@vespeneventures/gates");

    // Environment-isolation regression (defect 3): this machine's real
    // ~/.npmrc carries a registry auth token for registry.npmjs.org, and npm
    // resolves unscoped-registry lookups through it by default. If this
    // round trip's subprocesses inherited the operator's full environment
    // and user npmrc, npm would still resolve the registry itself the same
    // way (npm's default registry, absent a scope mapping for
    // @vespeneventures) -- so the only observable difference isolation makes
    // here is which registry host actually gets contacted at all. Asserting
    // it is the public default, and never the operator's GitHub Packages
    // registry, is a direct, real check that the sanitized environment (see
    // `subprocessEnv`) is actually the one in effect for a real subprocess,
    // not just for a value that never gets used.
    expect(result.findings[0]?.message).toContain("registry.npmjs.org");
    expect(result.findings[0]?.message).not.toContain("npm.pkg.github.com");
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

describe("packRoundTrip — exports shape handling (fixture packages)", () => {
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
    expect(result.imports).toEqual([{ subpath: ".", ok: true }]);
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
    expect(result.imports).toEqual([{ subpath: ".", ok: true }]);
    expect(result.ok).toBe(true);
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
    expect(good).toEqual({ subpath: ".", ok: true });
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

  it("installs and imports a caller-supplied tarball without packing the source again", async () => {
    const dir = makeFixture("exact-tarball", {
      "package.json": JSON.stringify(
        {
          name: "exact-tarball-fixture",
          version: "1.0.0",
          type: "module",
          exports: "./index.js",
        },
        null,
        2,
      ),
      "index.js": "export const artifact = 'exact';\n",
    });
    const tarballDir = mkdtempSync(join(tmpdir(), "release-exact-tarball-"));
    fixtureDirs.push(tarballDir);
    const stdout = execFileSync("npm", ["pack", "--pack-destination", tarballDir], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tarballName = stdout.trim().split("\n").filter(Boolean).pop();
    expect(tarballName).toBeDefined();
    const tarballPath = join(tarballDir, tarballName as string);
    writeFileSync(join(dir, "index.js"), "throw new Error('source changed after packing');\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "exact-tarball-fixture",
      version: "1.0.0",
      type: "module",
      exports: {},
    }, null, 2));

    const result = await packRoundTrip(dir, { tarballPath });

    expect(result.ok).toBe(true);
    expect(result.tarballPath).toBe(tarballPath);
    expect(result.imports).toEqual([{ subpath: ".", ok: true }]);
  });

  it("reports a missing caller-supplied tarball without attempting an install", async () => {
    const dir = makeFixture("missing-exact-tarball", {
      "package.json": JSON.stringify(
        { name: "missing-exact-tarball-fixture", version: "1.0.0", type: "module", exports: "./index.js" },
        null,
        2,
      ),
      "index.js": "export const ok = true;\n",
    });

    const result = await packRoundTrip(dir, { tarballPath: join(dir, "missing.tgz") });

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([]);
    expect(result.findings).toEqual([expect.objectContaining({
      rule: "round-trip-tarball-missing",
      severity: "error",
    })]);
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

  it("uses only explicit private-registry credentials when the caller supplies them", () => {
    const env = subprocessEnv("/tmp/release-private-registry-proof", {
      url: "https://registry.example.test/",
      authToken: "explicit-test-token",
    });

    expect(env.npm_config_registry).toBe("https://registry.example.test/");
    expect(env.NODE_AUTH_TOKEN).toBe("explicit-test-token");
    expect(env.npm_config_userconfig).toContain("release-private-registry-proof");
  });

  it("still passes through PATH and HOME, needed for npm/node themselves to run", () => {
    const env = subprocessEnv("/tmp/does-not-need-to-exist-for-this-check");

    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });
});
