// The installed-state ledger (issue #1178), validated against the shared
// contract docs/contracts/installed-ledger.json -- in the public repository,
// not shipped in this package. This package's build packs it into
// src/generated/ beside the change-set and bundle contracts, and validates
// it with the same generated copy of the one contract checker. Validation
// makes a ledger well formed, not true: trusting a row needs the hub's
// change sets (see TRUST in the contract), which nothing here reads. Nothing
// in this package writes a ledger yet. The TypeScript types below describe
// the contract's shapes for callers; they validate nothing.

import { formatContractViolation, validateAgainstContract } from "./generated/contract-schema.generated.js";
import { LEDGER_PATH, LOCKFILE_NAMES, compareTuples, dependencyPointer, discoveryLinkRole, matchesPathPattern } from "./change-set-contract.js";
import type { ApprovalBinding, ChangeSetPhase, DependencyPlacement } from "./change-set-contract.js";
import { loadPackedContract } from "./plan-contract.js";
import type { ValidationResult } from "./plan-contract.js";

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

export type LedgerRuleId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8";
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
  const definitions = loadPackedContract(CONTRACT).definitions as Record<string, { enum?: unknown }> | undefined;
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

/** Code rules L1-L8 of installed-ledger.json, over a ledger whose schema already passes. Messages name positions, never values. */
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
  const acts = [...ledger.packages.map((row, index) => ({ row, path: `packages[${index}]` })), ...ledger.deferred.map((row, index) => ({ row, path: `deferred[${index}]` }))];
  for (const { index, first } of repeats(acts, (entry) => entry.row.planItem)) push("L7", `${acts[index]!.path}.planItem`, `repeats ${acts[first]!.path}.planItem`);
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
  return out;
}

function contractViolations(value: unknown, label: string, side?: "base" | "head"): LedgerViolation[] {
  const where = side === undefined ? {} : { side };
  const schema = validateAgainstContract(loadPackedContract(CONTRACT), value, loadPackedContract);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", ...where, path: violation.path, message: formatContractViolation(label, violation) }));
  return ledgerRuleViolations(value as InstalledLedger).map((violation) => ({
    ...violation,
    ...where,
    message: `${label}.${violation.path} ${violation.message} (rule ${violation.rule})`,
  }));
}

/** Every reason a ledger is refused: the ledger contract's schema, then, once that passes, its code rules L1-L8. */
export function installedLedgerViolations(value: unknown): LedgerViolation[] {
  return contractViolations(value, "ledger");
}

/** Validates a ledger against installed-ledger.json and its code rules L1-L8. A valid ledger is well formed, not trusted. No reason echoes a value. */
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
  // L3 makes an admitted entry an apply entry, and L4 leaves no deferred row after one.
  if (!sameValue(head.files, base.files)) push("S3", "head.files", "differ from the base ledger's, and an admitted generation changes no file");
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

/** Reads one side's ledger from its bytes: valid under the contract, and exactly the bytes RENDER gives it. */
function readLedgerBytes(text: unknown, side: "base" | "head"): { ledger: InstalledLedger | null; violations: LedgerViolation[] } {
  const refuse = (message: string) => ({ ledger: null, violations: [{ rule: "bytes" as const, side, path: "", message: `${side} ${message} (rule bytes)` }] });
  if (typeof text !== "string") return refuse("is not a ledger's bytes as text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("is not JSON");
  }
  const violations = contractViolations(parsed, side, side);
  if (violations.length > 0) return { ledger: null, violations };
  if (serializeInstalledLedger(parsed as InstalledLedger) !== text) return refuse("is not the exact bytes the ledger contract's RENDER section gives this ledger");
  return { ledger: parsed as InstalledLedger, violations: [] };
}

/**
 * Compares a pull request's head ledger with its base's, each given as the
 * exact text of clossys/.state/installed.json (base null when the base has
 * none), under the ledger contract's SUCCESSION rules. Each side must be
 * valid and exactly canonical, or only those reasons are returned: a repeated
 * key, a byte order mark or a second spelling is never read as an unchanged
 * ledger. Then the head is either byte-identical to the base, or one next
 * generation that keeps the base's history; and when that generation is
 * admitted, it installs exactly what the base's setup deferred and changes no
 * other row. An approved next generation is reported as approval-claimed: an
 * unauthenticated claim, never an admission. It checks what the ledgers
 * claim, not the files: whether the tree matches the head ledger is a
 * separate check.
 */
export function ledgerSuccession(baseBytes: string | null, headBytes: string): LedgerSuccession {
  const base = baseBytes === null ? { ledger: null, violations: [] } : readLedgerBytes(baseBytes, "base");
  const head = readLedgerBytes(headBytes, "head");
  const invalid = [...base.violations, ...head.violations];
  if (invalid.length > 0 || head.ledger === null) return { change: "next-generation", admission: null, violations: invalid };
  if (baseBytes !== null && baseBytes === headBytes) return { change: "none", admission: null, violations: [] };
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
  ledger: ["schemaVersion", "kind", "repository", "generation", "history", "files", "keys", "entries", "packages", "deferred"],
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
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
