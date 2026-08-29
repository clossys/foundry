/**
 * @clossys/bouncer — everything about who you are, what you can do,
 * and how that changes over time.
 *
 * The question this role answers, and no other role does: **is this actor who
 * they claim, and is what they are doing still inside what they were
 * granted?**
 *
 * THE CLOSED LOOP
 * ----------------
 * Declared authority is the setpoint. A grant or a denial is the act.
 * Reconciliation against every provider of record is the observation. Drift
 * between them is the comparison. Revoking or re-asserting is the correction.
 * A package that only answers "may they?" at runtime, without ever
 * reconciling, is half a loop — and the missing half is the half that
 * notices.
 *
 * WHAT SHIPS HERE
 * ----------------
 *   1. THE PRIMITIVES. A closed, consumer-declared role hierarchy
 *      (`roles.ts`), a framework-neutral session and a fail-closed
 *      authorization predicate (`session.ts`), a host-supplied query seam
 *      (`query.ts`), external-membership reconciliation against a provider of
 *      record (`membership.ts`), and a strict redirect allowlist
 *      (`redirect.ts`).
 *
 *   2. THE SCHEMA (`schema.ts`). Hand-rolled, dependency-free validators over
 *      the record families the gates read: `Grant` (authority live here),
 *      `ProviderAssertion` (what a provider of record still backs, and
 *      whether it answered at all), `DelegatedActor` (a machine actor and its
 *      spend ceiling), and `AdapterMapping`/`ProviderShape` (what an adapter
 *      reads against what the provider declares it sends).
 *
 *   3. THE RUNTIME VERDICT (`contract.ts`). `evaluateGrant` returns
 *      `authorized` / `denied` / `unverifiable` — a ternary, because "the
 *      provider did not answer" is neither of the other two, and folding it
 *      into either one turns a provider outage into a mass revocation or a
 *      silent blanket grant.
 *
 *   4. THE GATES. Three checkers, all reachable from the single
 *      `bouncer-check` bin: `checkAuthorityReconciliation`,
 *      `checkDelegationCeiling`, and `checkProviderContract`. Each is a pure
 *      function returning a three-state result, and `cli.ts` folds those onto
 *      the `0`/`1`/`2` exit contract without ever collapsing "could not run"
 *      into either "clean" or "findings".
 *
 * THE METRIC: unreconciled grant surface — authority live here that no
 * provider still backs. `checkAuthorityReconciliation` counts it.
 *
 * PROVIDER-NEUTRAL, AND THAT IS STRUCTURAL
 * -----------------------------------------
 * Nothing reachable from this entry point imports a vendor SDK, a framework,
 * or React. `./agent` is delegated machine-actor authority and is equally
 * neutral. Every provider adapter lives behind `./providers/<name>` and its
 * own subpaths, each guarded by `assertPeerVersion` at import time so an
 * absent or out-of-range optional peer names itself rather than surfacing as
 * a crash deep inside somebody else's call surface.
 *
 * ONE-WAY, FOR PUBLIC CONSUMPTION
 * --------------------------------
 * No values, roles, tiers, ceilings, currencies, providers or policies of
 * this workspace's own appear anywhere in this package. The consumer authors
 * every declaration. Actor and subject stay separate identifiers in every
 * signature, so an actor acting on their own account and an actor acting on
 * somebody else's are never the same record. Storage and audit are
 * host-supplied ports; this package writes nothing. Ships the schema and the
 * checkers; every consumer authors its own values.
 */

export {
  isQueryAdapter,
  isTransactionalQueryAdapter,
  requireTransactionalQueryAdapter,
} from "./query.js";
export type { QueryAdapter, TransactionalQueryAdapter, WithTransactionQueryAdapter } from "./query.js";

export {
  defineRoleHierarchy,
  getRoleRank,
  hasRoleAtLeast,
  isKnownRole,
  resolveViewerRole,
  viewerHasAccess,
} from "./roles.js";
export type { RoleHierarchy, Viewer } from "./roles.js";

export { isAuthorized } from "./session.js";
export type { AuthorizationPredicate, Session, SessionResolver } from "./session.js";

export { reconcileExternalMembership } from "./membership.js";
export type {
  ExternalMembership,
  ExternalMembershipCreateInput,
  ExternalMembershipEvent,
  ExternalMembershipEventClaim,
  ExternalMembershipEventCursor,
  ExternalMembershipIdentity,
  ExternalMembershipReconciliationResult,
  ExternalMembershipRepository,
  ReconcileExternalMembershipCommand,
} from "./membership.js";

export {
  createAllowedOriginPolicy,
  isAllowedOrigin,
  resolveSafeRedirect,
} from "./redirect.js";
export type { AllowedOriginPolicy } from "./redirect.js";

export {
  BACKED_AUTHORITY_STATUSES,
  FIELD_PRESENCES,
  PROVIDER_REACHABILITIES,
  isDelegatedActor,
  isGrant,
  isProviderAssertion,
  validateAdapterMapping,
  validateAdapterMappings,
  validateDelegatedActor,
  validateDelegatedActors,
  validateGrant,
  validateGrants,
  validateProviderAssertion,
  validateProviderAssertions,
  validateProviderShape,
  validateProviderShapes,
} from "./schema.js";
export type {
  AdapterMapping,
  BackedAuthority,
  BackedAuthorityStatus,
  DeclaredField,
  DelegatedActor,
  FieldPresence,
  Grant,
  MappedField,
  ProviderAssertion,
  ProviderReachability,
  ProviderShape,
} from "./schema.js";

export {
  checkAuthorityReconciliation,
  checkDelegationCeiling,
  checkProviderContract,
  evaluateGrant,
} from "./contract.js";
export type {
  AuthorityDecision,
  AuthorityDenialReason,
  AuthorityReconciliationResult,
  AuthorityUnverifiableReason,
  DelegationCeilingResult,
  DelegationFailureReason,
  DelegationFinding,
  DelegationFindingKind,
  ProviderContractFailureReason,
  ProviderContractFinding,
  ProviderContractFindingKind,
  ProviderContractResult,
  ReconciliationFailureReason,
  ReconciliationFinding,
  ReconciliationFindingKind,
} from "./contract.js";

export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
