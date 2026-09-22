/**
 * `assertPeerVersion` — the runtime half of `./web`'s "optional peer, no
 * install-time signal in either direction" problem. `react`/`react-dom` are
 * declared `peerDependenciesMeta: { optional: true }` (see package.json) so a
 * consumer can install `@clossys/keeper` (the root, DOM-free core and
 * the `keeper-check` gates) without ever installing React — only `./web`
 * needs it. But an ABSENT or OUT-OF-RANGE `react` produces no signal of any
 * kind without this guard: a consumer on an incompatible React version would
 * otherwise learn about it from whatever `./web` happened to crash on deep
 * inside React itself, with nothing naming a version range as the cause. See
 * `web/index.ts`'s own guard call, evaluated once at import time via `react`'s
 * own exported `version`, for where this is wired in.
 *
 * This is the same obligation this repository's own contribution guide states
 * for every requirement this workspace takes on: requiring a prerequisite is
 * legitimate; failing silently when it is unmet is not, because that turns a
 * setup error into a debugging session inside somebody else's codebase.
 *
 * PORTED, NOT SHARED, from this repository's canonical `assertPeerVersion`
 * implementation (#389, ported into this file via #847) — identical
 * algorithm, copied rather than imported across a package boundary for the
 * structural reason the canonical body's own header gives: that package does
 * not expose this as part of its public API surface, and even if it did,
 * `@clossys/keeper` would gain nothing by taking a real runtime
 * dependency on a sibling just to reach one shared utility, and its "zero
 * runtime dependencies" claim would then be wrong. Keep the copies in sync by
 * hand if the ported range algorithm ever changes.
 *
 * DELIBERATELY PURE — NO `node:*` IMPORTS IN THIS FILE. `./web`'s entry point
 * is reachable from a browser bundle (a client component rendering the "here
 * is everything we hold about you" surface), not just a Node process, so the
 * version check reads `react`'s own exported `version` directly rather than
 * any Node-only fs-based resolver.
 *
 * THE FAILURE DIRECTION FOR AN UNPARSEABLE INSTALLED VERSION IS DELIBERATELY
 * INVERTED FROM EVERY OTHER DECLINE PATH HERE (#389; this file previously
 * lacked the fix — see #847). A peer version this guard cannot parse —
 * including one carrying a prerelease identifier, e.g. Turbopack vendoring
 * its own canary React build during SSR instead of the consumer's real,
 * installed `react` — is not a value that FAILED this check. It is a value
 * the checker could not form an opinion about at all: `indeterminate`,
 * reported once via `console.warn` and never thrown as though it were a real,
 * actionable violation. An unparseable DECLARED RANGE is unchanged — that
 * range is this package's own source, not external input, so failing to
 * parse it is this package's own bug and still throws.
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

type RangeSatisfaction =
  | { evaluated: true; ok: boolean }
  /**
   * This package's OWN declared range failed to parse — not an external
   * input, a defect in this package's own source. Still loud: see
   * `assertPeerVersion`.
   */
  | { evaluated: false; kind: "unparseable-range"; reason: string }
  /**
   * The externally-supplied installed version failed to parse — including
   * any value carrying a prerelease identifier (`19.3.0-canary-...`),
   * build metadata (`1.99.1+build.5`), or anything else that is not a
   * plain `x.y.z`. This is `indeterminate`, not `violated`: see this
   * file's header and `assertPeerVersion`.
   */
  | { evaluated: false; kind: "unparseable-version"; reason: string };

/** True when `versionStr` looks like `x.y.z-<prerelease>`, for a more specific warning. */
function looksLikePrereleaseVersion(versionStr: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(String(versionStr).trim());
}

/**
 * Returns `{ evaluated: false, kind, reason }` when either side could not
 * be parsed — a finding, never assumed satisfied — or `{ evaluated: true,
 * ok }` once both sides parsed cleanly. `kind` distinguishes an
 * unparseable RANGE (this package's own bug — `assertPeerVersion` still
 * throws) from an unparseable installed VERSION (an external input this
 * guard could not read — `assertPeerVersion` warns and proceeds; see this
 * file's header).
 */
function satisfiesRange(versionStr: string, rangeStr: string): RangeSatisfaction {
  const bound = parsePinCaretTilde(rangeStr) ?? parseGteForm(rangeStr);
  if (!bound) {
    return {
      evaluated: false,
      kind: "unparseable-range",
      reason:
        `"${rangeStr}" is not a range form this guard parses (an exact pin, ^x.y.z, ~x.y.z, ` +
        `">=x.y.z <a.b.c>", or ">=x.y.z" are supported)`,
    };
  }
  const version = parseVersion(versionStr);
  if (!version) {
    return {
      evaluated: false,
      kind: "unparseable-version",
      reason: looksLikePrereleaseVersion(versionStr)
        ? `the installed version "${versionStr}" carries a prerelease identifier this guard will not guess an ordering for`
        : `the installed version "${versionStr}" is not a plain x.y.z semver this guard can compare`,
    };
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
 * De-duplication for the "cannot parse this installed version" warning
 * below, keyed on the exact `(peer, foundVersion)` pair. `assertPeerVersion`
 * runs at MODULE LOAD, so a consumer that imports `./web` more than once
 * would otherwise see the identical warning repeated — exactly how a real
 * warning stops being read (repeated identical noise gets filtered out).
 * Module-scoped and process-lifetime: this is a logging concern, not a
 * correctness one, so it is never cleared.
 */
const warnedUnparseableVersions = new Set<string>();

/**
 * Throws a named, actionable error naming the package, the declared range,
 * and the version actually found — for the two states that ARE actionable
 * violations. Never returns a boolean — a guard must state where control
 * goes when it declines. A missing peer and an out-of-range peer throw
 * genuinely DIFFERENT messages — "not installed" and "installed but
 * incompatible" are different problems with different fixes. An
 * unparseable DECLARED RANGE is a third, equally loud thrown error — that
 * range is this package's own source, not external input, so failing to
 * parse it is this package's own bug, never an assumed pass.
 *
 * An unparseable, or prerelease-carrying, INSTALLED version is different:
 * that string is supplied by whatever resolved the peer at runtime (a
 * bundler's SSR vendoring, a monorepo hoist, …), not by this package or
 * necessarily by the consumer either. This guard never throws for it — see
 * this file's header for why, and for the tradeoff that choice buys
 * (#389) — it calls `console.warn` exactly once per distinct
 * `(peer, foundVersion)` pair (see `warnedUnparseableVersions` above), with
 * the raw string and the reason, and returns normally.
 */
export function assertPeerVersion(input: AssertPeerVersionInput): void {
  const { peer, declaredRange, foundVersion } = input;

  if (foundVersion === undefined) {
    throw new Error(
      `${peer} is required for this import but is not installed. Install ${peer}@"${declaredRange}" — ` +
        `see this package's README for its optional-peer setup.`,
    );
  }

  const outcome = satisfiesRange(foundVersion, declaredRange);

  if (!outcome.evaluated && outcome.kind === "unparseable-version") {
    const warnKey = `${peer}@${foundVersion}`;
    if (!warnedUnparseableVersions.has(warnKey)) {
      warnedUnparseableVersions.add(warnKey);
      console.warn(
        `[@clossys/keeper] Could not verify ${peer}@${foundVersion} against this package's declared range ` +
          `"${declaredRange}": ${outcome.reason}. This is not a value that failed the check — it is a value ` +
          `assertPeerVersion could not read at all, so it is being treated as indeterminate rather than as a ` +
          `violation. Proceeding without blocking the build; if ${peer} is genuinely incompatible that will ` +
          `surface elsewhere.`,
      );
    }
    return;
  }

  if (!outcome.evaluated) {
    throw new Error(
      `Could not verify ${peer}@${foundVersion} against this package's declared range "${declaredRange}": ` +
        `${outcome.reason}. Refusing to assume this is compatible.`,
    );
  }

  if (!outcome.ok) {
    throw new Error(
      `${peer}@${foundVersion} is installed, but this package requires ${peer}@"${declaredRange}". ` +
        `Installed but incompatible — install a version of ${peer} that satisfies "${declaredRange}".`,
    );
  }
}
