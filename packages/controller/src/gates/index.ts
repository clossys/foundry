/**
 * Foundation orchestration and pure, consumer-supplied governance gates.
 *
 * Deliberately does NOT re-export `./secret-gates.js` (this PR; CI failure
 * on #419, closing the consequence of #411). That module's own top-level
 * `import ts from "typescript"` used to ride along with everything else in
 * this barrel, so importing this `./gates` subpath at all — for
 * `runFoundationCheck`, `createGateReasons`, anything — transitively
 * pulled in a full TypeScript compiler, even for a consumer who never
 * called a secret gate. `installed-bin.test.ts` caught the sharpest
 * consequence: once `typescript` became a required peer to make that
 * unconditional import honest, an offline install of the published
 * tarball failed outright, because npm had to resolve the peer and a
 * clean install has no cache. The secret gates now live at their own
 * subpath, `./gates/secrets` (see `secrets.ts`), which is the one place a
 * consumer opts into the compiler; `typescript` is an optional peer again.
 * `root-entry-boundary.test.ts` asserts this barrel's own import graph
 * never reaches `secret-gates.ts` or a bare `"typescript"` specifier,
 * mirroring the same guarantee it already held for the package root.
 */

export type { FoundationReport, BuildOrderResult, PolicyCheck, PolicyCheckResult } from "./types.js";
export type { RunFoundationCheckOptions } from "./foundation.js";

export { runFoundationCheck } from "./foundation.js";
export { computeBuildOrder } from "./build-order.js";
export { verifyPolicyBindings } from "./policy-checks.js";
export { FOUNDRY_CHECK_REASONS, foundationGateResult, main, run, severityCounts } from "./cli.js";
export type { FoundryCheckIndeterminateReason } from "./cli.js";
export { evaluateRatchet } from "./ratchet.js";
export type { RatchetFinding, RatchetIndeterminateReason, RatchetResult } from "./ratchet.js";
export { checkOverrideTargetRanges } from "./override-target-range.js";
export type { OverrideRangeFinding } from "./override-target-range.js";
export { checkDependencyScope } from "./dependency-scope.js";
export type {
  DependencyScopeAllowlistDocument,
  DependencyScopeAllowlistEntry,
  DependencyScopeFinding,
  DependencyScopeOptions,
} from "./dependency-scope.js";
export {
  COMMON_INDETERMINATE_REASONS,
  assertNeverVacuouslySatisfied,
  createGateReasons,
  foldGateResults,
  gateIndeterminate,
  gateResultFromRatchet,
  gateResultToExitCode,
  gateSatisfied,
  gateViolated,
  isIndeterminate,
  isSatisfied,
  isViolated,
} from "./result.js";
export type {
  CommonIndeterminateReason,
  GateReasonVocabulary,
  GateResult,
  GateVerdict,
  IndeterminateGateResult,
  SatisfiedGateResult,
  ViolatedGateResult,
} from "./result.js";
// Re-exported so a consumer of this package never needs a separate import
// from ../catalog/index.js or ../policy/index.js just to read the types
// these functions return.
export type { Catalog, CatalogEntry, CatalogFinding } from "../catalog/index.js";
export type { Finding, PolicyBinding } from "../policy/index.js";
