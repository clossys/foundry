/**
 * The asset-resolution companion to `resolve-copy.ts`'s `resolveCopy`,
 * added in 0.3.0 alongside `SlotBinding.assetId` (`types.ts`). Turns the
 * slots `resolveDocument` already matched into actual assets, by asking a
 * caller-supplied `AssetLookup` about every `assetId` — the identical
 * shape `resolveCopy` already uses for `copyId`, one binding field over.
 * `resolveDocument` itself has no asset dictionary, and `assetId` is an
 * opaque string seam on purpose (see `types.ts`'s own doc comment on
 * `SlotBinding.assetId`, and the README, "The `assetId` seam") — so this
 * file is where a caller who DOES have a real `AssetRecord` (a
 * `@vespeneventures/surface/media` `checkAssetCoverage`-style lookup, or any
 * other `assetId -> asset` function) closes the loop. This package stays
 * zero-dependency: `AssetLookup`'s return type is `unknown`, never an
 * import of `@vespeneventures/surface/media`'s `AssetEntry` — see "Why this
 * function does not know what an asset looks like" below.
 *
 * SAME BAR `resolveCopy` IS BUILT AGAINST: a clean pass must mean
 * something was actually resolved. An `AssetResolveResult` with
 * `ok: true` must never be reachable from an input that resolved zero
 * assets, and a lookup that cannot be trusted — because it isn't a
 * function, because it threw, or because it returned nothing — must
 * never be indistinguishable from a lookup that quietly resolved
 * everything. `unchecked` is the same explicit third state `resolveCopy`
 * uses, for the slots this pass could not even attempt to decide on.
 *
 * SYMMETRIC WITH `resolveCopy`, NOT NESTED INSIDE IT: both functions take
 * the SAME `ResolveResult` (`resolveDocument`'s own output) as their
 * first argument, and each independently picks out only the bindings
 * relevant to its own job — `resolveCopy` looks at `copyId`/`value`
 * bindings and defers `assetId`-only ones into its own `deferredToAssets`
 * (never treating them as failed text); this file looks at `assetId`
 * bindings and defers `copyId`/`value`-only ones into `deferredToCopy`
 * (never treating them as failed assets). Neither function needs to run
 * before the other, and a caller with a text-only or asset-only document
 * can call just the one function it actually needs.
 *
 * WHY THIS FUNCTION DOES NOT KNOW WHAT AN ASSET LOOKS LIKE
 * ---------------------------------------------------------------------
 * `resolveCopy`'s `CopyLookup` returns `string | undefined` because text
 * has one obvious representation. An asset does not — a caller might hand
 * back a full `@vespeneventures/surface/media` `AssetEntry`, a bare URL string, a
 * pre-signed CDN link, or something else this package has no way to
 * anticipate, and `compose` has zero runtime dependencies (not even on
 * `@vespeneventures/surface/media` itself — see the README, "Zero runtime
 * dependencies"). So `AssetLookup` returns `unknown`, and `resolveAssets`
 * asks only one question of it: did `lookup(assetId)` return something
 * that is not `undefined`/`null`? Anything else about the shape of what
 * came back is a renderer's concern, not this pass's.
 */

import type { ResolvedSlot, ResolveResult, SurfaceSlotSpec } from "./types.js";

/**
 * A caller-supplied `assetId -> asset` lookup. Returns `undefined` (or
 * `null`) for an `assetId` with no real entry — `resolveAssets` treats
 * both the same way, as UNRESOLVED. The success return value is
 * deliberately `unknown` — see this file's top comment, "Why this
 * function does not know what an asset looks like". May throw;
 * `resolveAssets` catches that per-slot rather than letting one bad
 * `assetId` abort the whole document, mirroring `CopyLookup`'s own
 * contract exactly.
 */
export type AssetLookup = (assetId: string) => unknown;

/** One slot `resolveAssets` turned into a real asset via an `AssetLookup` call. */
export interface ResolvedAsset {
  /** The slot key this asset fills. */
  key: string;
  /** The `assetId` that was looked up. */
  assetId: string;
  /** Whatever `lookup(assetId)` returned — opaque to this package on purpose; see this file's top comment. */
  asset: unknown;
}

/** What `resolveAssets` returns. Mirrors `resolve-copy.ts`'s `CopyResolveResult` field-for-field, substituting "asset" for "text" throughout. */
export interface AssetResolveResult {
  ok: boolean;
  /** Every slot that resolved to a real asset. */
  assets: ResolvedAsset[];
  /** `assetId`s the lookup returned `undefined`/`null` for. Never silently dropped. */
  unresolvedAssetIds: string[];
  /**
   * Slot keys this pass could not decide on at all: the binding had no
   * source, had two or three conflicting sources, the lookup itself was
   * not a function, or the lookup call threw for that slot's `assetId`.
   * Never includes a slot whose only source is `copyId`/`value` — see
   * `deferredToCopy`. MUST force `ok: false`.
   */
  unchecked: string[];
  /**
   * Slot keys this pass deliberately did NOT attempt to resolve because
   * their one source of content is `copyId`/`value`, not `assetId` — not
   * a failure, and not this function's job; see `resolve-copy.ts`'s
   * `resolveCopy` for the pass that actually resolves these. Mirrors
   * `CopyResolveResult.deferredToAssets` in the opposite direction.
   */
  deferredToCopy: string[];
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

/**
 * Turns `result.resolved` (from `resolveDocument`) into actual assets,
 * one slot at a time, via `lookup`. See this file's top comment for the
 * full symmetry with `resolveCopy`; the per-slot rules mirror that
 * function's exactly, with "asset" substituted for "text":
 *
 * - A binding whose only source is a non-empty `assetId` calls
 *   `lookup(assetId)`. A result that is `undefined` or `null` is
 *   UNRESOLVED: the `assetId` goes into `unresolvedAssetIds`.
 * - A binding whose only source is `copyId`/`value` is DEFERRED, not
 *   failed: its key goes into `deferredToCopy`, `lookup` is never called
 *   for it, and it never counts against `ok`.
 * - A binding with no source, or with two/three conflicting sources,
 *   lands in `unchecked` — this pass has no lookup call that resolves
 *   either shape, the same as `resolveCopy`'s identical rule.
 * - If `lookup` is not a function at all, every slot in `result.resolved`
 *   is classified the same way it would be classified below — a
 *   legitimate `copyId`/`value`-only slot still goes to `deferredToCopy`
 *   (it was never going to call `lookup` anyway), everything else
 *   (asset-only or ambiguous) goes to `unchecked` — `ok: false`, without
 *   a single `lookup` call ever attempted.
 * - If a `lookup` call throws for a given slot, the error is caught, that
 *   slot's key goes into `unchecked`, and resolution continues with the
 *   next slot.
 *
 * `ok` is `true` only when `unresolvedAssetIds` is empty AND `unchecked`
 * is empty AND `assets.length > 0` — a document with no `assetId`
 * bindings at all (a text-only document run through this function by
 * mistake, or simply out of an abundance of caution) correctly reports
 * `ok: false`, because this function checked nothing that was actually
 * its job. That is the intended, symmetric counterpart to `resolveCopy`
 * reporting `ok: true` for an asset-only document — each function's `ok`
 * answers only "did MY kind of resolution succeed", never "did the whole
 * document resolve"; a caller with a mixed document calls both and
 * combines them (typically `resolveCopy(...).ok && resolveAssets(...).ok`,
 * when the document is known to need both).
 */
export function resolveAssets<TSpec extends SurfaceSlotSpec>(result: ResolveResult<TSpec>, lookup: AssetLookup): AssetResolveResult {
  const resolvedSlots: ResolvedSlot<TSpec>[] = Array.isArray(result?.resolved) ? result.resolved : [];

  const assets: ResolvedAsset[] = [];
  const unresolvedAssetIds: string[] = [];
  const unchecked: string[] = [];
  const deferredToCopy: string[] = [];

  /** Classifies a slot whose source is not a lookup-able `assetId` — either a legitimate copy-only binding (deferred) or truly unresolvable (unchecked). Shared by the broken-`lookup` early return and the main loop's ambiguous/empty branch. */
  function deferOrUnchecked(key: string, binding: ResolvedSlot["binding"]): void {
    const hasId = hasCopyId(binding);
    const hasVal = hasValue(binding);
    if ((hasId || hasVal) && !(hasId && hasVal) && !hasAssetId(binding)) {
      deferredToCopy.push(key);
    } else {
      unchecked.push(key);
    }
  }

  if (typeof lookup !== "function") {
    for (const { key, binding } of resolvedSlots) {
      deferOrUnchecked(key, binding);
    }
    const ok = unresolvedAssetIds.length === 0 && unchecked.length === 0 && assets.length > 0;
    return { ok, assets, unresolvedAssetIds, unchecked, deferredToCopy };
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

    if (!hasAsset) {
      // Exactly one source, and it is copyId or value: this slot's
      // content is text, not an asset — legitimately not resolveAssets's
      // job. See this file's top comment.
      deferredToCopy.push(key);
      continue;
    }

    const assetId = binding.assetId as string;
    try {
      const looked = lookup(assetId);
      if (looked === undefined || looked === null) {
        unresolvedAssetIds.push(assetId);
      } else {
        assets.push({ key, assetId, asset: looked });
      }
    } catch {
      unchecked.push(key);
    }
  }

  const ok = unresolvedAssetIds.length === 0 && unchecked.length === 0 && assets.length > 0;

  return { ok, assets, unresolvedAssetIds, unchecked, deferredToCopy };
}
