/**
 * The asset-resolution companion to `internal/tokens.ts`/`internal/
 * typography.ts` — the shared foundation every channel this package ships
 * (`./web`, `./email`, `./print`, `./image`, `./slides`) needs now that
 * `@vespeneventures/compose` 0.3.0 added `SlotBinding.assetId` and
 * `@vespeneventures/assets` exists to register what an `assetId` actually
 * points AT. Built once here, rather than reinvented (and re-drifted) five
 * times — the exact reasoning `@vespeneventures/compose`'s own
 * `resolve-assets.ts` gives for shipping `resolveAssets` at all: "issue
 * #43 — a rule every renderer must independently remember is a rule one of
 * them will forget." This module is where that rule lives for THIS
 * package's five renderers.
 *
 * WHAT THIS MODULE ADDS ON TOP OF `resolveAssets` ITSELF
 * -----------------------------------------------------------
 * `@vespeneventures/compose`'s `resolveAssets` deliberately stops one step
 * short of what a renderer needs: its `AssetLookup` returns `unknown` (see
 * that file's own doc comment, "why this function does not know what an
 * asset looks like" — `compose` has zero dependency on
 * `@vespeneventures/assets`, not even for a type), so `AssetResolveResult
 * .assets[].asset` is `unknown` too. A renderer that just assumed a shape
 * (`(asset as any).src`) and rendered it would be exactly the "silent
 * fallback" failure this whole package refuses everywhere else — an
 * `assetId` that resolves to `{ oops: "wrong shape" }` would either crash
 * with a confusing `undefined` in the middle of an `<img>` tag, or (worse)
 * render a syntactically valid but semantically empty `<img src="undefined"
 * alt="undefined">`. So this module's whole job is: validate `unknown` into
 * a real, paintable shape (`RenderAsset`, below) at the one place every
 * channel already has to trust a caller-supplied function's return value,
 * and report anything that doesn't fit that shape as its own, named
 * failure (`invalid`) — never silently coerced, never silently dropped.
 *
 * `RenderAsset` IS NOT AN IMPORT OF `@vespeneventures/assets`'S `AssetEntry`
 * -----------------------------------------------------------------------------
 * `RenderAsset` below is structurally identical to `@vespeneventures/
 * assets`' `AssetEntry` (`src`, `width`, `height`, `alt`, optional
 * `mimeType`) — deliberately, since a real `AssetLookup` in practice wraps
 * exactly that package's registry — but this package does not import
 * `@vespeneventures/assets` to get it. Same "opaque seam, not a code
 * import" reasoning `@vespeneventures/compose`'s own `resolve-assets.ts`
 * gives for `AssetLookup` itself: `@vespeneventures/render` works whether
 * or not `@vespeneventures/assets` is even installed, and a caller with a
 * completely different `assetId -> asset` source (a CMS, a CDN manifest, a
 * hand-rolled map in a test) only needs to return something with these four
 * fields — never that package's own type. This is also why `RenderAsset`
 * carries only the fields a renderer actually paints (`src`/`width`/
 * `height`/`alt`, plus `mimeType` for a future channel that needs it) and
 * not `@vespeneventures/assets`' own `licence`/`credit` — those are
 * registry/review metadata, not rendering inputs, and reading them here
 * would blur that this package never needs them.
 *
 * ALT IS REQUIRED HERE FOR THE IDENTICAL REASON IT IS REQUIRED ON `AssetEntry`
 * -------------------------------------------------------------------------------
 * `@vespeneventures/assets`' own `AssetEntry.alt` doc comment: "there is no
 * later point in this pipeline where alt text can be recovered from a URL
 * and two integers." This module is that later point, and it holds the
 * identical line: a resolved asset with a missing or whitespace-only `alt`
 * is `invalid`, exactly like one with no `src` at all — never rendered,
 * never silently given an empty `alt=""`.
 */

import { resolveAssets } from "@vespeneventures/compose";
import type { AssetLookup, ResolveResult } from "@vespeneventures/compose";

// ─────────────────────────────────────────────────────────────────────────
// RenderAsset — the shape every channel actually paints
// ─────────────────────────────────────────────────────────────────────────

/**
 * What every channel in this package needs to actually paint an image —
 * structurally the same shape `@vespeneventures/assets`' `AssetEntry`
 * exposes (`src`, `width`, `height`, `alt`, optional `mimeType`), but not an
 * import of it. See this file's top comment for why. `width`/`height` are
 * the asset's own INTRINSIC pixel dimensions (never a slot's `Frame`) —
 * `./web`/`./email` emit them directly as the caller's layout-shift-avoiding
 * intrinsic size; `./print`/`./image`/`./slides` additionally compare them
 * against a slot's frame for the aspect-ratio warning (see `./image`'s
 * `renderSlots.ts`).
 */
export interface RenderAsset {
  src: string;
  width: number;
  height: number;
  alt: string;
  mimeType?: string;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Structural validation of `unknown` (whatever `AssetLookup` handed back)
 * into a real `RenderAsset` — hand-rolled `typeof`/shape checks, no schema
 * library, the same discipline `@vespeneventures/assets`' own `schema.ts`
 * holds to and for the identical reason (see that package's README,
 * "Requirements"). Every field is checked independently so a single
 * malformed field (a `width` of `0`, a blank `alt`) is exactly as fatal as
 * a completely wrong-shaped value — there is no "close enough" here, the
 * same "never a plausible-looking wrong value" bar `internal/tokens.ts`
 * holds for color.
 */
export function isRenderAsset(value: unknown): value is RenderAsset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.src !== "string" || candidate.src.length === 0) return false;
  if (!isFinitePositive(candidate.width)) return false;
  if (!isFinitePositive(candidate.height)) return false;
  if (typeof candidate.alt !== "string" || candidate.alt.trim().length === 0) return false;
  if (candidate.mimeType !== undefined && typeof candidate.mimeType !== "string") return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// resolveDocumentAssets — resolveAssets, plus shape validation
// ─────────────────────────────────────────────────────────────────────────

/** One `assetId` this pass could not turn into a paintable `RenderAsset` — either because `lookup` never resolved it, or because it resolved to something the wrong shape. See `RenderAssetResolution.invalid`. */
export interface AssetResolutionIssue {
  /** The slot key this problem is about. */
  key: string;
  /** The `assetId` that was looked up. */
  assetId: string;
}

/**
 * What `resolveDocumentAssets` returns — `@vespeneventures/compose`'s own
 * `AssetResolveResult`, with `assets` replaced by a validated, paintable
 * `byKey` map and `unresolvedAssetIds` augmented by a NEW `invalid` bucket
 * for the failure `resolveAssets` itself cannot see (it never looks inside
 * `asset: unknown` — see this file's top comment).
 */
export interface RenderAssetResolution {
  /** Slot key -> validated, paintable `RenderAsset`. Only ever contains entries that passed {@link isRenderAsset} — never a partially-valid or coerced value. */
  byKey: Map<string, RenderAsset>;
  /** `assetId`s `lookup` returned `undefined`/`null` for — see `AssetLookup`'s own doc comment in `@vespeneventures/compose`. */
  unresolvedAssetIds: string[];
  /** Slot keys `resolveAssets` could not even attempt to resolve — no source, an ambiguous binding, `lookup` not a function, or `lookup` threw for that slot. See `@vespeneventures/compose`'s own `resolveAssets` doc comment. */
  unchecked: string[];
  /** `assetId`s that DID resolve (via `lookup`) but to a value that fails {@link isRenderAsset} — this module's own addition; `resolveAssets` itself has no way to see this, since its `AssetLookup` return type is `unknown` on purpose. Every entry here is exactly as fatal as an unresolved one — see this file's top comment. */
  invalid: AssetResolutionIssue[];
  /** Slot keys legitimately not this pass's job — their one source of content is `copyId`/`value`, not `assetId`. Never a failure; see `@vespeneventures/compose`'s own `resolveAssets`, `deferredToCopy`. */
  deferredToCopy: string[];
}

/**
 * Resolves every `assetId` binding in `result` (from `resolveDocument`) via
 * `lookup`, and validates each successfully-looked-up value into a real,
 * paintable `RenderAsset` — see this file's top comment for why that
 * validation step exists and why it lives here rather than in
 * `@vespeneventures/compose` itself.
 *
 * `lookup` is optional — omitting it (the same convention every
 * `resolveCopyId`/`CopyLookup` option in this package already uses) is
 * treated exactly like a lookup that resolves nothing: every `assetId`
 * binding in the document lands in `unresolvedAssetIds`/`unchecked` per
 * `resolveAssets`'s own "lookup is not a function" branch, never silently
 * ignored.
 *
 * NEVER HAND-ROLLED: this function's whole first half IS a call to
 * `@vespeneventures/compose`'s own `resolveAssets` — see this package's own
 * task brief and issue #43 the module comment above cites. Everything this
 * function adds is the shape-validation step that function's own zero-
 * dependency design deliberately leaves to its caller.
 */
export function resolveDocumentAssets(result: ResolveResult, lookup: AssetLookup | undefined): RenderAssetResolution {
  const effectiveLookup: AssetLookup = lookup ?? ((): undefined => undefined);
  const assetResult = resolveAssets(result, effectiveLookup);

  const byKey = new Map<string, RenderAsset>();
  const invalid: AssetResolutionIssue[] = [];
  for (const { key, assetId, asset } of assetResult.assets) {
    if (isRenderAsset(asset)) {
      byKey.set(key, asset);
    } else {
      invalid.push({ key, assetId });
    }
  }

  return {
    byKey,
    unresolvedAssetIds: assetResult.unresolvedAssetIds,
    unchecked: assetResult.unchecked,
    invalid,
    deferredToCopy: assetResult.deferredToCopy,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Shared refusal-message helpers — one wording, five channels
// ─────────────────────────────────────────────────────────────────────────

/**
 * `true` when `resolution` recorded ANY real problem — an unresolved
 * `assetId`, a wrong-shaped resolved value, or a slot asset resolution
 * couldn't even attempt. Every channel in this package refuses to render
 * (throws `RenderError("empty-output", ...)`) the moment this is `true` for
 * ANY bound asset slot, REQUIRED or not — see each channel's own doc
 * comment for why an asset binding gets a stricter bar than an optional
 * text binding: "an unresolved asset id must never render a blank box or a
 * placeholder" (this package's own task brief) means a broken image is
 * never an acceptable silent omission the way a missing optional caption
 * is.
 */
export function hasAssetProblems(resolution: RenderAssetResolution): boolean {
  return resolution.unresolvedAssetIds.length > 0 || resolution.invalid.length > 0 || resolution.unchecked.length > 0;
}

/** Every real asset problem in `resolution`, as human-readable clauses — the shared wording every channel's own `RenderError("empty-output", ...)` message is built from, so a caller sees the identical explanation regardless of which channel refused. */
export function describeAssetProblems(resolution: RenderAssetResolution): string[] {
  const parts: string[] = [];
  if (resolution.unresolvedAssetIds.length > 0) {
    parts.push(`assetId(s) that did not resolve to a real asset: ${resolution.unresolvedAssetIds.join(", ")}`);
  }
  if (resolution.invalid.length > 0) {
    parts.push(
      `assetId(s) that resolved to a value missing the required { src, width, height, alt } shape: ${resolution.invalid
        .map((issue) => `${issue.assetId} (slot "${issue.key}")`)
        .join(", ")}`,
    );
  }
  if (resolution.unchecked.length > 0) {
    parts.push(`slot(s) asset resolution could not even attempt to resolve: ${resolution.unchecked.join(", ")}`);
  }
  return parts;
}
