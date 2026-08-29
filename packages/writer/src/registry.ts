/**
 * `readCopyRecord` — the one place in this package that touches a
 * filesystem. Everything in `schema.ts` is pure shape; this function is
 * what turns a consumer's real copy registry file into validated data, in
 * the same gather-don't-judge spirit `@example/strategy`'s
 * `readStrategy` uses for a `strategy/` directory: read what's there,
 * validate it, and record — never throw on — anything that could not be
 * turned into usable data. Judgement about what to DO with an unreadable
 * or invalid registry (fail a build, warn, block a release) belongs to
 * the caller, not to this function.
 *
 * Deliberately narrower than `readStrategy`: a `CopyRecord` is a single
 * JSON file, not a directory of several independently-optional files, so
 * there is exactly one thing that can go wrong and exactly one place it
 * can go wrong at.
 */

import { readFileSync } from "node:fs";
import { parseCopyRecord } from "./schema.js";
import type { CopyRecord } from "./types.js";

/**
 * Why `path` did not become a usable `CopyRecord`. `"unreadable"` is a
 * real I/O failure — the file does not exist, a permission was denied, or
 * it vanished mid-read; unknown content could be hiding behind any of
 * those, which is why they are not distinguished further here.
 * `"unparseable"` means the bytes were read but are not valid JSON.
 * `"invalid-schema"` means the JSON parsed but does not satisfy
 * `CopyRecord`'s schema (a missing required field, a wrong type, a
 * duplicate id, a declared placeholder missing from its entry's text) —
 * see `schema.ts`'s `validateCopyRecordShape` for the full list of checks
 * that can produce this.
 */
export type CopyRegistryReadIssueReason = "unreadable" | "unparseable" | "invalid-schema";

export interface CopyRegistryReadIssue {
  reason: CopyRegistryReadIssueReason;
  /** Human-readable detail: the I/O error message, the JSON parse error, or `parseCopyRecord`'s full issue list. */
  detail: string;
}

export interface CopyRegistryReadResult {
  /** The path this result was read from, exactly as given — echoed back for a caller building its own error message. */
  path: string;
  /** The parsed, defaulted `CopyRecord`, or `undefined` if `issues` is non-empty. */
  record?: CopyRecord;
  /** Empty means `path` was read, parsed, and validated cleanly. Non-empty means `record` is `undefined` — see `CopyRegistryReadIssueReason`. */
  issues: CopyRegistryReadIssue[];
  /**
   * `true` exactly when `issues` is empty and `record` is populated.
   * Named to match `@example/strategy`'s `StrategyBundle.complete`
   * and `@clossys/writer/voice`'s `VoiceCheckReport.complete` —
   * "everything this function could have checked, it did, and it found
   * nothing wrong" is the same one-boolean-read contract across all
   * three, on purpose.
   */
  complete: boolean;
}

/**
 * Reads and validates the `CopyRecord` at `path`. Never throws: every
 * failure — an unreadable file, invalid JSON, or a schema violation — is
 * recorded into the returned `CopyRegistryReadResult.issues` and
 * reflected in `.complete`, the same discipline `readStrategy` holds to
 * for a strategy directory.
 */
export function readCopyRecord(path: string): CopyRegistryReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      path,
      issues: [{ reason: "unreadable", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      path,
      issues: [{ reason: "unparseable", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }

  try {
    const record = parseCopyRecord(parsed);
    return { path, record, issues: [], complete: true };
  } catch (error) {
    // parseCopyRecord throws a single Error whose message already lists
    // every validateCopyRecordShape finding, one per line — reused as-is
    // rather than re-deriving the same detail a second way.
    return {
      path,
      issues: [{ reason: "invalid-schema", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }
}
