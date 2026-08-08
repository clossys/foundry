/**
 * Plain TypeScript types for @vespeneventures/assets's contract: one
 * addressable, reviewable image asset (`AssetEntry`) and the record that
 * groups a consumer's whole set of them (`AssetRecord`). Pure data — no
 * validation logic lives here (see `schema.ts`) and no I/O (see
 * `registry.ts`).
 *
 * This package is to `@vespeneventures/compose`'s visual half exactly what
 * `@vespeneventures/copy` is to its verbal half: `copy` registers a
 * consumer's own words as addressable `CopyEntry`s, checkable and
 * resolvable by a stable id; `assets` registers a consumer's own images the
 * same way. Where `SlotBinding.copyId` is an opaque seam into a
 * `CopyRecord`, `SlotBinding.assetId` (added in `@vespeneventures/compose`
 * 0.3.0) is the identical seam into an `AssetRecord`. See that package's
 * `types.ts` doc comment for the shared reasoning; this file mirrors its
 * structure closely on purpose.
 *
 * No runtime schema library — this package's entire job is dependency-free
 * data shape validation, the same precedent `@vespeneventures/catalog`,
 * `@vespeneventures/policy`, `@vespeneventures/tokens`, `@vespeneventures/voice`,
 * and `@vespeneventures/copy` all hold to. `schema.ts` hand-rolls its own
 * type guards rather than reaching for a schema library, for the same
 * reason `copy`'s own `schema.ts` gives: a public package's only consumers
 * are external installers, and a schema-library dependency would force
 * every one of them onto that library's own major-version churn for the
 * sake of shape-checking a handful of nested objects.
 *
 * OUT OF SCOPE, ON PURPOSE: generation. This package is a registry — it
 * records that an asset with a given id exists, where it lives, and its
 * dimensions and alt text. It never calls an image API, never talks to a
 * model, never makes a network request. A generation adapter that FILLS
 * this registry (Recraft or otherwise) is a later, separate concern, and
 * must never become a dependency of this contract — this repository has
 * already retired two packages for getting that order backwards ("engine
 * before record"; see the root README's `../../docs/DECISIONS.md`).
 *
 * This file ships no example content of anyone's real assets. Every field
 * here is either required-and-generic or a structural placeholder — a real
 * product's real image ids, real URLs, and real alt text are a consumer's
 * job, never this package's. See `@vespeneventures/copy`'s README, "The
 * single most important constraint" — this package holds the identical
 * line, one layer over, for images instead of words.
 */

// ---------------------------------------------------------------------------
// AssetEntryId — the stable address of one entry
// ---------------------------------------------------------------------------

/**
 * A stable address for one `AssetEntry`, unique within its `AssetRecord`.
 * Dot-separated, lowercase, kebab-case within each segment — e.g.
 * `"marketing.hero-banner"`, `"onboarding.step-2.illustration"`. At least
 * one dot is required, for the identical reason
 * `@vespeneventures/copy`'s `CopyEntryId` requires one: a bare,
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
// AssetEntry — one addressable, reviewable image asset
// ---------------------------------------------------------------------------

/**
 * One image asset a consumer's product renders, made addressable,
 * reviewable, and checkable. This package never populates `src` with
 * anything real — every `AssetEntry` a consumer's own repository registers
 * points at that consumer's own file or URL, the same way a `CopyRecord`'s
 * entries are never this package's words either.
 */
export interface AssetEntry {
  /** Stable address. Unique within the `AssetRecord` it belongs to — see `AssetEntryId`. */
  id: AssetEntryId;
  /**
   * Where the real bytes live — a URL, or a path a consumer's own build
   * resolves. A plain, unvalidated string: this package has no I/O access
   * to the asset itself (see the file's own top comment on scope) and
   * cannot confirm `src` is reachable, only that it is present and
   * non-empty. Resolving `src` into real bytes is a renderer's job, not
   * this registry's.
   */
  src: string;
  /** Intrinsic width in pixels. Must be a positive number — see `schema.ts`'s `"asset-width-positive"`. */
  width: number;
  /** Intrinsic height in pixels. Must be a positive number — see `schema.ts`'s `"asset-height-positive"`. */
  height: number;
  /**
   * Required — deliberately not optional. An asset registry that allows
   * `alt` to be omitted or blank will, once a generation adapter or a
   * renderer starts consuming it, produce inaccessible output for every
   * single image it serves: there is no later point in this pipeline where
   * alt text can be recovered from a URL and two integers. The precedent is
   * already set one layer up — `@vespeneventures/compose`'s own `ImageMeta.alt`
   * (`packages/compose/src/types.ts`) is required for exactly this reason,
   * and a registry that fed that contract optional alt text would just move
   * the same accessibility bug one layer earlier. Whitespace-only strings
   * (`"   "`) are rejected the same way `@vespeneventures/compose`'s
   * `validate.ts`'s `binding-value-shape` rejects a whitespace-only
   * `SlotBinding.value` — see `schema.ts` for the shared reasoning, restated
   * for this field.
   */
  alt: string;
  /**
   * The asset's MIME type, e.g. `"image/png"`, `"image/svg+xml"`. Optional,
   * but genuinely load-bearing when present: a renderer choosing how to
   * embed an asset (inline `<img>` vs. a CID attachment in `./email`,
   * whether an SVG can be inlined as markup vs. must be referenced) needs
   * to know the content type up front, without fetching or sniffing the
   * bytes at `src` — this registry is the one place that information can be
   * recorded once, at authoring time, rather than re-derived by every
   * renderer from a file extension that may not even be present in a URL.
   */
  mimeType?: string;
  /**
   * The usage terms this asset may be published under, e.g.
   * `"CC-BY-4.0"`, `"proprietary — internal use only"`, `"licensed,
   * expires 2027-01-01"`. Optional, and deliberately a free-text string
   * rather than a closed enum — this package has no authority over what
   * licences a consumer's assets actually carry, the same reasoning
   * `StyleBinding`'s token role names in `@vespeneventures/compose` are
   * unvalidated strings rather than a closed vocabulary. Unlike `copy`
   * text, an image asset routinely carries real usage-rights constraints a
   * reviewer must be able to see next to the id before publication — this
   * field exists so that check never has to happen outside the registry,
   * from memory.
   */
  licence?: string;
  /**
   * Attribution text a licence may require alongside the asset (a
   * photographer's name, a stock library credit line). Optional, and kept
   * as its own field rather than folded into `licence`: a licence NAME
   * (`"CC-BY-4.0"`) and the specific attribution text it obligates
   * (`"Photo by Jane Doe on Example Stock"`) are two different pieces of
   * information a reviewer needs to check independently — many licences
   * require the latter even once the former is satisfied, and losing track
   * of `credit` is exactly the kind of drift a registry with a dedicated
   * field prevents.
   */
  credit?: string;
}

// ---------------------------------------------------------------------------
// AssetRecord — one consumer's whole registered set of entries
// ---------------------------------------------------------------------------

/**
 * One consumer's complete, registered set of asset entries. This is the
 * "brand.css" of this package, the same role `@vespeneventures/copy`'s
 * `CopyRecord` plays for text — foundry ships the schema this conforms to
 * and the machinery to check it, never a real instance of it.
 */
export interface AssetRecord {
  id: string;
  entries: AssetEntry[];
}

// ---------------------------------------------------------------------------
// AssetFinding — shared shape, mirroring @vespeneventures/copy's own `CopyFinding`
// ---------------------------------------------------------------------------

/**
 * One thing `schema.ts`'s shape validation (or `coverage.ts`'s coverage
 * check) found wrong with a candidate `AssetRecord`/`AssetEntry`, or with a
 * referenced-vs-registered comparison. Deliberately the same shape as
 * `@vespeneventures/copy`'s `CopyFinding` (itself mirroring
 * `@vespeneventures/voice`'s `VoiceFinding` and `@vespeneventures/policy`'s
 * `Finding`) — `rule` / `severity` / `message` / optional `path` — so a
 * caller already handling one kind of finding in this ecosystem does not
 * need a second mental model for this package's.
 *
 * Unlike `CopyFinding` (always `"error"` in practice), THIS package's
 * `coverage.ts` genuinely uses `"warning"` — a registered-but-never-
 * referenced asset is real information a reviewer wants, but it is not the
 * same severity as a referenced-but-unregistered asset (which means a
 * renderer is about to fail, or already silently rendering nothing). See
 * `coverage.ts` for exactly which rule gets which severity.
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
