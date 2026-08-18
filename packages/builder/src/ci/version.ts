/**
 * The staleness floor for this package's own CI-mechanics CLIs.
 *
 * #257's actual triggering defect was never "a gate was wrong" — it was "a
 * fix landed in one copy of a gate and had no path to the other copies."
 * Publishing this package gives a fix a path; on its own that gives a
 * caller no signal that it is standing on the far side of one. #257 asks
 * for that signal explicitly: "a caller-visible signal that a specific
 * installed version is stale... via a documented minimum-safe-version floor
 * the CLI checks its own resolved version against and fails loudly — mode
 * 2, not a silent 0 — if the installed copy is below it."
 *
 * This module is a leaner, purpose-built copy of the same mechanism
 * `@vespeneventures/verify-standards` already ships and already proved (see
 * that package's own `src/version.ts` for the fuller account of why two
 * independent facts — the running build's own version, and the range a
 * caller declared for it — are both checked, and why the caller-supplied
 * floor may only ever raise the compiled one, never lower it). It is
 * intentionally not imported from that package: `verify-standards` is a
 * separate, independently versioned package in this same repository, and a
 * runtime dependency between two Wave-1 packages that do not otherwise need
 * each other would couple their release cadences for no reason. The
 * mechanism is small enough to own twice; the two copies are meant to stay
 * that way, not to converge on one later.
 *
 * Zero I/O: every input is passed in.
 */

import { createGateReasons, gateSatisfied } from "@vespeneventures/controller/gates";
import type { GateResult } from "@vespeneventures/controller/gates";

/**
 * The oldest build of this package's CI mechanics whose behaviour is still
 * trusted. Raise this — in the same change that lands the fix, never in a
 * follow-up — whenever a released version is found to have reported a
 * passing verdict it should not have.
 */
export const MINIMUM_SAFE_VERSION = "0.1.0";

export const versionFloorReasons = createGateReasons([
  "unknown-installed-version",
  "unknown-minimum-version",
  "stale-installed-version",
  "unparseable-declared-range",
  "declared-range-permits-stale-version",
] as const);

export type VersionFloorReason = (typeof versionFloorReasons.reasons)[number];

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value: string | undefined): ParsedVersion | undefined {
  if (typeof value !== "string") return undefined;
  const match = VERSION.exec(value.trim());
  if (!match) return undefined;
  const [major, minor, patch] = [match[1], match[2], match[3]].map((part) => Number(part));
  if (![major, minor, patch].every((part) => Number.isSafeInteger(part))) return undefined;
  return { major: major as number, minor: minor as number, patch: patch as number, prerelease: match[4] };
}

export function compareVersions(left: ParsedVersion, right: ParsedVersion): -1 | 0 | 1 {
  for (const part of ["major", "minor", "patch"] as const) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** The lowest version a caller-declared range can legitimately resolve to. Same conservative subset as `verify-standards`. */
export function lowestSatisfyingVersion(range: string | undefined): ParsedVersion | undefined {
  if (typeof range !== "string") return undefined;
  const trimmed = range.trim();
  if (trimmed === "") return undefined;
  const match = /^(\^|~|>=|>)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(trimmed);
  if (!match) return undefined;
  return parseVersion(match[2]);
}

export interface VersionFloorInput {
  readonly installedVersion: string | undefined;
  readonly minimumVersion?: string | undefined;
  readonly declaredRange?: string | undefined;
}

export interface VersionFloorReport {
  readonly result: GateResult<never, VersionFloorReason>;
  readonly effectiveMinimumVersion: string;
}

/** Evaluates the staleness floor. Never returns `violated` — see `verify-standards`'s own copy for why. */
export function checkVersionFloor(input: VersionFloorInput): VersionFloorReport {
  const compiledFloor = parseVersion(MINIMUM_SAFE_VERSION);
  if (compiledFloor === undefined) {
    return {
      result: versionFloorReasons.indeterminate(
        "unknown-minimum-version",
        `The compiled minimum-safe-version ${JSON.stringify(MINIMUM_SAFE_VERSION)} is not a parseable version.`,
      ),
      effectiveMinimumVersion: MINIMUM_SAFE_VERSION,
    };
  }

  const callerFloor = input.minimumVersion === undefined ? undefined : parseVersion(input.minimumVersion);
  if (input.minimumVersion !== undefined && callerFloor === undefined) {
    return {
      result: versionFloorReasons.indeterminate(
        "unknown-minimum-version",
        `A minimum version was supplied but is not parseable: ${JSON.stringify(input.minimumVersion)}.`,
      ),
      effectiveMinimumVersion: MINIMUM_SAFE_VERSION,
    };
  }

  const callerRaisesFloor = callerFloor !== undefined && compareVersions(callerFloor, compiledFloor) > 0;
  const effective = callerRaisesFloor ? (callerFloor as ParsedVersion) : compiledFloor;
  const effectiveMinimumVersion = callerRaisesFloor ? (input.minimumVersion as string).trim() : MINIMUM_SAFE_VERSION;

  const installed = parseVersion(input.installedVersion);
  if (installed === undefined) {
    return {
      result: versionFloorReasons.indeterminate(
        "unknown-installed-version",
        "This build could not determine its own version, so it cannot tell whether it predates the minimum safe version.",
      ),
      effectiveMinimumVersion,
    };
  }

  if (compareVersions(installed, effective) < 0) {
    return {
      result: versionFloorReasons.indeterminate(
        "stale-installed-version",
        `Installed version ${input.installedVersion} is below the minimum safe version ${effectiveMinimumVersion}. Upgrade before trusting any verdict from this run.`,
      ),
      effectiveMinimumVersion,
    };
  }

  if (input.declaredRange !== undefined) {
    const lowest = lowestSatisfyingVersion(input.declaredRange);
    if (lowest === undefined) {
      return {
        result: versionFloorReasons.indeterminate(
          "unparseable-declared-range",
          `The declared dependency range ${JSON.stringify(input.declaredRange)} is not one this check understands.`,
        ),
        effectiveMinimumVersion,
      };
    }
    if (compareVersions(lowest, effective) < 0) {
      return {
        result: versionFloorReasons.indeterminate(
          "declared-range-permits-stale-version",
          `The declared range ${JSON.stringify(input.declaredRange)} still resolves as low as ` +
            `${lowest.major}.${lowest.minor}.${lowest.patch}, below the minimum safe version ${effectiveMinimumVersion}. ` +
            "This run happens to be current; the next lockfile refresh need not be.",
        ),
        effectiveMinimumVersion,
      };
    }
    return { result: gateSatisfied(2), effectiveMinimumVersion };
  }

  return { result: gateSatisfied(1), effectiveMinimumVersion };
}
