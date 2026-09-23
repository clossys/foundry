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

test("prependChangelogEntry: a major-level changeset produces a Breaking changes subsection above the full bullet list", () => {
  const result = prependChangelogEntry(null, {
    version: "2.0.0",
    date: "2026-09-26",
    bullets: ["Fixed a bug.", "Removed the deprecated foo() export."],
    breakingBullets: ["Removed the deprecated foo() export."],
  });
  assert.equal(
    result,
    "# Changelog\n\n## 2.0.0 - 2026-09-26\n\n### Breaking changes\n\n- Removed the deprecated foo() export.\n\n- Fixed a bug.\n- Removed the deprecated foo() export.\n",
  );
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
      outOfBand: false,
      breaking: false,
      breakingSummaries: [],
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

test("applyReleaseChangesets: a major-level changeset produces a breaking CHANGELOG entry and a truthy `breaking` flag", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    writeChangeset(root, "alpha-break.md", "---\nalpha: major\n---\n\nRemoved the deprecated foo() export.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });
    assert.equal(result.applied[0].toVersion, "2.0.0");
    assert.equal(result.applied[0].bump, "major");
    assert.equal(result.applied[0].breaking, true);
    assert.deepEqual(result.applied[0].breakingSummaries, ["Removed the deprecated foo() export."]);

    const changelog = readFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "utf8");
    assert.match(changelog, /### Breaking changes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: an out-of-band changeset is flagged on the applied entry (informational -- it does not change how the version is computed)", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    writeChangeset(root, "alpha-hotfix.md", "---\nalpha: patch\nrelease: out-of-band\n---\n\nFix a security issue.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });
    assert.equal(result.applied[0].toVersion, "1.0.1"); // an ordinary patch bump, same as any other patch changeset
    assert.equal(result.applied[0].outOfBand, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: --out-of-band consumes only the out-of-band patch, leaving an ordinary pending minor changeset for the same package untouched", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.2.3");
    writeChangeset(root, "alpha-hotfix.md", "---\nalpha: patch\nrelease: out-of-band\n---\n\nFix a security issue.\n");
    writeChangeset(root, "alpha-feature.md", "---\nalpha: minor\n---\n\nAdd a feature (ordinary, not out-of-band).\n");

    const result = applyReleaseChangesets({ root, outOfBandOnly: true, runNpmInstall: () => {}, today: () => "2026-09-23" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].package, "alpha");
    assert.equal(result.applied[0].toVersion, "1.2.4"); // patch only -- the pending minor was never consulted
    assert.equal(result.applied[0].bump, "patch");
    assert.deepEqual(result.applied[0].changesetFiles, ["alpha-hotfix.md"]);

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.2.4");

    // The ordinary minor changeset is untouched -- left pending for the next regular Saturday release.
    assert.equal(existsSync(join(root, ".changesets", "alpha-feature.md")), true);
    assert.equal(existsSync(join(root, ".changesets", "alpha-hotfix.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: --out-of-band with no out-of-band changesets pending is a clean no-op, even if ordinary changesets ARE pending", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.2.3");
    writeChangeset(root, "alpha-feature.md", "---\nalpha: minor\n---\n\nAdd a feature.\n");

    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, outOfBandOnly: true, runNpmInstall: () => (npmInstallCalled = true) });
    assert.deepEqual(result, { applied: [], findings: [], changesetFindings: [] });
    assert.equal(npmInstallCalled, false);
    assert.equal(existsSync(join(root, ".changesets", "alpha-feature.md")), true); // still pending
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: --out-of-band across two packages only touches the ones with an out-of-band changeset", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.2.3");
    makePackage(root, "beta", "2.0.0");
    writeChangeset(root, "alpha-hotfix.md", "---\nalpha: patch\nrelease: out-of-band\n---\n\nFix a security issue in alpha.\n");
    writeChangeset(root, "beta-feature.md", "---\nbeta: minor\n---\n\nAdd a feature to beta (ordinary).\n");

    const result = applyReleaseChangesets({ root, outOfBandOnly: true, runNpmInstall: () => {}, today: () => "2026-09-23" });
    assert.deepEqual(result.applied.map((a) => a.package), ["alpha"]);

    const betaManifest = JSON.parse(readFileSync(join(root, "packages", "beta", "package.json"), "utf8"));
    assert.equal(betaManifest.version, "2.0.0"); // untouched
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

test("applyReleaseChangesets: a package with no pending changeset is not touched, even when a sibling package is bumped", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    makePackage(root, "beta", "3.4.0"); // no changeset names beta
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });
    assert.deepEqual(result.applied.map((a) => a.package), ["alpha"]);

    const betaManifest = JSON.parse(readFileSync(join(root, "packages", "beta", "package.json"), "utf8"));
    assert.equal(betaManifest.version, "3.4.0"); // untouched
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: no pending changesets anywhere is a clean no-op -- nothing bumped, npm never invoked, no release PR's worth of anything produced", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, runNpmInstall: () => (npmInstallCalled = true) });
    assert.deepEqual(result, { applied: [], findings: [], changesetFindings: [] });
    assert.equal(npmInstallCalled, false);
    // .github/workflows/release-pr.yml treats this exact shape (applied.length === 0) as
    // "nothing to release this run" and skips the "Push branch and open pull request" step
    // entirely -- a quiet week opens no pull request, not an empty one.
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
