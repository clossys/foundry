// R2F-23: a package's declared test-import closure refuses the test run, by
// name, while any file in it is missing -- never a silent skip.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import setup, { DIST_CLOSURE_FILE, assertDistClosure, missingDistClosure } from "./vitest-build-package.mjs";

const setupModule = fileURLToPath(new URL("./vitest-build-package.mjs", import.meta.url));

function fixture(requires) {
  const root = mkdtempSync(join(tmpdir(), "dist-closure-"));
  const packageRoot = join(root, "packages", "consumer");
  mkdirSync(packageRoot, { recursive: true });
  if (requires !== undefined) writeFileSync(join(packageRoot, DIST_CLOSURE_FILE), JSON.stringify({ requires }));
  return { root, packageRoot };
}

function built(root, path) {
  mkdirSync(resolve(root, path, ".."), { recursive: true });
  writeFileSync(resolve(root, path), "export {};\n");
}

test("a package with no declaration has no closure to check", () => {
  const { root, packageRoot } = fixture(undefined);
  assert.deepEqual(missingDistClosure(packageRoot, root), []);
  assert.doesNotThrow(() => assertDistClosure(packageRoot, root));
});

test("a fully built closure starts the run", () => {
  const { root, packageRoot } = fixture([{ path: "packages/writer/dist/index.js", builtBy: "@clossys/writer" }]);
  built(root, "packages/writer/dist/index.js");
  assert.doesNotThrow(() => assertDistClosure(packageRoot, root));
});

test("one missing dist refuses the run and names that file and its producing workspace", () => {
  const { root, packageRoot } = fixture([
    { path: "packages/writer/dist/index.js", builtBy: "@clossys/writer" },
    { path: "packages/writer/src/generated/contract-schema.generated.ts", builtBy: "@clossys/writer", importedAs: "packages/writer/src/plan-authority.ts" },
  ]);
  built(root, "packages/writer/dist/index.js");
  assert.deepEqual(missingDistClosure(packageRoot, root).map((entry) => entry.path), ["packages/writer/src/generated/contract-schema.generated.ts"]);
  assert.throws(() => assertDistClosure(packageRoot, root), (error) => {
    assert.match(error.message, /refusing to start the tests \(1 missing\)/);
    assert.match(error.message, /missing packages\/writer\/src\/generated\/contract-schema\.generated\.ts \(built by @clossys\/writer; imported as packages\/writer\/src\/plan-authority\.ts\)/);
    assert.doesNotMatch(error.message, /missing packages\/writer\/dist\/index\.js/);
    assert.match(error.message, /npm run build/);
    return true;
  });
});

test("an empty or malformed declaration is refused, not treated as no closure", () => {
  const empty = fixture([]);
  assert.throws(() => missingDistClosure(empty.packageRoot, empty.root), /declares no "requires" entries/);
  const malformed = fixture([{ path: "packages/writer/dist/index.js" }]);
  assert.throws(() => missingDistClosure(malformed.packageRoot, malformed.root), /needs a string "path" and "builtBy"/);
});

test("the --check-closure entry exits non-zero naming the missing dist", () => {
  const { packageRoot } = fixture([{ path: join(tmpdir(), "absent-closure", "producer", "dist", "records", "slots.js"), builtBy: "@clossys/producer" }]);
  const run = spawnSync(process.execPath, [setupModule, "--check-closure", packageRoot], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /missing .*producer\/dist\/records\/slots\.js \(built by @clossys\/producer\)/);
  const ok = fixture(undefined);
  assert.equal(spawnSync(process.execPath, [setupModule, "--check-closure", ok.packageRoot], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [setupModule], { encoding: "utf8" }).status, 2);
});

test("the vitest globalSetup refuses before it builds anything", () => {
  const { packageRoot } = fixture([{ path: join(tmpdir(), "absent-closure", "writer", "dist", "locale.js"), builtBy: "@clossys/writer" }]);
  // No tsconfig.json in the fixture: reaching the build step would fail differently.
  assert.throws(() => setup({ config: { root: packageRoot } }), /refusing to start the tests \(1 missing\):\n {2}- missing .*writer\/dist\/locale\.js \(built by @clossys\/writer\)/);
});
