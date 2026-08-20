import { IntegratorValidationError } from "./errors.js";
import { isValidPackageName } from "./package-name.js";
import { parseVersion } from "./semver.js";

/**
 * Detects a manifest holding BOTH a package this plane installs AND a name
 * that package supersedes -- two visual systems, two auth surfaces, two
 * copies of the same contract, sitting side by side with no version
 * conflict to make the duplication loud, because the names differ and a
 * lockfile resolves both happily.
 *
 * THE BLINDNESS RULE, applied here exactly as it is everywhere else in this
 * package: this module ships no supersession map and no consumer package
 * names, and never will. `SupersessionMap` is caller-supplied, the same way
 * `EntitlementDeclaration` and `AdmissionContract` are -- each consuming
 * plane declares its own legacy-name-to-replacement mapping privately, in
 * its own workspace, and hands it to `detectSupersession` at call time. This
 * package never learns what any plane actually installs, let alone what any
 * plane used to install.
 *
 * Pure and hermetic: no network, no filesystem. `detectSupersession` never
 * throws -- a manifest or a supersession map this function cannot trust is
 * reported as `indeterminate`, with a named machine-readable reason, never
 * silently folded into `satisfied` and never silently reported as zero
 * pairs. See `./currency.ts`'s own doc comment for why a discriminated
 * union, one variant per state, is used here instead of one wider shape with
 * every field optional.
 */

/** One legacy-name-to-replacement mapping entry a consuming plane declares about itself. */
export interface SupersessionEntry {
  /** The package published from this repository that replaces the legacy name. */
  readonly replacement: string;
  /** The version of `replacement` this supersession took effect from. A plain semantic version, not a range. */
  readonly since: string;
}

/** A consuming plane's own, privately declared supersession map. Never shipped by this repository. */
export interface SupersessionMap {
  readonly version: 1;
  readonly supersededBy: Readonly<Record<string, SupersessionEntry>>;
}

/**
 * Every place a name can appear in an npm-shaped manifest and still resolve
 * a real dependency. `overrides` (npm) and `resolutions` (yarn) are included
 * deliberately: a superseding package pinned in one ordinary dependency
 * field and a superseded name pinned only in an override/resolution block is
 * still two copies of the same catalogue entry installed side by side.
 */
export const DEPENDENCY_POSITIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
] as const;

export type DependencyPosition = (typeof DEPENDENCY_POSITIONS)[number];

/** One confirmed conflict: a manifest holding both sides of a declared supersession. */
export interface SupersededPair {
  readonly legacyName: string;
  /** Every dependency position the legacy name was found in, sorted. */
  readonly legacyPositions: readonly DependencyPosition[];
  readonly replacementName: string;
  /** Every dependency position the replacement was found in, sorted. */
  readonly replacementPositions: readonly DependencyPosition[];
  readonly since: string;
}

/** Why `detectSupersession` could not form an opinion at all. Never omitted -- see the module doc comment. */
export type SupersessionIndeterminateReason =
  | "manifest-invalid"
  | "supersession-map-invalid"
  | "supersession-map-empty";

/** The three verdicts every gate in this fleet folds to (see `./currency.ts`'s `CurrencyVerdict`). */
export type SupersessionResult =
  | {
      readonly verdict: "satisfied";
      /** How many supersession-map entries were actually evaluated against the manifest. Always a positive integer -- see `gateSatisfied`'s reasoning in `@vespeneventures/controller`, independently reinvented here for the same reason. */
      readonly evaluated: number;
      /** Always `0` on `satisfied` -- present so a caller can chart this number over time without branching on verdict first. */
      readonly count: 0;
    }
  | {
      readonly verdict: "violated";
      /** Every confirmed conflict, one per superseded pair found. Never empty. */
      readonly pairs: readonly SupersededPair[];
      /** `pairs.length`, named explicitly rather than left for a caller to compute -- the falling count over time is the useful artifact this gate reports (see the README). */
      readonly count: number;
    }
  | {
      readonly verdict: "indeterminate";
      readonly reason: SupersessionIndeterminateReason;
      readonly detail?: string;
    };

function fail(code: "INVALID_SUPERSESSION_MANIFEST" | "INVALID_SUPERSESSION_MAP", message: string): never {
  throw new IntegratorValidationError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PositionsByName = Map<string, Set<DependencyPosition>>;

function addName(index: PositionsByName, name: string, position: DependencyPosition): void {
  // A key that is not shaped like a real package name is not a candidate for
  // this gate's pairing logic (e.g. npm overrides' own "." self-marker), and
  // is silently skipped rather than failing the whole manifest -- the same
  // tolerance `declaredRanges` in `./inventory.ts` extends to a manifest field
  // it can otherwise parse cleanly.
  if (!isValidPackageName(name)) return;
  let positions = index.get(name);
  if (positions === undefined) {
    positions = new Set();
    index.set(name, positions);
  }
  positions.add(position);
}

/**
 * Recursively collects every key npm's `overrides` field can nest a package
 * name under (`overrides: { react: { ".": "17.0.0", "react-dom": "17.0.0" } }`
 * pins both `react` and, nested inside it, `react-dom`). `.` is npm's own
 * marker for "the direct dependency itself", never a package name, and is
 * skipped. Every other key is compared to a target name with exact string
 * equality by the caller -- nothing here ever substring-matches a key.
 */
function collectOverrideNames(node: unknown, index: PositionsByName): void {
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key !== ".") addName(index, key, "overrides");
    if (isPlainObject(value)) collectOverrideNames(value, index);
  }
}

/**
 * Yarn's `resolutions` keys are a "/"-delimited selector path
 * (`"some-parent/lodash"`, `"**\/lodash"`, or a bare `"lodash"` / scoped
 * `"@scope/lodash"`) -- only the trailing package name actually gets
 * resolved; earlier segments merely scope which dependency chain the
 * override applies to. This extracts that trailing name by splitting into
 * segments and reassembling only the final scope+name pair, rather than
 * testing the raw key with `includes`/`indexOf` -- which is what keeps a
 * selector like `"**\/foo"` from ever being mistaken for a match against a
 * bare `"foo-utils"`.
 */
function packageNameFromResolutionKey(key: string): string | undefined {
  const segments = key.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  const last = segments[segments.length - 1] as string;
  if (last.startsWith("@")) return undefined; // a bare scope with no name segment names nothing
  const secondToLast = segments.length > 1 ? segments[segments.length - 2] : undefined;
  const candidate = secondToLast !== undefined && secondToLast.startsWith("@") ? `${secondToLast}/${last}` : last;
  return isValidPackageName(candidate) ? candidate : undefined;
}

function collectResolutionNames(node: unknown, index: PositionsByName): void {
  if (!isPlainObject(node)) return;
  for (const key of Object.keys(node)) {
    const name = packageNameFromResolutionKey(key);
    if (name !== undefined) addName(index, name, "resolutions");
  }
}

const SIMPLE_POSITIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const satisfies readonly DependencyPosition[];

/**
 * Parses a manifest -- raw JSON text, or an already-parsed value -- into a
 * map from every declared package name to the set of dependency positions it
 * was found in. Throws `IntegratorValidationError` (`INVALID_SUPERSESSION_MANIFEST`)
 * for anything this function cannot trust: text that does not parse as JSON,
 * a parsed value that is not a JSON object, or a dependency-position field
 * that is not itself an object. Offline and pure, same convention as
 * `loadEntitlementDeclaration`.
 */
function parseManifestNames(raw: unknown): PositionsByName {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      fail("INVALID_SUPERSESSION_MANIFEST", "manifest does not parse as JSON");
    }
  }
  if (!isPlainObject(value)) {
    fail("INVALID_SUPERSESSION_MANIFEST", "manifest must be a JSON object");
  }
  const manifest = value;

  const index: PositionsByName = new Map();
  for (const position of SIMPLE_POSITIONS) {
    const block = manifest[position];
    if (block === undefined) continue;
    if (!isPlainObject(block)) fail("INVALID_SUPERSESSION_MANIFEST", `manifest field "${position}" must be an object`);
    for (const name of Object.keys(block)) addName(index, name, position);
  }

  const overrides = manifest["overrides"];
  if (overrides !== undefined) {
    if (!isPlainObject(overrides)) fail("INVALID_SUPERSESSION_MANIFEST", 'manifest field "overrides" must be an object');
    collectOverrideNames(overrides, index);
  }

  const resolutions = manifest["resolutions"];
  if (resolutions !== undefined) {
    if (!isPlainObject(resolutions)) fail("INVALID_SUPERSESSION_MANIFEST", 'manifest field "resolutions" must be an object');
    collectResolutionNames(resolutions, index);
  }

  return index;
}

/**
 * Validates a parsed (or raw-JSON-text) supersession map and returns it in
 * normalized form. Offline and pure, same convention as
 * `loadAdmissionContract`. Throws `IntegratorValidationError`
 * (`INVALID_SUPERSESSION_MAP`) for anything not trustworthy: the wrong
 * shape, an invalid legacy or replacement package name, a `since` that is
 * not a real semantic version, or an entry naming itself as its own
 * replacement -- a map that has drifted from reality must never read as
 * clean, and this is the check that catches the drift before it can.
 */
function parseSupersessionMap(raw: unknown): SupersessionMap {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      fail("INVALID_SUPERSESSION_MAP", "supersession map does not parse as JSON");
    }
  }
  if (!isPlainObject(value)) fail("INVALID_SUPERSESSION_MAP", "supersession map must be a JSON object");
  if (value["version"] !== 1) fail("INVALID_SUPERSESSION_MAP", "supersession map must set version: 1");

  const rawSupersededBy = value["supersededBy"];
  if (!isPlainObject(rawSupersededBy)) fail("INVALID_SUPERSESSION_MAP", "supersededBy must be an object");

  const supersededBy: Record<string, SupersessionEntry> = {};
  for (const [legacyName, rawEntry] of Object.entries(rawSupersededBy)) {
    if (!isValidPackageName(legacyName)) fail("INVALID_SUPERSESSION_MAP", `supersededBy has an invalid legacy package name: ${JSON.stringify(legacyName)}`);
    if (!isPlainObject(rawEntry)) fail("INVALID_SUPERSESSION_MAP", `supersededBy entry for ${legacyName} must be an object`);

    const replacement = rawEntry["replacement"];
    if (!isValidPackageName(replacement)) fail("INVALID_SUPERSESSION_MAP", `supersededBy entry for ${legacyName} has an invalid replacement name`);
    if (replacement === legacyName) fail("INVALID_SUPERSESSION_MAP", `supersededBy entry for ${legacyName} cannot name itself as its own replacement`);

    const since = rawEntry["since"];
    if (typeof since !== "string") fail("INVALID_SUPERSESSION_MAP", `supersededBy entry for ${legacyName} must declare since as a version string`);
    try {
      parseVersion(since);
    } catch {
      fail("INVALID_SUPERSESSION_MAP", `supersededBy entry for ${legacyName} has an invalid since version: ${JSON.stringify(since)}`);
    }

    supersededBy[legacyName] = { replacement, since };
  }

  return { version: 1, supersededBy: Object.freeze(supersededBy) };
}

/**
 * Pure evaluation over already-validated inputs: which supersession-map
 * entries have BOTH the legacy name and the replacement present in the
 * manifest, at any dependency position, in either order. Exact string
 * equality only -- a name is looked up by the whole string the map declares,
 * never by a substring or prefix test, which is what keeps a superseded
 * `foo` from ever matching an installed `foo-utils` or `@scope/foo-legacy`.
 * Every entry is checked; this never stops at the first conflict, same
 * convention as `judgeCurrency`.
 */
function findSupersededPairs(manifestNames: PositionsByName, supersessionMap: SupersessionMap): readonly SupersededPair[] {
  const pairs: SupersededPair[] = [];
  for (const [legacyName, entry] of Object.entries(supersessionMap.supersededBy)) {
    const legacyPositions = manifestNames.get(legacyName);
    if (legacyPositions === undefined) continue; // legacy name not installed at all -- nothing to conflict with
    const replacementPositions = manifestNames.get(entry.replacement);
    if (replacementPositions === undefined) continue; // only the legacy name present -- not yet migrated, but not a duplication either
    pairs.push({
      legacyName,
      legacyPositions: [...legacyPositions].sort(),
      replacementName: entry.replacement,
      replacementPositions: [...replacementPositions].sort(),
      since: entry.since,
    });
  }
  return pairs.sort((a, b) => a.legacyName.localeCompare(b.legacyName));
}

/**
 * THE mechanism: `(manifest, supersessionMap) -> result`. Pure, hermetic, and
 * never throws -- every failure mode this function can hit is folded into
 * `indeterminate`, never into a silent `satisfied` and never into a silently
 * empty pair count.
 *
 * `manifest` may be a manifest's raw JSON text, or an already-parsed value --
 * either way, anything that does not parse as JSON, or does not shape up as a
 * JSON object with well-formed dependency-position fields, is `indeterminate`
 * (`"manifest-invalid"`).
 *
 * `supersessionMap` is caller-supplied and validated the same way: the wrong
 * shape, an invalid name on either side, a `since` that is not a real
 * version, or an entry naming itself as its own replacement is
 * `indeterminate` (`"supersession-map-invalid"`). A syntactically valid map
 * with zero entries is `indeterminate` too (`"supersession-map-empty"`) --
 * zero entries is not evidence of a clean pass, it is nothing having been
 * evaluated, the same reasoning `gateSatisfied` enforces elsewhere in this
 * fleet for exactly this shape of false-positive-by-omission.
 *
 * Otherwise this reports `violated` with every confirmed pair (never just
 * the first) or `satisfied` with how many map entries were evaluated.
 */
export function detectSupersession(manifest: unknown, supersessionMap: unknown): SupersessionResult {
  let manifestNames: PositionsByName;
  try {
    manifestNames = parseManifestNames(manifest);
  } catch (error) {
    return {
      verdict: "indeterminate",
      reason: "manifest-invalid",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let loadedMap: SupersessionMap;
  try {
    loadedMap = parseSupersessionMap(supersessionMap);
  } catch (error) {
    return {
      verdict: "indeterminate",
      reason: "supersession-map-invalid",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const entryCount = Object.keys(loadedMap.supersededBy).length;
  if (entryCount === 0) {
    return { verdict: "indeterminate", reason: "supersession-map-empty", detail: "supersededBy has no entries to evaluate" };
  }

  const pairs = findSupersededPairs(manifestNames, loadedMap);
  if (pairs.length > 0) {
    return { verdict: "violated", pairs, count: pairs.length };
  }
  return { verdict: "satisfied", evaluated: entryCount, count: 0 };
}

/** Process exit code for a result: the fleet-wide 0/1/2 ternary, so no caller re-derives it. */
export function supersessionResultToExitCode(result: SupersessionResult): 0 | 1 | 2 {
  if (result.verdict === "satisfied") return 0;
  if (result.verdict === "violated") return 1;
  return 2;
}
