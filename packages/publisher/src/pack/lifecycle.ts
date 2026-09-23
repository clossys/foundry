/**
 * The one lifecycle vocabulary shared across Foundry's loop engine and
 * Publisher's pack items (issue #1228, resolved 2026-09-22): capabilities
 * and pack items use the same words rather than each inventing their own.
 * Publisher's pack manifest (issue #1204) maps its former status names onto
 * this list directly: `in-review` is `draft` with a pending judgment,
 * `kept` is `approved` (the Customer keep), and `published` is `verified`
 * (sealed and verified live). The conditions `current` / `stale` / `blocked`
 * are shared as-is.
 *
 * #1228 assigns this list to the Framework/Controller lane, which exports it
 * from `@clossys/controller` in issue #1237. #1237 had not merged when this
 * was written, so this is a local copy rather than an import — `lifecycle
 * .test.ts` asserts it is byte-for-byte the same six statuses and three
 * conditions #1228 records, so drift between the two copies fails CI rather
 * than surfacing later. Once #1237 lands, replace the two `as const` arrays
 * below with a re-export from `@clossys/controller` and delete that test's
 * duplication comment; every other file in this package should keep
 * importing `LIFECYCLE_STATUSES`/`LIFECYCLE_CONDITIONS` from here so that
 * swap is the only file this package needs to change.
 */

export const LIFECYCLE_STATUSES = ["absent", "found", "draft", "approved", "verified", "retired"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const LIFECYCLE_CONDITIONS = ["current", "stale", "blocked"] as const;
export type LifecycleCondition = (typeof LIFECYCLE_CONDITIONS)[number];

const STATUS_SET: ReadonlySet<string> = new Set(LIFECYCLE_STATUSES);
const CONDITION_SET: ReadonlySet<string> = new Set(LIFECYCLE_CONDITIONS);

export function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export function isLifecycleCondition(value: unknown): value is LifecycleCondition {
  return typeof value === "string" && CONDITION_SET.has(value);
}
