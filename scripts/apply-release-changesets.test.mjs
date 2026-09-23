import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyReleaseChangesets,
  bumpDependencyRangeText,
  bumpManifestText,
  bumpVersion,
  collectDependencyUpdates,
  forbiddenProtocolReason,
  namedPackages,
  prependChangelogEntry,
} from "./apply-release-changesets.mjs";

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

// Writes a package.json with a "dependencies" block naming other @x/*
// packages -- the shape apply-release-changesets.mjs's sibling-range
// rewriter (issue #1332) operates on, matching this repo's own
// packages/*/package.json convention (2-space top-level, 4-space nested).
function makePackageWithDependency(root, name, version, depName, depRange) {
  const pkgDir = join(root, "packages", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    `{\n  "name": "@x/${name}",\n  "version": "${version}",\n  "license": "MIT",\n  "dependencies": {\n    "${depName}": "${depRange}"\n  }\n}\n`,
  );
  return pkgDir;
}

// Writes a raw package.json text verbatim -- for shapes this script must
// refuse (e.g. a "version" field indented by something other than this
// repo's own two-space convention).
function makePackageRaw(root, name, text) {
  const pkgDir = join(root, "packages", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), text);
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

// issue #1322 item 1: a later package's own failure must leave every
// earlier package's package.json/CHANGELOG.md/changeset file exactly as
// they were -- "exit 1 = nothing applied" is the header's own contract,
// and a single-pass write-as-you-go loop broke it (a rerun after fixing
// the later package would have re-bumped the earlier one and duplicated
// its CHANGELOG entry).
test("applyReleaseChangesets: a later package's failure leaves an earlier, otherwise-valid package completely untouched (issue #1322 item 1)", () => {
  const root = makeRoot();
  try {
    // "alpha" sorts before "beta" in .changesets/ file order, so alpha is
    // processed -- and, before this fix, WRITTEN -- before beta's own
    // failure is ever reached.
    makePackage(root, "alpha", "1.0.0");
    const alphaChangelog = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
    writeFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), alphaChangelog);
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    // "beta" has a version that cannot be bumped (not a plain X.Y.Z) --
    // bumpVersion() throws, so beta is a finding, not an applied entry.
    makePackage(root, "beta", "not-a-version");
    writeChangeset(root, "beta-fix.md", "---\nbeta: patch\n---\n\nFix a bug.\n");

    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, runNpmInstall: () => (npmInstallCalled = true), today: () => "2026-09-22" });

    assert.equal(result.applied.length, 0, "nothing was applied -- exit 1 means exactly that");
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /beta/);
    assert.equal(npmInstallCalled, false);

    // alpha: completely untouched on disk.
    const alphaManifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(alphaManifest.version, "1.0.0", "alpha must not be bumped just because it was processed first");
    assert.equal(readFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "utf8"), alphaChangelog, "alpha's CHANGELOG.md must be byte-identical to before the run");
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), true, "alpha's changeset must not be deleted when the overall run did not succeed");

    // A rerun after fixing beta must still see alpha's original changeset
    // (proving it survived) and apply cleanly.
    writeFileSync(join(root, "packages", "beta", "package.json"), '{\n  "name": "@x/beta",\n  "version": "1.0.0",\n  "license": "MIT"\n}\n');
    const rerun = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });
    assert.equal(rerun.findings.length, 0);
    assert.equal(rerun.applied.length, 2);
    const alphaApplied = rerun.applied.find((a) => a.package === "alpha");
    assert.equal(alphaApplied.fromVersion, "1.0.0", "alpha's version was never bumped by the failed first run, so the rerun still sees its true starting version");
    assert.equal(alphaApplied.toVersion, "1.0.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------- issue #1332: sibling dependency ranges

test("bumpDependencyRangeText: rewrites only the named entry's range, byte-exact elsewhere", () => {
  const text = '{\n  "name": "@x/y",\n  "version": "1.0.0",\n  "dependencies": {\n    "@x/core": "^0.9.0",\n    "@x/other": "^2.0.0"\n  }\n}\n';
  const result = bumpDependencyRangeText(text, "dependencies", "@x/core", "^0.10.0");
  assert.equal(result, '{\n  "name": "@x/y",\n  "version": "1.0.0",\n  "dependencies": {\n    "@x/core": "^0.10.0",\n    "@x/other": "^2.0.0"\n  }\n}\n');
});

test("bumpDependencyRangeText: throws if the section or entry cannot be found exactly once", () => {
  const text = '{\n  "name": "@x/y",\n  "version": "1.0.0"\n}\n';
  assert.throws(() => bumpDependencyRangeText(text, "dependencies", "@x/core", "^0.10.0"));

  const noEntry = '{\n  "name": "@x/y",\n  "version": "1.0.0",\n  "dependencies": {\n    "@x/other": "^2.0.0"\n  }\n}\n';
  assert.throws(() => bumpDependencyRangeText(noEntry, "dependencies", "@x/core", "^0.10.0"));
});

test("forbiddenProtocolReason: refuses workspace:* and catalog:, allows everything else", () => {
  assert.match(forbiddenProtocolReason("workspace:*"), /workspace:/);
  assert.match(forbiddenProtocolReason("catalog:default"), /catalog:/);
  assert.equal(forbiddenProtocolReason("^1.2.3"), null);
});

test("collectDependencyUpdates: flags a workspace:* range as an error rather than rewriting it", () => {
  const manifest = { name: "@x/consumer", dependencies: { "@x/core": "workspace:*" } };
  const { updates, errors } = collectDependencyUpdates("packages/consumer/package.json", manifest, { "@x/core": "0.10.0" });
  assert.equal(updates.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /workspace:/);
});

test("applyReleaseChangesets: a 0.x minor bump rewrites a sibling's ^0.N.0 dependency range and gives the sibling a dependent patch bump", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    writeFileSync(join(root, "packages", "core", "CHANGELOG.md"), "# Changelog\n\n## 0.9.0\n\n- Initial release.\n");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");

    // "consumer" is NOT named by any changeset -- its own bump is entirely
    // a consequence of core's minor bump moving outside its declared range.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");
    writeFileSync(join(root, "packages", "consumer", "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 2);

    const coreApplied = result.applied.find((a) => a.package === "core");
    assert.deepEqual(coreApplied, {
      package: "core",
      fromVersion: "0.9.0",
      toVersion: "0.10.0",
      bump: "minor",
      changesetFiles: ["core-feature.md"],
    });

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.fromVersion, "1.0.0");
    assert.equal(consumerApplied.toVersion, "1.0.1"); // dependent patch bump
    assert.equal(consumerApplied.bump, "patch");
    assert.deepEqual(consumerApplied.changesetFiles, []);
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.version, "1.0.1");
    assert.equal(consumerManifest.dependencies["@x/core"], "^0.10.0");

    const consumerChangelog = readFileSync(join(root, "packages", "consumer", "CHANGELOG.md"), "utf8");
    assert.match(consumerChangelog, /## 1\.0\.1 - 2026-09-22/);
    assert.match(consumerChangelog, /Updated dependency @x\/core to \^0\.10\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a major bump rewrites a sibling's ^1.x dependency range the same way", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "1.2.3");
    writeChangeset(root, "core-break.md", "---\ncore: major\n---\n\nBreaking change.\n");
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^1.2.0");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    const coreApplied = result.applied.find((a) => a.package === "core");
    assert.equal(coreApplied.toVersion, "2.0.0");

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.toVersion, "1.0.1");
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^1.2.0", toRange: "^2.0.0" }]);

    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.dependencies["@x/core"], "^2.0.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a range the new version still satisfies is left untouched -- no rewrite, no dependent bump", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-fix.md", "---\ncore: patch\n---\n\nFix a bug.\n");
    // core: 0.9.0 -> 0.9.1 is a patch bump -- still inside consumer's ^0.9.0 range.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 1, "consumer must not appear in applied at all -- nothing about it changed");
    assert.equal(result.applied[0].package, "core");

    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.version, "1.0.0", "consumer's version is untouched");
    assert.equal(consumerManifest.dependencies["@x/core"], "^0.9.0", "consumer's declared range is untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// issue #1327: bumpManifestText()'s throw during planning must become a
// clean finding with a non-zero exit contract (applied: [], one finding),
// never an uncaught exception that skips the script's own --json/exit(1)
// reporting.
test("applyReleaseChangesets: a manifest bumpManifestText cannot safely rewrite is a clean finding, not an uncaught throw", () => {
  const root = makeRoot();
  try {
    // 4-space indented "version" field -- bumpManifestText()'s regex only
    // matches this repo's own two-space convention, so this throws.
    makePackageRaw(root, "alpha", '{\n    "name": "@x/alpha",\n    "version": "1.0.0",\n    "license": "MIT"\n}\n');
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    let threw = false;
    let result;
    try {
      result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });
    } catch {
      threw = true;
    }

    assert.equal(threw, false, "applyReleaseChangesets must never throw -- every planning failure is a finding");
    assert.equal(result.applied.length, 0);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /alpha/);
    assert.match(result.findings[0], /version/);

    // Nothing was written or deleted: same "exit 1 = nothing applied" contract as every other finding.
    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.0.0");
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: refuses a workspace:* sibling range rather than guessing", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "workspace:*");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.applied.length, 0, "the whole run refuses -- workspace:* is forbidden outright");
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /workspace:/);

    // core itself must be untouched too -- all-or-nothing.
    const coreManifest = JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8"));
    assert.equal(coreManifest.version, "0.9.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a package named by its own changeset also gets its sibling range rewritten and CHANGELOG bullet appended, with no second bump", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");

    // "consumer" has its OWN changeset (a patch bump for an unrelated
    // reason) AND depends on core with a range the minor bump breaks.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");
    writeChangeset(root, "consumer-fix.md", "---\nconsumer: patch\n---\n\nFix an unrelated bug.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 2);

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    // Exactly one bump -- the changeset's own patch level, not a second
    // "dependent" bump stacked on top.
    assert.equal(consumerApplied.toVersion, "1.0.1");
    assert.equal(consumerApplied.bump, "patch");
    assert.deepEqual(consumerApplied.changesetFiles, ["consumer-fix.md"]);
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    const consumerChangelog = readFileSync(join(root, "packages", "consumer", "CHANGELOG.md"), "utf8");
    assert.match(consumerChangelog, /Fix an unrelated bug\./);
    assert.match(consumerChangelog, /Updated dependency @x\/core to \^0\.10\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
