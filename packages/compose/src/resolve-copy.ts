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
 * supplies no source of text, or two/three conflicting ones, or an
 * empty/whitespace-only `value`, or an empty `copyId`. Those findings
 * don't remove the binding from `ResolveResult.resolved` — see
 * `resolve.ts`'s own doc comment — so this function still sees them. It
 * has nothing new to say about a binding with no usable source (there is
 * no lookup call that invents one, or that arbitrates between conflicting
 * ones), so this function makes that same "does this binding even have
 * exactly one candidate source?" determination itself, on the same
 * `copyId`/`value`/`assetId` presence this package already treats as
 * authoritative, and lands the result in `unchecked` rather than
 * inventing a guess at which source was intended.
 *
 * ASSET BINDINGS ARE NOT FAILED TEXT (added for `assetId`, 0.3.0)
 * ---------------------------------------------------------------------
 * `SlotBinding.assetId` (`types.ts`) legitimately produces no text at
 * all — it produces an asset, resolved by this file's sibling
 * `resolve-assets.ts`, not by this one. Before this seam existed, a
 * binding with no `copyId`/`value` fell into the "no usable source" case
 * above and landed in `unchecked`, which is correct for a genuinely empty
 * binding but WRONG for one that deliberately points at an asset instead
 * of text: it would make every document containing so much as one image
 * report `CopyResolveResult.ok: false`, and every renderer built to
 * refuse rendering on `ok: false` would refuse to render any document
 * with an image in it. So this function treats "exactly one source
 * present, and that source is `assetId`" as its own, third case —
 * deliberately NOT text, and deliberately NOT a failure — and records it
 * into `deferredToAssets` rather than `texts` or `unchecked`. See
 * `ok`'s own doc comment below for how that keeps "nothing but assets"
 * distinguishable from "nothing was checked at all".
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
   * source, had two or three conflicting sources, the lookup itself was
   * not a function, or the lookup call threw for that slot's `copyId`.
   * Never includes a slot whose only source is `assetId` — see
   * `deferredToAssets`. MUST force `ok: false` — see this file's top
   * comment.
   */
  unchecked: string[];
  /**
   * Slot keys this pass deliberately did NOT attempt to resolve because
   * their one source of content is `assetId`, not `copyId`/`value` — not
   * a failure, and not this function's job; see `resolve-assets.ts`'s
   * `resolveAssets` for the pass that actually resolves these. Kept as
   * its own field, distinct from both `texts` and `unchecked`, so a
   * caller can tell "there was nothing here for copy to do" apart from
   * both "copy resolved this" and "copy tried and failed" — see `ok`'s
   * own doc comment for why this distinction is what lets an asset-only
   * document be `ok: true`.
   */
  deferredToAssets: string[];
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

function hasAssetId(binding: ResolvedSlot["binding"]): boolean {
  return typeof binding?.assetId === "string" && binding.assetId.length > 0;
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
 * - A binding with a non-empty `copyId` (and no `value`/`assetId`) calls
 *   `lookup(copyId)`. A result that is `undefined`, `""`, or
 *   whitespace-only is UNRESOLVED: the `copyId` goes into
 *   `unresolvedCopyIds`, and nothing is ever substituted in its place.
 * - A binding whose only source is a non-empty `assetId` is DEFERRED, not
 *   failed: its key goes into `deferredToAssets`, `lookup` is never
 *   called for it, and it never counts against `ok` — see this file's top
 *   comment, "Asset bindings are not failed text".
 * - A binding with no source, or with two/three conflicting sources
 *   (see `resolveDocument`'s `bindingFindings`), lands in `unchecked` —
 *   this pass has no lookup call that resolves any of those shapes.
 * - If `lookup` is not a function at all, every slot in `result.resolved`
 *   is classified the same way it would be classified below — a legitimate
 *   `assetId`-only slot still goes to `deferredToAssets` (it was never
 *   going to call `lookup` anyway), everything else goes to `unchecked` —
 *   `ok: false`, without a single `lookup` call ever attempted.
 * - If a `lookup` call throws for a given slot, the error is caught, that
 *   slot's key goes into `unchecked`, and resolution continues with the
 *   next slot — one bad `copyId` must not abort the whole document.
 *
 * `ok` is `true` only when `unresolvedCopyIds` is empty AND `unchecked`
 * is empty AND at least one slot was actually accounted for — either
 * resolved to real text (`texts.length > 0`) OR legitimately deferred to
 * asset resolution (`deferredToAssets.length > 0`). This is what lets a
 * document made entirely of images be `ok: true` from `resolveCopy`'s own
 * point of view (it correctly found nothing of ITS concern to do, and
 * nothing went wrong) while an input this pass genuinely resolved
 * NOTHING from at all — `texts`, `unresolvedCopyIds`, `unchecked`, AND
 * `deferredToAssets` all empty, e.g. `result.resolved` itself was empty —
 * still reports `ok: false`, never a silent pass on having done nothing.
 */
export function resolveCopy(result: ResolveResult, lookup: CopyLookup): CopyResolveResult {
  const resolvedSlots: ResolvedSlot[] = Array.isArray(result?.resolved) ? result.resolved : [];

  const texts: ResolvedText[] = [];
  const unresolvedCopyIds: string[] = [];
  const unchecked: string[] = [];
  const deferredToAssets: string[] = [];

  /** Classifies a slot whose source is neither `value` nor a lookup-able `copyId` — either a legitimate asset-only binding (deferred) or truly unresolvable (unchecked). Shared by the broken-`lookup` early return and the main loop's "no id, no value" branch, so the two paths can never quietly diverge on what counts as "asset-only". */
  function deferOrUnchecked(key: string, binding: ResolvedSlot["binding"]): void {
    if (hasAssetId(binding) && !hasCopyId(binding) && !hasValue(binding)) {
      deferredToAssets.push(key);
    } else {
      unchecked.push(key);
    }
  }

  if (typeof lookup !== "function") {
    // A non-function lookup invalidates this entire pass — matches the
    // pre-0.3.0 behavior exactly for every copyId/value binding (even a
    // literal `value`, which never actually needed `lookup`: this
    // function does not special-case that, the same conservative choice
    // it made before `assetId` existed). The ONE new case is an
    // assetId-only binding, which never needed `lookup` for a completely
    // different reason — it was never resolveCopy's job at all — so it is
    // still deferred, not penalized for a dependency this whole pass
    // happens to be missing.
    for (const { key, binding } of resolvedSlots) {
      deferOrUnchecked(key, binding);
    }
    const ok = unresolvedCopyIds.length === 0 && unchecked.length === 0 && (texts.length > 0 || deferredToAssets.length > 0);
    return { ok, texts, unresolvedCopyIds, unchecked, deferredToAssets, literalCount: 0, lookupCount: 0 };
  }

  for (const { key, binding } of resolvedSlots) {
    const hasId = hasCopyId(binding);
    const hasVal = hasValue(binding);
    const hasAsset = hasAssetId(binding);
    const sourceCount = [hasId, hasVal, hasAsset].filter(Boolean).length;

    if (sourceCount !== 1) {
      // Zero sources, or more than one (ambiguous) — not this function's
      // call to arbitrate; matches resolveDocument's own bindingFindings.
      unchecked.push(key);
      continue;
    }

    if (hasAsset) {
      // Exactly one source, and it is assetId: this slot's content is an
      // asset, not text — legitimately not resolveCopy's job. See this
      // file's top comment.
      deferredToAssets.push(key);
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

  const ok =
    unresolvedCopyIds.length === 0 && unchecked.length === 0 && (texts.length > 0 || deferredToAssets.length > 0);

  return { ok, texts, unresolvedCopyIds, unchecked, deferredToAssets, literalCount, lookupCount };
}
