/**
 * The second resolution pass: turning the slots `resolveDocument` already
 * matched into actual text, by asking a caller-supplied `CopyLookup` about
 * every `copyId`. `resolveDocument` deliberately stops short of this — it
 * has no copy dictionary, and `copyId` is an opaque string seam on
 * purpose (see the README, "The `copyId` seam") — so this file is where a
 * caller who DOES have a real `CopyRecord` (or any other `copyId -> text`
 * lookup) closes the loop.
 *
 * THE BAR THIS FILE IS BUILT AGAINST, same one `resolve.ts` is built
 * against: a clean pass must mean something was actually resolved. A
 * `CopyResolveResult` with `ok: true` must never be reachable from an
 * input that resolved zero text, and a lookup that cannot be trusted —
 * because it isn't a function, or because it threw — must never be
 * indistinguishable from a lookup that quietly resolved everything. That
 * is what `unchecked` is for: it is a THIRD state, deliberately distinct
 * from both "resolved" (in `texts`) and "resolved to nothing" (in
 * `unresolvedCopyIds`), for the slots this pass could not even attempt to
 * decide on. A caller that reads only `ok` still gets the right answer,
 * because `unchecked.length > 0` always forces `ok: false` — see this
 * repo's standing rule (the README's "The bar") that a check which
 * "could not check" must never look like a pass.
 *
 * WHY A BINDING CAN LAND IN `unchecked` EVEN THOUGH `resolveDocument`
 * ALREADY FLAGS IT
 * ---------------------------------------------------------------------
 * `resolveDocument`'s `bindingFindings` (reusing `validate.ts`'s
 * `validateSlotBindingShape`) already flags a matched binding that
 * supplies no source of text, or two conflicting ones, or an
 * empty/whitespace-only `value`, or an empty `copyId`. Those findings
 * don't remove the binding from `ResolveResult.resolved` — see
 * `resolve.ts`'s own doc comment — so this function still sees them. It
 * has nothing new to say about a binding with no usable source (there is
 * no lookup call that invents one, or that arbitrates between two
 * conflicting ones), so this function makes that same "does this binding
 * even have exactly one candidate source?" determination itself, on the
 * same `copyId`/`value` presence this package already treats as
 * authoritative, and lands the result in `unchecked` rather than
 * inventing a guess at which source was intended.
 */

import type { ResolvedSlot, ResolveResult } from "./types.js";

/**
 * A caller-supplied `copyId -> text` lookup. Returns `undefined` (or an
 * empty/whitespace-only string) for a `copyId` with no real entry —
 * `resolveCopy` treats all three the same way, as UNRESOLVED, never as a
 * signal to fall back to the `copyId` itself, the slot key, or an empty
 * string. May throw; `resolveCopy` catches that per-slot rather than
 * letting one bad `copyId` abort the whole document (see this file's own
 * top comment).
 */
export type CopyLookup = (copyId: string) => string | undefined;

/** One slot `resolveCopy` turned into real text — either a literal `value` carried straight through, or a `copyId` a `CopyLookup` resolved. */
export interface ResolvedText {
  /** The slot key this text fills. */
  key: string;
  /** The final, non-empty text. Never empty or whitespace-only — see `resolveCopy`'s rules. */
  text: string;
  /** `"literal"` when the binding carried its own `value`; `"copy"` when a `CopyLookup` resolved its `copyId`. */
  source: "literal" | "copy";
  /** The `copyId` that was looked up. Present only when `source === "copy"`. */
  copyId?: string;
}

/** What `resolveCopy` returns. See this file's top comment for exactly what `ok` means and why `unchecked` exists as its own state. */
export interface CopyResolveResult {
  ok: boolean;
  /** Every slot that resolved to real text, literal or looked-up. */
  texts: ResolvedText[];
  /** `copyId`s the lookup returned `undefined`, `""`, or a whitespace-only string for. Never silently dropped. */
  unresolvedCopyIds: string[];
  /**
   * Slot keys this pass could not decide on at all: the binding had no
   * source, had two conflicting sources, the lookup itself was not a
   * function, or the lookup call threw for that slot's `copyId`. MUST
   * force `ok: false` — see this file's top comment.
   */
  unchecked: string[];
  /** How many entries in `texts` came from a literal `value`. */
  literalCount: number;
  /** How many entries in `texts` came from a `CopyLookup` call. */
  lookupCount: number;
}

function hasCopyId(binding: ResolvedSlot["binding"]): boolean {
  return typeof binding?.copyId === "string" && binding.copyId.length > 0;
}

function hasValue(binding: ResolvedSlot["binding"]): boolean {
  return typeof binding?.value === "string" && binding.value.trim().length > 0;
}

/** `true` for `undefined`, for a non-string, and for an empty/whitespace-only string — every shape `resolveCopy` treats as UNRESOLVED rather than falling back to anything. */
function isUnresolvedLookupResult(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Turns `result.resolved` (from `resolveDocument`) into actual text, one
 * slot at a time, via `lookup`.
 *
 * - A binding with a non-empty `value` resolves as `source: "literal"`
 *   without ever calling `lookup` — a literal never needs a copy
 *   dictionary.
 * - A binding with a non-empty `copyId` (and no `value`) calls
 *   `lookup(copyId)`. A result that is `undefined`, `""`, or
 *   whitespace-only is UNRESOLVED: the `copyId` goes into
 *   `unresolvedCopyIds`, and nothing is ever substituted in its place.
 * - A binding with no source, or with both a `copyId` and a `value` (see
 *   `resolveDocument`'s `emptyBindings`/`ambiguousBindings`), lands in
 *   `unchecked` — this pass has no lookup call that resolves either case.
 * - If `lookup` is not a function at all, every slot in `result.resolved`
 *   goes into `unchecked` and this function returns immediately —
 *   `ok: false`, without attempting a single call.
 * - If a `lookup` call throws for a given slot, the error is caught, that
 *   slot's key goes into `unchecked`, and resolution continues with the
 *   next slot — one bad `copyId` must not abort the whole document.
 *
 * `ok` is `true` only when `texts.length > 0` AND `unresolvedCopyIds` is
 * empty AND `unchecked` is empty — never merely "no errors found".
 */
export function resolveCopy(result: ResolveResult, lookup: CopyLookup): CopyResolveResult {
  const resolvedSlots: ResolvedSlot[] = Array.isArray(result?.resolved) ? result.resolved : [];

  const texts: ResolvedText[] = [];
  const unresolvedCopyIds: string[] = [];
  const unchecked: string[] = [];

  if (typeof lookup !== "function") {
    for (const { key } of resolvedSlots) {
      unchecked.push(key);
    }
    return { ok: false, texts, unresolvedCopyIds, unchecked, literalCount: 0, lookupCount: 0 };
  }

  for (const { key, binding } of resolvedSlots) {
    const hasId = hasCopyId(binding);
    const hasVal = hasValue(binding);

    if (hasId && hasVal) {
      // Ambiguous: two conflicting sources — not this function's call to arbitrate.
      unchecked.push(key);
      continue;
    }

    if (!hasId && !hasVal) {
      // Empty: no source of text at all — nothing to look up or carry through.
      unchecked.push(key);
      continue;
    }

    if (hasVal) {
      texts.push({ key, text: binding.value as string, source: "literal" });
      continue;
    }

    const copyId = binding.copyId as string;
    try {
      const looked = lookup(copyId);
      if (isUnresolvedLookupResult(looked)) {
        unresolvedCopyIds.push(copyId);
      } else {
        texts.push({ key, text: looked as string, source: "copy", copyId });
      }
    } catch {
      unchecked.push(key);
    }
  }

  const literalCount = texts.filter((t) => t.source === "literal").length;
  const lookupCount = texts.filter((t) => t.source === "copy").length;

  const ok = texts.length > 0 && unresolvedCopyIds.length === 0 && unchecked.length === 0;

  return { ok, texts, unresolvedCopyIds, unchecked, literalCount, lookupCount };
}
