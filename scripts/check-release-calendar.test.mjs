import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// CLI-level coverage. scripts/lib/release-calendar.test.mjs already covers
// evaluateReleaseCalendarGate()'s pure logic exhaustively (DST, week 53,
// the week-year crossing, every branch pass/fail combination); this file
// only proves the thin argv/exit-code/JSON wrapper around it is wired
// correctly, the same split check-release-pr-shape.mjs and its test use.

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

test("passes on a merge-window weekday regardless of head ref or labels", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", WEDNESDAY, "--head-ref", "some-feature"], root);
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.status, "pass");
    assert.equal(report.dayType, "merge-window");
  });
});

test("fails an ordinary PR on release day and reports the next merge window", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--head-ref", "some-feature"], root);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.status, "fail");
    assert.equal(report.dayType, "release");
    assert.equal(report.nextMergeWindowStart, "2026-01-05");
  });
});

test("passes the release PR itself on release day, by head ref", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--head-ref", "claude/release-2026-01-03-1234567"], root);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).status, "pass");
  });
});

test("passes a release:out-of-band labelled PR on release day", () => {
  withRoot((root) => {
    const r = run(["--json", "--now", SATURDAY, "--head-ref", "hotfix-branch", "--labels", "release:out-of-band,another-label"], root);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).status, "pass");
  });
});

test("non-JSON output is human-readable and still reflects the exit code", () => {
  withRoot((root) => {
    const r = run(["--now", SATURDAY, "--head-ref", "some-feature"], root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL/);
  });
});

test("exits 2 when governance/release-calendar.json is missing, never silently passing", () => {
  const root = mkdtempSync(join(tmpdir(), "check-release-calendar-test-"));
  try {
    const r = run(["--json", "--now", WEDNESDAY, "--head-ref", "x"], root);
    assert.equal(r.code, 2, r.out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
