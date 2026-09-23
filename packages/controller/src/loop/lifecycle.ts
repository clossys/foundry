/**
 * One lifecycle vocabulary for every capability and pack item (issue #1228,
 * owner decision 2026-09-22). Before this module, the loop lifecycle
 * (issue #1195) and pack item statuses (issue #1204) were two state models
 * designed side by side, using different words for the same underlying
 * position. This module -- mirrored, word for word, by this repository's own
 * canonical lifecycle contract -- is the single definition both specialize
 * from: this package's own loop engine (`./loop/*`) uses it
 * directly, and any package with a status-like surface (Publisher's pack
 * rendering, for one) imports it from here rather than declaring its own.
 *
 * A surface that needs a richer vocabulary -- pack statuses currently being
 * the one example -- maps onto these six states and three conditions rather
 * than inventing new words. `packStatusToLifecycle` is that one mapping,
 * kept here so it never drifts from the states it maps onto.
 */

/** The complete, ordered lifecycle a capability or pack item passes through. */
export const LIFECYCLE_STATES = Object.freeze([
  "absent",
  "found",
  "draft",
  "approved",
  "verified",
  "retired",
] as const);
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Whether a state's own evidence still matches its declared inputs. Shared across every state. */
export const LIFECYCLE_CONDITIONS = Object.freeze(["current", "stale", "blocked"] as const);
export type LifecycleCondition = (typeof LIFECYCLE_CONDITIONS)[number];

/** Pack item statuses (issue #1204), which specialize the lifecycle above rather than adding new words. */
export const PACK_STATUSES = Object.freeze([
  "absent",
  "found",
  "draft",
  "in-review",
  "kept",
  "published",
] as const);
export type PackStatus = (typeof PACK_STATUSES)[number];

/** One pack status's position in the shared lifecycle, plus what it specializes (when it does). */
export interface PackStatusLifecyclePosition {
  readonly status: PackStatus;
  readonly state: LifecycleState;
  /** Present only for the three statuses that carry extra meaning beyond the bare state name. */
  readonly note: string | null;
}

const PACK_STATUS_POSITIONS: Readonly<Record<PackStatus, PackStatusLifecyclePosition>> = Object.freeze({
  absent: Object.freeze({ status: "absent", state: "absent", note: null }),
  found: Object.freeze({ status: "found", state: "found", note: null }),
  draft: Object.freeze({ status: "draft", state: "draft", note: null }),
  "in-review": Object.freeze({ status: "in-review", state: "draft", note: "draft with a pending judgment" }),
  kept: Object.freeze({ status: "kept", state: "approved", note: "approved by the Customer keep" }),
  published: Object.freeze({ status: "published", state: "verified", note: "sealed and verified live" }),
});

/** Resolves a pack status to its position in the shared lifecycle. Pure lookup; every `PackStatus` is covered. */
export function packStatusToLifecycle(status: PackStatus): PackStatusLifecyclePosition {
  return PACK_STATUS_POSITIONS[status];
}
