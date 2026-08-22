/**
 * Compile-time-only assertions about this package's public surface. Named
 * `.check.ts` rather than `.test.ts` on purpose: a `@ts-expect-error` or a
 * type-level assertion written inside a test file asserts nothing, because
 * this package's tsconfig excludes test files from the real `tsc` run and
 * vitest only transpiles them — so the directive can never fail, and, the
 * more dangerous half, never produces the "unused directive" error that
 * would signal the guarded contract has changed underneath it.
 *
 * Nothing imports this file at runtime; it has no runtime footprint at all.
 */
import type {
  AuthorityDecision,
  AuthorityReconciliationResult,
  DelegatedActor,
  DelegationCeilingResult,
  Grant,
  ProviderAssertion,
  ProviderContractResult,
  ExternalMembership,
  ExternalMembershipEvent,
  ExternalMembershipEventClaim,
  ExternalMembershipReconciliationResult,
  ExternalMembershipRepository,
  QueryAdapter,
  ReconcileExternalMembershipCommand,
  TransactionalQueryAdapter,
  WithTransactionQueryAdapter,
} from "./index.js";

type Assert<T extends true> = T;
type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;

type _TransactionalIsQueryAdapter = Assert<TransactionalQueryAdapter extends QueryAdapter ? true : false>;
type _WithTransactionIsQueryAdapter = Assert<WithTransactionQueryAdapter extends QueryAdapter ? true : false>;
type _EventCarriesProviderIdentity = Assert<ExternalMembershipEvent extends { provider: string; providerMembershipId: string } ? true : false>;
type _EventClaimCarriesProviderNamespace = Assert<ExternalMembershipEventClaim extends { provider: string; eventId: string } ? true : false>;
type _MembershipKeepsLocalIdentity = Assert<ExternalMembership extends { membershipId: string; createdAt: Date | string } ? true : false>;
type _CommandUsesRepository = Assert<ReconcileExternalMembershipCommand extends { repository: ExternalMembershipRepository } ? true : false>;
type _RepositoryRequiresIdentityLock = Assert<ExternalMembershipRepository extends {
  lockExternalIdentity(query: QueryAdapter, identity: { provider: string; providerMembershipId: string }): Promise<void>;
} ? true : false>;
type _ResultHasClosedStatuses = Assert<Equal<ExternalMembershipReconciliationResult["status"], "created" | "updated" | "deleted" | "duplicate" | "stale" | "unchanged">>;

// A conventional SQL pool seam is compatible without an adapter shim:
// repositories own result typing while the core only requires a query
// capability plus a transaction boundary.
interface ConsumerPoolLike {
  query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
  withTransaction<T>(work: (client: ConsumerPoolLike) => Promise<T>): Promise<T>;
}
type _ConsumerPoolSupportsQueryAdapter = Assert<ConsumerPoolLike extends QueryAdapter ? true : false>;
type _ConsumerPoolSupportsWithTransaction = Assert<ConsumerPoolLike extends WithTransactionQueryAdapter ? true : false>;

// ------------------------------------------------------------ the ternary

// The runtime verdict is exactly three, and `unverifiable` is one of them.
// Pinned at the type level because the whole package turns on it: a future
// edit that narrowed this to a boolean, or quietly folded `unverifiable` into
// `denied`, would compile fine everywhere else and change what this package
// means.
type _VerdictIsATernary = Assert<Equal<AuthorityDecision["verdict"], "authorized" | "denied" | "unverifiable">>;

// @ts-expect-error A verdict is never a boolean — "could not find out" has nowhere to go in a boolean.
type _VerdictIsNotABoolean = Assert<Equal<AuthorityDecision["verdict"], boolean>>;

// Every decision names the actor AND the subject, separately. A single merged
// identifier would make "acted on their own account" and "acted on somebody
// else's" indistinguishable in the only record anyone will still have.
type _DecisionKeepsActorAndSubjectApart = Assert<AuthorityDecision extends { actorId: string; subjectId: string } ? true : false>;
type _GrantKeepsActorAndSubjectApart = Assert<Grant extends { actorId: string; subjectId: string } ? true : false>;

// @ts-expect-error A grant's actor and subject are two fields, not one merged principal.
type _GrantHasNoMergedPrincipal = Assert<Grant extends { principalId: string } ? true : false>;

// A provider observation carries reachability as its own field, never as an
// inference from an empty backing list: "said nothing is backed" and "did not
// answer" are opposite facts with an identical empty array.
type _AssertionCarriesReachability = Assert<Equal<ProviderAssertion["reachability"], "reachable" | "unreachable">>;

// An absent spend ceiling has to survive validation as absent. Collapsing it
// to `null` would delete `checkDelegationCeiling`'s finding before the checker
// ever ran.
type _CeilingHasThreeStates = Assert<Equal<DelegatedActor["monetaryLimitAmount"], number | null | undefined>>;

// Every gate result is three-state: `ok` plus an OPTIONAL reason, where the
// reason distinguishes a real violation from an indeterminate run. A result
// with no reason channel could only ever say "pass" or "fail".
type _ReconciliationIsThreeState = Assert<AuthorityReconciliationResult extends { ok: boolean; reason?: string } ? true : false>;
type _DelegationIsThreeState = Assert<DelegationCeilingResult extends { ok: boolean; reason?: string } ? true : false>;
type _ProviderContractIsThreeState = Assert<ProviderContractResult extends { ok: boolean; reason?: string } ? true : false>;

export {};
