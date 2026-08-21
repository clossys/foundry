/**
 * Small, pure helpers over a `LayoutSpec`'s `slots` — the lookups a
 * renderer reaches for constantly enough that re-writing the same
 * `.find`/`.filter`/`.map` at every call site would be its own source of
 * drift. Each defends against a `layout` (or a `layout.slots`) that
 * satisfies the type only at compile time by treating a non-array
 * `slots` as empty rather than throwing — the same tolerance
 * `resolveDocument` extends to its own `layout`/`bindings` arguments, for
 * the same reason.
 */

import type { LayoutSpec, SlotSpec } from "./types.js";

function slotsOf(layout: LayoutSpec): SlotSpec[] {
  return Array.isArray(layout?.slots) ? layout.slots : [];
}

/** Every `SlotSpec.key` a `LayoutSpec` declares, in declaration order. */
export function listSlotKeys(layout: LayoutSpec): string[] {
  return slotsOf(layout).map((s) => s.key);
}

/** Every `SlotSpec.key` a `LayoutSpec` marks `required: true`, in declaration order. */
export function requiredSlotKeys(layout: LayoutSpec): string[] {
  return slotsOf(layout)
    .filter((s) => s.required === true)
    .map((s) => s.key);
}

/** The `SlotSpec` in `layout` whose `key` matches `key`, or `undefined` if none does. */
export function getSlotSpec(layout: LayoutSpec, key: string): SlotSpec | undefined {
  return slotsOf(layout).find((s) => s.key === key);
}
