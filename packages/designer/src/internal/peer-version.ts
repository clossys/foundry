/**
 * `assertPeerVersion` — the runtime half of #182's "optional peer, no
 * install-time signal in either direction" problem, ported to this
 * package. `@internationalized/date`, `react`, `react-dom`,
 * `react-aria-components`, `tailwind-merge`, and `tailwindcss` are all
 * declared `peerDependenciesMeta: { optional: true }` (see package.json)
 * so a token-only consumer can install `@clossys/designer` and use
 * `@clossys/designer/tokens` or the CSS subpaths without installing any
 * component runtime at all. But an ABSENT or OUT-OF-RANGE peer produced no
 * signal of any kind until now: a consumer on an incompatible version
 * learned about it from whatever the component happened to crash on deep
 * inside the peer's own call surface, with nothing naming a version range
 * as the cause.
 *
 * WHERE THIS IS ACTUALLY WIRED IN, AND WHY IT ISN'T UNIFORM ACROSS ALL SIX
 * PEERS — see each guard call site's own doc comment for the reasoning
 * specific to that peer, but in short:
 *   - `react` reads its own exported `version` (a plain string, safe to
 *     import from anywhere) — guarded from every component subpath's own
 *     barrel: `atoms/index.ts`, `blocks/index.ts`, `shell/index.ts`,
 *     `charts/index.ts`, `theme/index.ts`.
 *   - `react-aria-components` has no such export, but DOES declare
 *     `"./package.json"` in its own `exports` map, so its version is read
 *     via a static JSON import instead — guarded from `atoms/index.ts`,
 *     `blocks/index.ts`, `shell/index.ts` (see those files).
 *   - `react-dom` and `@internationalized/date` are declared peers with NO
 *     adapter import site anywhere in this package's own source (confirmed
 *     by grepping `src/` — `react-dom` is the consumer's own render call,
 *     never this package's; `@internationalized/date` is named in
 *     `DateField.tsx`'s doc comment as something a CONSUMER constructing a
 *     `value` needs, but `DateField.tsx` itself never imports it — only
 *     its test file does, to build a fixture `DateValue`). There is
 *     nothing to guard for either — see `@example/surface`'s own
 *     `web/renderWebDocument.ts` for the identical `react-dom` case and its
 *     own doc comment explaining why "declared peer with no adapter import
 *     site" is a real, precedented category, not a gap.
 *   - `tailwind-merge` is imported from exactly one file,
 *     `atoms/internal/cx.ts` — but that file is transitively reachable
 *     from every single atom (`cx()` is this package's shared class-merge
 *     helper), and `tailwind-merge` has neither an exported version NOR a
 *     `"./package.json"` exports entry (confirmed: its own `exports` map
 *     lists only `"."` and `"./es5"`). There is no signal this guard could
 *     read there without importing `node:fs`/`node:module` — and doing
 *     that from `cx.ts` would break every consumer bundling any atom for
 *     the browser (verified empirically with esbuild's own
 *     `--platform=browser`: an unconditional top-level `node:fs` import
 *     fails the BUILD, not just the run, regardless of whether the
 *     importing binding is ever called — tree-shaking runs after module
 *     resolution, not before it). So `tailwind-merge`'s guard is NOT wired
 *     automatically; it ships as `assertTailwindMergeVersion` from
 *     `@clossys/designer/tokens` instead — an explicit, Node-only,
 *     opt-in call, same shape as `assertTokenStylesLoaded` (this
 *     package's OTHER #182 guard) but Node-only rather than SSR-safe,
 *     because "safe to run automatically, everywhere" genuinely isn't
 *     achievable for this one peer. See `tokens/assert-tailwind-merge-
 *     version.ts` for the guard itself and its own header for more.
 *   - `tailwindcss` is imported only from `compiled-css/generate.ts`, a
 *     repository-internal build tool with no public `exports` subpath of
 *     its own (never reachable by an external consumer, browser or
 *     otherwise) — guarded there directly with the Node-only resolver,
 *     the same as this package's sibling packages guard their own
 *     Node-only adapters.
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
 * this was ported from. This same algorithm is also ported, byte-for-byte
 * identical, into `packages/auth`, `packages/comms`, `packages/governance`,
 * `packages/surface`, and `packages/consent`'s own `internal/peer-
 * version.ts` files — keep all copies in sync by hand if it ever changes.
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
 * DELIBERATELY PURE — NO `node:*` IMPORTS IN THIS FILE. This file is
 * imported from every component subpath's own barrel (`atoms/index.ts`,
 * `blocks/index.ts`, `shell/index.ts`, `charts/index.ts`,
 * `theme/index.ts`) — all of them reachable from a browser bundle, not
 * just a Node process. The Node-only fs-based resolver
 * (`resolveInstalledPeerVersion`) lives in its own sibling file,
 * `resolve-installed-peer-version.ts`, imported only from genuinely
 * Node-context call sites (`tokens/assert-tailwind-merge-version.ts`,
 * `compiled-css/generate.ts`) — never from here, and never from any file
 * this one is imported by.
 *
 * THE THREE STATES, MIRRORED LOCALLY, NOT IMPORTED — AND THE FAILURE
 * DIRECTION DELIBERATELY INVERTED (#389). A peer version this guard cannot
 * parse — including one carrying a prerelease identifier, e.g. Turbopack
 * vendoring its own canary React build during SSR instead of the
 * consumer's real, installed `react` — is not a value that FAILED this
 * check. It is a value the checker could not form an opinion about at
 * all: `indeterminate`, never silently folded into a pass and never
 * thrown as though it were a real, actionable violation.
 * `@clossys/controller`'s `gates/result.ts` already names this
 * exact three-state shape (`satisfied` | `violated` | `indeterminate`),
 * and this file does not import it — DO NOT "FIX" THAT BY IMPORTING IT.
 * This is a copy that MUST stay a copy, for TWO independent reasons, and
 * both are recorded here because a reader who knows only one will "fix"
 * the other:
 *
 *   1. This package sits at or below `@clossys/controller` in
 *      this repository's build order (see this package's own
 *      `package.json`, which declares no dependency on it), so importing
 *      controller's type from here would invert that graph.
 *   2. `@clossys/controller` cannot import this type out of its
 *      own `gates/result.ts` and re-export it for everyone else to share,
 *      either: `controller`'s own `gates/secret-gates.ts` already imports
 *      `internal/peer-version.js` (its OWN local mirror of this exact
 *      file), so having `internal/peer-version.ts` import `gates/result.js`
 *      would create an import cycle inside `controller`'s own `gates/`
 *      directory. There is no side of this graph a shared import could
 *      live on without either inverting build order or creating a cycle.
 *
 * PROHIBITION, not just explanation: this same ternary is mirrored,
 * byte-for-byte identical modulo the warning-prefix package name, across
 * `packages/auth`, `packages/comms`, `packages/consent`, `packages/controller`,
 * `packages/surface`, `packages/ui`, and this package's own
 * `internal/peer-version.ts`. An agent that notices five-or-more identical
 * copies and reaches for "consolidate these into one shared import" is
 * about to reintroduce exactly the graph problem above — that refactor is
 * a REGRESSION, not cleanup, and must not be made. If the ported range
 * algorithm ever needs to change, change it by hand in every copy; do not
 * collapse the copies to make that easier.
 * `assertPeerVersion` below therefore reimplements the same three states
 * as its own local control flow — but do NOT read this as parity with
 * `gates/result.ts`'s CONTRACT, only its VOCABULARY: that module defines
 * `indeterminate` as failing CLOSED ("could not evaluate ... fails CLOSED
 * ... never silently promoted to satisfied"), because its callers are CI
 * gates whose job is to refuse to certify what they could not check. This
 * file's `indeterminate` deliberately fails OPEN instead: parses and
 * satisfies the range (proceed, silently), parses and violates it (throw —
 * a real, actionable violation, unchanged), or cannot be parsed at all
 * (warn — see below — and PROCEED, never thrown). That inversion is
 * intentional, not a drift from the fleet contract: a CI gate that cannot
 * evaluate should refuse to certify, but a runtime import guard that
 * cannot evaluate must not crash a consumer's build over a string it
 * merely failed to read — doing exactly that, unconditionally, is #389
 * itself, and this package's own guard sits at FOURTEEN separate
 * module-load call sites, so the crash was reachable from every one of
 * them. The tradeoff this buys is real and is named here rather than left
 * implicit: a peer that is GENUINELY incompatible, but whose version
 * string this guard cannot parse, now proceeds silently instead of failing
 * loudly — this guard cannot tell "cannot parse, but actually fine" apart
 * from "cannot parse, and actually broken." If that peer is really
 * incompatible, this guard no longer catches it; whatever it is actually
 * incompatible WITH is expected to surface the failure instead (see the
 * warning text below, which says so). An unparseable DECLARED RANGE stays
 * on the OLD, fail-loud path — that range is this package's own source,
 * not external input, so failing to parse it is this package's own bug,
 * never an assumed pass.
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
 * unbounded `>=x[.y[.z]]` range — the shape this package's own
 * `peerDependencies` uses for `react`/`react-dom` (`">=18"`). A version
 * segment omitted from either side defaults to its lowest value (`18`
 * reads as `18.0.0`), matching ordinary semver range convention. Returns
 * `null` — unparseable — for anything else.
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
 * runs at MODULE LOAD, and this package calls it from FOURTEEN separate
 * top-level call sites across its component subpaths — a consumer that
 * imports several of this package's subpaths would otherwise see the
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
        `[@clossys/designer] Could not verify ${peer}@${foundVersion} against this package's declared range ` +
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
