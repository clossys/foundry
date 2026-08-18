/**
 * @vespeneventures/builder
 *
 * Declared reality made actual: a runtime pin, a machine manifest, and a
 * deployment target are the same statement at three altitudes — *this is
 * what should exist; go and see whether it does.* This root entrypoint holds
 * three things:
 *
 *   - the manifest engine (from the former `@vespeneventures/provisioning`):
 *     an idempotent engine for applying a provisioning manifest to a
 *     machine, and for checking afterwards whether the machine still agrees
 *     with it. Planning is pure; verification reads the machine rather than
 *     the manifest, because a manifest always says the installation is
 *     correct — that is what a manifest is.
 *   - `toolchain`: the runtime pin, the package-manager pin, and the build
 *     order, expressed and reconciled the same way.
 *   - `liveStateSurface`: the shared contract every subject above (and the
 *     deployment surfaces under the `./deployment` subpath) reconciles
 *     through — a declaration, a live state, a reconciliation surface, and
 *     the named vocabulary for what can be found wrong, including the state
 *     neither of this package's two prior tiers named on its own:
 *     `declared-but-not-verifiable`.
 *
 * The deployment surface contract, configuration planning, and read-only
 * platform adapters (from the former `@vespeneventures/deployment`) are a
 * separate subpath, `./deployment`, preserving that package's own export
 * shape rather than flattening it in here — see that subpath's own header.
 *
 * The shared CI gate mechanics from #257 — the exit-code ternary, the
 * staleness floor, and the concrete toolchain gate built on both — live
 * under `./ci`, a third subpath, because they are machinery a consumer's own
 * thin workflow imports, not vocabulary this root entrypoint needs to carry
 * for every consumer that only wants to plan or verify.
 */

export type {
  ApplyOptions,
  ApplyResult,
  CopyEntry,
  FileStats,
  FileSystemPort,
  Finding,
  LinkEntry,
  ManagedBlockEntry,
  Manifest,
  OperationKind,
  Plan,
  PlanOperation,
  PrivateDirectoryEntry,
  RuntimeContext,
  Severity,
} from "./types.js";

export { loadManifest } from "./manifest.js";

export { createRuntimeContext, expandTokens, planInstallation } from "./runtime.js";
export type { RuntimeOptions } from "./runtime.js";

export {
  composeManagedBlock,
  hasExactlyOneBlock,
  renderManagedBlock,
  withoutManagedBlock,
} from "./blocks.js";

export { PRIVATE_DIRECTORY_MODE, applyInstallation } from "./apply.js";
export { verifyInstallation } from "./verify.js";

export { createNodeFileSystem } from "./node-fs.js";

// -- liveStateSurface (#255) -------------------------------------------------

export {
  LIVE_STATE_SURFACE_FINDING_KINDS,
  liveStateCouldNotVerify,
  liveStateDrifted,
  liveStateReconciliationReasons,
  liveStateVerified,
  reconcileLiveState,
  validateLiveStateSurfaceDeclaration,
} from "./live-state.js";
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
} from "./live-state.js";

// -- toolchain ----------------------------------------------------------------

export {
  reconcileToolchain,
  validateBuildOrderPin,
  validatePackageManagerPin,
  validateRuntimePin,
  validateToolchainDeclaration,
} from "./toolchain.js";
export type {
  BuildOrderPin,
  PackageManagerPin,
  RuntimePin,
  ToolchainDeclaration,
  ToolchainObservation,
} from "./toolchain.js";
