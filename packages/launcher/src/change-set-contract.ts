// The repository change set and the apply bundle (issue #1178), validated
// against the shared contracts docs/contracts/repository-change-set.json and
// apply-bundle.json -- in the public repository, not shipped in this
// package. This package's build packs both into src/generated/ beside the
// plan and brief contracts, and validates them with the same generated copy
// of the one contract checker. The TypeScript types below describe the same
// shapes for callers; they validate nothing.

import { createHash } from "node:crypto";
import { formatContractViolation, validateAgainstContract } from "./generated/contract-schema.generated.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import { loadPackedContract } from "./plan-contract.js";
import type { ValidationResult } from "./plan-contract.js";

export type RepositoryVisibility = "private" | "internal" | "public";
export type ChangeSetPhase = "setup" | "apply";
export type PackageManagerKind = "npm" | "pnpm" | "yarn" | "none";
export type LockfileName = "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "none";
export type ReleaseAgeSurfaceKind = "pnpm-workspace" | "yarnrc" | "npmrc";
/** The surfaces an exempt-release-age item can write: npm has no exemption key, so never .npmrc. */
export type ExemptionSurfaceKind = "pnpm-workspace" | "yarnrc";
export type DependencyPlacement = "dependencies" | "devDependencies";
/** A discovery root: a directory agent hosts read skills from, holding a link to each composed skill. */
export type DiscoveryRoot = ".claude/skills" | ".cursor/skills";
export type WriteRecordSource = "engagement-brief" | "agents-pointer" | "claude-loader";

/** One exact package: one version and one sha512 integrity value. */
export interface PinnedPackage {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export type ChangeSetItem =
  | { readonly id: string; readonly act: "write-record"; readonly source: WriteRecordSource }
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
  | { readonly id: string; readonly act: "exempt-release-age"; readonly scope: string; readonly surface: ExemptionSurfaceKind; readonly path: string }
  | { readonly id: string; readonly act: "declare-root-entry"; readonly path: string; readonly entries: readonly RootEntryDeclaration[] }
  | { readonly id: string; readonly act: "write-ledger" | "add-caller-workflow" | "write-starter-request" | "add-ci-template" | "add-path-scope-job" };

/** One root entry a declare-root-entry item adds to a Controller profile: always an extension the repository allows. */
export interface RootEntryDeclaration {
  readonly name: string;
  readonly classification: "extension";
  readonly disposition: "allowed";
}

/** What was observed of the Controller repository profile on the default branch (code rule C13). */
export interface RepositoryProfileObservation {
  /** The profile Controller would locate. */
  readonly path: string;
  /** none: no root vocabulary Controller checks; checked: one it checks; unparseable: not readable as a profile with a well-formed rootEntries. */
  readonly rootVocabulary: "none" | "checked" | "unparseable";
  /** Root names the set introduces that the vocabulary does not declare. */
  readonly undeclaredRoots: readonly string[];
  /** Root names the set introduces that the vocabulary declares as prohibited. */
  readonly prohibitedRoots: readonly string[];
}

/** `sha256:` and 64 hex digits of a file's bytes, or null when the file is absent. */
export type ContentDigest = string | null;

/** A file whose exact bytes the set writes; mode 120000 is a discovery link, whose bytes are its target. */
export interface WholeFileChange {
  readonly path: string;
  readonly mode: "100644" | "120000";
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
  readonly mode: "100644";
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

export type RefusalReason =
  | "unowned-existing"
  | "client-edited"
  | "deleted"
  | "manifest-absent"
  | "unsafe-path"
  | "release-age-surface-conflict"
  | "release-age-surface-unparseable"
  | "root-vocabulary-unknown"
  | "root-entry-prohibited"
  | "skills-root-is-link";

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
  /** The exact Integrator package the hub pins; a product repository's CI runs its provenance check by this version. */
  readonly integrator: PinnedPackage;
  readonly observed: {
    readonly packageManager: PackageManagerKind;
    readonly lockfile: LockfileName;
    readonly releaseAgeSurfaces: readonly { readonly surface: ReleaseAgeSurfaceKind; readonly path: string }[];
    /** Whether the default branch has a workflow of its own, one whose file name does not start with clossys-. */
    readonly consumerCi: boolean;
    /** The discovery roots that are, or lie under, a symbolic link on the default branch; no link is written under them. */
    readonly symlinkedSkillRoots: readonly DiscoveryRoot[];
    /** The Controller repository profile the default branch declares, or null. */
    readonly repositoryProfile: RepositoryProfileObservation | null;
    /** Which of .agents, .agents/skills and .agents/skills/clossys-<role> is a symbolic link on the default branch. */
    readonly linkedAgentsPaths: readonly string[];
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

/**
 * On what authority a change set is written (installed-ledger.json,
 * definitions.binding): approved as a member of the bundle whose digest the
 * approving decision names, or admitted as the apply set that follows an
 * approved setup set under the one-approval rule.
 */
export type ApprovalBinding =
  | { readonly kind: "approved"; readonly subjectDigest: string }
  | { readonly kind: "admitted"; readonly subjectDigest: string; readonly setupChangeSet: string };

export type ApplyBundleRepository =
  | {
      readonly id: string;
      readonly verdict: CheckVerdict;
      readonly phase: ChangeSetPhase;
      readonly changeSet: string;
      readonly checks: readonly ApplyCheck[];
      /** Only in a planned bundle, when V1 to V9 all passed and an approval binds the set (code rule A6). */
      readonly state?: "planned";
      /** Only in a planned bundle, when every V3 check passed (code rule A7). */
      readonly binding?: ApprovalBinding;
    }
  | { readonly id: string; readonly verdict: "violated" | "indeterminate"; readonly reason: string; readonly checks: readonly ApplyCheck[] };

/**
 * One application attempt (apply-bundle.json, in the public repository, not
 * shipped in this package). A report bundle claims no repository state; a
 * planned bundle records which repositories passed V1 to V9 and are bound by
 * an approval. See its contract.
 */
export interface ApplyBundle {
  readonly schemaVersion: 1;
  readonly kind: "clossys.apply-bundle";
  readonly mode: "report" | "planned";
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

/** Where the composed-skill manifest is written: one per compose-skills item (code rule C9). */
export const SKILLS_MANIFEST_PATH = "clossys/.state/skills.json";

/** Controller's limit on a root entry name, in UTF-16 code units. */
export const MAX_ROOT_NAME_UNITS = 255;

/** A lowercase id token, such as a role: the contracts' idToken. */
export const ID_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * The root names a change set can introduce: the first segment of each
 * owned pattern other than `**`, read from the packed contract. A fixed list,
 * so no plan or brief text can become a root entry (code rules C13 and L9).
 */
export const INTRODUCIBLE_ROOTS: ReadonlySet<string> = (() => {
  const definitions = loadPackedContract("repository-change-set.json").definitions as Record<string, { allOf?: { enum?: unknown }[] }> | undefined;
  const patterns = definitions?.ownedPattern?.allOf?.[1]?.enum;
  if (!Array.isArray(patterns) || !patterns.every((entry) => typeof entry === "string")) throw new Error("the packed change-set contract has no ownedPattern list");
  return new Set((patterns as string[]).map((pattern) => pattern.split("/")[0]!).filter((root) => root !== "**"));
})();

/** The planItem a package act for this repository and package has: `${repositoryId}:${name}`, exactly (code rules C16 and L10). */
export function derivedPlanItem(repositoryId: string, name: string): string {
  return `${repositoryId}:${name}`;
}

/** The discovery roots, in canonical order. */
export const DISCOVERY_ROOTS: readonly DiscoveryRoot[] = [".claude/skills", ".cursor/skills"];

/** Where a role's discovery link is written under a discovery root. */
export function discoveryLinkPath(root: DiscoveryRoot, role: string): string {
  return `${root}/clossys-${role}`;
}

/** A discovery link's target: its exact bytes, with no line feed. */
export function discoveryLinkTarget(role: string): string {
  return `../../.agents/skills/clossys-${role}`;
}

const DISCOVERY_LINK = /^\.(?:claude|cursor)\/skills\/clossys-([^/]+)$/u;

/** The role a discovery link path names, or null when the path is not a discovery link. */
export function discoveryLinkRole(path: string): string | null {
  if (!isSafeRelativePath(path)) return null;
  return DISCOVERY_LINK.exec(path)?.[1] ?? null;
}

/** The file each write-record source writes (code rule C9). */
export const WRITE_RECORD_PATHS: Readonly<Record<WriteRecordSource, string>> = {
  "engagement-brief": BRIEF_PATH,
  "agents-pointer": "AGENTS.md",
  "claude-loader": "CLAUDE.md",
};

/** The setup template acts, each with exactly the files it writes (code rule C9). */
export type TemplateAct = "add-caller-workflow" | "write-starter-request" | "add-ci-template" | "add-path-scope-job";
export const TEMPLATE_PATHS: Readonly<Record<TemplateAct, readonly string[]>> = {
  "add-caller-workflow": [
    ".github/workflows/clossys-adoption-evidence.yml",
    ".github/workflows/clossys-adoption-decision.yml",
    ".github/scripts/clossys-collect-adoption-snapshot.mjs",
  ],
  "write-starter-request": [".starter/request.json"],
  "add-ci-template": [".github/workflows/clossys-ci.yml"],
  "add-path-scope-job": [".github/workflows/clossys-path-scope.yml"],
};

/** For each surface an exempt-release-age item writes: its file, the list key in it, and the package manager that reads it (code rule C12). */
export const EXEMPTION_SURFACES: Readonly<Record<ExemptionSurfaceKind, { readonly path: string; readonly key: string; readonly packageManager: PackageManagerKind }>> = {
  "pnpm-workspace": { path: "pnpm-workspace.yaml", key: "minimumReleaseAgeExclude", packageManager: "pnpm" },
  yarnrc: { path: ".yarnrc.yml", key: "npmPreapprovedPackages", packageManager: "yarn" },
};

/**
 * How a whole file may change (the contract's WRITE KINDS, code rule C15).
 * write: after is not null. link: after is not null, and before is null or
 * equal to it. create-or-edit: after is not null and differs from before.
 * edit: before and after are not null and differ. No act deletes a file.
 */
export type WriteKind = "write" | "link" | "create-or-edit" | "edit";

/** The write kind of each act's whole files; null for an act that writes no whole file. A compose-skills discovery link is a link. */
export const WRITE_KINDS: Readonly<Record<ChangeSetItem["act"], WriteKind | null>> = {
  "write-record": "write",
  "compose-skills": "write",
  "add-caller-workflow": "write",
  "write-starter-request": "write",
  "add-ci-template": "write",
  "add-path-scope-job": "write",
  "exempt-release-age": "create-or-edit",
  "declare-root-entry": "edit",
  install: null,
  "pin-starter": null,
  "write-ledger": null,
};

/** The write kind a whole file at `path` has when `item` names it. */
export function writeKindOf(item: ChangeSetItem, path: string): WriteKind | null {
  if (item.act === "compose-skills" && discoveryLinkRole(path) !== null) return "link";
  return WRITE_KINDS[item.act];
}

/** `sha256:` and the hex SHA-256 of a text's UTF-8 bytes: a file's content digest. */
export function contentDigest(text: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;
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
  root: (root: string): string[] => [root],
  name: (name: string): string[] => [name],
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

/** The rule a bundle check carries when the plan has package acts and no authorization permits them (code rule A4). */
export const AUTHORIZATION_ABSENT = "authorization-absent";

export type ChangeSetRuleId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9" | "C10" | "C11" | "C12" | "C13" | "C14" | "C15" | "C16";
export type ApplyBundleRuleId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";

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

/** Code rules C1-C16 of repository-change-set.json, over a set whose schema already passes. Messages name positions, never values. */
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
  order("refused", set.refused, CANONICAL_KEYS.refusal, true);
  order("deferred", set.deferred, CANONICAL_KEYS.deferral);
  set.files.forEach((file, index) => {
    if (isDerived(file)) order(`files[${index}].invariants`, file.invariants, CANONICAL_KEYS.invariant);
  });
  order("pathAllowList", set.pathAllowList, CANONICAL_KEYS.pattern, true);
  order("observed.releaseAgeSurfaces", set.observed.releaseAgeSurfaces, CANONICAL_KEYS.surface, true);
  order("observed.symlinkedSkillRoots", set.observed.symlinkedSkillRoots, CANONICAL_KEYS.root, true);
  order("observed.linkedAgentsPaths", set.observed.linkedAgentsPaths, CANONICAL_KEYS.name, true);
  if (set.observed.repositoryProfile !== null) {
    order("observed.repositoryProfile.undeclaredRoots", set.observed.repositoryProfile.undeclaredRoots, CANONICAL_KEYS.name, true);
    order("observed.repositoryProfile.prohibitedRoots", set.observed.repositoryProfile.prohibitedRoots, CANONICAL_KEYS.name, true);
  }
  if (set.tooling !== undefined) order("tooling", set.tooling, CANONICAL_KEYS.tool, true);

  // C9
  set.files.forEach((file, index) => {
    if (isDerived(file)) return;
    const role = discoveryLinkRole(file.path);
    if ((file.mode === "120000") !== (role !== null)) push("C9", `files[${index}].mode`, role === null ? "is 120000, which only a discovery link has" : "is not 120000, and this path is a discovery link");
    else if (role !== null && file.after !== null && file.after !== contentDigest(discoveryLinkTarget(role))) push("C9", `files[${index}].after`, "is not the content digest of this discovery link's target");
  });
  const linkedRoots = DISCOVERY_ROOTS.filter((root) => !set.observed.symlinkedSkillRoots.includes(root));
  set.items.forEach((item, index) => {
    const files = set.files.map((file, at) => ({ file, at })).filter(({ file }) => file.item === item.id);
    const refusals = set.refused.map((refusal, at) => ({ refusal, at })).filter(({ refusal }) => refusal.item === item.id);
    const keys = set.keys.filter((key) => key.item === item.id);
    const invariants = set.files.flatMap((file) => (isDerived(file) ? file.invariants.filter((invariant) => isPackageInvariant(invariant) && invariant.item === item.id) : []));
    const at = `items[${index}]`;
    // Every path an item names: a whole file's or a path refusal's; a derived file or a key refusal counts as a name at no path.
    const named = [...files.map(({ file }) => (isDerived(file) ? "" : file.path)), ...refusals.map(({ refusal }) => ("path" in refusal ? refusal.path : ""))];
    const namedExactly = (expected: readonly string[]) => {
      const counts = new Map<string, number>();
      for (const path of named) counts.set(path, (counts.get(path) ?? 0) + 1);
      return keys.length === 0 && named.length === expected.length && new Set(expected).size === expected.length && expected.every((path) => counts.get(path) === 1);
    };
    if (item.act === "write-record") {
      const path = WRITE_RECORD_PATHS[item.source];
      if (!namedExactly([path])) push("C9", at, `must be named by exactly one whole file or path refusal, at ${path}, and by nothing else`);
    } else if (item.act === "compose-skills") {
      for (const { index: repeat, first } of repeats(item.roles, (role) => role)) push("C9", `${at}.roles[${repeat}]`, `repeats roles[${first}]`);
      const roles = [...new Set(item.roles)];
      // A role whose SKILL.md is refused gets no discovery link: a link would expose a skill the flow does not own.
      const written = (role: string) => files.some(({ file }) => !isDerived(file) && file.path === skillPath(role));
      const expected = [...roles.flatMap((role) => [skillPath(role), ...(written(role) ? linkedRoots.map((root) => discoveryLinkPath(root, role)) : [])]), SKILLS_MANIFEST_PATH];
      if (!namedExactly(expected)) {
        push(
          "C9",
          at,
          `must be named, for each role, by exactly one whole file or path refusal at that role's skill path, by one whole file or path refusal at its discovery link under each root not observed as a symbolic link when its skill is a whole file and by none when it is refused, by exactly one at ${SKILLS_MANIFEST_PATH}, and by nothing else`,
        );
      }
    } else if (item.act === "add-caller-workflow" || item.act === "write-starter-request" || item.act === "add-ci-template" || item.act === "add-path-scope-job") {
      if (!namedExactly(TEMPLATE_PATHS[item.act])) push("C9", at, `must be named by exactly one whole file or path refusal at each file an ${item.act} item writes, and by nothing else`);
    } else if (item.act === "exempt-release-age") {
      if (!(keys.length === 0 && named.length <= 1 && named.every((path) => path === item.path))) push("C9", at, "must be named by at most one whole file or path refusal, at its own path, and by nothing else");
    } else if (item.act === "declare-root-entry") {
      if (!namedExactly([item.path])) push("C9", at, "must be named by exactly one whole file or path refusal, at its own path, and by nothing else");
    } else if (item.act === "write-ledger") {
      if (refusals.length > 0) push("C9", at, "is refused, but the ledger is always written");
    } else if (isPackageItem(item)) {
      const pointer = dependencyPointer(item.placement, item.package.name);
      if (item.act === "pin-starter" && item.placement !== "devDependencies") push("C9", `${at}.placement`, "of a pin-starter item must be devDependencies");
      if (files.some(({ file }) => !isDerived(file))) push("C9", at, "is named by a whole file");
      if (refusals.some(({ refusal }) => "path" in refusal)) push("C9", at, "is named by a path refusal");
      const ownPointers = [dependencyPointer("dependencies", item.package.name), dependencyPointer("devDependencies", item.package.name)];
      if (refusals.some(({ refusal }) => "pointer" in refusal && !ownPointers.includes(refusal.pointer))) push("C9", at, "is named by a key refusal for another package");
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
  set.refused.forEach((refusal, index) => {
    if (kinds.get(refusal.item)?.act === "write-ledger") push("C9", `refused[${index}].item`, "names the write-ledger item, which is derived and never refused");
  });
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
  const starters = set.items.map((item, index) => ({ item, index })).filter(({ item }) => item.act === "pin-starter");
  if (starters.length > 1) push("C10", `items[${starters[1]!.index}]`, "is a second pin-starter item; a set pins Starter at most once");
  set.items.forEach((item, index) => {
    if (set.phase === "setup" && item.act === "install") push("C10", `items[${index}]`, "is an install in a setup set, where installs are deferred");
  });
  if (set.phase === "apply") set.deferred.forEach((_, index) => push("C10", `deferred[${index}]`, "is deferred in an apply set, which defers nothing"));

  // C11
  if (set.phase === "setup") {
    const count = (act: ChangeSetItem["act"]) => set.items.filter((item) => item.act === act).length;
    for (const act of ["add-caller-workflow", "write-starter-request", "add-ci-template", "add-path-scope-job", "pin-starter"] as const) {
      const held = count(act);
      if (held !== 1) push("C11", "items", `must hold exactly one ${act} item in a setup set, and holds ${held}`);
    }
    const exempts = count("exempt-release-age");
    const wanted = set.observed.packageManager === "pnpm" || set.observed.packageManager === "yarn" ? 1 : 0;
    if (exempts !== wanted) push("C11", "items", `must hold ${wanted} exempt-release-age item(s) in a setup set for this package manager, and holds ${exempts}`);
  }

  // C12
  set.items.forEach((item, index) => {
    if (item.act !== "exempt-release-age") return;
    const surface = EXEMPTION_SURFACES[item.surface];
    if (item.path !== surface.path) push("C12", `items[${index}].path`, "is not the file of the item's surface");
    if (set.observed.packageManager !== surface.packageManager) push("C12", `items[${index}].surface`, "is not a surface this repository's package manager reads");
    if (item.scope !== PACKAGE_SCOPE.scope) push("C12", `items[${index}].scope`, "is not the publishing scope this package packs");
  });

  // C13
  const profile = set.observed.repositoryProfile;
  const declarers = set.items.map((item, index) => ({ item, index })).filter(({ item }) => item.act === "declare-root-entry");
  if (declarers.length > 1) push("C13", `items[${declarers[1]!.index}]`, "is a second declare-root-entry item");
  const needed =
    profile !== null && (profile.rootVocabulary === "unparseable" || (profile.rootVocabulary === "checked" && (profile.undeclaredRoots.length > 0 || profile.prohibitedRoots.length > 0)));
  if (needed && declarers.length === 0) push("C13", "items", "must hold a declare-root-entry item for the observed repository profile");
  if (!needed) for (const { index } of declarers) push("C13", `items[${index}]`, "is a declare-root-entry item the observed repository profile does not need");
  if (profile !== null) {
    if (profile.rootVocabulary !== "checked" && profile.undeclaredRoots.length + profile.prohibitedRoots.length > 0) {
      push("C13", "observed.repositoryProfile", "lists root names, but its root vocabulary is not checked");
    }
    if (profile.undeclaredRoots.some((name) => profile.prohibitedRoots.includes(name))) push("C13", "observed.repositoryProfile", "lists one root name as both undeclared and prohibited");
    // Only a path the set creates introduces a root name: a refused path is not written, and a key's file or an edited file already exists.
    const roots = new Set(set.files.filter((file) => isDerived(file) || file.before === null).map((file) => file.path.split("/")[0]!));
    for (const [name, list] of [["undeclaredRoots", profile.undeclaredRoots], ["prohibitedRoots", profile.prohibitedRoots]] as const) {
      list.forEach((root, at) => {
        if (!roots.has(root)) push("C13", `observed.repositoryProfile.${name}[${at}]`, "is not the first segment of any path the set creates");
        if (!INTRODUCIBLE_ROOTS.has(root)) push("C13", `observed.repositoryProfile.${name}[${at}]`, "is not a root name an owned pattern can introduce");
      });
    }
  }
  if (profile !== null && needed && declarers.length === 1) {
    const { item, index } = declarers[0]! as { item: Extract<ChangeSetItem, { act: "declare-root-entry" }>; index: number };
    const at = `items[${index}]`;
    if (item.path !== profile.path) push("C13", `${at}.path`, "is not the observed repository profile's path");
    item.entries.forEach((entry, position) => {
      if (!INTRODUCIBLE_ROOTS.has(entry.name)) push("C13", `${at}.entries[${position}].name`, "is not a root name an owned pattern can introduce");
    });
    if (item.entries.length !== profile.undeclaredRoots.length || item.entries.some((entry, position) => entry.name !== profile.undeclaredRoots[position])) {
      push("C13", `${at}.entries`, "do not name exactly the observed undeclared root names, in their order");
    }
    const whole = set.files.find((file) => file.item === item.id && !isDerived(file));
    const refusal = set.refused.find((entry) => entry.item === item.id && "path" in entry);
    const expected = profile.rootVocabulary === "unparseable" ? "root-vocabulary-unknown" : profile.prohibitedRoots.length > 0 ? "root-entry-prohibited" : null;
    if (expected === null) {
      if (whole === undefined) push("C13", at, "must be named by a whole file that edits the profile");
    } else if (refusal === undefined || refusal.reason !== expected) {
      push("C13", at, `must be named by a path refusal with reason ${expected}`);
    }
  }

  // C14
  const linked = set.observed.linkedAgentsPaths;
  const skillRoles = new Set(set.items.flatMap((item) => (item.act === "compose-skills" ? item.roles : [])));
  linked.forEach((path, at) => {
    const role = /^\.agents\/skills\/clossys-(.+)$/u.exec(path)?.[1];
    if (role !== undefined && !skillRoles.has(role)) push("C14", `observed.linkedAgentsPaths[${at}]`, "is a skill directory of no role this set composes");
  });
  const underLink = (path: string) => linked.some((link) => path === link || path.startsWith(`${link}/`));
  const skillPaths = new Set([...skillRoles].map(skillPath));
  set.files.forEach((file, at) => {
    if (skillPaths.has(file.path) && underLink(file.path)) push("C14", `files[${at}].path`, "is written through a symbolic link on the default branch");
  });
  set.refused.forEach((refusal, at) => {
    if (!("path" in refusal)) {
      if (refusal.reason === "skills-root-is-link") push("C14", `refused[${at}].reason`, "is skills-root-is-link on a key, which names no path");
      return;
    }
    const shouldBe = skillPaths.has(refusal.path) && underLink(refusal.path);
    if (shouldBe !== (refusal.reason === "skills-root-is-link")) {
      push("C14", `refused[${at}].reason`, shouldBe ? "is not skills-root-is-link, and this skill lies under a symbolic link" : "is skills-root-is-link, but this path is no skill under a symbolic link");
    }
  });

  // C15: every whole file obeys its item's write kind, checked here and nowhere else.
  set.files.forEach((file, index) => {
    const item = itemsById.get(file.item);
    if (isDerived(file) || item === undefined) return;
    const kind = writeKindOf(item, file.path);
    if (kind === null) return; // an act that writes no whole file: code rule C9 refuses the file
    const at = `files[${index}]`;
    if (file.after === null) {
      push("C15", `${at}.after`, `is null, but a ${kind} never deletes a file`);
      return;
    }
    if (kind === "edit" && file.before === null) push("C15", `${at}.before`, "is null, but an edit changes a file the default branch has");
    if ((kind === "edit" || kind === "create-or-edit") && file.after === file.before) push("C15", `${at}.after`, `equals before, but a ${kind} writes only a change`);
    if (kind === "link" && file.before !== null && file.before !== file.after) push("C15", `${at}.before`, "is another target, but a discovery link is only created or kept");
  });

  // C16: a planItem reaches the public ledger, so it is derived, never free text.
  set.items.forEach((item, index) => {
    if (isPackageItem(item) && item.planItem !== derivedPlanItem(set.repository.id, item.package.name)) push("C16", `items[${index}].planItem`, "is not the repository id, a colon and the package name");
  });
  const prefix = `${set.repository.id}:`;
  set.deferred.forEach((deferral, index) => {
    const name = deferral.planItem.startsWith(prefix) ? deferral.planItem.slice(prefix.length) : "";
    if (!PACKAGE_NAME.test(name)) push("C16", `deferred[${index}].planItem`, "is not the repository id, a colon and a package name");
  });
  return out;
}

const PACKAGE_NAME = /^(?=.{1,214}$)@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;

const PRE_APPLY_CHECKS: readonly ApplyCheckId[] = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"];

/** Code rules A1-A7 of apply-bundle.json, over a bundle whose schema already passes. */
export function applyBundleRuleViolations(bundle: ApplyBundle): RuleViolation<ApplyBundleRuleId>[] {
  const out: RuleViolation<ApplyBundleRuleId>[] = [];
  for (const { index, first } of repeats(bundle.repositories, (entry) => entry.id.toLowerCase())) out.push({ rule: "A1", path: `repositories[${index}].id`, message: `repeats repositories[${first}].id` });
  const computed = bundle.repositories.flatMap((entry) => ("changeSet" in entry ? [{ id: entry.id, changeSetDigest: entry.changeSet }] : []));
  if (bundle.bundleDigest !== bundleDigest(bundle.plan.digest, computed)) out.push({ rule: "A2", path: "bundleDigest", message: "is not the digest of plan.digest and the repositories that have a change set" });
  const mismatch = bundle.authorization !== null && bundle.authorization.planDigest !== bundle.plan.digest;
  // A snapshot is recorded exactly when the plan has package acts (the plan contract's R6), and package acts need an authorization.
  const absent = bundle.snapshot !== null && bundle.authorization === null;
  bundle.repositories.forEach((entry, index) => {
    const expected = entry.checks.length === 0 && !("changeSet" in entry) ? entry.verdict : worstVerdict(entry.checks.map((check) => check.verdict));
    if (entry.verdict !== expected) out.push({ rule: "A3", path: `repositories[${index}].verdict`, message: "is not the worst of its checks' verdicts" });
    const flagged = entry.checks.some((check) => check.check === "V3" && check.verdict === "violated" && check.rule === AUTHORIZATION_PLAN_MISMATCH);
    const carries = entry.checks.some((check) => check.rule === AUTHORIZATION_PLAN_MISMATCH);
    if ("changeSet" in entry && mismatch && !flagged) out.push({ rule: "A4", path: `repositories[${index}].checks`, message: "lacks the violated V3 check for an authorization issued for another plan" });
    if (!mismatch && carries) out.push({ rule: "A4", path: `repositories[${index}].checks`, message: "reports an authorization mismatch the bundle does not have" });
    const flaggedAbsent = entry.checks.some((check) => check.check === "V3" && check.verdict === "violated" && check.rule === AUTHORIZATION_ABSENT);
    const carriesAbsent = entry.checks.some((check) => check.rule === AUTHORIZATION_ABSENT);
    if ("changeSet" in entry && absent && !flaggedAbsent) out.push({ rule: "A4", path: `repositories[${index}].checks`, message: "lacks the violated V3 check for package acts no authorization permits" });
    if (!absent && carriesAbsent) out.push({ rule: "A4", path: `repositories[${index}].checks`, message: "reports a missing authorization the bundle does not lack" });
    if (!("changeSet" in entry)) return;
    const hasState = entry.state !== undefined;
    const hasBinding = entry.binding !== undefined;
    if (bundle.mode === "report") {
      if (hasState) out.push({ rule: "A5", path: `repositories[${index}].state`, message: "is a repository state, which a report bundle never claims" });
      if (hasBinding) out.push({ rule: "A5", path: `repositories[${index}].binding`, message: "is a binding, which a report bundle never records" });
      return;
    }
    const planned = entry.verdict === "satisfied" && hasBinding;
    if (hasState && !planned) out.push({ rule: "A6", path: `repositories[${index}].state`, message: "is planned, but the verdict is not satisfied or no approval binds the change set" });
    if (!hasState && planned) out.push({ rule: "A6", path: `repositories[${index}]`, message: "is satisfied and bound by an approval, so it must be planned" });
    if (hasState && !PRE_APPLY_CHECKS.every((id) => entry.checks.some((check) => check.check === id && check.verdict === "satisfied"))) {
      out.push({ rule: "A6", path: `repositories[${index}].checks`, message: "lacks a satisfied check for each of V1 to V9, which a planned repository needs" });
    }
    const v3 = entry.checks.filter((check) => check.check === "V3");
    const authorityHolds = v3.length > 0 && v3.every((check) => check.verdict === "satisfied");
    if (hasBinding !== authorityHolds) {
      out.push({ rule: "A7", path: `repositories[${index}]${hasBinding ? ".binding" : ""}`, message: hasBinding ? "is recorded, but V3 is missing or not satisfied" : "has V3 satisfied, so it must record the binding V3 found" });
    }
    if (entry.binding?.kind === "admitted") {
      if (entry.phase !== "apply") out.push({ rule: "A7", path: `repositories[${index}].binding`, message: "is admitted, which only an apply set can be" });
      if (entry.binding.setupChangeSet === entry.changeSet) out.push({ rule: "A7", path: `repositories[${index}].binding.setupChangeSet`, message: "is this repository's own change set, not the setup set it follows" });
      if (entry.binding.subjectDigest === bundle.bundleDigest) out.push({ rule: "A7", path: `repositories[${index}].binding.subjectDigest`, message: "is this bundle's own digest, but the approved bundle held the setup set, not this apply set" });
    }
  });
  if (bundle.mode === "planned" && !bundle.plan.committed) out.push({ rule: "A6", path: "plan.committed", message: "must be true in a planned bundle" });
  if (bundle.mode === "planned") {
    const bound = bundle.repositories.flatMap((entry, index) => ("changeSet" in entry && entry.binding !== undefined ? [{ subject: entry.binding.subjectDigest, index }] : []));
    const first = bound[0];
    for (const { subject, index } of bound) {
      if (first !== undefined && subject !== first.subject) out.push({ rule: "A7", path: `repositories[${index}].binding.subjectDigest`, message: `is not the approval repositories[${first.index}] is bound by, and one bundle has one approval` });
    }
    // A plan with package acts has a snapshot; V3 passes for package acts only with a current execution authorization (a plan with none is bound by its decision alone).
    if (first !== undefined && bundle.snapshot !== null && bundle.authorization === null) {
      out.push({ rule: "A7", path: "authorization", message: "is null, but V3 passed for a bound change set of a plan with package acts, which needs a current execution authorization" });
    }
  }
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

/** Every reason a change set is refused: the change-set contract's schema, then, once that passes, its code rules C1-C16. */
export function repositoryChangeSetViolations(value: unknown): ChangeSetViolation[] {
  return violationsOf<RepositoryChangeSet, ChangeSetRuleId>("repository-change-set.json", "changeSet", value, changeSetRuleViolations);
}

/** Every reason a bundle is refused: the bundle contract's schema, then, once that passes, its code rules A1-A7. */
export function applyBundleViolations(value: unknown): ChangeSetViolation[] {
  return violationsOf<ApplyBundle, ApplyBundleRuleId>("apply-bundle.json", "bundle", value, applyBundleRuleViolations);
}

/** Validates a change set against repository-change-set.json and its code rules C1-C16. No reason echoes a value. */
export function validateRepositoryChangeSet(value: unknown): ValidationResult {
  return result(repositoryChangeSetViolations(value));
}

/** Validates a bundle against apply-bundle.json and its code rules A1-A7. No reason echoes a value. */
export function validateApplyBundle(value: unknown): ValidationResult {
  return result(applyBundleViolations(value));
}
