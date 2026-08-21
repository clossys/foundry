/**
 * Plain TypeScript types for @vespeneventures/publisher/media's contract: one
 * addressable, reviewable media asset (`AssetEntry` — an `ImageAssetEntry`
 * or a `VideoAssetEntry`) and the record that groups a consumer's whole set
 * of them (`AssetRecord`). Pure data — no validation logic lives here (see
 * `schema.ts`) and no I/O (see `registry.ts`).
 *
 * This module is to `@vespeneventures/publisher/core`'s visual half exactly what
 * `@vespeneventures/writer` is to its verbal half: `copy` registers a
 * consumer's own words as addressable `CopyEntry`s, checkable and
 * resolvable by a stable id; `assets` registers a consumer's own images and
 * videos the same way. Where `SlotBinding.copyId` is an opaque seam into a
 * `CopyRecord`, `SlotBinding.assetId` (added in `@vespeneventures/publisher/core`
 * 0.3.0) is the identical seam into an `AssetRecord`. See that package's
 * `types.ts` doc comment for the shared reasoning; this file mirrors its
 * structure closely on purpose.
 *
 * No runtime schema library — this package's entire job is dependency-free
 * data shape validation, the same precedent `@vespeneventures/catalog`,
 * `@vespeneventures/policy`, `@vespeneventures/designer/tokens`, `@vespeneventures/writer/voice`,
 * and `@vespeneventures/writer` all hold to. `schema.ts` hand-rolls its own
 * type guards rather than reaching for a schema library, for the same
 * reason `copy`'s own `schema.ts` gives: a public package's only consumers
 * are external installers, and a schema-library dependency would force
 * every one of them onto that library's own major-version churn for the
 * sake of shape-checking a handful of nested objects.
 *
 * OUT OF SCOPE, ON PURPOSE: generation. This package is a registry — it
 * records that an asset with a given id exists, where it lives, and its
 * dimensions and alt text (plus, for video, its captions/transcript and its
 * reduced-motion behaviour). It never calls an image or video API, never
 * talks to a model, never makes a network request, and never transcodes or
 * extracts a poster frame. A generation adapter that FILLS this registry
 * (Recraft or otherwise) is a later, separate concern, and must never
 * become a dependency of this contract — this repository has already
 * retired two packages for getting that order backwards ("engine before
 * record"; see the root README's `../../docs/DECISIONS.md`).
 *
 * This file ships no example content of anyone's real assets. Every field
 * here is either required-and-generic or a structural placeholder — a real
 * product's real image/video ids, real URLs, and real alt text/captions are
 * a consumer's job, never this package's. See `@vespeneventures/writer`'s
 * README, "The single most important constraint" — this package holds the
 * identical line, one layer over, for media instead of words.
 *
 * V2 — A DISCRIMINATED `type`, RESPONSIVE IMAGE SOURCES, AND VIDEO
 * -------------------------------------------------------------------
 * v1 shipped `AssetEntry` as a single, image-only shape with no `type`
 * field at all — every entry was implicitly an image, `src` was exactly
 * one URL, and there was no way to register a video asset of any kind.
 * v2 (this file) makes `AssetEntry` a discriminated union of
 * `ImageAssetEntry` (`type: "image"`) and `VideoAssetEntry`
 * (`type: "video"`) — closing issue #177. `type` is REQUIRED: an existing
 * v1-shaped JSON entry with no `type` field is not a valid v2
 * `AssetEntry` and must be migrated by adding `type: "image"` — a
 * deliberate, one-time breaking change (see the package CHANGELOG's
 * `0.6.0` entry), not a silently-defaulted one, for the same reason this
 * file's own `alt` field has never been silently defaulted: a registry
 * that guesses a field's value on a caller's behalf is a registry that
 * hides the one piece of information ("is this actually an image?") a
 * reviewer most needs to see stated, not inferred.
 *
 * `licence`/`credit` are NOT new in v2 — both already existed as optional
 * free-text fields in v1, with real shape validation in `schema.ts`
 * (`licence-shape`/`credit-shape`). They stay optional here too. What v1
 * did not do is treat a missing licence as a reviewable finding — that gap
 * is closed in `coverage.ts`'s new `"asset-missing-licence"` finding, not
 * by making the field required at the schema layer. See that file's own
 * top comment for why coverage, not schema, is where this belongs: a
 * schema-level `licence-required` rule would make every already-registered
 * v1 entry invalid the moment its owner upgraded this package, which is
 * exactly the kind of upgrade-time breakage this package's own 0.x-minor
 * dependency discipline exists to avoid inflicting on a consumer without
 * their own choice in the matter.
 */

// ---------------------------------------------------------------------------
// AssetEntryId — the stable address of one entry
// ---------------------------------------------------------------------------

/**
 * A stable address for one `AssetEntry`, unique within its `AssetRecord`.
 * Dot-separated, lowercase, kebab-case within each segment — e.g.
 * `"marketing.hero-banner"`, `"onboarding.step-2.illustration"`. At least
 * one dot is required, for the identical reason
 * `@vespeneventures/writer`'s `CopyEntryId` requires one: a bare,
 * unnamespaced id like `"hero"` is exactly the kind of id that collides the
 * moment a second feature also needs a `"hero"` asset. See `schema.ts`'s
 * `ASSET_ENTRY_ID_RE` for the exact pattern this shape is validated
 * against.
 *
 * A plain `string` alias, not a branded/nominal type — same reasoning as
 * `CopyEntryId`: this package has no runtime mechanism to keep a caller
 * from constructing one by hand outside `validateAssetRecordShape`/
 * `parseAssetRecord`, so a branded type would be a false promise at the
 * type level.
 */
export type AssetEntryId = string;

// ---------------------------------------------------------------------------
// AssetEntryBase — fields every entry carries, regardless of type
// ---------------------------------------------------------------------------

/**
 * Fields shared by every `AssetEntry`, regardless of `type`. Not exported
 * on its own — a caller always works with the discriminated `AssetEntry`
 * union, never this base shape directly, the same way `DocumentBlock`'s
 * own member interfaces are each exported individually rather than through
 * a shared, un-discriminated base.
 */
interface AssetEntryBase {
  /** Stable address. Unique within the `AssetRecord` it belongs to — see `AssetEntryId`. */
  id: AssetEntryId;
  /**
   * Required — deliberately not optional. An asset registry that allows
   * `alt` to be omitted or blank will, once a generation adapter or a
   * renderer starts consuming it, produce inaccessible output for every
   * single asset it serves: there is no later point in this pipeline where
   * alt text can be recovered from a URL and two integers. The precedent is
   * already set one layer up — `@vespeneventures/publisher/core`'s own `ImageMeta.alt`
   * (`packages/surface/src/core/types.ts`) is required for exactly this reason,
   * and a registry that fed that contract optional alt text would just move
   * the same accessibility bug one layer earlier. Whitespace-only strings
   * (`"   "`) are rejected the same way `@vespeneventures/publisher/core`'s
   * `validate.ts`'s `binding-value-shape` rejects a whitespace-only
   * `SlotBinding.value` — see `schema.ts` for the shared reasoning, restated
   * for this field. For a `VideoAssetEntry`, `alt` is the short, static
   * description a renderer that cannot play video at all (see
   * `../internal/assets.ts`'s `toStaticRenderAsset`) falls back to — it is
   * NOT a substitute for `captions`/`transcript`, which describe the
   * video's actual audio/visual content over time; see those fields' own
   * doc comments.
   */
  alt: string;
  /**
   * The asset's MIME type, e.g. `"image/png"`, `"video/mp4"`. Optional,
   * but genuinely load-bearing when present: a renderer choosing how to
   * embed an asset (inline `<img>` vs. a CID attachment in `./email`,
   * whether an SVG can be inlined as markup vs. must be referenced) needs
   * to know the content type up front, without fetching or sniffing the
   * bytes at `src` — this registry is the one place that information can be
   * recorded once, at authoring time, rather than re-derived by every
   * renderer from a file extension that may not even be present in a URL.
   * For a `VideoAssetEntry` with more than one `sources` entry, each
   * source's own `mimeType` (required there — see `VideoSource`) is what a
   * renderer actually uses per `<source>`; this top-level field is for a
   * caller that wants one summary content type for the entry as a whole.
   */
  mimeType?: string;
  /**
   * The usage terms this asset may be published under, e.g.
   * `"CC-BY-4.0"`, `"proprietary — internal use only"`, `"licensed,
   * expires 2027-01-01"`. Optional, and deliberately a free-text string
   * rather than a closed enum — this package has no authority over what
   * licences a consumer's assets actually carry, the same reasoning
   * `StyleBinding`'s token role names in `@vespeneventures/publisher/core` are
   * unvalidated strings rather than a closed vocabulary. Unlike `copy`
   * text, a media asset routinely carries real usage-rights constraints a
   * reviewer must be able to see next to the id before publication — this
   * field exists so that check never has to happen outside the registry,
   * from memory. Stays optional in v2 (see this file's own top comment,
   * "Licences and credits") — `coverage.ts`'s `"asset-missing-licence"`
   * warning is where an absent licence is surfaced, not a schema error.
   */
  licence?: string;
  /**
   * Attribution text a licence may require alongside the asset (a
   * photographer's or videographer's name, a stock library credit line).
   * Optional, and kept as its own field rather than folded into `licence`:
   * a licence NAME (`"CC-BY-4.0"`) and the specific attribution text it
   * obligates (`"Photo by Jane Doe on Example Stock"`) are two different
   * pieces of information a reviewer needs to check independently — many
   * licences require the latter even once the former is satisfied, and
   * losing track of `credit` is exactly the kind of drift a registry with a
   * dedicated field prevents.
   */
  credit?: string;
}

// ---------------------------------------------------------------------------
// ImageAssetEntry — a responsive-capable image asset
// ---------------------------------------------------------------------------

/**
 * One additional resolution/format an image is available at, beyond its
 * primary `src`. `format` — when present — signals a genuinely different
 * rendered format (e.g. `"image/avif"`, `"image/webp"`), not just a resize
 * of the same format; the same distinction a `<source type="...">` /
 * `srcset` pairing draws in real markup. Omitting `format` means "same
 * format as the primary `src`, different intrinsic width" — a plain
 * resolution variant for a `srcset` width descriptor.
 */
export interface ImageSource {
  src: string;
  /** This source's own intrinsic width in pixels — see `schema.ts`'s `"image-source-width-positive"`. */
  width: number;
  format?: string;
}

/**
 * One addressable, reviewable image asset — `AssetEntry`'s `type: "image"`
 * member. `src`/`width`/`height` are unchanged from v1 (backward-compatible
 * in shape, though `type: "image"` must now be added explicitly — see this
 * file's own top comment); `sources` is the new, optional list of
 * additional resolutions/formats for `<picture>`/`srcset` output.
 */
export interface ImageAssetEntry extends AssetEntryBase {
  type: "image";
  /**
   * Where the real bytes live — a URL, or a path a consumer's own build
   * resolves. A plain, unvalidated string: this package has no I/O access
   * to the asset itself (see the file's own top comment on scope) and
   * cannot confirm `src` is reachable, only that it is present and
   * non-empty. Resolving `src` into real bytes is a renderer's job, not
   * this registry's. The PRIMARY/fallback source — always present, unlike
   * `sources`, so a caller with no responsive-source needs at all can keep
   * authoring exactly the v1 shape (plus `type`).
   */
  src: string;
  /** Intrinsic width in pixels. Must be a positive number — see `schema.ts`'s `"width-positive"`. */
  width: number;
  /** Intrinsic height in pixels. Must be a positive number — see `schema.ts`'s `"height-positive"`. */
  height: number;
  /**
   * Additional resolutions/formats for responsive `<picture>`/`srcset`
   * output — see `ImageSource`. Optional; omitting it (or leaving it `[]`)
   * degrades to exactly the v1 single-`<img>` rendering behaviour — see
   * `../web/renderWebDocument.ts`'s own doc comment, "Responsive images".
   */
  sources?: ImageSource[];
}

// ---------------------------------------------------------------------------
// VideoAssetEntry — a video asset, with required accessibility metadata
// ---------------------------------------------------------------------------

/** One playable `<source>` for a `VideoAssetEntry` — `mimeType` is required (unlike `ImageSource.format`) because a `<source>` inside a `<video>` needs a real `type` attribute to let the browser skip formats it cannot play without downloading bytes first. */
export interface VideoSource {
  src: string;
  mimeType: string;
}

/** One `<track kind="captions">` — `srclang`/`label` are both required because a caption track with neither is not meaningfully selectable by a viewer choosing among multiple languages. */
export interface VideoCaption {
  src: string;
  srclang: string;
  label: string;
}

/**
 * How a `VideoAssetEntry` behaves under a viewer's `prefers-reduced-motion:
 * reduce` preference — required, not optional, and not a styling
 * suggestion. See `../web/renderWebDocument.ts`'s own doc comment,
 * "Reduced motion is a rendering-time decision, not a build-time one," for
 * exactly how a value here changes rendered output, and why this package
 * cannot itself observe the viewer's live preference at render time (this
 * package has no DOM/`window` access — see `RenderWebOptions
 * .prefersReducedMotion`).
 *
 *   - `"pause"` — the entry's own `autoplay` is honoured only when reduced
 *     motion is NOT active; under reduced motion, autoplay is suppressed.
 *   - `"no-autoplay"` — identical rendered behaviour to `"pause"` in this
 *     package (autoplay suppressed under reduced motion); kept as a
 *     distinct, separately nameable value because a consumer's own design
 *     system may attach different downstream meaning to the two (e.g. a
 *     client-side "resume on request" affordance for `"pause"` that this
 *     package does not implement) — see the non-goals in the package
 *     README.
 *   - `"static-poster"` — under reduced motion, the ENTIRE `<video>`
 *     element is replaced by a static `<img>` built from `poster` (see
 *     `schema.ts`'s `"video-static-poster-requires-poster"` — an entry
 *     declaring this value must also declare `poster`).
 */
export type VideoReducedMotionBehavior = "pause" | "no-autoplay" | "static-poster";

/**
 * One addressable, reviewable video asset — `AssetEntry`'s `type: "video"`
 * member, and this package's first video support of any kind (issue #177).
 * `sources` (at least one, each with a required `mimeType`),
 * `reducedMotion`, and at least one of `captions`/`transcript` are all
 * REQUIRED — see `schema.ts`'s `"video-sources-non-empty"`,
 * `"video-reduced-motion-required"`, and
 * `"video-caption-or-transcript-required"` for the schema-level
 * enforcement, and this file's own top comment for why a permissive schema
 * here would be the identical accessibility failure mode `alt`'s
 * required-and-non-whitespace rule already exists to prevent for images —
 * restated for video, and arguably worse, since recovering a caption track
 * or a transcript after the fact means re-transcribing the video, not
 * re-typing a sentence.
 */
export interface VideoAssetEntry extends AssetEntryBase {
  type: "video";
  /** At least one playable source — see `VideoSource`. Never empty; see `schema.ts`'s `"video-sources-non-empty"`. */
  sources: VideoSource[];
  /** Intrinsic width in pixels. Must be a positive number. */
  width: number;
  /** Intrinsic height in pixels. Must be a positive number. */
  height: number;
  /**
   * Caption tracks — see `VideoCaption`. At least one of `captions`/
   * `transcript` is required; see `schema.ts`'s
   * `"video-caption-or-transcript-required"`. May be present alongside
   * `transcript`, not only instead of it — a video can (and often should)
   * carry both.
   */
  captions?: VideoCaption[];
  /**
   * Inline transcript text, or a URL to one — a plain, unvalidated string
   * for the identical "this registry has no I/O access" reason `src` is.
   * At least one of `captions`/`transcript` is required — see `captions`'s
   * own doc comment.
   */
  transcript?: string;
  /**
   * A static poster-frame image URL — optional in general, but REQUIRED
   * when `reducedMotion === "static-poster"` (see
   * `schema.ts`'s `"video-static-poster-requires-poster"`) and is also
   * what every non-web channel (`./email`, `./print`, `./image`,
   * `./slides`) falls back to rendering in place of playback — see
   * `../internal/assets.ts`'s `toStaticRenderAsset`. A `VideoAssetEntry`
   * with no `poster` renders fine on `./web` but is an unresolvable
   * `AssetResolutionIssue` on every other channel.
   */
  poster?: string;
  /** See `VideoReducedMotionBehavior`. Required. */
  reducedMotion: VideoReducedMotionBehavior;
  /** Whether this entry asks to autoplay — subject to `reducedMotion` at render time; see that field's own doc comment. Defaults to `false`-equivalent (no autoplay) when omitted. */
  autoplay?: boolean;
  /** Whether this entry asks to loop. */
  loop?: boolean;
  /** Whether this entry asks to render muted. Most browsers refuse to autoplay an unmuted video regardless of this field — see the package README. */
  muted?: boolean;
}

/**
 * One addressable, reviewable media asset a consumer's product renders,
 * made addressable, reviewable, and checkable — either an image
 * (`ImageAssetEntry`) or a video (`VideoAssetEntry`), discriminated by
 * `type`. This package never populates `src`/`sources`/`poster` with
 * anything real — every `AssetEntry` a consumer's own repository registers
 * points at that consumer's own file or URL, the same way a `CopyRecord`'s
 * entries are never this package's words either.
 */
export type AssetEntry = ImageAssetEntry | VideoAssetEntry;

// ---------------------------------------------------------------------------
// AssetRecord — one consumer's whole registered set of entries
// ---------------------------------------------------------------------------

/**
 * One consumer's complete, registered set of asset entries. This is the
 * "brand.css" of this package, the same role `@vespeneventures/writer`'s
 * `CopyRecord` plays for text — foundry ships the schema this conforms to
 * and the machinery to check it, never a real instance of it.
 */
export interface AssetRecord {
  id: string;
  entries: AssetEntry[];
}

// ---------------------------------------------------------------------------
// AssetFinding — shared shape, mirroring @vespeneventures/writer's own `CopyFinding`
// ---------------------------------------------------------------------------

/**
 * One thing `schema.ts`'s shape validation (or `coverage.ts`'s coverage
 * check) found wrong with a candidate `AssetRecord`/`AssetEntry`, or with a
 * referenced-vs-registered comparison. Deliberately the same shape as
 * `@vespeneventures/writer`'s `CopyFinding` (itself mirroring
 * `@vespeneventures/writer/voice`'s `VoiceFinding` and `@vespeneventures/policy`'s
 * `Finding`) — `rule` / `severity` / `message` / optional `path` — so a
 * caller already handling one kind of finding in this ecosystem does not
 * need a second mental model for this package's.
 *
 * Unlike `CopyFinding` (always `"error"` in practice), THIS package's
 * `coverage.ts` genuinely uses `"warning"` — a registered-but-never-
 * referenced asset (or a registered asset with no `licence`) is real
 * information a reviewer wants, but it is not the same severity as a
 * referenced-but-unregistered asset (which means a renderer is about to
 * fail, or already silently rendering nothing). See `coverage.ts` for
 * exactly which rule gets which severity.
 */
export interface AssetFinding {
  /** Stable identifier for the rule that produced this finding, e.g. `"id-shape"`, `"unregistered-asset"`. */
  rule: string;
  severity: "error" | "warning";
  /** Human-readable description of the problem. */
  message: string;
  /** The specific field, entry index, or asset id this finding is about, when there is a single clear one. */
  path?: string;
}
