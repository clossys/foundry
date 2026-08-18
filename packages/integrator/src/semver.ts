import { IntegratorValidationError } from "./errors.js";

/**
 * A minimal semantic-version parser and comparator -- exactly the subset the
 * version reconciler needs (major.minor.patch, an optional prerelease, an
 * ignored build metadata suffix) and nothing else. Kept in-package rather than
 * pulled in as a dependency: this repository's default answer to adding a
 * runtime dependency is no, and comparing two dotted-triple strings does not
 * clear that bar.
 */

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;

export function parseVersion(value: string): ParsedVersion {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) {
    throw new IntegratorValidationError("INVALID_VERSION", `Not a valid semantic version: ${JSON.stringify(value)}`);
  }
  const [, majorText, minorText, patchText, prereleaseText] = match as unknown as [string, string, string, string, string | undefined];
  const prerelease: (string | number)[] =
    prereleaseText === undefined
      ? []
      : prereleaseText.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { major: Number(majorText), minor: Number(minorText), patch: Number(patchText), prerelease: Object.freeze(prerelease) };
}

function comparePrerelease(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  // Per semver: a version with no prerelease outranks one with a prerelease.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1; // fewer identifiers sorts lower
    if (right === undefined) return 1;
    if (typeof left === "number" && typeof right === "number") {
      if (left !== right) return left - right;
      continue;
    }
    if (typeof left === "number") return -1; // numeric identifiers sort before alphanumeric
    if (typeof right === "number") return 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** Negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.prerelease, right.prerelease);
}
