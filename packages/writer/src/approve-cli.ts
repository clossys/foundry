/**
 * `writer-check approve` — writes a `CopyRegistryEntry.approval` record so
 * nobody has to hand-edit one. It exists as a command, not a hand-edited
 * JSON field, for the same reason `textFingerprint` (`fingerprint.ts`) is a
 * content hash rather than a human-maintained counter: a hand-typed record
 * is easy to get wrong — copying yesterday's `approvedAt`, pinning `textFingerprint` to
 * some other entry's text, or leaving `pendingOwnerReview` set after an
 * owner actually reviewed it. Every field this command writes is either
 * computed (`approvedAt` from the clock, `textFingerprint` from the
 * entry's own current `text` via `computeCopyFingerprint`) or copied
 * verbatim from an argument this command itself validated (`--delegate`,
 * `--scope`, `--expires`) — there is no field here a human types free-form
 * into the JSON.
 *
 * This module owns argument parsing, registry-file I/O, and the mutate-
 * then-atomically-rename write; `./approval.ts`'s `isDelegateScopeItem` and
 * `isEntryInDelegateScope` decide whether a requested id is in a delegate's
 * declared scope, and `./schema.ts`'s `validateCopyRegistryShape` decides
 * whether the registry file is trustworthy enough to mutate at all — this
 * file calls both rather than re-deriving either.
 *
 * `main`-equivalent shape is `mainApproveCommand`, exported (unlike a
 * typical CLI `main`) so this package's tests (which do not ship) can exercise the whole
 * argv-to-exit-code contract directly against real `mkdtemp` fixture
 * files, without spawning a subprocess — the same discipline every other
 * subcommand in this package's `cli.ts` already holds to. `argv` excludes
 * the leading `"approve"` token: `cli.ts`'s top-level dispatch calls
 * `mainApproveCommand(argv.slice(1))` for `writer-check approve ...`, the same way `"passages"` and
 * `"addressability"` are already dispatched there.
 *
 * Exit codes — a three-state contract matching every other gate/command in
 * this package:
 *
 *   0 — written: every named entry was approved or revoked, and the
 *       registry file on disk now reflects it.
 *   1 — refused: at least one named entry is unknown, is `retired`, or —
 *       for a delegate approval — falls outside `--scope`. This is
 *       ALL-OR-NOTHING: when any requested id has a problem, EVERY problem
 *       is printed and NOTHING is written, even for the other ids that
 *       would otherwise have succeeded. A partial write here would leave a
 *       consumer's own audit trail unable to tell whether a whole
 *       requested batch was actually reviewed together.
 *   2 — could not run: bad arguments (see below), or the registry file is
 *       missing/unreadable, not valid JSON, or fails
 *       `validateCopyRegistryShape`. Nothing is written in this state
 *       either — this command never mutates a registry it does not first
 *       fully trust.
 *
 * Bad-argument cases that produce exit 2, all before the registry file is
 * ever opened: no registry-file argument, zero entry ids, neither `--by`
 * nor `--revoke` (or both), `--by` other than `owner`/`delegate`, `--by
 * owner` combined with `--delegate`/`--scope`/`--expires`, `--by delegate`
 * missing `--delegate` or `--scope`, an empty `--delegate` value, a
 * `--scope` item that fails `isDelegateScopeItem` or an empty scope list,
 * `--revoke` combined with any of `--by`/`--delegate`/`--scope`/
 * `--expires`, an `--expires` value that is not a well-formed ISO 8601 UTC
 * timestamp or is not strictly after the current time, or an unknown flag.
 * `--help`/`-h` always prints usage and returns 0, taking precedence over
 * every other check reachable in the same parse. Any other unexpected
 * exception is caught and mapped to exit 2 as well — this command never
 * lets an uncaught error double as a "something went wrong" report.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDelegateScopeItem, isEntryInDelegateScope } from "./approval.js";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "./fingerprint.js";
import { validateCopyRegistryShape } from "./schema.js";

export const APPROVE_USAGE = `Usage: writer-check approve <registry-file> <entry-id>... --by owner
   or: writer-check approve <registry-file> <entry-id>... --by delegate --delegate <id> --scope <ns>[,<ns>...] [--expires <ISO>]
   or: writer-check approve <registry-file> <entry-id>... --revoke

  registry-file  Path to a CopyRegistry JSON file. Required.
  entry-id       One or more entry ids to approve or revoke (repeatable positional argument; duplicates are deduplicated). Required.

Options:
  --help                  Print this message and exit 0.
  --by <owner|delegate>   Who is recording this approval. Exactly one of --by or --revoke is required.
  --delegate <id>         Opaque delegate identifier, never a personal name. Required (and only allowed) with --by delegate.
  --scope <ns>[,<ns>...]  One or more dot-separated entry-id namespaces the delegate may approve (repeatable; a comma-separated value and repeated flags union). Required (and only allowed) with --by delegate.
  --expires <ISO>         ISO 8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ, optionally with milliseconds) after which the delegate approval expires. Must be strictly after the current time. Only allowed with --by delegate.
  --revoke                Return every named entry to "draft" and delete its approval record. Cannot be combined with --by, --delegate, --scope, or --expires.

Approving an entry that already carries a delegate's approval record with
--by owner replaces that record with the owner's own — this is how a
pending delegate approval is durably confirmed.

Exit codes: 0 = written (every named entry approved or revoked; the
registry file was updated), 1 = refused (an unknown, retired, or — for a
delegate approval — out-of-scope entry id was named; every problem is
printed and nothing is written), 2 = could not run (bad arguments, or the
registry file is missing/unreadable/not valid JSON/fails schema
validation; nothing is written).
`;

/** Bad arguments only — never thrown once the registry file has been read. */
class ApproveInputError extends Error {}

type ApproveAction =
  | { kind: "approve-owner" }
  | { kind: "approve-delegate"; delegate: string; scope: string[]; expiresAt?: string }
  | { kind: "revoke" };

interface RawArgs {
  registryFile?: string;
  entryIds: string[];
  by?: string;
  delegate?: string;
  scope?: string[];
  expires?: string;
  revoke: boolean;
  help: boolean;
}

interface ValidatedArgs {
  registryFile: string;
  entryIds: string[];
  action: ApproveAction;
}

function parseRawArgs(argv: string[]): RawArgs {
  let registryFile: string | undefined;
  const entryIds: string[] = [];
  let by: string | undefined;
  let delegate: string | undefined;
  let scope: string[] | undefined;
  let expires: string | undefined;
  let revoke = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--revoke") {
      revoke = true;
      continue;
    }
    if (arg === "--by") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) throw new ApproveInputError("--by requires a value");
      by = value;
      continue;
    }
    if (arg === "--delegate") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) throw new ApproveInputError("--delegate requires a value");
      delegate = value;
      continue;
    }
    if (arg === "--scope") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) throw new ApproveInputError("--scope requires a value");
      const tokens = value.split(",").map((token) => token.trim());
      scope = [...(scope ?? []), ...tokens];
      continue;
    }
    if (arg === "--expires") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new ApproveInputError("--expires requires an ISO 8601 UTC timestamp");
      }
      expires = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ApproveInputError(`unknown flag "${arg}"`);
    }
    if (registryFile === undefined) {
      registryFile = arg;
    } else {
      entryIds.push(arg);
    }
  }

  return { registryFile, entryIds, by, delegate, scope, expires, revoke, help };
}

/**
 * `YYYY-MM-DDTHH:MM:SS(.sss)?Z` — deliberately the same shape
 * `schema.ts`'s own (unexported) `ISO_UTC_TIMESTAMP_RE` accepts for
 * `approvedAt`/`expiresAt`, so a value this command accepts on argv is
 * never one `validateCopyRegistryShape` would then reject from the file
 * this command just wrote. `Date.parse` must also actually accept it, so a
 * string that merely matches the pattern but names an impossible date
 * (e.g. a bad month) is still rejected.
 */
const EXPIRES_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function validateExpires(raw: string, now: Date): string {
  if (!EXPIRES_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ApproveInputError(
      `--expires must be an ISO 8601 UTC timestamp (e.g. 2026-01-01T00:00:00Z), got ${JSON.stringify(raw)}`,
    );
  }
  if (Date.parse(raw) <= now.getTime()) {
    throw new ApproveInputError(`--expires ${JSON.stringify(raw)} must be strictly after the current time`);
  }
  return raw;
}

/**
 * Turns the raw, syntactically-parsed argv into a fully validated action —
 * every semantic rule this command enforces before ever touching the
 * registry file lives here. Throws `ApproveInputError` on the first
 * violation, matching every other subcommand's `parseArgs` in this
 * package.
 */
function validateArgs(raw: RawArgs, now: Date): ValidatedArgs {
  if (!raw.registryFile) {
    throw new ApproveInputError("registry-file is required");
  }
  if (raw.entryIds.length === 0) {
    throw new ApproveInputError("at least one entry-id is required");
  }

  if (!raw.revoke && raw.by === undefined) {
    throw new ApproveInputError("exactly one of --by or --revoke is required");
  }

  let action: ApproveAction;
  if (raw.revoke) {
    if (raw.by !== undefined || raw.delegate !== undefined || raw.scope !== undefined || raw.expires !== undefined) {
      throw new ApproveInputError("--revoke cannot be combined with --by, --delegate, --scope, or --expires");
    }
    action = { kind: "revoke" };
  } else if (raw.by === "owner") {
    if (raw.delegate !== undefined || raw.scope !== undefined || raw.expires !== undefined) {
      throw new ApproveInputError("--by owner cannot be combined with --delegate, --scope, or --expires");
    }
    action = { kind: "approve-owner" };
  } else if (raw.by === "delegate") {
    if (raw.delegate === undefined) {
      throw new ApproveInputError("--by delegate requires --delegate <id>");
    }
    if (raw.delegate.length === 0) {
      throw new ApproveInputError("--delegate must not be empty");
    }
    if (raw.scope === undefined || raw.scope.length === 0) {
      throw new ApproveInputError("--by delegate requires --scope <ns>[,<ns>...]");
    }
    for (const item of raw.scope) {
      if (!isDelegateScopeItem(item)) {
        throw new ApproveInputError(`invalid --scope item ${JSON.stringify(item)}`);
      }
    }
    const expiresAt = raw.expires !== undefined ? validateExpires(raw.expires, now) : undefined;
    action = { kind: "approve-delegate", delegate: raw.delegate, scope: raw.scope, expiresAt };
  } else {
    throw new ApproveInputError(`--by must be "owner" or "delegate", got ${JSON.stringify(raw.by)}`);
  }

  return { registryFile: raw.registryFile, entryIds: [...new Set(raw.entryIds)], action };
}

interface ReadOutcome {
  ok: boolean;
  parsed?: Record<string, unknown>;
  messages: string[];
}

/**
 * Reads, parses, and shape-validates the registry file — never throws.
 * Deliberately does NOT go through `parseCopyRegistry`/`buildCopyRegistry`
 * (`schema.ts`): those rebuild a fresh object from validated fields, which
 * would lose the original file's key order and any field this package
 * does not itself model. This command mutates the raw parsed JSON value in
 * place instead (see `mainApproveCommand`), so it only needs
 * `validateCopyRegistryShape`'s findings, never a rebuilt object.
 */
function readRegistry(path: string): ReadOutcome {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      messages: [`registry file "${path}" could not be read: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      messages: [`registry file "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const findings = validateCopyRegistryShape(parsed);
  if (findings.length > 0) {
    return {
      ok: false,
      messages: findings.map((f) => `[${f.rule}]${f.path ? ` ${f.path}:` : ""} ${f.message}`),
    };
  }

  return { ok: true, parsed: parsed as Record<string, unknown>, messages: [] };
}

function indexEntries(parsed: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const entries = parsed.entries as unknown[];
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of entries) {
    const entry = raw as Record<string, unknown>;
    byId.set(entry.id as string, entry);
  }
  return byId;
}

/**
 * All-or-nothing pre-flight: every requested id that is unknown, retired,
 * or (for a delegate approval) outside `--scope` is collected here, so
 * `mainApproveCommand` can print every problem and refuse the WHOLE batch
 * — never write some of the requested entries and skip others.
 */
function findProblems(
  entriesById: Map<string, Record<string, unknown>>,
  entryIds: string[],
  action: ApproveAction,
): string[] {
  const problems: string[] = [];
  for (const id of entryIds) {
    const entry = entriesById.get(id);
    if (!entry) {
      problems.push(`unknown entry id "${id}"`);
      continue;
    }
    if (entry.status === "retired") {
      problems.push(`entry "${id}" is retired and cannot be approved or revoked`);
      continue;
    }
    if (action.kind === "approve-delegate" && !isEntryInDelegateScope(id, action.scope)) {
      problems.push(`entry "${id}" is outside delegate scope [${action.scope.join(", ")}]`);
    }
  }
  return problems;
}

/**
 * Builds a fresh `CopyApproval`-shaped record with keys in the exact order
 * this package's contract fixes: `approvedBy`, `approvedAt`,
 * `textFingerprint`, `fingerprintAlgorithm`, then — delegate records only —
 * `delegate`, `pendingOwnerReview`, `expiresAt`. Assigning this whole
 * object to `entry.approval` either appends a new `approval` key at the
 * end of the entry (it did not exist before) or replaces an existing one
 * in place (its position in the entry is unchanged, because reassigning an
 * existing object key never moves it) — see this file's top doc comment
 * and `mainApproveCommand` for why that is exactly the key-order contract
 * this command must preserve.
 */
function buildApprovalRecord(action: ApproveAction, entry: Record<string, unknown>, now: Date): Record<string, unknown> {
  const record: Record<string, unknown> = {
    approvedBy: action.kind === "approve-delegate" ? "delegate" : "owner",
    approvedAt: now.toISOString(),
    textFingerprint: computeCopyFingerprint(entry.text as string),
    fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
  };
  if (action.kind === "approve-delegate") {
    record.delegate = { id: action.delegate, scope: [...action.scope] };
    record.pendingOwnerReview = true;
    if (action.expiresAt !== undefined) {
      record.expiresAt = action.expiresAt;
    }
  }
  return record;
}

/**
 * Writes `data` to `path` by writing a temp file in the SAME directory,
 * then `renameSync`-ing it into place, so the registry file is replaced by
 * one rename rather than rewritten in place. The temp file is cleaned up
 * on any failure; a failure after a successful `renameSync` cannot happen,
 * since nothing runs after it.
 */
function writeRegistryFile(path: string, data: unknown): void {
  const dir = dirname(path);
  const base = basename(path);
  const tempPath = join(dir, `.${base}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  try {
    writeFileSync(tempPath, content, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only — the original error below is what matters.
    }
    throw error;
  }
}

/**
 * Exported (unlike a typical CLI `main`) so this package's tests (which do
 * not ship) can exercise the whole argv-to-exit-code contract directly against real
 * `mkdtemp` fixture files, without spawning a subprocess — see this file's
 * top doc comment for the full exit-code contract. `argv` excludes the
 * leading `"approve"` subcommand token. `io.now` lets a test pin the clock
 * that `approvedAt` and `--expires` validation are measured against;
 * omitted, it defaults to `new Date()`.
 *
 * Never throws: every failure, expected or not, is caught here and mapped
 * to an exit code — bad arguments and an untrustworthy registry file both
 * become 2 with nothing written, a refused (but well-formed) request
 * becomes 1 with nothing written, and a clean run becomes 0 with the
 * registry file updated on disk.
 */
export function mainApproveCommand(argv: string[], io: { now?: Date } = {}): number {
  try {
    const now = io.now ?? new Date();
    const raw = parseRawArgs(argv);
    if (raw.help) {
      console.log(APPROVE_USAGE);
      return 0;
    }

    const validated = validateArgs(raw, now);

    const registryFile = resolve(validated.registryFile);
    const read = readRegistry(registryFile);
    if (!read.ok || !read.parsed) {
      console.error(`[approve] registry could not be loaded:`);
      for (const message of read.messages) console.error(`  ${message}`);
      console.error("[approve] Refusing to modify a registry that could not be fully validated.");
      return 2;
    }

    const entriesById = indexEntries(read.parsed);
    const problems = findProblems(entriesById, validated.entryIds, validated.action);
    if (problems.length > 0) {
      console.error(`[approve] refusing to write — ${problems.length} problem(s) with the requested entries:`);
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }

    const lines: string[] = [];
    for (const id of validated.entryIds) {
      const entry = entriesById.get(id) as Record<string, unknown>;
      if (validated.action.kind === "revoke") {
        entry.status = "draft";
        delete entry.approval;
        lines.push(`[approve] ${id}: revoked (now draft)`);
      } else {
        entry.status = "approved";
        entry.approval = buildApprovalRecord(validated.action, entry, now);
        lines.push(
          validated.action.kind === "approve-delegate"
            ? `[approve] ${id}: approved by delegate ${validated.action.delegate} (pending owner review)`
            : `[approve] ${id}: approved by owner`,
        );
      }
    }

    writeRegistryFile(registryFile, read.parsed);
    for (const line of lines) console.log(line);
    return 0;
  } catch (error) {
    if (error instanceof ApproveInputError) {
      console.error(`writer-check approve: ${error.message}`);
      console.error(`\n${APPROVE_USAGE}`);
      return 2;
    }
    console.error(
      `writer-check approve: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return 2;
  }
}
