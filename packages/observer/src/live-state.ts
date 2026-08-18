/**
 * The `liveStateSurface` shape from issue #255: declared intent and live
 * state are one contract, not a detail rewritten per subsystem. The
 * canonical home for this shape is `@vespeneventures/controller/
 * conventions` (`conventions/live-state.ts` there) — it owns every rule
 * this repository's tiers share and has no dependency of its own, so
 * `builder` re-exports controller's copy rather than keeping one, and any
 * new subject adopting this contract should reuse controller's copy too.
 *
 * `observer` is the deliberate exception, and says so here rather than
 * leaving a reader to notice the duplication and wonder why it wasn't
 * cleaned up: this package's own contract is zero runtime dependencies
 * (see README.md's Requirements section) — no dependency on
 * `@vespeneventures/controller`, or on anything else, so that a caller
 * measuring gate efficacy or handling telemetry never inherits a governance
 * package's own dependency surface just to do it. Adding controller as a
 * dependency to remove five frozen strings and one small interface would
 * spend that property to dedupe less code than the honest explanation of
 * why it's duplicated takes to write. So this file keeps its own copy,
 * on purpose, kept in sync by hand: `LiveStateSurface`'s fields,
 * `liveStateFindingKinds`, and `validateLiveStateSurface`'s checks below
 * must read identically to controller's `LiveStateSurfaceDeclaration`,
 * `LIVE_STATE_SURFACE_FINDING_KINDS`, and `validateLiveStateSurfaceDeclaration`
 * — a future change to either canonical shape should be mirrored here in
 * the same pull request, and this comment is what a reviewer checks that
 * against.
 *
 * Every field name here matches controller's shape, and issue #255's
 * original proposal, exactly:
 *
 *   - `store`             — where the live state actually lives, in prose.
 *   - `readableByScript`  — an explicit boolean, never implicit. Required,
 *                           not defaulted: choosing `false` on a caller's
 *                           behalf would be this package deciding something
 *                           about infrastructure it cannot see.
 *   - `readableBy`        — the named surface or command that reads it, when
 *                           `readableByScript` is true.
 *   - `reconciledBy`      — what performs the reconciliation instead, when a
 *                           script cannot read the surface itself.
 *   - `note`              — REQUIRED. States plainly that a green offline
 *                           check is not evidence the work is live. Left
 *                           non-optional in the type so a declaration cannot
 *                           be written without it.
 */
export interface LiveStateSurface {
  readonly store: string;
  readonly readableByScript: boolean;
  readonly readableBy?: string;
  readonly reconciledBy?: string;
  readonly note: string;
}

/**
 * The finding-kind vocabulary issue #255 generalizes from the schedule and
 * routine tiers, reused here rather than re-derived. `declared-but-not-
 * verifiable` is the addition that matters most: both tiers issue #255
 * cites assumed the probe could run at all, and a live-state surface this
 * package is handed may not be probable with the credential the caller
 * holds. That is a declared gap with a named blocker, never a silent pass.
 *
 * This package does not itself decide which finding kind applies to a given
 * surface — that requires the live probe, which is exactly what `observer`
 * does not perform on its own (see `gate-efficacy.ts`'s header). The
 * vocabulary is exported as data, for a caller's own reconciliation surface
 * to report against, the same way `@vespeneventures/controller/conventions`
 * exports `reconciliationFindingKinds` and `scheduleReconciliationFindingKinds`
 * rather than implementing the probes itself.
 */
export const liveStateFindingKinds = Object.freeze([
  "declared-but-not-live",
  "live-but-not-declared",
  "live-differs-from-declared",
  "live-artifact-predates-its-declaration",
  "declared-but-not-verifiable",
] as const);

export type LiveStateFindingKind = (typeof liveStateFindingKinds)[number];

/**
 * Validates a `LiveStateSurface` declaration's own internal consistency —
 * offline, structural, and the only kind of check this package can perform
 * on a declaration. It never asks whether the declared store is real; that
 * is exactly the live half issue #255 says a script frequently cannot read.
 */
export function validateLiveStateSurface(surface: LiveStateSurface): readonly string[] {
  const problems: string[] = [];

  if (typeof surface.store !== "string" || surface.store.trim() === "") {
    problems.push("store must be a non-empty description of where the live state actually lives.");
  }

  if (typeof surface.readableByScript !== "boolean") {
    problems.push(
      "readableByScript must be an explicit boolean. Leaving it implicit is exactly the gap issue #255 closes.",
    );
  } else if (surface.readableByScript) {
    if (surface.readableBy === undefined || surface.readableBy.trim() === "") {
      problems.push("readableByScript is true, so readableBy must name the surface or command that reads it.");
    }
  } else if (surface.reconciledBy === undefined || surface.reconciledBy.trim() === "") {
    problems.push(
      "readableByScript is false, so reconciledBy must name what performs the reconciliation instead.",
    );
  }

  if (typeof surface.note !== "string" || surface.note.trim() === "") {
    problems.push(
      "note is required and must state that a green offline check is not evidence the work is live.",
    );
  }

  return problems;
}

/**
 * `observer`'s own declaration of where its telemetry log actually lives.
 *
 * This package defines the event shape, the retention window, and the
 * redaction rule — it does not ship a log store. Where events produced
 * against this contract are actually persisted is the consuming plane's own
 * declared infrastructure, named in that plane's own `liveStateSurface`.
 * Shipping this package's own honest, currently-unowned declaration — rather
 * than omitting one, or inventing a store that does not exist — is the
 * point: an absent declaration reads as an oversight, and a fabricated one
 * would be exactly the kind of green check issue #255 warns against.
 */
export const OBSERVER_TELEMETRY_LOG_SURFACE: LiveStateSurface = {
  store:
    "Caller-owned. This package has no telemetry backend of its own — no file, no table, no bucket, no " +
    "third-party sink. A consuming plane persists events built to this contract wherever its own " +
    "infrastructure lives, and declares that location in its own liveStateSurface.",
  readableByScript: false,
  reconciledBy:
    "The consuming plane's own reconciliation surface, declared alongside its own liveStateSurface for its " +
    "actual telemetry store.",
  note:
    "A green run of this package's own test suite proves the contract holds: the event shape validates, the " +
    "retention window arithmetic is correct, and redaction cannot be defeated by any serialization this " +
    "package ships. It is not evidence that any telemetry store exists, is reachable, or is being written to " +
    "by anything — that is a fact about live infrastructure this package cannot see and does not claim to.",
};
