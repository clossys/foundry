/**
 * `assertPeerVersion` — the runtime half of #182's "optional peer, no
 * install-time signal in either direction" problem. `@clerk/nextjs`,
 * `next`, `react`, `react-dom`, and `svix` are all declared
 * `peerDependenciesMeta: { optional: true }` (see package.json) so a
 * consumer can install this package and use `./agent` (the
 * delegated-agent authorization primitives) without ever installing
 * Clerk, Next.js, React, or Svix — only `./providers/clerk` and its `web`
 * subpaths need them. But an ABSENT or OUT-OF-RANGE peer produced no
 * signal of any kind until now: a consumer on an incompatible version
 * learned about it from whatever the adapter happened to crash on deep
 * inside the peer's own call surface, with nothing naming a version range
 * as the cause. See `providers/clerk/verify.ts` (guards `svix`),
 * `providers/clerk/web/client.tsx` (guards `react`, via React's own
 * exported `version`), and `providers/clerk/web/server-routes.tsx`
 * (guards `@clerk/nextjs` and `next`) for where this is actually wired
 * in. `react-dom` has no import site in this package at all.
 *
 * DELIBERATELY PURE — NO `node:*` IMPORTS IN THIS FILE. `client.tsx` is a
 * `"use client"` module, reachable from a browser bundle, and imports
 * only this file, never `resolve-installed-peer-version.ts`'s Node-only
 * `node:module`/`node:fs`-based resolver (used by `verify.ts` and
 * `server-routes.tsx`, both unambiguously Node-context). An ES module's
 * top-level imports are all eagerly evaluated together — a browser bundle
 * cannot resolve `node:module`/`node:fs` at all, so keeping this file
 * free of them, even as an unused named export elsewhere in a shared
 * module, is a real correctness requirement for `client.tsx`, not
 * cosmetic organization. See `resolve-installed-peer-version.ts`'s own
 * header for the split's other half.
 *
 * REUSE, NOT SILENT DUPLICATION OF THE HARD PART. The exact-pin/`^`/`~`
 * range algorithm below (`parseVersion`/`parsePinCaretTilde`/
 * `compareVersions`) is a direct port of the same functions in
 * `scripts/check-workspace-links.mjs` at the repository root — same
 * regexes, same 0.x-both-`^`-and-`~`-are-minor-locked rule, same
 * "unparseable is a finding, never an assumed pass" discipline. It is a
 * PORT rather than an `import` of that script for one structural reason:
 * `scripts/` is never part of any package's `files` allowlist in
 * package.json, so it is not present once a package is installed from the
 * registry — a published `dist/internal/peer-version.js` that imported it
 * would resolve nothing for a real consumer, and adding a dependency on a
 * path outside this package's own publishable boundary is not a
 * dependency this repository's "no new dependencies" rule would let
 * through even if the reference resolved. Keep both in sync by hand if
 * the ported range algorithm ever changes; `scripts/
 * check-workspace-links.test.mjs`'s own 0.x cases are the source of truth
 * this was ported from.
 *
 * ONE GENUINE EXTENSION BEYOND WHAT WAS PORTED: `parseGteForm` below. This
 * package's own declared peer ranges for `@clerk/nextjs`, `next`, `react`,
 * and `react-dom` (`">=7 <8"`, `">=16 <17"`, `">=19 <20"`, `">=19 <20"`)
 * are exactly the bounded `>=x <y` shape `check-workspace-links.mjs`'s own
 * header explicitly puts OUT of its scope ("`>=`/`<` comparators ... is
 * UNPARSEABLE" — correct for ITS job of validating this repository's own
 * narrow, internal 0.x sibling ranges; wrong for the third-party peer
 * ranges this guard must actually understand). `parseGteForm` is new
 * code, not a port, and is exercised directly by this file's own tests.
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
 * Ported verbatim from scripts/check-workspace-links.mjs's
 * parseRange()/rangeBounds(): an exact pin, a caret range, or a tilde
 * range against a plain x.y.z. For `0.y.z`, BOTH `^` and `~` are
 * minor-locked; above `0.y.z`, `^` is major-locked and only `~` is
 * minor-locked. Returns `null` — unparseable — for anything else,
 * including the `>=`/`<` forms `parseGteForm` below understands instead.
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
 * NEW, not ported: a bounded `>=x[.y[.z]] <a[.b[.c]]>` range or an
 * unbounded `>=x[.y[.z]]` range — the shapes this repository's own
 * `peerDependencies` actually use for third-party peers (see this file's
 * header). A version segment omitted from either side defaults to its
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
 * parsed — a finding, never assumed satisfied, the same discipline
 * `scripts/check-workspace-links.mjs`'s own `satisfies()` uses — or
 * `{ evaluated: true, ok }` once both sides parsed cleanly.
 */
function satisfiesRange(versionStr: string, rangeStr: string): RangeSatisfaction {
  const bound = parsePinCaretTilde(rangeStr) ?? parseGteForm(rangeStr);
  if (!bound) {
    return {
      evaluated: false,
      reason:
        `"${rangeStr}" is not a range form this guard parses (an exact pin, ^x.y.z, ~x.y.z, ` +
        `">=x.y.z <a.b.c>", or ">=x.y.z" are supported)`,
    };
  }
  const version = parseVersion(versionStr);
  if (!version) {
    return {
      evaluated: false,
      reason: `the installed version "${versionStr}" is not a plain x.y.z semver this guard can compare`,
    };
  }
  const geLower = compareVersions(version, bound.lower) >= 0;
  const ltUpper = bound.upper === null ? true : compareVersions(version, bound.upper) < 0;
  return { evaluated: true, ok: geLower && ltUpper };
}

// ------------------------------------------------------------------ the guard

export interface AssertPeerVersionInput {
  /** The optional peer's package name, e.g. `"svix"`. */
  peer: string;
  /** This package's own `peerDependencies` range for `peer`. */
  declaredRange: string;
  /** The peer's real installed version, or `undefined` if it could not be resolved at all. */
  foundVersion: string | undefined;
}

/**
 * Throws a named, actionable error naming the package, the declared
 * range, and the version actually found. Never returns a boolean — a
 * guard must state where control goes when it declines, and a boolean
 * return is trivially ignored by a caller who forgets to check it. A
 * missing peer and an out-of-range peer throw genuinely DIFFERENT
 * messages — "not installed" and "installed but incompatible" are
 * different problems with different fixes. An unparseable declared range
 * or installed version is a third, equally loud error, never an assumed
 * pass.
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
