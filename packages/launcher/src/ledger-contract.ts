// The installed-state ledger (issue #1178), validated against the shared
// contract docs/contracts/installed-ledger.json -- in the public repository,
// not shipped in this package. This package's build packs it into
// src/generated/ beside the change-set and bundle contracts, and validates
// it with the same generated copy of the one contract checker. Validation
// makes a ledger well formed, not true: trusting a row needs the hub's
// change sets (see TRUST in the contract), which nothing here reads. Nothing
// in this package writes a ledger yet. The TypeScript types below describe
// the contract's shapes for callers; they validate nothing.

import { AGENTS_GUIDE_PATH, AGENTS_GUIDE_TEXT } from "./agents-guide.js";
import { formatContractViolation, readContractDocument, validateAgainstContract } from "./generated/contract-schema.generated.js";
import {
  EXEMPTION_SURFACES,
  ID_TOKEN,
  INTRODUCIBLE_ROOTS,
  LEDGER_PATH,
  LOCKFILE_NAMES,
  canonicalOrder,
  compareTuples,
  contentDigest,
  derivedPlanItem,
  dependencyPointer,
  discoveryLinkRole,
  matchesPathPattern,
  existingDeclarationVersionMatches,
} from "./change-set-contract.js";
import type { ApprovalBinding, ExistingDeclarationAdoption, ChangeSetPhase, DependencyPlacement, RepositoryChangeSet } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import { loadContract } from "./plan-contract.js";
import type { ValidationResult } from "./plan-contract.js";

/** The digest of the Launcher guide's bytes: the only after an apply-phase add of the guide may carry (RENDER and S3). */
const AGENTS_GUIDE_DIGEST = contentDigest(AGENTS_GUIDE_TEXT);

/** One generation: the change set that wrote it, and on what authority. */
export interface LedgerHistoryEntry {
  readonly generation: number;
  readonly changeSet: string;
  readonly phase: ChangeSetPhase;
  readonly planDigest: string;
  readonly bundle: string;
  readonly baseCommit: string;
  readonly binding: ApprovalBinding;
}

/** A whole file the flow wrote and still owns. */
export interface LedgerFileRow {
  readonly path: string;
  readonly mode: "100644" | "120000";
  readonly after: string;
  readonly changeSet: string;
}

/** A package.json key the flow wrote. */
export interface LedgerKeyRow {
  readonly file: "package.json";
  readonly pointer: string;
  readonly value: string;
  readonly changeSet: string;
}

/** An entry the flow added to a release-age exemption list, or to a Controller profile's root vocabulary. */
export type LedgerEntryRow =
  | { readonly file: "pnpm-workspace.yaml"; readonly key: "minimumReleaseAgeExclude"; readonly value: string; readonly changeSet: string }
  | { readonly file: ".yarnrc.yml"; readonly key: "npmPreapprovedPackages"; readonly value: string; readonly changeSet: string }
  | { readonly file: string; readonly key: "rootEntries"; readonly value: string; readonly changeSet: string };

/** One exact package identity, as a package act names it. */
export interface LedgerPackageIdentity {
  readonly planItem: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly placement: DependencyPlacement;
}

/** A package act in effect. */
export interface LedgerPackageRow extends LedgerPackageIdentity {
  readonly act: "install" | "pin-starter";
  readonly changeSet: string;
}

/** An install the latest setup set deferred, with the plan's identity for it. */
export interface LedgerDeferredRow extends LedgerPackageIdentity {
  readonly act: "install";
  readonly reason: "after-setup";
  readonly changeSet: string;
}

/** clossys/.state/installed.json (installed-ledger.json, in the public repository, not shipped in this package). */
export interface InstalledLedger {
  readonly existingDeclarationAdoptions?: readonly (ExistingDeclarationAdoption & {readonly changeSet: string})[];
  readonly schemaVersion: 1;
  readonly kind: "clossys.installed-ledger";
  readonly repository: { readonly id: string; readonly nodeId: string };
  readonly generation: number;
  readonly history: readonly LedgerHistoryEntry[];
  readonly files: readonly LedgerFileRow[];
  readonly keys: readonly LedgerKeyRow[];
  readonly entries: readonly LedgerEntryRow[];
  readonly packages: readonly LedgerPackageRow[];
  readonly deferred: readonly LedgerDeferredRow[];
}

export type LedgerRuleId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" | "L10";
export type LedgerSuccessionRuleId = "S2" | "S3";

/** One reason a ledger, or a pair of ledgers, is refused: `rule` is "schema" for the contract's keywords, "bytes" for text that is not a ledger's exact bytes, else the rule's id. */
export interface LedgerViolation {
  readonly rule: "schema" | "bytes" | LedgerRuleId | LedgerSuccessionRuleId;
  /** In a succession, which ledger breaks a contract rule; absent for S2 and S3, which relate the two. */
  readonly side?: "base" | "head";
  readonly path: string;
  readonly message: string;
}

interface RuleViolation {
  readonly rule: LedgerRuleId | LedgerSuccessionRuleId;
  readonly path: string;
  readonly message: string;
}

const CONTRACT = "installed-ledger.json";

/** The owned path patterns, read from the packed ledger contract. */
const OWNED_PATTERNS: readonly string[] = (() => {
  const definitions = loadContract(CONTRACT).definitions as Record<string, { enum?: unknown }> | undefined;
  const list = definitions?.ownedPattern?.enum;
  if (!Array.isArray(list) || !list.every((entry) => typeof entry === "string")) throw new Error("the packed ledger contract has no ownedPattern list");
  return list as string[];
})();

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

/** Whether two JSON values are equal member for member, whatever their members' order. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    const other = right as readonly unknown[];
    return left.length === other.length && left.every((value, index) => sameValue(value, other[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

const IDENTITY: readonly (keyof LedgerPackageIdentity | "act")[] = ["planItem", "act", "name", "version", "integrity", "placement"];

/** Code rules L1-L10 of installed-ledger.json, over a ledger whose schema already passes. Messages name positions, never values. */
export function ledgerRuleViolations(ledger: InstalledLedger): RuleViolation[] {
  const out: RuleViolation[] = [];
  const push = (rule: LedgerRuleId, path: string, message: string) => out.push({ rule, path, message });
  const { history } = ledger;

  // L1
  if (ledger.generation < 1 || ledger.generation !== history.length) push("L1", "generation", "must be 1 or more and equal the number of history entries");
  history.forEach((entry, index) => {
    if (entry.generation !== index + 1) push("L1", `history[${index}].generation`, "is not its position plus 1");
  });

  // L2
  for (const { index, first } of repeats(history, (entry) => entry.changeSet)) push("L2", `history[${index}].changeSet`, `repeats history[${first}].changeSet`);

  // L3
  history.forEach((entry, index) => {
    const at = `history[${index}].binding`;
    const { binding } = entry;
    if (entry.phase === "setup" && binding.kind !== "approved") {
      push("L3", at, "is not approved, and a setup entry's binding must be");
      return;
    }
    // An approved binding's subjectDigest may differ from the entry's bundle: bundle is the run that computed the set, subjectDigest the approval.
    if (binding.kind === "approved") return;
    const previous = index > 0 ? history[index - 1] : undefined;
    if (previous === undefined) {
      push("L3", at, "is admitted, but no setup entry comes before it");
      return;
    }
    if (previous.changeSet !== binding.setupChangeSet) push("L3", `${at}.setupChangeSet`, "is not the change set of the entry before it");
    if (previous.phase !== "setup" || previous.binding.kind !== "approved") push("L3", at, "is admitted, but the entry before it is not an approved setup entry");
    if (previous.planDigest !== entry.planDigest) push("L3", `history[${index}].planDigest`, "is not the plan digest of the setup entry it follows");
    if (previous.binding.subjectDigest !== binding.subjectDigest) push("L3", `${at}.subjectDigest`, "is not the approved subject of the setup entry it follows");
  });

  // L4
  const written = new Set(history.map((entry) => entry.changeSet));
  const rowArrays: [string, readonly { readonly changeSet: string }[]][] = [
    ["files", ledger.files],
    ["keys", ledger.keys],
    ["entries", ledger.entries],
    ["packages", ledger.packages],
    ["deferred", ledger.deferred],
  ];
  for (const [name, rows] of rowArrays) {
    rows.forEach((row, index) => {
      if (!written.has(row.changeSet)) push("L4", `${name}[${index}].changeSet`, "names no history entry's change set");
    });
  }
  const last = history.at(-1);
  if (last !== undefined) {
    ledger.deferred.forEach((row, index) => {
      if (written.has(row.changeSet) && row.changeSet !== last.changeSet) push("L4", `deferred[${index}].changeSet`, "is not the latest history entry's change set");
    });
    if (last.phase === "apply" && ledger.deferred.length > 0) push("L4", "deferred", "must be empty after an apply generation");
  }

  // L5
  ledger.files.forEach((row, index) => {
    const at = `files[${index}]`;
    const lowered = row.path.toLowerCase();
    if (lowered === LEDGER_PATH.toLowerCase() || lowered === "package.json" || LOCKFILE_NAMES.includes(lowered)) push("L5", `${at}.path`, "is the ledger, package.json or a lockfile, which no files row names");
    else if (!OWNED_PATTERNS.some((pattern) => matchesPathPattern(row.path, pattern))) push("L5", `${at}.path`, "is not matched by any owned pattern");
    const role = discoveryLinkRole(row.path) ?? /^\.agents\/skills\/clossys-([^/]+)\//u.exec(row.path)?.[1];
    if (role !== undefined && !ID_TOKEN.test(role)) push("L5", `${at}.path`, "names a role that is not a lowercase id token");
    const link = discoveryLinkRole(row.path) !== null;
    if ((row.mode === "120000") !== link) push("L5", `${at}.mode`, link ? "is not 120000, and this path is a discovery link" : "is 120000, which only a discovery link has");
  });

  // L6
  ledger.keys.forEach((row, index) => {
    const owners = ledger.packages.filter((pkg) => dependencyPointer(pkg.placement, pkg.name) === row.pointer);
    if (owners.length !== 1) push("L6", `keys[${index}].pointer`, "does not name exactly one packages row");
    else if (owners[0]!.version !== row.value) push("L6", `keys[${index}].value`, "is not the version of the package it names");
  });

  // L7
  if (ledger.existingDeclarationAdoptions !== undefined) {
    const setup = ledger.history[0];
    // Setup and its immediate apply protect the live desired identity. A later
    // generation retains that consent as evidence of an earlier apply.
    const appliedBefore = ledger.history.slice(1, -1).some((entry, index) =>
      entry.phase === "apply" && entry.generation === index + 2);
    const rows = ledger.existingDeclarationAdoptions;
    if (new Set(rows.map(row => row.name)).size !== rows.length) push("L7", "existingDeclarationAdoptions", "repeat a package");
    rows.forEach((row,index) => {
      const desired = [...ledger.packages, ...ledger.deferred].find(pkg => pkg.planItem === row.desired.planItem);
      if (!setup || setup.phase !== "setup" || setup.binding.kind !== "approved" || row.changeSet !== setup.changeSet || row.observedBaseCommit !== setup.baseCommit || !existingDeclarationVersionMatches(row.beforeVersion,row.beforeResolved.version) || row.name !== row.beforeResolved.name || row.name !== row.desired.name || row.placement !== row.desired.placement || row.desired.planItem !== `${ledger.repository.id}:${row.name}` || (!appliedBefore && (!desired || !["name","version","integrity","placement","act"].every(key => desired[key as keyof typeof desired] === row.desired[key as keyof typeof row.desired])))) push("L4", `existingDeclarationAdoptions[${index}]`, "do not match protected setup and desired identity");
    });
  }
  const acts = [...ledger.packages.map((row, index) => ({ row, path: `packages[${index}]` })), ...ledger.deferred.map((row, index) => ({ row, path: `deferred[${index}]` }))];
  // A repeated planItem is a repeated name: L10 derives each planItem from its name.
  for (const { index, first } of repeats(acts, (entry) => entry.row.name)) push("L7", `${acts[index]!.path}.name`, `repeats ${acts[first]!.path}.name`);

  // L8
  const order = <T>(name: string, rows: readonly T[], key: (row: T) => readonly string[]) => {
    for (let index = 1; index < rows.length; index += 1) {
      if (compareTuples(key(rows[index - 1]!), key(rows[index]!)) >= 0) {
        push("L8", `${name}[${index}]`, "is out of canonical order, or repeats the entry before it");
        return;
      }
    }
  };
  order("files", ledger.files, (row) => [row.path]);
  for (const { index, first } of repeats(ledger.files, (row) => row.path.toLowerCase())) push("L8", `files[${index}].path`, `repeats files[${first}].path, compared case-insensitively`);
  order("keys", ledger.keys, (row) => [row.file, row.pointer]);
  order("entries", ledger.entries, (row) => [row.file, row.key, row.value]);
  order("packages", ledger.packages, (row) => [row.planItem]);
  order("deferred", ledger.deferred, (row) => [row.planItem]);

  // L9
  const profileRows = ledger.entries.map((row, index) => ({ row, index })).filter(({ row }) => row.key === "rootEntries");
  const profileFile = profileRows[0]?.row.file;
  for (const { row, index } of profileRows) {
    if (row.file !== profileFile) push("L9", `entries[${index}].file`, "is a second Controller profile, and the flow edits one");
    if (!INTRODUCIBLE_ROOTS.has(row.value)) push("L9", `entries[${index}].value`, "is not a root name an owned pattern can introduce");
  }

  // L10: a planItem is derived from this repository's id and the package, never free text.
  for (const [name, rows] of [["packages", ledger.packages], ["deferred", ledger.deferred]] as const) {
    rows.forEach((row, index) => {
      if (row.planItem !== derivedPlanItem(ledger.repository.id, row.name)) push("L10", `${name}[${index}].planItem`, "is not repository.id, a colon and the row's name");
    });
  }
  return out;
}

function contractViolations(value: unknown, label: string, side?: "base" | "head"): LedgerViolation[] {
  const where = side === undefined ? {} : { side };
  const schema = validateAgainstContract(loadContract(CONTRACT), value, loadContract);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", ...where, path: violation.path, message: formatContractViolation(label, violation) }));
  return ledgerRuleViolations(value as InstalledLedger).map((violation) => ({
    ...violation,
    ...where,
    message: `${label}.${violation.path} ${violation.message} (rule ${violation.rule})`,
  }));
}

/** Every reason a ledger is refused: the ledger contract's schema, then, once that passes, its code rules L1-L10. */
export function installedLedgerViolations(value: unknown): LedgerViolation[] {
  return contractViolations(value, "ledger");
}

/** Validates a ledger against installed-ledger.json and its code rules L1-L10. A valid ledger is well formed, not trusted. No reason echoes a value. */
export function validateInstalledLedger(value: unknown): ValidationResult {
  const violations = installedLedgerViolations(value);
  if (violations.length === 0) return { valid: true };
  return { valid: false, reason: violations.map((violation) => violation.message).join("; ") };
}

/**
 * What a pull request's head ledger does to its base's. `change` is none only
 * when both are valid, exactly canonical, and byte for byte the same.
 * `admission` says what was proved about a next generation that breaks no
 * rule: admitted when it is admitted and S3 held; approval-claimed when it is
 * bound approved, which a reader without the hub cannot authenticate, so it
 * is a claim, never an admission or a pass; null for no change, or when any
 * rule refuses the pair.
 */
export interface LedgerSuccession {
  readonly change: "none" | "next-generation";
  readonly admission: "admitted" | "approval-claimed" | null;
  readonly violations: readonly LedgerViolation[];
}

function successionRuleViolations(base: InstalledLedger | null, head: InstalledLedger): RuleViolation[] {
  const out: RuleViolation[] = [];
  const push = (rule: LedgerSuccessionRuleId, path: string, message: string) => out.push({ rule, path, message });

  // S2
  if (base !== null && !sameValue(head.repository, base.repository)) push("S2", "head.repository", "is not the base ledger's repository");
  // head.generation is base.generation plus 1 exactly when this holds, because L1 ties each ledger's generation to its history's length.
  if (!sameValue(head.history.slice(0, -1), base?.history ?? [])) push("S2", "head.history", "does not keep the base ledger's history unchanged before its last entry, or is not one generation past it");

  // S3
  const last = head.history.at(-1)!;
  if (last.binding.kind !== "admitted") return out;
  const at = `head.history[${head.history.length - 1}].binding`;
  if (base === null) {
    push("S3", at, "is admitted, but the base has no ledger holding the setup it follows");
    return out;
  }
  // Already proved: L3 on the head makes the entry before an admitted one its approved setup entry, and S2 makes that entry the base's latest;
  if (!sameValue(base.existingDeclarationAdoptions, head.existingDeclarationAdoptions)) push("S3", "head.existingDeclarationAdoptions", "change protected adoption consent");
  // L3 makes an admitted entry an apply entry, and L4 leaves no deferred row after one.
  // The one file an admitted generation may add: the Launcher guide, for an install set up before it existed. Its row is the only change to
  // the files, is written by this generation, holds the guide's own bytes, and so the base holds none at that path (L8 forbids a repeat in
  // any letter case).
  const addedFiles = head.files.filter((row) => !base.files.some((other) => sameValue(other, row)));
  const droppedFiles = base.files.filter((row) => !head.files.some((other) => sameValue(other, row)));
  const guideAdded =
    droppedFiles.length === 0 &&
    addedFiles.length === 1 &&
    addedFiles[0]!.path === AGENTS_GUIDE_PATH &&
    addedFiles[0]!.mode === "100644" &&
    addedFiles[0]!.after === AGENTS_GUIDE_DIGEST &&
    addedFiles[0]!.changeSet === last.changeSet;
  if (addedFiles.length + droppedFiles.length > 0 && !guideAdded) push("S3", "head.files", "differ from the base ledger's, and an admitted generation changes no file but may add the guide's");
  if (!sameValue(head.entries, base.entries)) push("S3", "head.entries", "differ from the base ledger's, and an admitted generation changes no entry");
  const kept = <T>(rows: readonly T[], from: readonly T[]) => from.every((row) => rows.some((other) => sameValue(other, row)));
  if (!kept(head.keys, base.keys)) push("S3", "head.keys", "drop or change a key row the base ledger has");
  if (!kept(head.packages, base.packages)) push("S3", "head.packages", "drop or change a package row the base ledger has");
  const added = head.packages.filter((row) => !base.packages.some((other) => sameValue(other, row)));
  const matchesDeferral = (row: LedgerPackageRow, deferral: LedgerDeferredRow) =>
    IDENTITY.every((member) => row[member] === deferral[member]) && row.changeSet === last.changeSet;
  const exact = added.length === base.deferred.length && base.deferred.every((deferral) => added.filter((row) => matchesDeferral(row, deferral)).length === 1);
  if (!exact) push("S3", "head.packages", "add something other than exactly the installs the base ledger's setup deferred");
  const addedKeys = head.keys.filter((row) => !base.keys.some((other) => sameValue(other, row)));
  const keyed = (row: LedgerKeyRow) =>
    row.changeSet === last.changeSet && added.some((pkg) => dependencyPointer(pkg.placement, pkg.name) === row.pointer && pkg.version === row.value);
  if (!addedKeys.every(keyed)) push("S3", "head.keys", "add a key row that is not for an install the base ledger's setup deferred");
  return out;
}

/**
 * Reads one side's ledger from its bytes: decoded with the strict
 * `readContractDocument()` (refuses a byte order mark, invalid UTF-8, a
 * syntax error and a repeated key by position), then valid under the
 * contract, then compared byte for byte with `serializeInstalledLedger()`'s
 * own re-encoding of it. A caller's decode is never trusted: the bytes prove
 * themselves. Any argument that is not a `Uint8Array` is refused under rule
 * `bytes` before anything reads it.
 */
function readLedgerBytes(input: unknown, side: "base" | "head"): { ledger: InstalledLedger | null; violations: LedgerViolation[] } {
  const refuse = (message: string) => ({ ledger: null, violations: [{ rule: "bytes" as const, side, path: "", message: `${side} ${message} (rule bytes)` }] });
  if (!(input instanceof Uint8Array)) return refuse("is not a ledger's bytes as a Uint8Array");
  let parsed: unknown;
  try {
    parsed = readContractDocument(input);
  } catch {
    return refuse("is not a ledger's exact bytes: not strict UTF-8 JSON, with no byte order mark and no repeated key");
  }
  const violations = contractViolations(parsed, side, side);
  if (violations.length > 0) return { ledger: null, violations };
  const rendered = Buffer.from(serializeInstalledLedger(parsed as InstalledLedger), "utf8");
  if (!rendered.equals(Buffer.from(input))) return refuse("is not the exact bytes the ledger contract's RENDER section gives this ledger");
  return { ledger: parsed as InstalledLedger, violations: [] };
}

/**
 * Reads a ledger from the exact bytes of clossys/.state/installed.json: the
 * ledger when the bytes are valid under the contract and exactly the bytes
 * RENDER gives it, else null. A repeated key, a byte order mark, invalid
 * UTF-8, other spacing or member order, or any schema or code-rule refusal
 * gives null, never a partial ledger; a non-`Uint8Array` argument also gives
 * null. Well formed is not trusted: see TRUST in the contract.
 */
export function readInstalledLedger(bytes: Uint8Array): InstalledLedger | null {
  return readLedgerBytes(bytes, "head").ledger;
}

/**
 * Compares a pull request's head ledger with its base's, each given as the
 * exact bytes of clossys/.state/installed.json (base null when the base has
 * none), under the ledger contract's SUCCESSION rules. Each side must be a
 * `Uint8Array`, valid and exactly canonical, or only those reasons are
 * returned: a repeated key, a byte order mark, invalid UTF-8 or a second
 * spelling is never read as an unchanged ledger, and two sides that decode to
 * the same replacement text but differ in their actual bytes are never
 * folded together, because each side is read from its own bytes independently.
 * Then the head is either byte-identical to the base, or one next generation
 * that keeps the base's history; and when that generation is admitted, it
 * installs exactly what the base's setup deferred and changes no other row.
 * An approved next generation is reported as approval-claimed: an
 * unauthenticated claim, never an admission. It checks what the ledgers
 * claim, not the files: whether the tree matches the head ledger is a
 * separate check.
 */
export function ledgerSuccession(baseBytes: Uint8Array | null, headBytes: Uint8Array): LedgerSuccession {
  const base = baseBytes === null ? { ledger: null, violations: [] } : readLedgerBytes(baseBytes, "base");
  const head = readLedgerBytes(headBytes, "head");
  const invalid = [...base.violations, ...head.violations];
  if (invalid.length > 0 || head.ledger === null) return { change: "next-generation", admission: null, violations: invalid };
  if (baseBytes !== null && Buffer.from(baseBytes).equals(Buffer.from(headBytes))) return { change: "none", admission: null, violations: [] };
  const violations = successionRuleViolations(base.ledger, head.ledger).map((violation) => ({
    ...violation,
    message: `${violation.path} ${violation.message} (rule ${violation.rule})`,
  }));
  if (violations.length > 0) return { change: "next-generation", admission: null, violations };
  const admitted = head.ledger.history.at(-1)!.binding.kind === "admitted";
  return { change: "next-generation", admission: admitted ? "admitted" : "approval-claimed", violations: [] };
}

/** Every object's members, in the order installed-ledger.json declares them (RENDER). */
export const LEDGER_MEMBER_ORDER = {
  ledger: ["schemaVersion", "kind", "repository", "generation", "history", "files", "keys", "entries", "packages", "deferred", "existingDeclarationAdoptions"],
  repository: ["id", "nodeId"],
  history: ["generation", "changeSet", "phase", "planDigest", "bundle", "baseCommit", "binding"],
  approvedBinding: ["kind", "subjectDigest"],
  admittedBinding: ["kind", "subjectDigest", "setupChangeSet"],
  file: ["path", "mode", "after", "changeSet"],
  key: ["file", "pointer", "value", "changeSet"],
  entry: ["file", "key", "value", "changeSet"],
  package: ["planItem", "act", "name", "version", "integrity", "placement", "changeSet"],
  deferred: ["planItem", "act", "name", "version", "integrity", "placement", "reason", "changeSet"],
} as const;

function ordered(value: object, members: readonly string[]): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return Object.fromEntries(members.map((member) => [member, record[member]]));
}

/**
 * The exact bytes of a ledger, as the contract's RENDER section defines
 * them: every object's members in the contract's declared order, two-space
 * JSON and one line feed. Throws, naming positions only, when the ledger is
 * refused, so no refused ledger ever gets bytes.
 */
export function serializeInstalledLedger(ledger: InstalledLedger): string {
  const violations = installedLedgerViolations(ledger);
  if (violations.length > 0) throw new TypeError(`a refused ledger has no bytes: ${violations.map((violation) => violation.message).join("; ")}`);
  const order = LEDGER_MEMBER_ORDER;
  const canonical = {
    ...ordered(ledger, order.ledger),
    repository: ordered(ledger.repository, order.repository),
    history: ledger.history.map((entry) => ({
      ...ordered(entry, order.history),
      binding: ordered(entry.binding, entry.binding.kind === "approved" ? order.approvedBinding : order.admittedBinding),
    })),
    files: ledger.files.map((row) => ordered(row, order.file)),
    keys: ledger.keys.map((row) => ordered(row, order.key)),
    entries: ledger.entries.map((row) => ordered(row, order.entry)),
    packages: ledger.packages.map((row) => ordered(row, order.package)),
    deferred: ledger.deferred.map((row) => ordered(row, order.deferred)),
    ...(ledger.existingDeclarationAdoptions !== undefined ? {existingDeclarationAdoptions: ledger.existingDeclarationAdoptions.map(row => ({
      file: row.file, placement: row.placement, name: row.name, beforeVersion: row.beforeVersion,
      beforeResolved: {name:row.beforeResolved.name, version:row.beforeResolved.version, integrity:row.beforeResolved.integrity},
      desired: {name:row.desired.name, version:row.desired.version, integrity:row.desired.integrity, planItem:row.desired.planItem, act:row.desired.act, placement:row.desired.placement},
      observedBaseCommit:row.observedBaseCommit, consent:row.consent, changeSet:row.changeSet, desiredSnapshotDigest:row.desiredSnapshotDigest,
    }))} : {}),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/** Whether a change-set file entry is a whole file (not derived): the digest section's own test for the same distinction. */
function isWholeFile(file: RepositoryChangeSet["files"][number]): file is Extract<typeof file, { readonly before: string | null; readonly after: string | null }> {
  return !("derived" in file);
}

const sameIdentity = (left: LedgerPackageRow, right: LedgerPackageRow): boolean =>
  left.planItem === right.planItem && left.act === right.act && left.name === right.name && left.version === right.version && left.integrity === right.integrity && left.placement === right.placement;

/**
 * The installed-state ledger a change set with digest `set.changeSetDigest`
 * and binding `binding` writes over `previous` (null at generation 0):
 * installed-ledger.json's RENDER section. Returns
 * serializeInstalledLedger(ledger)'s bytes, so a result that fails the
 * contract or its code rules throws before it is returned rather than being
 * handed back malformed. `planPackages` gives the plan's identity for each
 * planItem, which a deferred row needs since a change set's own deferral
 * carries none. Throws a TypeError, naming only positions, never values,
 * when: `set.changeSetDigest` is not this change set's own digest;
 * `set.ledger.generation` is not previous's generation (0 with no
 * previous); previous's repository differs from the set's; a deferred
 * row's planItem names no plan package; an apply set keeps a whole file
 * (before equal to after) at a path previous holds no row for, which would
 * be an adoption row and only a setup set may adopt one; or an apply set
 * writes a whole file whose before does not match previous's after at that
 * path, or at a path previous holds no row for. The one apply-phase add is
 * the Launcher guide (AGENTS_GUIDE_PATH, mode 100644, before null, after the
 * digest of AGENTS_GUIDE_TEXT) over a previous ledger that holds no row for
 * the path in any letter case: the row is written like any other. An add at
 * any other path, or of other bytes, still throws.
 */
export function renderInstalledLedger(
  previous: InstalledLedger | null,
  set: RepositoryChangeSet,
  binding: ApprovalBinding,
  planPackages: readonly (LedgerPackageIdentity & { readonly act: "install" | "pin-starter" })[],
): string {
  const digest = changeSetDigest(set);
  if (set.changeSetDigest !== digest) throw new TypeError("set.changeSetDigest is not this change set's own digest");
  const d = digest;

  const baseGeneration = previous?.generation ?? 0;
  if (set.ledger.generation !== baseGeneration) throw new TypeError("set.ledger.generation does not match previous's generation");
  if (previous !== null && (previous.repository.id !== set.repository.id || previous.repository.nodeId !== set.repository.nodeId)) {
    throw new TypeError("previous.repository is not the set's repository");
  }

  const generation = set.ledger.generation + 1;
  const history: LedgerHistoryEntry[] = [
    ...(previous?.history ?? []),
    { generation, changeSet: d, phase: set.phase, planDigest: set.planDigest, bundle: set.bundle, baseCommit: set.repository.baseCommit, binding },
  ];

  // files: previous's rows, then each whole file of the set (a derived file, the ledger or the lockfile, is skipped).
  const filesByPath = new Map<string, LedgerFileRow>();
  for (const row of previous?.files ?? []) filesByPath.set(row.path.toLowerCase(), row);
  set.files.forEach((file, index) => {
    if (!isWholeFile(file)) return;
    const key = file.path.toLowerCase();
    if (file.after === null) {
      filesByPath.delete(key);
      return;
    }
    const existing = filesByPath.get(key);
    const isKeep = file.before === file.after;
    if (isKeep && existing !== undefined && existing.after === file.after) return; // unchanged: previous's row already holds this after
    if (isKeep && set.phase === "apply") throw new TypeError(`files[${index}] keeps a file previous holds no row for, which only a setup set may adopt`);
    // The one apply-phase add: the Launcher guide's own bytes, for an install set up before it existed, where previous holds no row at its
    // path. A row at that path that is not 100644 would also fail the output's own validation (L5) below.
    const guideAdd =
      previous !== null && file.path === AGENTS_GUIDE_PATH && file.before === null && file.mode === "100644" && file.after === AGENTS_GUIDE_DIGEST && existing === undefined;
    if (set.phase === "apply" && !isKeep && !guideAdd && (existing === undefined || existing.after !== file.before)) {
      throw new TypeError(`files[${index}] has no matching previous row for an apply update`);
    }
    filesByPath.set(key, { path: file.path, mode: file.mode, after: file.after, changeSet: d });
  });
  const files = canonicalOrder([...filesByPath.values()], (row) => [row.path]);

  // keys: previous's rows, then each key of the set.
  const keysByPointer = new Map<string, LedgerKeyRow>();
  for (const row of previous?.keys ?? []) keysByPointer.set(row.pointer, row);
  for (const key of set.keys) {
    if (key.after === null) keysByPointer.delete(key.pointer);
    else keysByPointer.set(key.pointer, { file: "package.json", pointer: key.pointer, value: key.after, changeSet: d });
  }
  const keys = canonicalOrder([...keysByPointer.values()], (row) => [row.file, row.pointer]);

  // entries: previous's rows, then one row per exempt-release-age item and per declare-root-entry entry the set adds, unless a path refusal names the item.
  const entries: LedgerEntryRow[] = [...(previous?.entries ?? [])];
  const hasEntry = (file: string, entryKey: string, value: string) => entries.some((row) => row.file === file && row.key === entryKey && row.value === value);
  const pathRefused = (path: string) => set.refused.some((refusal) => "path" in refusal && refusal.path === path);
  for (const item of set.items) {
    if (item.act === "exempt-release-age") {
      if (pathRefused(item.path)) continue;
      const value = `${item.scope}/*`;
      if (hasEntry(item.path, EXEMPTION_SURFACES[item.surface].key, value)) continue;
      entries.push(
        item.surface === "pnpm-workspace"
          ? { file: "pnpm-workspace.yaml", key: "minimumReleaseAgeExclude", value, changeSet: d }
          : { file: ".yarnrc.yml", key: "npmPreapprovedPackages", value, changeSet: d },
      );
    } else if (item.act === "declare-root-entry") {
      if (pathRefused(item.path)) continue;
      for (const entry of item.entries) {
        if (!hasEntry(item.path, "rootEntries", entry.name)) entries.push({ file: item.path, key: "rootEntries", value: entry.name, changeSet: d });
      }
    }
  }
  const orderedEntries = canonicalOrder(entries, (row) => [row.file, row.key, row.value]);

  // packages: previous's rows, then each install or pin-starter item, unless a key refusal names its item.
  let packages: LedgerPackageRow[] = [...(previous?.packages ?? [])];
  const keyRefused = (itemId: string) => set.refused.some((refusal) => "pointer" in refusal && refusal.item === itemId);
  for (const item of set.items) {
    if (item.act !== "install" && item.act !== "pin-starter") continue;
    if (keyRefused(item.id)) continue;
    const newRow: LedgerPackageRow = {
      planItem: item.planItem,
      act: item.act,
      name: item.package.name,
      version: item.package.version,
      integrity: item.package.integrity,
      placement: item.placement,
      changeSet: d,
    };
    const matched = packages.filter((row) => row.planItem === newRow.planItem || row.name === newRow.name);
    packages = packages.filter((row) => row.planItem !== newRow.planItem && row.name !== newRow.name);
    const identical = matched.find((row) => sameIdentity(row, newRow));
    packages.push(identical ?? newRow);
  }
  const orderedPackages = canonicalOrder(packages, (row) => [row.planItem]);

  // deferred: exactly the set's deferred, with the plan's identity for each planItem.
  const deferred: LedgerDeferredRow[] = set.deferred.map((deferral, index) => {
    const identity = planPackages.find((candidate) => candidate.planItem === deferral.planItem);
    if (identity === undefined) throw new TypeError(`deferred[${index}].planItem names no plan package identity`);
    return {
      planItem: identity.planItem,
      act: "install",
      name: identity.name,
      version: identity.version,
      integrity: identity.integrity,
      placement: identity.placement,
      reason: deferral.reason,
      changeSet: d,
    };
  });
  const orderedDeferred = canonicalOrder(deferred, (row) => [row.planItem]);

  const ledger: InstalledLedger = {
    schemaVersion: 1,
    kind: "clossys.installed-ledger",
    repository: { id: set.repository.id, nodeId: set.repository.nodeId },
    generation,
    history,
    files,
    keys,
    entries: orderedEntries,
    packages: orderedPackages,
    deferred: orderedDeferred,
    ...(set.phase === "setup" && set.existingDeclarationAdoptions !== undefined ? {existingDeclarationAdoptions: set.existingDeclarationAdoptions.map(row => ({...row, changeSet:d}))} : previous?.existingDeclarationAdoptions !== undefined ? {existingDeclarationAdoptions: previous.existingDeclarationAdoptions} : {}),
  };
  return serializeInstalledLedger(ledger);
}
