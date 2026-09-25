// The repository change set and the apply bundle (issue #1178), validated
// against the shared contracts docs/contracts/repository-change-set.json and
// apply-bundle.json -- in the public repository, not shipped in this
// package. This package's build packs both into src/generated/ beside the
// plan and brief contracts, and validates them with the same generated copy
// of the one contract checker. The TypeScript types below describe the same
// shapes for callers; they validate nothing.

import { formatContractViolation, validateAgainstContract } from "./generated/contract-schema.generated.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import { loadPackedContract } from "./plan-contract.js";
import type { ValidationResult } from "./plan-contract.js";

export type RepositoryVisibility = "private" | "internal" | "public";
export type ChangeSetPhase = "setup" | "apply";
export type PackageManagerKind = "npm" | "pnpm" | "yarn" | "none";
export type LockfileName = "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "none";
export type ReleaseAgeSurfaceKind = "pnpm-workspace" | "yarnrc" | "npmrc";
export type DependencyPlacement = "dependencies" | "devDependencies";

/** One exact package: one version and one sha512 integrity value. */
export interface PinnedPackage {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export type ChangeSetItem =
  | { readonly id: string; readonly act: "write-record"; readonly source: "engagement-brief" }
  | { readonly id: string; readonly act: "compose-skills"; readonly roles: readonly string[] }
  | {
      readonly id: string;
      readonly act: "install" | "pin-starter";
      readonly planItem: string;
      readonly package: PinnedPackage;
      readonly placement: DependencyPlacement;
      /** True when the default branch already has this exact version and integrity at this placement; such an item writes nothing. */
      readonly satisfiedInBase: boolean;
    }
  | { readonly id: string; readonly act: "exempt-release-age"; readonly scope: string; readonly surface: ReleaseAgeSurfaceKind; readonly path: string }
  | { readonly id: string; readonly act: "write-ledger" | "add-caller-workflow" | "write-starter-request" | "add-ci-template" | "add-path-scope-job" };

/** `sha256:` and 64 hex digits of a file's bytes, or null when the file is absent. */
export type ContentDigest = string | null;

/** A file whose exact bytes the set writes. */
export interface WholeFileChange {
  readonly path: string;
  readonly mode: "100644" | "100755";
  readonly before: ContentDigest;
  readonly after: ContentDigest;
  readonly item: string;
}

/** The lockfile resolves this package to this exact version and integrity. */
export interface PackageInvariant extends PinnedPackage {
  readonly item: string;
}

/** The ledger the set writes has this generation. */
export interface LedgerInvariant {
  readonly ledgerGeneration: number;
}

/** A file checked by its invariants, never by its bytes; its `before` and `after` are outside the digest. */
export interface DerivedFileChange {
  readonly path: string;
  readonly mode: "100644" | "100755";
  readonly derived: true;
  readonly item: string;
  readonly invariants: readonly (PackageInvariant | LedgerInvariant)[];
  readonly before?: ContentDigest;
  readonly after?: ContentDigest;
}

export type FileChange = WholeFileChange | DerivedFileChange;

/** One owned key inside package.json, by JSON pointer. */
export interface KeyChange {
  readonly file: "package.json";
  readonly pointer: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly item: string;
}

export type RefusalReason = "unowned-existing" | "client-edited" | "manifest-absent" | "unsafe-path";

export type ChangeSetRefusal =
  | { readonly path: string; readonly reason: RefusalReason; readonly item: string }
  | { readonly file: "package.json"; readonly pointer: string; readonly reason: RefusalReason; readonly item: string };

export interface ChangeSetDeferral {
  readonly planItem: string;
  readonly reason: "after-setup";
}

/** One repository's change set (repository-change-set.json, in the public repository, not shipped in this package). */
export interface RepositoryChangeSet {
  readonly schemaVersion: 1;
  readonly kind: "clossys.repository-change-set";
  readonly producer: { readonly name: string; readonly version: string };
  readonly planDigest: string;
  readonly repository: {
    readonly id: string;
    readonly nodeId: string;
    readonly visibility: RepositoryVisibility;
    readonly defaultBranch: string;
    readonly baseCommit: string;
  };
  readonly ledger: { readonly generation: number };
  readonly phase: ChangeSetPhase;
  readonly engine: PinnedPackage;
  readonly observed: {
    readonly packageManager: PackageManagerKind;
    readonly lockfile: LockfileName;
    readonly releaseAgeSurfaces: readonly { readonly surface: ReleaseAgeSurfaceKind; readonly path: string }[];
  };
  readonly items: readonly ChangeSetItem[];
  readonly files: readonly FileChange[];
  readonly keys: readonly KeyChange[];
  readonly refused: readonly ChangeSetRefusal[];
  readonly deferred: readonly ChangeSetDeferral[];
  readonly pathAllowList: readonly string[];
  readonly branch: string;
  readonly bundle: string;
  readonly pullRequest: { readonly title: string; readonly bodySha256?: string };
  readonly inverse?: string;
  readonly changeSetDigest: string;
}

export type CheckVerdict = "satisfied" | "violated" | "indeterminate";
export type ApplyCheckId = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9";

export interface ApplyCheck {
  readonly check: ApplyCheckId;
  readonly verdict: CheckVerdict;
  readonly rule?: string;
}

export type ApplyBundleRepository =
  | { readonly id: string; readonly verdict: CheckVerdict; readonly phase: ChangeSetPhase; readonly changeSet: string; readonly checks: readonly ApplyCheck[] }
  | { readonly id: string; readonly verdict: "violated" | "indeterminate"; readonly reason: string; readonly checks: readonly ApplyCheck[] };

/** One application attempt (apply-bundle.json, in the public repository, not shipped in this package). It has no repository state: see its contract. */
export interface ApplyBundle {
  readonly schemaVersion: 1;
  readonly kind: "clossys.apply-bundle";
  readonly mode: "report";
  readonly plan: { readonly path: "clossys/advisor/plan.json"; readonly digest: string; readonly committed: boolean };
  readonly snapshot: { readonly path: "clossys/.state/apply/registry-snapshot.json"; readonly digest: string } | null;
  readonly engine: PinnedPackage;
  readonly authorization: { readonly planDigest: string; readonly expiresAt: string } | null;
  readonly computedAt: string;
  readonly repositories: readonly ApplyBundleRepository[];
  readonly bundleDigest: string;
}

/** The path of the installed-state ledger every change set writes. */
export const LEDGER_PATH = "clossys/.state/installed.json";

const SAFE_PATH = /^(?:(?!\.\.?\/)[^/\\\u0000-\u001f]+\/)*(?!\.\.?$)[^/\\\u0000-\u001f]+$/u;

/** A relative path with `/` between segments and no empty, `.` or `..` segment (the contracts' safePath). */
export function isSafeRelativePath(path: string): boolean {
  return SAFE_PATH.test(path);
}

function segmentMatches(segment: string, glob: string): boolean {
  const pattern = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${pattern}$`, "u").test(segment);
}

function segmentsMatch(path: readonly string[], pattern: readonly string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern;
  if (head === "**") {
    for (let skip = 0; skip <= path.length; skip += 1) if (segmentsMatch(path.slice(skip), rest)) return true;
    return false;
  }
  return path.length > 0 && segmentMatches(path[0]!, head!) && segmentsMatch(path.slice(1), rest);
}

/**
 * Whether a safe relative path is matched by a path pattern: `*` matches
 * any characters within one segment, and a segment that is exactly `**`
 * matches any number of whole segments, including none. An unsafe path
 * matches nothing.
 */
export function matchesPathPattern(path: string, pattern: string): boolean {
  if (!isSafeRelativePath(path)) return false;
  return segmentsMatch(path.split("/"), pattern.split("/"));
}

export type ChangeSetRuleId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export type ApplyBundleRuleId = "A1" | "A2";

/** One reason a change set or bundle is refused: `rule` is "schema" for the contract's keywords, else the code rule's id. */
export interface ChangeSetViolation {
  readonly rule: "schema" | ChangeSetRuleId | ApplyBundleRuleId;
  readonly path: string;
  readonly message: string;
}

interface RuleViolation<R> {
  readonly rule: R;
  readonly path: string;
  readonly message: string;
}

function repeats<T>(values: readonly T[], key: (value: T) => string): { index: number; first: number }[] {
  const seen = new Map<string, number>();
  const out: { index: number; first: number }[] = [];
  values.forEach((value, index) => {
    const k = key(value);
    const first = seen.get(k);
    if (first === undefined) seen.set(k, index);
    else out.push({ index, first });
  });
  return out;
}

/** Code rules C1-C6 of repository-change-set.json, over a set whose schema already passes. Messages name positions, never values. */
export function changeSetRuleViolations(set: RepositoryChangeSet): RuleViolation<ChangeSetRuleId>[] {
  const out: RuleViolation<ChangeSetRuleId>[] = [];
  for (const { index, first } of repeats(set.items, (item) => item.id)) out.push({ rule: "C1", path: `items[${index}].id`, message: `repeats items[${first}].id` });

  const ids = new Set(set.items.map((item) => item.id));
  const unknown = (path: string, item: string) => {
    if (!ids.has(item)) out.push({ rule: "C2", path, message: "is not the id of an item" });
  };
  set.files.forEach((file, index) => {
    unknown(`files[${index}].item`, file.item);
    if ("derived" in file) file.invariants.forEach((invariant, at) => {
      if ("item" in invariant) unknown(`files[${index}].invariants[${at}].item`, invariant.item);
    });
  });
  set.keys.forEach((key, index) => unknown(`keys[${index}].item`, key.item));
  set.refused.forEach((refusal, index) => unknown(`refused[${index}].item`, refusal.item));

  for (const { index, first } of repeats(set.files, (file) => file.path)) out.push({ rule: "C3", path: `files[${index}].path`, message: `repeats files[${first}].path` });
  for (const { index, first } of repeats(set.keys, (key) => `${key.file}\u0000${key.pointer}`)) out.push({ rule: "C3", path: `keys[${index}].pointer`, message: `repeats keys[${first}].pointer` });
  set.files.forEach((file, index) => {
    if (!set.pathAllowList.some((pattern) => matchesPathPattern(file.path, pattern))) out.push({ rule: "C3", path: `files[${index}].path`, message: "is not matched by any pathAllowList entry" });
  });

  if (set.ledger.generation < 0) out.push({ rule: "C4", path: "ledger.generation", message: "must be 0 or more" });
  const ledgerItems = set.items.map((item, index) => ({ item, index })).filter(({ item }) => item.act === "write-ledger");
  if (ledgerItems.length !== 1) {
    out.push({ rule: "C4", path: "items", message: `must hold exactly one write-ledger item, and holds ${ledgerItems.length}` });
  } else {
    const ledgerId = ledgerItems[0]!.item.id;
    const ledgerFiles = set.files.map((file, index) => ({ file, index })).filter(({ file }) => file.item === ledgerId);
    if (ledgerFiles.length !== 1) {
      out.push({ rule: "C4", path: `items[${ledgerItems[0]!.index}]`, message: `must be named by exactly one file, and is named by ${ledgerFiles.length}` });
    } else {
      const { file, index } = ledgerFiles[0]!;
      const expected = set.ledger.generation + 1;
      const ok = file.path === LEDGER_PATH && "derived" in file && file.invariants.length === 1 && "ledgerGeneration" in file.invariants[0]! && file.invariants[0]!.ledgerGeneration === expected;
      if (!ok) out.push({ rule: "C4", path: `files[${index}]`, message: `must be the derived file ${LEDGER_PATH} with one invariant, ledgerGeneration equal to ledger.generation plus 1` });
    }
  }

  const digest = changeSetDigest(set);
  if (set.changeSetDigest !== digest) out.push({ rule: "C5", path: "changeSetDigest", message: "is not this change set's digest" });
  const short = digest.slice("sha256:".length, "sha256:".length + 12);
  if (set.branch !== `clossys/apply-${short}`) out.push({ rule: "C5", path: "branch", message: "is not clossys/apply- and the first 12 digits of this change set's digest" });
  if (!set.pullRequest.title.endsWith(short)) out.push({ rule: "C5", path: "pullRequest.title", message: "does not end with the first 12 digits of this change set's digest" });

  const planItems = [
    ...set.items.flatMap((item, index) => ("planItem" in item ? [{ planItem: item.planItem, path: `items[${index}].planItem` }] : [])),
    ...set.deferred.map((deferral, index) => ({ planItem: deferral.planItem, path: `deferred[${index}].planItem` })),
  ];
  for (const { index, first } of repeats(planItems, (entry) => entry.planItem)) out.push({ rule: "C6", path: planItems[index]!.path, message: `repeats ${planItems[first]!.path}` });
  return out;
}

/** Code rules A1-A2 of apply-bundle.json, over a bundle whose schema already passes. */
export function applyBundleRuleViolations(bundle: ApplyBundle): RuleViolation<ApplyBundleRuleId>[] {
  const out: RuleViolation<ApplyBundleRuleId>[] = [];
  for (const { index, first } of repeats(bundle.repositories, (entry) => entry.id.toLowerCase())) out.push({ rule: "A1", path: `repositories[${index}].id`, message: `repeats repositories[${first}].id` });
  const computed = bundle.repositories.flatMap((entry) => ("changeSet" in entry ? [{ id: entry.id, changeSetDigest: entry.changeSet }] : []));
  if (bundle.bundleDigest !== bundleDigest(bundle.plan.digest, computed)) out.push({ rule: "A2", path: "bundleDigest", message: "is not the digest of plan.digest and the repositories that have a change set" });
  return out;
}

function violationsOf<T, R extends ChangeSetRuleId | ApplyBundleRuleId>(contractName: string, label: string, value: unknown, rules: (document: T) => readonly RuleViolation<R>[]): ChangeSetViolation[] {
  const schema = validateAgainstContract(loadPackedContract(contractName), value, loadPackedContract);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", path: violation.path, message: formatContractViolation(label, violation) }));
  return rules(value as T).map((violation) => ({ rule: violation.rule, path: violation.path, message: `${label}.${violation.path} ${violation.message} (rule ${violation.rule})` }));
}

function result(violations: readonly ChangeSetViolation[]): ValidationResult {
  if (violations.length === 0) return { valid: true };
  return { valid: false, reason: violations.map((violation) => violation.message).join("; ") };
}

/** Every reason a change set is refused: the change-set contract's schema, then, once that passes, its code rules C1-C6. */
export function repositoryChangeSetViolations(value: unknown): ChangeSetViolation[] {
  return violationsOf<RepositoryChangeSet, ChangeSetRuleId>("repository-change-set.json", "changeSet", value, changeSetRuleViolations);
}

/** Every reason a bundle is refused: the bundle contract's schema, then, once that passes, its code rules A1-A2. */
export function applyBundleViolations(value: unknown): ChangeSetViolation[] {
  return violationsOf<ApplyBundle, ApplyBundleRuleId>("apply-bundle.json", "bundle", value, applyBundleRuleViolations);
}

/** Validates a change set against repository-change-set.json and its code rules C1-C6. No reason echoes a value. */
export function validateRepositoryChangeSet(value: unknown): ValidationResult {
  return result(repositoryChangeSetViolations(value));
}

/** Validates a bundle against apply-bundle.json and its code rules A1-A2. No reason echoes a value. */
export function validateApplyBundle(value: unknown): ValidationResult {
  return result(applyBundleViolations(value));
}
