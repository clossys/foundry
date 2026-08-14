/**
 * `checkAssetCoverage` — compares a list of asset ids a consumer's own
 * documents actually REFERENCE (in practice, every `SlotBinding.assetId`
 * across a set of `@vespeneventures/surface/core` documents, though this
 * function takes a plain `string[]` and has no dependency on `surface/core`
 * itself) against a real `AssetRecord`, and reports both directions of
 * drift: a referenced id with no registered entry (an asset a renderer is
 * about to fail to find), and a registered entry no document currently
 * references (dead weight in the registry, or a sign a rename left a
 * stale entry behind).
 *
 * FIVE AGENTS FINISHED A REPAIR ROUND ON THIS REPOSITORY BEFORE THIS
 * PACKAGE WAS WRITTEN, AND EVERY ONE OF THEM SHIPPED A FIRST DRAFT THAT
 * REPRODUCED THE EXACT DEFECT IT WAS FIXING: "a check that passes while
 * asserting nothing." `@vespeneventures/copy`'s own `checker.ts` was
 * written directly against that failure mode, and this file is too:
 *
 *   1. NO SILENT NARROWING. A referenced id that is not a well-formed
 *      string is never dropped — it is recorded in `report.unchecked`,
 *      by its best-effort description, and forces `report.ok` to `false`.
 *   2. FAILS CLOSED ON A BAD RECORD. This function re-validates `record`
 *      itself (`validateAssetRecordShape`), even though it is a typed
 *      `AssetRecord` a TypeScript caller "should" have already validated
 *      — a plain-JS caller, or a value that merely satisfies the type at
 *      compile time without actually conforming at runtime, is exactly
 *      the case a check that "passes while asserting nothing" would fail
 *      to catch. An invalid `record` sends EVERY referenced id into
 *      `report.unchecked` rather than silently comparing against an
 *      empty or partial registry.
 *   3. ZERO REFERENCED IDS IS NEVER A CLEAN PASS. `report.ok` requires
 *      `checkedCount > 0` — a caller that (by a wiring bug, or simply
 *      because nothing has shipped yet) hands this function an empty
 *      `referencedIds` list gets `ok: false`, never a silent "0 findings"
 *      that reads identically to "checked everything, found nothing
 *      wrong". This is the same non-negotiable distinction
 *      `@vespeneventures/surface/core`'s `resolveCopy` draws for
 *      `texts.length > 0`, one layer over.
 *
 * `unregistered-asset` (severity `"error"`) and `unreferenced-asset`
 * (severity `"warning"`) are real findings, not decoration: an
 * unregistered id means a renderer wired against this registry has
 * nothing to resolve `assetId` to right now; an unreferenced entry is
 * lower severity because it costs nothing to render correctly today, but
 * is still worth surfacing — it is either intentional future inventory or
 * a stale entry a rename left behind, and only a human reviewing the
 * finding can tell which. `report.ok` requires BOTH lists to be empty,
 * the same "findings must be empty, full stop" reading
 * `@vespeneventures/copy`'s own `report.findings` gets, severity aside.
 *
 * `asset-missing-licence` (severity `"warning"`) IS V2's NEW FINDING —
 * NOT A NEW SCHEMA REQUIREMENT
 * ---------------------------------------------------------------------
 * v1's actual gap, per issue #177, was never that `licence` lacked shape
 * validation (`schema.ts`'s `licence-shape` already existed) — it was that
 * a registered entry with NO `licence` at all produced zero signal
 * anywhere. `licence` stays optional in `types.ts`'s `AssetEntryBase` (see
 * that file's own top comment for why making it schema-required would
 * break every already-registered v1 entry on upgrade); THIS file is where
 * the gap actually closes, for every registered entry regardless of
 * whether it is referenced. Warning, not error — matching
 * `unreferenced-asset`'s own severity — because an asset whose licence is
 * unstated is exactly "indistinguishable from one that is unlicensed," a
 * real problem a reviewer needs surfaced, but not one that breaks
 * rendering the way an unregistered id does.
 *
 * `registeredByType` — REPORTING THE DISCRIMINATED SHAPE, NEVER
 * ID-MATCHING ON IT
 * ---------------------------------------------------------------------
 * `checkAssetCoverage`'s own id-comparison loop has no reason to branch on
 * `AssetEntry.type` — an id either matches a registered entry or it
 * doesn't, regardless of what kind of entry it is. `registeredByType`
 * exists purely so a reviewer reading one `AssetCoverageReport` can tell
 * what is actually registered (how many images, how many videos) without
 * re-reading the raw `AssetRecord` JSON — restating information already
 * implicit in `record.entries`, not deriving anything new. The existing
 * three-state `ok`/`checkedCount > 0`/`unchecked` contract (this file's own
 * non-negotiables 1–3, above) is unchanged by this addition.
 */

import { validateAssetRecordShape } from "./schema.js";
import type { AssetEntryId, AssetFinding, AssetRecord } from "./types.js";

/** How many of `record`'s registered entries are each `AssetEntry.type` — see this file's own top comment, "registeredByType". */
export interface AssetTypeCounts {
  image: number;
  video: number;
}

export interface AssetCoverageReport {
  recordId: string;
  /** `referencedIds.length`, exactly as given — restated as its own field, matching this repository's "no silent narrowing" discipline of never making a caller infer a count from an array it has to trust is complete. */
  referencedCount: number;
  /** How many of `referencedIds` were well-formed, non-empty strings actually compared against `record`. Can be less than `referencedCount` — see `unchecked`. `report.ok` requires this to be `> 0`. */
  checkedCount: number;
  /** `record.entries.length`, once `record` is known valid; `0` if `record` itself failed shape validation. */
  registeredCount: number;
  /** `record.entries` broken down by `AssetEntry.type` — see this file's own top comment, "registeredByType". `{ image: 0, video: 0 }` when `record` itself failed shape validation, matching `registeredCount`'s own `0` in that case. */
  registeredByType: AssetTypeCounts;
  /** `"unregistered-asset"` (error) for every checked id with no matching entry, `"unreferenced-asset"` (warning) for every registered entry no checked id named, `"asset-missing-licence"` (warning) for every registered entry (referenced or not) with no `licence`. Never silently dropped. */
  findings: AssetFinding[];
  /**
   * Referenced-id entries this run could not evaluate at all: a
   * non-string/empty entry in `referencedIds` (best-effort described, e.g.
   * `"referencedIds[2] (not a non-empty string)"`), or — if `record` itself
   * failed shape validation — every entry of `referencedIds`, each
   * described as `"<id> (record invalid)"`. MUST force `report.ok` to
   * `false` — the same third state `@vespeneventures/surface/core`'s
   * `resolveCopy`'s own `unchecked` is, deliberately distinct from both "no
   * finding" and "a finding".
   */
  unchecked: string[];
  /**
   * `true` exactly when: `record` was structurally valid, `referencedIds`
   * was a well-formed array, every entry of it was a well-formed string
   * (`unchecked` is empty), AND `checkedCount > 0`. Independent of
   * `findings` — a coverage run that legitimately found real drift is
   * still `ok: false` because of `findings`, not because it "could not
   * run"; the two failure shapes are deliberately not conflated. Read this
   * field, not an empty `findings` array, to decide whether a run can be
   * trusted as "checked everything asked of it, found nothing wrong".
   */
  ok: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function describeReferencedId(value: unknown, index: number): string {
  return `referencedIds[${index}] (not a non-empty string, got ${
    typeof value === "string" ? JSON.stringify(value) : String(value)
  })`;
}

/** `record.entries`, broken down by `type` — see this file's own top comment, "registeredByType". */
function countByType(entries: readonly AssetRecord["entries"][number][]): AssetTypeCounts {
  const counts: AssetTypeCounts = { image: 0, video: 0 };
  for (const entry of entries) {
    if (entry.type === "image") counts.image += 1;
    else counts.video += 1;
  }
  return counts;
}

/**
 * Compares `referencedIds` against `record`. Never throws: an invalid
 * `record`, a non-array `referencedIds`, or malformed individual entries
 * are all recorded into `report.unchecked`/`report.findings` rather than
 * thrown — the same discipline `@vespeneventures/copy`'s `checkCopyRecord`
 * holds to for its own two arguments, restated here for a plain
 * `string[]` rather than a second typed record.
 */
export function checkAssetCoverage(referencedIds: unknown, record: AssetRecord): AssetCoverageReport {
  const recordShapeFindings = validateAssetRecordShape(record);
  const recordIdForReport = isNonEmptyString((record as { id?: unknown })?.id)
    ? (record as { id: string }).id
    : "(unknown)";

  // Non-array referencedIds at all (not even an empty array) is a whole-
  // input problem, distinct from a legitimately-empty array: it is
  // recorded as ONE unchecked entry describing the input itself, rather
  // than zero (which would look identical to "correctly given nothing to
  // check yet"). referencedCount is 0 either way — there is no length to
  // report on a non-array.
  if (!Array.isArray(referencedIds)) {
    return {
      recordId: recordIdForReport,
      referencedCount: 0,
      checkedCount: 0,
      registeredCount: recordShapeFindings.length === 0 ? (record as AssetRecord).entries.length : 0,
      registeredByType: recordShapeFindings.length === 0 ? countByType((record as AssetRecord).entries) : { image: 0, video: 0 },
      findings: recordShapeFindings.map((f) => ({ ...f })),
      unchecked: [`referencedIds (must be an array, got ${referencedIds === undefined ? "undefined" : typeof referencedIds})`],
      ok: false,
    };
  }

  const idsArray: unknown[] = referencedIds;
  const referencedCount = idsArray.length;

  // --- fail closed: the AssetRecord itself must be well-formed -----------
  // Mirrors @vespeneventures/copy's checkCopyRecord: an invalid record
  // means there is no trustworthy registry to compare against, so every
  // referenced id is unchecked rather than silently compared to an empty
  // or partial entry list.
  if (recordShapeFindings.length > 0) {
    const unchecked = idsArray.map((raw, i) =>
      isNonEmptyString(raw) ? `${raw} (record invalid)` : describeReferencedId(raw, i),
    );
    return {
      recordId: recordIdForReport,
      referencedCount,
      checkedCount: 0,
      registeredCount: 0,
      registeredByType: { image: 0, video: 0 },
      findings: recordShapeFindings.map((f) => ({ ...f })),
      unchecked,
      ok: false,
    };
  }

  const validRecord = record as AssetRecord;
  const registeredById = new Map<AssetEntryId, boolean>();
  for (const entry of validRecord.entries) registeredById.set(entry.id, false); // false = not yet seen referenced

  const findings: AssetFinding[] = [];
  const unchecked: string[] = [];
  let checkedCount = 0;

  idsArray.forEach((raw, i) => {
    if (!isNonEmptyString(raw)) {
      unchecked.push(describeReferencedId(raw, i));
      return;
    }
    checkedCount += 1;
    if (registeredById.has(raw)) {
      registeredById.set(raw, true);
    } else {
      findings.push({
        rule: "unregistered-asset",
        severity: "error",
        message: `Referenced asset id "${raw}" (referencedIds[${i}]) has no matching entry in AssetRecord "${recordIdForReport}".`,
        path: raw,
      });
    }
  });

  for (const [id, wasReferenced] of registeredById) {
    if (!wasReferenced) {
      findings.push({
        rule: "unreferenced-asset",
        severity: "warning",
        message: `Registered asset id "${id}" in AssetRecord "${recordIdForReport}" is never referenced by any checked id.`,
        path: id,
      });
    }
  }

  // `asset-missing-licence` — see this file's own top comment. Runs over
  // EVERY registered entry, referenced or not: a missing licence is a
  // property of the entry itself, independent of whether any document
  // currently binds to it.
  for (const entry of validRecord.entries) {
    if (entry.licence === undefined) {
      findings.push({
        rule: "asset-missing-licence",
        severity: "warning",
        message: `Registered asset id "${entry.id}" in AssetRecord "${recordIdForReport}" has no licence — its usage terms are unstated, indistinguishable from being unlicensed.`,
        path: entry.id,
      });
    }
  }

  const ok = checkedCount > 0 && unchecked.length === 0 && findings.length === 0;

  return {
    recordId: recordIdForReport,
    referencedCount,
    checkedCount,
    registeredCount: validRecord.entries.length,
    registeredByType: countByType(validRecord.entries),
    findings,
    unchecked,
    ok,
  };
}
