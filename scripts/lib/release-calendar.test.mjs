import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCalverBump,
  computeNextReleaseVersion,
  dayTypeFor,
  evaluateReleaseCalendarGate,
  formatCalverVersion,
  isoWeekInfo,
  isoWeekYearAndWeek,
  isPreTransitionVersion,
  nextMergeWindowStart,
  parsePlainVersionTriple,
  RELEASE_PR_BRANCH_PATTERN,
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
};

// --- isoWeekInfo: normal week, week 53, week-year crossing (owner-given examples) ---

test("isoWeekInfo: an ordinary midweek date", () => {
  assert.deepEqual(isoWeekInfo(2026, 9, 26), { isoWeekYear: 2026, isoWeek: 39 });
});

test("isoWeekInfo: 2027-01-02 is ISO week 53 of week-year 2026 (owner's own example)", () => {
  assert.deepEqual(isoWeekInfo(2027, 1, 2), { isoWeekYear: 2026, isoWeek: 53 });
});

test("isoWeekInfo: 2026-12-31 is also week-year 2026's week 53 (the year has 53 ISO weeks)", () => {
  assert.deepEqual(isoWeekInfo(2026, 12, 31), { isoWeekYear: 2026, isoWeek: 53 });
});

test("isoWeekInfo: week-year crossing the other direction -- 2025-12-29 is already week 1 of 2026", () => {
  assert.deepEqual(isoWeekInfo(2025, 12, 29), { isoWeekYear: 2026, isoWeek: 1 });
});

// --- timezone correctness: the civil date in America/Los_Angeles can differ from the UTC calendar date, and that difference must change the computed ISO week ---

test("isoWeekYearAndWeek: a UTC instant already on Monday still resolves to Sunday's (earlier) ISO week in America/Los_Angeles", () => {
  // 2026-01-05T06:00Z is Monday in UTC (which would be ISO week 2), but
  // America/Los_Angeles (UTC-8 in January) is still 2026-01-04 22:00,
  // a Sunday -- correctly week 1, not week 2.
  const instant = new Date(Date.UTC(2026, 0, 5, 6, 0, 0));
  assert.equal(zonedDateParts(instant, TZ).weekday, "Sunday");
  assert.deepEqual(isoWeekYearAndWeek(instant, TZ), { isoWeekYear: 2026, isoWeek: 1, isoWeekYearTwoDigit: 26 });
  // The timezone-blind answer (using the raw UTC date) would have been week 2 -- proving the timezone conversion is load-bearing, not decorative.
  assert.deepEqual(isoWeekInfo(2026, 1, 5), { isoWeekYear: 2026, isoWeek: 2 });
});

test("isoWeekYearAndWeek: resolves week 53 / week-year 2026 correctly through the timezone even late in UTC's next day", () => {
  const instant = new Date(Date.UTC(2027, 0, 3, 6, 0, 0)); // UTC Sunday 06:00 -> LA Saturday 22:00
  assert.deepEqual(zonedDateParts(instant, TZ), { year: 2027, month: 1, day: 2, hour: 22, minute: 0, second: 0, weekday: "Saturday" });
  assert.deepEqual(isoWeekYearAndWeek(instant, TZ), { isoWeekYear: 2026, isoWeek: 53, isoWeekYearTwoDigit: 26 });
});

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

test("shouldOpenReleasePr: the release-pr.yml DST guard fires exactly once across both UTC cron candidates, in winter (PST)", () => {
  // 2026-01-03 is a Saturday. Midnight PST is 08:00Z.
  assert.equal(shouldOpenReleasePr(new Date(Date.UTC(2026, 0, 3, 8, 0, 0)), CALENDAR), true);
  assert.equal(shouldOpenReleasePr(new Date(Date.UTC(2026, 0, 3, 7, 0, 0)), CALENDAR), false); // still Friday 23:00 PST
});

test("shouldOpenReleasePr: the same guard fires exactly once in summer (PDT), on the OTHER UTC candidate", () => {
  // 2026-07-04 is a Saturday. Midnight PDT is 07:00Z, not 08:00Z.
  assert.equal(shouldOpenReleasePr(new Date(Date.UTC(2026, 6, 4, 7, 0, 0)), CALENDAR), true);
  assert.equal(shouldOpenReleasePr(new Date(Date.UTC(2026, 6, 4, 8, 0, 0)), CALENDAR), false); // already 01:00 PDT -- outside tolerance
});

// --- version formatting / parsing ---

test("formatCalverVersion / parsePlainVersionTriple round-trip, unpadded", () => {
  assert.equal(formatCalverVersion(26, 1, 0), "26.1.0");
  assert.equal(formatCalverVersion(26, 39, 2), "26.39.2");
  assert.deepEqual(parsePlainVersionTriple("26.39.0"), [26, 39, 0]);
  assert.equal(parsePlainVersionTriple("not-a-version"), null);
});

test("isPreTransitionVersion", () => {
  assert.equal(isPreTransitionVersion("0.9.12"), true);
  assert.equal(isPreTransitionVersion("26.39.0"), false);
});

// --- computeNextReleaseVersion: transition, weekly, out-of-band N+1, and the refusals that keep them from colliding ---

const SATURDAY_2026_W39 = new Date(Date.UTC(2026, 8, 26, 20, 0, 0));

test("computeNextReleaseVersion: normal week, package with no calver release yet -- the one-time transition", () => {
  assert.deepEqual(computeNextReleaseVersion({ currentVersion: "0.9.12", releaseDate: SATURDAY_2026_W39, timeZone: TZ }), { version: "26.39.0", kind: "transition" });
});

test("computeNextReleaseVersion: normal week, package already on calver from an earlier week", () => {
  assert.deepEqual(computeNextReleaseVersion({ currentVersion: "26.38.0", releaseDate: SATURDAY_2026_W39, timeZone: TZ }), { version: "26.39.0", kind: "weekly" });
});

test("computeNextReleaseVersion: out-of-band release later in the same ISO week increments N", () => {
  assert.deepEqual(computeNextReleaseVersion({ currentVersion: "26.39.0", releaseDate: SATURDAY_2026_W39, timeZone: TZ, outOfBand: true }), { version: "26.39.1", kind: "out-of-band" });
});

test("computeNextReleaseVersion: three consecutive Saturdays walk 26.51.0 -> 26.52.0 -> 26.53.0 -> 27.1.0 across the week-year crossing", () => {
  const dec26 = new Date(Date.UTC(2026, 11, 26, 20, 0, 0)); // 2026-12-26, Saturday, ISO week 52 of week-year 2026
  assert.deepEqual(computeNextReleaseVersion({ currentVersion: "26.51.0", releaseDate: dec26, timeZone: TZ }), { version: "26.52.0", kind: "weekly" });
  const jan2 = new Date(Date.UTC(2027, 0, 2, 20, 0, 0)); // 2027-01-02, ISO week 53 of week-year 2026 (owner's own example)
  assert.deepEqual(computeNextReleaseVersion({ currentVersion: "26.52.0", releaseDate: jan2, timeZone: TZ }), { version: "26.53.0", kind: "weekly" });
  const jan9 = new Date(Date.UTC(2027, 0, 9, 20, 0, 0)); // 2027-01-09, ISO week 1 of week-year 2027 -- the crossing
  assert.deepEqual(computeNextReleaseVersion({ currentVersion: "26.53.0", releaseDate: jan9, timeZone: TZ }), { version: "27.1.0", kind: "weekly" });
});

test("computeNextReleaseVersion: a same-week release without the out-of-band flag is refused, not silently collided", () => {
  assert.throws(() => computeNextReleaseVersion({ currentVersion: "26.39.0", releaseDate: SATURDAY_2026_W39, timeZone: TZ }), /already released this ISO week/);
});

test("computeNextReleaseVersion: an out-of-band request against a version from a different week is refused", () => {
  assert.throws(() => computeNextReleaseVersion({ currentVersion: "26.38.0", releaseDate: SATURDAY_2026_W39, timeZone: TZ, outOfBand: true }), /nothing to patch/);
});

test("computeNextReleaseVersion: an out-of-band request against a never-released package is refused", () => {
  assert.throws(() => computeNextReleaseVersion({ currentVersion: "0.9.12", releaseDate: SATURDAY_2026_W39, timeZone: TZ, outOfBand: true }), /never had a calver release/);
});

test("computeNextReleaseVersion: rejects a version that is not a plain X.Y.Z", () => {
  assert.throws(() => computeNextReleaseVersion({ currentVersion: "1.0.0-rc.1", releaseDate: SATURDAY_2026_W39, timeZone: TZ }), /not a plain X\.Y\.Z/);
});

// --- classifyCalverBump: the date-independent structural check check-release-pr-shape.mjs uses ---

test("classifyCalverBump: the one-time 0.x.y -> YY.WW.0 transition", () => {
  assert.equal(classifyCalverBump("0.9.12", "26.39.0"), "transition");
});

test("classifyCalverBump: a transition landing anywhere other than N=0 is invalid", () => {
  assert.equal(classifyCalverBump("0.9.12", "26.39.1"), null);
});

test("classifyCalverBump: a new-week release, including a week-53 -> next-year rollover", () => {
  assert.equal(classifyCalverBump("26.38.0", "26.39.0"), "new-week");
  assert.equal(classifyCalverBump("26.53.0", "27.1.0"), "new-week");
});

test("classifyCalverBump: same-week out-of-band must be exactly N+1", () => {
  assert.equal(classifyCalverBump("26.39.0", "26.39.1"), "same-week-outofband");
  assert.equal(classifyCalverBump("26.39.0", "26.39.2"), null);
});

test("classifyCalverBump: backward or sideways moves are invalid", () => {
  assert.equal(classifyCalverBump("26.39.0", "26.38.0"), null);
  assert.equal(classifyCalverBump("26.39.1", "26.39.1"), null);
});

// --- dayTypeFor / nextMergeWindowStart / evaluateReleaseCalendarGate ---

test("dayTypeFor classifies every day of the week from the calendar's own names", () => {
  assert.equal(dayTypeFor(new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), TZ, CALENDAR), "release"); // Saturday
  assert.equal(dayTypeFor(new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), TZ, CALENDAR), "adoption"); // Sunday
  assert.equal(dayTypeFor(new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), TZ, CALENDAR), "merge-window"); // Wednesday
});

test("nextMergeWindowStart: from a Saturday, the next window opens the following Monday", () => {
  assert.equal(nextMergeWindowStart(new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), TZ, CALENDAR), "2026-01-05");
});

test("evaluateReleaseCalendarGate: passes freely Monday-Friday", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), headRefName: "some-feature", labels: [] });
  assert.equal(result.status, "pass");
  assert.equal(result.dayType, "merge-window");
});

test("evaluateReleaseCalendarGate: fails an ordinary PR on release day and reports the next window", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), headRefName: "some-feature", labels: [] });
  assert.equal(result.status, "fail");
  assert.equal(result.dayType, "release");
  assert.equal(result.nextMergeWindowStart, "2026-01-05");
});

test("evaluateReleaseCalendarGate: passes the release PR itself on release day, by head ref", () => {
  assert.ok(RELEASE_PR_BRANCH_PATTERN.test("claude/release-2026-01-03-1234567"));
  const result = evaluateReleaseCalendarGate({
    calendar: CALENDAR,
    now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)),
    headRefName: "claude/release-2026-01-03-1234567",
    labels: [],
  });
  assert.equal(result.status, "pass");
});

test("evaluateReleaseCalendarGate: passes a release:out-of-band labelled PR on release or adoption day", () => {
  const releaseDayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), headRefName: "hotfix", labels: ["release:out-of-band"] });
  assert.equal(releaseDayResult.status, "pass");
  const adoptionDayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), headRefName: "hotfix", labels: ["release:out-of-band"] });
  assert.equal(adoptionDayResult.status, "pass");
});

test("evaluateReleaseCalendarGate: fails an ordinary PR on adoption day (Sunday) too", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), headRefName: "some-feature", labels: [] });
  assert.equal(result.status, "fail");
  assert.equal(result.dayType, "adoption");
});
