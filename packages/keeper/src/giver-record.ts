/**
 * The retained-grounds document seam owned by `giver`.
 *
 * This module deliberately declares the JSON shape it reads instead of
 * importing `giver`. The two packages remain separately releasable, while a
 * versioned document makes a mismatch visible at the boundary rather than a
 * hidden runtime dependency.
 */

import {
  isPlainObject,
  pushIssue,
  requireArrayOf,
  requireNumber,
  requireString,
  requireTimestamp,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

/** The retained-grounds document version this reader understands. */
export const GIVER_RETAINED_GROUNDS_SCHEMA_VERSION = 1;

/** One retained decision ground, as published by `giver` for visibility checking. */
export interface GiverRetainedGround {
  groundId: string;
  subjectId: string;
  retainedAt: string;
}

/** The complete versioned JSON document read across the `giver` → `keeper` seam. */
export interface GiverRetainedGroundsDocument {
  schemaVersion: number;
  producedAt: string;
  grounds: GiverRetainedGround[];
}

function readGround(value: unknown, path: string, issues: ValidationIssue[]): GiverRetainedGround | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with groundId, subjectId and retainedAt");
    return undefined;
  }
  const before = issues.length;
  const groundId = requireString(value.groundId, `${path}.groundId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const retainedAt = requireTimestamp(value.retainedAt, `${path}.retainedAt`, issues);
  if (issues.length > before || groundId === undefined || subjectId === undefined || retainedAt === undefined) return undefined;
  return { groundId, subjectId, retainedAt };
}

/**
 * Validates the external document without importing its producing package.
 * Unknown versions are refused, because visibility cannot claim to have read
 * a record whose shape it did not understand.
 */
export function validateGiverRetainedGroundsDocument(value: unknown): ValidationResult<GiverRetainedGroundsDocument> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    pushIssue(issues, "(root)", "must be an object with schemaVersion, producedAt and grounds");
    return { ok: false, issues };
  }
  const schemaVersion = requireNumber(value.schemaVersion, "(root).schemaVersion", issues, { integer: true, min: 0 });
  if (schemaVersion !== undefined && schemaVersion !== GIVER_RETAINED_GROUNDS_SCHEMA_VERSION) {
    pushIssue(issues, "(root).schemaVersion", `must be ${GIVER_RETAINED_GROUNDS_SCHEMA_VERSION}, got ${schemaVersion}`);
  }
  const producedAt = requireTimestamp(value.producedAt, "(root).producedAt", issues);
  const grounds = requireArrayOf(value.grounds, "(root).grounds", issues, readGround);
  if (issues.length > 0 || schemaVersion === undefined || producedAt === undefined || grounds === undefined) return { ok: false, issues };
  return { ok: true, value: { schemaVersion, producedAt, grounds } };
}
