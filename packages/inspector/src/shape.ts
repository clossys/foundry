/**
 * Runtime shape guards for caller-supplied data.
 *
 * Every value these checks evaluate arrives as JSON a consuming workflow
 * assembled and this package parsed. The interfaces declared beside each
 * check describe what a *correct* caller sends; they are erased before any
 * of it is read, so nothing about them survives to refuse `{"hits": [null]}`.
 *
 * That gap matters more here than in an ordinary library, because of where
 * a throw lands. A check that throws does not return `indeterminate` — it
 * unwinds past the report entirely, and the process ends on Node's own
 * uncaught-exception status, which is `1`. In this package's contract `1`
 * means *violated*: a malformed inputs document would be reported as a real
 * finding about the repository, and the row that would have named the
 * actual cause is never rendered. Guarding the shape is what keeps a data
 * problem inside the ternary, where it is a `2` with a named reason.
 *
 * Deliberately three small predicates and no schema validator. Each check
 * already owns an enumerated vocabulary of reasons it can decline for; the
 * job here is only to reach one of those instead of a stack trace.
 */

/** A JSON object — not `null`, not an array, not a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An array whose every entry is a JSON object. */
export function isRecordArray(value: unknown): value is readonly Record<string, unknown>[] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry));
}

/** An array whose every entry is a string. */
export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
