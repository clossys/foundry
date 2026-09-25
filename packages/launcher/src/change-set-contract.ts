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
  /** Tool versions recorded for diagnosis when derived files are regenerated; outside the digest. */
  readonly tooling?: readonly { readonly tool: "node" | "npm" | "pnpm" | "yarn"; readonly version: string }[];
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

/** Where the engagement brief is written. */
export const BRIEF_PATH = "clossys/brief.json";

/** Every file name a lockfile can have. */
export const LOCKFILE_NAMES: readonly string[] = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

const DEFAULT_LOCKFILE: Readonly<Record<Exclude<PackageManagerKind, "none">, Exclude<LockfileName, "none">>> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

/**
 * The repository's lockfile path, as the change-set contract defines it: the
 * observed lockfile, or, when there is none, the one its package manager
 * writes; null when the repository has no package manager.
 */
export function lockfilePath(observed: { readonly packageManager: PackageManagerKind; readonly lockfile: LockfileName }): string | null {
  if (observed.lockfile !== "none") return observed.lockfile;
  return observed.packageManager === "none" ? null : DEFAULT_LOCKFILE[observed.packageManager];
}

/** Where a composed skill is written for a role. */
export function skillPath(role: string): string {
  return `.agents/skills/clossys-${role}/SKILL.md`;
}

/** The JSON pointer of one dependency entry in package.json. */
export function dependencyPointer(placement: DependencyPlacement, name: string): string {
  return `/${placement}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

const SAFE_PATH = /^(?:(?!\.\.?\/)[^/\\\u0000-\u001f]+\/)*(?!\.\.?$)[^/\\\u0000-\u001f]+$/u;

/** A relative path with `/` between segments and no empty, `.` or `..` segment (the contracts' safePath). */
export function isSafeRelativePath(path: string): boolean {
  return SAFE_PATH.test(path);
}

/** A path pattern as the contract allows one: a safe path whose segments may use `*`, where a segment containing `**` is exactly `**`, and which is not `**` alone. */
export function isPathPattern(pattern: string): boolean {
  if (pattern === "**" || !isSafeRelativePath(pattern)) return false;
  return pattern.split("/").every((segment) => segment === "**" || !segment.includes("**"));
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
 * matches any number of whole segments, including none. An unsafe path, or
 * a pattern the contract does not allow, matches nothing.
 */
export function matchesPathPattern(path: string, pattern: string): boolean {
  if (!isSafeRelativePath(path) || !isPathPattern(pattern)) return false;
  return segmentsMatch(path.split("/"), pattern.split("/"));
}

/** Orders two strings by their UTF-16 code units. */
export function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Orders two tuples of strings member by member, by UTF-16 code units. */
export function compareTuples(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = compareCodeUnits(left[index] ?? "", right[index] ?? "");
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The sort keys of the change-set contract's canonical order (code rule C8), shared by the planner that writes it and the rule that checks it. */
export const CANONICAL_KEYS = {
  item: (item: ChangeSetItem): string[] => [item.id],
  file: (file: FileChange): string[] => [file.path],
  key: (key: KeyChange): string[] => [key.file, key.pointer],
  refusal: (refusal: ChangeSetRefusal): string[] => ("path" in refusal ? [refusal.path, ""] : [refusal.file, refusal.pointer]),
  deferral: (deferral: ChangeSetDeferral): string[] => [deferral.planItem],
  invariant: (invariant: PackageInvariant | LedgerInvariant): string[] => ("name" in invariant ? [invariant.name] : [""]),
  pattern: (pattern: string): string[] => [pattern],
  surface: (surface: { readonly surface: string; readonly path: string }): string[] => [surface.surface, surface.path],
  tool: (tool: { readonly tool: string }): string[] => [tool.tool],
} as const;

/** A copy of `values` in canonical order by `key`. */
export function canonicalOrder<T>(values: readonly T[], key: (value: T) => readonly string[]): T[] {
  return [...values].sort((left, right) => compareTuples(key(left), key(right)));
}

const VERDICT_RANK: Readonly<Record<CheckVerdict, number>> = { satisfied: 0, indeterminate: 1, violated: 2 };

/** The worst of some verdicts: violated, then indeterminate, then satisfied; satisfied for none. */
export function worstVerdict(verdicts: readonly CheckVerdict[]): CheckVerdict {
  return verdicts.reduce<CheckVerdict>((current, verdict) => (VERDICT_RANK[verdict] > VERDICT_RANK[current] ? verdict : current), "satisfied");
}

/** The rule a bundle check carries when its authorization is for another plan (code rule A4). */
export const AUTHORIZATION_PLAN_MISMATCH = "authorization-plan-mismatch";

export type ChangeSetRuleId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9" | "C10";
export type ApplyBundleRuleId = "A1" | "A2" | "A3" | "A4";

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

type PackageItem = Extract<ChangeSetItem, { act: "install" | "pin-starter" }>;
const isPackageItem = (item: ChangeSetItem): item is PackageItem => item.act === "install" || item.act === "pin-starter";
const isDerived = (file: FileChange): file is DerivedFileChange => "derived" in file;
const isPackageInvariant = (invariant: PackageInvariant | LedgerInvariant): invariant is PackageInvariant => "name" in invariant;
const lower = (text: string) => text.toLowerCase();

/** C8: the index of the first entry out of canonical order (or repeated, when `strict`), if any. */
function firstOutOfOrder<T>(values: readonly T[], key: (value: T) => readonly string[], strict: boolean): number | undefined {
  for (let index = 1; index < values.length; index += 1) {
    const difference = compareTuples(key(values[index - 1]!), key(values[index]!));
    if (difference > 0 || (strict && difference === 0)) return index;
  }
  return undefined;
}

/** Code rules C1-C10 of repository-change-set.json, over a set whose schema already passes. Messages name positions, never values. */
export function changeSetRuleViolations(set: RepositoryChangeSet): RuleViolation<ChangeSetRuleId>[] {
  const out: RuleViolation<ChangeSetRuleId>[] = [];
  const push = (rule: ChangeSetRuleId, path: string, message: string) => out.push({ rule, path, message });

  // C1
  for (const { index, first } of repeats(set.items, (item) => item.id)) push("C1", `items[${index}].id`, `repeats items[${first}].id`);

  // C2
  const itemsById = new Map(set.items.map((item) => [item.id, item]));
  const unknown = (path: string, item: string) => {
    if (!itemsById.has(item)) push("C2", path, "is not the id of an item");
  };
  set.files.forEach((file, index) => {
    unknown(`files[${index}].item`, file.item);
    if (isDerived(file)) file.invariants.forEach((invariant, at) => {
      if (isPackageInvariant(invariant)) unknown(`files[${index}].invariants[${at}].item`, invariant.item);
    });
  });
  set.keys.forEach((key, index) => unknown(`keys[${index}].item`, key.item));
  set.refused.forEach((refusal, index) => unknown(`refused[${index}].item`, refusal.item));

  // C3
  for (const { index, first } of repeats(set.files, (file) => lower(file.path))) push("C3", `files[${index}].path`, `repeats files[${first}].path, compared case-insensitively`);
  for (const { index, first } of repeats(set.keys, (key) => `${key.file}\u0000${key.pointer}`)) push("C3", `keys[${index}].pointer`, `repeats keys[${first}].pointer`);
  const written = new Set(set.files.map((file) => lower(file.path)));
  const writtenKeys = new Set(set.keys.map((key) => `${key.file}\u0000${key.pointer}`));
  set.refused.forEach((refusal, index) => {
    if ("path" in refusal && written.has(lower(refusal.path))) push("C3", `refused[${index}].path`, "is also written in files");
    if ("pointer" in refusal && writtenKeys.has(`${refusal.file}\u0000${refusal.pointer}`)) push("C3", `refused[${index}].pointer`, "is also written in keys");
  });
  const allowed = (path: string) => set.pathAllowList.some((pattern) => matchesPathPattern(path, pattern));
  set.files.forEach((file, index) => {
    if (!allowed(file.path)) push("C3", `files[${index}].path`, "is not matched by any pathAllowList entry");
  });
  set.keys.forEach((key, index) => {
    if (!allowed(key.file)) push("C3", `keys[${index}].file`, "is not matched by any pathAllowList entry");
  });
  set.items.forEach((item, index) => {
    if (item.act === "exempt-release-age" && !allowed(item.path)) push("C3", `items[${index}].path`, "is not matched by any pathAllowList entry");
  });

  // C4
  if (set.ledger.generation < 0) push("C4", "ledger.generation", "must be 0 or more");
  const ledgerItems = set.items.map((item, index) => ({ item, index })).filter(({ item }) => item.act === "write-ledger");
  if (ledgerItems.length !== 1) {
    push("C4", "items", `must hold exactly one write-ledger item, and holds ${ledgerItems.length}`);
  } else {
    const ledgerId = ledgerItems[0]!.item.id;
    const ledgerFiles = set.files.map((file, index) => ({ file, index })).filter(({ file }) => file.item === ledgerId);
    if (ledgerFiles.length !== 1) {
      push("C4", `items[${ledgerItems[0]!.index}]`, `must be named by exactly one file, and is named by ${ledgerFiles.length}`);
    } else {
      const { file, index } = ledgerFiles[0]!;
      const expected = set.ledger.generation + 1;
      const ok = file.path === LEDGER_PATH && isDerived(file) && file.invariants.length === 1 && !isPackageInvariant(file.invariants[0]!) && file.invariants[0]!.ledgerGeneration === expected;
      if (!ok) push("C4", `files[${index}]`, `must be the derived file ${LEDGER_PATH} with one invariant, ledgerGeneration equal to ledger.generation plus 1`);
    }
  }

  // C5
  const digest = changeSetDigest(set);
  if (set.changeSetDigest !== digest) push("C5", "changeSetDigest", "is not this change set's digest");
  const short = digest.slice("sha256:".length, "sha256:".length + 12);
  if (set.branch !== `clossys/apply-${short}`) push("C5", "branch", "is not clossys/apply- and the first 12 digits of this change set's digest");
  if (!set.pullRequest.title.endsWith(short)) push("C5", "pullRequest.title", "does not end with the first 12 digits of this change set's digest");

  // C6
  const planItems = [
    ...set.items.flatMap((item, index) => (isPackageItem(item) ? [{ planItem: item.planItem, path: `items[${index}].planItem` }] : [])),
    ...set.deferred.map((deferral, index) => ({ planItem: deferral.planItem, path: `deferred[${index}].planItem` })),
  ];
  for (const { index, first } of repeats(planItems, (entry) => entry.planItem)) push("C6", planItems[index]!.path, `repeats ${planItems[first]!.path}`);

  // C7
  const lockPath = lockfilePath(set.observed);
  const lockfiles: number[] = [];
  set.files.forEach((file, index) => {
    if (!isDerived(file)) {
      if (file.path === LEDGER_PATH || file.path === "package.json" || LOCKFILE_NAMES.includes(file.path)) push("C7", `files[${index}].path`, "may not be written as a whole file");
      return;
    }
    if (file.path === LEDGER_PATH) {
      if (file.invariants.some(isPackageInvariant)) push("C7", `files[${index}].invariants`, "of the ledger may hold only a ledgerGeneration invariant");
      return;
    }
    if (file.path !== lockPath) {
      push("C7", `files[${index}].path`, "is derived but is neither the ledger nor this repository's lockfile path");
      return;
    }
    lockfiles.push(index);
    file.invariants.forEach((invariant, at) => {
      if (!isPackageInvariant(invariant)) push("C7", `files[${index}].invariants[${at}]`, "of the lockfile must be a package invariant");
    });
  });
  if (lockfiles.length > 1) push("C7", `files[${lockfiles[1]}]`, "is a second derived lockfile");

  // C8
  const order = <T>(path: string, values: readonly T[], key: (value: T) => readonly string[], strict = false) => {
    const index = firstOutOfOrder(values, key, strict);
    if (index !== undefined) push("C8", `${path}[${index}]`, strict ? "is out of canonical order, or repeats the entry before it" : "is out of canonical order");
  };
  order("items", set.items, CANONICAL_KEYS.item);
  order("files", set.files, CANONICAL_KEYS.file);
  order("keys", set.keys, CANONICAL_KEYS.key);
  order("refused", set.refused, CANONICAL_KEYS.refusal);
  order("deferred", set.deferred, CANONICAL_KEYS.deferral);
  set.files.forEach((file, index) => {
    if (isDerived(file)) order(`files[${index}].invariants`, file.invariants, CANONICAL_KEYS.invariant);
  });
  order("pathAllowList", set.pathAllowList, CANONICAL_KEYS.pattern, true);
  order("observed.releaseAgeSurfaces", set.observed.releaseAgeSurfaces, CANONICAL_KEYS.surface, true);
  if (set.tooling !== undefined) order("tooling", set.tooling, CANONICAL_KEYS.tool, true);

  // C9
  set.items.forEach((item, index) => {
    const files = set.files.map((file, at) => ({ file, at })).filter(({ file }) => file.item === item.id);
    const refusals = set.refused.map((refusal, at) => ({ refusal, at })).filter(({ refusal }) => refusal.item === item.id);
    const keys = set.keys.filter((key) => key.item === item.id);
    const invariants = set.files.flatMap((file) => (isDerived(file) ? file.invariants.filter((invariant) => isPackageInvariant(invariant) && invariant.item === item.id) : []));
    const at = `items[${index}]`;
    if (item.act === "write-record") {
      const paths = [...files.map(({ file }) => ({ path: file.path, whole: !isDerived(file) })), ...refusals.map(({ refusal }) => ({ path: "path" in refusal ? refusal.path : "", whole: "path" in refusal }))];
      if (keys.length > 0 || paths.length !== 1 || paths[0]!.path !== BRIEF_PATH || !paths[0]!.whole) push("C9", at, `must be named by exactly one whole file or path refusal, at ${BRIEF_PATH}`);
    } else if (item.act === "compose-skills") {
      for (const { index: repeat, first } of repeats(item.roles, (role) => role)) push("C9", `${at}.roles[${repeat}]`, `repeats roles[${first}]`);
      const expected = new Set(item.roles.map(skillPath));
      const named = [...files.map(({ file }) => (isDerived(file) ? "" : file.path)), ...refusals.map(({ refusal }) => ("path" in refusal ? refusal.path : ""))];
      const counts = new Map<string, number>();
      for (const path of named) counts.set(path, (counts.get(path) ?? 0) + 1);
      const ok = keys.length === 0 && named.length === expected.size && [...expected].every((path) => counts.get(path) === 1);
      if (!ok) push("C9", at, "must be named, for each role, by exactly one whole file or path refusal at that role's skill path, and by nothing else");
    } else if (isPackageItem(item)) {
      const pointer = dependencyPointer(item.placement, item.package.name);
      if (files.some(({ file }) => !isDerived(file))) push("C9", at, "is named by a whole file");
      if (refusals.some(({ refusal }) => "path" in refusal)) push("C9", at, "is named by a path refusal");
      if (keys.some((key) => key.pointer !== pointer || key.after !== item.package.version)) push("C9", at, "is named by a key whose pointer or value is not this item's");
      const pinned = (invariant: PackageInvariant | LedgerInvariant) =>
        isPackageInvariant(invariant) && invariant.name === item.package.name && invariant.version === item.package.version && invariant.integrity === item.package.integrity;
      if (!invariants.every(pinned)) push("C9", at, "is named by an invariant whose package is not this item's");
      const keyRefusals = refusals.filter(({ refusal }) => "pointer" in refusal).length;
      if (item.satisfiedInBase) {
        if (keys.length + invariants.length + refusals.length > 0) push("C9", at, "is satisfied in the base, so nothing may be written or refused for it");
      } else if (!((keys.length === 1 && invariants.length === 1 && refusals.length === 0) || (keys.length === 0 && invariants.length === 0 && keyRefusals >= 1))) {
        push("C9", at, "is not satisfied in the base, so it must write exactly one key and one invariant, or be refused");
      }
    }
  });
  const kinds = new Map(set.items.map((item) => [item.id, item]));
  set.keys.forEach((key, index) => {
    const item = kinds.get(key.item);
    if (item !== undefined && !isPackageItem(item)) push("C9", `keys[${index}].item`, "is not a package item");
  });
  set.refused.forEach((refusal, index) => {
    const item = kinds.get(refusal.item);
    if ("pointer" in refusal && item !== undefined && !isPackageItem(item)) push("C9", `refused[${index}].item`, "is a key refusal for an item that is not a package item");
  });
  set.files.forEach((file, index) => {
    if (!isDerived(file) || file.path === LEDGER_PATH) return;
    file.invariants.forEach((invariant, at) => {
      const item = isPackageInvariant(invariant) ? kinds.get(invariant.item) : undefined;
      if (item !== undefined && !isPackageItem(item)) push("C9", `files[${index}].invariants[${at}].item`, "is not a package item");
    });
    const first = file.invariants[0];
    if (first !== undefined && isPackageInvariant(first) && file.item !== first.item) push("C9", `files[${index}].item`, "is not the item of its first invariant");
  });

  // C10
  set.items.forEach((item, index) => {
    if (set.phase === "setup" && item.act === "install") push("C10", `items[${index}]`, "is an install in a setup set, where installs are deferred");
  });
  if (set.phase === "apply") set.deferred.forEach((_, index) => push("C10", `deferred[${index}]`, "is deferred in an apply set, which defers nothing"));
  return out;
}

/** Code rules A1-A4 of apply-bundle.json, over a bundle whose schema already passes. */
export function applyBundleRuleViolations(bundle: ApplyBundle): RuleViolation<ApplyBundleRuleId>[] {
  const out: RuleViolation<ApplyBundleRuleId>[] = [];
  for (const { index, first } of repeats(bundle.repositories, (entry) => entry.id.toLowerCase())) out.push({ rule: "A1", path: `repositories[${index}].id`, message: `repeats repositories[${first}].id` });
  const computed = bundle.repositories.flatMap((entry) => ("changeSet" in entry ? [{ id: entry.id, changeSetDigest: entry.changeSet }] : []));
  if (bundle.bundleDigest !== bundleDigest(bundle.plan.digest, computed)) out.push({ rule: "A2", path: "bundleDigest", message: "is not the digest of plan.digest and the repositories that have a change set" });
  const mismatch = bundle.authorization !== null && bundle.authorization.planDigest !== bundle.plan.digest;
  bundle.repositories.forEach((entry, index) => {
    const expected = entry.checks.length === 0 && !("changeSet" in entry) ? entry.verdict : worstVerdict(entry.checks.map((check) => check.verdict));
    if (entry.verdict !== expected) out.push({ rule: "A3", path: `repositories[${index}].verdict`, message: "is not the worst of its checks' verdicts" });
    const flagged = entry.checks.some((check) => check.check === "V3" && check.verdict === "violated" && check.rule === AUTHORIZATION_PLAN_MISMATCH);
    const carries = entry.checks.some((check) => check.rule === AUTHORIZATION_PLAN_MISMATCH);
    if ("changeSet" in entry && mismatch && !flagged) out.push({ rule: "A4", path: `repositories[${index}].checks`, message: "lacks the violated V3 check for an authorization issued for another plan" });
    if (!mismatch && carries) out.push({ rule: "A4", path: `repositories[${index}].checks`, message: "reports an authorization mismatch the bundle does not have" });
  });
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

/** Every reason a change set is refused: the change-set contract's schema, then, once that passes, its code rules C1-C10. */
export function repositoryChangeSetViolations(value: unknown): ChangeSetViolation[] {
  return violationsOf<RepositoryChangeSet, ChangeSetRuleId>("repository-change-set.json", "changeSet", value, changeSetRuleViolations);
}

/** Every reason a bundle is refused: the bundle contract's schema, then, once that passes, its code rules A1-A4. */
export function applyBundleViolations(value: unknown): ChangeSetViolation[] {
  return violationsOf<ApplyBundle, ApplyBundleRuleId>("apply-bundle.json", "bundle", value, applyBundleRuleViolations);
}

/** Validates a change set against repository-change-set.json and its code rules C1-C10. No reason echoes a value. */
export function validateRepositoryChangeSet(value: unknown): ValidationResult {
  return result(repositoryChangeSetViolations(value));
}

/** Validates a bundle against apply-bundle.json and its code rules A1-A4. No reason echoes a value. */
export function validateApplyBundle(value: unknown): ValidationResult {
  return result(applyBundleViolations(value));
}
