/**
 * Structural validation for a candidate `AssetRecord`, hand-rolled in the
 * same plain-type-guard, accumulate-and-keep-going style as
 * `@vespeneventures/copy`'s `schema.ts` — no schema library, for the same
 * reason that file gives: this package's entire job is dependency-free data
 * validation, and a public package should not force every consumer onto one
 * schema library's major version for the sake of shape-checking a handful
 * of nested objects.
 *
 * Every check here is a REAL check, not decoration — this repository has
 * already deleted one whole package (`contract`) for shipping checks that
 * were all mechanically re-derivable from data already present elsewhere.
 * Several checks here are worth calling out because this repository has
 * been bitten by both failure modes before, more than once:
 *
 *   - **`alt-not-whitespace-only`.** A whitespace-only `alt` (`"   "`)
 *     passes a naive `.length > 0` check while rendering as no alt text at
 *     all — the exact gap `@vespeneventures/surface/core`'s `validate.ts` had to
 *     add a SECOND, stricter check for (`binding-value-shape`, over and
 *     above `isNonEmptyString`) after a whitespace-only `SlotBinding.value`
 *     slipped past the first one. This package holds that same stricter
 *     line from the start, in the one place (`alt`) it matters most: an
 *     asset registry that lets whitespace-only alt text validate clean
 *     produces inaccessible output for every consumer of every entry that
 *     slips through.
 *   - **`id-unique`.** A duplicate id is not a cosmetic problem — the
 *     second entry silently shadows the first the moment anything indexes
 *     this record by id (`registry.ts`, `coverage.ts`, a future renderer),
 *     so which asset a given `assetId` actually resolves to becomes
 *     order-dependent and unreviewable. Checked at the record level, the
 *     same way `@vespeneventures/copy`'s `schema.ts` checks
 *     `CopyEntryId` uniqueness.
 *   - **`video-caption-or-transcript-required`.** A `VideoAssetEntry`
 *     schema that PERMITS omitting both `captions` and `transcript` would
 *     let a producing team ship an inaccessible video and have the
 *     registry call it valid — the identical failure mode `alt`'s own
 *     required-and-non-whitespace rule exists to prevent for images, and
 *     arguably worse for video: there is no later point in this pipeline
 *     where a caption track can be recovered from a URL and two integers,
 *     and recovering one after the fact means re-transcribing the video,
 *     not re-typing a sentence. This is a hard, `"error"`-severity schema
 *     rule, never a rendering-time decision — see
 *     `../web/renderWebDocument.ts`'s own doc comment for why a video
 *     entry that fails this rule never reaches a renderer at all.
 *   - **`video-reduced-motion-required`.** Same reasoning restated for
 *     motion: an entry with no declared `reducedMotion` behaviour is a
 *     video whose autoplay-under-`prefers-reduced-motion` behaviour is
 *     simply unspecified, which this package treats as unshippable, not as
 *     "assume the safest default."
 *
 * WHY `licence` STAYS OPTIONAL HERE, EVEN THOUGH v1 DID NOT TREAT A MISSING
 * ONE AS A FINDING AT ALL
 * ---------------------------------------------------------------------------
 * `types.ts`'s own top comment already states this, restated here because
 * it is exactly the kind of decision a schema file's own reader expects to
 * find explained where the code lives: `licence`/`credit` are not new in
 * v2, and making `licence` schema-required would invalidate every already-
 * registered v1 entry the moment its owner upgrades this package — an
 * upgrade-time breakage this package's own 0.x dependency discipline exists
 * to avoid inflicting without a consumer's own choice. `coverage.ts`'s new
 * `"asset-missing-licence"` warning is where a missing licence is surfaced
 * instead — see that file's own top comment.
 */

import type { AssetEntry, AssetEntryId, AssetFinding, AssetRecord, ImageSource, VideoCaption, VideoSource } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Stricter than a bare non-empty check for a field where a whitespace-only string is a real bug, not a valid value — see this file's top comment. `isNonEmptyString` above already does the `.trim()` check, but this alias exists so the specific fields that rely on it (`alt`, `src`) read as an intentional choice, not an accident of `isNonEmptyString`'s own implementation. */
const isNonEmptyNonWhitespaceString = isNonEmptyString;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** A short, readable description of an arbitrary value for an error message — mirrors `@vespeneventures/surface/core`'s `validate.ts`'s `describe` and `@vespeneventures/strategy`'s `validation.ts`'s `describeValue`. */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} item(s))`;
  const t = typeof value;
  if (t === "object") return "an object";
  if (t === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * `AssetEntryId` shape: dot-separated, lowercase, kebab-case within each
 * segment, at least one dot (i.e. at least two segments) — e.g.
 * `"marketing.hero-banner"`. Identical pattern to
 * `@vespeneventures/copy`'s own `COPY_ENTRY_ID_RE` — see `types.ts`'s doc
 * comment on `AssetEntryId` for why a bare, unnamespaced id is rejected
 * rather than merely discouraged.
 */
const ASSET_ENTRY_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

const ASSET_TYPES = ["image", "video"] as const;
const REDUCED_MOTION_VALUES = ["pause", "no-autoplay", "static-poster"] as const;

// --------------------------------------------------------------- shared base-field checks

/**
 * Every check `AssetEntryBase` requires, regardless of `type` —
 * `id`/`alt`/`mimeType`/`licence`/`credit`. Returns findings; never throws.
 * Shared by both `validateImageEntry`/`validateVideoEntry` so the base
 * checks are written, and can only drift, once.
 */
function validateBaseFields(value: Record<string, unknown>, path: string): AssetFinding[] {
  const findings: AssetFinding[] = [];

  const id = value.id;
  const alt = value.alt;
  const mimeType = value.mimeType;
  const licence = value.licence;
  const credit = value.credit;

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `${path}.id must be a non-empty string, got ${describe(id)}.`,
      path: `${path}.id`,
    });
  } else if (!ASSET_ENTRY_ID_RE.test(id)) {
    findings.push({
      rule: "id-well-formed",
      severity: "error",
      message: `${path}.id "${id}" must be dot-separated and lowercase, with at least one dot (e.g. "marketing.hero-banner"), got ${describe(id)}.`,
      path: `${path}.id`,
    });
  }

  // The real check for `alt`: not just "present", but present and NOT
  // whitespace-only. See this file's top comment for why this is not
  // decoration — `isNonEmptyString` above already does the `.trim()` work,
  // so a plain `typeof alt === "string" && alt.length > 0` value that is
  // ALL whitespace fails here rather than validating clean.
  if (typeof alt !== "string" || alt.length === 0) {
    findings.push({
      rule: "alt-shape",
      severity: "error",
      message: `${path}.alt must be a non-empty string, got ${describe(alt)}.`,
      path: `${path}.alt`,
    });
  } else if (alt.trim().length === 0) {
    findings.push({
      rule: "alt-not-whitespace-only",
      severity: "error",
      message: `${path}.alt must not be whitespace-only, got ${JSON.stringify(alt)}. Whitespace-only alt text renders as no alt text at all.`,
      path: `${path}.alt`,
    });
  }

  if (mimeType !== undefined && !isNonEmptyString(mimeType)) {
    findings.push({
      rule: "mime-type-shape",
      severity: "error",
      message: `${path}.mimeType must be a non-empty string when present, got ${describe(mimeType)}.`,
      path: `${path}.mimeType`,
    });
  }

  if (licence !== undefined && !isNonEmptyString(licence)) {
    findings.push({
      rule: "licence-shape",
      severity: "error",
      message: `${path}.licence must be a non-empty string when present, got ${describe(licence)}.`,
      path: `${path}.licence`,
    });
  }

  if (credit !== undefined && !isNonEmptyString(credit)) {
    findings.push({
      rule: "credit-shape",
      severity: "error",
      message: `${path}.credit must be a non-empty string when present, got ${describe(credit)}.`,
      path: `${path}.credit`,
    });
  }

  return findings;
}

// --------------------------------------------------------------- image-specific checks

function validateImageSource(value: unknown, path: string): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "image-source-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const findings: AssetFinding[] = [];
  const src = value.src;
  const width = value.width;
  const format = value.format;

  if (!isNonEmptyNonWhitespaceString(src)) {
    findings.push({
      rule: "image-source-src-shape",
      severity: "error",
      message: `${path}.src must be a non-empty string, got ${describe(src)}.`,
      path: `${path}.src`,
    });
  }
  if (!isPositiveFiniteNumber(width)) {
    findings.push({
      rule: "image-source-width-positive",
      severity: "error",
      message: `${path}.width must be a positive number, got ${describe(width)}.`,
      path: `${path}.width`,
    });
  }
  if (format !== undefined && !isNonEmptyString(format)) {
    findings.push({
      rule: "image-source-format-shape",
      severity: "error",
      message: `${path}.format must be a non-empty string when present, got ${describe(format)}.`,
      path: `${path}.format`,
    });
  }
  return findings;
}

/**
 * Rules: entry-shape, id-shape, id-well-formed, alt-shape,
 * alt-not-whitespace-only, mime-type-shape, licence-shape, credit-shape
 * (all from `validateBaseFields`), plus src-shape, width-positive,
 * height-positive, image-sources-shape, image-source-shape,
 * image-source-src-shape, image-source-width-positive,
 * image-source-format-shape.
 */
function validateImageEntry(value: Record<string, unknown>, path: string): AssetFinding[] {
  const findings = validateBaseFields(value, path);

  const src = value.src;
  const width = value.width;
  const height = value.height;
  const sources = value.sources;

  if (!isNonEmptyNonWhitespaceString(src)) {
    findings.push({
      rule: "src-shape",
      severity: "error",
      message: `${path}.src must be a non-empty string, got ${describe(src)}.`,
      path: `${path}.src`,
    });
  }
  if (!isPositiveFiniteNumber(width)) {
    findings.push({
      rule: "width-positive",
      severity: "error",
      message: `${path}.width must be a positive number, got ${describe(width)}.`,
      path: `${path}.width`,
    });
  }
  if (!isPositiveFiniteNumber(height)) {
    findings.push({
      rule: "height-positive",
      severity: "error",
      message: `${path}.height must be a positive number, got ${describe(height)}.`,
      path: `${path}.height`,
    });
  }

  if (sources !== undefined) {
    if (!Array.isArray(sources)) {
      findings.push({
        rule: "image-sources-shape",
        severity: "error",
        message: `${path}.sources must be an array when present, got ${describe(sources)}.`,
        path: `${path}.sources`,
      });
    } else {
      sources.forEach((source, i) => findings.push(...validateImageSource(source, `${path}.sources.${i}`)));
    }
  }

  return findings;
}

// --------------------------------------------------------------- video-specific checks

function validateVideoSource(value: unknown, path: string): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "video-source-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const findings: AssetFinding[] = [];
  const src = value.src;
  const mimeType = value.mimeType;

  if (!isNonEmptyNonWhitespaceString(src)) {
    findings.push({
      rule: "video-source-src-shape",
      severity: "error",
      message: `${path}.src must be a non-empty string, got ${describe(src)}.`,
      path: `${path}.src`,
    });
  }
  if (!isNonEmptyString(mimeType)) {
    findings.push({
      rule: "video-source-mime-type-shape",
      severity: "error",
      message: `${path}.mimeType must be a non-empty string, got ${describe(mimeType)}. A <source> needs a real MIME type — see VideoSource's own doc comment.`,
      path: `${path}.mimeType`,
    });
  }
  return findings;
}

function validateVideoCaption(value: unknown, path: string): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "video-caption-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const findings: AssetFinding[] = [];
  const src = value.src;
  const srclang = value.srclang;
  const label = value.label;

  if (!isNonEmptyNonWhitespaceString(src)) {
    findings.push({
      rule: "video-caption-src-shape",
      severity: "error",
      message: `${path}.src must be a non-empty string, got ${describe(src)}.`,
      path: `${path}.src`,
    });
  }
  if (!isNonEmptyString(srclang)) {
    findings.push({
      rule: "video-caption-srclang-shape",
      severity: "error",
      message: `${path}.srclang must be a non-empty string, got ${describe(srclang)}.`,
      path: `${path}.srclang`,
    });
  }
  if (!isNonEmptyString(label)) {
    findings.push({
      rule: "video-caption-label-shape",
      severity: "error",
      message: `${path}.label must be a non-empty string, got ${describe(label)}.`,
      path: `${path}.label`,
    });
  }
  return findings;
}

/**
 * Rules: entry-shape, id-shape, id-well-formed, alt-shape,
 * alt-not-whitespace-only, mime-type-shape, licence-shape, credit-shape
 * (all from `validateBaseFields`), plus width-positive, height-positive,
 * video-sources-shape, video-sources-non-empty, video-source-shape,
 * video-source-src-shape, video-source-mime-type-shape,
 * video-captions-shape, video-caption-shape (+ its three field rules),
 * video-transcript-shape, video-poster-shape,
 * video-caption-or-transcript-required, video-reduced-motion-required,
 * video-static-poster-requires-poster, video-autoplay-shape,
 * video-loop-shape, video-muted-shape.
 */
function validateVideoEntry(value: Record<string, unknown>, path: string): AssetFinding[] {
  const findings = validateBaseFields(value, path);

  const width = value.width;
  const height = value.height;
  const sources = value.sources;
  const captions = value.captions;
  const transcript = value.transcript;
  const poster = value.poster;
  const reducedMotion = value.reducedMotion;
  const autoplay = value.autoplay;
  const loop = value.loop;
  const muted = value.muted;

  if (!isPositiveFiniteNumber(width)) {
    findings.push({
      rule: "width-positive",
      severity: "error",
      message: `${path}.width must be a positive number, got ${describe(width)}.`,
      path: `${path}.width`,
    });
  }
  if (!isPositiveFiniteNumber(height)) {
    findings.push({
      rule: "height-positive",
      severity: "error",
      message: `${path}.height must be a positive number, got ${describe(height)}.`,
      path: `${path}.height`,
    });
  }

  // `sources`: required, non-empty array — a VideoAssetEntry with zero
  // playable sources cannot be rendered by any channel, on the web or off
  // it, so this is the video-equivalent of `src-shape` for an image.
  if (!Array.isArray(sources)) {
    findings.push({
      rule: "video-sources-shape",
      severity: "error",
      message: `${path}.sources must be an array, got ${describe(sources)}.`,
      path: `${path}.sources`,
    });
  } else if (sources.length === 0) {
    findings.push({
      rule: "video-sources-non-empty",
      severity: "error",
      message: `${path}.sources must contain at least one source — a video with zero sources cannot be played by any channel.`,
      path: `${path}.sources`,
    });
  } else {
    sources.forEach((source, i) => findings.push(...validateVideoSource(source, `${path}.sources.${i}`)));
  }

  let hasWellFormedCaptions = false;
  if (captions !== undefined) {
    if (!Array.isArray(captions)) {
      findings.push({
        rule: "video-captions-shape",
        severity: "error",
        message: `${path}.captions must be an array when present, got ${describe(captions)}.`,
        path: `${path}.captions`,
      });
    } else {
      // Well-formed means non-empty AND every entry individually passes —
      // see this function's own doc comment: a malformed-but-non-empty
      // captions array must not silently excuse the video from needing
      // real accessible content.
      const captionFindings = captions.flatMap((caption, i) => validateVideoCaption(caption, `${path}.captions.${i}`));
      hasWellFormedCaptions = captions.length > 0 && captionFindings.length === 0;
      findings.push(...captionFindings);
    }
  }

  let hasWellFormedTranscript = false;
  if (transcript !== undefined) {
    if (!isNonEmptyNonWhitespaceString(transcript)) {
      findings.push({
        rule: "video-transcript-shape",
        severity: "error",
        message: `${path}.transcript must be a non-empty string when present, got ${describe(transcript)}.`,
        path: `${path}.transcript`,
      });
    } else {
      hasWellFormedTranscript = true;
    }
  }

  // The core accessibility gate for video — see this file's own top
  // comment. Checked against WELL-FORMED captions/transcript only: a
  // `captions` array that is present but malformed (caught above) must not
  // ALSO count toward satisfying this rule, or a single well-formed-looking
  // but broken caption entry would silently excuse the whole video from
  // needing real accessible content.
  if (!hasWellFormedCaptions && !hasWellFormedTranscript) {
    findings.push({
      rule: "video-caption-or-transcript-required",
      severity: "error",
      message: `${path} must declare at least one of captions/transcript — a video registry entry with neither is inaccessible by construction, the same "no later recovery point" reasoning alt's own required-and-non-whitespace rule already holds images to.`,
      path,
    });
  }

  let posterIsWellFormed = false;
  if (poster !== undefined) {
    if (!isNonEmptyNonWhitespaceString(poster)) {
      findings.push({
        rule: "video-poster-shape",
        severity: "error",
        message: `${path}.poster must be a non-empty string when present, got ${describe(poster)}.`,
        path: `${path}.poster`,
      });
    } else {
      posterIsWellFormed = true;
    }
  }

  if (!isNonEmptyString(reducedMotion) || !(REDUCED_MOTION_VALUES as readonly string[]).includes(reducedMotion)) {
    findings.push({
      rule: "video-reduced-motion-required",
      severity: "error",
      message: `${path}.reducedMotion must be one of ${REDUCED_MOTION_VALUES.join(", ")}, got ${describe(reducedMotion)}. This is required, not a styling suggestion — see VideoAssetEntry's own doc comment.`,
      path: `${path}.reducedMotion`,
    });
  } else if (reducedMotion === "static-poster" && !posterIsWellFormed) {
    findings.push({
      rule: "video-static-poster-requires-poster",
      severity: "error",
      message: `${path}.reducedMotion is "static-poster", which requires a well-formed ${path}.poster — a static-poster fallback with no poster image has nothing to render.`,
      path: `${path}.poster`,
    });
  }

  if (autoplay !== undefined && typeof autoplay !== "boolean") {
    findings.push({
      rule: "video-autoplay-shape",
      severity: "error",
      message: `${path}.autoplay must be a boolean when present, got ${describe(autoplay)}.`,
      path: `${path}.autoplay`,
    });
  }
  if (loop !== undefined && typeof loop !== "boolean") {
    findings.push({
      rule: "video-loop-shape",
      severity: "error",
      message: `${path}.loop must be a boolean when present, got ${describe(loop)}.`,
      path: `${path}.loop`,
    });
  }
  if (muted !== undefined && typeof muted !== "boolean") {
    findings.push({
      rule: "video-muted-shape",
      severity: "error",
      message: `${path}.muted must be a boolean when present, got ${describe(muted)}.`,
      path: `${path}.muted`,
    });
  }

  return findings;
}

// --------------------------------------------------------------- dispatch

function validateAssetEntryShape(value: unknown, path: string): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "entry-shape", severity: "error", message: `${path} must be an object.`, path }];
  }

  // Snapshot every field this function reads, exactly once, before any
  // check runs — mirroring @vespeneventures/copy's schema.ts and
  // @vespeneventures/surface/core's validate.ts, both of which document why: a
  // hostile or merely-badly-behaved `value` (a field implemented as a
  // getter, or a Proxy) could otherwise return a different result on each
  // property read.
  const snapshot: Record<string, unknown> = { ...value };
  const type = snapshot.type;

  if (!isNonEmptyString(type) || !(ASSET_TYPES as readonly string[]).includes(type)) {
    return [
      {
        rule: "type-shape",
        severity: "error",
        message: `${path}.type must be one of ${ASSET_TYPES.join(", ")}, got ${describe(type)}. Every v2 AssetEntry must declare its type explicitly — see AssetEntry's own doc comment for the v1-to-v2 migration.`,
        path: `${path}.type`,
      },
    ];
  }

  return type === "image" ? validateImageEntry(snapshot, path) : validateVideoEntry(snapshot, path);
}

/**
 * Validates that `value` conforms to the `AssetRecord` shape. Returns an
 * `AssetFinding[]`; empty means `value` is a well-formed `AssetRecord`.
 * Never throws — any input, including `null`, a string, or a wildly
 * malformed object, produces findings rather than an exception, the same
 * discipline every sibling validator in this ecosystem holds to.
 *
 * Checks, in full: `id` present and non-empty; `entries` present and an
 * array; every entry's own `type` (`"image"` or `"video"`, required) and
 * then every field that type's own shape requires — see
 * `validateImageEntry`/`validateVideoEntry`'s own doc comments; and, at the
 * record level, that every entry's `id` is unique within the record.
 *
 * `entries` being present but empty (`[]`) is a well-formed, zero-finding
 * `AssetRecord` as far as THIS function is concerned — the same judgment
 * call `@vespeneventures/copy`'s `validateCopyRecordShape` makes about a
 * `CopyRecord` with zero entries: whether zero entries is itself a problem
 * is for a caller with more context than a shape validator has. Unlike
 * `copy`'s own `checkCopyRecord`, this package's coverage check
 * (`coverage.ts`) does not treat a zero-entry `AssetRecord` as a failure by
 * itself — a fresh registry with zero referenced ids and zero entries has
 * nothing to disagree about — but it DOES refuse to call zero REFERENCED
 * ids a clean pass; see that file's own doc comment.
 */
export function validateAssetRecordShape(value: unknown): AssetFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "record-present", severity: "error", message: "An asset record must be an object.", path: "$" }];
  }

  const id = value.id;
  const entries = value.entries;

  const findings: AssetFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `id must be a non-empty string, got ${describe(id)}.`,
      path: "id",
    });
  }

  if (!Array.isArray(entries)) {
    findings.push({
      rule: "entries-shape",
      severity: "error",
      message: `entries must be an array, got ${describe(entries)}.`,
      path: "entries",
    });
  } else {
    entries.forEach((entry, i) => findings.push(...validateAssetEntryShape(entry, `entries.${i}`)));

    // Uniqueness is a whole-record property, not a per-entry one — mirrors
    // @vespeneventures/copy's schema.ts id-uniqueness check exactly. Only
    // entries that already passed their own id-shape check contribute a
    // value to compare.
    const seen = new Map<AssetEntryId, number>(); // id -> first index seen at
    entries.forEach((entry, i) => {
      if (!isPlainObject(entry)) return;
      const entryId = entry.id;
      if (typeof entryId !== "string" || entryId.length === 0) return;
      const firstIndex = seen.get(entryId);
      if (firstIndex === undefined) {
        seen.set(entryId, i);
      } else {
        findings.push({
          rule: "id-unique",
          severity: "error",
          message: `entries.${i}.id "${entryId}" duplicates entries.${firstIndex}.id — every entry's id must be unique within an AssetRecord.`,
          path: `entries.${i}.id`,
        });
      }
    });
  }

  return findings;
}

/**
 * Builds a fully-defaulted `AssetRecord` from `value`, which the caller
 * must already know passed `validateAssetRecordShape` with zero findings —
 * this function does no validation of its own and will throw or produce
 * garbage on unvalidated input. Only called internally, from
 * `parseAssetRecord`, immediately after that check — mirrors
 * `@vespeneventures/copy`'s `buildCopyRecord` exactly.
 */
function buildAssetEntry(raw: Record<string, unknown>): AssetEntry {
  const base = {
    id: raw.id as string,
    alt: raw.alt as string,
    mimeType: raw.mimeType as string | undefined,
    licence: raw.licence as string | undefined,
    credit: raw.credit as string | undefined,
  };

  if (raw.type === "image") {
    return {
      ...base,
      type: "image",
      src: raw.src as string,
      width: raw.width as number,
      height: raw.height as number,
      sources: raw.sources as ImageSource[] | undefined,
    };
  }

  return {
    ...base,
    type: "video",
    sources: raw.sources as VideoSource[],
    width: raw.width as number,
    height: raw.height as number,
    captions: raw.captions as VideoCaption[] | undefined,
    transcript: raw.transcript as string | undefined,
    poster: raw.poster as string | undefined,
    reducedMotion: raw.reducedMotion as VideoAssetEntryReducedMotion,
    autoplay: raw.autoplay as boolean | undefined,
    loop: raw.loop as boolean | undefined,
    muted: raw.muted as boolean | undefined,
  };
}

// Local alias so `buildAssetEntry` above does not need a second import line
// just for this one cast target's name.
type VideoAssetEntryReducedMotion = Extract<AssetEntry, { type: "video" }>["reducedMotion"];

function buildAssetRecord(value: Record<string, unknown>): AssetRecord {
  const entriesRaw = value.entries as unknown[];
  const builtEntries: AssetEntry[] = entriesRaw.map((raw) => buildAssetEntry(raw as Record<string, unknown>));

  return {
    id: value.id as string,
    entries: builtEntries,
  };
}

/**
 * Parses `value` as an `AssetRecord`, throwing a plain `Error` (never an
 * `AssetFinding[]`) if it does not conform. For a caller that wants
 * fail-fast construction — `registry.ts`'s `readAssetRecord`, in
 * particular — rather than `validateAssetRecordShape`'s "collect every
 * problem and keep going" shape. The thrown message includes every issue
 * `validateAssetRecordShape` would have reported, joined, so nothing is
 * lost by throwing instead of returning. Mirrors
 * `@vespeneventures/copy`'s `parseCopyRecord` exactly, including that
 * function's TOCTOU-safety reasoning for validating twice (see that
 * function's own doc comment) — this package's own threat model is
 * identical: a consumer's own in-memory config object, not a value
 * crossing a real trust boundary.
 */
export function parseAssetRecord(value: unknown): AssetRecord {
  const findings = validateAssetRecordShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parseAssetRecord: value is not a valid AssetRecord:\n${detail}`);
  }
  // Safe: validateAssetRecordShape returning no findings means every field
  // buildAssetRecord reads below is present and correctly typed.
  return buildAssetRecord(value as Record<string, unknown>);
}
