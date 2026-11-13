/** Pure approval policy shared by browser resolution and server assessment. */
import type { CopyApproval, CopyRegistryEntry } from "./types.js";
import { computeCopyFingerprint } from "./fingerprint.js";

/**
 * One delegate scope item: a dot-separated entry-id namespace with no
 * wildcard, e.g. `"site"` or `"site.home"`. Unlike `CopyEntryId`, a single
 * segment is allowed, because a namespace may be a top-level one.
 */
export const COPY_DELEGATE_SCOPE_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;

/** True when `value` is a well-formed delegate scope item. */
export function isDelegateScopeItem(value: unknown): value is string {
  return typeof value === "string" && COPY_DELEGATE_SCOPE_RE.test(value);
}

/**
 * True when `entryId` falls inside one of `scope`'s namespaces: it equals an
 * item, or starts with `item + "."`. `"site.home"` covers `"site.home"` and
 * `"site.home.title"`, never `"site.homepage.title"`.
 */
export function isEntryInDelegateScope(entryId: string, scope: readonly string[]): boolean {
  return scope.some((item) => entryId === item || entryId.startsWith(`${item}.`));
}

/**
 * True when `entry`'s recorded `textFingerprint` no longer matches its
 * current `text` — the record was made for wording that has since changed.
 * Exported so `resolve.ts` and `assessCopyApprovals` share one predicate
 * rather than two independently-drifting copies of the same comparison.
 */
export function isApprovalStale(entry: Pick<CopyRegistryEntry, "text" | "approval">): boolean {
  const approval = entry.approval;
  if (!approval) return false;
  return computeCopyFingerprint(entry.text) !== approval.textFingerprint;
}

/** True when `approval.expiresAt` is set and has passed as of `now`. */
export function isApprovalExpired(approval: CopyApproval, now: Date): boolean {
  return approval.expiresAt !== undefined && now.getTime() >= Date.parse(approval.expiresAt);
}
