/**
 * `liveStateSurface` (#255): a runtime pin, a machine manifest, and a
 * deployment target are the same statement at three altitudes — *this is
 * what should exist; go and see whether it does.*
 *
 * The generic shape now lives in `@vespeneventures/controller/conventions`
 * (`conventions/live-state.ts` there), which this package already depends
 * on for `GateResult` (`@vespeneventures/controller/gates`) and already sits
 * above in the build order. This module used to carry its own full copy of
 * the vocabulary, the declaration type, its validator, and the three-state
 * constructors; it now re-exports controller's copy verbatim rather than
 * maintaining a second one, which removed a real duplicate at no
 * architectural cost — no new dependency edge was needed, since builder
 * already required controller.
 *
 * Every export below keeps its existing name. A consumer already importing
 * from `@vespeneventures/builder` sees no change: `LIVE_STATE_SURFACE_
 * FINDING_KINDS`, `LiveStateSurfaceDeclaration`, `validateLiveStateSurface
 * Declaration`, `reconcileLiveState`, and the three constructors
 * (`liveStateVerified` / `liveStateDrifted` / `liveStateCouldNotVerify`) are
 * the same functions and the same types as before — this file just no longer
 * defines them itself. See controller's `./live-state.ts` for the full
 * implementation, its module header for why `declared-but-not-verifiable`
 * is not a boolean, and controller's own shipped `live-state-reconciliation.md`
 * for the shared document this shape now has one canonical home in.
 *
 * `./toolchain.ts` (`reconcileToolchain`) and `./ci` (the shared CI-gate
 * mechanics from #257) both build on the re-exports here exactly as they
 * built on the original local definitions — nothing about their own code
 * changes.
 */

export {
  LIVE_STATE_SURFACE_FINDING_KINDS,
  liveStateCouldNotVerify,
  liveStateDrifted,
  liveStateReconciliationReasons,
  liveStateVerified,
  reconcileLiveState,
  validateLiveStateSurfaceDeclaration,
} from "@vespeneventures/controller/conventions";
export type {
  LiveStateDeclarationValue,
  LiveStateDriftKind,
  LiveStateFinding,
  LiveStateObservation,
  LiveStateReconciliationReason,
  LiveStateReconciliationResult,
  LiveStateSubjectReport,
  LiveStateSurfaceDeclaration,
  LiveStateSurfaceFindingKind,
  ReconcileLiveStateInput,
} from "@vespeneventures/controller/conventions";
