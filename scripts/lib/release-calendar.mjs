// release-calendar — pure functions over governance/release-calendar.json
// (the weekly release cadence and CalVer-by-ISO-week version scheme, owner
// decision 2026-09-23, builds on the cadence rule at
// https://github.com/clossys/foundry/issues/1187#issuecomment-5799002037).
//
// CADENCE
// -------
// Monday-Friday is the merge window (mergeWindow.days), Saturday is the
// release day, Sunday is the consumer-adoption day, and Monday starts
// fresh. Every day boundary here is evaluated in the calendar's own
// timezone (America/Los_Angeles, the owner's local zone) -- NOT UTC and NOT
// the machine's local zone -- via Intl.DateTimeFormat's `timeZone` option,
// which already accounts for DST transitions correctly. This module never
// does its own UTC-offset arithmetic for that reason: a hand-rolled offset
// table drifts out of sync with DST rules; Intl's IANA tzdata does not.
//
// VERSION SCHEME (calver-isoweek): YY.WW.N
// -----------------------------------------
//   YY -- the two-digit ISO week-YEAR (ISO 8601 %G, not the calendar
//         year). 2027-01-02 is ISO week 53 of week-year 2026, so that date
//         is "26.53.x", not "27.1.x" -- the ISO week-year belongs to
//         whichever week owns the Thursday closest to that date, and this
//         is why isoWeekInfo() below anchors on the Thursday of the week
//         rather than the date itself.
//   WW -- the ISO week number (%V), 1-53, printed WITHOUT zero-padding
//         (semver numeric identifiers forbid a leading zero on anything
//         but a bare "0" -- "05" is not a legal semver number).
//   N  -- 0 for the regular Saturday release. Incremented only for an
//         out-of-band release later in the SAME ISO week (a security fix,
//         or a fix for a release that shipped broken) -- see
//         computeNextReleaseVersion() and classifyCalverBump() below.
//
// TRANSITION FROM 0.x.y
// ----------------------
// Every package here currently ships a pre-1.0 semver (e.g. 0.9.12). The
// first release under this scheme moves a package straight from 0.x.y to
// YY.WW.0 (e.g. 0.9.12 -> 26.39.0) in one step -- a valid forward semver
// move (26 > 0) and, deliberately, a ONE-WAY DOOR: nothing in this
// repository ever produces a 0.x.y version again once a package has
// crossed it. isPreTransitionVersion() below is what both
// computeNextReleaseVersion() (choosing N=0 for the crossing) and
// classifyCalverBump() (validating it on review) key off of.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const RELEASE_CALENDAR_PATH = "governance/release-calendar.json";
export const RELEASE_PR_BRANCH_PATTERN = /^claude\/release-\d{4}-\d{2}-\d{2}-\d+$/;
export const DEFAULT_OUT_OF_BAND_LABEL = "release:out-of-band";

const WEEKDAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Reads and parses governance/release-calendar.json. Throws a descriptive error rather than returning null -- every caller needs a calendar to do anything. */
export function loadReleaseCalendar(root = process.cwd()) {
  const path = resolve(root, RELEASE_CALENDAR_PATH);
  if (!existsSync(path)) throw new Error(`${RELEASE_CALENDAR_PATH} does not exist under ${root}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${RELEASE_CALENDAR_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed.timezone !== "string") throw new Error(`${RELEASE_CALENDAR_PATH} is missing a "timezone" string`);
  return parsed;
}

/**
 * The civil (Y-M-D, H:M) date and weekday of `date` (a JS Date, i.e. a UTC
 * instant) AS OBSERVED in `timeZone`. Intl resolves the DST offset that
 * applies at that exact instant, so this is correct across a spring-forward
 * or fall-back transition without this module knowing the transition dates.
 */
export function zonedDateParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

/**
 * ISO 8601 week-year and week number for the plain calendar date
 * (year, month 1-12, day). Pure date math -- no timezone involved once a
 * civil date is in hand, which is why zonedDateParts() above is the only
 * place this module talks to a timezone.
 *
 * Algorithm: the ISO week-year of a date is the calendar year of the
 * THURSDAY in that date's Mon-Sun week (ISO weeks start Monday); the week
 * number counts Thursdays from the first Thursday of that year. This is
 * what makes both week 53 and the week-year crossing fall out for free:
 * 2027-01-02 is a Saturday, its week's Thursday is 2026-12-31, so it is
 * week-year 2026 -- and 2026's last Thursday is far enough into December
 * that 2026 has 53 ISO weeks, not 52.
 */
export function isoWeekInfo(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const isoDayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - isoDayNum + 3); // Thursday of this ISO week
  const isoWeekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoWeekYear, 0, 4));
  const firstIsoDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstIsoDayNum + 3);
  const isoWeek = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { isoWeekYear, isoWeek };
}

/** isoWeekInfo(), resolved through `timeZone` for a JS Date instant, plus the two-digit week-year the version string uses. */
export function isoWeekYearAndWeek(date, timeZone) {
  const { year, month, day } = zonedDateParts(date, timeZone);
  const { isoWeekYear, isoWeek } = isoWeekInfo(year, month, day);
  return { isoWeekYear, isoWeek, isoWeekYearTwoDigit: ((isoWeekYear % 100) + 100) % 100 };
}

/** "YY.WW.N", with WW and N unpadded (see header -- semver forbids a leading zero). */
export function formatCalverVersion(isoWeekYearTwoDigit, isoWeek, n) {
  return `${isoWeekYearTwoDigit}.${isoWeek}.${n}`;
}

/** Three dot-separated non-negative integers, or null. Deliberately accepts both pre-transition (0.x.y) and calver (YY.WW.N) versions -- they are the same shape. */
export function parsePlainVersionTriple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ""));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Has this package never crossed into the calver scheme (major version 0)? */
export function isPreTransitionVersion(version) {
  const triple = parsePlainVersionTriple(version);
  return triple !== null && triple[0] === 0;
}

/**
 * The version a package's next release should carry, given its CURRENT
 * version and the release date (a JS Date; evaluated in the calendar's own
 * timezone). This is the date-aware half of the scheme -- what
 * scripts/apply-release-changesets.mjs calls for each package with pending
 * changesets, on the day it actually runs.
 *
 * Throws (never silently guesses) when the request is not internally
 * consistent: an out-of-band release for a package that was NOT already
 * released this ISO week has nothing to patch; a non-out-of-band request
 * for a package already released this ISO week would silently collide with
 * that earlier release's own version.
 */
export function computeNextReleaseVersion({ currentVersion, releaseDate, timeZone, outOfBand = false }) {
  const triple = parsePlainVersionTriple(currentVersion);
  if (!triple) throw new Error(`"${currentVersion}" is not a plain X.Y.Z version -- cannot compute its next release version`);
  const { isoWeekYearTwoDigit, isoWeek } = isoWeekYearAndWeek(releaseDate, timeZone);

  if (isPreTransitionVersion(currentVersion)) {
    if (outOfBand) throw new Error(`"${currentVersion}" has never had a calver release -- an out-of-band release needs a prior release this ISO week to patch`);
    return { version: formatCalverVersion(isoWeekYearTwoDigit, isoWeek, 0), kind: "transition" };
  }

  const [curYY, curWW, curN] = triple;
  const sameWeek = curYY === isoWeekYearTwoDigit && curWW === isoWeek;

  if (sameWeek) {
    if (!outOfBand) {
      throw new Error(
        `"${currentVersion}" was already released this ISO week (${isoWeekYearTwoDigit}.${isoWeek}) -- a same-week re-release needs a changeset flagged "release: out-of-band"`,
      );
    }
    return { version: formatCalverVersion(isoWeekYearTwoDigit, isoWeek, curN + 1), kind: "out-of-band" };
  }

  if (outOfBand) {
    throw new Error(`an out-of-band release was requested, but "${currentVersion}" is not from this ISO week (${isoWeekYearTwoDigit}.${isoWeek}) -- nothing to patch`);
  }
  return { version: formatCalverVersion(isoWeekYearTwoDigit, isoWeek, 0), kind: "weekly" };
}

/**
 * Structurally classifies oldVersion -> newVersion as one of "transition",
 * "new-week", "same-week-outofband", or null (not a valid single-step
 * calver move). Deliberately date-independent -- unlike
 * computeNextReleaseVersion() above, this asks only "is this shaped like a
 * legal step of the scheme", not "is it the step for right now" -- the same
 * relationship check-release-pr-shape.mjs's use of it mirrors
 * check-release-readiness.mjs elsewhere in this repository: a structural
 * check that stays true regardless of how long a pull request sits open.
 */
export function classifyCalverBump(oldVersion, newVersion) {
  const oldTriple = parsePlainVersionTriple(oldVersion);
  const newTriple = parsePlainVersionTriple(newVersion);
  if (!oldTriple || !newTriple) return null;

  if (oldTriple[0] === 0) {
    return newTriple[0] > 0 && newTriple[2] === 0 ? "transition" : null;
  }

  const sameWeek = oldTriple[0] === newTriple[0] && oldTriple[1] === newTriple[1];
  if (sameWeek) {
    return newTriple[2] === oldTriple[2] + 1 ? "same-week-outofband" : null;
  }

  const movedForward = newTriple[0] > oldTriple[0] || (newTriple[0] === oldTriple[0] && newTriple[1] > oldTriple[1]);
  return movedForward && newTriple[2] === 0 ? "new-week" : null;
}

/** "merge-window" (Mon-Fri), "release" (Saturday), or "adoption" (Sunday), per the calendar's own day names -- never a hardcoded weekday, so a calendar edit alone can move the cadence. */
export function dayTypeFor(date, timeZone, calendar) {
  const { weekday } = zonedDateParts(date, timeZone);
  if (weekday === calendar.releaseDay) return "release";
  if (weekday === calendar.adoptionDay) return "adoption";
  if (calendar.mergeWindow?.days?.includes(weekday)) return "merge-window";
  return "closed";
}

/** The next merge-window Monday (as calendar.mergeWindow.days[0]) strictly after `date`, as a zoned "YYYY-MM-DD" string. */
export function nextMergeWindowStart(date, timeZone, calendar) {
  const firstMergeDay = calendar.mergeWindow?.days?.[0] ?? "Monday";
  for (let offsetDays = 1; offsetDays <= 7; offsetDays += 1) {
    const candidate = new Date(date.getTime() + offsetDays * 86400000);
    const { year, month, day, weekday } = zonedDateParts(candidate, timeZone);
    if (weekday === firstMergeDay) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  throw new Error("nextMergeWindowStart: no matching weekday found within 7 days -- calendar.mergeWindow.days is misconfigured");
}

/**
 * Is `now` (a JS Date) within the merge window, or is it a release/adoption
 * day on which only the release PR (by branch name) or an out-of-band
 * labelled pull request may land? This is the pure core of
 * scripts/check-release-calendar.mjs -- see that script for how
 * `headRefName`/`labels` are resolved from a pull_request vs. merge_group
 * event.
 */
export function evaluateReleaseCalendarGate({ calendar, now, headRefName, labels = [] }) {
  const dayType = dayTypeFor(now, calendar.timezone, calendar);
  if (dayType === "merge-window") {
    return { status: "pass", dayType, reason: `merge window is open (${calendar.timezone})` };
  }

  const outOfBandLabel = calendar.outOfBandPolicy?.changesetFlag ?? DEFAULT_OUT_OF_BAND_LABEL;
  const isReleasePr = RELEASE_PR_BRANCH_PATTERN.test(headRefName ?? "");
  const isOutOfBand = (labels ?? []).includes(outOfBandLabel);

  if (isReleasePr || isOutOfBand) {
    return {
      status: "pass",
      dayType,
      reason: isReleasePr ? `${dayType} day, but this is the release PR (head ref matches ${RELEASE_PR_BRANCH_PATTERN})` : `${dayType} day, but this pull request is labelled "${outOfBandLabel}"`,
    };
  }

  const nextWindow = nextMergeWindowStart(now, calendar.timezone, calendar);
  return {
    status: "fail",
    dayType,
    nextMergeWindowStart: nextWindow,
    reason:
      `merge window is closed -- it is ${dayType} day in ${calendar.timezone}, and Mon-Fri (the merge window) is the only time an ordinary pull request may merge. ` +
      `This is neither the release PR (head ref must match ${RELEASE_PR_BRANCH_PATTERN}) nor labelled "${outOfBandLabel}". ` +
      `The merge window reopens ${nextWindow}.`,
  };
}

/**
 * Should the release-pr.yml cron actually open a release PR right now? True
 * only within the first `toleranceMinutes` minutes after local midnight on
 * calendar.releaseDay, in the calendar's timezone. release-pr.yml schedules
 * TWO cron entries a week apart in UTC offset (one for each DST state,
 * documented in that workflow) because GitHub Actions cron has no timezone
 * concept -- this function is the guard that makes only the entry that
 * actually lands at local midnight (the other lands roughly an hour off)
 * proceed, so the workflow never opens two release PRs for the same week.
 */
export function shouldOpenReleasePr(now, calendar, toleranceMinutes = 55) {
  const { weekday, hour, minute } = zonedDateParts(now, calendar.timezone);
  if (weekday !== calendar.releaseDay) return false;
  return hour === 0 && minute < toleranceMinutes;
}

export const WEEKDAY_NAMES = WEEKDAY_ORDER;
