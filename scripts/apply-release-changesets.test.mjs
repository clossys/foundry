import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyReleaseChangesets, bumpManifestText, namedPackages, prependChangelogEntry } from "./apply-release-changesets.mjs";

const TEST_CALENDAR = {
  timezone: "America/Los_Angeles",
  mergeWindow: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], closesOn: "Friday" },
  releaseDay: "Saturday",
  adoptionDay: "Sunday",
  outOfBandPolicy: { changesetFlag: "release:out-of-band" },
};

// 2026-09-26 20:00 UTC is Saturday in America/Los_Angeles, ISO week 39 of week-year 2026 -- see scripts/lib/release-calendar.test.mjs for the same fixed point.
const SATURDAY_2026_W39 = () => new Date(Date.UTC(2026, 8, 26, 20, 0, 0));

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

test("bumpManifestText: replaces only the top-level version field, byte-exact elsewhere", () => {
  const text = '{\n  "name": "@x/y",\n  "version": "1.0.0",\n  "dependencies": {\n    "z": "^1.0.0"\n  }\n}\n';
  const result = bumpManifestText(text, "26.39.0");
  assert.equal(result, '{\n  "name": "@x/y",\n  "version": "26.39.0",\n  "dependencies": {\n    "z": "^1.0.0"\n  }\n}\n');
});

test("bumpManifestText: throws if the version field cannot be found exactly once", () => {
  assert.throws(() => bumpManifestText('{\n  "name": "@x/y"\n}\n', "26.39.0"));
});

test("namedPackages: unions across every changeset entry", () => {
  const entries = [
    { file: "a.md", packages: { alpha: "patch" }, summary: "s" },
    { file: "b.md", packages: { alpha: "minor", beta: "patch" }, summary: "s" },
  ];
  assert.deepEqual(namedPackages(entries), ["alpha", "beta"]);
});

test("prependChangelogEntry: inserts above the first existing entry", () => {
  const existing = "# Changelog\n\n## 26.38.0\n\n- Initial release.\n";
  const result = prependChangelogEntry(existing, { version: "26.39.0", date: "2026-09-26", bullets: ["Fixed a bug."] });
  assert.equal(result, "# Changelog\n\n## 26.39.0 - 2026-09-26\n\n- Fixed a bug.\n\n## 26.38.0\n\n- Initial release.\n");
});

test("prependChangelogEntry: creates a fresh changelog when none exists", () => {
  const result = prependChangelogEntry(null, { version: "26.39.0", date: "2026-09-26", bullets: ["First release."] });
  assert.equal(result, "# Changelog\n\n## 26.39.0 - 2026-09-26\n\n- First release.\n");
});

test("prependChangelogEntry: a major-level changeset produces a Breaking changes subsection above the full bullet list", () => {
  const result = prependChangelogEntry(null, {
    version: "26.39.0",
    date: "2026-09-26",
    bullets: ["Fixed a bug.", "Removed the deprecated foo() export."],
    breakingBullets: ["Removed the deprecated foo() export."],
  });
  assert.equal(
    result,
    "# Changelog\n\n## 26.39.0 - 2026-09-26\n\n### Breaking changes\n\n- Removed the deprecated foo() export.\n\n- Fixed a bug.\n- Removed the deprecated foo() export.\n",
  );
});

// ---------------------------------------------------------------- end-to-end coverage

test("applyReleaseChangesets: the one-time transition from 0.x.y goes straight to this week's calver version", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "0.9.12");
    writeFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "# Changelog\n\n## 0.9.12\n\n- Initial release.\n");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");
    writeChangeset(root, "alpha-feature.md", "---\nalpha: minor\n---\n\nAdd a feature.\n");

    let npmInstallCalledWith = null;
    const result = applyReleaseChangesets({
      root,
      calendar: TEST_CALENDAR,
      now: SATURDAY_2026_W39,
      runNpmInstall: (r) => {
        npmInstallCalledWith = r;
      },
    });

    assert.equal(result.findings.length, 0);
    assert.equal(result.applied.length, 1);
    assert.deepEqual(result.applied[0], {
      package: "alpha",
      fromVersion: "0.9.12",
      toVersion: "26.39.0",
      kind: "transition",
      level: "minor", // highest of patch/minor, kept as an informational signal only
      outOfBand: false,
      breaking: false,
      breakingSummaries: [],
      changesetFiles: ["alpha-feature.md", "alpha-fix.md"],
    });

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "26.39.0");

    const changelog = readFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "utf8");
    assert.match(changelog, /## 26\.39\.0 - 2026-09-26/);
    assert.match(changelog, /Fix a bug\./);
    assert.match(changelog, /Add a feature\./);

    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), false);
    assert.equal(existsSync(join(root, ".changesets", "alpha-feature.md")), false);

    assert.equal(npmInstallCalledWith, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a package already on calver from an earlier week moves to this week, N=0", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "26.38.0");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    const result = applyReleaseChangesets({ root, calendar: TEST_CALENDAR, now: SATURDAY_2026_W39, runNpmInstall: () => {} });
    assert.equal(result.applied[0].toVersion, "26.39.0");
    assert.equal(result.applied[0].kind, "weekly");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a major-level changeset produces a breaking CHANGELOG entry and a truthy `breaking` flag", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "26.38.0");
    writeChangeset(root, "alpha-break.md", "---\nalpha: major\n---\n\nRemoved the deprecated foo() export.\n");

    const result = applyReleaseChangesets({ root, calendar: TEST_CALENDAR, now: SATURDAY_2026_W39, runNpmInstall: () => {} });
    assert.equal(result.applied[0].toVersion, "26.39.0"); // CalVer -- major level does NOT change the version shape
    assert.equal(result.applied[0].level, "major");
    assert.equal(result.applied[0].breaking, true);
    assert.deepEqual(result.applied[0].breakingSummaries, ["Removed the deprecated foo() export."]);

    const changelog = readFileSync(join(root, "packages", "alpha", "CHANGELOG.md"), "utf8");
    assert.match(changelog, /### Breaking changes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: an out-of-band changeset bumps N on a package already released this week", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "26.39.0"); // already released this ISO week
    writeChangeset(root, "alpha-hotfix.md", "---\nalpha: patch\nrelease: out-of-band\n---\n\nFix a security issue.\n");

    const result = applyReleaseChangesets({ root, calendar: TEST_CALENDAR, now: SATURDAY_2026_W39, runNpmInstall: () => {} });
    assert.equal(result.findings.length, 0);
    assert.equal(result.applied[0].toVersion, "26.39.1");
    assert.equal(result.applied[0].kind, "out-of-band");
    assert.equal(result.applied[0].outOfBand, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: a same-week bump with no out-of-band flag is a finding, not a silent collision", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "26.39.0"); // already released this ISO week
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n"); // no out-of-band flag

    const result = applyReleaseChangesets({ root, calendar: TEST_CALENDAR, now: SATURDAY_2026_W39, runNpmInstall: () => {} });
    assert.equal(result.applied.length, 0);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /already released this ISO week/);

    // Nothing was written or deleted -- refusing to apply means refusing to apply.
    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "26.39.0");
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: --dry-run touches nothing and never calls npm", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "0.9.12");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");

    let npmInstallCalled = false;
    const result = applyReleaseChangesets({ root, calendar: TEST_CALENDAR, now: SATURDAY_2026_W39, dryRun: true, runNpmInstall: () => (npmInstallCalled = true) });

    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].toVersion, "26.39.0");
    assert.equal(npmInstallCalled, false);

    const manifest = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(manifest.version, "0.9.12"); // unchanged
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), true); // not deleted
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyReleaseChangesets: no pending changesets is a clean no-op (and never even reads the calendar)", () => {
  const root = makeRoot();
  try {
    makePackage(root, "alpha", "0.9.12");
    let npmInstallCalled = false;
    // No `calendar` passed and no governance/release-calendar.json on disk --
    // this must not throw, because there is nothing pending to compute a version for.
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
    makePackage(root, "alpha", "0.9.12");
    writeChangeset(root, "bad.md", "not a changeset\n");
    const result = applyReleaseChangesets({ root, calendar: TEST_CALENDAR, now: SATURDAY_2026_W39 });
    assert.equal(result.applied.length, 0);
    assert.equal(result.changesetFindings.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
