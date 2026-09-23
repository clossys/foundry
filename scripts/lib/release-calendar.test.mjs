import assert from "node:assert/strict";
import test from "node:test";
import {
  dayTypeFor,
  evaluateReleaseCalendarGate,
  nextMergeWindowStart,
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

// --- dayTypeFor / nextMergeWindowStart / evaluateReleaseCalendarGate ---

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
