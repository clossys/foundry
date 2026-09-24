import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateChangelogLocation } from "./check-changelog-location.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-changelog-location.mjs");
const REPOSITORY = { type: "git", url: "git+https://github.com/gate-fixture-owner/example-repo.git", directory: "packages/alpha" };
const URL = "https://github.com/gate-fixture-owner/example-repo/blob/main/docs/changelogs/alpha.md";

// A repository whose one package, alpha, passes every rule. Each test then
// breaks exactly one thing.
function withRepo(fn, { manifest = {}, readme, changelog = "# Changelog\n\n## 1.2.3 - 2026-09-01\n\n- Initial.\n" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-changelog-location-test-"));
  try {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@x/alpha", version: "1.2.3", files: ["src", "README.md", "LICENSE"], repository: REPOSITORY, ...manifest }, null, 2) + "\n",
    );
    writeFileSync(join(pkgDir, "README.md"), readme ?? `# alpha\n\n## Changelog\n\nSee the [changelog](${URL}).\n`);
    if (changelog !== null) {
      mkdirSync(join(root, "docs", "changelogs"), { recursive: true });
      writeFileSync(join(root, "docs", "changelogs", "alpha.md"), changelog);
    }
    fn(root, pkgDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const rules = (result) => result.findings.map((f) => f.rule);

test("a package whose changelog is at docs/changelogs/<dir>.md, has a current entry, does not ship, and is linked passes", () => {
  withRepo((root) => {
    const result = evaluateChangelogLocation(root);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.checked, ["alpha"]);
  });
});

test("rule 1: a missing docs/changelogs/<dir>.md fails", () => {
  withRepo(
    (root) => {
      assert.deepEqual(rules(evaluateChangelogLocation(root)), ["changelog-exists"]);
    },
    { changelog: null },
  );
});

test("rule 2: a changelog with no entry for the manifest's current version fails", () => {
  withRepo(
    (root) => {
      const result = evaluateChangelogLocation(root);
      assert.deepEqual(rules(result), ["changelog-current-entry"]);
      assert.match(result.findings[0].message, /no "## 1\.2\.3" entry/);
    },
    { changelog: "# Changelog\n\n## 1.2.2 - 2026-08-01\n\n- Older.\n" },
  );
});

test("rule 2: a Keep-a-Changelog bracketed heading counts as the current entry", () => {
  withRepo((root) => assert.deepEqual(evaluateChangelogLocation(root).findings, []), { changelog: "# Changelog\n\n## [1.2.3] - 2026-09-01\n\n- Initial.\n" });
});

test("rule 3: a changelog left inside the package fails, whatever its case", () => {
  withRepo((root, pkgDir) => {
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n");
    writeFileSync(join(pkgDir, "changelog"), "stale\n");
    const result = evaluateChangelogLocation(root);
    assert.deepEqual(rules(result), ["no-in-package-changelog", "no-in-package-changelog"]);
  });
});

test("rule 4: a `files` entry naming a changelog fails; an exclusion of one does not", () => {
  withRepo(
    (root) => {
      const result = evaluateChangelogLocation(root);
      assert.deepEqual(rules(result), ["files-excludes-changelog", "files-excludes-changelog"]);
      assert.match(result.findings[0].message, /"CHANGELOG\.md"/);
      assert.match(result.findings[1].message, /"docs\/Changelog\.md"/);
    },
    { manifest: { files: ["src", "CHANGELOG.md", "docs/Changelog.md", "!CHANGELOG.md", "README.md"] } },
  );
});

test("rule 5: a README that does not link the absolute public changelog URL fails", () => {
  withRepo(
    (root) => {
      const result = evaluateChangelogLocation(root);
      assert.deepEqual(rules(result), ["readme-links-changelog"]);
      assert.match(result.findings[0].message, /does not link to https:\/\/github\.com\/gate-fixture-owner\/example-repo\/blob\/main\/docs\/changelogs\/alpha\.md/);
    },
    { readme: "# alpha\n\nSee [the changelog](CHANGELOG.md).\n" },
  );
});

test("rule 5: a `repository` the link cannot be derived from fails rather than guessing", () => {
  withRepo((root) => assert.deepEqual(rules(evaluateChangelogLocation(root)), ["readme-links-changelog"]), { manifest: { repository: undefined } });
});

test("CLI: exit 0 on a clean tree, 1 on a finding, 2 when there is nothing to check", () => {
  withRepo((root) => {
    execFileSync(process.execPath, [scriptPath, root], { encoding: "utf8", stdio: "pipe" });
  });
  withRepo(
    (root) => {
      let status = 0;
      let out = "";
      try {
        execFileSync(process.execPath, [scriptPath, "--json", root], { encoding: "utf8", stdio: "pipe" });
      } catch (error) {
        status = error.status;
        out = error.stdout;
      }
      assert.equal(status, 1);
      assert.deepEqual(JSON.parse(out).findings.map((f) => f.rule), ["changelog-exists"]);
    },
    { changelog: null },
  );
  const empty = mkdtempSync(join(tmpdir(), "check-changelog-location-empty-"));
  try {
    mkdirSync(join(empty, "packages"));
    let status = 0;
    try {
      execFileSync(process.execPath, [scriptPath, empty], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      status = error.status;
    }
    assert.equal(status, 2);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("rule 5 is not applied to a private package, which is never installed; rules 1-4 still are", () => {
  withRepo(
    (root, pkgDir) => {
      assert.deepEqual(evaluateChangelogLocation(root).findings, []);
      writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n");
      assert.deepEqual(rules(evaluateChangelogLocation(root)), ["no-in-package-changelog"]);
    },
    { manifest: { private: true, repository: undefined }, readme: "# alpha\n" },
  );
});
