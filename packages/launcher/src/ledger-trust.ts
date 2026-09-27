// Whether the apply planner may trust a repository's installed-state ledger
// (issue #1178; docs/rfcs/apply-approved-plan.md §12.1, §12.2 and §12.8), and
// the one compare-and-swap table for a whole file. A ledger is a claim anyone
// with write access could have edited (TRUST in installed-ledger.json, in the
// public repository, not shipped in this package): it is trusted only when
// every generation it records is a change set the hub holds as a
// self-verifying set, and every row it carries is one of those sets' own
// writes. Anything less refuses the whole repository, never one row: RENDER
// re-publishes every row it keeps, so a row the hub cannot account for would
// otherwise be laundered into the next generation.
//
// Pure: no I/O, no clock, no randomness. The caller reads the ledger's bytes
// and the held change sets; this module only compares them. A refusal carries
// a rule id and nothing else, never a path, id, digest or other value.

import { EXEMPTION_SURFACES, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ChangeSetItem, ChangeSetPhase, FileChange, RepositoryChangeSet, WholeFileChange } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import { readInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger, LedgerEntryRow, LedgerHistoryEntry } from "./ledger-contract.js";

/**
 * Why a ledger is not trusted. ledger-unreadable: the bytes are not a valid,
 * exactly canonical ledger. identity: its repository.nodeId is not the
 * observed repository's (T11). renamed: its repository.id is not exactly the
 * observed id -- a difference in letter case alone is still a rename, because
 * a ledger generation can never change the id's case (SUCCESSION S2 and code
 * rule L10 both require an exact match). ledger-chain: some history entry is
 * not a held, self-verifying, valid change set that agrees with it. and
 * ledger-foreign-row: some row is not a write of the change set it names (T9).
 */
export type LedgerTrustRule = "ledger-unreadable" | "identity" | "renamed" | "ledger-chain" | "ledger-foreign-row";

/** The trust verdict on one repository's ledger: trusted (null when the repository has none, generation 0), or refused by one rule. */
export type LedgerTrust =
  | { readonly state: "trusted"; readonly ledger: InstalledLedger | null }
  | { readonly state: "refused"; readonly rule: LedgerTrustRule };

type PackageItem = Extract<ChangeSetItem, { act: "install" | "pin-starter" }>;

const isWhole = (file: FileChange): file is WholeFileChange => !("derived" in file);
const isPackageItem = (item: ChangeSetItem): item is PackageItem => item.act === "install" || item.act === "pin-starter";

/** Whether a path refusal of `set` names the item: RENDER adds no entries row for such an item. */
function pathRefused(set: RepositoryChangeSet, itemId: string): boolean {
  return set.refused.some((refusal) => "path" in refusal && refusal.item === itemId);
}

/** Whether a key refusal of `set` names the item: RENDER adds no packages row for such an item. */
function keyRefused(set: RepositoryChangeSet, itemId: string): boolean {
  return set.refused.some((refusal) => "pointer" in refusal && refusal.item === itemId);
}

/** Whether a held set is valid under its contract and its digest recomputes to the one it carries. Never throws. */
function selfVerifying(set: RepositoryChangeSet): boolean {
  try {
    return validateRepositoryChangeSet(set).valid && changeSetDigest(set) === set.changeSetDigest;
  } catch {
    return false;
  }
}

/** The held set that wrote history[index], agreeing with the entry on everything a set carries, or undefined. */
function matchHistoryEntry(
  entry: LedgerHistoryEntry,
  index: number,
  nodeId: string,
  held: readonly RepositoryChangeSet[],
  verified: (set: RepositoryChangeSet) => boolean,
): RepositoryChangeSet | undefined {
  // Several held sets may share a digest and differ in `bundle`, which is outside the digest and not compared here.
  return held.find(
    (set) =>
      set?.changeSetDigest === entry.changeSet &&
      set.phase === entry.phase &&
      set.planDigest === entry.planDigest &&
      set.repository?.baseCommit === entry.baseCommit &&
      set.repository?.nodeId === nodeId &&
      set.ledger?.generation === index &&
      verified(set),
  );
}

function entryRowWritten(set: RepositoryChangeSet, row: LedgerEntryRow): boolean {
  return set.items.some((item) => {
    if (item.act === "exempt-release-age") {
      return item.path === row.file && EXEMPTION_SURFACES[item.surface].key === row.key && `${item.scope}/*` === row.value && !pathRefused(set, item.id);
    }
    if (item.act === "declare-root-entry") {
      return item.path === row.file && row.key === "rootEntries" && item.entries.some((entry) => entry.name === row.value) && !pathRefused(set, item.id);
    }
    return false;
  });
}

/** Whether every row of the ledger is a write of the change set it names (L4 makes each name a history entry's). */
function rowsWritten(ledger: InstalledLedger, bySet: ReadonlyMap<string, RepositoryChangeSet>): boolean {
  const setOf = (changeSet: string) => bySet.get(changeSet);
  return (
    ledger.files.every((row) => {
      const set = setOf(row.changeSet);
      return set !== undefined && set.files.some((file) => isWhole(file) && file.path === row.path && file.mode === row.mode && file.after === row.after);
    }) &&
    ledger.keys.every((row) => {
      const set = setOf(row.changeSet);
      return set !== undefined && set.keys.some((key) => key.file === row.file && key.pointer === row.pointer && key.after === row.value);
    }) &&
    ledger.packages.every((row) => {
      const set = setOf(row.changeSet);
      return (
        set !== undefined &&
        set.items.some(
          (item) =>
            isPackageItem(item) &&
            item.planItem === row.planItem &&
            item.act === row.act &&
            item.package.name === row.name &&
            item.package.version === row.version &&
            item.package.integrity === row.integrity &&
            item.placement === row.placement &&
            !keyRefused(set, item.id),
        )
      );
    }) &&
    ledger.entries.every((row) => {
      const set = setOf(row.changeSet);
      return set !== undefined && entryRowWritten(set, row);
    }) &&
    ledger.deferred.every((row) => {
      const set = setOf(row.changeSet);
      return set !== undefined && set.deferred.some((deferral) => deferral.planItem === row.planItem);
    })
  );
}

/**
 * Whether the planner may build on a repository's ledger. `bytes` is the exact
 * text of clossys/.state/installed.json at the base (null when there is none),
 * `observed` the repository's observed id and immutable node id, and `held`
 * the change sets the hub holds (any repository's; each is re-verified here).
 * Checks, in order: no ledger is trusted at generation 0; unreadable bytes;
 * node id (identity); id, compared exactly -- a difference in letter case
 * alone is still refused as renamed (ledger-trust.ts); every history entry
 * matched by a held, valid, self-verifying set that agrees with it on phase,
 * planDigest, bundle, baseCommit, node id and the generation it was computed
 * over (ledger-chain); and every row a write of its matched set
 * (ledger-foreign-row). A refusal carries the rule only.
 */
export function trustInstalledLedger(bytes: Uint8Array | null, observed: { readonly id: string; readonly nodeId: string }, held: readonly RepositoryChangeSet[]): LedgerTrust {
  const refuse = (rule: LedgerTrustRule): LedgerTrust => ({ state: "refused", rule });
  if (bytes === null) return { state: "trusted", ledger: null };
  const ledger = readInstalledLedger(bytes);
  if (ledger === null) return refuse("ledger-unreadable");
  if (ledger.repository.nodeId !== observed.nodeId) return refuse("identity");
  if (ledger.repository.id !== observed.id) return refuse("renamed");

  const checked = new Map<RepositoryChangeSet, boolean>();
  const verified = (set: RepositoryChangeSet) => {
    let result = checked.get(set);
    if (result === undefined) {
      result = selfVerifying(set);
      checked.set(set, result);
    }
    return result;
  };
  const bySet = new Map<string, RepositoryChangeSet>();
  for (const [index, entry] of ledger.history.entries()) {
    const set = matchHistoryEntry(entry, index, ledger.repository.nodeId, held, verified);
    if (set === undefined) return refuse("ledger-chain");
    bySet.set(entry.changeSet, set);
  }
  if (!rowsWritten(ledger, bySet)) return refuse("ledger-foreign-row");
  return { state: "trusted", ledger };
}

/** What the planner knows about one whole file it wants to write. */
export interface WholeFileState {
  readonly path: string;
  /** The content digest the set wants at the path. */
  readonly desired: string;
  /** The trusted ledger's files row `after` at the path (compared case-insensitively), or null when it has none. */
  readonly row: string | null;
  /** The base's content digest at the path; null when no file is there. */
  readonly base: string | null;
  /** Whether the base has anything at the path: a file, or a directory holding one. */
  readonly occupied: boolean;
  readonly phase: ChangeSetPhase;
  /** The base's composed-skill manifest (clossys/.state/skills.json), read by the caller, or null when absent or unreadable; `sha256` is 64 hex digits with no prefix. */
  readonly skillsManifest: readonly { readonly name: string; readonly sha256: string }[] | null;
}

/** Whether to write a whole file and from which `before` (null: add; equal to the desired digest: keep; else update), or why not. */
export type WholeFileOutcome =
  | { readonly write: true; readonly before: string | null }
  | { readonly write: false; readonly reason: "unowned-existing" | "client-edited" | "deleted" };

const SKILL_FILE = /^\.agents\/skills\/clossys-([^/]+)\/skill\.md$/iu;

/**
 * The generation-0 adoption pass (RFC §12.2): only in a setup set, only over
 * a file that is there, and only when its bytes provably are flow output --
 * the bytes the set would write, or a composed skill whose digest the base's
 * skills manifest records. clossys/.state/skills.json itself is client
 * controlled and proves nothing about its own bytes, so it is adopted only
 * through the first branch, when its base already holds the bytes the set
 * would write; nothing else about it is ever adopted.
 */
function adoptable(state: WholeFileState): boolean {
  const { base } = state;
  if (state.phase !== "setup" || base === null) return false;
  if (base === state.desired) return true;
  const manifest = state.skillsManifest;
  if (manifest === null) return false;
  const role = SKILL_FILE.exec(state.path)?.[1]?.toLowerCase();
  return role !== undefined && manifest.some((entry) => entry.name === role && `sha256:${entry.sha256}` === base);
}

/**
 * The compare-and-swap table for one whole file (RFC §12.1), total over its
 * inputs and the one place it lives:
 *
 *   ledger row  base                      result
 *   none        nothing there             write, before null (add)
 *   none        occupied, adoptable       write, before = base (adopted)
 *   none        occupied, not adoptable   unowned-existing
 *   h           h                         write, before h (keep or update)
 *   h           nothing there             deleted (never folded into an update; D13)
 *   h           occupied by other bytes   client-edited (D11)
 *
 * Adoption happens only in a setup set; an apply set never adopts.
 */
export function reconcileWholeFile(state: WholeFileState): WholeFileOutcome {
  const occupied = state.occupied || state.base !== null;
  if (state.row === null) {
    if (!occupied) return { write: true, before: null };
    return adoptable(state) ? { write: true, before: state.base } : { write: false, reason: "unowned-existing" };
  }
  if (state.base === state.row) return { write: true, before: state.row };
  if (!occupied) return { write: false, reason: "deleted" };
  return { write: false, reason: "client-edited" };
}
