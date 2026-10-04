/**
 * The installed-state ledger, clossys/.state/installed.json (issue #1178),
 * read against the shared contract docs/contracts/installed-ledger.json -- in
 * the public repository, not shipped in this package. This package's build
 * (scripts/pack-ledger-contract.mjs) packs that contract into src/generated/
 * with a byte-identical copy of the one contract checker, so Starter carries
 * its own reader with no runtime dependency. Internal: nothing here is
 * exported from the package entry point.
 *
 * Validation makes a ledger well formed, not true (TRUST in the contract).
 * Without the hub, the only question Starter can answer is SUCCESSION: what a
 * pull request's head ledger does to its base's, each read from its exact
 * bytes. A refusal names the rule and a position (a JSON pointer, an index or
 * a member name), never a value from the ledger.
 */

import { ContractDocumentError, formatContractViolation, readContractDocument, validateAgainstContract } from "./generated/contract-schema.generated.js";
import type { ContractSchema } from "./generated/contract-schema.generated.js";
import { LEDGER_CONTRACT } from "./generated/ledger-contract.generated.js";

/** Bounded stable registry semver declarations: exact, caret or tilde, with a resolved lower-bound match. */
function existingDeclarationVersionMatches(literal: string, resolved: string): boolean {
  const match=/^([~^]?)(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(literal);
  const actual=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(resolved);
  if(!match || !actual)return false;
  const lower=match.slice(2).map(value=>BigInt(value));
  const version=actual.slice(1).map(value=>BigInt(value));
  const compared=version[0]!==lower[0]?version[0]!>lower[0]!:version[1]!==lower[1]?version[1]!>lower[1]!:version[2]!>=lower[2]!;
  if(!compared)return false;
  if(match[1] === "")return resolved === literal;
  if(match[1] === "~")return version[0]===lower[0] && version[1]===lower[1];
  if(lower[0]!==0n)return version[0]===lower[0];
  if(lower[1]!==0n)return version[0]===0n && version[1]===lower[1];
  return version[0]===0n && version[1]===0n && version[2]===lower[2];
}

type Binding = { readonly kind: "approved"; readonly subjectDigest: string } | { readonly kind: "admitted"; readonly subjectDigest: string; readonly setupChangeSet: string };
interface HistoryEntry { readonly generation: number; readonly changeSet: string; readonly phase: "setup" | "apply"; readonly planDigest: string; readonly bundle: string; readonly baseCommit: string; readonly binding: Binding }
interface FileRow { readonly path: string; readonly mode: "100644" | "120000"; readonly after: string; readonly changeSet: string }
interface KeyRow { readonly file: "package.json"; readonly pointer: string; readonly value: string; readonly changeSet: string }
interface EntryRow { readonly file: string; readonly key: string; readonly value: string; readonly changeSet: string }
interface PackageIdentity { readonly planItem: string; readonly act: string; readonly name: string; readonly version: string; readonly integrity: string; readonly placement: "dependencies" | "devDependencies" }
interface PackageRow extends PackageIdentity { readonly changeSet: string }
interface DeferredRow extends PackageIdentity { readonly reason: "after-setup"; readonly changeSet: string }

/** clossys/.state/installed.json, as installed-ledger.json shapes it. The type validates nothing. */
export interface ExistingDeclarationAdoption {
  readonly file: "package.json";
  readonly placement: "dependencies" | "devDependencies";
  readonly name: string;
  readonly beforeVersion: string;
  readonly beforeResolved: {readonly name:string; readonly version:string; readonly integrity:string};
  readonly desired: PackageIdentity;
  readonly observedBaseCommit: string;
  readonly desiredSnapshotDigest: string;
  readonly consent: "adopt-existing-declaration";
  readonly changeSet: string;
}
export interface InstalledLedger {
  readonly existingDeclarationAdoptions?: readonly ExistingDeclarationAdoption[];
  readonly schemaVersion: 1;
  readonly kind: "clossys.installed-ledger";
  readonly repository: { readonly id: string; readonly nodeId: string };
  readonly generation: number;
  readonly history: readonly HistoryEntry[];
  readonly files: readonly FileRow[];
  readonly keys: readonly KeyRow[];
  readonly entries: readonly EntryRow[];
  readonly packages: readonly PackageRow[];
  readonly deferred: readonly DeferredRow[];
}

type LedgerRule = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" | "L10";
type SuccessionRule = "S2" | "S3";

/** One reason a ledger, or a pair of ledgers, is refused. `side` is set when one ledger breaks the contract; S2 and S3 relate the two and carry none. */
export interface LedgerViolation {
  readonly rule: "schema" | "bytes" | LedgerRule | SuccessionRule;
  readonly side?: "base" | "head";
  readonly path: string;
  readonly message: string;
}

/**
 * What a pull request's head ledger does to its base's. `change` is none only
 * when both sides are valid, exactly canonical and byte-identical.
 * `admission` is admitted when the next generation is admitted and S3 held,
 * approval-claimed when it is bound approved (an approval Starter cannot
 * authenticate, so a claim, never an admission), and null for no change or
 * any refusal.
 */
export interface LedgerSuccession {
  readonly change: "none" | "next-generation";
  readonly admission: "admitted" | "approval-claimed" | null;
  readonly violations: readonly LedgerViolation[];
}

interface RuleViolation { readonly rule: LedgerRule | SuccessionRule; readonly path: string; readonly message: string }

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function definition(name: string): UnknownRecord {
  const definitions = LEDGER_CONTRACT.definitions;
  const found = record(definitions) ? definitions[name] : undefined;
  if (!record(found)) throw new Error(`the packed ledger contract has no ${name} definition`);
  return found;
}
/** A closed object's members, in the order the packed contract declares them. */
function declared(node: unknown): readonly string[] {
  if (!record(node) || !record(node.properties)) throw new Error("the packed ledger contract declares an object with no properties");
  return Object.keys(node.properties);
}

/** The ledger contract refers to no other file; a name it asks for is a defect in the packed copy. */
function refuseOtherContracts(name: string): ContractSchema { throw new Error(`the packed ledger contract is self-contained, yet refers to ${JSON.stringify(name)}`); }

/** The path patterns the apply flow may own, read from the packed contract, never restated here (code rule L5). */
const OWNED_PATTERNS: readonly string[] = (() => {
  const list = definition("ownedPattern").enum;
  if (!Array.isArray(list) || list.length === 0 || !list.every((entry) => typeof entry === "string")) throw new Error("the packed ledger contract has no ownedPattern list");
  return list as string[];
})();
/** The root names an owned pattern can introduce: each pattern's first segment other than ** (code rule L9). */
const INTRODUCIBLE_ROOTS: ReadonlySet<string> = new Set(OWNED_PATTERNS.map((pattern) => pattern.split("/")[0] as string).filter((root) => root !== "**"));
const REPOSITORY = record(LEDGER_CONTRACT.properties) ? LEDGER_CONTRACT.properties.repository : undefined;
const ENTRY_BRANCHES = definition("entryRow").oneOf;
/** Every object's members, in declared order (RENDER). The three entryRow branches declare the same order. */
const ORDER = {
  ledger: declared(LEDGER_CONTRACT),
  repository: declared(REPOSITORY),
  history: declared(definition("historyEntry")),
  approved: declared(definition("approvedBinding")),
  admitted: declared(definition("admittedBinding")),
  file: declared(definition("fileRow")),
  key: declared(definition("keyRow")),
  entry: declared(Array.isArray(ENTRY_BRANCHES) ? ENTRY_BRANCHES[0] : undefined),
  package: declared(definition("packageRow")),
  deferred: declared(definition("deferredRow")),
};

const LEDGER_PATH = "clossys/.state/installed.json";
/**
 * The Launcher guide's path and the digest of its bytes, as the contract's SUCCESSION rule S3 names them: the one file row an admitted
 * generation may add. Starter holds no copy of the guide's text, so the digest is the constant the contract states, which a test pins.
 */
const AGENTS_GUIDE_PATH = "clossys/AGENTS.md";
const AGENTS_GUIDE_DIGEST = "sha256:6f3d39117a95abeb969656c3e11eea52ad27bdafd2341b98ead38b67944e7a53";
const LOCKFILE_NAMES: readonly string[] = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
/** A lowercase id token, such as a role. */
const ID_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DISCOVERY_LINK = /^\.(?:claude|cursor)\/skills\/clossys-([^/]+)$/u;
const SKILL_FILE = /^\.agents\/skills\/clossys-([^/]+)\//u;
const IDENTITY = ["planItem", "act", "name", "version", "integrity", "placement"] as const;

function dependencyPointer(placement: string, name: string): string { return `/${placement}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`; }
function compareTuples(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? ""; const b = right[index] ?? "";
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}
function segmentMatches(segment: string, glob: string): boolean {
  const pattern = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${pattern}$`, "u").test(segment);
}
/** `*` matches within one segment; a segment that is exactly `**` matches any number of whole segments, including none. Paths reaching here already passed the contract's safePath. */
function segmentsMatch(path: readonly string[], pattern: readonly string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern as [string, ...string[]];
  if (head === "**") {
    for (let skip = 0; skip <= path.length; skip += 1) if (segmentsMatch(path.slice(skip), rest)) return true;
    return false;
  }
  return path.length > 0 && segmentMatches(path[0] as string, head) && segmentsMatch(path.slice(1), rest);
}
function repeats<T>(values: readonly T[], key: (value: T) => string): { index: number; first: number }[] {
  const seen = new Map<string, number>(); const out: { index: number; first: number }[] = [];
  values.forEach((value, index) => {
    const first = seen.get(key(value));
    if (first === undefined) seen.set(key(value), index); else out.push({ index, first });
  });
  return out;
}
/** Whether two byte sequences hold the same bytes, in the same order. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

/** Whether two JSON values are equal member for member, whatever their members' order. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) { const other = right as readonly unknown[]; return left.length === other.length && left.every((value, index) => sameValue(value, other[index])); }
  const a = left as UnknownRecord; const b = right as UnknownRecord; const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

/** Code rules L1-L10, over a ledger whose schema already passes. */
function ledgerRuleViolations(ledger: InstalledLedger): RuleViolation[] {
  const out: RuleViolation[] = [];
  const push = (rule: LedgerRule, path: string, message: string) => { out.push({ rule, path, message }); };
  const { history } = ledger;

  // L1: the generation counts the history, and each entry is numbered by its position.
  if (ledger.generation < 1 || ledger.generation !== history.length) push("L1", "generation", "must be 1 or more and equal the number of history entries");
  history.forEach((entry, index) => { if (entry.generation !== index + 1) push("L1", `history[${index}].generation`, "is not its position plus 1"); });

  // L2: a change set is written once.
  for (const { index, first } of repeats(history, (entry) => entry.changeSet)) push("L2", `history[${index}].changeSet`, `repeats history[${first}].changeSet`);

  // L3: setup is approved; admitted follows, immediately, the approved setup entry it names, under the same plan and approval.
  history.forEach((entry, index) => {
    const at = `history[${index}].binding`; const { binding } = entry;
    if (entry.phase === "setup" && binding.kind !== "approved") { push("L3", at, "is not approved, and a setup entry's binding must be"); return; }
    if (binding.kind === "approved") return;
    const previous = index > 0 ? history[index - 1] : undefined;
    if (previous === undefined) { push("L3", at, "is admitted, but no setup entry comes before it"); return; }
    if (previous.changeSet !== binding.setupChangeSet) push("L3", `${at}.setupChangeSet`, "is not the change set of the entry before it");
    if (previous.phase !== "setup" || previous.binding.kind !== "approved") push("L3", at, "is admitted, but the entry before it is not an approved setup entry");
    if (previous.planDigest !== entry.planDigest) push("L3", `history[${index}].planDigest`, "is not the plan digest of the setup entry it follows");
    if (previous.binding.subjectDigest !== binding.subjectDigest) push("L3", `${at}.subjectDigest`, "is not the approved subject of the setup entry it follows");
  });

  // L4: every row names a written change set; deferred rows name the latest, and none survive an apply generation.
  const written = new Set(history.map((entry) => entry.changeSet));
  const rowArrays: readonly [string, readonly { readonly changeSet: string }[]][] = [["files", ledger.files], ["keys", ledger.keys], ["entries", ledger.entries], ["packages", ledger.packages], ["deferred", ledger.deferred]];
  for (const [name, rows] of rowArrays) rows.forEach((row, index) => { if (!written.has(row.changeSet)) push("L4", `${name}[${index}].changeSet`, "names no history entry's change set"); });
  const last = history.at(-1);
  if (last !== undefined) {
    ledger.deferred.forEach((row, index) => { if (written.has(row.changeSet) && row.changeSet !== last.changeSet) push("L4", `deferred[${index}].changeSet`, "is not the latest history entry's change set"); });
    if (last.phase === "apply" && ledger.deferred.length > 0) push("L4", "deferred", "must be empty after an apply generation");
  }

  // L5: files rows are owned paths, never the ledger, package.json or a lockfile; only a discovery link is 120000; roles are id tokens.
  ledger.files.forEach((row, index) => {
    const at = `files[${index}]`; const lowered = row.path.toLowerCase();
    if (lowered === LEDGER_PATH || lowered === "package.json" || LOCKFILE_NAMES.includes(lowered)) push("L5", `${at}.path`, "is the ledger, package.json or a lockfile, which no files row names");
    else if (!OWNED_PATTERNS.some((pattern) => segmentsMatch(row.path.split("/"), pattern.split("/")))) push("L5", `${at}.path`, "is not matched by any owned pattern");
    const linkRole = DISCOVERY_LINK.exec(row.path)?.[1];
    const role = linkRole ?? SKILL_FILE.exec(row.path)?.[1];
    if (role !== undefined && !ID_TOKEN.test(role)) push("L5", `${at}.path`, "names a role that is not a lowercase id token");
    const link = linkRole !== undefined;
    if ((row.mode === "120000") !== link) push("L5", `${at}.mode`, link ? "is not 120000, and this path is a discovery link" : "is 120000, which only a discovery link has");
  });

  // L6: each key is exactly one package's dependency entry, at its version.
  ledger.keys.forEach((row, index) => {
    const owners = ledger.packages.filter((pkg) => dependencyPointer(pkg.placement, pkg.name) === row.pointer);
    if (owners.length !== 1) push("L6", `keys[${index}].pointer`, "does not name exactly one packages row");
    else if ((owners[0] as PackageRow).version !== row.value) push("L6", `keys[${index}].value`, "is not the version of the package it names");
  });

  // L7: one act per package across packages and deferred. L10 derives each planItem from its name, so a repeated planItem is a repeated name.
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
  for (const { index, first } of repeats(acts, (entry) => entry.row.name)) push("L7", `${acts[index]?.path}.name`, `repeats ${acts[first]?.path}.name`);

  // L8: canonical order by UTF-16 code units, no repeats; files paths repeat case-insensitively.
  const order = <T>(name: string, rows: readonly T[], key: (row: T) => readonly string[]) => {
    for (let index = 1; index < rows.length; index += 1) {
      if (compareTuples(key(rows[index - 1] as T), key(rows[index] as T)) >= 0) { push("L8", `${name}[${index}]`, "is out of canonical order, or repeats the entry before it"); return; }
    }
  };
  order("files", ledger.files, (row) => [row.path]);
  for (const { index, first } of repeats(ledger.files, (row) => row.path.toLowerCase())) push("L8", `files[${index}].path`, `repeats files[${first}].path, compared case-insensitively`);
  order("keys", ledger.keys, (row) => [row.file, row.pointer]);
  order("entries", ledger.entries, (row) => [row.file, row.key, row.value]);
  order("packages", ledger.packages, (row) => [row.planItem]);
  order("deferred", ledger.deferred, (row) => [row.planItem]);

  // L9: root entries edit one profile and name only roots an owned pattern introduces (each well within 255 UTF-16 code units).
  const profileRows = ledger.entries.map((row, index) => ({ row, index })).filter(({ row }) => row.key === "rootEntries");
  const profileFile = profileRows[0]?.row.file;
  for (const { row, index } of profileRows) {
    if (row.file !== profileFile) push("L9", `entries[${index}].file`, "is a second Controller profile, and the flow edits one");
    if (!INTRODUCIBLE_ROOTS.has(row.value)) push("L9", `entries[${index}].value`, "is not a root name an owned pattern can introduce");
  }

  // L10: a planItem is repository.id, a colon and the row's name, never free text.
  for (const [name, rows] of [["packages", ledger.packages], ["deferred", ledger.deferred]] as const) {
    rows.forEach((row, index) => { if (row.planItem !== `${ledger.repository.id}:${row.name}`) push("L10", `${name}[${index}].planItem`, "is not repository.id, a colon and the row's name"); });
  }
  return out;
}

function contractViolations(value: unknown, label: string, side?: "base" | "head"): LedgerViolation[] {
  const where = side === undefined ? {} : { side };
  const schema = validateAgainstContract(LEDGER_CONTRACT, value, refuseOtherContracts);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", ...where, path: violation.path, message: formatContractViolation(label, violation) }));
  return ledgerRuleViolations(value as InstalledLedger).map((violation) => ({ ...violation, ...where, message: `${label}.${violation.path} ${violation.message} (rule ${violation.rule})` }));
}

/** Every reason a ledger is refused: the contract's schema, then, once that passes, code rules L1-L10. Messages name positions, never values. */
export function installedLedgerViolations(value: unknown): LedgerViolation[] {
  return contractViolations(value, "ledger");
}

function ordered(value: object, members: readonly string[]): UnknownRecord {
  const source = value as UnknownRecord;
  return Object.fromEntries(members.map((member) => [member, source[member]]));
}

/**
 * The exact bytes of a ledger (RENDER): every object's members in the order
 * the contract declares them, two-space JSON and one line feed. Throws,
 * naming positions only, for a refused ledger, so no refused ledger has bytes.
 */
export function serializeInstalledLedger(ledger: InstalledLedger): string {
  const violations = installedLedgerViolations(ledger);
  if (violations.length > 0) throw new TypeError(`a refused ledger has no bytes: ${violations.map((violation) => violation.message).join("; ")}`);
  const canonical = {
    ...ordered(ledger, ORDER.ledger),
    repository: ordered(ledger.repository, ORDER.repository),
    history: ledger.history.map((entry) => ({ ...ordered(entry, ORDER.history), binding: ordered(entry.binding, entry.binding.kind === "approved" ? ORDER.approved : ORDER.admitted) })),
    files: ledger.files.map((row) => ordered(row, ORDER.file)),
    keys: ledger.keys.map((row) => ordered(row, ORDER.key)),
    entries: ledger.entries.map((row) => ordered(row, ORDER.entry)),
    packages: ledger.packages.map((row) => ordered(row, ORDER.package)),
    deferred: ledger.deferred.map((row) => ordered(row, ORDER.deferred)),
    ...(ledger.existingDeclarationAdoptions !== undefined ? {existingDeclarationAdoptions: ledger.existingDeclarationAdoptions.map(row => ({
      ...ordered(row, declared(definition("existingDeclarationAdoption"))),
      beforeResolved: ordered(row.beforeResolved, declared(definition("adoptionResolution"))),
      desired: ordered(row.desired, declared(definition("adoptionDesired"))),
    }))} : {}),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/**
 * Reads one side from its raw bytes, unencoded and undecoded. Strict JSON
 * first, so a repeated key or a byte order mark is refused by position before
 * any value is judged (readContractDocument() refuses invalid UTF-8 and a
 * leading byte order mark itself, reading the bytes it is given, not a prior
 * decode); then the contract; then the bytes must be exactly what RENDER
 * gives the ledger they hold, which refuses every other spelling (spacing,
 * CRLF, member order, a missing or extra final line feed).
 */
function readSide(bytes: unknown, side: "base" | "head"): { ledger: InstalledLedger | null; violations: LedgerViolation[] } {
  const refuse = (message: string) => ({ ledger: null, violations: [{ rule: "bytes" as const, side, path: "", message: `${side} ${message} (rule bytes)` }] });
  if (!(bytes instanceof Uint8Array)) return refuse("is not a ledger's bytes as a Uint8Array");
  let parsed: unknown;
  try { parsed = readContractDocument(bytes); } catch (error) {
    if (error instanceof ContractDocumentError) return refuse(error.message);
    throw error;
  }
  const violations = contractViolations(parsed, side, side);
  if (violations.length > 0) return { ledger: null, violations };
  const canonical = Buffer.from(serializeInstalledLedger(parsed as InstalledLedger), "utf8");
  if (!sameBytes(canonical, bytes)) return refuse("is not the exact bytes the ledger contract's RENDER section gives this ledger");
  return { ledger: parsed as InstalledLedger, violations: [] };
}

function successionRuleViolations(base: InstalledLedger | null, head: InstalledLedger): RuleViolation[] {
  const out: RuleViolation[] = [];
  const push = (rule: SuccessionRule, path: string, message: string) => { out.push({ rule, path, message }); };

  // S2. L1 ties each generation to its history's length, so keeping the base history before one new entry is generation plus 1.
  if (base !== null && !sameValue(head.repository, base.repository)) push("S2", "head.repository", "is not the base ledger's repository");
  if (!sameValue(head.history.slice(0, -1), base?.history ?? [])) push("S2", "head.history", "does not keep the base ledger's history unchanged before its last entry, or is not one generation past it");

  // S3. An approved head is checked by S2 alone: its approval is a claim Starter cannot authenticate.
  const last = head.history.at(-1) as HistoryEntry;
  if (last.binding.kind !== "admitted") return out;
  const at = `head.history[${head.history.length - 1}].binding`;
  if (base === null) { push("S3", at, "is admitted, but the base has no ledger holding the setup it follows"); return out; }
  // L3 on the head makes the entry before an admitted one its approved setup, which S2 makes the base's latest; L3 makes it apply, and L4 leaves it no deferred row.
  // The one file an admitted generation may add: the Launcher guide, for an install set up before it existed. Its row is the only change to
  // the files, is written by this generation and names the guide's own bytes, so the base holds none at that path (L8 forbids a repeat in
  // any letter case). This compares ledger rows only: Starter's admission reads the two ledgers' bytes, not the head tree, so it cannot
  // check that the file at that path holds those bytes.
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
  if (!sameValue(base.existingDeclarationAdoptions, head.existingDeclarationAdoptions)) push("S3", "head.existingDeclarationAdoptions", "change protected adoption consent");
  const kept = <T>(rows: readonly T[], from: readonly T[]) => from.every((row) => rows.some((other) => sameValue(other, row)));
  if (!kept(head.keys, base.keys)) push("S3", "head.keys", "drop or change a key row the base ledger has");
  if (!kept(head.packages, base.packages)) push("S3", "head.packages", "drop or change a package row the base ledger has");
  const added = head.packages.filter((row) => !base.packages.some((other) => sameValue(other, row)));
  const fulfils = (row: PackageRow, deferral: DeferredRow) => IDENTITY.every((member) => row[member] === deferral[member]) && row.changeSet === last.changeSet;
  if (added.length !== base.deferred.length || !base.deferred.every((deferral) => added.filter((row) => fulfils(row, deferral)).length === 1)) {
    push("S3", "head.packages", "add something other than exactly the installs the base ledger's setup deferred");
  }
  const addedKeys = head.keys.filter((row) => !base.keys.some((other) => sameValue(other, row)));
  const keyed = (row: KeyRow) => row.changeSet === last.changeSet && added.some((pkg) => dependencyPointer(pkg.placement, pkg.name) === row.pointer && pkg.version === row.value);
  if (!addedKeys.every(keyed)) push("S3", "head.keys", "add a key row that is not for an install the base ledger's setup deferred");
  return out;
}

/**
 * Compares a pull request's head ledger with its base's under the contract's
 * SUCCESSION rules, each given as the exact bytes of
 * clossys/.state/installed.json (base null when the base has none). Each
 * side's raw bytes reach readContractDocument() unchanged: no decode, and no
 * re-encode of an already decoded string, happens first. A side that is
 * invalid or not exactly canonical returns only its own reasons, and is never
 * read as unchanged, even when both sides decode to the same text. Otherwise
 * byte-identical sides are no change (S1); anything else must be one next
 * generation (S2), and an admitted one must install exactly what the base's
 * setup deferred and change no other row, except that it may add the one
 * Launcher guide row (S3). An approved next generation is
 * only ever approval-claimed. It checks what the ledgers claim, not the tree.
 */
export function ledgerSuccession(baseBytes: Uint8Array | null, headBytes: Uint8Array): LedgerSuccession {
  const base = baseBytes === null ? { ledger: null, violations: [] } : readSide(baseBytes, "base");
  const head = readSide(headBytes, "head");
  const invalid = [...base.violations, ...head.violations];
  if (invalid.length > 0 || head.ledger === null) return { change: "next-generation", admission: null, violations: invalid };
  if (baseBytes !== null && sameBytes(baseBytes, headBytes)) return { change: "none", admission: null, violations: [] };
  const violations = successionRuleViolations(base.ledger, head.ledger).map((violation) => ({ ...violation, message: `${violation.path} ${violation.message} (rule ${violation.rule})` }));
  if (violations.length > 0) return { change: "next-generation", admission: null, violations };
  return { change: "next-generation", admission: head.ledger.history.at(-1)?.binding.kind === "admitted" ? "admitted" : "approval-claimed", violations: [] };
}
