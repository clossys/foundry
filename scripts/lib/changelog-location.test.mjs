import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CHANGELOG_REL_PATH_RE,
  CHANGELOGS_DIR,
  changelogPath,
  changelogPathForPackageDir,
  changelogPublicUrl,
  changelogRelPath,
} from "./changelog-location.mjs";

test("the changelog for packages/<dir> is docs/changelogs/<dir>.md", () => {
  assert.equal(CHANGELOGS_DIR, "docs/changelogs");
  assert.equal(changelogRelPath("advisor"), "docs/changelogs/advisor.md");
  assert.equal(changelogPath("/repo", "advisor"), join("/repo", "docs", "changelogs", "advisor.md"));
  assert.equal(changelogPathForPackageDir("/repo/packages/advisor"), join("/repo", "docs", "changelogs", "advisor.md"));
  assert.equal(changelogPathForPackageDir("/repo/packages/advisor/"), join("/repo", "docs", "changelogs", "advisor.md"));
  assert.equal(changelogPathForPackageDir("packages/advisor"), resolve("docs", "changelogs", "advisor.md"));
});

test("CHANGELOG_REL_PATH_RE matches a package changelog and nothing else", () => {
  assert.equal(CHANGELOG_REL_PATH_RE.exec("docs/changelogs/advisor.md")?.[1], "advisor");
  for (const path of [
    "docs/changelogs/README.md",
    "docs/changelogs/advisor/extra.md",
    "docs/changelogs/advisor.txt",
    "packages/advisor/CHANGELOG.md",
    "CHANGELOG.md",
    "x/docs/changelogs/advisor.md",
  ]) {
    assert.equal(CHANGELOG_REL_PATH_RE.test(path), false, path);
  }
});

test("changelogPublicUrl derives the link from the manifest's own repository field", () => {
  const expected = "https://github.com/owner/repo/blob/main/docs/changelogs/advisor.md";
  assert.equal(changelogPublicUrl({ type: "git", url: "git+https://github.com/owner/repo.git" }, "advisor"), expected);
  assert.equal(changelogPublicUrl("https://github.com/owner/repo", "advisor"), expected);
  assert.equal(changelogPublicUrl("https://github.com/owner/repo.git", "advisor"), expected);
});

test("changelogPublicUrl returns null for a repository it cannot read as GitHub HTTPS", () => {
  for (const repository of [undefined, null, {}, "git@github.com:owner/repo.git", "https://gitlab.com/owner/repo", "github:owner/repo", "https://github.com/owner"]) {
    assert.equal(changelogPublicUrl(repository, "advisor"), null, JSON.stringify(repository));
  }
});
