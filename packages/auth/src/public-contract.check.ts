import type {
  ExternalMembership,
  ExternalMembershipEvent,
  ExternalMembershipReconciliationResult,
  ExternalMembershipRepository,
  QueryAdapter,
  ReconcileExternalMembershipCommand,
  TransactionalQueryAdapter,
} from "./index.js";

type Assert<T extends true> = T;
type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;

type _TransactionalIsQueryAdapter = Assert<TransactionalQueryAdapter extends QueryAdapter ? true : false>;
type _EventCarriesProviderIdentity = Assert<ExternalMembershipEvent extends { provider: string; providerMembershipId: string } ? true : false>;
type _MembershipKeepsLocalIdentity = Assert<ExternalMembership extends { membershipId: string; createdAt: Date | string } ? true : false>;
type _CommandUsesRepository = Assert<ReconcileExternalMembershipCommand extends { repository: ExternalMembershipRepository } ? true : false>;
type _ResultHasClosedStatuses = Assert<Equal<ExternalMembershipReconciliationResult["status"], "created" | "updated" | "deleted" | "duplicate" | "stale" | "unchanged">>;

export {};
