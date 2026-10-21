// Tests for scripts/overlay-manifest.mjs — the digest manifest published
// beside the rolling overlay prerelease (see docs/releasing/overlay.md).
//
// Rules under test, each with a mutation that must make at least one test
// here fail:
//   1. Two packed trees with the same content produce the same tree digest
//      and the same manifest bytes, whatever their mtimes or tarball bytes.
//   2. Changing, adding or renaming one file flips the tree digest.
//   3. The tarball hash is recorded, but change detection ignores it: only
//      the unpacked-tree digest and the pending changeset names count.
//   4. A missing package — absent tarball, or absent manifest entry — fails
//      closed instead of producing a partial manifest.
//   5. The manifest names the commit it was built from and that commit's
//      committedAt (ISO 8601 UTC, from the commit, never the wall clock);
//      a missing or malformed field fails closed.
//   6. Each package entry carries name, version and the tarball integrity
//      as an SRI `sha512-<base64>` string recomputable from the tarball;
//      a missing integrity or any other algorithm fails closed.
//   7. A run only mutates the rolling release when its commit is the
//      current tip of main AND is not older than the commit the published
//      manifest names (committedAt and ancestry); a stale run is skipped
//      with a reason, and malformed input fails closed.
//   8. The bytes the publish job uploads are exactly the bytes the scan job
//      scanned: the scanned sha256 of every file is checked, and an extra,
//      missing or changed file fails closed.
//   9. A package marked private (in its source or its packed package.json)
//      fails closed: check-artifact-safety skips private packages without
//      scanning them, so the overlay must never publish one.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OVERLAY_FILES,
  OVERLAY_PACKAGES,
  assertOverlayPackagesPublic,
  assertScannedDigests,
  buildOverlayManifest,
  overlayChangeKey,
  overlayChanged,
  overlayPublishDecision,
  pendingChangesetNames,
  scannedDigests,
  treeDigest,
  validateOverlayManifest,
  verifyOverlayRelease,
} from "./overlay-manifest.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "overlay-manifest.mjs");

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "overlay-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Write a package tree shaped like an extracted npm tarball (package/...).
function writeTree(root, files, { mtime } = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, "package", rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    if (mtime !== undefined) utimesSync(full, mtime, mtime);
  }
  return join(root, "package");
}

function packageFiles(dir, extra = {}) {
  return {
    "package.json": JSON.stringify({ name: `@example/${dir}`, version: "1.2.3" }),
    "README.md": `# ${dir}\n`,
    "LICENSE": "MIT\n",
    "dist/index.js": `export const name = "${dir}";\n`,
    ...extra,
  };
}

// Pack a tree into <out>/<dir>.tgz. `level` changes the gzip bytes without
// changing the tree, which is exactly the case rule 3 is about.
function packTree(treeRoot, out, dir, level = 6) {
  const tarPath = join(out, `${dir}.tar`);
  execFileSync("tar", ["-cf", tarPath, "-C", treeRoot, "package"]);
  const gz = execFileSync("gzip", [`-${level}`, "-n", "-c", tarPath]);
  rmSync(tarPath);
  writeFileSync(join(out, `${dir}.tgz`), gz);
  return join(out, `${dir}.tgz`);
}

function packedSet(t, { extra = {}, level = 6, omit = [], mtime } = {}) {
  const root = scratch(t);
  const out = join(root, "packed");
  mkdirSync(out);
  for (const dir of OVERLAY_PACKAGES) {
    if (omit.includes(dir)) continue;
    const treeRoot = join(root, "tree", dir);
    writeTree(treeRoot, packageFiles(dir, extra[dir] ?? {}), { mtime });
    packTree(treeRoot, out, dir, level);
  }
  return out;
}

function changesetDir(t, names) {
  const root = scratch(t);
  const dir = join(root, ".changesets");
  mkdirSync(dir);
  writeFileSync(join(dir, "README.md"), "# Changesets\n");
  for (const name of names) writeFileSync(join(dir, name), "---\ndesigner: patch\n---\n\nA change.\n");
  return dir;
}

// A packages/ root whose manifests match the packed fixtures' identity.
function packagesRoot(t, version = "1.2.3", extra = {}) {
  const root = scratch(t);
  for (const dir of OVERLAY_PACKAGES) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name: `@example/${dir}`, version, ...(extra[dir] ?? {}) }));
  }
  return root;
}

const COMMIT = "a".repeat(40);
const COMMITTED_AT = "2026-10-20T12:34:56Z";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sri512 = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

test("the overlay set is exactly designer and publisher", () => {
  assert.deepEqual([...OVERLAY_PACKAGES], ["designer", "publisher"]);
});

test("rule 1: identical trees give identical digests regardless of mtime", (t) => {
  const a = writeTree(join(scratch(t), "a"), packageFiles("designer"), { mtime: 1_000_000 });
  const b = writeTree(join(scratch(t), "b"), packageFiles("designer"), { mtime: 2_000_000 });
  const digestA = treeDigest(a);
  assert.match(digestA.digest, /^[a-f0-9]{64}$/);
  assert.equal(digestA.digest, treeDigest(b).digest);
  assert.equal(digestA.files, 4);
});

test("rule 1: two packed sets of the same trees agree on every tree digest and the change key", (t) => {
  const changesets = changesetDir(t, ["b-change.md", "a-change.md"]);
  const firstDir = packedSet(t, { mtime: 1_000_000 });
  const first = buildOverlayManifest({ packedDir: firstDir, changesetsDir: changesets, commit: COMMIT, committedAt: COMMITTED_AT });
  const second = buildOverlayManifest({ packedDir: packedSet(t, { mtime: 3_000_000 }), changesetsDir: changesets, commit: COMMIT, committedAt: COMMITTED_AT });
  // The tar headers carry the mtimes, so the tarball bytes differ; the trees do not.
  assert.notEqual(first.packages.designer.tarballSha256, second.packages.designer.tarballSha256);
  for (const dir of OVERLAY_PACKAGES) assert.equal(first.packages[dir].treeDigest, second.packages[dir].treeDigest);
  assert.equal(overlayChangeKey(first), overlayChangeKey(second));
  // Building again from the same packed bytes is byte-identical: no clock, no randomness.
  const again = buildOverlayManifest({ packedDir: firstDir, changesetsDir: changesets, commit: COMMIT, committedAt: COMMITTED_AT });
  assert.equal(JSON.stringify(again), JSON.stringify(first));
  assert.deepEqual(first.pendingChangesets, ["a-change.md", "b-change.md"]);
  assert.deepEqual(Object.keys(first.packages), ["designer", "publisher"]);
  assert.equal(first.packages.designer.name, "@example/designer");
  assert.equal(first.packages.designer.version, "1.2.3");
});

test("rule 2: a changed, added or renamed file flips the tree digest", (t) => {
  const base = treeDigest(writeTree(join(scratch(t), "base"), packageFiles("designer"))).digest;
  const changed = treeDigest(writeTree(join(scratch(t), "changed"), packageFiles("designer", { "dist/index.js": "export const name = 'other';\n" }))).digest;
  const added = treeDigest(writeTree(join(scratch(t), "added"), packageFiles("designer", { "dist/extra.js": "" }))).digest;
  const renamedFiles = packageFiles("designer");
  renamedFiles["dist/main.js"] = renamedFiles["dist/index.js"];
  delete renamedFiles["dist/index.js"];
  const renamed = treeDigest(writeTree(join(scratch(t), "renamed"), renamedFiles)).digest;
  assert.notEqual(changed, base);
  assert.notEqual(added, base);
  assert.notEqual(renamed, base);
});

test("rule 2: a changed file in a packed tarball flips that package's manifest digest only", (t) => {
  const changesets = changesetDir(t, []);
  const before = buildOverlayManifest({ packedDir: packedSet(t), changesetsDir: changesets, commit: COMMIT, committedAt: COMMITTED_AT });
  const after = buildOverlayManifest({
    packedDir: packedSet(t, { extra: { publisher: { "dist/index.js": "export const changed = true;\n" } } }),
    changesetsDir: changesets,
    commit: COMMIT, committedAt: COMMITTED_AT,
  });
  assert.equal(after.packages.designer.treeDigest, before.packages.designer.treeDigest);
  assert.notEqual(after.packages.publisher.treeDigest, before.packages.publisher.treeDigest);
  assert.equal(overlayChanged(before, after), true);
});

test("rule 3: the tarball hash is recorded exactly", (t) => {
  const packed = packedSet(t);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  for (const dir of OVERLAY_PACKAGES) {
    const bytes = readFileSync(join(packed, `${dir}.tgz`));
    assert.equal(manifest.packages[dir].tarball, `${dir}.tgz`);
    assert.equal(manifest.packages[dir].tarballSha256, sha256(bytes));
    assert.equal(manifest.packages[dir].tarballBytes, bytes.length);
  }
});

test("rule 3: a different tarball hash over the same tree is not a change", (t) => {
  const changesets = changesetDir(t, ["one.md"]);
  const fast = buildOverlayManifest({ packedDir: packedSet(t, { level: 1 }), changesetsDir: changesets, commit: COMMIT, committedAt: COMMITTED_AT });
  const best = buildOverlayManifest({ packedDir: packedSet(t, { level: 9 }), changesetsDir: changesets, commit: "b".repeat(40), committedAt: COMMITTED_AT });
  assert.notEqual(fast.packages.designer.tarballSha256, best.packages.designer.tarballSha256);
  assert.equal(fast.packages.designer.treeDigest, best.packages.designer.treeDigest);
  assert.equal(overlayChangeKey(fast), overlayChangeKey(best));
  assert.equal(overlayChanged(fast, best), false);
});

test("rule 3: pending changeset names are part of change detection", (t) => {
  const packed = packedSet(t);
  const before = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, ["one.md"]), commit: COMMIT, committedAt: COMMITTED_AT });
  const after = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, ["one.md", "two.md"]), commit: COMMIT, committedAt: COMMITTED_AT });
  assert.equal(overlayChanged(before, after), true);
});

test("pending changeset names skip README.md and non-changeset files", (t) => {
  const dir = changesetDir(t, ["zeta.md", "alpha.md"]);
  writeFileSync(join(dir, "notes.txt"), "not a changeset");
  assert.deepEqual(pendingChangesetNames(dir), ["alpha.md", "zeta.md"]);
});

test("rule 4: a missing packed package fails closed", (t) => {
  for (const dir of OVERLAY_PACKAGES) {
    const packed = packedSet(t, { omit: [dir] });
    assert.throws(
      () => buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT }),
      new RegExp(`${dir}\\.tgz`),
    );
  }
});

test("rule 4: a manifest missing a package entry fails validation and change detection", (t) => {
  const manifest = buildOverlayManifest({ packedDir: packedSet(t), changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  assert.doesNotThrow(() => validateOverlayManifest(manifest));
  for (const dir of OVERLAY_PACKAGES) {
    const partial = structuredClone(manifest);
    delete partial.packages[dir];
    assert.throws(() => validateOverlayManifest(partial), new RegExp(dir));
    assert.throws(() => overlayChanged(manifest, partial), new RegExp(dir));
    assert.throws(() => overlayChanged(partial, manifest), new RegExp(dir));
  }
  const extra = structuredClone(manifest);
  extra.packages.other = structuredClone(manifest.packages.designer);
  assert.throws(() => validateOverlayManifest(extra), /other/);
  const blankDigest = structuredClone(manifest);
  blankDigest.packages.designer.treeDigest = "";
  assert.throws(() => validateOverlayManifest(blankDigest), /treeDigest/);
});

test("a tree holding a symlink or no files fails closed", (t) => {
  const tree = writeTree(join(scratch(t), "linked"), packageFiles("designer"));
  symlinkSync("README.md", join(tree, "alias.md"));
  assert.throws(() => treeDigest(tree), /regular file/);
  const empty = join(scratch(t), "empty");
  mkdirSync(empty);
  assert.throws(() => treeDigest(empty), /no files/);
});

test("a tarball whose package.json disagrees with the expected identity fails closed", (t) => {
  const packed = packedSet(t);
  assert.throws(
    () => buildOverlayManifest({
      packedDir: packed,
      changesetsDir: changesetDir(t, []),
      commit: COMMIT, committedAt: COMMITTED_AT,
      expected: { designer: { name: "@example/designer", version: "9.9.9" }, publisher: { name: "@example/publisher", version: "1.2.3" } },
    }),
    /designer.*version/,
  );
});

test("verification passes on the published set and fails on a swapped tarball", (t) => {
  const packed = packedSet(t);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  assert.doesNotThrow(() => verifyOverlayRelease({ manifest, dir: packed }));
  const other = packedSet(t, { extra: { designer: { "dist/index.js": "tampered\n" } } });
  writeFileSync(join(packed, "designer.tgz"), readFileSync(join(other, "designer.tgz")));
  assert.throws(() => verifyOverlayRelease({ manifest, dir: packed }), /designer: integrity mismatch/);
});

test("the CLI builds and verifies a manifest, and exits 1 when a package is missing", (t) => {
  const packed = packedSet(t);
  const changesets = changesetDir(t, ["one.md"]);
  const out = join(scratch(t), "overlay-manifest.json");
  const build = spawnSync("node", [script, "build", "--packed", packed, "--changesets", changesets, "--commit", COMMIT, "--committed-at", COMMITTED_AT, "--out", out, "--packages-root", packagesRoot(t)], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const manifest = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(manifest.commit, COMMIT);
  const verify = spawnSync("node", [script, "verify", "--manifest", out, "--dir", packed], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr);
  rmSync(join(packed, "publisher.tgz"));
  const missing = spawnSync("node", [script, "build", "--packed", packed, "--changesets", changesets, "--commit", COMMIT, "--committed-at", COMMITTED_AT, "--out", out, "--packages-root", packagesRoot(t)], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /publisher\.tgz/);
  const reverify = spawnSync("node", [script, "verify", "--manifest", out, "--dir", packed], { encoding: "utf8" });
  assert.equal(reverify.status, 1);
});

test("the CLI refuses tarballs whose version differs from packages/<dir>/package.json", (t) => {
  const result = spawnSync("node", [script, "build", "--packed", packedSet(t), "--changesets", changesetDir(t, []), "--commit", COMMIT, "--committed-at", COMMITTED_AT, "--out", join(scratch(t), "m.json"), "--packages-root", packagesRoot(t, "2.0.0")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version/);
});

test("the CLI rejects a malformed commit", (t) => {
  const packed = packedSet(t);
  const result = spawnSync("node", [script, "build", "--packed", packed, "--changesets", changesetDir(t, []), "--commit", "main", "--committed-at", COMMITTED_AT, "--out", join(scratch(t), "m.json"), "--packages-root", packagesRoot(t)], { encoding: "utf8" });
  assert.equal(result.status, 2);
});

test("rule 5: the manifest records the commit and its committedAt", (t) => {
  const manifest = buildOverlayManifest({ packedDir: packedSet(t), changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  assert.equal(manifest.commit, COMMIT);
  assert.equal(manifest.committedAt, COMMITTED_AT);
  assert.deepEqual(Object.keys(manifest), ["schemaVersion", "kind", "treeDigestAlgorithm", "commit", "committedAt", "pendingChangesets", "packages"]);
});

test("rule 5: a missing or malformed commit or committedAt fails closed", (t) => {
  const packed = packedSet(t);
  const changesets = changesetDir(t, []);
  for (const committedAt of [undefined, "", "2026-10-20", "2026-10-20T12:34:56+02:00", "2026-10-20T12:34:56.000Z", "2026-13-40T12:34:56Z"]) {
    assert.throws(() => buildOverlayManifest({ packedDir: packed, changesetsDir: changesets, commit: COMMIT, committedAt }), /committedAt/);
  }
  assert.throws(() => buildOverlayManifest({ packedDir: packed, changesetsDir: changesets, committedAt: COMMITTED_AT }), /commit/);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesets, commit: COMMIT, committedAt: COMMITTED_AT });
  for (const field of ["commit", "committedAt"]) {
    const without = structuredClone(manifest);
    delete without[field];
    assert.throws(() => validateOverlayManifest(without), new RegExp(field));
  }
});

test("rule 6: each package records name, version and an SRI sha512 integrity of its tarball", (t) => {
  const packed = packedSet(t);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  for (const dir of OVERLAY_PACKAGES) {
    const entry = manifest.packages[dir];
    assert.equal(entry.name, `@example/${dir}`);
    assert.equal(entry.version, "1.2.3");
    assert.equal(entry.integrity, sri512(readFileSync(join(packed, `${dir}.tgz`))));
    assert.deepEqual(Object.keys(entry), ["name", "version", "tarball", "integrity", "tarballSha256", "tarballBytes", "treeDigest", "files"]);
  }
});

test("rule 6: a missing, malformed or non-sha512 integrity fails closed", (t) => {
  const manifest = buildOverlayManifest({ packedDir: packedSet(t), changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  const sha256Sri = `sha256-${createHash("sha256").update("x").digest("base64")}`;
  for (const integrity of [undefined, "", sha256Sri, "sha512-not base64!", `sha512-${Buffer.alloc(10).toString("base64")}`]) {
    const bad = structuredClone(manifest);
    if (integrity === undefined) delete bad.packages.designer.integrity;
    else bad.packages.designer.integrity = integrity;
    assert.throws(() => validateOverlayManifest(bad), /designer integrity/);
  }
});

test("rule 6: verification refuses a tarball whose integrity does not match", (t) => {
  const packed = packedSet(t);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  const forged = structuredClone(manifest);
  forged.packages.publisher.integrity = sri512(Buffer.from("something else"));
  assert.throws(() => verifyOverlayRelease({ manifest: forged, dir: packed }), /publisher.*integrity/);
});

test("rule 5: the CLI derives committedAt from the commit itself when not given", (t) => {
  const repo = dirname(dirname(script));
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const epoch = Number(execFileSync("git", ["-C", repo, "show", "-s", "--format=%ct", head], { encoding: "utf8" }).trim());
  const out = join(scratch(t), "m.json");
  const result = spawnSync("node", [script, "build", "--packed", packedSet(t), "--changesets", changesetDir(t, []), "--commit", head, "--out", out, "--packages-root", packagesRoot(t)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(manifest.commit, head);
  assert.equal(manifest.committedAt, new Date(epoch * 1000).toISOString().replace(".000Z", "Z"));
});

// Rule 7 fixtures: a run's own manifest and the currently published one.
const OLD = "b".repeat(40);
const NEW = "c".repeat(40);
function manifestAt(t, commit, committedAt) {
  return buildOverlayManifest({ packedDir: packedSet(t), changesetsDir: changesetDir(t, []), commit, committedAt });
}

test("rule 7: the first publish and a newer descendant of the published commit are published", (t) => {
  const run = manifestAt(t, NEW, "2026-10-20T13:00:00Z");
  const first = overlayPublishDecision({ run, mainTip: NEW, published: null });
  assert.equal(first.publish, true, first.reason);
  const published = manifestAt(t, OLD, "2026-10-20T12:00:00Z");
  const next = overlayPublishDecision({ run, mainTip: NEW, published, comparison: "ahead" });
  assert.equal(next.publish, true, next.reason);
});

test("rule 7: a rerun of the commit already published, still at the tip, republishes", (t) => {
  const run = manifestAt(t, NEW, "2026-10-20T13:00:00Z");
  const decision = overlayPublishDecision({ run, mainTip: NEW, published: run });
  assert.equal(decision.publish, true, decision.reason);
});

test("rule 7: a stale run whose commit is no longer the tip of main is skipped with a reason", (t) => {
  const run = manifestAt(t, OLD, "2026-10-20T12:00:00Z");
  for (const published of [null, run]) {
    const decision = overlayPublishDecision({ run, mainTip: NEW, published, comparison: "identical" });
    assert.equal(decision.publish, false);
    assert.match(decision.reason, /not the current tip of main/);
    assert.match(decision.reason, new RegExp(NEW));
  }
});

test("rule 7: a run older than the published manifest is skipped, by committedAt and by ancestry", (t) => {
  const published = manifestAt(t, NEW, "2026-10-20T13:00:00Z");
  const earlier = manifestAt(t, OLD, "2026-10-20T12:00:00Z");
  const byTime = overlayPublishDecision({ run: earlier, mainTip: OLD, published, comparison: "ahead" });
  assert.equal(byTime.publish, false);
  assert.match(byTime.reason, /committedAt .* is older than the published/);
  const later = manifestAt(t, OLD, "2026-10-20T14:00:00Z");
  for (const comparison of ["behind", "diverged"]) {
    const byAncestry = overlayPublishDecision({ run: later, mainTip: OLD, published, comparison });
    assert.equal(byAncestry.publish, false);
    assert.match(byAncestry.reason, /not a descendant of the published/);
  }
});

test("rule 7: malformed decision input fails closed", (t) => {
  const run = manifestAt(t, NEW, "2026-10-20T13:00:00Z");
  const published = manifestAt(t, OLD, "2026-10-20T12:00:00Z");
  assert.throws(() => overlayPublishDecision({ run, mainTip: "main", published: null }), /main tip/);
  assert.throws(() => overlayPublishDecision({ run, mainTip: NEW, published }), /comparison/);
  assert.throws(() => overlayPublishDecision({ run, mainTip: NEW, published, comparison: "unknown" }), /comparison/);
  const broken = structuredClone(published);
  delete broken.committedAt;
  assert.throws(() => overlayPublishDecision({ run, mainTip: NEW, published: broken, comparison: "ahead" }), /committedAt/);
});

test("rule 7: the CLI skips a stale run with exit 0, publish=false and the reason", (t) => {
  const root = scratch(t);
  const runPath = join(root, "run.json");
  const publishedPath = join(root, "published.json");
  writeFileSync(runPath, JSON.stringify(manifestAt(t, OLD, "2026-10-20T12:00:00Z")));
  writeFileSync(publishedPath, JSON.stringify(manifestAt(t, NEW, "2026-10-20T13:00:00Z")));
  const stale = spawnSync("node", [script, "decide", "--manifest", runPath, "--main-tip", NEW, "--published", publishedPath, "--comparison", "behind"], { encoding: "utf8" });
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /^publish=false$/m);
  assert.match(stale.stdout, /^reason=.*not the current tip of main/m);
  const fresh = spawnSync("node", [script, "decide", "--manifest", publishedPath, "--main-tip", NEW, "--published", publishedPath], { encoding: "utf8" });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /^publish=true$/m);
  const bad = spawnSync("node", [script, "decide", "--manifest", runPath, "--main-tip", OLD, "--published", publishedPath, "--comparison", "sideways"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.doesNotMatch(bad.stdout, /publish=/);
});

// Rule 8 fixture: a complete overlay directory (two tarballs + manifest).
function overlayDir(t) {
  const packed = packedSet(t);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  writeFileSync(join(packed, "overlay-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return packed;
}

test("rule 8: the scanned digests cover exactly the three overlay files and match them", (t) => {
  const dir = overlayDir(t);
  const scanned = scannedDigests(dir);
  assert.deepEqual(Object.keys(scanned), [...OVERLAY_FILES]);
  for (const name of OVERLAY_FILES) assert.equal(scanned[name], sha256(readFileSync(join(dir, name))));
  assert.doesNotThrow(() => assertScannedDigests({ dir, scanned }));
});

test("rule 8: a file changed after the scan fails closed", (t) => {
  const dir = overlayDir(t);
  const scanned = scannedDigests(dir);
  for (const name of OVERLAY_FILES) {
    const copy = join(scratch(t), name);
    writeFileSync(copy, readFileSync(join(dir, name)));
    writeFileSync(join(dir, name), Buffer.concat([readFileSync(copy), Buffer.from(" ")]));
    assert.throws(() => assertScannedDigests({ dir, scanned }), new RegExp(`${name.replace(".", "\\.")}: sha256 differs from the scanned`));
    writeFileSync(join(dir, name), readFileSync(copy));
  }
});

test("rule 8: an extra or missing file, or an incomplete scan record, fails closed", (t) => {
  const dir = overlayDir(t);
  const scanned = scannedDigests(dir);
  writeFileSync(join(dir, "extra.tgz"), "x");
  assert.throws(() => assertScannedDigests({ dir, scanned }), /exactly/);
  assert.throws(() => scannedDigests(dir), /exactly/);
  rmSync(join(dir, "extra.tgz"));
  const partial = { ...scanned };
  delete partial["publisher.tgz"];
  assert.throws(() => assertScannedDigests({ dir, scanned: partial }), /scan record/);
  assert.throws(() => assertScannedDigests({ dir, scanned: { ...scanned, "other.tgz": scanned["designer.tgz"] } }), /scan record/);
  rmSync(join(dir, "publisher.tgz"));
  assert.throws(() => assertScannedDigests({ dir, scanned }), /exactly/);
});

test("rule 8: the CLI prints the scan record and verify --scanned refuses changed bytes", (t) => {
  const dir = overlayDir(t);
  const digests = spawnSync("node", [script, "digests", "--dir", dir], { encoding: "utf8" });
  assert.equal(digests.status, 0, digests.stderr);
  const record = digests.stdout.trim();
  assert.deepEqual(JSON.parse(record), scannedDigests(dir));
  const manifestPath = join(dir, "overlay-manifest.json");
  const ok = spawnSync("node", [script, "verify", "--manifest", manifestPath, "--dir", dir, "--scanned", record], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const forged = JSON.stringify({ ...JSON.parse(record), "designer.tgz": "0".repeat(64) });
  const refused = spawnSync("node", [script, "verify", "--manifest", manifestPath, "--dir", dir, "--scanned", forged], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /designer\.tgz: sha256 differs from the scanned/);
});

const privatePackageJson = (dir, value) => JSON.stringify({ name: `@example/${dir}`, version: "1.2.3", private: value });

test("rule 9: a packed package.json marked private fails build and verify closed", (t) => {
  for (const value of [true, "true", 1]) {
    const packed = packedSet(t, { extra: { publisher: { "package.json": privatePackageJson("publisher", value) } } });
    assert.throws(
      () => buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT }),
      /publisher: packed package\.json is marked private/,
    );
  }
  const explicitFalse = packedSet(t, { extra: { publisher: { "package.json": privatePackageJson("publisher", false) } } });
  assert.doesNotThrow(() => buildOverlayManifest({ packedDir: explicitFalse, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT }));
  const packed = packedSet(t);
  const manifest = buildOverlayManifest({ packedDir: packed, changesetsDir: changesetDir(t, []), commit: COMMIT, committedAt: COMMITTED_AT });
  const swapped = packedSet(t, { extra: { designer: { "package.json": privatePackageJson("designer", true) } } });
  writeFileSync(join(packed, "designer.tgz"), readFileSync(join(swapped, "designer.tgz")));
  assert.throws(() => verifyOverlayRelease({ manifest, dir: packed }), /designer: packed package\.json is marked private/);
});

test("rule 9: a source package.json marked private fails assert-public and build closed", (t) => {
  assert.doesNotThrow(() => assertOverlayPackagesPublic(packagesRoot(t)));
  const privateRoot = packagesRoot(t, "1.2.3", { designer: { private: true } });
  assert.throws(() => assertOverlayPackagesPublic(privateRoot), /designer: packages\/designer\/package\.json is marked private/);
  const ok = spawnSync("node", [script, "assert-public", "--packages-root", packagesRoot(t)], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const refused = spawnSync("node", [script, "assert-public", "--packages-root", privateRoot], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /designer: packages\/designer\/package\.json is marked private/);
  const build = spawnSync("node", [script, "build", "--packed", packedSet(t), "--changesets", changesetDir(t, []), "--commit", COMMIT, "--committed-at", COMMITTED_AT, "--out", join(scratch(t), "m.json"), "--packages-root", privateRoot], { encoding: "utf8" });
  assert.equal(build.status, 1);
  assert.match(build.stderr, /marked private/);
});
