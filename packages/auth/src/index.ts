/** Provider-, framework-, and storage-neutral authorization primitives. */
export {
  isQueryAdapter,
  isTransactionalQueryAdapter,
  requireTransactionalQueryAdapter,
} from "./query.js";
export type { QueryAdapter, TransactionalQueryAdapter } from "./query.js";

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
