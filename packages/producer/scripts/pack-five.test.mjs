import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { packTargets, assertPackSet, artifactRecord, artifactManifest, snapshot } = await import(
  process.env.PACK_TEST_MODULE ? pathToFileURL(resolve(process.env.PACK_TEST_MODULE)).href : "./pack-five.mjs"
);
const mapped = ["director", "designer", "writer", "publisher"].map((role) => ({ role, root: role }));
const studio = { status: "built", serverEntry: "server.js" };
const source = { head: "a".repeat(40), tree: "b".repeat(40), dirty: false, digest: "c".repeat(64) };

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "producer-pack-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("native target set includes the Controller workspace and all five existing roles", () => {
  const root = resolve("fixture");
  const targets = packTargets(mapped, root);
  assert.deepEqual(targets.map(({ role }) => role).sort(), ["controller", "designer", "director", "producer", "publisher", "writer"]);
  assert.equal(targets.find(({ role }) => role === "controller").root, join(root, "packages/controller"));
  assert.throws(() => assertPackSet(targets.filter(({ role }) => role !== "controller")), /each role once/);
  assert.throws(() => assertPackSet([...targets, targets[0]]), /each role once/);
});

test("manifest retains summary identity and exposes consumer artifact paths and both strong hashes", (t) => {
  const root = temporary(t);
  const file = join(root, "fixture.tgz");
  const bytes = Buffer.from("artifact bytes for metadata testing only");
  writeFileSync(file, bytes);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const packages = packTargets(mapped, root).map(({ role }) => artifactRecord({ role, name: role, filename: "fixture.tgz", integrity }, file, file));
  const manifest = artifactManifest(source, packages, studio);
  assert.equal(manifest.head, source.head);
  assert.equal(manifest.tree, source.tree);
  assert.deepEqual(manifest.source, source);
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.studio, studio);
  assert.throws(() => artifactManifest({ ...source, dirty: true }, packages, studio), /clean source/);
  assert.throws(() => artifactManifest(source, packages, { status: "missing-source" }), /completed Studio/);
  for (const item of manifest.artifacts) {
    assert.equal(item.path, file);
    assert.equal(item.bytes, bytes.length);
    assert.equal(item.sha256, createHash("sha256").update(readFileSync(item.path)).digest("hex"));
    assert.equal(item.sha512, createHash("sha512").update(bytes).digest("hex"));
  }
  assert.throws(() => artifactManifest({ ...source, tree: undefined }, packages, studio), /head and tree/);
  assert.throws(() => artifactManifest(source, packages.filter(({ role }) => role !== "controller"), studio), /each role once/);
  writeFileSync(file, "tampered bytes");
  assert.throws(() => artifactRecord({ filename: "fixture.tgz", integrity }, file, file), /integrity mismatch/);
});

test("snapshot binds HEAD to the measured Git tree and retains dirty source detection", (t) => {
  const root = temporary(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  const commit = () => {
    git("add", "data.txt");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture");
  };
  writeFileSync(join(root, "data.txt"), "original");
  commit();
  const first = snapshot(root);
  assert.equal(first.head, git("rev-parse", "HEAD"));
  assert.equal(first.tree, git("rev-parse", "HEAD^{tree}"));
  assert.equal(first.dirty, false);
  writeFileSync(join(root, "data.txt"), "changed");
  const dirty = snapshot(root);
  assert.equal(dirty.tree, first.tree);
  assert.equal(dirty.dirty, true);
  assert.notEqual(dirty.digest, first.digest);
  commit();
  const second = snapshot(root);
  assert.equal(second.tree, git("rev-parse", "HEAD^{tree}"));
  assert.notEqual(second.tree, first.tree);
  assert.notEqual(second.digest, first.digest);
  assert.equal(second.dirty, false);
});
