// The approval sheet (issue #1178, RFC section 12.7): what a client reads
// before approving an apply bundle, rendered from ids and digests only. It is
// a pure function of a bundle and the change sets the bundle names -- it reads
// no file, runs no process and reads no clock -- so the same inputs always
// give the same bytes.
//
// The sheet never carries brief or plan prose, the `texts` a set stores, a
// package.json key's value, or any file's contents (V5). Every value it does
// print is checked against a strict pattern first, and a value that fails one,
// or holds one of the characters that could make a row read as something
// else, refuses the whole sheet. A refusal is a fixed token and echoes
// nothing: a bundle can come from a plan a hostile author wrote, and the
// sheet is read by people and agents.
//
// The sheet asks for one approval: the line `Approve subjectDigest: <bundle
// digest>`. It computes and records no approval; that is the plan's decision,
// made in the hub.

import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, ApplyBundleRepository, ChangeSetItem, RepositoryChangeSet } from "./change-set-contract.js";

/** Why a sheet was not rendered. The token is the whole message. */
export type ApprovalSheetRefusal = "bundle-invalid" | "change-set-invalid" | "set-mismatch" | "value-unsafe";

export class ApprovalSheetError extends Error {
  constructor(readonly token: ApprovalSheetRefusal) {
    super(token);
    this.name = "ApprovalSheetError";
  }
}

export interface ApprovalSheetInput {
  readonly bundle: ApplyBundle;
  /** The change set of every bundle repository that has one, in any order. */
  readonly changeSets: readonly RepositoryChangeSet[];
}

const REPOSITORY = /^[A-Za-z0-9._-]{1,100}(?:\/[A-Za-z0-9._-]{1,100})?$/u;
const TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CHECK = /^V[1-9]$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ITEM = /^[A-Za-z0-9._@/:~+-]{1,300}$/u;
const PATH = /^[A-Za-z0-9._@/~+-]{1,300}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9._~-]{1,100}\/)?[a-z0-9._~-]{1,100}$/u;
const VERSION = /^[0-9A-Za-z.+-]{1,100}$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const FORBIDDEN = /[<>`|\r\n]/u;

function safe(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || FORBIDDEN.test(value) || !pattern.test(value)) throw new ApprovalSheetError("value-unsafe");
  return value;
}

/** The first 12 hex digits of a digest, as RFC 12.7 names the Digest column. */
function short(digest: string): string {
  return safe(digest, DIGEST).slice("sha256:".length, "sha256:".length + 12);
}

function isPackageAct(item: ChangeSetItem): item is Extract<ChangeSetItem, { act: "install" | "pin-starter" }> {
  return item.act === "install" || item.act === "pin-starter";
}

function change(set: RepositoryChangeSet, item: ChangeSetItem): string {
  if (isPackageAct(item)) return `${safe(item.package.name, PACKAGE_NAME)}@${safe(item.package.version, VERSION)}`;
  const count = set.files.filter((file) => file.item === item.id).length;
  return `${count} ${count === 1 ? "path" : "paths"}`;
}

function yesNo(value: unknown): "yes" | "no" {
  if (value === true) return "yes";
  if (value === false) return "no";
  throw new ApprovalSheetError("value-unsafe");
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function checkedBundle(input: ApprovalSheetInput): { bundle: ApplyBundle; sets: Map<string, RepositoryChangeSet> } {
  const { bundle, changeSets } = input;
  if (!validateApplyBundle(bundle).valid) throw new ApprovalSheetError("bundle-invalid");
  const sets = new Map<string, RepositoryChangeSet>();
  for (const set of changeSets) {
    if (!validateRepositoryChangeSet(set).valid) throw new ApprovalSheetError("change-set-invalid");
    if (set.bundle !== bundle.bundleDigest || set.planDigest !== bundle.plan.digest) throw new ApprovalSheetError("set-mismatch");
    if (sets.has(set.changeSetDigest)) throw new ApprovalSheetError("set-mismatch");
    sets.set(set.changeSetDigest, set);
  }
  const held = bundle.repositories.flatMap((entry) => ("changeSet" in entry ? [{ id: entry.id, changeSetDigest: entry.changeSet }] : []));
  // Exactly the sets the bundle names: none missing, none extra, each under its own repository.
  if (held.length !== sets.size) throw new ApprovalSheetError("set-mismatch");
  for (const entry of held) {
    const set = sets.get(entry.changeSetDigest);
    if (set === undefined || set.repository.id !== entry.id) throw new ApprovalSheetError("set-mismatch");
  }
  return { bundle, sets };
}

function repositoryRows(entry: ApplyBundleRepository, sets: ReadonlyMap<string, RepositoryChangeSet>): string[] {
  if (!("changeSet" in entry)) return [];
  const set = sets.get(entry.changeSet)!;
  const repository = safe(entry.id, REPOSITORY);
  const digest = short(set.changeSetDigest);
  return set.items.map((item) => row([repository, safe(item.act, TOKEN), safe(item.id, ITEM), change(set, item), digest]));
}

/**
 * Renders the approval sheet of `bundle`, LF-terminated. Throws an
 * ApprovalSheetError, a fixed token that names no value, when the bundle or a
 * set does not validate (the validators recompute each digest, so one that
 * does not recompute is refused there), the sets are not exactly
 * the bundle's, or any printed value fails its pattern.
 */
export function renderApprovalSheet(input: ApprovalSheetInput): string {
  const { bundle, sets } = checkedBundle(input);
  const authorization =
    bundle.authorization === null
      ? "none"
      : `plan ${safe(bundle.authorization.planDigest, DIGEST)} expires ${safe(bundle.authorization.expiresAt, DATE_TIME)}`;
  const lines: string[] = [
    "Clossys apply plan: approval sheet",
    `Mode: ${safe(bundle.mode, TOKEN)}`,
    `Plan digest: ${safe(bundle.plan.digest, DIGEST)}`,
    `Plan committed: ${yesNo(bundle.plan.committed)}`,
    `Bundle digest: ${safe(bundle.bundleDigest, DIGEST)}`,
    `Authorization: ${authorization}`,
    `Approve subjectDigest: ${safe(bundle.bundleDigest, DIGEST)}`,
    "",
    row(["Repository", "Kind", "Item", "Change", "Digest"]),
    row(["---", "---", "---", "---", "---"]),
    ...bundle.repositories.flatMap((entry) => repositoryRows(entry, sets)),
  ];

  const deferred: string[] = [];
  const refused: string[] = [];
  const skipped: string[] = [];
  const unsatisfied: string[] = [];
  for (const entry of bundle.repositories) {
    const id = safe(entry.id, REPOSITORY);
    if (!("changeSet" in entry)) {
      skipped.push(`- ${id} ${safe(entry.verdict, TOKEN)} ${safe(entry.reason, TOKEN)}`);
      continue;
    }
    const set = sets.get(entry.changeSet)!;
    for (const item of set.deferred) deferred.push(`- ${id} ${safe(item.planItem, ITEM)} ${safe(item.reason, TOKEN)}`);
    for (const item of set.refused) {
      const where = "path" in item ? safe(item.path, PATH) : `${safe(item.file, PATH)}#${safe(item.pointer, PATH)}`;
      refused.push(`- ${id} ${where} ${safe(item.reason, TOKEN)}`);
    }
    for (const check of entry.checks) {
      if (check.verdict === "satisfied") continue;
      unsatisfied.push(`- ${id} ${safe(check.check, CHECK)} ${safe(check.verdict, TOKEN)}${check.rule === undefined ? "" : ` ${safe(check.rule, TOKEN)}`}`);
    }
  }
  for (const [title, entries] of [
    ["Deferred", deferred],
    ["Refused", refused],
    ["Skipped", skipped],
    ["Checks not satisfied", unsatisfied],
  ] as const) {
    if (entries.length > 0) lines.push("", `${title}:`, ...entries);
  }
  return `${lines.join("\n")}\n`;
}
