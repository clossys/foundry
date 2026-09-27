/**
 * Approval-record helpers shared by the schema, `writer-check approve` and
 * `writer-check approval-state`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { CopyApproval, CopyRegistry, CopyRegistryEntry } from "./types.js";
import { computeCopyFingerprint } from "./fingerprint.js";
import { checkApprovalBypass, scanApprovalBypass, type ApprovalBypassFinding, type ApprovalBypassGateResult, type ApprovalBypassScanResult, type ApprovalBypassUncheckedItem } from "./approval-bypass.js";
import { parseCopyRegistry } from "./schema.js";

/**
 * One delegate scope item: a dot-separated entry-id namespace with no
 * wildcard, e.g. `"site"` or `"site.home"`. Unlike `CopyEntryId`, a single
 * segment is allowed, because a namespace may be a top-level one.
 */
export const COPY_DELEGATE_SCOPE_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;

/** True when `value` is a well-formed delegate scope item. */
export function isDelegateScopeItem(value: unknown): value is string {
  return typeof value === "string" && COPY_DELEGATE_SCOPE_RE.test(value);
}

/**
 * True when `entryId` falls inside one of `scope`'s namespaces: it equals an
 * item, or starts with `item + "."`. `"site.home"` covers `"site.home"` and
 * `"site.home.title"`, never `"site.homepage.title"`.
 */
export function isEntryInDelegateScope(entryId: string, scope: readonly string[]): boolean {
  return scope.some((item) => entryId === item || entryId.startsWith(`${item}.`));
}

/**
 * True when `entry`'s recorded `textFingerprint` no longer matches its
 * current `text` — the record was made for wording that has since changed.
 * Exported so `resolve.ts` and `assessCopyApprovals` share one predicate
 * rather than two independently-drifting copies of the same comparison.
 */
export function isApprovalStale(entry: Pick<CopyRegistryEntry, "text" | "approval">): boolean {
  const approval = entry.approval;
  if (!approval) return false;
  return computeCopyFingerprint(entry.text) !== approval.textFingerprint;
}

/** True when `approval.expiresAt` is set and has passed as of `now`. */
export function isApprovalExpired(approval: CopyApproval, now: Date): boolean {
  return approval.expiresAt !== undefined && now.getTime() >= Date.parse(approval.expiresAt);
}

/** The rule an `assessCopyApprovals` finding was raised for. */
export type CopyApprovalFindingRule =
  | "approval-stale"
  | "approval-expired"
  | "approval-pending-owner-review"
  | "approval-record-missing";

/** One thing `assessCopyApprovals` found about the current approval state of a registry entry. */
export interface CopyApprovalFinding {
  rule: CopyApprovalFindingRule;
  severity: "error" | "warning";
  entryId: string;
  message: string;
}

/**
 * Reports the current approval state of every `approved` entry in
 * `registry` — draft and retired entries have nothing to approve and are
 * ignored. An `approved` entry with no record at all is a warning
 * (`approval-record-missing`): the pre-record state every registry started
 * in, not yet a defect. A record that no longer matches its entry's text
 * (`approval-stale`) or has passed its `expiresAt` (`approval-expired`) is
 * an error — the checks are mutually exclusive, staleness taking priority
 * since an expired-but-also-stale record's fingerprint mismatch is the more
 * fundamental problem. A current delegate record still awaiting owner
 * sign-off (`pendingOwnerReview: true`) is a warning, not an error: the
 * entry is legitimately approved for now, just not yet durably so.
 */
export function assessCopyApprovals(registry: CopyRegistry, now: Date): CopyApprovalFinding[] {
  const findings: CopyApprovalFinding[] = [];
  for (const entry of registry.entries) {
    if (entry.status !== "approved") continue;
    const approval = entry.approval;
    if (!approval) {
      findings.push({
        rule: "approval-record-missing",
        severity: "warning",
        entryId: entry.id,
        message: `Entry "${entry.id}" is approved but has no approval record.`,
      });
      continue;
    }
    if (isApprovalStale(entry)) {
      findings.push({
        rule: "approval-stale",
        severity: "error",
        entryId: entry.id,
        message: `Entry "${entry.id}"'s approval record no longer matches its current text.`,
      });
      continue;
    }
    if (isApprovalExpired(approval, now)) {
      findings.push({
        rule: "approval-expired",
        severity: "error",
        entryId: entry.id,
        message: `Entry "${entry.id}"'s approval expired at ${approval.expiresAt}.`,
      });
      continue;
    }
    if (approval.approvedBy === "delegate" && approval.pendingOwnerReview === true) {
      findings.push({
        rule: "approval-pending-owner-review",
        severity: "warning",
        entryId: entry.id,
        message: `Entry "${entry.id}" was approved by a delegate and is still awaiting owner review.`,
      });
    }
  }
  return findings;
}

// ============================================================================
// `writer-check approval-state` — combines TWO independent checks into one
// three-state verdict: `assessCopyApprovals` above (is the REGISTRY's own
// approval bookkeeping current — no stale or expired record, no delegate
// record stuck pending review) and `scanApprovalBypass`/`checkApprovalBypass`
// (`./approval-bypass.ts`) (does CONSUMER SOURCE actually route copy through
// that bookkeeping, or around it). Either half can fail independently: a
// registry can be perfectly current while a component still hard-codes
// `status: "approved"`, and a codebase can route every read through
// `createCopyResolver` while the registry itself carries a record that has
// gone stale. This command is the one place both are reported together,
// under one exit code.
//
// Not exported from `index.ts` (like `mainApproveCommand` in
// `approve-cli.ts`) — this is CLI surface, dispatched from `cli.ts`'s
// bottom-of-file `argv[0]` branch, not library surface.
// ============================================================================

export const APPROVAL_STATE_USAGE = `Usage: writer-check approval-state <registry-file> <scan-dir> [options]

  registry-file  Path to a CopyRegistry JSON file. Required.
  scan-dir       Directory to scan for approval-bypass patterns in consumer source. Required.

Reports the current approval state of a copy registry from two angles: is
every approved entry's own record current (see assessCopyApprovals in
approval.ts — a stale or expired record is an error; a missing record or a
delegate record still pending owner review is a warning), and does consumer
source in scan-dir actually route copy through the registry's approval
lifecycle rather than around it (see scanApprovalBypass/checkApprovalBypass
in approval-bypass.ts — approval-set-in-code and copy-read-without-resolver
are errors; an unchecked registry load or reference is neither a pass nor a
finding, just an incomplete picture).

Options:
  --help                   Print this message and exit 0.
  --extensions <ext>[,<ext>...]  File extension(s) to scan, including the leading dot (for example .mjs). Repeatable, and each occurrence may itself be a comma-separated list; values union across both forms. When omitted, default is .ts, .tsx, .js, .jsx. Every value must include the leading dot; a flag that resolves to zero extensions is a usage error.
  --format <json>          When "json", prints exactly one machine-readable object ({ verdict, findings, unchecked, counts }) to stdout instead of the human-readable report. Any other value is a usage error.
  --now <ISO>              ISO 8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ, optionally with milliseconds) to evaluate staleness/expiry against. Defaults to the current time.

Exit codes: 0 = satisfied (every approved entry's record is current, no
approval-bypass finding, nothing left unchecked, and at least one file was
scanned), 1 = violated (at least one error-severity registry finding —
approval-stale or approval-expired — or at least one approval-bypass finding
— approval-set-in-code or copy-read-without-resolver), 2 = could not run or
indeterminate (bad arguments; the registry file is missing/unreadable/not
valid JSON/fails validateCopyRegistryShape; scan-dir is not a directory; the
scan itself could not run; or — with zero error-severity finding — at least
one unchecked registry load/reference, at least one file that failed to
parse, or zero files scanned). Warnings never change the exit code.
`;

/** Bad arguments only — mirrors `approve-cli.ts`'s `ApproveInputError`. */
class ApprovalStateInputError extends Error {}

const APPROVAL_STATE_EXTENSION_RE = /^\.[a-zA-Z0-9]+$/;
/** Same shape schema.ts's own (unexported) `ISO_UTC_TIMESTAMP_RE` accepts. */
const APPROVAL_STATE_NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

interface ApprovalStateParsedArgs {
  registryFile?: string;
  scanDir?: string;
  /** Set only when the caller passed at least one `--extensions` flag. */
  extensions?: string[];
  format: "text" | "json";
  now?: string;
  help: boolean;
}

/**
 * Parses `--extensions` with the identical rules `cli.ts`'s
 * `parseAddressabilityArgs` applies to its own `--extensions` flag —
 * repeatable, comma-separated, leading dot required, an empty resolved set
 * is a usage error rather than a silent fallback to the default. Duplicated
 * rather than imported from `cli.ts`, since `cli.ts` imports this file's
 * `mainApprovalStateCommand` — importing back would create a real
 * value-level cycle between the two, unlike the `schema.ts` cycle this
 * file's `parseCopyRegistry` import already tolerates (see this section's
 * top doc comment).
 */
function parseApprovalStateArgs(argv: string[]): ApprovalStateParsedArgs {
  let registryFile: string | undefined;
  let scanDir: string | undefined;
  const extensions: string[] = [];
  let sawExtensions = false;
  let format: "text" | "json" = "text";
  let now: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--extensions") {
      sawExtensions = true;
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new ApprovalStateInputError("--extensions requires an extension such as .mjs");
      }
      const tokens = value.split(",");
      if (tokens.length === 0 || tokens.some((token) => token.trim().length === 0)) {
        throw new ApprovalStateInputError(
          `--extensions requires at least one non-empty extension such as .mjs, got ${JSON.stringify(value)}`,
        );
      }
      for (const rawToken of tokens) {
        const token = rawToken.trim().toLowerCase();
        if (!token.startsWith(".")) {
          throw new ApprovalStateInputError(`--extensions values must include the leading dot, got ${JSON.stringify(token)}`);
        }
        if (!APPROVAL_STATE_EXTENSION_RE.test(token)) {
          throw new ApprovalStateInputError(`invalid --extensions value ${JSON.stringify(token)}`);
        }
        extensions.push(token);
      }
      continue;
    }
    if (arg === "--format") {
      const value = argv[++i];
      if (value !== "json") {
        throw new ApprovalStateInputError(`--format only accepts "json", got ${JSON.stringify(value)}`);
      }
      format = "json";
      continue;
    }
    if (arg === "--now") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new ApprovalStateInputError("--now requires an ISO 8601 UTC timestamp");
      }
      now = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ApprovalStateInputError(`unknown flag "${arg}"`);
    }
    if (registryFile === undefined) {
      registryFile = arg;
    } else if (scanDir === undefined) {
      scanDir = arg;
    } else {
      throw new ApprovalStateInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { registryFile, scanDir, extensions: sawExtensions ? extensions : undefined, format, now, help };
}

function parseApprovalStateNow(raw: string | undefined): Date {
  if (raw === undefined) return new Date();
  if (!APPROVAL_STATE_NOW_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ApprovalStateInputError(`--now must be an ISO 8601 UTC timestamp (e.g. 2026-01-01T00:00:00Z), got ${JSON.stringify(raw)}`);
  }
  return new Date(raw);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ApprovalStateUnchecked {
  file: string;
  line: number;
  kind: string;
  detail: string;
}

type ApprovalStateVerdict = "violated" | "indeterminate" | "satisfied";

function combineUnchecked(scan: ApprovalBypassScanResult, bypass: ApprovalBypassGateResult): ApprovalStateUnchecked[] {
  const fromParseFailures: ApprovalStateUnchecked[] = scan.parseFailures.map((p) => ({
    file: p.file,
    line: 0,
    kind: "parse-failure",
    detail: p.detail,
  }));
  return [...(bypass.unchecked as ApprovalBypassUncheckedItem[]), ...fromParseFailures];
}

function computeApprovalStateVerdict(registryFindings: CopyApprovalFinding[], bypass: ApprovalBypassGateResult): ApprovalStateVerdict {
  const hasRegistryError = registryFindings.some((f) => f.severity === "error");
  if (hasRegistryError || bypass.verdict === "violated") return "violated";
  if (bypass.verdict === "indeterminate") return "indeterminate";
  return "satisfied";
}

function approvalStateExitCode(verdict: ApprovalStateVerdict): number {
  return verdict === "violated" ? 1 : verdict === "indeterminate" ? 2 : 0;
}

/**
 * Emitted when this command cannot even reach the point of scanning (a bad
 * registry file, an unusable scan-dir, or the scan itself throwing) — always
 * exit 2, always `verdict: "indeterminate"` in JSON mode, with `error`
 * naming the reason. Bad ARGUMENTS never reach here — those are caught in
 * `mainApprovalStateCommand`'s own outer catch, before `--format` is even
 * meaningfully known to matter, and always print usage to stderr regardless
 * of `--format`.
 */
function emitApprovalStateCouldNotRun(format: "text" | "json", reason: string): number {
  if (format === "json") {
    console.log(
      JSON.stringify({
        verdict: "indeterminate",
        findings: [],
        unchecked: [],
        counts: { errors: 0, warnings: 0, unchecked: 0, filesScanned: 0, coupledFiles: 0 },
        error: reason,
      }),
    );
  } else {
    console.error(`[approval-state] could not run: ${reason}`);
  }
  return 2;
}

/**
 * Prints the human-text or `--format json` report and returns the exit code
 * — the one place `assessCopyApprovals`' registry findings and
 * `checkApprovalBypass`'s source findings are merged into a single verdict.
 * See this section's top doc comment for why the two are combined rather
 * than reported as two separate commands.
 */
function reportApprovalState(
  format: "text" | "json",
  registryPath: string,
  scanDirPath: string,
  registryFindings: CopyApprovalFinding[],
  scan: ApprovalBypassScanResult,
  bypass: ApprovalBypassGateResult,
): number {
  const verdict = computeApprovalStateVerdict(registryFindings, bypass);
  const exitCode = approvalStateExitCode(verdict);

  const registryErrors = registryFindings.filter((f) => f.severity === "error");
  const registryWarnings = registryFindings.filter((f) => f.severity === "warning");
  const unchecked = combineUnchecked(scan, bypass);
  const errorCount = registryErrors.length + bypass.findings.length;

  if (format === "json") {
    const findings = [
      ...registryFindings.map((f) => ({ source: "registry" as const, rule: f.rule, severity: f.severity, entryId: f.entryId, message: f.message })),
      ...bypass.findings.map((f: ApprovalBypassFinding) => ({ source: "source" as const, rule: f.rule, severity: f.severity, file: f.file, line: f.line, message: f.detail })),
    ];
    console.log(
      JSON.stringify({
        verdict,
        findings,
        unchecked,
        counts: {
          errors: errorCount,
          warnings: registryWarnings.length,
          unchecked: unchecked.length,
          filesScanned: scan.filesScanned,
          coupledFiles: scan.coupledFiles.length,
        },
      }),
    );
    return exitCode;
  }

  console.log(`[approval-state] registry: ${registryPath}`);
  console.log(`[approval-state] scan dir: ${scanDirPath}`);
  console.log(
    `[approval-state] ${errorCount} error(s), ${registryWarnings.length} warning(s), ${unchecked.length} unchecked item(s), ${scan.filesScanned} file(s) scanned, ${scan.coupledFiles.length} coupled file(s).`,
  );
  for (const f of registryErrors) {
    console.log(`[approval-state] [${f.rule}] ${f.entryId}: ${f.message}`);
  }
  for (const f of bypass.findings) {
    console.log(`[approval-state] [${f.rule}] ${f.file}:${f.line} ${f.detail}`);
  }
  if (registryWarnings.length > 0) {
    console.log(`[approval-state] warnings:`);
    for (const f of registryWarnings) {
      console.log(`[approval-state]   [${f.rule}] ${f.entryId}: ${f.message}`);
    }
  }
  if (unchecked.length > 0) {
    console.log(`[approval-state] unchecked:`);
    for (const u of unchecked) {
      console.log(`[approval-state]   [${u.kind}] ${u.file}:${u.line} ${u.detail}`);
    }
  }
  if (bypass.reasons.length > 0) {
    console.log(`[approval-state] reasons:`);
    for (const r of bypass.reasons) {
      console.log(`[approval-state]   ${r}`);
    }
  }
  console.log(`[approval-state] verdict: ${verdict}`);
  return exitCode;
}

/**
 * Exported (unlike a typical CLI `main`) so this package's tests (which do
 * not ship) can exercise the whole argv-to-exit-code contract directly, without spawning a subprocess —
 * the same discipline `mainApproveCommand` (`approve-cli.ts`) and
 * `mainAddressabilityCheck`/`mainPassagesCheck` (`cli.ts`) already hold to.
 * `argv` excludes the leading `"approval-state"` token. Never throws: every
 * failure, expected or not, is caught here and mapped to exit code 2.
 */
export function mainApprovalStateCommand(argv: string[]): number {
  try {
    const args = parseApprovalStateArgs(argv);
    if (args.help) {
      console.log(APPROVAL_STATE_USAGE);
      return 0;
    }
    if (args.registryFile === undefined) {
      throw new ApprovalStateInputError("registry-file is required");
    }
    if (args.scanDir === undefined) {
      throw new ApprovalStateInputError("scan-dir is required");
    }
    const now = parseApprovalStateNow(args.now);

    const registryPath = resolve(process.cwd(), args.registryFile);
    const scanDirPath = resolve(process.cwd(), args.scanDir);

    let raw: string;
    try {
      raw = readFileSync(registryPath, "utf8");
    } catch (error) {
      return emitApprovalStateCouldNotRun(args.format, `registry file "${registryPath}" could not be read: ${errorMessage(error)}`);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      return emitApprovalStateCouldNotRun(args.format, `registry file "${registryPath}" is not valid JSON: ${errorMessage(error)}`);
    }

    let registry: CopyRegistry;
    try {
      registry = parseCopyRegistry(parsedJson);
    } catch (error) {
      return emitApprovalStateCouldNotRun(args.format, errorMessage(error));
    }

    if (!existsSync(scanDirPath) || !statSync(scanDirPath).isDirectory()) {
      return emitApprovalStateCouldNotRun(args.format, `scan-dir "${scanDirPath}" is not a directory`);
    }

    const registryFindings = assessCopyApprovals(registry, now);

    let scan: ApprovalBypassScanResult;
    try {
      scan = scanApprovalBypass(scanDirPath, { registryPath, extensions: args.extensions });
    } catch (error) {
      return emitApprovalStateCouldNotRun(args.format, errorMessage(error));
    }
    const bypass = checkApprovalBypass(scan);

    return reportApprovalState(args.format, registryPath, scanDirPath, registryFindings, scan, bypass);
  } catch (error) {
    if (error instanceof ApprovalStateInputError) {
      console.error(`writer-check approval-state: ${error.message}`);
      console.error(`\n${APPROVAL_STATE_USAGE}`);
      return 2;
    }
    console.error(
      `writer-check approval-state: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return 2;
  }
}
