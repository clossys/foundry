// release-calendar — pure functions over governance/release-calendar.json
// (the weekly release cadence, owner decision 2026-09-23, builds on the
// cadence rule at
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
// VERSIONING IS UNCHANGED BY THIS CALENDAR
// -----------------------------------------
// An earlier draft of this design (see this pull request's own history)
// paired the weekly cadence with a new CalVer-by-ISO-week version scheme.
// The owner explicitly rejected that: versions stay plain semver, bumped by
// each changeset's own patch/minor/major level exactly as issue #1255
// already does (scripts/apply-release-changesets.mjs,
// scripts/check-release-pr-shape.mjs) -- because there may not be a real
// content change every week, and a version number that moves on a clock
// rather than on a change is not a useful signal. This module therefore
// has no ISO-week or version-formatting logic at all; it answers exactly
// one question, "what kind of day is this in the calendar's timezone", and
// the merge-window gate built on top of that.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const RELEASE_CALENDAR_PATH = "governance/release-calendar.json";
export const RELEASE_PR_BRANCH_PATTERN = /^claude\/release-\d{4}-\d{2}-\d{2}-\d+$/;
export const DEFAULT_OUT_OF_BAND_LABEL = "release:out-of-band";

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
