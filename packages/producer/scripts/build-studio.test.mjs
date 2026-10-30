import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageStandalone } from "./build-studio.mjs";

async function fixture(t, relativeAppDir = "packages/producer/studio") {
  const root = await mkdtemp(join(tmpdir(), "studio package "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "studio");
  const build = join(app, ".next");
  const standalone = join(build, "standalone");
  const output = join(root, "dist", "studio");
  const put = async (path, value) => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, value);
  };
  await put(join(build, "required-server-files.json"), JSON.stringify({ config: { output: "standalone" }, relativeAppDir }));
  await put(join(standalone, relativeAppDir, "server.js"), "// Next standalone server fixture\n");
  await put(join(standalone, "node_modules", "dependency", "index.js"), "export {};\n");
  await put(join(build, "static", "chunk.js"), "// static asset\n");
  return { app, build, standalone, output, put };
}

test("preserves nested standalone layout, assets, public files and dependency links", async (t) => {
  const f = await fixture(t);
  await f.put(join(f.app, "public", "logo.svg"), "<svg/>\n");
  await symlink("dependency", join(f.standalone, "node_modules", "alias"));
  const manifest = await packageStandalone(f.app, f.output);
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    serverEntry: "packages/producer/studio/server.js",
    staticDir: "packages/producer/studio/.next/static",
    publicDir: "packages/producer/studio/public",
  });
  assert.equal(await readFile(join(f.output, manifest.staticDir, "chunk.js"), "utf8"), "// static asset\n");
  assert.equal(await readFile(join(f.output, manifest.publicDir, "logo.svg"), "utf8"), "<svg/>\n");
  assert.equal(await readlink(join(f.output, "node_modules", "alias")), "dependency");
  assert.deepEqual(JSON.parse(await readFile(join(f.output, "manifest.json"), "utf8")), manifest);
});

test("supports an app-root standalone entry and replaces stale output repeatably", async (t) => {
  const f = await fixture(t, "");
  const first = await packageStandalone(f.app, f.output);
  await f.put(join(f.output, "stale.js"), "old output");
  const second = await packageStandalone(f.app, f.output);
  assert.deepEqual(second, first);
  assert.equal(second.serverEntry, "server.js");
  assert.equal(second.publicDir, null);
  await assert.rejects(lstat(join(f.output, "stale.js")), { code: "ENOENT" });
});

test("missing real output fails before replacing an existing artifact", async (t) => {
  const f = await fixture(t);
  await f.put(join(f.output, "keep.txt"), "previous artifact");
  await rm(join(f.build, "static"), { recursive: true });
  await assert.rejects(packageStandalone(f.app, f.output), /missing .next\/static/);
  assert.equal(await readFile(join(f.output, "keep.txt"), "utf8"), "previous artifact");
  await rm(join(f.standalone, "packages", "producer", "studio", "server.js"));
  await assert.rejects(packageStandalone(f.app, f.output), /missing the Studio server.js/);
});

test("refuses escaping entries and deletion outside the dedicated output", async (t) => {
  const f = await fixture(t);
  await assert.rejects(packageStandalone(f.app, join(f.output, "..")), /package's dist\/studio/);
  await f.put(join(f.build, "required-server-files.json"), JSON.stringify({ config: { output: "standalone" }, relativeAppDir: "../outside" }));
  await assert.rejects(packageStandalone(f.app, f.output), /escapes the standalone directory/);
});

test("refuses a symlinked output parent", async (t) => {
  const f = await fixture(t);
  const other = join(f.app, "other");
  await mkdir(other);
  await symlink(other, join(f.output, ".."));
  await assert.rejects(packageStandalone(f.app, f.output), /symbolic link/);
  assert.equal((await lstat(other)).isDirectory(), true);
});

test("CLI help works from a consumer directory containing spaces", async (t) => {
  const f = await fixture(t);
  const script = fileURLToPath(new URL("./build-studio.mjs", import.meta.url));
  const help = execFileSync(process.execPath, [script, "--help"], { cwd: f.app, encoding: "utf8" });
  assert.match(help, /Build the Studio Next app/);
});


test("standalone launcher runs inside an ESM Producer package", async (t) => {
  const f = await fixture(t);
  await f.put(join(f.app, "..", "package.json"), JSON.stringify({ type: "module" }));
  await f.put(join(f.standalone, "packages/producer/studio/server.js"), "console.log(typeof require('node:path').join);\n");
  const manifest = await packageStandalone(f.app, f.output);
  const result = execFileSync(process.execPath, [join(f.output, manifest.serverEntry)], { encoding: "utf8" });
  assert.equal(result.trim(), "function");
  assert.deepEqual(JSON.parse(await readFile(join(f.output, "packages/producer/studio/package.json"), "utf8")), { private: true, type: "commonjs" });
});
