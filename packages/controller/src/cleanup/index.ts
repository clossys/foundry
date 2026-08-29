/**
 * `@clossys/controller/cleanup` — pure workspace-cleanup
 * classification: the deterministic decision core shared by every
 * account-plane cleanup skill (#215). This subpath performs no Git,
 * filesystem, GitHub, scheduler, credential, network, or deletion I/O, and
 * exports no deletion API of any kind — see the package README's
 * `./cleanup` section for the full contract and thin-adapter guidance, and
 * `no-deletion-api.test.ts` for the test that fails the moment either
 * guarantee regresses.
 */
export { CLEANUP_CLASSIFICATION_VERSION } from "./types.js";
export { classifyCleanupCandidate } from "./classify.js";
export type {
  CleanupBranchEvidence,
  CleanupCandidate,
  CleanupLocationEvidence,
  CleanupLocationKind,
  CleanupOriginEvidence,
  CleanupOwnershipEvidence,
  CleanupProposal,
  CleanupPruneEvidence,
  CleanupPullRequestEvidence,
  CleanupPullRequestState,
  CleanupReason,
  CleanupReasonCode,
  CleanupStatus,
} from "./types.js";
