/**
 * The asset-resolution companion to `internal/tokens.ts`/`internal/
 * typography.ts` — the shared foundation every channel this package ships
 * (`./web`, `./email`, `./print`, `./image`, `./slides`) needs now that
 * `@vespeneventures/publisher/core` 0.3.0 added `SlotBinding.assetId` and
 * `@vespeneventures/publisher/media` exists to register what an `assetId` actually
 * points AT. Built once here, rather than reinvented (and re-drifted) five
 * times — the exact reasoning `@vespeneventures/publisher/core`'s own
 * `resolve-assets.ts` gives for shipping `resolveAssets` at all: "issue
 * #43 — a rule every renderer must independently remember is a rule one of
 * them will forget." This module is where that rule lives for THIS
 * package's five renderers.
 *
 * WHAT THIS MODULE ADDS ON TOP OF `resolveAssets` ITSELF
 * -----------------------------------------------------------
 * `@vespeneventures/publisher/core`'s `resolveAssets` deliberately stops one step
 * short of what a renderer needs: its `AssetLookup` returns `unknown` (see
 * that file's own doc comment, "why this function does not know what an
 * asset looks like" — `surface/core` has zero dependency on
 * `@vespeneventures/publisher/media`, not even for a type), so `AssetResolveResult
 * .assets[].asset` is `unknown` too. A renderer that just assumed a shape
 * (`(asset as any).src`) and rendered it would be exactly the "silent
 * fallback" failure this whole package refuses everywhere else. So this
 * module's whole job is: validate `unknown` into a real, paintable shape
 * (`RenderAsset`, below) at the one place every channel already has to
 * trust a caller-supplied function's return value, and report anything
 * that doesn't fit that shape as its own, named failure (`invalid`) —
 * never silently coerced, never silently dropped.
 *
 * `RenderAsset` IS NOT AN IMPORT OF `@vespeneventures/publisher/media`'S `AssetEntry`
 * -----------------------------------------------------------------------------
 * `RenderAsset` below is structurally identical to `@vespeneventures/
 * media`'s `AssetEntry` (same discriminated `type: "image" | "video"`
 * shape, same field names) — deliberately, since a real `AssetLookup` in
 * practice wraps exactly that package's registry — but this package does
 * not import `@vespeneventures/publisher/media` to get it. Same "opaque seam,
 * not a code import" reasoning `@vespeneventures/publisher/core`'s own
 * `resolve-assets.ts` gives for `AssetLookup` itself: `@vespeneventures/
 * surface` works whether or not `@vespeneventures/publisher/media` is even
 * installed, and a caller with a completely different `assetId -> asset`
 * source (a CMS, a CDN manifest, a hand-rolled map in a test) only needs to
 * return something with the right fields — never that package's own type.
 * This is also why `RenderAsset` carries only the fields a renderer
 * actually paints and not `@vespeneventures/publisher/media`'s own
 * `licence`/`credit` — those are registry/review metadata, not rendering
 * inputs, and reading them here would blur that this package never needs
 * them. `type` IS carried here — unlike `licence`/`credit`, a renderer
 * genuinely needs to know which of the two shapes it is looking at before
 * it can paint anything at all, which is exactly why v2 (issue #177) adds
 * the identical discriminated extension to this contract, in parallel with
 * `@vespeneventures/publisher/media`'s own — see `RenderImageAsset`/
 * `RenderVideoAsset` below.
 *
 * ALT IS REQUIRED HERE FOR THE IDENTICAL REASON IT IS REQUIRED ON `AssetEntry`
 * -------------------------------------------------------------------------------
 * `@vespeneventures/publisher/media`'s own `AssetEntryBase.alt` doc comment:
 * "there is no later point in this pipeline where alt text can be
 * recovered from a URL and two integers." This module is that later
 * point, and it holds the identical line: a resolved asset with a missing
 * or whitespace-only `alt` is `invalid`, exactly like one with no `src`/
 * `sources` at all — never rendered, never silently given an empty
 * `alt=""`.
 *
 * VIDEO'S OWN ACCESSIBILITY BAR IS ENFORCED HERE TOO — NOT ONLY AT SCHEMA TIME
 * -------------------------------------------------------------------------------
 * `@vespeneventures/publisher/media`'s `schema.ts` refuses a `VideoAssetEntry`
 * with neither `captions` nor `transcript` before it can ever be
 * registered. But `RenderAsset` is NOT an import of `AssetEntry` (see
 * above) — a hand-rolled `AssetLookup` (a CMS, a CDN manifest, a test
 * double) can hand this module a video-shaped value that never passed
 * through that schema at all. `isRenderVideoAsset` holds the identical
 * caption-or-transcript and `reducedMotion` bars independently, for the
 * same "never a plausible-looking wrong value" reason `alt` already is:
 * this is the one place every channel actually trusts a resolved asset's
 * shape, so it is also the one place that trust has to be earned in full,
 * regardless of what did or didn't validate the value upstream.
 *
 * URL SCHEME CHECKING — EVERY `src`/`poster` THIS MODULE VALIDATES IS
 * SCHEME-CHECKED, NEVER STRING-MATCHED
 * -------------------------------------------------------------------------------
 * A `RenderAsset`'s `src`/`sources[].src`/`poster` values flow directly
 * into a renderer's `src`/`poster` HTML attribute (`./web`'s `<img>`/
 * `<source>`/`<video>`, and every non-web channel's own `<img>`/`<image>`
 * fallback). `isAllowedAssetUrl` below applies the same disciplined check
 * `../document/validate.ts` already established for `DocumentInline`
 * "link" hrefs: parse with `new URL`, compare `.protocol` against a closed
 * allowlist, never a prefix/substring string match — reproduced locally
 * here (not imported) for the same reason `../document/validate.ts`
 * itself reproduces `packages/auth/src/redirect.ts`'s scheme check rather
 * than importing it: this package does not and should not depend on
 * `document`'s validator just for one shared helper, and each subpath's
 * own small, local copy is cheaper than a cross-subpath dependency for a
 * handful of lines. The allowlist here is deliberately NARROWER than
 * `document`'s own (`https:`/`http:` only — no `mailto:`, which makes no
 * sense for an image/video source): an asset `src` is never a prose link a
 * reader clicks, so there is no reason to accept a scheme document's own
 * link validator accepts for that different purpose.
 *
 * A value that does not parse as an absolute URL at all (throws inside
 * `new URL`) is treated as the "a path a consumer's own build resolves"
 * case `@vespeneventures/publisher/media`'s `ImageAssetEntry.src` doc
 * comment has always explicitly allowed, since v1 — a bundler-relative
 * import path (`"./hero.png"`, `"assets/hero.png"`) has no scheme to
 * check and is accepted unchanged, exactly as it always has been. This is
 * intentionally NOT the same acceptance rule `../document/validate.ts`
 * uses for prose links (which rejects a path-relative href outright,
 * because a document can be mounted at more than one route) — an asset
 * `src` has no such "mounted at more than one route" ambiguity; it is
 * resolved once, by the consumer's own build, the same way it always has
 * been. What IS rejected, the same way `../document/validate.ts` rejects
 * it: a `"//host/path"` PROTOCOL-RELATIVE value — it reads as same-site
 * and is not, resolving to whatever host follows the `//`, and unlike a
 * genuinely relative build path, it unambiguously LOOKS like an attempt at
 * an absolute URL, so it is held to that bar rather than let through as
 * "just a path." A rejected value is never silently dropped: it makes the
 * whole asset `invalid`, exactly like a missing `alt`.
 */

import { resolveAssets } from "../core/index.js";
import type { AssetLookup, ResolveResult, SurfaceSlotSpec } from "../core/index.js";

// ─────────────────────────────────────────────────────────────────────────
// RenderAsset — the discriminated shape every channel actually paints from
// ─────────────────────────────────────────────────────────────────────────

/** One additional resolution/format for a `RenderImageAsset` — see `@vespeneventures/publisher/media`'s `ImageSource`, which this mirrors structurally without importing it (see this file's own top comment). */
export interface RenderImageSource {
  src: string;
  width: number;
  format?: string;
}

/**
 * What every channel needs to paint an image — `type: "image"` plus the
 * same `src`/`width`/`height`/`alt`/`mimeType` shape this module has
 * always exposed, plus the new, optional `sources` for responsive
 * `<picture>`/`srcset` output. `width`/`height` are the asset's own
 * INTRINSIC pixel dimensions (never a slot's `Frame`) — `./web`/`./email`
 * emit them directly as the caller's layout-shift-avoiding intrinsic size;
 * `./print`/`./image`/`./slides` additionally compare them against a
 * slot's frame for the aspect-ratio warning (see `./image`'s
 * `renderSlots.ts`).
 */
export interface RenderImageAsset {
  type: "image";
  src: string;
  width: number;
  height: number;
  alt: string;
  mimeType?: string;
  /** Optional. Only `./web` reads this — see `renderWebDocument.ts`'s own doc comment, "Responsive images." Every other channel ignores it entirely (an explicit non-goal — see the package README). */
  sources?: RenderImageSource[];
}

/** One playable `<source>` for a `RenderVideoAsset` — see `@vespeneventures/publisher/media`'s `VideoSource`. */
export interface RenderVideoSource {
  src: string;
  mimeType: string;
}

/** One `<track kind="captions">` for a `RenderVideoAsset` — see `@vespeneventures/publisher/media`'s `VideoCaption`. */
export interface RenderVideoCaption {
  src: string;
  srclang: string;
  label: string;
}

/**
 * What `./web` needs to paint a `<video>` — see this file's own top
 * comment, "Video's own accessibility bar is enforced here too," for why
 * `captions`/`transcript`/`reducedMotion` are checked by
 * {@link isRenderVideoAsset} even though `@vespeneventures/publisher/media`'s
 * `schema.ts` already checks the identical thing at registry time. Every
 * non-web channel never sees this shape directly — see
 * `toStaticRenderAsset`, below, for how each of them instead reduces a
 * `RenderVideoAsset` to its `poster`.
 */
export interface RenderVideoAsset {
  type: "video";
  sources: RenderVideoSource[];
  width: number;
  height: number;
  alt: string;
  mimeType?: string;
  poster?: string;
  captions?: RenderVideoCaption[];
  transcript?: string;
  reducedMotion: "pause" | "no-autoplay" | "static-poster";
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

/** Either shape a resolved `assetId` binding can now produce — discriminated by `type`, mirroring `@vespeneventures/publisher/media`'s own `AssetEntry` union without importing it (see this file's own top comment). */
export type RenderAsset = RenderImageAsset | RenderVideoAsset;

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// URL scheme checking — see this file's own top comment
// ─────────────────────────────────────────────────────────────────────────

/** Closed allowlist for a `RenderAsset`'s `src`/`poster` values — see this file's own top comment for why this is narrower than `../document/validate.ts`'s own link allowlist. */
const ALLOWED_ASSET_URL_SCHEMES = ["https:", "http:"] as const;

/**
 * `true` when `src` is safe to emit into a `src`/`poster` HTML attribute —
 * see this file's own top comment for the full rule. Never a prefix/
 * substring string match: every absolute-URL-shaped value is parsed with
 * `new URL` and checked against {@link ALLOWED_ASSET_URL_SCHEMES}; a value
 * that does not parse as an absolute URL at all is treated as a
 * consumer-build-resolved relative path (accepted, unchanged from this
 * package's v1 behavior) UNLESS it is protocol-relative (`"//host/path"`),
 * which is rejected outright — see this file's own top comment for why
 * that one shape is held to the absolute-URL bar despite not parsing as
 * one on its own.
 */
export function isAllowedAssetUrl(src: string): boolean {
  if (src.startsWith("//")) return false;
  let url: URL | undefined;
  try {
    url = new URL(src);
  } catch {
    return true; // Not an absolute URL at all — a build-resolved relative path; see this file's own top comment.
  }
  return (ALLOWED_ASSET_URL_SCHEMES as readonly string[]).includes(url.protocol);
}

// ─────────────────────────────────────────────────────────────────────────
// isRenderImageAsset / isRenderVideoAsset / isRenderAsset
// ─────────────────────────────────────────────────────────────────────────

function isRenderImageSource(value: unknown): value is RenderImageSource {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.src) || !isAllowedAssetUrl(candidate.src)) return false;
  if (!isFinitePositive(candidate.width)) return false;
  if (candidate.format !== undefined && typeof candidate.format !== "string") return false;
  return true;
}

/**
 * Structural validation of `unknown` into a real `RenderImageAsset` —
 * hand-rolled `typeof`/shape checks, no schema library, the same
 * discipline `@vespeneventures/publisher/media`'s own `schema.ts` holds to.
 * Every field is checked independently so a single malformed field (a
 * `width` of `0`, a blank `alt`, a `javascript:` `src`) is exactly as
 * fatal as a completely wrong-shaped value — there is no "close enough"
 * here, the same "never a plausible-looking wrong value" bar
 * `internal/tokens.ts` holds for color.
 */
export function isRenderImageAsset(value: unknown): value is RenderImageAsset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "image") return false;
  if (!isNonEmptyString(candidate.src) || !isAllowedAssetUrl(candidate.src)) return false;
  if (!isFinitePositive(candidate.width)) return false;
  if (!isFinitePositive(candidate.height)) return false;
  if (!isNonWhitespaceString(candidate.alt)) return false;
  if (candidate.mimeType !== undefined && typeof candidate.mimeType !== "string") return false;
  if (candidate.sources !== undefined) {
    if (!Array.isArray(candidate.sources)) return false;
    if (!candidate.sources.every(isRenderImageSource)) return false;
  }
  return true;
}

function isRenderVideoSource(value: unknown): value is RenderVideoSource {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.src) || !isAllowedAssetUrl(candidate.src)) return false;
  if (!isNonEmptyString(candidate.mimeType)) return false;
  return true;
}

function isRenderVideoCaption(value: unknown): value is RenderVideoCaption {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.src) || !isAllowedAssetUrl(candidate.src)) return false;
  if (!isNonEmptyString(candidate.srclang)) return false;
  if (!isNonEmptyString(candidate.label)) return false;
  return true;
}

const REDUCED_MOTION_VALUES = new Set(["pause", "no-autoplay", "static-poster"]);

/**
 * Structural validation of `unknown` into a real `RenderVideoAsset` — the
 * video counterpart to {@link isRenderImageAsset}. See this file's own top
 * comment, "Video's own accessibility bar is enforced here too," for why
 * `captions`/`transcript`/`reducedMotion` are real checks here, not merely
 * assumed to have already happened upstream.
 */
export function isRenderVideoAsset(value: unknown): value is RenderVideoAsset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "video") return false;
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) return false;
  if (!candidate.sources.every(isRenderVideoSource)) return false;
  if (!isFinitePositive(candidate.width)) return false;
  if (!isFinitePositive(candidate.height)) return false;
  if (!isNonWhitespaceString(candidate.alt)) return false;
  if (candidate.mimeType !== undefined && typeof candidate.mimeType !== "string") return false;

  if (candidate.poster !== undefined) {
    if (!isNonEmptyString(candidate.poster) || !isAllowedAssetUrl(candidate.poster)) return false;
  }

  const hasCaptions = Array.isArray(candidate.captions) && candidate.captions.length > 0 && candidate.captions.every(isRenderVideoCaption);
  if (candidate.captions !== undefined && !hasCaptions) return false; // present but malformed/empty is fatal, not "treat as absent"
  const hasTranscript = candidate.transcript !== undefined && isNonWhitespaceString(candidate.transcript);
  if (candidate.transcript !== undefined && !hasTranscript) return false;
  if (!hasCaptions && !hasTranscript) return false;

  if (typeof candidate.reducedMotion !== "string" || !REDUCED_MOTION_VALUES.has(candidate.reducedMotion)) return false;
  if (candidate.reducedMotion === "static-poster" && candidate.poster === undefined) return false;

  if (candidate.autoplay !== undefined && typeof candidate.autoplay !== "boolean") return false;
  if (candidate.loop !== undefined && typeof candidate.loop !== "boolean") return false;
  if (candidate.muted !== undefined && typeof candidate.muted !== "boolean") return false;

  return true;
}

/** `true` for a value that is either a well-formed `RenderImageAsset` or a well-formed `RenderVideoAsset` — the discriminated replacement for this module's pre-v2 `isRenderAsset`. Every existing caller (`resolveDocumentAssets`, every channel's own asset loop) keeps working unchanged: this function's NAME and CONTRACT ("is this a real, paintable asset") are identical, only its internals now dispatch on `type`. */
export function isRenderAsset(value: unknown): value is RenderAsset {
  return isRenderImageAsset(value) || isRenderVideoAsset(value);
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
 * What `resolveDocumentAssets` returns — `@vespeneventures/publisher/core`'s own
 * `AssetResolveResult`, with `assets` replaced by a validated, paintable
 * `byKey` map and `unresolvedAssetIds` augmented by a NEW `invalid` bucket
 * for the failure `resolveAssets` itself cannot see (it never looks inside
 * `asset: unknown` — see this file's top comment).
 */
export interface RenderAssetResolution {
  /** Slot key -> validated, paintable `RenderAsset`. Only ever contains entries that passed {@link isRenderAsset} — never a partially-valid or coerced value. */
  byKey: Map<string, RenderAsset>;
  /** `assetId`s `lookup` returned `undefined`/`null` for — see `AssetLookup`'s own doc comment in `@vespeneventures/publisher/core`. */
  unresolvedAssetIds: string[];
  /** Slot keys `resolveAssets` could not even attempt to resolve — no source, an ambiguous binding, `lookup` not a function, or `lookup` threw for that slot. See `@vespeneventures/publisher/core`'s own `resolveAssets` doc comment. */
  unchecked: string[];
  /** `assetId`s that DID resolve (via `lookup`) but to a value that fails {@link isRenderAsset} — this module's own addition; `resolveAssets` itself has no way to see this, since its `AssetLookup` return type is `unknown` on purpose. Every entry here is exactly as fatal as an unresolved one — see this file's top comment. */
  invalid: AssetResolutionIssue[];
  /** Slot keys legitimately not this pass's job — their one source of content is `copyId`/`value`, not `assetId`. Never a failure; see `@vespeneventures/publisher/core`'s own `resolveAssets`, `deferredToCopy`. */
  deferredToCopy: string[];
}

/**
 * Resolves every `assetId` binding in `result` (from `resolveDocument`) via
 * `lookup`, and validates each successfully-looked-up value into a real,
 * paintable `RenderAsset` — see this file's top comment for why that
 * validation step exists and why it lives here rather than in
 * `@vespeneventures/publisher/core` itself.
 *
 * `lookup` is optional — omitting it (the same convention every
 * `resolveCopyId`/`CopyLookup` option in this package already uses) is
 * treated exactly like a lookup that resolves nothing: every `assetId`
 * binding in the document lands in `unresolvedAssetIds`/`unchecked` per
 * `resolveAssets`'s own "lookup is not a function" branch, never silently
 * ignored.
 *
 * NEVER HAND-ROLLED: this function's whole first half IS a call to
 * `@vespeneventures/publisher/core`'s own `resolveAssets` — see this package's own
 * task brief and issue #43 the module comment above cites. Everything this
 * function adds is the shape-validation step that function's own zero-
 * dependency design deliberately leaves to its caller.
 */
export function resolveDocumentAssets<TSpec extends SurfaceSlotSpec>(result: ResolveResult<TSpec>, lookup: AssetLookup | undefined): RenderAssetResolution {
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
      `assetId(s) that resolved to a value that did not match the required RenderImageAsset or RenderVideoAsset shape (see internal/assets.ts for the by-type-required fields): ${resolution.invalid
        .map((issue) => `${issue.assetId} (slot "${issue.key}")`)
        .join(", ")}`,
    );
  }
  if (resolution.unchecked.length > 0) {
    parts.push(`slot(s) asset resolution could not even attempt to resolve: ${resolution.unchecked.join(", ")}`);
  }
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────
// toStaticRenderAsset / resolveStaticAssets — the non-web channels' shared
// video decision
// ─────────────────────────────────────────────────────────────────────────

/** The single-image shape every non-web, static-canvas/markup channel (`./email`, `./print`, `./image`, `./slides`) actually paints — none of them has any video playback capability at all. See {@link toStaticRenderAsset}. */
export interface StaticRenderAsset {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Reduces any `RenderAsset` to the flat, single-image shape every
 * non-web channel actually paints — the one deliberate, documented place
 * this package decides what a video entry does on a channel with zero
 * playback capability, made once here rather than five times (see this
 * file's own top comment, issue #43).
 *
 *   - An image asset reduces to exactly itself, `sources` DROPPED — no
 *     responsive-source support on a static-canvas/email format, an
 *     explicit non-goal (see the package README): every non-web channel
 *     already renders exactly one `<img>`/`<image>` per slot, and there is
 *     no `<picture>`-equivalent construct in an SVG canvas or (reliably)
 *     in an email client to make a second source meaningful.
 *   - A video asset reduces to its `poster`, when present — a static
 *     poster frame is the only sensible non-interactive rendering of a
 *     video on a channel that cannot play anything. A video asset with NO
 *     `poster` returns `undefined`: there is nothing this function can
 *     paint, and inventing a placeholder box would be exactly the "silent
 *     fallback" this whole package refuses everywhere else — see
 *     `resolveStaticAssets`, below, for how each channel turns that
 *     `undefined` into a real, attributed refusal rather than a gap.
 */
export function toStaticRenderAsset(asset: RenderAsset): StaticRenderAsset | undefined {
  if (asset.type === "image") {
    return { src: asset.src, width: asset.width, height: asset.height, alt: asset.alt };
  }
  if (asset.poster === undefined) return undefined;
  return { src: asset.poster, width: asset.width, height: asset.height, alt: asset.alt };
}

/** What `resolveStaticAssets` returns — see that function's own doc comment. */
export interface StaticAssetResolution {
  /** Slot key -> the flat, paintable `StaticRenderAsset` every non-web channel actually renders. */
  byKey: Map<string, StaticRenderAsset>;
  /** Slot keys whose resolved asset was a video with no `poster` — this channel has nothing to paint for these. Every entry here is exactly as fatal as an entry in `RenderAssetResolution.invalid`; see each channel's own refusal check. */
  posterlessVideo: string[];
}

/**
 * Applies {@link toStaticRenderAsset} across an already-resolved
 * `RenderAssetResolution.byKey`, for the four non-web channels
 * (`./email`, `./print`, `./image`, `./slides`) — never called by `./web`,
 * which paints the full discriminated `RenderAsset` shape directly (real
 * `<picture>`/`<video>` support; see `../web/renderWebDocument.ts`).
 */
export function resolveStaticAssets(resolution: RenderAssetResolution): StaticAssetResolution {
  const byKey = new Map<string, StaticRenderAsset>();
  const posterlessVideo: string[] = [];
  for (const [key, asset] of resolution.byKey) {
    const flat = toStaticRenderAsset(asset);
    if (flat === undefined) {
      posterlessVideo.push(key);
    } else {
      byKey.set(key, flat);
    }
  }
  return { byKey, posterlessVideo };
}

/** Human-readable clause for `StaticAssetResolution.posterlessVideo` — the video-specific counterpart to {@link describeAssetProblems}, appended alongside it in every non-web channel's own refusal message. */
export function describeStaticAssetProblems(staticAssets: StaticAssetResolution): string[] {
  if (staticAssets.posterlessVideo.length === 0) return [];
  return [
    `slot(s) resolved to a video asset with no poster image, which this channel has no playback capability to render instead: ${staticAssets.posterlessVideo.join(", ")}`,
  ];
}
