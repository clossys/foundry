/**
 * `assertPeerVersion` — the runtime half of `./web`'s "optional peer, no
 * install-time signal in either direction" problem. `react`/`react-dom` are
 * declared `peerDependenciesMeta: { optional: true }` (see package.json) so
 * a consumer can install `@vespeneventures/consent` (the root, provider-
 * neutral core) without ever installing React — only `./web` needs it. But
 * an ABSENT or OUT-OF-RANGE `react` produced no signal of any kind until
 * this guard: a consumer on an incompatible React version would otherwise
 * learn about it from whatever `./web`'s components happened to crash on
 * deep inside React itself, with nothing naming a version range as the
 * cause. See `web/index.ts`'s own guard call, evaluated once at import
 * time via `react`'s own exported `version`, for where this is wired in.
 *
 * PORTED, NOT SHARED, from `packages/auth/src/internal/peer-version.ts` and
 * `packages/comms/src/internal/peer-version.ts` — byte-for-byte identical
 * algorithm, copied rather than imported across package boundaries for the
 * same structural reason those two give in their own headers: neither
 * package exposes this as part of its own public API surface, and even if
 * it did, `@vespeneventures/consent` gains nothing by depending on
 * `@vespeneventures/auth` or `@vespeneventures/comms` just to reach one
 * shared utility — that would trade a few duplicated lines for a real
 * runtime dependency this package's "zero dependencies" README claim would
 * then be wrong about. Keep all three copies in sync by hand if the ported
 * range algorithm ever changes.
 *
 * DELIBERATELY PURE — NO `node:*` IMPORTS IN THIS FILE. `./web`'s entry
 * point is reachable from a browser bundle (a client component rendering
 * `ConsentGate`), not just a Node process, so the version check reads
 * `react`'s own exported `version` directly rather than any Node-only
 * fs-based resolver.
 */

// ------------------------------------------------------------- range parsing

interface Bound {
  major: number;
  minor: number;
  patch: number;
}

/** Strict x.y.z only — same as scripts/check-workspace-links.mjs's parseVersion(). */
function parseVersion(version: string): Bound | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareVersions(a: Bound, b: Bound): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * An exact pin, a caret range, or a tilde range against a plain x.y.z. For
 * `0.y.z`, BOTH `^` and `~` are minor-locked; above `0.y.z`, `^` is
 * major-locked and only `~` is minor-locked. Returns `null` —
 * unparseable — for anything else, including the `>=`/`<` forms
 * `parseGteForm` below understands instead.
 */
function parsePinCaretTilde(range: string): { lower: Bound; upper: Bound } | null {
  const m = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  if (!m) return null;
  const prefix = m[1] ?? "";
  const major = Number(m[2]);
  const minor = Number(m[3]);
  const patch = Number(m[4]);
  if (prefix === "") return { lower: { major, minor, patch }, upper: { major, minor, patch: patch + 1 } };
  if (major === 0) return { lower: { major, minor, patch }, upper: { major, minor: minor + 1, patch: 0 } };
  if (prefix === "^") return { lower: { major, minor, patch }, upper: { major: major + 1, minor: 0, patch: 0 } };
  return { lower: { major, minor, patch }, upper: { major, minor: minor + 1, patch: 0 } }; // "~"
}

/**
 * A bounded `>=x[.y[.z]] <a[.b[.c]]>` range or an unbounded `>=x[.y[.z]]`
 * range — the shape this package's own `peerDependencies` uses for React
 * (`">=18"`). A version segment omitted from either side defaults to its
 * lowest value (`18` reads as `18.0.0`), matching ordinary semver range
 * convention. Returns `null` — unparseable — for anything else.
 */
function parseGteForm(range: string): { lower: Bound; upper: Bound | null } | null {
  const trimmed = String(range).trim();
  const segment = "(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?";
  const bounded = new RegExp(`^>=\\s*${segment}\\s+<\\s*${segment}$`).exec(trimmed);
  if (bounded) {
    const [, lMaj, lMin, lPat, uMaj, uMin, uPat] = bounded;
    return {
      lower: { major: Number(lMaj), minor: Number(lMin ?? "0"), patch: Number(lPat ?? "0") },
      upper: { major: Number(uMaj), minor: Number(uMin ?? "0"), patch: Number(uPat ?? "0") },
    };
  }
  const unbounded = new RegExp(`^>=\\s*${segment}$`).exec(trimmed);
  if (unbounded) {
    const [, maj, min, pat] = unbounded;
    return { lower: { major: Number(maj), minor: Number(min ?? "0"), patch: Number(pat ?? "0") }, upper: null };
  }
  return null;
}

type RangeSatisfaction = { evaluated: true; ok: boolean } | { evaluated: false; reason: string };

/**
 * Returns `{ evaluated: false, reason }` when either side could not be
 * parsed — a finding, never assumed satisfied — or `{ evaluated: true, ok
 * }` once both sides parsed cleanly.
 */
function satisfiesRange(versionStr: string, rangeStr: string): RangeSatisfaction {
  const bound = parsePinCaretTilde(rangeStr) ?? parseGteForm(rangeStr);
  if (!bound) {
    return {
      evaluated: false,
      reason: `"${rangeStr}" is not a range form this guard parses (an exact pin, ^x.y.z, ~x.y.z, ">=x.y.z <a.b.c>", or ">=x.y.z" are supported)`,
    };
  }
  const version = parseVersion(versionStr);
  if (!version) {
    return { evaluated: false, reason: `the installed version "${versionStr}" is not a plain x.y.z semver this guard can compare` };
  }
  const geLower = compareVersions(version, bound.lower) >= 0;
  const ltUpper = bound.upper === null ? true : compareVersions(version, bound.upper) < 0;
  return { evaluated: true, ok: geLower && ltUpper };
}

// ------------------------------------------------------------------ the guard

export interface AssertPeerVersionInput {
  /** The optional peer's package name, e.g. `"react"`. */
  peer: string;
  /** This package's own `peerDependencies` range for `peer`. */
  declaredRange: string;
  /** The peer's real installed version, or `undefined` if it could not be resolved at all. */
  foundVersion: string | undefined;
}

/**
 * Throws a named, actionable error naming the package, the declared range,
 * and the version actually found. Never returns a boolean — a guard must
 * state where control goes when it declines. A missing peer and an
 * out-of-range peer throw genuinely DIFFERENT messages — "not installed"
 * and "installed but incompatible" are different problems with different
 * fixes. An unparseable declared range or installed version is a third,
 * equally loud error, never an assumed pass.
 */
export function assertPeerVersion(input: AssertPeerVersionInput): void {
  const { peer, declaredRange, foundVersion } = input;

  if (foundVersion === undefined) {
    throw new Error(`${peer} is required for this import but is not installed. Install ${peer}@"${declaredRange}" — see this package's README for its optional-peer setup.`);
  }

  const outcome = satisfiesRange(foundVersion, declaredRange);
  if (!outcome.evaluated) {
    throw new Error(`Could not verify ${peer}@${foundVersion} against this package's declared range "${declaredRange}": ${outcome.reason}. Refusing to assume this is compatible.`);
  }
  if (!outcome.ok) {
    throw new Error(`${peer}@${foundVersion} is installed, but this package requires ${peer}@"${declaredRange}". Installed but incompatible — install a version of ${peer} that satisfies "${declaredRange}".`);
  }
}
