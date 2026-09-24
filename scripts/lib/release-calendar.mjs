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
// THE RELEASE-PR EXEMPTION IS NOT A BRANCH NAME, AND NOT A BARE FILE PATH
// EITHER (second-opinion review, https://github.com/clossys/foundry/pull/1316#issuecomment-5800188207,
// tightened further at https://github.com/clossys/foundry/pull/1316#issuecomment-5800566625)
// -----------------------------------------------------------------------
// An earlier version of evaluateReleaseCalendarGate() below trusted
// `RELEASE_PR_BRANCH_PATTERN.test(headRefName)` alone to decide "is this
// the release PR" -- but a branch name is just a string; anyone who can
// open a pull request can name their branch `claude/release-2026-01-03-1`
// and merge through the weekend gate on that basis alone. A LATER version
// replaced that with checking each changed file's PATH and git STATUS
// (added/removed/modified) -- still not enough, since a "modified
// package.json" or "modified CHANGELOG.md" passed regardless of WHAT
// changed inside it (a smuggled dependency, a postinstall script, a
// rewritten old changelog entry, a hand-edited lockfile). The exemption
// now requires BOTH of two things an ordinary contributor cannot produce
// merely by naming a branch or shaping a file list:
//
//   1. `footprintVerified` -- a STRUCTURAL, content-level proof (computed
//      by the caller, via scripts/lib/release-pr-footprint.mjs's
//      evaluateReleasePrFootprint() plus a package-lock.json regeneration
//      check) that every changed file's CONTENT, not just its path and
//      status, is exactly what scripts/apply-release-changesets.mjs's
//      release PR would have produced. A rogue branch that also touches,
//      say, a workflow file, a source file, an added dependency, or a
//      rewritten old CHANGELOG entry fails this immediately, regardless of
//      what it is named, labelled, or which paths it touches.
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

/**
 * Given raw `git ls-remote --heads origin 'claude/release-*'` output
 * (tab-separated `<sha>\trefs/heads/<name>` lines), returns just the
 * branch names that are ACTUALLY a release-PR branch, per
 * `RELEASE_PR_BRANCH_PATTERN` above -- not merely ones the server-side
 * glob happened to match.
 *
 * WHY THE GLOB ALONE IS NOT ENOUGH (fix, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960
 * blocking item 3) -------------------------------------------------------
 * `.github/workflows/release-pr.yml`'s scheduled-run guard uses
 * `git ls-remote --heads origin 'claude/release-*'` to ask "is a release
 * already in progress" (a branch pushed but no PR opened for it yet --
 * see that workflow's own comment for why open-PR count alone is not
 * enough). That glob is a coarse, SERVER-SIDE prefilter, not a proof: it
 * also matches any OTHER `claude/release-...` branch this repository's own
 * agent workflow happens to name that way -- a feature branch, never a
 * release branch at all. `claude/release-footprint-dependent-ranges`
 * (issue #1339's own branch) and `claude/release-readiness-tracked-only-v2`
 * both matched it on the remote at the time this was found. Left
 * unfiltered, "a release is in progress" reads as true essentially
 * always, and the scheduled run can never proceed -- the failure mode is
 * silent (no error, just an empty `proceed=false` every day), which is
 * exactly why it went unnoticed until an end-to-end dry run caught it.
 *
 * This function is the single source of truth both the workflow (via a
 * thin `node --input-type=module -e` wrapper) and this module's own tests
 * call, so the two can never quietly disagree about what counts as a real
 * release-PR branch -- the same discipline `RELEASE_PR_BRANCH_PATTERN`
 * itself already documents.
 */
export function filterReleasePrBranchRefs(lsRemoteOutput) {
  return (lsRemoteOutput ?? "")
    .split("\n")
    .map((line) => line.split("\t")[1])
    .filter((ref) => typeof ref === "string" && ref.length > 0)
    .map((ref) => ref.replace(/^refs\/heads\//, ""))
    .filter((name) => RELEASE_PR_BRANCH_PATTERN.test(name));
}

/**
 * Of the real release-PR branches filterReleasePrBranchRefs() already
 * narrowed the remote down to, which are still genuinely IN PROGRESS --
 * i.e. should count toward `hasReleaseInProgress` -- versus LEFTOVER: a
 * release PR that was closed WITHOUT merging, whose branch
 * `delete_branch_on_merge` therefore never cleaned up (issue #1392,
 * "a leftover release branch from a closed-but-unmerged release PR blocks
 * every subsequent Saturday" -- https://github.com/clossys/foundry/pull/1353#issuecomment-5804131702).
 * Without this, a single abandoned/superseded release PR would silently
 * skip the release-PR guard forever, on every following Saturday, with no
 * error and no visible cause.
 *
 * `prsByBranch` is `{ [branchName]: Array<{ state, isCrossRepository }> }`
 * -- for each branch, the caller's own already-parsed output of
 * `gh ${releaseBranchPrListArgs(repo, branch).join(" ")}` (this module never
 * does its own network I/O, matching every other function here).
 *
 * `gh pr list --head <branch>` matches by head branch NAME only, so it also
 * returns pull requests from forks whose branch happens to share the name.
 * This repository is public, so anyone can read a pending release branch's
 * name, push a same-named branch to a fork, and open then close a PR from it.
 * A fork PR therefore never decides anything here: every entry whose
 * `isCrossRepository` is not exactly `false` is ignored. A branch is
 * LEFTOVER -- excluded from "in progress" -- only when at least one
 * same-repository PR exists and EVERY same-repository PR is exactly
 * "CLOSED" (closed without merging, the leftover case this function exists
 * for) or "MERGED" (delete_branch_on_merge should already have removed it,
 * but this stays correct in the instant before that deletion lands). No
 * same-repository PR at all is the real, ordinary window release-pr.yml's
 * own header describes (push the branch, then stop and wait for an
 * owner-authenticated actor to open the PR), so it counts as IN PROGRESS,
 * as does any OPEN or unrecognised state and any malformed entry.
 */
export function releaseBranchPrListArgs(repository, branch) {
  return ["pr", "list", "--repo", repository, "--head", branch, "--state", "all", "--json", "state,isCrossRepository"];
}

export function isLeftoverReleaseBranch(prs) {
  const sameRepository = (Array.isArray(prs) ? prs : []).filter((pr) => pr?.isCrossRepository === false);
  if (sameRepository.length === 0) return false;
  return sameRepository.every((pr) => pr.state === "CLOSED" || pr.state === "MERGED");
}

export function inProgressReleaseBranches(branchNames, prsByBranch = {}) {
  return (branchNames ?? []).filter((name) => !isLeftoverReleaseBranch(prsByBranch?.[name]));
}

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
 * Is `now` within the merge window, or is it a release/adoption day on
 * which only the release PR (proven by BOTH the RELEASE_PR_LABEL label AND
 * `footprintVerified` -- a STRUCTURAL, content-level proof that the diff
 * is exactly the release PR's shape, computed by
 * scripts/lib/release-pr-footprint.mjs's evaluateReleasePrFootprint() plus
 * a lockfile-regeneration check, both of which need real git/npm access
 * this module deliberately never has -- see this module's own header) or
 * an out-of-band labelled pull request may land?
 *
 * `footprintVerified` is injected, not computed here, for two reasons:
 * this module stays pure (no filesystem, no git, no network, matching
 * every other function in it) and testable with a plain boolean; and the
 * caller (scripts/check-release-calendar.mjs) is the one place that
 * already has to reconcile a paginated GitHub REST call (fail closed if
 * it cannot read every page -- that caller's own concern, not this
 * function's) with the local git/npm work the footprint proof needs.
 * `footprintVerified` must therefore be `false` (never merely omitted or
 * left ambiguous) whenever that proof could not be completed for ANY
 * reason -- ambiguity here reads as "not the release PR", never as "we
 * didn't check."
 */
export function evaluateReleaseCalendarGate({ calendar, now, labels = [], footprintVerified = false }) {
  const dayType = dayTypeFor(now, calendar.timezone, calendar);
  if (dayType === "merge-window") {
    return { status: "pass", dayType, reason: `merge window is open (${calendar.timezone})` };
  }

  const outOfBandLabel = calendar.outOfBandPolicy?.changesetFlag ?? DEFAULT_OUT_OF_BAND_LABEL;
  const releasePrLabel = calendar.releasePrPolicy?.label ?? DEFAULT_RELEASE_PR_LABEL;
  const hasReleasePrLabel = (labels ?? []).includes(releasePrLabel);
  const isReleasePr = hasReleasePrLabel && footprintVerified === true;
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
      `This is neither the release PR (needs the "${releasePrLabel}" label AND a verified release-PR-shaped diff -- got label=${hasReleasePrLabel}, footprintVerified=${footprintVerified === true}) ` +
      `nor labelled "${outOfBandLabel}". The merge window reopens ${nextWindow}.`,
  };
}

/**
 * Should the release-pr.yml cron actually open a release PR right now?
 * True when it is release day (calendar.releaseDay) in the calendar's
 * timezone AND `hasReleaseInProgress` is false. `hasReleaseInProgress` is
 * an injected fact rather than something this pure function could ever
 * determine itself -- it has no network access, by design, same as every
 * other function in this module.
 *
 * "In progress" is broader than "an open PR exists" (re-review,
 * https://github.com/clossys/foundry/pull/1316#issuecomment-5800566625):
 * since .github/workflows/release-pr.yml's own Saturday job pushes the
 * release commit and then STOPS, waiting for an owner-authenticated actor
 * to open the pull request (docs/RELEASING.md, "Opening the release PR"),
 * there is a real window where a release branch exists with no PR open
 * for it yet. A dedupe check that only asked "is a PR open" would treat
 * that window as "nothing in progress" and let the very next day's run
 * push a SECOND release branch/commit before the first one's PR was ever
 * opened. The workflow therefore folds "does a pushed-but-unopened
 * release branch already exist" into the same `hasReleaseInProgress`
 * boolean it passes here, alongside "is a release:weekly PR open" -- this
 * function does not need to know which signal tripped it, only that
 * SOMETHING is already in flight for this week.
 *
 * See this module's own header for why this replaced an exact-hour
 * DST-tolerance window: a delayed or repeated run now degrades to a safe
 * no-op instead of either missing its window or opening a second release
 * PR for the same week.
 */
export function shouldOpenReleasePr({ now, calendar, hasReleaseInProgress }) {
  const dayType = dayTypeFor(now, calendar.timezone, calendar);
  if (dayType !== "release") return false;
  return !hasReleaseInProgress;
}
