/**
 * Structural validation for a candidate `AssetRecord`, hand-rolled in the
 * same plain-type-guard, accumulate-and-keep-going style as
 * `@vespeneventures/copy`'s `schema.ts` — no schema library, for the same
 * reason that file gives: this package's entire job is dependency-free data
 * validation, and a public package should not force every consumer onto one
 * schema library's major version for the sake of shape-checking a handful
 * of nested objects.
 *
 * Every check here is a REAL check, not decoration — this repository has
 * already deleted one whole package (`contract`) for shipping checks that
 * were all mechanically re-derivable from data already present elsewhere.
 * Two checks here are worth calling out because this repository has been
 * bitten by both failure modes before, more than once:
 *
 *   - **`alt-not-whitespace-only`.** A whitespace-only `alt` (`"   "`)
 *     passes a naive `.length > 0` check while rendering as no alt text at
 *     all — the exact gap `@vespeneventures/surface/core`'s `validate.ts` had to
 *     add a SECOND, stricter check for (`binding-value-shape`, over and
 *     above `isNonEmptyString`) after a whitespace-only `SlotBinding.value`
 *     slipped past the first one. This package holds that same stricter
 *     line from the start, in the one place (`alt`) it matters most: an
 *     asset registry that lets whitespace-only alt text validate clean
 *     produces inaccessible output for every consumer of every entry that
 *     slips through.
 *   - **`id-unique`.** A duplicate id is not a cosmetic problem — the
 *     second entry silently shadows the first the moment anything indexes
 *     this record by id (`registry.ts`, `coverage.ts`, a future renderer),
 *     so which asset a given `assetId` actually resolves to becomes
 *     order-dependent and unreviewable. Checked at the record level, the
 *     same way `@vespeneventures/copy`'s `schema.ts` checks
 *     `CopyEntryId` uniqueness.
 */

import type { AssetEntry, AssetEntryId, AssetFinding, AssetRecord } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Stricter than a bare non-empty check for a field where a whitespace-only string is a real bug, not a valid value — see this file's top comment. `isNonEmptyString` above already does the `.trim()` check, but this alias exists so the specific fields that rely on it (`alt`, `src`) read as an intentional choice, not an accident of `isNonEmptyString`'s own implementation. */
const isNonEmptyNonWhitespaceString = isNonEmptyString;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A short, readable description of an arbitrary value for an error message — mirrors `@vespeneventures/surface/core`'s `validate.ts`'s `describe` and `@vespeneventures/strategy`'s `validation.ts`'s `describeValue`. */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} item(s))`;
  const t = typeof value;
  if (t === "object") return "an object";
  if (t === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * `AssetEntryId` shape: dot-separated, lowercase, kebab-case within each
 * segment, at least one dot (i.e. at least two segments) — e.g.
 * `"marketing.hero-banner"`. Identical pattern to
 * `@vespeneventures/copy`'s own `COPY_ENTRY_ID_RE` — see `types.ts`'s doc
 * comment on `AssetEntryId` for why a bare, unnamespaced id is rejected
 * rather than merely discouraged.
 */
const ASSET_ENTRY_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

// Rules: entry-shape, id-shape, id-well-formed, src-shape, width-positive,
// height-positive, alt-shape, alt-not-whitespace-only, mime-type-shape,
// licence-shape, credit-shape
function validateAssetEntryShape(value: unknown, path: string): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "entry-shape", severity: "error", message: `${path} must be an object.`, path }];
  }

  // Snapshot every field this function reads, exactly once, before any
  // check runs — mirroring @vespeneventures/copy's schema.ts and
  // @vespeneventures/surface/core's validate.ts, both of which document why: a
  // hostile or merely-badly-behaved `value` (a field implemented as a
  // getter, or a Proxy) could otherwise return a different result on each
  // property read.
  const id = value.id;
  const src = value.src;
  const width = value.width;
  const height = value.height;
  const alt = value.alt;
  const mimeType = value.mimeType;
  const licence = value.licence;
  const credit = value.credit;

  const findings: AssetFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `${path}.id must be a non-empty string, got ${describe(id)}.`,
      path: `${path}.id`,
    });
  } else if (!ASSET_ENTRY_ID_RE.test(id)) {
    findings.push({
      rule: "id-well-formed",
      severity: "error",
      message: `${path}.id "${id}" must be dot-separated and lowercase, with at least one dot (e.g. "marketing.hero-banner"), got ${describe(id)}.`,
      path: `${path}.id`,
    });
  }

  if (!isNonEmptyNonWhitespaceString(src)) {
    findings.push({
      rule: "src-shape",
      severity: "error",
      message: `${path}.src must be a non-empty string, got ${describe(src)}.`,
      path: `${path}.src`,
    });
  }

  if (!(isFiniteNumber(width) && width > 0)) {
    findings.push({
      rule: "width-positive",
      severity: "error",
      message: `${path}.width must be a positive number, got ${describe(width)}.`,
      path: `${path}.width`,
    });
  }

  if (!(isFiniteNumber(height) && height > 0)) {
    findings.push({
      rule: "height-positive",
      severity: "error",
      message: `${path}.height must be a positive number, got ${describe(height)}.`,
      path: `${path}.height`,
    });
  }

  // The real check for `alt`: not just "present", but present and NOT
  // whitespace-only. See this file's top comment for why this is not
  // decoration — `isNonEmptyString` above already does the `.trim()` work,
  // so a plain `typeof alt === "string" && alt.length > 0` value that is
  // ALL whitespace fails here rather than validating clean.
  if (typeof alt !== "string" || alt.length === 0) {
    findings.push({
      rule: "alt-shape",
      severity: "error",
      message: `${path}.alt must be a non-empty string, got ${describe(alt)}.`,
      path: `${path}.alt`,
    });
  } else if (alt.trim().length === 0) {
    findings.push({
      rule: "alt-not-whitespace-only",
      severity: "error",
      message: `${path}.alt must not be whitespace-only, got ${JSON.stringify(alt)}. Whitespace-only alt text renders as no alt text at all.`,
      path: `${path}.alt`,
    });
  }

  if (mimeType !== undefined && !isNonEmptyString(mimeType)) {
    findings.push({
      rule: "mime-type-shape",
      severity: "error",
      message: `${path}.mimeType must be a non-empty string when present, got ${describe(mimeType)}.`,
      path: `${path}.mimeType`,
    });
  }

  if (licence !== undefined && !isNonEmptyString(licence)) {
    findings.push({
      rule: "licence-shape",
      severity: "error",
      message: `${path}.licence must be a non-empty string when present, got ${describe(licence)}.`,
      path: `${path}.licence`,
    });
  }

  if (credit !== undefined && !isNonEmptyString(credit)) {
    findings.push({
      rule: "credit-shape",
      severity: "error",
      message: `${path}.credit must be a non-empty string when present, got ${describe(credit)}.`,
      path: `${path}.credit`,
    });
  }

  return findings;
}

/**
 * Validates that `value` conforms to the `AssetRecord` shape. Returns an
 * `AssetFinding[]`; empty means `value` is a well-formed `AssetRecord`.
 * Never throws — any input, including `null`, a string, or a wildly
 * malformed object, produces findings rather than an exception, the same
 * discipline every sibling validator in this ecosystem holds to.
 *
 * Checks, in full: `id` present and non-empty; `entries` present and an
 * array; every entry's own shape (`id` non-empty and well-formed per
 * `ASSET_ENTRY_ID_RE`, `src` non-empty, `width`/`height` positive finite
 * numbers, `alt` non-empty and not whitespace-only, `mimeType`/`licence`/
 * `credit` — if present — non-empty strings); and, at the record level,
 * that every entry's `id` is unique within the record.
 *
 * `entries` being present but empty (`[]`) is a well-formed, zero-finding
 * `AssetRecord` as far as THIS function is concerned — the same judgment
 * call `@vespeneventures/copy`'s `validateCopyRecordShape` makes about a
 * `CopyRecord` with zero entries: whether zero entries is itself a problem
 * is for a caller with more context than a shape validator has. Unlike
 * `copy`'s own `checkCopyRecord`, this package's coverage check
 * (`coverage.ts`) does not treat a zero-entry `AssetRecord` as a failure by
 * itself — a fresh registry with zero referenced ids and zero entries has
 * nothing to disagree about — but it DOES refuse to call zero REFERENCED
 * ids a clean pass; see that file's own doc comment.
 */
export function validateAssetRecordShape(value: unknown): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "record-present", severity: "error", message: "An asset record must be an object.", path: "$" }];
  }

  const id = value.id;
  const entries = value.entries;

  const findings: AssetFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `id must be a non-empty string, got ${describe(id)}.`,
      path: "id",
    });
  }

  if (!Array.isArray(entries)) {
    findings.push({
      rule: "entries-shape",
      severity: "error",
      message: `entries must be an array, got ${describe(entries)}.`,
      path: "entries",
    });
  } else {
    entries.forEach((entry, i) => findings.push(...validateAssetEntryShape(entry, `entries.${i}`)));

    // Uniqueness is a whole-record property, not a per-entry one — mirrors
    // @vespeneventures/copy's schema.ts id-uniqueness check exactly. Only
    // entries that already passed their own id-shape check contribute a
    // value to compare.
    const seen = new Map<AssetEntryId, number>(); // id -> first index seen at
    entries.forEach((entry, i) => {
      if (!isPlainObject(entry)) return;
      const entryId = entry.id;
      if (typeof entryId !== "string" || entryId.length === 0) return;
      const firstIndex = seen.get(entryId);
      if (firstIndex === undefined) {
        seen.set(entryId, i);
      } else {
        findings.push({
          rule: "id-unique",
          severity: "error",
          message: `entries.${i}.id "${entryId}" duplicates entries.${firstIndex}.id — every entry's id must be unique within an AssetRecord.`,
          path: `entries.${i}.id`,
        });
      }
    });
  }

  return findings;
}

/**
 * Builds a fully-defaulted `AssetRecord` from `value`, which the caller
 * must already know passed `validateAssetRecordShape` with zero findings —
 * this function does no validation of its own and will throw or produce
 * garbage on unvalidated input. Only called internally, from
 * `parseAssetRecord`, immediately after that check — mirrors
 * `@vespeneventures/copy`'s `buildCopyRecord` exactly.
 */
function buildAssetRecord(value: Record<string, unknown>): AssetRecord {
  const entriesRaw = value.entries as unknown[];

  const builtEntries: AssetEntry[] = entriesRaw.map((raw) => {
    const entry = raw as Record<string, unknown>;
    return {
      id: entry.id as string,
      src: entry.src as string,
      width: entry.width as number,
      height: entry.height as number,
      alt: entry.alt as string,
      mimeType: entry.mimeType as string | undefined,
      licence: entry.licence as string | undefined,
      credit: entry.credit as string | undefined,
    };
  });

  return {
    id: value.id as string,
    entries: builtEntries,
  };
}

/**
 * Parses `value` as an `AssetRecord`, throwing a plain `Error` (never an
 * `AssetFinding[]`) if it does not conform. For a caller that wants
 * fail-fast construction — `registry.ts`'s `readAssetRecord`, in
 * particular — rather than `validateAssetRecordShape`'s "collect every
 * problem and keep going" shape. The thrown message includes every issue
 * `validateAssetRecordShape` would have reported, joined, so nothing is
 * lost by throwing instead of returning. Mirrors
 * `@vespeneventures/copy`'s `parseCopyRecord` exactly, including that
 * function's TOCTOU-safety reasoning for validating twice (see that
 * function's own doc comment) — this package's own threat model is
 * identical: a consumer's own in-memory config object, not a value
 * crossing a real trust boundary.
 */
export function parseAssetRecord(value: unknown): AssetRecord {
  const findings = validateAssetRecordShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parseAssetRecord: value is not a valid AssetRecord:\n${detail}`);
  }
  // Safe: validateAssetRecordShape returning no findings means every field
  // buildAssetRecord reads below is present and correctly typed.
  return buildAssetRecord(value as Record<string, unknown>);
}
