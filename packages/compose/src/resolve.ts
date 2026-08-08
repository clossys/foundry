/**
 * Matches a `ComposeDocument`'s `bindings` against a real `LayoutSpec`'s
 * `slots`, and reports exactly three ways that can go wrong — never
 * silently. `layout` is a separate, explicit argument rather than reading
 * `doc.layout`: `web`/`email` documents carry no `layout` at all (see
 * `types.ts`'s `LayoutSpec` doc comment), so a caller resolving one of
 * those still needs to supply the real slot list its template defines,
 * from wherever that template's own slot shapes live (a
 * `@vespeneventures/ui` view's props, in practice) — this function has no
 * way to discover that on its own, and should not pretend to.
 *
 * THE BAR THIS FILE IS BUILT AGAINST: an empty `layout` (`slots: []`), an
 * empty `bindings` list, or a document whose bindings matched zero slots
 * in the layout, must never report `ok: true`. A validator that reports a
 * clean pass after checking nothing is the exact failure this package's
 * own design brief was written to prevent (see the README, "The bar") —
 * `resolveDocument` is a resolver, not a validator, but the same failure
 * mode applies to it just as much: "resolved nothing" and "resolved
 * cleanly" must never look the same to a caller that only checks `ok`.
 * `ok` is therefore `true` only when `resolved.length > 0` AND
 * `missingRequired`/`unknownBindings` are both empty — never merely "no
 * errors found", because there is no error to find in an input that was
 * simply empty.
 */

import type { ComposeDocument, LayoutSpec, ResolvedSlot, ResolveResult, SlotBinding, SlotSpec } from "./types.js";

/**
 * Resolves `doc.bindings` against `layout.slots`.
 *
 * - A binding whose `slot` matches no `SlotSpec.key` in `layout` is
 *   collected into `unknownBindings` — never silently dropped.
 * - A `SlotSpec` marked `required: true` with no binding targeting it is
 *   collected into `missingRequired` — never silently dropped.
 * - Every binding that DOES match a real slot becomes one `ResolvedSlot`
 *   in `resolved`, pairing the real `SlotSpec` with the `SlotBinding`
 *   that fills it.
 *
 * If more than one binding targets the same slot key, every one of them
 * resolves (each becomes its own `ResolvedSlot` entry) — this function
 * does not pick a winner. A caller that treats "one binding per slot" as
 * a hard rule can detect the collision itself by grouping `resolved` on
 * `key`; deciding what to do about it (last-write-wins, an error, a
 * merge) depends on renderer-specific policy this package does not have
 * an opinion on.
 */
export function resolveDocument(doc: ComposeDocument, layout: LayoutSpec): ResolveResult {
  const slots: SlotSpec[] = Array.isArray(layout?.slots) ? layout.slots : [];
  const bindings: SlotBinding[] = Array.isArray(doc?.bindings) ? doc.bindings : [];

  const slotsByKey = new Map<string, SlotSpec>();
  for (const spec of slots) {
    if (typeof spec?.key === "string" && spec.key.length > 0) {
      slotsByKey.set(spec.key, spec);
    }
  }

  const resolved: ResolvedSlot[] = [];
  const unknownBindings: SlotBinding[] = [];
  const boundSlotKeys = new Set<string>();

  for (const binding of bindings) {
    const spec = typeof binding?.slot === "string" ? slotsByKey.get(binding.slot) : undefined;
    if (spec === undefined) {
      unknownBindings.push(binding);
      continue;
    }
    resolved.push({ key: spec.key, spec, binding });
    boundSlotKeys.add(spec.key);
  }

  const missingRequired: string[] = [];
  for (const spec of slots) {
    if (spec?.required === true && typeof spec.key === "string" && !boundSlotKeys.has(spec.key)) {
      missingRequired.push(spec.key);
    }
  }

  const ok = missingRequired.length === 0 && unknownBindings.length === 0 && resolved.length > 0;

  return { ok, missingRequired, unknownBindings, resolved };
}
