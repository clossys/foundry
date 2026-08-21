/**
 * `assertPeerVersion` — the runtime half of #182's "optional peer, no
 * install-time signal in either direction" problem. `react` (and
 * `react-dom`) are declared `peerDependenciesMeta: { optional: true }`
 * (see package.json) so a consumer can install this package and use
 * `./core`, `./media`, `./email`, `./print`, `./image`, or `./slides`
 * without ever installing React — only `./web` needs it. But an ABSENT
 * or OUT-OF-RANGE `react` produced no signal of any kind until now: a
 * consumer on an incompatible React version learned about it from
 * whatever `renderWebDocument.ts` happened to crash on deep inside
 * `react`'s own `createElement`, with nothing naming a version range as
 * the cause. See `web/renderWebDocument.ts`'s own guard call for where
 * this is wired in.
 *
 * DELIBERATELY PURE — NO `node:*` IMPORTS IN THIS FILE. `renderWebDocument.
 * ts` is reachable from a browser bundle as easily as from a server one
 * (its own doc comment: "Render this with your own React tree ... however
 * your app already does"), so it reads `react`'s own exported `version`
 * directly instead of a filesystem check, and imports only this file —
 * never `resolve-installed-peer-version.ts`'s Node-only
 * `node:module`/`node:fs`-based resolver, which cannot resolve those
 * built-ins in a browser bundle at all, even as an unused named export in
 * the same shared module. See that file's own header for the split's
 * other half.
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
 * package's own declared peer ranges (`"react": ">=18"`, `"react-dom":
 * ">=18"`) are exactly the unbounded `>=x` shape `check-workspace-
 * links.mjs`'s own header explicitly puts OUT of its scope ("`>=`/`<`
 * comparators ... is UNPARSEABLE" — correct for ITS job of validating
 * this repository's own narrow, internal 0.x sibling ranges; wrong for
 * the third-party peer ranges this guard must actually understand).
 * `parseGteForm` is new code, not a port, and is exercised directly by
 * this file's own tests.
 *
 * THE THREE STATES, MIRRORED LOCALLY, NOT IMPORTED — AND THE FAILURE
 * DIRECTION DELIBERATELY INVERTED (#389). A peer version this guard cannot
 * parse — including one carrying a prerelease identifier, e.g. Turbopack
 * vendoring its own canary React build during SSR instead of the
 * consumer's real, installed `react` — is not a value that FAILED this
 * check. It is a value the checker could not form an opinion about at
 * all: `indeterminate`, never silently folded into a pass and never
 * thrown as though it were a real, actionable violation.
 * `@vespeneventures/controller`'s `gates/result.ts` already names this
 * exact three-state shape (`satisfied` | `violated` | `indeterminate`),
 * and this file does not import it: this package sits at or below
 * `@vespeneventures/controller` in this repository's build order (see
 * this package's own `package.json` — its `dependencies` name
 * `@vespeneventures/copy` and `@vespeneventures/ui`, never
 * `@vespeneventures/controller`), so importing controller's type from
 * here would invert that graph — an architectural decision for an owner,
 * not a bug-fix detail. `assertPeerVersion` below therefore reimplements
 * the same three states as its own local control flow — but do NOT read
 * this as parity with `gates/result.ts`'s CONTRACT, only its VOCABULARY:
 * that module defines `indeterminate` as failing CLOSED ("could not
 * evaluate ... fails CLOSED ... never silently promoted to satisfied"),
 * because its callers are CI gates whose job is to refuse to certify what
 * they could not check. This file's `indeterminate` deliberately fails
 * OPEN instead: parses and satisfies the range (proceed, silently), parses
 * and violates it (throw — a real, actionable violation, unchanged), or
 * cannot be parsed at all (warn — see below — and PROCEED, never thrown).
 * That inversion is intentional, not a drift from the fleet contract: a CI
 * gate that cannot evaluate should refuse to certify, but a runtime import
 * guard that cannot evaluate must not crash a consumer's build over a
 * string it merely failed to read — doing exactly that, unconditionally,
 * is #389 itself. The tradeoff this buys is real and is named here rather
 * than left implicit: a peer that is GENUINELY incompatible, but whose
 * version string this guard cannot parse, now proceeds silently instead of
 * failing loudly — this guard cannot tell "cannot parse, but actually
 * fine" apart from "cannot parse, and actually broken." If that peer is
 * really incompatible, this guard no longer catches it; whatever it is
 * actually incompatible WITH is expected to surface the failure instead
 * (see the warning text below, which says so). An unparseable DECLARED
 * RANGE stays on the OLD, fail-loud path — that range is this package's
 * own source, not external input, so failing to parse it is this
 * package's own bug, never an assumed pass.
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
   * build metadata, or anything else that is not a plain `x.y.z`. This is
   * `indeterminate`, not `violated`: see this file's header and
   * `assertPeerVersion`.
   */
  | { evaluated: false; kind: "unparseable-version"; reason: string };

/** True when `versionStr` looks like `x.y.z-<prerelease>`, for a more specific warning. */
function looksLikePrereleaseVersion(versionStr: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(String(versionStr).trim());
}

/**
 * Returns `{ evaluated: false, kind, reason }` when either side could not
 * be parsed — a finding, never assumed satisfied, the same discipline
 * `scripts/check-workspace-links.mjs`'s own `satisfies()` uses — or
 * `{ evaluated: true, ok }` once both sides parsed cleanly. `kind`
 * distinguishes an unparseable RANGE (this package's own bug — `assertPeerVersion`
 * still throws) from an unparseable installed VERSION (an external input
 * this guard could not read — `assertPeerVersion` warns and proceeds; see
 * this file's header).
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
 * runs at MODULE LOAD, and this package calls it from more than one
 * top-level call site (`web/renderWebDocument.ts`, `document/render.ts`)
 * — a consumer that imports both subpaths would otherwise see the
 * identical warning once per import, which is exactly how a real warning
 * stops being read (repeated identical noise gets filtered out).
 * Module-scoped and process-lifetime: this is a logging concern, not a
 * correctness one, so it is never cleared.
 */
const warnedUnparseableVersions = new Set<string>();

/**
 * Throws a named, actionable error naming the package, the declared
 * range, and the version actually found — for the two states that ARE
 * actionable violations. Never returns a boolean — a guard must state
 * where control goes when it declines, and a boolean return is trivially
 * ignored by a caller who forgets to check it. A missing peer and an
 * out-of-range peer throw genuinely DIFFERENT messages — "not installed"
 * and "installed but incompatible" are different problems with different
 * fixes. An unparseable DECLARED RANGE is a third, equally loud thrown
 * error — that range is this package's own source, not external input, so
 * failing to parse it is this package's own bug, never an assumed pass.
 *
 * An unparseable, or prerelease-carrying, INSTALLED version is different:
 * that string is supplied by whatever resolved the peer at runtime (a
 * bundler's SSR vendoring, a monorepo hoist, …), not by this package or
 * necessarily by the consumer either. This guard never throws for it —
 * see this file's header for why, and for the tradeoff that choice buys
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
        `[@vespeneventures/surface] Could not verify ${peer}@${foundVersion} against this package's declared ` +
          `range "${declaredRange}": ${outcome.reason}. This is not a value that failed the check — it is a value ` +
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
