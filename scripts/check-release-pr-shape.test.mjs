import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { computeBumpLevel, parseSemver } from "./check-release-pr-shape.mjs";

// Hermetic end-to-end coverage, matching check-release-readiness.test.mjs's
// own real-git-repo-under-mkdtemp shape.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-release-pr-shape.mjs");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

function writeManifest(pkgDir, manifest) {
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function readManifest(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
}

function makeFixture(root, { name = "probe", version = "1.0.0" } = {}) {
  const pkgDir = join(root, "packages", name);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeManifest(pkgDir, { name: `@gate-fixture/${name}`, version, private: false, license: "MIT", files: ["src", "README.md", "LICENSE"] });
  writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(pkgDir, "README.md"), `# ${name}\n`);
  writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
  return pkgDir;
}

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withRepo(build) {
  const root = mkdtempSync(join(tmpdir(), "release-pr-shape-test-"));
  try {
    git(["init", "-q"], root);
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- unit coverage

test("parseSemver: parses a plain X.Y.Z, rejects anything else", () => {
  assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
  assert.equal(parseSemver("1.2.3-beta.1"), null);
  assert.equal(parseSemver("v1.2.3"), null);
  assert.equal(parseSemver("1.2"), null);
});

test("computeBumpLevel: classifies patch/minor/major and rejects malformed bumps", () => {
  assert.equal(computeBumpLevel("1.0.0", "1.0.1"), "patch");
  assert.equal(computeBumpLevel("1.0.0", "1.1.0"), "minor");
  assert.equal(computeBumpLevel("1.0.0", "2.0.0"), "major");
  assert.equal(computeBumpLevel("1.0.0", "1.2.0"), null); // skipped a minor
  assert.equal(computeBumpLevel("1.0.0", "1.1.1"), null); // minor bump must reset patch
  assert.equal(computeBumpLevel("1.0.5", "1.0.4"), null); // went backwards
  assert.equal(computeBumpLevel("1.0.0", "1.0.0"), null); // no change
});

// ---------------------------------------------------------------- end-to-end coverage

test("no version change: passes with nothing to judge", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");
    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
  });
});

test("version bump justified by a consumed matching-level changeset passes", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");
    const base = gitCommit(root, "pending changeset for probe");

    // The release PR: bump the version and delete the changeset it applied.
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-fix.md"));

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /release-PR shaped/);
  });
});

test("version bump with a consumed changeset at the WRONG level fails", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");
    const base = gitCommit(root, "pending patch changeset for probe");

    // Bumped a MINOR instead of the patch the changeset named.
    const manifest = readManifest(pkgDir);
    manifest.version = "1.1.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-fix.md"));

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /specify patch/);
  });
});

test("a consumed major-level changeset requires a Breaking changes CHANGELOG section", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-break.md"), "---\nprobe: major\n---\n\nRemoved the deprecated foo() export.\n");
    const base = gitCommit(root, "pending major changeset for probe");

    const manifest = readManifest(pkgDir);
    manifest.version = "2.0.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-break.md"));
    // Deliberately NOT writing a CHANGELOG.md Breaking changes section.

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /Breaking changes/);
  });
});

test("a consumed major-level changeset WITH a Breaking changes CHANGELOG section passes", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-break.md"), "---\nprobe: major\n---\n\nRemoved the deprecated foo() export.\n");
    const base = gitCommit(root, "pending major changeset for probe");

    const manifest = readManifest(pkgDir);
    manifest.version = "2.0.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-break.md"));
    writeFileSync(
      join(pkgDir, "CHANGELOG.md"),
      "# Changelog\n\n## 2.0.0 - 2026-09-26\n\n### Breaking changes\n\n- Removed the deprecated foo() export.\n\n- Removed the deprecated foo() export.\n",
    );

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
  });
});

test("version bump with a matching CHANGELOG.md entry and no changeset passes (direct-bump path)", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    const base = gitCommit(root, "initial release at 1.0.0");

    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.1\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /matching CHANGELOG\.md entry/);
  });
});

test("version bump with neither a consumed changeset nor a CHANGELOG entry is refused", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /version change outside a release PR is refused/);
  });
});

test("a pending (still-unconsumed) changeset alongside a direct version bump does not by itself justify it", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "unrelated.md"), "---\nprobe: minor\n---\n\nSome other pending change.\n");
    const base = gitCommit(root, "pending changeset for probe, unrelated to this bump");

    // Bumps the version directly WITHOUT consuming (deleting) the pending changeset.
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
  });
});

test("exits 2 on an empty scan rather than a silent clean pass", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });
    writeFileSync(join(root, "packages", ".gitkeep"), "");
    gitCommit(root, "empty packages dir");
    const r = run(["--json"], root);
    assert.equal(r.code, 2, r.out);
  });
});
