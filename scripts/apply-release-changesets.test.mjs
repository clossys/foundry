import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
import { CHANGELOGS_DIR, changelogPath, changelogPathForPackageDir } from "./lib/changelog-location.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "apply-release-changesets.mjs");

// The package changelog lives at docs/changelogs/<dir>.md, outside the
// package directory (scripts/lib/changelog-location.mjs). This returns that
// path under a fixture root, creating docs/changelogs/ so a fixture can seed
// a prior changelog there.
function changelogFile(root, dir) {
  const path = changelogPath(root, dir);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

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
    writeFileSync(changelogFile(root, "alpha"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
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
      changelog: "docs/changelogs/alpha.md",
    });

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.1.0");

    const changelog = readFileSync(changelogFile(root, "alpha"), "utf8");
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

    const changelog = readFileSync(changelogFile(root, "alpha"), "utf8");
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

test("applyReleaseChangesets: --out-of-band applies a minor bump when the changeset carries owner-approved: minor", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.2.3");
    writeChangeset(root, "alpha-urgent.md", "---\nalpha: minor\nrelease: out-of-band\nowner-approved: minor\n---\n\nClear an urgent update.\n");

    const result = applyReleaseChangesets({ root, outOfBandOnly: true, runNpmInstall: () => {}, today: () => "2026-09-23" });
    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].toVersion, "1.3.0");
    assert.equal(result.applied[0].bump, "minor");

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.3.0");
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

test("applyReleaseChangesets: no pending changesets is a clean no-op", () => {
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
    writeFileSync(changelogFile(root, "alpha"), alphaChangelog);
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
    assert.equal(readFileSync(changelogFile(root, "alpha"), "utf8"), alphaChangelog, "alpha's CHANGELOG.md must be byte-identical to before the run");
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

// A CHANGESET NAMING SEVERAL PACKAGES IS DELETED ONCE, NOT ONCE PER PACKAGE
// (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// item 1). collect-changesets.mjs's own documented shape (see its header)
// lets one file name several packages (e.g. `controller: minor` / `writer:
// patch` in the same frontmatter). Each named package gets its own
// `namedPlans` entry, and each one carries that SAME shared changeset file
// in its own `changesetFiles` -- before this fix, the write phase deleted
// every step's own changesetFiles in a loop with no dedupe, so the SAME
// file got `rmSync`'d twice and the second call threw `ENOENT` AFTER every
// manifest and CHANGELOG had already been written, breaking the
// all-or-nothing contract PHASE C exists to guarantee.
test("applyReleaseChangesets: a changeset naming multiple packages applies cleanly, deleting the shared file exactly once instead of crashing on a duplicate rmSync", () => {
  const root = makeRoot();
  try {
    makePackage(root, "controller", "1.0.0");
    makePackage(root, "writer", "2.0.0");
    // The exact documented shape from collect-changesets.mjs's own header.
    writeChangeset(root, "shared.md", "---\ncontroller: minor\nwriter: patch\n---\n\nShip a shared update.\n");

    let threw = false;
    let result;
    try {
      result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-24" });
    } catch {
      threw = true;
    }

    assert.equal(threw, false, "applyReleaseChangesets must never throw -- a shared changeset file must be deleted exactly once");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.equal(result.applied.length, 2);
    assert.deepEqual(
      result.applied.map((a) => a.package).sort(),
      ["controller", "writer"],
    );
    for (const a of result.applied) assert.deepEqual(a.changesetFiles, ["shared.md"]);

    const controllerManifest = JSON.parse(readFileSync(join(root, "packages", "controller", "package.json"), "utf8"));
    assert.equal(controllerManifest.version, "1.1.0");
    const writerManifest = JSON.parse(readFileSync(join(root, "packages", "writer", "package.json"), "utf8"));
    assert.equal(writerManifest.version, "2.0.1");

    assert.equal(existsSync(join(root, ".changesets", "shared.md")), false, "the shared changeset file must be deleted exactly once, not left behind by a failed second rmSync");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The reviewer's own follow-up case: one of the several packages a shared
// changeset names is ALSO a dependent of the other (via issue #1332's
// sibling-range rewriting) -- proving the shared-file dedupe and the
// sibling-range rewrite compose correctly, not just each in isolation.
test("applyReleaseChangesets: a changeset naming multiple packages where one depends on the other applies cleanly -- its own bump AND the sibling-range rewrite both happen from the SAME shared changeset", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    // consumer both has its OWN entry in the SAME shared changeset file AND
    // depends on core via a range core's minor bump breaks.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");
    writeChangeset(root, "shared.md", "---\ncore: minor\nconsumer: patch\n---\n\nShip a shared update.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-24" });

    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.equal(result.applied.length, 2);

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.toVersion, "1.0.1");
    assert.deepEqual(consumerApplied.changesetFiles, ["shared.md"]);
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.dependencies["@x/core"], "^0.10.0");

    assert.equal(existsSync(join(root, ".changesets", "shared.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// All-or-nothing must still hold for a shared changeset: if ONE of the
// several packages it names fails during planning, NOTHING gets written --
// not even for the OTHER, otherwise-valid package the SAME file also names.
test("applyReleaseChangesets: a multi-package changeset where one named package fails leaves EVERY file untouched, including the shared changeset itself (all-or-nothing)", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    const alphaChangelog = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
    writeFileSync(changelogFile(root, "alpha"), alphaChangelog);
    makePackage(root, "beta", "not-a-version"); // bumpVersion() will throw for beta
    writeChangeset(root, "shared.md", "---\nalpha: patch\nbeta: patch\n---\n\nShip a shared update.\n");

    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, runNpmInstall: () => (npmInstallCalled = true), today: () => "2026-09-24" });

    assert.equal(result.applied.length, 0, "nothing was applied -- beta's failure fails the whole shared changeset");
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /beta/);
    assert.equal(npmInstallCalled, false);

    // alpha: completely untouched on disk, even though it was named by the
    // SAME changeset alongside beta and would otherwise have applied cleanly.
    const alphaManifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(alphaManifest.version, "1.0.0", "alpha must not be bumped just because it shares a changeset with a package that failed");
    assert.equal(readFileSync(changelogFile(root, "alpha"), "utf8"), alphaChangelog, "alpha's CHANGELOG.md must be byte-identical to before the run");
    assert.equal(existsSync(join(root, ".changesets", "shared.md")), true, "the shared changeset file must not be deleted when the overall run did not succeed");
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
    writeFileSync(changelogFile(root, "core"), "# Changelog\n\n## 0.9.0\n\n- Initial release.\n");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");

    // "consumer" is NOT named by any changeset -- its own bump is entirely
    // a consequence of core's minor bump moving outside its declared range.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");
    writeFileSync(changelogFile(root, "consumer"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 2);

    const coreApplied = result.applied.find((a) => a.package === "core");
    assert.deepEqual(coreApplied, {
      package: "core",
      fromVersion: "0.9.0",
      toVersion: "0.10.0",
      bump: "minor",
      outOfBand: false,
      breaking: false,
      breakingSummaries: [],
      changesetFiles: ["core-feature.md"],
      changelog: "docs/changelogs/core.md",
    });

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.fromVersion, "1.0.0");
    assert.equal(consumerApplied.toVersion, "1.0.1"); // dependent patch bump
    assert.equal(consumerApplied.bump, "patch");
    assert.equal(consumerApplied.outOfBand, false);
    assert.equal(consumerApplied.breaking, false);
    assert.deepEqual(consumerApplied.changesetFiles, []);
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.version, "1.0.1");
    assert.equal(consumerManifest.dependencies["@x/core"], "^0.10.0");

    const consumerChangelog = readFileSync(changelogFile(root, "consumer"), "utf8");
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

    const consumerChangelog = readFileSync(changelogFile(root, "consumer"), "utf8");
    assert.match(consumerChangelog, /Fix an unrelated bug\./);
    assert.match(consumerChangelog, /Updated dependency @x\/core to \^0\.10\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------- devDependencies: scanned and rewritten too, but never triggers a bump
//
// Decision + fix, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// item 3: a REAL case in this repository -- packages/controller has
// @clossys/advisor in devDependencies at ^0.4.0, so a minor bump of
// advisor leaves that range stale, and THIS repository's own workspace
// `npm install --package-lock-only` (unlike an external consumer's
// install) DOES resolve devDependencies. See this file's own header for
// the full decision: devDependencies is rewritten the same way
// dependencies/peerDependencies/optionalDependencies are, but NEVER by
// itself triggers a dependent-only version bump (devDependencies is not
// published/consumer-facing).

test("applyReleaseChangesets: a stale sibling devDependencies range is rewritten silently -- no version bump, no CHANGELOG entry, no applied entry of its own", () => {
  const root = makeRoot();
  try {
    makePackage(root, "advisor", "0.4.0");
    writeFileSync(changelogFile(root, "advisor"), "# Changelog\n\n## 0.4.0\n\n- Initial release.\n");
    writeChangeset(root, "advisor-feature.md", "---\nadvisor: minor\n---\n\nAdd a feature.\n");

    // controller has NO changeset of its own, and NO dependencies/
    // peerDependencies/optionalDependencies entry on advisor at all --
    // only devDependencies, the real packages/controller shape.
    const controllerDir = join(root, "packages", "controller");
    mkdirSync(controllerDir, { recursive: true });
    writeFileSync(
      join(controllerDir, "package.json"),
      '{\n  "name": "@x/controller",\n  "version": "1.0.0",\n  "license": "MIT",\n  "devDependencies": {\n    "@x/advisor": "^0.4.0"\n  }\n}\n',
    );

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-24" });

    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    // ONLY advisor is "applied" -- controller's devDependencies rewrite is
    // never reported as a bump, because it is not one.
    assert.deepEqual(
      result.applied.map((a) => a.package),
      ["advisor"],
    );

    const controllerManifest = JSON.parse(readFileSync(join(controllerDir, "package.json"), "utf8"));
    assert.equal(controllerManifest.version, "1.0.0", "controller's own version must never change for a devDependencies-only rewrite");
    assert.equal(controllerManifest.devDependencies["@x/advisor"], "^0.5.0");

    // No CHANGELOG.md was ever created for controller -- a devDependencies
    // rewrite is silent, not a release note.
    assert.equal(existsSync(changelogPathForPackageDir(controllerDir)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a package that needs BOTH a real dependencies rewrite AND a devDependencies rewrite for the same sibling gets exactly one dependent-only bump, with only the dependencies rewrite in its CHANGELOG", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");

    const consumerDir = join(root, "packages", "consumer");
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(
      join(consumerDir, "package.json"),
      '{\n  "name": "@x/consumer",\n  "version": "1.0.0",\n  "license": "MIT",\n  "dependencies": {\n    "@x/core": "^0.9.0"\n  },\n  "devDependencies": {\n    "@x/core": "^0.9.0"\n  }\n}\n',
    );

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-24" });

    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.toVersion, "1.0.1", "exactly one dependent-only bump, not two");
    assert.deepEqual(consumerApplied.dependencyUpdates, [
      { section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" },
      { section: "devDependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" },
    ]);

    const consumerManifest = JSON.parse(readFileSync(join(consumerDir, "package.json"), "utf8"));
    assert.equal(consumerManifest.dependencies["@x/core"], "^0.10.0");
    assert.equal(consumerManifest.devDependencies["@x/core"], "^0.10.0");

    const consumerChangelog = readFileSync(changelogPathForPackageDir(consumerDir), "utf8");
    const bulletCount = (consumerChangelog.match(/Updated dependency @x\/core to \^0\.10\.0/g) ?? []).length;
    assert.equal(bulletCount, 1, "only the publish-relevant (dependencies) rewrite gets a CHANGELOG bullet, not the devDependencies one too");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a NAMED package's own devDependencies rewrite is folded into its own manifest write with no extra CHANGELOG bullet", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");

    const controllerDir = join(root, "packages", "controller");
    mkdirSync(controllerDir, { recursive: true });
    writeFileSync(
      join(controllerDir, "package.json"),
      '{\n  "name": "@x/controller",\n  "version": "1.0.0",\n  "license": "MIT",\n  "devDependencies": {\n    "@x/core": "^0.9.0"\n  }\n}\n',
    );
    // controller has its OWN changeset (an unrelated reason to bump).
    writeChangeset(root, "controller-fix.md", "---\ncontroller: patch\n---\n\nFix an unrelated bug.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-24" });

    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    const controllerApplied = result.applied.find((a) => a.package === "controller");
    assert.equal(controllerApplied.toVersion, "1.0.1");
    assert.deepEqual(controllerApplied.changesetFiles, ["controller-fix.md"]);
    assert.deepEqual(controllerApplied.dependencyUpdates, [{ section: "devDependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    const controllerManifest = JSON.parse(readFileSync(join(controllerDir, "package.json"), "utf8"));
    assert.equal(controllerManifest.devDependencies["@x/core"], "^0.10.0");

    const controllerChangelog = readFileSync(changelogPathForPackageDir(controllerDir), "utf8");
    assert.match(controllerChangelog, /Fix an unrelated bug\./);
    assert.doesNotMatch(controllerChangelog, /Updated dependency @x\/core/, "a devDependencies rewrite never gets its own CHANGELOG bullet, even for a named package");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------- composition: out-of-band filtering x sibling dependency ranges
//
// Re-review (https://github.com/clossys/foundry/pull/1316#issuecomment-5802195430
// -- #1316's out-of-band/breaking-change support and #1338's sibling-
// dependency-range rewriting touched the same core loop independently; this
// composes them, per this file's own header, "COMPOSING OUT-OF-BAND
// FILTERING WITH SIBLING DEPENDENCY RANGES". These three tests are the
// exact three interaction scenarios that composition review named.

test("COMPOSITION: an out-of-band-ineligible major is filtered out entirely, and its dependent's range is left completely untouched", () => {
  const root = makeRoot();
  try {
    // core's only pending changeset is an ordinary (non-out-of-band) major
    // -- major is never allowed out of band at all, but more fundamentally
    // it was never flagged `release: out-of-band` in the first place, so
    // --out-of-band filters it out before core is ever named.
    makePackage(root, "core", "1.2.3");
    writeChangeset(root, "core-break.md", "---\ncore: major\n---\n\nRemoved the deprecated foo() export.\n");

    // consumer depends on core via a range core's (never-applied) major
    // bump would break -- it must never be touched, because core was never
    // actually released this run.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^1.2.0");

    // An unrelated out-of-band patch proves this run does something, and
    // that the filtering above is selective, not a blanket no-op.
    makePackage(root, "unrelated", "0.1.0");
    writeChangeset(root, "unrelated-hotfix.md", "---\nunrelated: patch\nrelease: out-of-band\n---\n\nFix a security issue.\n");

    const result = applyReleaseChangesets({ root, outOfBandOnly: true, runNpmInstall: () => {}, today: () => "2026-09-23" });

    assert.equal(result.findings.length, 0);
    assert.deepEqual(result.applied.map((a) => a.package), ["unrelated"]);

    // core: completely untouched -- its major changeset is still pending,
    // to be picked up by the next ordinary Saturday release.
    const coreManifest = JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8"));
    assert.equal(coreManifest.version, "1.2.3");
    assert.equal(existsSync(join(root, ".changesets", "core-break.md")), true);

    // consumer: never even scanned for a stale range, because core was
    // never in bumpedVersions -- its manifest is byte-identical.
    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.version, "1.0.0");
    assert.equal(consumerManifest.dependencies["@x/core"], "^1.2.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("COMPOSITION: an ordinary in-band minor release crosses a sibling's declared range, and the dependent is rewritten exactly as it would be with no out-of-band feature involved", () => {
  const root = makeRoot();
  try {
    // No --out-of-band here at all -- this is the plain weekly Saturday
    // release path, proving the composed function's ordinary (non-filtered)
    // behavior is unchanged from #1338's own sibling-range rewriting.
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-feature.md", "---\ncore: minor\n---\n\nAdd a feature.\n");
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 2);

    const coreApplied = result.applied.find((a) => a.package === "core");
    assert.equal(coreApplied.toVersion, "0.10.0");
    assert.equal(coreApplied.outOfBand, false);

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.bump, "patch");
    assert.equal(consumerApplied.outOfBand, false, "a dependent-only bump is never out-of-band -- it did not consume an out-of-band-flagged changeset");
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    const consumerManifest = JSON.parse(readFileSync(join(root, "packages", "consumer", "package.json"), "utf8"));
    assert.equal(consumerManifest.dependencies["@x/core"], "^0.10.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("COMPOSITION (mixed run): an owner-approved out-of-band minor releases, its dependent gets an in-band dependent-only patch and range rewrite, and an unrelated ordinary changeset for a third package is left untouched", () => {
  const root = makeRoot();
  try {
    // core: out-of-band, owner-approved minor -- crosses consumer's ^0.9.0
    // range, exactly the case that needs a dependent-only bump to follow.
    makePackage(root, "core", "0.9.0");
    writeChangeset(root, "core-urgent.md", "---\ncore: minor\nrelease: out-of-band\nowner-approved: minor\n---\n\nClear an urgent update.\n");

    // consumer: no changeset of its own -- its bump is purely a consequence
    // of core's release, and per this file's header item 3 it must go
    // through even though the TRIGGERING run is --out-of-band.
    makePackageWithDependency(root, "consumer", "1.0.0", "@x/core", "^0.9.0");

    // standalone: an entirely unrelated package with an ORDINARY (not
    // out-of-band) pending minor changeset -- must be filtered out and
    // left pending, proving the out-of-band filter and the sibling-range
    // rewrite compose correctly in the same run rather than one silently
    // widening the other.
    makePackage(root, "standalone", "3.0.0");
    writeChangeset(root, "standalone-feature.md", "---\nstandalone: minor\n---\n\nAdd a feature to standalone (ordinary).\n");

    const result = applyReleaseChangesets({ root, outOfBandOnly: true, runNpmInstall: () => {}, today: () => "2026-09-23" });

    assert.equal(result.findings.length, 0);
    assert.deepEqual(result.applied.map((a) => a.package).sort(), ["consumer", "core"]);

    const coreApplied = result.applied.find((a) => a.package === "core");
    assert.equal(coreApplied.toVersion, "0.10.0");
    assert.equal(coreApplied.bump, "minor");
    assert.equal(coreApplied.outOfBand, true);

    const consumerApplied = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumerApplied.toVersion, "1.0.1");
    assert.equal(consumerApplied.bump, "patch");
    assert.equal(consumerApplied.outOfBand, false, "the dependent-only bump itself never consumed an out-of-band changeset");
    assert.deepEqual(consumerApplied.changesetFiles, []);
    assert.deepEqual(consumerApplied.dependencyUpdates, [{ section: "dependencies", name: "@x/core", fromRange: "^0.9.0", toRange: "^0.10.0" }]);

    // standalone: untouched, changeset still pending for the next ordinary
    // Saturday release.
    const standaloneManifest = JSON.parse(readFileSync(join(root, "packages", "standalone", "package.json"), "utf8"));
    assert.equal(standaloneManifest.version, "3.0.0");
    assert.equal(existsSync(join(root, ".changesets", "standalone-feature.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------- CLI: --json output must be pure JSON, even with real npm running
//
// Re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960
// blocking item 2: `runNpmInstall`'s default implementation used
// `stdio: "inherit"`, so real npm's own stdout chatter ("up to date,
// audited N packages...") interleaved into THIS process's stdout -- the
// SAME stream `main()` writes `--json` output to. `.github/workflows/
// release-pr.yml`'s `output="$(node ... --json)"; ... JSON.parse(...)`
// then throws on every release that actually applies something, already
// true on `main`. Every OTHER test in this file injects `runNpmInstall`
// (so it never touches real npm at all) -- this is the one test that
// spawns the REAL CLI as a subprocess with REAL npm, so it is the only
// one that could have caught this bug.
test("CLI: `node apply-release-changesets.mjs --json` produces stdout that is valid JSON, with real npm actually running", () => {
  const root = mkdtempSync(join(tmpdir(), "apply-release-changesets-cli-json-test-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-root", private: true, workspaces: ["packages/*"] }, null, 2) + "\n");
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" }, null, 2) + "\n");
    writeFileSync(changelogFile(root, "alpha"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    // A genuine base lockfile, from real npm -- offline, since the fixture
    // has no external dependency for it to resolve.
    execFileSync("npm", ["install", "--package-lock-only", "--offline"], { cwd: root, stdio: "ignore" });

    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "alpha-fix.md"), "---\nalpha: patch\n---\n\nFix a bug.\n");

    const stdout = execFileSync(process.execPath, [scriptPath, "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    let parsed;
    let threw = false;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, `stdout was not valid JSON -- real npm's own output likely leaked into it:\n${stdout}`);
    assert.equal(parsed.applied.length, 1);
    assert.equal(parsed.applied[0].package, "alpha");
    assert.equal(parsed.applied[0].toVersion, "1.0.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- changelog location

test("applyReleaseChangesets: writes the entry to docs/changelogs/<dir>.md, creating that directory, and never writes a changelog inside the package", () => {
  const root = makeRoot();
  try {
    const pkgDir = makePackage(root, "alpha", "1.0.0");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");
    assert.equal(existsSync(join(root, "docs", "changelogs")), false, "fixture precondition: no docs/changelogs yet");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied[0].changelog, "docs/changelogs/alpha.md");
    assert.equal(
      readFileSync(join(root, "docs", "changelogs", "alpha.md"), "utf8"),
      "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fix a bug.\n",
    );
    assert.equal(existsSync(join(pkgDir, "CHANGELOG.md")), false, "a changelog inside the package would ship in the tarball");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a dependent-only bump's entry also goes to docs/changelogs/<dir>.md", () => {
  const root = makeRoot();
  try {
    makePackage(root, "core", "0.9.0");
    const consumerDir = join(root, "packages", "consumer");
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(
      join(consumerDir, "package.json"),
      `{\n  "name": "@x/consumer",\n  "version": "1.0.0",\n  "dependencies": {\n    "@x/core": "^0.9.0"\n  }\n}\n`,
    );
    writeChangeset(root, "core-minor.md", "---\ncore: minor\n---\n\nAdd a thing.\n");

    const result = applyReleaseChangesets({ root, runNpmInstall: () => {}, today: () => "2026-09-22" });

    assert.equal(result.findings.length, 0);
    const consumer = result.applied.find((a) => a.package === "consumer");
    assert.equal(consumer.changelog, "docs/changelogs/consumer.md");
    assert.match(readFileSync(join(root, "docs", "changelogs", "consumer.md"), "utf8"), /Updated dependency @x\/core to \^0\.10\.0/);
    assert.equal(existsSync(join(consumerDir, "CHANGELOG.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: --dry-run names each package's docs/changelogs/<dir>.md entry and writes nothing", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "1.0.0");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    const stdout = execFileSync(process.execPath, [scriptPath, "--dry-run"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    assert.match(stdout, /alpha: 1\.0\.0 -> 1\.0\.1 \(patch\)/);
    assert.match(stdout, /changelog entry: docs\/changelogs\/alpha\.md/);
    assert.equal(existsSync(join(root, "docs", "changelogs")), false, "--dry-run must not create the changelog directory");
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release-pr.yml stages docs/changelogs/, where this script writes every changelog entry", () => {
  // The release workflow commits only the paths its `git add` names. A
  // changelog entry written outside them would be left out of the release
  // commit, silently -- so the staged set must cover the changelog location.
  const workflow = readFileSync(resolve(dirname(scriptPath), "..", ".github", "workflows", "release-pr.yml"), "utf8");
  const addLines = workflow.split("\n").filter((line) => /^\s*git add -A -- /.test(line));
  assert.equal(addLines.length, 1, "expected exactly one `git add -A -- ...` line in release-pr.yml");
  const staged = addLines[0].trim().replace(/^git add -A -- /, "").split(/\s+/);
  assert.ok(staged.includes(CHANGELOGS_DIR), `release-pr.yml stages ${JSON.stringify(staged)}, not ${CHANGELOGS_DIR}`);
  for (const path of ["packages", ".changesets", "package-lock.json"]) assert.ok(staged.includes(path), `release-pr.yml no longer stages ${path}`);
});
