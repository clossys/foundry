// Negative controls for the issue #893 gate.
//
// The fixture is a real, tiny npm workspace with a real build script, packed
// with real `npm pack`. It is not a mock: the stale case is produced the same
// way the real one is — a build output whose source is gone, which the build
// leaves behind and the pack then ships. `tsc` does exactly this and always
// has; the fixture's build script does it in two lines instead of two seconds.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ReproducibilityIndeterminate,
  ReproducibilityMismatch,
  assertTarballReproducible,
  buildOutputDirectories,
  cleanRebuildAndPack,
  packAsIs,
} from "./artifact-reproducibility.mjs";
import { RELEASE_RUNTIME, readReleaseRuntime } from "./release-runtime.mjs";

// A build that emits dist/ from src/ and, like tsc, never removes an output
// whose source has gone away.
const BUILD = `import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
for (const name of readdirSync("packages")) {
  const src = join("packages", name, "src");
  const dist = join("packages", name, "dist");
  mkdirSync(dist, { recursive: true });
  for (const file of readdirSync(src)) cpSync(join(src, file), join(dist, file));
}
`;

function workspace(t, { build = BUILD } = {}) {
  const root = mkdtempSync(join(tmpdir(), "artifact-reproducibility-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  mkdirSync(join(root, "packages", "demo", "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "reproducibility-fixture", version: "0.0.0", private: true, workspaces: ["packages/*"], scripts: { build: "node build.mjs" } }, null, 2)}\n`);
  writeFileSync(join(root, "build.mjs"), build);
  writeFileSync(join(root, "packages", "demo", "package.json"), `${JSON.stringify({ name: "@gate-fixture/demo", version: "0.0.1", files: ["dist"] }, null, 2)}\n`);
  writeFileSync(join(root, "packages", "demo", "src", "index.js"), "export const value = 1;\n");
  return root;
}

test("a clean rebuild packs the same bytes twice, so the comparison is a real measurement", (t) => {
  const root = workspace(t);
  const first = cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  const second = cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  assert.equal(first.sha256, second.sha256, "two clean rebuilds must pack identical bytes");
  assert.equal(first.sha1, second.sha1);
  assert.equal(first.sha512, second.sha512);
});

test("a tarball from a clean build is accepted", (t) => {
  const root = workspace(t);
  const clean = cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  const accepted = assertTarballReproducible({ root, packageDir: "packages/demo", expected: clean, requireReleaseRuntime: false });
  assert.equal(accepted.sha256, clean.sha256);
});

test("NEGATIVE CONTROL: a tarball packed from a stale dist/ is refused, and git cannot see why", (t) => {
  const root = workspace(t);

  // Build, then delete the source. The build leaves dist/gone.js behind — the
  // exact thing tsc does and the exact thing #893 is about.
  cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  writeFileSync(join(root, "packages", "demo", "src", "gone.js"), "export const gone = true;\n");
  cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  rmSync(join(root, "packages", "demo", "src", "gone.js"));
  // Rebuild WITHOUT cleaning, the way `npm run build` does on a developer machine.
  const stale = packAsIs({ root, packageDir: "packages/demo" });

  const clean = cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  assert.notEqual(stale.sha256, clean.sha256, "the fixture must actually produce a stale tarball, or this control proves nothing");

  assert.throws(
    () => assertTarballReproducible({ root, packageDir: "packages/demo", expected: stale, requireReleaseRuntime: false }),
    (error) => error instanceof ReproducibilityMismatch && /NOT what a clean build/.test(error.message) && error.message.includes(stale.sha256),
  );
});

test("a build that fails is INDETERMINATE, never a pass", (t) => {
  const root = workspace(t, { build: "process.exit(3);\n" });
  assert.throws(
    () => assertTarballReproducible({ root, packageDir: "packages/demo", expected: { sha1: "a", sha256: "b", sha512: "c" }, requireReleaseRuntime: false }),
    (error) => error instanceof ReproducibilityIndeterminate && /clean rebuild failed/.test(error.message),
  );
});

test("incomplete expected digests are INDETERMINATE rather than a vacuous match", (t) => {
  const root = workspace(t);
  assert.throws(
    () => assertTarballReproducible({ root, packageDir: "packages/demo", expected: { sha256: "b" }, requireReleaseRuntime: false }),
    (error) => error instanceof ReproducibilityIndeterminate && /missing sha1/.test(error.message),
  );
});

test("a package directory outside this checkout is INDETERMINATE", (t) => {
  const root = workspace(t);
  assert.throws(
    () => packAsIs({ root, packageDir: "../elsewhere" }),
    (error) => error instanceof ReproducibilityIndeterminate,
  );
});

test("build output discovery is confined to packages/<name>/dist", (t) => {
  const root = workspace(t);
  cleanRebuildAndPack({ root, packageDir: "packages/demo" });
  // Decoys planted AFTER the build: a repository-root dist/, a directory
  // whose name is not a package directory name, and a packages/ entry with no
  // manifest. None of them is a build output this gate may delete.
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "packages", "NotAPackage", "dist"), { recursive: true });
  mkdirSync(join(root, "packages", "no-manifest", "dist"), { recursive: true });
  assert.deepEqual(buildOutputDirectories(root), [join(root, "packages", "demo", "dist")]);
});

test("an external tarball may only be compared on the pinned release runtime", (t) => {
  const root = workspace(t);
  const observed = readReleaseRuntime();
  const pinned = Object.keys(RELEASE_RUNTIME).every((key) => observed[key] === RELEASE_RUNTIME[key]);
  if (pinned) {
    // On the pinned runtime the gate proceeds to the real measurement.
    const clean = cleanRebuildAndPack({ root, packageDir: "packages/demo" });
    assert.equal(assertTarballReproducible({ root, packageDir: "packages/demo", expected: clean }).sha256, clean.sha256);
    return;
  }
  assert.throws(
    () => assertTarballReproducible({ root, packageDir: "packages/demo", expected: { sha1: "a", sha256: "b", sha512: "c" } }),
    (error) => error instanceof ReproducibilityIndeterminate && /release qualification requires Node/.test(error.message),
    "off the pinned runtime a gzip comparison measures the runtime, and must be reported as indeterminate rather than as a mismatch",
  );
});
