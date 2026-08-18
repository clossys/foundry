import type { KeyCustodyManifest } from "./custody.js";
import type { SecretKey } from "./types.js";

/**
 * The complete rotation-state vocabulary. Deliberately a four-member union,
 * not a boolean or a three-way result: a two- or three-state encoding cannot
 * express "the system could not observe this key's rotation," which is not
 * the same fact as "current" or "stale" and must never collapse into either.
 *
 * - `current`    — a last-rotation date was observed and is within policy.
 * - `stale`      — a last-rotation date was observed and exceeds policy.
 * - `unowned`    — custody has no recorded owner for this key. A key with no
 *                  owner is a custody gap regardless of what its age looks
 *                  like, so this takes priority over age-based states.
 * - `unverifiable` — the key is owned, but no last-rotation date could be
 *                  read (never recorded, or unparsable). A rotation the
 *                  system cannot observe does not count as a rotation, and
 *                  this state exists so "we could not check" can never be
 *                  reported as "fine."
 */
export type RotationState = "current" | "stale" | "unowned" | "unverifiable";

export interface RotationPolicy {
  readonly key: SecretKey;
  /** The maximum age, in whole days, before an observed rotation is stale. */
  readonly maxAgeDays: number;
}

/**
 * What was observed about one key's rotation history. `lastRotatedAt` is an
 * ISO 8601 date-time, or `null` when no rotation has ever been recorded.
 * `digest` is an optional, caller-computed, value-free fingerprint (for
 * example a hash the caller already derived elsewhere) used only to notice
 * that a value changed between two observations. Locksmith never computes,
 * stores, or compares a digest against a resolved value — it only accepts
 * and echoes back an opaque string the caller already produced.
 */
export interface RotationRecord {
  readonly key: SecretKey;
  readonly lastRotatedAt: string | null;
  readonly digest?: string;
}

export interface RotationEvaluation {
  readonly key: SecretKey;
  readonly state: RotationState;
  readonly ageDays: number | null;
}

export interface RotationMetric {
  /** Key age at the 95th percentile, across every key whose age could be observed. `null` when no key had an observable age. */
  readonly p95AgeDays: number | null;
  /** The count of keys with no recorded owner. */
  readonly unownedKeyCount: number;
}

function parsedAgeDays(iso: string, now: Date): number | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Judges one key's rotation state. Custody is checked first — an unowned key
 * is a custody gap independent of any age data — then observability, then
 * age against policy. See {@link RotationState} for what each outcome means.
 */
export function evaluateRotation(
  record: RotationRecord,
  policy: RotationPolicy,
  custody: KeyCustodyManifest,
  now: Date = new Date(),
): RotationEvaluation {
  if (record.key !== policy.key) {
    throw new RangeError(
      `rotation record key ${JSON.stringify(record.key)} does not match policy key ${JSON.stringify(policy.key)}`,
    );
  }

  const custodyRecord = custody.entries.find((entry) => entry.key === record.key);
  if (!custodyRecord || custodyRecord.owner === null) {
    return { key: record.key, state: "unowned", ageDays: null };
  }

  if (record.lastRotatedAt === null) {
    return { key: record.key, state: "unverifiable", ageDays: null };
  }

  const ageDays = parsedAgeDays(record.lastRotatedAt, now);
  if (ageDays === null) {
    return { key: record.key, state: "unverifiable", ageDays: null };
  }

  return {
    key: record.key,
    state: ageDays <= policy.maxAgeDays ? "current" : "stale",
    ageDays,
  };
}

/**
 * Every key that needs attention: stale, unowned, or unverifiable. `current`
 * keys are the only state omitted. This is metadata for the plane's own
 * review, never an instruction locksmith acts on — see the package README's
 * "act" step: locksmith emits the queue, it never rotates a key itself.
 */
export function rotationQueue(evaluations: readonly RotationEvaluation[]): readonly SecretKey[] {
  return evaluations
    .filter((evaluation) => evaluation.state !== "current")
    .map((evaluation) => evaluation.key);
}

function percentile(sortedAscending: readonly number[], p: number): number {
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
  // sortedAscending is non-empty at every call site; noUncheckedIndexedAccess
  // still types this read as possibly undefined, so assert what the caller
  // already guarantees rather than silently coercing to a wrong number.
  const value = sortedAscending[index];
  if (value === undefined) throw new RangeError("percentile: empty input");
  return value;
}

/**
 * The package metric: key age at the 95th percentile, plus the count of
 * keys with no recorded owner. Ages are drawn only from evaluations that
 * actually observed an age — an `unverifiable` or `unowned` key contributes
 * to `unownedKeyCount` (when applicable) but never to the age percentile,
 * because "we could not check" must never be averaged in as if it were data.
 */
export function summarizeRotationMetric(evaluations: readonly RotationEvaluation[]): RotationMetric {
  const ages = evaluations
    .map((evaluation) => evaluation.ageDays)
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);

  return {
    p95AgeDays: ages.length === 0 ? null : percentile(ages, 95),
    unownedKeyCount: evaluations.filter((evaluation) => evaluation.state === "unowned").length,
  };
}

/**
 * Compares two caller-supplied digests for equality. This is the only
 * operation locksmith performs on a digest: it never derives one from a
 * value, so this can only ever confirm or deny that two opaque strings the
 * caller already computed elsewhere match.
 */
export function sameDigest(a: RotationRecord, b: RotationRecord): boolean {
  return a.digest !== undefined && b.digest !== undefined && a.digest === b.digest;
}
