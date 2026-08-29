/**
 * A minimal dotted-numeric version comparator for the `minimum-version`
 * requirement constraint (issue #318) -- exactly enough to parse and compare
 * a value like `"20"`, `"10.33.0"`, or `"v20.11.0"` and nothing else.
 *
 * Deliberately NOT the semantic-version parser `@clossys/integrator`
 * ships in its own `semver.ts`: this package declares no runtime
 * dependencies (see its own `package.json`), and `integrator` is a
 * consumer-facing currency package, not something `controller` should
 * couple itself to for one small comparator. The grammar here is also
 * intentionally looser than strict semver -- an `engines.node` or
 * `engines.pnpm` floor like `>=20` or `>=10.33.0` is a bare dotted-numeric
 * value, never a prerelease or build-metadata suffix -- so reusing a strict
 * `major.minor.patch` parser would reject the exact inputs this constraint
 * exists to express.
 *
 * `parseVersionFloor` never throws: an unparseable string returns
 * `undefined`, and every caller in this module folds that into a reported
 * finding or an `unsatisfied` result, never a silent pass.
 */

/** Up to three non-negative integer components; a missing trailing component reads as `0`. */
export type ParsedVersionFloor = readonly [number, number, number];

const VERSION_FLOOR_PATTERN = /^v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?$/;

/** Parses a bare dotted-numeric version string. Returns `undefined` rather than throwing when it does not parse. */
export function parseVersionFloor(value: string): ParsedVersionFloor | undefined {
  const match = VERSION_FLOOR_PATTERN.exec(value.trim());
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor ?? "0"), Number(patch ?? "0")];
}

/** Negative when `a` is lower than `b`, positive when higher, zero when equal. */
export function compareVersionFloors(a: ParsedVersionFloor, b: ParsedVersionFloor): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/** True only when `value` parses AND is greater than or equal to `floor`. A parse failure on either side is `false`, never a thrown error. */
export function meetsVersionFloor(value: string, floor: string): boolean {
  const parsedValue = parseVersionFloor(value);
  const parsedFloor = parseVersionFloor(floor);
  if (parsedValue === undefined || parsedFloor === undefined) return false;
  return compareVersionFloors(parsedValue, parsedFloor) >= 0;
}
