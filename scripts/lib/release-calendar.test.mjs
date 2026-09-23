import assert from "node:assert/strict";
import test from "node:test";
import {
  dayTypeFor,
  evaluateReleaseCalendarGate,
  isReleasePrFootprint,
  nextMergeWindowStart,
  shouldOpenReleasePr,
  zonedDateParts,
} from "./release-calendar.mjs";

const TZ = "America/Los_Angeles";

const CALENDAR = {
  timezone: TZ,
  mergeWindow: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], closesOn: "Friday" },
  releaseDay: "Saturday",
  adoptionDay: "Sunday",
  outOfBandPolicy: { changesetFlag: "release:out-of-band" },
  releasePrPolicy: { label: "release:weekly" },
};

const RELEASE_SHAPED_FILES = [
  { path: "packages/controller/package.json", status: "modified" },
  { path: "packages/controller/CHANGELOG.md", status: "modified" },
  { path: "package-lock.json", status: "modified" },
  { path: ".changesets/controller-fix.md", status: "removed" },
];

// --- DST boundaries: America/Los_Angeles spring-forward (2027-03-14) and fall-back (2027-11-07) ---

test("zonedDateParts: spring-forward day (2027-03-14) skips 02:00-02:59 local without throwing or double-counting", () => {
  // 09:30Z is still PST (offset -8) since the 2am-local transition is 10:00Z; 10:30Z is already PDT (offset -7).
  assert.deepEqual(zonedDateParts(new Date(Date.UTC(2027, 2, 14, 9, 30, 0)), TZ), { year: 2027, month: 3, day: 14, hour: 1, minute: 30, second: 0, weekday: "Sunday" });
  assert.deepEqual(zonedDateParts(new Date(Date.UTC(2027, 2, 14, 10, 30, 0)), TZ), { year: 2027, month: 3, day: 14, hour: 3, minute: 30, second: 0, weekday: "Sunday" });
});

test("zonedDateParts: fall-back day (2027-11-07) repeats 01:00-01:59 local without corrupting the calendar date", () => {
  // 08:30Z is still PDT (offset -7, pre-transition repeat of 01:30); 09:30Z is already PST (offset -8, the second 01:30).
  assert.deepEqual(zonedDateParts(new Date(Date.UTC(2027, 10, 7, 8, 30, 0)), TZ), { year: 2027, month: 11, day: 7, hour: 1, minute: 30, second: 0, weekday: "Sunday" });
  assert.deepEqual(zonedDateParts(new Date(Date.UTC(2027, 10, 7, 9, 30, 0)), TZ), { year: 2027, month: 11, day: 7, hour: 1, minute: 30, second: 0, weekday: "Sunday" });
});

// --- dayTypeFor / nextMergeWindowStart ---

test("dayTypeFor classifies every day of the week from the calendar's own names", () => {
  assert.equal(dayTypeFor(new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), TZ, CALENDAR), "release"); // Saturday
  assert.equal(dayTypeFor(new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), TZ, CALENDAR), "adoption"); // Sunday
  assert.equal(dayTypeFor(new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), TZ, CALENDAR), "merge-window"); // Wednesday
});

test("dayTypeFor: timezone matters -- a UTC instant already on Monday can still be Sunday in America/Los_Angeles", () => {
  // 2026-01-05T06:00Z is Monday in UTC, but America/Los_Angeles (UTC-8 in January) is still 2026-01-04 22:00, a Sunday.
  const instant = new Date(Date.UTC(2026, 0, 5, 6, 0, 0));
  assert.equal(zonedDateParts(instant, TZ).weekday, "Sunday");
  assert.equal(dayTypeFor(instant, TZ, CALENDAR), "adoption");
});

test("nextMergeWindowStart: from a Saturday, the next window opens the following Monday", () => {
  assert.equal(nextMergeWindowStart(new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), TZ, CALENDAR), "2026-01-05");
});

// --- isReleasePrFootprint: the diff-shape half of the release-PR exemption ---

test("isReleasePrFootprint: a plain release PR's diff (bumps, CHANGELOGs, lockfile, deleted changesets) passes", () => {
  assert.equal(isReleasePrFootprint(RELEASE_SHAPED_FILES), true);
});

test("isReleasePrFootprint: several packages and changesets at once still passes", () => {
  assert.equal(
    isReleasePrFootprint([
      { path: "packages/controller/package.json", status: "modified" },
      { path: "packages/controller/CHANGELOG.md", status: "modified" },
      { path: "packages/writer/package.json", status: "modified" },
      { path: "packages/writer/CHANGELOG.md", status: "added" }, // a brand-new CHANGELOG.md is also legal
      { path: "package-lock.json", status: "modified" },
      { path: ".changesets/controller-fix.md", status: "removed" },
      { path: ".changesets/writer-fix.md", status: "removed" },
    ]),
    true,
  );
});

test("isReleasePrFootprint: rejects an empty file list -- nothing to release is not a release PR", () => {
  assert.equal(isReleasePrFootprint([]), false);
});

test("isReleasePrFootprint: rejects a diff with no package.json change at all", () => {
  assert.equal(isReleasePrFootprint([{ path: "package-lock.json", status: "modified" }]), false);
});

test("isReleasePrFootprint: ANY unrelated file fails the whole thing, regardless of what else is present", () => {
  assert.equal(isReleasePrFootprint([...RELEASE_SHAPED_FILES, { path: ".github/workflows/ci.yml", status: "modified" }]), false);
  assert.equal(isReleasePrFootprint([...RELEASE_SHAPED_FILES, { path: "packages/controller/src/index.ts", status: "modified" }]), false);
});

test("isReleasePrFootprint: the file STATUS matters, not just the path -- an added or removed package.json is not a version bump", () => {
  assert.equal(isReleasePrFootprint([{ path: "packages/controller/package.json", status: "added" }]), false);
  assert.equal(isReleasePrFootprint([{ path: "packages/controller/package.json", status: "removed" }]), false);
  assert.equal(isReleasePrFootprint([{ path: ".changesets/controller-fix.md", status: "modified" }, { path: "packages/controller/package.json", status: "modified" }]), false); // a changeset must be REMOVED, not modified
});

// --- evaluateReleaseCalendarGate: the release-PR exemption now needs the label AND the shape, never a branch name alone ---

test("evaluateReleaseCalendarGate: passes freely Monday-Friday, no label or shape needed", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), labels: [], changedFiles: [] });
  assert.equal(result.status, "pass");
  assert.equal(result.dayType, "merge-window");
});

test("evaluateReleaseCalendarGate: fails an ordinary PR on release day and reports the next window", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: [], changedFiles: [] });
  assert.equal(result.status, "fail");
  assert.equal(result.dayType, "release");
  assert.equal(result.nextMergeWindowStart, "2026-01-05");
});

test("evaluateReleaseCalendarGate: a branch NAMED like a release PR, with neither the label nor the shape, still fails (this is the fix)", () => {
  const result = evaluateReleaseCalendarGate({
    calendar: CALENDAR,
    now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)),
    labels: [],
    changedFiles: [{ path: "packages/controller/src/index.ts", status: "modified" }],
  });
  assert.equal(result.status, "fail");
});

test("evaluateReleaseCalendarGate: the label alone, without the release-PR-shaped diff, is not enough", () => {
  const result = evaluateReleaseCalendarGate({
    calendar: CALENDAR,
    now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)),
    labels: ["release:weekly"],
    changedFiles: [{ path: "packages/controller/src/index.ts", status: "modified" }],
  });
  assert.equal(result.status, "fail");
});

test("evaluateReleaseCalendarGate: the release-PR-shaped diff alone, without the label, is not enough", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: [], changedFiles: RELEASE_SHAPED_FILES });
  assert.equal(result.status, "fail");
});

test("evaluateReleaseCalendarGate: passes the release PR itself on release day -- label AND shape together", () => {
  const result = evaluateReleaseCalendarGate({
    calendar: CALENDAR,
    now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)),
    labels: ["release:weekly"],
    changedFiles: RELEASE_SHAPED_FILES,
  });
  assert.equal(result.status, "pass");
});

test("evaluateReleaseCalendarGate: a release:out-of-band labelled PR is exempted on ANY day -- release, adoption, AND an ordinary merge-window weekday -- independent of file shape (owner decision, #1187 comment 5800369031)", () => {
  const releaseDayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: ["release:out-of-band"], changedFiles: [{ path: "packages/controller/src/index.ts", status: "modified" }] });
  assert.equal(releaseDayResult.status, "pass");
  const adoptionDayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), labels: ["release:out-of-band"], changedFiles: [] });
  assert.equal(adoptionDayResult.status, "pass");
  const wednesdayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), labels: ["release:out-of-band"], changedFiles: [{ path: "packages/controller/src/index.ts", status: "modified" }] });
  assert.equal(wednesdayResult.status, "pass");
  assert.equal(wednesdayResult.dayType, "merge-window"); // passes here regardless of the label -- the merge window is already open to everyone
});

test("evaluateReleaseCalendarGate: fails an ordinary PR on adoption day (Sunday) too", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), labels: [], changedFiles: [] });
  assert.equal(result.status, "fail");
  assert.equal(result.dayType, "adoption");
});

// --- shouldOpenReleasePr: idempotent day-type + no-open-PR guard, replacing the old exact-hour DST window ---

test("shouldOpenReleasePr: true any time during Saturday (calendar timezone) when no release PR is already open", () => {
  const earlySaturday = new Date(Date.UTC(2026, 0, 3, 8, 0, 0)); // 2026-01-03 00:00 PST
  const lateSaturday = new Date(Date.UTC(2026, 0, 4, 6, 0, 0)); // 2026-01-03 22:00 PST -- well past any old "midnight window"
  assert.equal(shouldOpenReleasePr({ now: earlySaturday, calendar: CALENDAR, hasOpenReleasePr: false }), true);
  assert.equal(shouldOpenReleasePr({ now: lateSaturday, calendar: CALENDAR, hasOpenReleasePr: false }), true);
});

test("shouldOpenReleasePr: idempotent -- a second (or delayed, or repeated) firing the same Saturday is a no-op once a release PR is already open", () => {
  const saturday = new Date(Date.UTC(2026, 0, 3, 20, 0, 0));
  assert.equal(shouldOpenReleasePr({ now: saturday, calendar: CALENDAR, hasOpenReleasePr: false }), true);
  // Simulates the workflow's own cron firing again later the same day, or a second concurrent run,
  // after the first run's PR is already open: this MUST be false, not a duplicate PR.
  assert.equal(shouldOpenReleasePr({ now: saturday, calendar: CALENDAR, hasOpenReleasePr: true }), false);
});

test("shouldOpenReleasePr: false on any non-Saturday day, regardless of open-PR state", () => {
  const sunday = new Date(Date.UTC(2026, 0, 4, 20, 0, 0));
  const wednesday = new Date(Date.UTC(2026, 0, 7, 20, 0, 0));
  assert.equal(shouldOpenReleasePr({ now: sunday, calendar: CALENDAR, hasOpenReleasePr: false }), false);
  assert.equal(shouldOpenReleasePr({ now: wednesday, calendar: CALENDAR, hasOpenReleasePr: false }), false);
});
