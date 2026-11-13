// The incremental build skips work only when its inputs are unchanged, and never changes the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { incrementalBuildScript } from "./build-workspaces.mjs";
import { cacheDirFor } from "./tsc-incremental.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
mkdirSync(join(root, "node_modules/.cache/tmp"), { recursive: true });
const scratch = mkdtempSync(join(root, "node_modules/.cache/tmp/build-incremental-test-"));
const tscIncremental = join(here, "tsc-incremental.mjs");
const boundaryCached = join(here, "check-client-boundary-cached.mjs");

function listing(dir) {
  const out = {};
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function tsPackage(name) {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@fixture/${name}`, version: "1.0.0", type: "module" }));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", declaration: true, declarationMap: true, sourceMap: true, strict: true, skipLibCheck: true, types: [], outDir: "./dist", rootDir: "./src" }, include: ["src/**/*"] }));
  writeFileSync(join(dir, "src/a.ts"), 'import { b } from "./b.js";\nexport const a = (): number => b + 1;\n');
  writeFileSync(join(dir, "src/b.ts"), "export const b: number = 1;\n");
  writeFileSync(join(dir, "src/c.ts"), "export const c = 'c';\n");
  return dir;
}
const incremental = (dir, ...args) => spawnSync(process.execPath, [tscIncremental, ...args], { cwd: dir, encoding: "utf8" });
const mtime = (file) => statSync(file).mtimeMs;

test("tsc-incremental emits exactly what plain tsc emits, then re-emits only what changed", () => {
  const dir = tsPackage("incremental-identity");
  const plain = spawnSync(process.execPath, [createRequire(join(dir, "package.json")).resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], { cwd: dir, encoding: "utf8" });
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  const expected = listing(join(dir, "dist"));
  rmSync(join(dir, "dist"), { recursive: true });

  const first = incremental(dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(listing(join(dir, "dist")), expected, "incremental output is byte-identical to plain tsc");

  const before = mtime(join(dir, "dist/c.js"));
  const again = incremental(dir);
  assert.equal(again.status, 0);
  assert.equal(mtime(join(dir, "dist/c.js")), before, "a no-change run writes nothing");

  writeFileSync(join(dir, "src/c.ts"), "export const c = 'see';\n");
  assert.equal(incremental(dir).status, 0);
  assert.match(readFileSync(join(dir, "dist/c.js"), "utf8"), /see/);
  rmSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "src/c.ts"), "export const c = 'c';\n");
  assert.equal(incremental(dir).status, 0);
  assert.deepEqual(listing(join(dir, "dist")), expected, "a deleted dist/ is rebuilt in full, not trusted to the build info");
});

test("tsc-incremental still fails on a type error in a dependency of an unchanged file, and keeps failing until fixed", () => {
  const dir = tsPackage("incremental-mutation");
  assert.equal(incremental(dir).status, 0);
  writeFileSync(join(dir, "src/b.ts"), "export const b: string = 'one';\n"); // a.ts now returns string + 1 as number
  const broken = incremental(dir);
  assert.notEqual(broken.status, 0, "the changed declaration's dependent is re-checked");
  assert.match(broken.stdout + broken.stderr, /a\.ts.*error TS2322/s);
  assert.notEqual(incremental(dir).status, 0, "an unfixed error fails every run");
  assert.equal(existsSync(join(cacheDirFor(root, "@fixture/incremental-mutation"), "tsbuildinfo")), false, "a failed run leaves no build info behind");
  writeFileSync(join(dir, "src/b.ts"), "export const b: number = 1;\n");
  assert.equal(incremental(dir).status, 0);
});

test("tsc-incremental rebuilds when an emitted file was edited, and --force always rebuilds", () => {
  const dir = tsPackage("incremental-tamper");
  assert.equal(incremental(dir).status, 0);
  const good = readFileSync(join(dir, "dist/c.js"), "utf8");
  writeFileSync(join(dir, "dist/c.js"), "tampered\n");
  assert.equal(incremental(dir).status, 0);
  assert.equal(readFileSync(join(dir, "dist/c.js"), "utf8"), good);
  const before = mtime(join(dir, "dist/c.js"));
  assert.equal(incremental(dir, "--force").status, 0);
  assert.ok(mtime(join(dir, "dist/c.js")) >= before);
  assert.equal(readFileSync(join(dir, "dist/c.js"), "utf8"), good);
});

function boundaryPackage(name, files) {
  const dir = join(scratch, name, "node_modules/@fixture/publisher");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@fixture/publisher", version: "1.0.0", type: "module", exports: { "./web": { import: "./web.js" } } }));
  for (const [file, contents] of Object.entries(files)) writeFileSync(join(dir, file), contents);
  return dir;
}
const cached = (dir, ...args) => spawnSync(process.execPath, [boundaryCached, dir, "--report", join(dir, "report.json"), ...args], { encoding: "utf8" });

test("the cached client-boundary gate skips only an unchanged passing graph and still catches a violation", () => {
  const dir = boundaryPackage("boundary-cache", { "web.js": 'export { value } from "./pure.js";\n', "pure.js": "export const value = 1;\n" });
  const first = cached(dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.doesNotMatch(first.stdout, /not re-run/);
  assert.ok(existsSync(join(dir, "report.stamp.json")));

  const second = cached(dir);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /check not re-run/, "identical inputs reuse the PASS");

  writeFileSync(join(dir, "pure.js"), 'import "node:fs";\nexport const value = 1;\n');
  const violation = cached(dir);
  assert.equal(violation.status, 1, violation.stdout + violation.stderr);
  assert.match(violation.stderr, /node:fs/);
  assert.equal(existsSync(join(dir, "report.stamp.json")), false, "a FAIL leaves no stamp");
  assert.equal(cached(dir).status, 1, "and the next run checks again");

  writeFileSync(join(dir, "pure.js"), "export const value = 1;\n");
  assert.equal(cached(dir).status, 0);
  writeFileSync(join(dir, "sibling.js"), "export const shadow = 1;\n");
  assert.doesNotMatch(cached(dir).stdout, /not re-run/, "a new file beside an input re-runs the check");
  const forced = cached(dir, "--force");
  assert.equal(forced.status, 0);
  assert.doesNotMatch(forced.stdout, /not re-run/, "--force always re-runs the check");
});

test("only exact tsc and client-boundary steps are rewritten; everything else runs as written", () => {
  const manifest = (build, extra = {}) => ({ name: "@x/p", scripts: { build, ...extra } });
  assert.equal(incrementalBuildScript(manifest("tsc -p tsconfig.json"), "/r"), 'node "/r/scripts/tsc-incremental.mjs"');
  assert.equal(incrementalBuildScript(manifest("node scripts/pack.mjs && tsc -p tsconfig.json && node scripts/after.mjs"), "/r"), 'node scripts/pack.mjs && node "/r/scripts/tsc-incremental.mjs" && node scripts/after.mjs');
  assert.equal(
    incrementalBuildScript(manifest("tsc -p tsconfig.json && npm run check:client-boundary", { "check:client-boundary": "node ../../scripts/check-client-boundary.mjs . --report ../../r.json" }), "/r"),
    'node "/r/scripts/tsc-incremental.mjs" && node "/r/scripts/check-client-boundary-cached.mjs" . --report ../../r.json',
  );
  assert.equal(incrementalBuildScript(manifest("npm run check:client-boundary", { "check:client-boundary": "node other.mjs" }), "/r"), null);
  assert.equal(incrementalBuildScript(manifest("tsc -p tsconfig.build.json"), "/r"), null);
  assert.equal(incrementalBuildScript(manifest("tsc -p tsconfig.json || true"), "/r"), null);
  assert.equal(incrementalBuildScript(manifest("tsc -p tsconfig.json; node x.mjs"), "/r"), null);
  assert.equal(incrementalBuildScript({ name: "@x/none", scripts: {} }, "/r"), null);
});

test.after(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const name of ["incremental-identity", "incremental-mutation", "incremental-tamper"]) rmSync(cacheDirFor(root, `@fixture/${name}`), { recursive: true, force: true });
});
