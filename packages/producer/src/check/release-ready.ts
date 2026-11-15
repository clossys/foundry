/**
 * `release.ready` (flows.md F8 step 6): every release pin on disk is a ready-pin now. See release/ready.ts for the
 * rules; a tree with no release pin passes, and anything unreadable fails.
 */
import { checkReleaseReady, RELEASE_READY } from "../release/ready.js";
import { treeResult, type TreeCheck, type TreeCheckResult } from "../records/slot.js";

export { RELEASE_READY };

export function runReleaseReady(root: string): TreeCheckResult {
  return treeResult(RELEASE_READY, checkReleaseReady(root).findings.map(row => ({ subject: row.subject, detail: row.detail })));
}

export const releaseReady: TreeCheck = { id: RELEASE_READY, run: runReleaseReady };
