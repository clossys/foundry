import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// CLI-level coverage. scripts/lib/release-calendar.test.mjs and
// scripts/lib/release-pr-footprint.test.mjs already cover the pure logic
// exhaustively (DST, the label+footprint combination, every adversarial
// content-level case); this file proves the git/npm integration and the
// argv/exit-code/JSON wrapper around them are wired correctly -- real git
// repos under mkdtemp, matching scripts/check-release-pr-shape.test.mjs's
// own hermetic pattern. None of these tests touch the network: every
// fixture that includes a package-lock.json change is deliberately absent
// here (verifyLockfileRegeneration's own unit coverage lives in
// scripts/lib/release-pr-footprint.test.mjs, with an injected fake npm) --
// this file only needs to prove that when a lockfile IS present in a real
// diff, the CLI treats it as "unverified" and fails closed, which needs no
// real npm run to demonstrate.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-release-calendar.mjs");

function writeCalendar(root) {
  mkdirSync(join(root, "governance"), { recursive: true });
  writeFileSync(
    join(root, "governance", "release-calendar.json"),
    JSON.stringify({
      timezone: "America/Los_Angeles",
      mergeWindow: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], closesOn: "Friday" },
      releaseDay: "Saturday",
      adoptionDay: "Sunday",
      outOfBandPolicy: { changesetFlag: "release:out-of-band" },
      releasePrPolicy: { label: "release:weekly" },
    }),
  );
}

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withRoot(build) {
  const root = mkdtempSync(join(tmpdir(), "check-release-calendar-test-"));
  try {
    writeCalendar(root);
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

function withGitRoot(build) {
  withRoot((root) => {
    git(["init", "-q"], root);
    build(root);
  });
}

function writeManifest(dir, manifest) {
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

// 2026-01-07 is a Wednesday, 2026-01-03 a Saturday, in America/Los_Angeles, at 20:00 UTC.
const WEDNESDAY = "2026-01-07T20:00:00Z";
const SATURDAY = "2026-01-03T20:00:00Z";

test("passes on a merge-window weekday regardless of changed files, labels, or missing --base/--head", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", WEDNESDAY, "--changed-files", "[]"], root);
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.status, "pass");
    assert.equal(report.dayType, "merge-window");
  });
});

test("fails an ordinary PR on release day with no label", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--changed-files", JSON.stringify([{ path: "packages/alpha/src/index.ts", status: "modified" }])], root);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.status, "fail");
    assert.equal(report.nextMergeWindowStart, "2026-01-05");
  });
});

test("passes a real release-shaped diff on release day -- label AND a verified footprint (real git content, no lockfile involved)", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0" });
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "alpha-fix.md"), "---\nalpha: patch\n---\n\nFix a bug.\n");
    const base = gitCommit(root, "base");

    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1" });
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.1\n\n- Fix a bug.\n\n## 1.0.0\n\n- Initial release.\n");
    rmSync(join(root, ".changesets", "alpha-fix.md"));
    const head = gitCommit(root, "release");

    const changedFiles = [
      { path: "packages/alpha/package.json", status: "modified" },
      { path: "packages/alpha/CHANGELOG.md", status: "modified" },
      { path: ".changesets/alpha-fix.md", status: "removed" },
    ];
    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly"], root);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).status, "pass");
  });
});

test("ADVERSARIAL: the release:weekly label alone does not save a diff with a smuggled dependency addition", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0", dependencies: { foo: "^1.0.0" } });
    const base = gitCommit(root, "base");

    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1", dependencies: { foo: "^1.0.0", evil: "^9.9.9" } });
    const head = gitCommit(root, "release");

    const changedFiles = [{ path: "packages/alpha/package.json", status: "modified" }];
    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly"], root);
    assert.equal(r.code, 1, r.out);
    assert.equal(JSON.parse(r.out).status, "fail");
  });
});

test("ADVERSARIAL: a new (added) changeset smuggled in among an otherwise-clean diff fails", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0" });
    const base = gitCommit(root, "base");

    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1" });
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "sneaky.md"), "---\nalpha: major\n---\n\nSmuggled.\n");
    const head = gitCommit(root, "release");

    const changedFiles = [
      { path: "packages/alpha/package.json", status: "modified" },
      { path: ".changesets/sneaky.md", status: "added" },
    ];
    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly"], root);
    assert.equal(r.code, 1, r.out);
  });
});

test("a lockfile change present in the diff is unverified (no real npm run) and fails closed even with the label", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0" });
    writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
    const base = gitCommit(root, "base");

    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1" });
    writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3,"changed":true}\n');
    const head = gitCommit(root, "release");

    const changedFiles = [
      { path: "packages/alpha/package.json", status: "modified" },
      { path: "package-lock.json", status: "modified" },
    ];
    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly"], root);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.footprintVerified, false);
  });
});

test("--files-unreadable fails closed regardless of label or an otherwise-clean --changed-files list (pagination fail-closed)", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0" });
    const base = gitCommit(root, "base");
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1" });
    const head = gitCommit(root, "release");

    const changedFiles = [{ path: "packages/alpha/package.json", status: "modified" }];
    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly", "--files-unreadable"], root);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.footprintVerified, false);
    assert.match(report.footprintReason, /could not be fully read/);
  });
});

test("PAGINATION: a changed-files list with more than 100 entries is fully read, not truncated -- a bad file at position 101+ is still caught", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0" });
    mkdirSync(join(root, ".changesets"), { recursive: true });
    const changesetNames = [];
    for (let i = 0; i < 120; i += 1) {
      const name = `fix-${String(i).padStart(3, "0")}.md`;
      writeFileSync(join(root, ".changesets", name), `---\nalpha: patch\n---\n\nFix ${i}.\n`);
      changesetNames.push(name);
    }
    const base = gitCommit(root, "base with 120 pending changesets");

    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1" });
    for (const name of changesetNames) rmSync(join(root, ".changesets", name));
    // Smuggle a NEW changeset in near the end of a >100-file diff.
    writeFileSync(join(root, ".changesets", "sneaky-121.md"), "---\nalpha: major\n---\n\nSmuggled among the noise.\n");
    const head = gitCommit(root, "release consuming 120, plus one smuggled addition");

    const changedFiles = [
      { path: "packages/alpha/package.json", status: "modified" },
      ...changesetNames.map((name) => ({ path: `.changesets/${name}`, status: "removed" })),
      { path: ".changesets/sneaky-121.md", status: "added" },
    ];
    assert.ok(changedFiles.length > 100, "fixture must exceed 100 files to exercise pagination-scale handling");

    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly"], root);
    assert.equal(r.code, 1, r.out); // must fail -- the smuggled file must not be silently dropped by any truncation
  });
});

test("PAGINATION: the same fixture with the smuggled file removed (a genuinely clean >100-file release) passes", () => {
  withGitRoot((root) => {
    const pkgDir = join(root, "packages", "alpha");
    mkdirSync(pkgDir, { recursive: true });
    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.0" });
    mkdirSync(join(root, ".changesets"), { recursive: true });
    const changesetNames = [];
    for (let i = 0; i < 120; i += 1) {
      const name = `fix-${String(i).padStart(3, "0")}.md`;
      writeFileSync(join(root, ".changesets", name), `---\nalpha: patch\n---\n\nFix ${i}.\n`);
      changesetNames.push(name);
    }
    const base = gitCommit(root, "base with 120 pending changesets");

    writeManifest(pkgDir, { name: "@x/alpha", version: "1.0.1" });
    for (const name of changesetNames) rmSync(join(root, ".changesets", name));
    const head = gitCommit(root, "release consuming all 120, cleanly");

    const changedFiles = [{ path: "packages/alpha/package.json", status: "modified" }, ...changesetNames.map((name) => ({ path: `.changesets/${name}`, status: "removed" }))];
    assert.ok(changedFiles.length > 100, "fixture must exceed 100 files");

    const r = run(["--json", "--now", SATURDAY, "--base", base, "--head", head, "--changed-files", JSON.stringify(changedFiles), "--labels", "release:weekly"], root);
    assert.equal(r.code, 0, r.out);
  });
});

test("passes a release:out-of-band labelled PR on release day without needing --base/--head at all", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--changed-files", "[]", "--labels", "release:out-of-band,another-label"], root);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).status, "pass");
  });
});

test("non-JSON output is human-readable and still reflects the exit code", () => {
  withRoot((root) => {
    const r = run(["--now", SATURDAY, "--changed-files", "[]"], root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL/);
  });
});

test("exits 2 on a malformed --changed-files value", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", WEDNESDAY, "--changed-files", "not-json"], root);
    assert.equal(r.code, 2, r.out);
  });
});

test("exits 2 when governance/release-calendar.json is missing, never silently passing", () => {
  const root = mkdtempSync(join(tmpdir(), "check-release-calendar-test-"));
  try {
    const r = run(["--json", "--now", WEDNESDAY, "--changed-files", "[]"], root);
    assert.equal(r.code, 2, r.out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
