import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// CLI-level coverage. scripts/lib/release-calendar.test.mjs already covers
// evaluateReleaseCalendarGate()'s pure logic exhaustively (DST, the
// footprint check, every branch pass/fail combination); this file only
// proves the thin argv/exit-code/JSON wrapper around it is wired
// correctly, the same split check-release-pr-shape.mjs and its test use.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-release-calendar.mjs");

const RELEASE_SHAPED_FILES = JSON.stringify([
  { path: "packages/controller/package.json", status: "modified" },
  { path: "packages/controller/CHANGELOG.md", status: "modified" },
  { path: "package-lock.json", status: "modified" },
  { path: ".changesets/controller-fix.md", status: "removed" },
]);

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

// 2026-01-07 is a Wednesday, 2026-01-03 a Saturday, in America/Los_Angeles, at 20:00 UTC.
const WEDNESDAY = "2026-01-07T20:00:00Z";
const SATURDAY = "2026-01-03T20:00:00Z";

test("passes on a merge-window weekday regardless of changed files or labels", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", WEDNESDAY, "--changed-files", "[]"], root);
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.status, "pass");
    assert.equal(report.dayType, "merge-window");
  });
});

test("fails an ordinary PR on release day and reports the next merge window", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--changed-files", JSON.stringify([{ path: "packages/controller/src/index.ts", status: "modified" }])], root);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.status, "fail");
    assert.equal(report.dayType, "release");
    assert.equal(report.nextMergeWindowStart, "2026-01-05");
  });
});

test("a branch merely NAMED like a release PR, with no label and an ordinary diff, still fails", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--changed-files", JSON.stringify([{ path: "packages/controller/src/index.ts", status: "modified" }])], root);
    assert.equal(r.code, 1, r.out);
  });
});

test("passes the release PR itself on release day -- the release:weekly label AND a release-PR-shaped diff, together", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--changed-files", RELEASE_SHAPED_FILES, "--labels", "release:weekly"], root);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).status, "pass");
  });
});

test("the label alone, without the release-PR-shaped diff, still fails", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--changed-files", JSON.stringify([{ path: "packages/controller/src/index.ts", status: "modified" }]), "--labels", "release:weekly"], root);
    assert.equal(r.code, 1, r.out);
  });
});

test("passes a release:out-of-band labelled PR on release day, independent of diff shape", () => {
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
