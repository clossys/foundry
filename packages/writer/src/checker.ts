/**
 * `checkCopyRecord` — runs every entry in a `CopyRecord` through
 * `@clossys/writer/voice`'s own `checkCopy`, against a single
 * `VoiceRecord`, and reports the result. This is the one file in this
 * package that imports `@clossys/writer/voice`: `types.ts` and
 * `schema.ts` are pure, dependency-free data/validation, exactly like
 * `voice`'s own `types.ts`/`schema.ts`; this file is where the two
 * packages' machinery actually meet.
 *
 * FIVE AGENTS FINISHED A REPAIR ROUND ON THIS REPOSITORY AN HOUR BEFORE
 * THIS FILE WAS WRITTEN, AND EVERY ONE OF THEM SHIPPED A FIRST DRAFT THAT
 * REPRODUCED THE EXACT DEFECT IT WAS FIXING. The recurring shape was "a
 * check that passes while asserting nothing" — `checkCopyRecord` IS a
 * check, so this file is written against that failure mode directly, not
 * as an afterthought:
 *
 *   1. NO SILENT NARROWING. If an entry is not run through `checkCopy`
 *      for any reason, it is recorded in `report.skipped`, by id — never
 *      folded silently into a "0 findings" result that looks identical
 *      to "everything ran and was clean". `report.checkedCount` and
 *      `report.skippedCount` are always populated (not just inferable
 *      from array lengths), so a caller reading only those two numbers,
 *      without inspecting either array, still cannot mistake one for the
 *      other.
 *   2. FAILS CLOSED. An invalid `CopyRecord`, an invalid `VoiceRecord`,
 *      or a `CopyRecord` with zero entries are each treated as a
 *      FAILURE — `report.complete` is `false` and `report.findings`
 *      names the reason — never as a clean pass with nothing to check.
 *      `checkCopyRecord` re-validates BOTH its arguments itself
 *      (`validateCopyRecordShape` and, imported from `voice`,
 *      `validateVoiceRecordShape`), even though both are typed inputs a
 *      TypeScript caller "should" have already validated — because a
 *      plain-JS caller, or a value that merely satisfies the type at
 *      compile time without actually conforming at runtime, is exactly
 *      the case a check that "passes while asserting nothing" would fail
 *      to catch. This is a deliberate difference from `voice`'s own
 *      `checkCopy`, which does NOT self-validate its `VoiceRecord`
 *      argument (see that function's own doc comment) — this package
 *      chooses the stricter behavior for its own entry point because it
 *      is the thing this whole package's design brief was written to
 *      distrust in itself.
 *   3. `report.complete` MEANS "did this run check everything it could
 *      have", never "did everything pass" — the same non-negotiable
 *      distinction `voice`'s own `VoiceCheckReport.complete` draws. A
 *      `CopyRecord` with real voice violations in it can still be
 *      `complete: true` (every entry got checked; some of them failed);
 *      a `CopyRecord` this function refused to check at all is always
 *      `complete: false`, no matter how "clean" an empty `findings`
 *      array might otherwise look.
 *
 * Pure, no I/O: `checkCopyRecord` never reads a file — that is
 * `registry.ts`'s job — and never resolves a `factRef` against anything,
 * for the same reason `voice`'s `checkCopy` does not: see
 * `@clossys/writer/voice`'s README, "The `factRef` seam".
 */

import {
  checkCopy,
  validateVoiceRecordShape,
  type VoiceCheckReport,
  type VoiceCheckWaiver,
  type VoiceFinding,
  type VoiceRecord,
} from "./voice/index.js";
import { validateCopyRecordShape } from "./schema.js";
import type { CopyEntryId, CopyRecord } from "./types.js";

/** One entry `checkCopyRecord` did NOT run through `voice`'s `checkCopy` this run, and why. */
export interface CopyEntrySkip {
  entryId: CopyEntryId;
  /**
   * Human-readable reason. In practice always because the `CopyRecord` or
   * `VoiceRecord` given to this call failed its own shape validation —
   * see `report.findings` for the specific violation(s). An entry that
   * passes `validateCopyRecordShape` (id well-formed and unique, `text`
   * and `context` non-empty, every declared placeholder present) is
   * always run, never skipped for a reason internal to the entry itself;
   * `voice`'s own `checkCopy` has its own, separately-reported notion of
   * an incomplete run (see `CopyEntryCheckResult.report.skipped`) for a
   * dimension it could not evaluate against a structurally valid entry.
   */
  reason: string;
}

/** One entry `checkCopyRecord` DID run through `voice`'s `checkCopy`, and the resulting report. */
export interface CopyEntryCheckResult {
  entryId: CopyEntryId;
  /**
   * `voice`'s own `checkCopy` report for this entry's `text`, unmodified.
   * Its own `.complete`/`.skipped` describe whether `checkCopy` itself
   * could evaluate every dimension against this ONE entry — a separate
   * question from whether `checkCopyRecord` ran this entry at all.
   */
  report: VoiceCheckReport;
}

/** One `VoiceFinding` from one entry's `checkCopy` run, flattened into `report.findings` and tagged with the entry it came from. */
export interface CopyRecordFinding extends VoiceFinding {
  /** The entry this finding is about, or `undefined` for a record-level finding not specific to any one entry (an invalid `CopyRecord`/`VoiceRecord`, or zero entries). */
  entryId?: CopyEntryId;
}

/** A `CopyRecordFinding` that was waived, with the waiver that covered it — mirrors `voice`'s `WaivedVoiceFinding`. */
export interface CopyRecordWaivedFinding extends CopyRecordFinding {
  waiver: VoiceCheckWaiver;
}

export interface CopyRecordCheckOptions {
  /**
   * Waivers applied uniformly to EVERY entry's `checkCopy` call — the
   * same `VoiceCheckWaiver[]` shape `voice`'s own `checkCopy` accepts.
   * There is no per-entry waiver targeting in this version: a waiver
   * scoped to one entry's finding still matches the same `rule`+`path`
   * pair in every other entry's report too. A caller that genuinely needs
   * per-entry waiver scoping can call `voice`'s `checkCopy` directly,
   * per entry, with its own waiver list — this package's own `checker.ts`
   * does exactly that under the hood.
   */
  waivers?: VoiceCheckWaiver[];
}

export interface CopyRecordCheckReport {
  recordId: string;
  /** Every entry actually run through `checkCopy`, with its own `VoiceCheckReport`. */
  checked: CopyEntryCheckResult[];
  /** Every entry NOT run, by id, and why. Empty does not by itself mean "nothing was skipped for a bad reason" — see `report.complete`, which is `false` whenever this run could not be trusted enough to check every entry, including the cases where this is legitimately `[]` (zero entries; see `checkedCount`). */
  skipped: CopyEntrySkip[];
  /** `checked.length`, restated as its own field so a caller does not have to inspect the array to get this number — see this file's top-of-file "no silent narrowing" note. */
  checkedCount: number;
  /** `skipped.length`, restated as its own field for the same reason as `checkedCount`. */
  skippedCount: number;
  /**
   * Every non-waived finding this run produced, flattened across every
   * checked entry AND any record-level problem (an invalid `CopyRecord`,
   * an invalid `VoiceRecord`, or zero entries), each entry-sourced
   * finding tagged with the `entryId` it came from. This is the one field
   * a caller checking "is anything wrong" should read — it is populated
   * in every failure case this function knows about, never left empty to
   * imply a clean run when the run in fact could not be trusted (see
   * `.complete`).
   */
  findings: CopyRecordFinding[];
  /** Every finding covered by a waiver, across every checked entry, each with the waiver that covered it — mirrors `voice`'s `VoiceCheckReport.waived`. */
  waived: CopyRecordWaivedFinding[];
  /**
   * `true` exactly when: the given `CopyRecord` was structurally valid,
   * the given `VoiceRecord` was structurally valid, the record had at
   * least one entry, and every entry was actually run (`skipped` is
   * empty). `false` in every other case. Independent of `findings` —
   * see this file's top-of-file note #3. Read this field, not an empty
   * `findings` array, to decide whether a run can be trusted as "checked
   * everything, found nothing".
   */
  complete: boolean;
}

function recordLevelFailure(
  recordId: string,
  findings: CopyRecordFinding[],
  skipped: CopyEntrySkip[],
): CopyRecordCheckReport {
  return {
    recordId,
    checked: [],
    skipped,
    checkedCount: 0,
    skippedCount: skipped.length,
    findings,
    waived: [],
    complete: false,
  };
}

/**
 * Best-effort per-entry skip attribution for a `CopyRecord` whose own
 * shape is invalid. `record.entries` is typed as `CopyEntry[]`, but the
 * whole point of the branch that calls this is that the type cannot be
 * trusted at runtime — so this reads defensively, using whatever id it
 * can find and falling back to a positional label (`"$3"`, meaning index
 * 3) for an entry too malformed to have a usable id at all. Never throws.
 */
function bestEffortSkipList(entriesValue: unknown, reason: string): CopyEntrySkip[] {
  if (!Array.isArray(entriesValue)) return [];
  return entriesValue.map((entry, i) => {
    const hasUsableId =
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      ((entry as Record<string, unknown>).id as string).length > 0;
    const entryId = hasUsableId ? ((entry as Record<string, unknown>).id as string) : `$${i}`;
    return { entryId, reason };
  });
}

/**
 * Checks every entry in `record` against `voiceRecord`, via `voice`'s own
 * `checkCopy`. See this file's top-of-file doc comment for the fail-
 * closed behavior on an invalid `record`, an invalid `voiceRecord`, and a
 * `record` with zero entries.
 *
 * Throws a plain `Error` (not a finding) for caller-input problems that
 * are not this function's job to interpret as data: `record` or
 * `voiceRecord` not an object at all. This mirrors `voice`'s own
 * `checkCopy`, which treats a malformed call the same way — a hard
 * upfront rejection, not a soft finding that could be mistaken for
 * something the checker discovered about the record itself. A `record`
 * or `voiceRecord` that IS an object but fails shape validation is,
 * unlike a non-object, a real finding (`report.findings`), not a thrown
 * error — see note #2 above for why this function validates both itself
 * rather than trusting its own type signature.
 */
export function checkCopyRecord(
  record: CopyRecord,
  voiceRecord: VoiceRecord,
  options: CopyRecordCheckOptions = {},
): CopyRecordCheckReport {
  if (record === null || typeof record !== "object") {
    throw new TypeError("checkCopyRecord: record must be a CopyRecord object");
  }
  if (voiceRecord === null || typeof voiceRecord !== "object") {
    throw new TypeError("checkCopyRecord: voiceRecord must be a VoiceRecord object");
  }

  const recordIdForReport = isNonEmptyStringField(record, "id") ? (record as { id: string }).id : "(unknown)";

  // --- fail closed: the CopyRecord itself must be well-formed --------------
  const recordShapeFindings = validateCopyRecordShape(record);
  if (recordShapeFindings.length > 0) {
    const findings: CopyRecordFinding[] = recordShapeFindings.map((f) => ({ ...f }));
    const entriesValue = (record as unknown as Record<string, unknown>).entries;
    return recordLevelFailure(recordIdForReport, findings, bestEffortSkipList(entriesValue, "record-shape-invalid"));
  }

  // --- fail closed: the VoiceRecord itself must be well-formed --------------
  // Unlike voice's own checkCopy, this function does not trust its typed
  // input — see this file's top-of-file note #2 for why.
  const voiceShapeFindings = validateVoiceRecordShape(voiceRecord);
  if (voiceShapeFindings.length > 0) {
    const findings: CopyRecordFinding[] = voiceShapeFindings.map((f) => ({ ...f }));
    // record is now known well-formed (previous branch would have returned
    // otherwise), so every entry has a real, unique id to attribute a skip to.
    const skipped: CopyEntrySkip[] = record.entries.map((entry) => ({
      entryId: entry.id,
      reason: "voice-record-invalid",
    }));
    return recordLevelFailure(recordIdForReport, findings, skipped);
  }

  // --- fail closed: zero entries is nothing to check, not a clean pass -----
  if (record.entries.length === 0) {
    const findings: CopyRecordFinding[] = [
      {
        rule: "record:no-entries",
        severity: "error",
        message: `CopyRecord "${recordIdForReport}" has zero entries — there is nothing for checkCopyRecord to check.`,
      },
    ];
    return recordLevelFailure(recordIdForReport, findings, []);
  }

  // --- the real work: run every entry through voice's checkCopy ------------
  const checked: CopyEntryCheckResult[] = [];
  const findings: CopyRecordFinding[] = [];
  const waived: CopyRecordWaivedFinding[] = [];

  for (const entry of record.entries) {
    const entryReport = checkCopy(voiceRecord, entry.text, { waivers: options.waivers });
    checked.push({ entryId: entry.id, report: entryReport });
    for (const finding of entryReport.findings) {
      findings.push({ ...finding, entryId: entry.id });
    }
    for (const w of entryReport.waived) {
      waived.push({ ...w, entryId: entry.id });
    }
  }

  return {
    recordId: recordIdForReport,
    checked,
    skipped: [],
    checkedCount: checked.length,
    skippedCount: 0,
    findings,
    waived,
    complete: true,
  };
}

function isNonEmptyStringField(value: object, key: string): boolean {
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0;
}
