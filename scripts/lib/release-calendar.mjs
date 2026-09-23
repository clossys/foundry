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
//
// THE RELEASE-PR EXEMPTION IS NOT A BRANCH NAME (second-opinion review,
// https://github.com/clossys/foundry/pull/1316#issuecomment-5800188207)
// -----------------------------------------------------------------------
// An earlier version of evaluateReleaseCalendarGate() below trusted
// `RELEASE_PR_BRANCH_PATTERN.test(headRefName)` alone to decide "is this
// the release PR" -- but a branch name is just a string; anyone who can
// open a pull request can name their branch `claude/release-2026-01-03-1`
// and merge through the weekend gate on that basis alone. The exemption
// now requires BOTH of two things an ordinary contributor cannot produce
// merely by naming a branch:
//
//   1. isReleasePrFootprint(changedFiles) -- the pull request's changed
//      files are EXACTLY package.json version bumps, CHANGELOG.md entries,
//      package-lock.json, and deleted .changesets/*.md files. A rogue
//      branch that also touches, say, a workflow file or a source file
//      fails this immediately, regardless of what it is named or labelled.
//   2. The RELEASE_PR_LABEL label, which only .github/workflows/
//      release-pr.yml's own automation (or the owner, per the standing
//      rule in docs/RELEASING.md) ever applies -- an ordinary contributor
//      without label-write access cannot attach it to their own PR.
//
// RESIDUAL RISK (documented, not solved here): both of the above are
// properties of THIS repository's state (files changed, labels applied),
// not of WHO can cause that state. Anyone acting through the workflow's own
// credential, or through the owner's authenticated session (see
// .github/workflows/release-pr.yml's own header, and docs/RELEASING.md's
// "Opening the release PR" section, for why issue #1265's original
// GITHUB_TOKEN-only design moved PR creation to an owner-authenticated
// actor), could in principle produce a pull request that passes both
// checks. That is a trust boundary around who holds the workflow's and the
// owner's credentials, not something a structural diff/label check can
// further narrow -- the same boundary every other owner-gated step in this
// repository already rests on (docs/PUBLISHING.md's qualification and
// publication steps, for instance).
//
// THE SATURDAY GUARD IS IDEMPOTENT, NOT A TIME WINDOW
// -----------------------------------------------------
// An earlier version of shouldOpenReleasePr() below approximated "the
// start of Saturday" with an exact-hour tolerance window and two DST-
// specific cron entries, so a delayed run (a busy runner queue, a
// temporary GitHub Actions outage) could miss its window and silently
// never open that week's release PR. shouldOpenReleasePr() now asks a
// simpler, robust question instead: is it Saturday in the calendar's
// timezone, AND is there no release PR already open? A run any time during
// Saturday proceeds; a second (or a hundredth) run the same Saturday, once
// a release PR is already open, is a no-op -- so .github/workflows/
// release-pr.yml's cron no longer needs to land at a precise instant, and
// can run daily (or however often) without risking a duplicate PR.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const RELEASE_CALENDAR_PATH = "governance/release-calendar.json";
export const RELEASE_PR_BRANCH_PATTERN = /^claude\/release-\d{4}-\d{2}-\d{2}-\d+$/;
export const DEFAULT_OUT_OF_BAND_LABEL = "release:out-of-band";
export const DEFAULT_RELEASE_PR_LABEL = "release:weekly";

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

// One entry per file class a release PR is allowed to touch, paired with
// the git file-status values that class may carry. `status` values follow
// the GitHub REST "list pull request files" shape (added/removed/modified/
// renamed/copied/changed/unchanged) -- callers resolving `merge_group`
// (which has no direct files endpoint) diff against the merge base and map
// onto the same vocabulary; see scripts/check-release-calendar.mjs.
const RELEASE_PR_FILE_CLASSES = [
  { re: /^packages\/[^/]+\/package\.json$/, statuses: ["modified"] },
  { re: /^packages\/[^/]+\/CHANGELOG\.md$/, statuses: ["modified", "added"] },
  { re: /^package-lock\.json$/, statuses: ["modified"] },
  { re: /^\.changesets\/[a-z0-9][a-z0-9-]*\.md$/, statuses: ["removed"] },
];

/**
 * Is this exactly the file footprint scripts/apply-release-changesets.mjs's
 * release PR produces -- version bumps, CHANGELOG entries, the
 * regenerated lockfile, and deleted consumed changesets, and NOTHING else?
 * `changedFiles` is `{ path, status }[]`. An empty list, or a list with no
 * `packages/<dir>/package.json` change at all, is not a release PR either --
 * there is nothing to release. This function only judges the SHAPE of the
 * diff; scripts/check-release-pr-shape.mjs (a separate, already-existing
 * gate, run on every pull request) is what validates that the version
 * bumps inside that shape are themselves legitimate (backed by a consumed
 * changeset or a matching CHANGELOG entry) -- the two are deliberately not
 * merged into one function, the same "two independently-true-or-false
 * conditions" split that script's own header explains.
 */
export function isReleasePrFootprint(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return false;
  let touchedPackageManifest = false;
  for (const entry of changedFiles) {
    const path = entry?.path;
    const status = entry?.status;
    const fileClass = RELEASE_PR_FILE_CLASSES.find((c) => c.re.test(path ?? ""));
    if (!fileClass || !fileClass.statuses.includes(status)) return false;
    if (/^packages\/[^/]+\/package\.json$/.test(path)) touchedPackageManifest = true;
  }
  return touchedPackageManifest;
}

/**
 * Is `now` within the merge window, or is it a release/adoption day on
 * which only the release PR (proven by isReleasePrFootprint() PLUS the
 * RELEASE_PR_LABEL label -- see this module's own header for why a branch
 * name alone is not enough) or an out-of-band labelled pull request may
 * land? This is the pure core of scripts/check-release-calendar.mjs -- see
 * that script for how `changedFiles`/`labels` are resolved from a
 * pull_request vs. merge_group event.
 */
export function evaluateReleaseCalendarGate({ calendar, now, labels = [], changedFiles = [] }) {
  const dayType = dayTypeFor(now, calendar.timezone, calendar);
  if (dayType === "merge-window") {
    return { status: "pass", dayType, reason: `merge window is open (${calendar.timezone})` };
  }

  const outOfBandLabel = calendar.outOfBandPolicy?.changesetFlag ?? DEFAULT_OUT_OF_BAND_LABEL;
  const releasePrLabel = calendar.releasePrPolicy?.label ?? DEFAULT_RELEASE_PR_LABEL;
  const hasReleasePrLabel = (labels ?? []).includes(releasePrLabel);
  const hasReleasePrFootprint = isReleasePrFootprint(changedFiles);
  const isReleasePr = hasReleasePrLabel && hasReleasePrFootprint;
  const isOutOfBand = (labels ?? []).includes(outOfBandLabel);

  if (isReleasePr || isOutOfBand) {
    return {
      status: "pass",
      dayType,
      reason: isReleasePr
        ? `${dayType} day, but this is the release PR (labelled "${releasePrLabel}" and its changed files are exactly a release PR's shape)`
        : `${dayType} day, but this pull request is labelled "${outOfBandLabel}"`,
    };
  }

  const nextWindow = nextMergeWindowStart(now, calendar.timezone, calendar);
  return {
    status: "fail",
    dayType,
    nextMergeWindowStart: nextWindow,
    reason:
      `merge window is closed -- it is ${dayType} day in ${calendar.timezone}, and Mon-Fri (the merge window) is the only time an ordinary pull request may merge. ` +
      `This is neither the release PR (needs the "${releasePrLabel}" label AND a release-PR-shaped diff -- got label=${hasReleasePrLabel}, shape=${hasReleasePrFootprint}) ` +
      `nor labelled "${outOfBandLabel}". The merge window reopens ${nextWindow}.`,
  };
}

/**
 * Should the release-pr.yml cron actually open a release PR right now?
 * True when it is release day (calendar.releaseDay) in the calendar's
 * timezone AND `hasOpenReleasePr` is false. `hasOpenReleasePr` is an
 * injected fact (the workflow resolves it via `gh pr list --label
 * <RELEASE_PR_LABEL> --state open`) rather than something this pure
 * function could ever determine itself -- it has no network access, by
 * design, same as every other function in this module. See this module's
 * own header for why this replaced an exact-hour DST-tolerance window: a
 * delayed or repeated run now degrades to a safe no-op instead of either
 * missing its window or opening a second release PR for the same week.
 */
export function shouldOpenReleasePr({ now, calendar, hasOpenReleasePr }) {
  const dayType = dayTypeFor(now, calendar.timezone, calendar);
  if (dayType !== "release") return false;
  return !hasOpenReleasePr;
}
