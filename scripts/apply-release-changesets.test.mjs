import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyReleaseChangesets, bumpManifestText, bumpVersion, namedPackages, prependChangelogEntry } from "./apply-release-changesets.mjs";

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "apply-release-changesets-test-"));
  return root;
}

function makePackage(root, name, version) {
  const pkgDir = join(root, "packages", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), `{\n  "name": "@x/${name}",\n  "version": "${version}",\n  "license": "MIT"\n}\n`);
  return pkgDir;
}

function writeChangeset(root, file, text) {
  mkdirSync(join(root, ".changesets"), { recursive: true });
  writeFileSync(join(root, ".changesets", file), text);
}

// ---------------------------------------------------------------- unit coverage

test("bumpVersion: applies exactly one step per level", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  assert.throws(() => bumpVersion("not-a-version", "patch"));
  assert.throws(() => bumpVersion("1.2.3", "bogus"));
});

test("bumpManifestText: replaces only the top-level version field, byte-exact elsewhere", () => {
  const text = '{\n  "name": "@x/y",\n  "version": "1.0.0",\n  "dependencies": {\n    "z": "^1.0.0"\n  }\n}\n';
  const result = bumpManifestText(text, "1.0.1");
  assert.equal(result, '{\n  "name": "@x/y",\n  "version": "1.0.1",\n  "dependencies": {\n    "z": "^1.0.0"\n  }\n}\n');
});

test("bumpManifestText: throws if the version field cannot be found exactly once", () => {
  assert.throws(() => bumpManifestText('{\n  "name": "@x/y"\n}\n', "1.0.1"));
});

test("namedPackages: unions across every changeset entry", () => {
  const entries = [
    { file: "a.md", packages: { alpha: "patch" }, summary: "s" },
    { file: "b.md", packages: { alpha: "minor", beta: "patch" }, summary: "s" },
  ];
  assert.deepEqual(namedPackages(entries), ["alpha", "beta"]);
});

test("prependChangelogEntry: inserts above the first existing entry", () => {
  const existing = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const result = prependChangelogEntry(existing, { version: "1.0.1", date: "2026-09-22", bullets: ["Fixed a bug."] });
  assert.equal(result, "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n");
});

test("prependChangelogEntry: creates a fresh changelog when none exists", () => {
  const result = prependChangelogEntry(null, { version: "0.1.0", date: "2026-09-22", bullets: ["First release."] });
  assert.equal(result, "# Changelog\n\n## 0.1.0 - 2026-09-22\n\n- First release.\n");
});

// ---------------------------------------------------------------- end-to-end coverage

test("applyReleaseChangesets: bumps once per package at the highest named level, writes CHANGELOG, deletes changesets, regenerates the lock", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    writeFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");
    writeChangeset(root, "alpha-feature.md", "---\nalpha: minor\n---\n\nAdd a feature.\n");

    let npmInstallCalledWith = null;
    const result = applyReleaseChangesets({
      root,
      runNpmInstall: (r) => {
        npmInstallCalledWith = r;
      },
      today: () => "2026-09-22",
    });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 1);
    assert.deepEqual(result.applied[0], {
      package: "alpha",
      fromVersion: "1.0.0",
      toVersion: "1.1.0", // highest of patch/minor is minor
      bump: "minor",
      changesetFiles: ["alpha-feature.md", "alpha-fix.md"],
    });

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.1.0");

    const changelog = readFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "utf8");
    assert.match(changelog, /## 1\.1\.0 - 2026-09-22/);
    assert.match(changelog, /Fix a bug\./);
    assert.match(changelog, /Add a feature\./);

    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), false);
    assert.equal(existsSync(join(root, ".changesets", "alpha-feature.md")), false);

    assert.equal(npmInstallCalledWith, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: --dry-run touches nothing and never calls npm", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, dryRun: true, runNpmInstall: () => (npmInstallCalled = true) });

    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].toVersion, "1.0.1");
    assert.equal(npmInstallCalled, false);

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.0.0"); // unchanged
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), true); // not deleted
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: no pending changesets is a clean no-op", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, runNpmInstall: () => (npmInstallCalled = true) });
    assert.deepEqual(result, { applied: [], findings: [], changesetFindings: [] });
    assert.equal(npmInstallCalled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: refuses to run with malformed changesets present", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    writeChangeset(root, "bad.md", "not a changeset\n");
    const result = applyReleaseChangesets({ root });
    assert.equal(result.applied.length, 0);
    assert.equal(result.changesetFindings.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
