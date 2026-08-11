/**
 * Matches a `ComposeDocument`'s `bindings` against a real `LayoutSpec`'s
 * `slots`, and reports exactly four ways that can go wrong — never
 * silently. `layout` is a separate, explicit argument rather than reading
 * `doc.layout`: `web`/`email` documents carry no `layout` at all (see
 * `types.ts`'s `LayoutSpec` doc comment), so a caller resolving one of
 * those still needs to supply the real slot list its template defines,
 * from wherever that template's own slot shapes live (a
 * `@vespeneventures/ui` view's props, in practice) — this function has no
 * way to discover that on its own, and should not pretend to.
 *
 * THE BAR THIS FILE IS BUILT AGAINST: an empty `layout` (`slots: []`), an
 * empty `bindings` list, a document whose bindings matched zero slots in
 * the layout, or a binding that matched a real slot key but is itself
 * malformed, must never report `ok: true`. A validator that reports a
 * clean pass after checking nothing is the exact failure this package's
 * own design brief was written to prevent (see the README, "The bar") —
 * `resolveDocument` is a resolver, not a validator, but the same failure
 * mode applies to it just as much: "resolved nothing", "resolved to
 * something unusable", and "resolved cleanly" must never look the same to
 * a caller that only checks `ok`.
 *
 * THE #43 GAP, AND WHY THIS DOESN'T HAND-ROLL A SECOND CHECK FOR IT:
 * `resolveDocument` used to treat a binding as resolved the moment its
 * `slot` matched a real `SlotSpec.key`, without asking whether the
 * binding itself was well-formed — so a binding with neither `copyId` nor
 * `value` (or with both, or with a whitespace-only `value`) came back
 * `ok: true`, resolved, clean. That question — is this `SlotBinding`
 * itself shape-valid? — already has an answer: `validate.ts`'s
 * `validateSlotBindingShape`, the exact function `validateComposeDocument`
 * itself calls per binding. Re-deriving that rule here, by hand, a second
 * time, is exactly the kind of drift issue #43 warned four renderer
 * agents about ("a rule that every consumer must independently remember
 * is a rule that one of them will forget") — so this function reuses it
 * instead, via `bindingFindings` below, rather than inventing a parallel
 * "is this binding empty/ambiguous" check that could quietly diverge from
 * what `validateComposeDocument` itself would say about the very same
 * document. `ok` is therefore `true` only when `resolved.length > 0` AND
 * `missingRequired`/`unknownBindings` are empty AND `bindingFindings`
 * contains no `severity: "error"` entry — never merely "no errors found",
 * because there is no error to find in an input that was simply empty.
 */

import { validateSlotBindingShape } from "./validate.js";
import type { ComposeDocument, ComposeFinding, ResolvedSlot, ResolveResult, SlotBinding, SurfaceSlotSpec } from "./types.js";

/**
 * Resolves `doc.bindings` against `layout.slots`.
 *
 * - A binding whose `slot` matches no `SlotSpec.key` in `layout` is
 *   collected into `unknownBindings` — never silently dropped.
 * - A `SlotSpec` marked `required: true` with no binding targeting it is
 *   collected into `missingRequired` — never silently dropped.
 * - Every binding that DOES match a real slot becomes one `ResolvedSlot`
 *   in `resolved`, pairing the real `SlotSpec` with the `SlotBinding`
 *   that fills it, AND is run through `validate.ts`'s own
 *   `validateSlotBindingShape` — any finding that check reports (a
 *   binding with no source of text, one with two conflicting sources, an
 *   empty `copyId`, or an empty/whitespace-only `value`) is collected
 *   into `bindingFindings`. `resolved` isn't narrowed by this — a caller
 *   inspecting `resolved` directly still sees every match; `bindingFindings`
 *   is what turns a subset of those matches into a reason `ok` is `false`.
 *
 * If more than one binding targets the same slot key, every one of them
 * resolves (each becomes its own `ResolvedSlot` entry) — this function
 * does not pick a winner. A caller that treats "one binding per slot" as
 * a hard rule can detect the collision itself by grouping `resolved` on
 * `key`; deciding what to do about it (last-write-wins, an error, a
 * merge) depends on renderer-specific policy this package does not have
 * an opinion on.
 */
export function resolveDocument<TSpec extends SurfaceSlotSpec>(doc: ComposeDocument, layout: { slots: TSpec[] }): ResolveResult<TSpec> {
  const slots: TSpec[] = Array.isArray(layout?.slots) ? layout.slots : [];
  const bindings: SlotBinding[] = Array.isArray(doc?.bindings) ? doc.bindings : [];

  const slotsByKey = new Map<string, TSpec>();
  for (const spec of slots) {
    if (typeof spec?.key === "string" && spec.key.length > 0) {
      slotsByKey.set(spec.key, spec);
    }
  }

  const resolved: ResolvedSlot<TSpec>[] = [];
  const unknownBindings: SlotBinding[] = [];
  const bindingFindings: ComposeFinding[] = [];
  const boundSlotKeys = new Set<string>();

  bindings.forEach((binding, i) => {
    const spec = typeof binding?.slot === "string" ? slotsByKey.get(binding.slot) : undefined;
    if (spec === undefined) {
      unknownBindings.push(binding);
      return;
    }
    resolved.push({ key: spec.key, spec, binding });
    boundSlotKeys.add(spec.key);
    bindingFindings.push(...validateSlotBindingShape(binding, `bindings.${i}`));
  });

  const missingRequired: string[] = [];
  for (const spec of slots) {
    if (spec?.required === true && typeof spec.key === "string" && !boundSlotKeys.has(spec.key)) {
      missingRequired.push(spec.key);
    }
  }

  const hasBindingErrors = bindingFindings.some((f) => f.severity === "error");

  const ok =
    missingRequired.length === 0 && unknownBindings.length === 0 && !hasBindingErrors && resolved.length > 0;

  return { ok, missingRequired, unknownBindings, resolved, bindingFindings };
}
