/**
 * The staleness floor.
 *
 * The defect this package exists to close is not "a gate was wrong." It is
 * "a fix landed in one copy of a gate and had no path to the other copies."
 * Publishing the gate as a package gives a fix a path; it does not, on its
 * own, give a caller any signal that it is standing on the far side of one.
 * A caller pinned to an exact old version, or holding a lockfile nobody has
 * refreshed, is in exactly the position every hand-vendored copy was in: it
 * still runs, still reports green, and nothing tells it what it is missing.
 *
 * So this module adds the missing signal, and makes it a hard failure rather
 * than a warning. A warning is what every existing shape already effectively
 * offers (a changelog entry someone may read), and it demonstrably does not
 * travel. Exit code `2` — "could not evaluate" — is the honest verdict here:
 * a build old enough to predate a fix classified as security-relevant cannot
 * vouch for the thing it was asked to check, whatever its checks happen to
 * report.
 *
 * TWO DIRECTIONS, AND THE HONEST LIMIT OF EACH
 * ---------------------------------------------
 * `MINIMUM_SAFE_VERSION` is a constant compiled into each build. A running
 * build can only ever compare against the floor *it* shipped with, so the
 * embedded floor alone can never fire on the copy that most needs it: an
 * old build carries an old floor and clears it trivially. Stating that
 * plainly matters more than the constant does — a floor that quietly cannot
 * fire in the one case it was written for would be this repository's own
 * #256 defect, wearing this package's name.
 *
 * The loop is closed by checking a *second*, independent fact the running
 * build genuinely can evaluate: the version range the caller declared for
 * this package in its own manifest. That range is caller-authored data, it
 * is passed in explicitly (never discovered), and a range whose lowest
 * satisfiable version sits below the floor means the caller's next lockfile
 * refresh may legitimately resolve a build this one already knows is unsafe.
 * That is a real, present, caller-visible defect a current build can see
 * about a stale caller, with no network access and no registry query.
 *
 * The two together give:
 *   - a current build, current caller → `satisfied`
 *   - a current build, caller whose declared range still admits pre-floor
 *     builds → `indeterminate` (`declared-range-permits-stale-version`)
 *   - an old build run against a floor the caller raised explicitly on the
 *     command line → `indeterminate` (`stale-installed-version`)
 *
 * The third case is why `--minimum-version` exists and why it may only ever
 * raise the floor, never lower it: a caller's own CI is the one place that
 * can hold a floor newer than the build being run, so it is the one place
 * from which an old build can be told it is old. Allowing that flag to
 * lower the compiled floor would turn the whole mechanism into an opt-out,
 * which is how a fail-closed gate becomes decorative.
 *
 * Zero I/O, like everything else in this package: every input is passed in.
 */

import { createGateReasons, gateSatisfied } from "@vespeneventures/controller/gates";
import type { GateResult } from "@vespeneventures/controller/gates";
import type { CheckFinding } from "./types.js";

/**
 * The oldest build of this package whose behaviour is still trusted.
 *
 * Raise this — in the same change that lands the fix, never in a follow-up —
 * whenever a released version is found to have reported a passing verdict it
 * should not have. Do not raise it for ordinary features or refactors: a
 * floor that moves for every release trains callers to bump past it without
 * reading why, which is the same "nobody reads the changelog" failure this
 * mechanism replaces.
 */
export const MINIMUM_SAFE_VERSION = "0.1.0";

/** Every reason this check can decline to vouch for the build it is running as. */
export const versionFloorReasons = createGateReasons([
  /** The running build could not determine its own version at all. */
  "unknown-installed-version",
  /** The floor itself was not a parseable version — the comparison is meaningless, so it is not made. */
  "unknown-minimum-version",
  /** The running build predates the floor it is being held to. */
  "stale-installed-version",
  /** A declared range was supplied but this package will not guess what it permits. */
  "unparseable-declared-range",
  /** The caller's declared range still admits builds below the floor. */
  "declared-range-permits-stale-version",
] as const);

/** One finding from the floor check. There is exactly one shape; the reasons carry the detail. */
export interface VersionFloorFinding extends CheckFinding {
  readonly rule: "version-floor";
}

/** Everything the floor check evaluates. All of it is supplied by the caller. */
export interface VersionFloorInput {
  /** The running build's own version, as resolved by whatever loaded it. */
  readonly installedVersion: string | undefined;
  /**
   * The floor to hold it to. Defaults to `MINIMUM_SAFE_VERSION`. A caller may
   * pass a HIGHER floor; a lower one is ignored in favour of the compiled
   * constant rather than honoured, and never silently — see
   * `VersionFloorReport.effectiveMinimumVersion`.
   */
  readonly minimumVersion?: string | undefined;
  /**
   * The range the caller declared for this package in its own manifest, if it
   * chose to supply one. Never discovered by this package.
   */
  readonly declaredRange?: string | undefined;
}

/** A parsed `major.minor.patch`, with any prerelease tag kept for ordering. */
export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses an exact `major.minor.patch` version. Deliberately strict: a value
 * this cannot parse produces `undefined`, and every caller here turns that
 * into an `indeterminate` verdict rather than an assumed-safe default.
 */
export function parseVersion(value: string | undefined): ParsedVersion | undefined {
  if (typeof value !== "string") return undefined;
  const match = VERSION.exec(value.trim());
  if (!match) return undefined;
  const [major, minor, patch] = [match[1], match[2], match[3]].map((part) => Number(part));
  if (![major, minor, patch].every((part) => Number.isSafeInteger(part))) return undefined;
  return {
    major: major as number,
    minor: minor as number,
    patch: patch as number,
    prerelease: match[4],
  };
}

/**
 * Orders two parsed versions. `-1`, `0`, `1` in the usual sense. A
 * prerelease sorts BELOW the release it precedes (`1.0.0-rc.1` < `1.0.0`),
 * which is the direction that matters here: a prerelease of the floor
 * version has not received the fix the floor was raised for.
 *
 * Prereleases with the same numeric core are compared as plain strings.
 * That is not full semver prerelease ordering, and it is not pretended to
 * be — it is only ever used to order two prereleases of one version against
 * each other, a case this repository does not publish into, and the
 * conservative direction (a string that sorts low is treated as older) fails
 * closed.
 */
export function compareVersions(left: ParsedVersion, right: ParsedVersion): -1 | 0 | 1 {
  for (const part of ["major", "minor", "patch"] as const) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * The lowest version a declared range can legitimately resolve to.
 *
 * Deliberately a small, conservative subset of npm range syntax — the forms
 * a real manifest actually uses for a first-party dependency (`^`, `~`,
 * `>=`, `>`, and a bare exact version). Anything else, including `*`, `x`,
 * a URL, a dist-tag, and every compound form, returns `undefined`, which the
 * caller reports as `indeterminate`. Guessing at an unrecognised range would
 * make this check answer confidently about syntax it does not understand,
 * which is precisely the failure mode the package exists to refuse.
 *
 * `>` is treated as if it were `>=`. The true floor of `>1.2.3` is the next
 * publishable version above it, which cannot be computed without the
 * registry's version list; treating the stated version as the floor is the
 * conservative approximation — it can only ever report a range as *more*
 * permissive than it is, never less.
 */
export function lowestSatisfyingVersion(range: string | undefined): ParsedVersion | undefined {
  if (typeof range !== "string") return undefined;
  const trimmed = range.trim();
  if (trimmed === "") return undefined;
  const match = /^(\^|~|>=|>)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(trimmed);
  if (!match) return undefined;
  return parseVersion(match[2]);
}

/** What the floor check concluded, alongside the verdict, for a report a human reads. */
export interface VersionFloorReport {
  readonly result: GateResult<VersionFloorFinding, (typeof versionFloorReasons.reasons)[number]>;
  /** The floor actually applied: the higher of the compiled constant and any caller-supplied floor. */
  readonly effectiveMinimumVersion: string;
  /** True when a caller supplied a floor lower than the compiled constant, which was therefore not applied. */
  readonly callerFloorIgnored: boolean;
}

function finding(message: string): VersionFloorFinding {
  return { rule: "version-floor", severity: "error", path: "installedVersion", message };
}

/**
 * Evaluates the staleness floor. Never returns `violated`: being out of date
 * is not a finding about the repository under inspection, it is this build
 * declining to vouch for its own verdicts, which is what `indeterminate`
 * means. `foldVerifyStandards` and the CLI both map that to exit code `2`.
 */
export function checkVersionFloor(input: VersionFloorInput): VersionFloorReport {
  const compiledFloor = parseVersion(MINIMUM_SAFE_VERSION);
  if (compiledFloor === undefined) {
    // Unreachable in a well-formed build; still not assumed away. If the
    // constant above is ever edited into something unparseable, this check
    // fails closed rather than skipping itself.
    return {
      result: versionFloorReasons.indeterminate(
        "unknown-minimum-version",
        `The compiled minimum-safe-version ${JSON.stringify(MINIMUM_SAFE_VERSION)} is not a parseable version.`,
      ),
      effectiveMinimumVersion: MINIMUM_SAFE_VERSION,
      callerFloorIgnored: false,
    };
  }

  const callerFloor = input.minimumVersion === undefined ? undefined : parseVersion(input.minimumVersion);
  if (input.minimumVersion !== undefined && callerFloor === undefined) {
    return {
      result: versionFloorReasons.indeterminate(
        "unknown-minimum-version",
        `A minimum version was supplied but is not a parseable version: ${JSON.stringify(input.minimumVersion)}.`,
      ),
      effectiveMinimumVersion: MINIMUM_SAFE_VERSION,
      callerFloorIgnored: false,
    };
  }

  const callerRaisesFloor = callerFloor !== undefined && compareVersions(callerFloor, compiledFloor) > 0;
  const effective = callerRaisesFloor ? (callerFloor as ParsedVersion) : compiledFloor;
  const effectiveMinimumVersion = callerRaisesFloor ? (input.minimumVersion as string).trim() : MINIMUM_SAFE_VERSION;
  const callerFloorIgnored = callerFloor !== undefined && !callerRaisesFloor && compareVersions(callerFloor, compiledFloor) < 0;
  const context = { effectiveMinimumVersion, callerFloorIgnored };

  const installed = parseVersion(input.installedVersion);
  if (installed === undefined) {
    return {
      ...context,
      result: versionFloorReasons.indeterminate(
        "unknown-installed-version",
        "This build could not determine its own version, so it cannot tell whether it predates the minimum safe version.",
      ),
    };
  }

  if (compareVersions(installed, effective) < 0) {
    return {
      ...context,
      result: versionFloorReasons.indeterminate(
        "stale-installed-version",
        `Installed version ${input.installedVersion} is below the minimum safe version ${effectiveMinimumVersion}. ` +
          "Upgrade before trusting any verdict from this run.",
      ),
    };
  }

  if (input.declaredRange !== undefined) {
    const lowest = lowestSatisfyingVersion(input.declaredRange);
    if (lowest === undefined) {
      return {
        ...context,
        result: versionFloorReasons.indeterminate(
          "unparseable-declared-range",
          `The declared dependency range ${JSON.stringify(input.declaredRange)} is not one this check understands, ` +
            "so it cannot tell whether the range still admits builds below the minimum safe version.",
        ),
      };
    }
    if (compareVersions(lowest, effective) < 0) {
      return {
        ...context,
        result: versionFloorReasons.indeterminate(
          "declared-range-permits-stale-version",
          `The declared dependency range ${JSON.stringify(input.declaredRange)} still resolves as low as ` +
            `${lowest.major}.${lowest.minor}.${lowest.patch}, below the minimum safe version ${effectiveMinimumVersion}. ` +
            "This run happens to be current; the next lockfile refresh need not be.",
        ),
      };
    }
    // Two facts were evaluated: the running build's version and the caller's
    // declared range.
    return { ...context, result: gateSatisfied(2) };
  }

  return { ...context, result: gateSatisfied(1) };
}

/** Exported only so a caller can render "why did this fail" without re-deriving the message. */
export function versionFloorFindings(report: VersionFloorReport): readonly VersionFloorFinding[] {
  return report.result.verdict === "indeterminate" ? [finding(report.result.detail ?? report.result.reason)] : [];
}
