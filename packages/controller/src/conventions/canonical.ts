/**
 * Deterministic, dependency-free comparison primitives for declared JSON
 * documents.
 *
 * A recurring shape of check across this package's own `conventions`
 * validators (routine declarations, schedule declarations, skill
 * registries) is "does this parsed JSON document still equal the one
 * reviewed value it must not silently drift from" and "does this declared
 * list of strings still name the same members as the reviewed set,
 * regardless of order." Every caller of those checks otherwise has to
 * reinvent the same handful of primitives: sort an array before comparing
 * it, walk an object recursively so key order does not defeat a string
 * comparison, and guard against `undefined`/`null` inputs the same way each
 * time. Multiple independent consumer scripts of this package have in fact
 * reinvented exactly this cluster — under names like `sameSet`,
 * `canonicalJson`/`canonical`, and `sameValue`/`sameCanonical` — because
 * nothing published here offered it first.
 *
 * This module is that primitive cluster, named once. It is deliberately
 * narrow: no schema validation, no diffing, no reporting — just the
 * comparison building blocks a caller's own findings-producing check is
 * built on top of.
 */

/**
 * Returns a sorted shallow copy of `values`. `null`/`undefined` are treated
 * as an empty list rather than thrown on, matching the forgiving input this
 * primitive is normally handed: an optional declared array field that may
 * be absent entirely.
 *
 * Sorting is `Array.prototype.sort`'s own default (lexicographic on the
 * string coercion of each element) — deliberately not a custom comparator,
 * so behaviour matches what a caller would get from sorting the array by
 * hand.
 */
export function sorted<T>(values: readonly T[] | null | undefined): T[] {
  return [...(values ?? [])].sort();
}

/**
 * Are `left` and `right` the same sequence of members once order is
 * ignored?
 *
 * This compares as a sorted sequence, NOT as a mathematical set: duplicate
 * members are never deduplicated, and a duplicate-count mismatch (e.g.
 * `["a", "a", "b"]` vs `["a", "b"]`) is reported as different, exactly the
 * same way a length mismatch would be. That is the behaviour every known
 * caller of this comparison actually depends on — a declared list of
 * top-level keys or allowed values can never legitimately contain the same
 * member twice, so a duplicate is a real, meaningful difference to catch
 * rather than noise to normalize away.
 *
 * `left`/`right` must both be real arrays; a non-array input (including
 * `null`/`undefined`) is never equal to anything, including another
 * non-array input — this mirrors `Object.is`'s own refusal to consider two
 * unrelated non-comparable values equal by accident.
 */
export function sameSet(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const sortedLeft = sorted(left);
  const sortedRight = sorted(right);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * Is `value` a string with at least one non-whitespace character?
 *
 * The type guard a caller reaches for constantly when validating a parsed
 * JSON document: a required text field that is present but empty (or only
 * whitespace) is exactly as much a validation failure as a missing field,
 * and this makes both cases one check instead of two.
 */
export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns a deep, deterministic copy of `value` with every plain object's
 * own keys sorted (recursively, at every depth). Arrays keep their element
 * order — only object key order is normalized, since array order is
 * normally meaningful data and object key order normally is not.
 *
 * `null` and every non-object, non-array value (including `undefined`,
 * numbers, booleans, and strings) pass through unchanged. This function
 * does not itself serialize anything; pass its result to `JSON.stringify`
 * for a deterministic string — see `sameCanonicalJson`, which does exactly
 * that to compare two values, and reuse the same pattern directly for a
 * deterministic digest input: `JSON.stringify(canonicalJson(value))` is a
 * stable string for any value this function accepts, with no second,
 * hand-rolled string-building traversal required alongside it.
 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalJson(entry));
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

/**
 * Are `left` and `right` the same JSON-shaped value once key order is
 * normalized at every depth?
 *
 * Compares `JSON.stringify(canonicalJson(left))` against
 * `JSON.stringify(canonicalJson(right))` — the same "canonicalize, then
 * compare the serialized form" approach every known caller of this
 * comparison already reaches for, offered here once so a caller no longer
 * needs its own recursive stringifier just to answer "did this reviewed
 * document actually change." `undefined`-valued object properties and
 * values `JSON.stringify` cannot represent (e.g. `NaN`, `Infinity`,
 * `bigint`, a function) fall out of the comparison exactly the way
 * `JSON.stringify` itself already handles them — this function adds no
 * normalization beyond sorting keys.
 */
export function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}
