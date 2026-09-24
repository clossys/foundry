import assert from "node:assert/strict";
import test from "node:test";
import { dayTypeFor, evaluateReleaseCalendarGate, filterReleasePrBranchRefs, inProgressReleaseBranches, nextMergeWindowStart, shouldOpenReleasePr, zonedDateParts } from "./release-calendar.mjs";

const TZ = "America/Los_Angeles";

const CALENDAR = {
  timezone: TZ,
  mergeWindow: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], closesOn: "Friday" },
  releaseDay: "Saturday",
  adoptionDay: "Sunday",
  outOfBandPolicy: { changesetFlag: "release:out-of-band" },
  releasePrPolicy: { label: "release:weekly" },
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

// --- evaluateReleaseCalendarGate: the release-PR exemption now needs the label AND an already-verified structural footprint, never a branch name or bare path list ---

test("evaluateReleaseCalendarGate: passes freely Monday-Friday, no label or footprint needed", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), labels: [], footprintVerified: false });
  assert.equal(result.status, "pass");
  assert.equal(result.dayType, "merge-window");
});

test("evaluateReleaseCalendarGate: fails an ordinary PR on release day and reports the next window", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: [], footprintVerified: false });
  assert.equal(result.status, "fail");
  assert.equal(result.dayType, "release");
  assert.equal(result.nextMergeWindowStart, "2026-01-05");
});

test("evaluateReleaseCalendarGate: a branch NAMED like a release PR, with neither the label nor a verified footprint, still fails", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: [], footprintVerified: false });
  assert.equal(result.status, "fail");
});

test("evaluateReleaseCalendarGate: the label alone, without a verified footprint, is not enough", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: ["release:weekly"], footprintVerified: false });
  assert.equal(result.status, "fail");
});

test("evaluateReleaseCalendarGate: a verified footprint alone, without the label, is not enough", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: [], footprintVerified: true });
  assert.equal(result.status, "fail");
});

test("evaluateReleaseCalendarGate: passes the release PR itself on release day -- label AND a verified footprint together", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: ["release:weekly"], footprintVerified: true });
  assert.equal(result.status, "pass");
});

test("evaluateReleaseCalendarGate: footprintVerified must be the literal boolean true -- anything else (undefined, a truthy string, 1) is treated as NOT verified", () => {
  for (const notTrue of [undefined, null, "true", 1, "yes"]) {
    const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: ["release:weekly"], footprintVerified: notTrue });
    assert.equal(result.status, "fail", `footprintVerified=${JSON.stringify(notTrue)} must not pass`);
  }
});

test("evaluateReleaseCalendarGate: a release:out-of-band labelled PR is exempted on ANY day -- release, adoption, AND an ordinary merge-window weekday -- independent of footprint (owner decision, #1187 comment 5800369031)", () => {
  const releaseDayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 3, 20, 0, 0)), labels: ["release:out-of-band"], footprintVerified: false });
  assert.equal(releaseDayResult.status, "pass");
  const adoptionDayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), labels: ["release:out-of-band"], footprintVerified: false });
  assert.equal(adoptionDayResult.status, "pass");
  const wednesdayResult = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 7, 20, 0, 0)), labels: ["release:out-of-band"], footprintVerified: false });
  assert.equal(wednesdayResult.status, "pass");
  assert.equal(wednesdayResult.dayType, "merge-window"); // passes here regardless of the label -- the merge window is already open to everyone
});

test("evaluateReleaseCalendarGate: fails an ordinary PR on adoption day (Sunday) too", () => {
  const result = evaluateReleaseCalendarGate({ calendar: CALENDAR, now: new Date(Date.UTC(2026, 0, 4, 20, 0, 0)), labels: [], footprintVerified: false });
  assert.equal(result.status, "fail");
  assert.equal(result.dayType, "adoption");
});

// --- shouldOpenReleasePr: idempotent day-type + "a release is already in progress" guard, replacing the old exact-hour DST window ---

test("shouldOpenReleasePr: true any time during Saturday (calendar timezone) when no release is already in progress", () => {
  const earlySaturday = new Date(Date.UTC(2026, 0, 3, 8, 0, 0)); // 2026-01-03 00:00 PST
  const lateSaturday = new Date(Date.UTC(2026, 0, 4, 6, 0, 0)); // 2026-01-03 22:00 PST -- well past any old "midnight window"
  assert.equal(shouldOpenReleasePr({ now: earlySaturday, calendar: CALENDAR, hasReleaseInProgress: false }), true);
  assert.equal(shouldOpenReleasePr({ now: lateSaturday, calendar: CALENDAR, hasReleaseInProgress: false }), true);
});

test("shouldOpenReleasePr: idempotent -- a second (or delayed, or repeated) firing the same Saturday is a no-op once a release is already in progress", () => {
  const saturday = new Date(Date.UTC(2026, 0, 3, 20, 0, 0));
  assert.equal(shouldOpenReleasePr({ now: saturday, calendar: CALENDAR, hasReleaseInProgress: false }), true);
  // Simulates the workflow's own cron firing again later the same day, or a second concurrent run,
  // after the first run's PR is already open: this MUST be false, not a duplicate PR.
  assert.equal(shouldOpenReleasePr({ now: saturday, calendar: CALENDAR, hasReleaseInProgress: true }), false);
});

test("shouldOpenReleasePr: a pushed-but-not-yet-opened release branch (no PR open yet) still counts as in progress -- the caller folds both signals into one boolean", () => {
  // This function has no opinion on WHICH signal (an open PR vs. a pushed-but-unopened
  // branch) produced `hasReleaseInProgress: true` -- it only needs "something is already
  // in flight this week" to refuse a second run. See this function's own header for why
  // "an open PR exists" alone is not a sufficient dedupe signal since #1316 item 6 moved
  // PR creation out of this same automated job.
  const saturday = new Date(Date.UTC(2026, 0, 3, 20, 0, 0));
  assert.equal(shouldOpenReleasePr({ now: saturday, calendar: CALENDAR, hasReleaseInProgress: true }), false);
});

test("shouldOpenReleasePr: false on any non-Saturday day, regardless of in-progress state", () => {
  const sunday = new Date(Date.UTC(2026, 0, 4, 20, 0, 0));
  const wednesday = new Date(Date.UTC(2026, 0, 7, 20, 0, 0));
  assert.equal(shouldOpenReleasePr({ now: sunday, calendar: CALENDAR, hasReleaseInProgress: false }), false);
  assert.equal(shouldOpenReleasePr({ now: wednesday, calendar: CALENDAR, hasReleaseInProgress: false }), false);
});

// -------------------------------------------------- filterReleasePrBranchRefs
//
// Fix, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960
// blocking item 3: .github/workflows/release-pr.yml's Saturday guard used
// to count EVERY `claude/release-*` branch `git ls-remote` returned as "a
// release in progress" -- including ordinary agent feature branches that
// merely happen to start with that prefix, never a real release-PR
// branch. Two real ones (`claude/release-footprint-dependent-ranges` from
// #1339, and `claude/release-readiness-tracked-only-v2` from closed #1330)
// were both on the remote at the time this was found.

test("filterReleasePrBranchRefs: a real release-PR branch ref is matched", () => {
  const refs = "abc123\trefs/heads/claude/release-2027-01-09-12\n";
  assert.deepEqual(filterReleasePrBranchRefs(refs), ["claude/release-2027-01-09-12"]);
});

test("ADVERSARIAL filterReleasePrBranchRefs: an ordinary agent feature branch that merely starts with claude/release- is NOT matched", () => {
  const refs = ["def456\trefs/heads/claude/release-footprint-dependent-ranges", "ghi789\trefs/heads/claude/release-readiness-tracked-only-v2"].join("\n");
  assert.deepEqual(filterReleasePrBranchRefs(refs), []);
});

test("filterReleasePrBranchRefs: a mix of real release-PR branches and unrelated agent branches keeps only the real ones", () => {
  const refs = [
    "abc123\trefs/heads/claude/release-2027-01-09-12",
    "def456\trefs/heads/claude/release-footprint-dependent-ranges",
    "ghi789\trefs/heads/claude/release-2027-01-16-3",
    "jkl012\trefs/heads/claude/release-readiness-tracked-only-v2",
  ].join("\n");
  assert.deepEqual(filterReleasePrBranchRefs(refs), ["claude/release-2027-01-09-12", "claude/release-2027-01-16-3"]);
});

test("filterReleasePrBranchRefs: empty, missing, or malformed input returns no matches rather than throwing", () => {
  assert.deepEqual(filterReleasePrBranchRefs(""), []);
  assert.deepEqual(filterReleasePrBranchRefs(undefined), []);
  assert.deepEqual(filterReleasePrBranchRefs("not a git ls-remote line at all\n"), []);
});

// -------------------------------------------------- inProgressReleaseBranches
//
// Issue #1392: "a leftover release branch from a closed-but-unmerged
// release PR blocks every subsequent Saturday". delete_branch_on_merge only
// deletes the branch on a real MERGE, so a release PR closed without
// merging (superseded, abandoned) leaves its branch matching
// RELEASE_PR_BRANCH_PATTERN on the remote forever -- without this function,
// the guard would read that branch as "a release is in progress" every
// single Saturday from then on, silently, with no error.

test("inProgressReleaseBranches: a branch with no PR at all (the ordinary push-then-stop window) counts as in progress", () => {
  assert.deepEqual(inProgressReleaseBranches(["claude/release-2027-01-09-12"], {}), ["claude/release-2027-01-09-12"]);
});

test("inProgressReleaseBranches: a branch whose PR is still OPEN counts as in progress", () => {
  const branches = ["claude/release-2027-01-09-12"];
  const prStateByBranch = { "claude/release-2027-01-09-12": { state: "OPEN" } };
  assert.deepEqual(inProgressReleaseBranches(branches, prStateByBranch), branches);
});

test("inProgressReleaseBranches: a branch whose PR was CLOSED without merging is a leftover -- excluded", () => {
  const branches = ["claude/release-2027-01-09-12"];
  const prStateByBranch = { "claude/release-2027-01-09-12": { state: "CLOSED" } };
  assert.deepEqual(inProgressReleaseBranches(branches, prStateByBranch), []);
});

test("inProgressReleaseBranches: a branch whose PR already MERGED is excluded too (delete_branch_on_merge just hasn't landed yet)", () => {
  const branches = ["claude/release-2027-01-09-12"];
  const prStateByBranch = { "claude/release-2027-01-09-12": { state: "MERGED" } };
  assert.deepEqual(inProgressReleaseBranches(branches, prStateByBranch), []);
});

test("inProgressReleaseBranches: a mix keeps only the genuinely in-progress branches", () => {
  const branches = ["claude/release-2027-01-01-1", "claude/release-2027-01-08-2", "claude/release-2027-01-15-3", "claude/release-2027-01-22-4"];
  const prStateByBranch = {
    "claude/release-2027-01-08-2": { state: "CLOSED" }, // leftover, abandoned
    "claude/release-2027-01-15-3": { state: "OPEN" }, // real release PR, still under review
    // 2027-01-01-1 has no entry at all: pushed, PR not opened yet
    // 2027-01-22-4 has no entry either: same
  };
  assert.deepEqual(inProgressReleaseBranches(branches, prStateByBranch), ["claude/release-2027-01-01-1", "claude/release-2027-01-15-3", "claude/release-2027-01-22-4"]);
});

test("inProgressReleaseBranches: empty/missing inputs return no matches rather than throwing", () => {
  assert.deepEqual(inProgressReleaseBranches([], {}), []);
  assert.deepEqual(inProgressReleaseBranches(undefined, undefined), []);
});
