/**
 * Plain TypeScript types for @clossys/writer's contract: one
 * addressable, reviewable piece of copy (`CopyEntry`) and the record that
 * groups a consumer's whole set of them (`CopyRecord`). Pure data — no
 * validation logic lives here (see `schema.ts`) and no I/O (see
 * `registry.ts`).
 *
 * This is the FROZEN CONTRACT this package and its sibling scanner/gate
 * half (built in parallel, against the exact same shape) were both
 * compiled against. Do not add, remove, rename, or reshape a field here
 * without updating both halves in lockstep — a silent drift here breaks
 * the other half's compile, not this package's own tests.
 *
 * No runtime schema library. That follows this repository's own
 * precedent, restated once more because it matters more here than
 * anywhere else: `@example/catalog`, `@example/policy`,
 * `@example/ui/tokens`, and `@clossys/writer/voice` all ship zero
 * runtime dependencies; only `@example/ui` carries any, and only
 * because it wraps React primitives it genuinely cannot hand-roll. This
 * package's entire job is dependency-free data shape validation — the
 * same job `@example/strategy`'s `validation.ts` and
 * `@clossys/writer/voice`'s `schema.ts` already do, in plain type
 * guards, for their own shapes. `schema.ts` follows that pattern closely
 * rather than pulling in a schema library (and its own major-version
 * churn, a real cost for a *public* package's consumers) for what one
 * file of type guards already covers.
 *
 * This file ships no example content of anyone's real copy. Every field
 * here is either required-and-generic or a structural placeholder —
 * filling in an actual product's actual sentences is a consumer's job.
 * See "The single most important constraint" in the README: this package
 * is to `@clossys/writer/voice` what `@example/ui` is to
 * `@example/ui/tokens` — a vocabulary layer over a contract layer,
 * never a source of real words. If a doc comment, a test fixture, or a
 * README example in this package ever reads like something a product
 * would actually show a user, that is a bug in this package, not a
 * feature of it.
 */

// ---------------------------------------------------------------------------
// CopyEntryId — the stable address of one entry
// ---------------------------------------------------------------------------

/**
 * A stable address for one `CopyEntry`, unique within its `CopyRecord`.
 * Dot-separated, lowercase, kebab-case within each segment — e.g.
 * `"pagination.no-results"`, `"onboarding.step-2.title"`. At least one
 * dot is required: a bare, unnamespaced id like `"title"` is exactly the
 * kind of id that collides the moment a second feature also needs a
 * `"title"` entry, which is the whole reason this package asks for a
 * namespaced, dot-separated address rather than an arbitrary free-text
 * string. See `schema.ts`'s `COPY_ENTRY_ID_RE` for the exact pattern this
 * shape is validated against.
 *
 * A plain `string` alias, not a branded/nominal type: this package has no
 * runtime mechanism to keep a caller from constructing one by hand
 * outside `validateCopyRecordShape`/`parseCopyRecord`, so pretending
 * otherwise at the type level would be a false promise. The alias exists
 * purely to make every signature below say what kind of string it means.
 */
export type CopyEntryId = string;

// ---------------------------------------------------------------------------
// CopyRef and resolvable registry metadata
// ---------------------------------------------------------------------------

/**
 * A locale tag supplied by the consumer (normally a BCP 47 tag such as
 * `en` or `fr-CA`).  It remains a plain string because locale support is a
 * consumer policy: copy must not bundle a second internationalisation stack.
 */
export type CopyLocale = string;

/** Values permitted when a `CopyRef` fills a registered `{placeholder}`. */
export type CopyValue = string | number | boolean;

/**
 * The stable, serialisable way another package asks copy for audience-facing
 * text.  Surface documents carry this value instead of a prose literal.
 *
 * `locale` is a request, not a fallback algorithm.  The resolver owns the
 * fallback policy and fails closed when no compatible registry is available.
 */
export interface CopyRef {
  id: CopyEntryId;
  locale?: CopyLocale;
  values?: Readonly<Record<string, CopyValue>>;
}

/** Lifecycle state of a registry entry. Only approved entries can resolve. */
export type CopyEntryStatus = "draft" | "approved" | "retired";

/**
 * Consumer-supplied provenance for a resolvable copy registry. `reference`
 * is deliberately opaque: it may be a revision-control object, CMS revision,
 * or editorial record, without Foundry importing that system.
 */
export interface CopySource {
  kind: "consumer" | "generated" | "imported";
  reference: string;
}

// ---------------------------------------------------------------------------
// CopyEntry — one addressable, reviewable piece of copy
// ---------------------------------------------------------------------------

/**
 * One piece of copy a consumer's product shows a user, made addressable,
 * reviewable, and checkable. This package never populates `text` with
 * anything real — every `CopyEntry` a consumer's own repository registers
 * is that repository's own words, the same way a `VoiceRecord`'s
 * `glossary` and `claims` are never this package's words either (see
 * `@clossys/writer/voice`'s README, "The single most important
 * constraint").
 */
export interface CopyEntry {
  /** Stable address. Unique within the `CopyRecord` it belongs to — see `CopyEntryId`. */
  id: CopyEntryId;
  /** The copy itself — a consumer's own words, never this package's. */
  text: string;
  /**
   * Where this copy appears — a screen name, a component, a route, a
   * notification type. Required, and deliberately not optional: an entry
   * with no stated location cannot be found by a human reviewer skimming
   * a report, which makes it unreviewable in practice even though it is
   * structurally present. "Unlocatable copy is not reviewable copy" is
   * the one-line version of why this field exists at all.
   */
  context: string;
  /**
   * Named interpolations `text` must contain, e.g. `["start", "end",
   * "total"]` for copy like `"Showing {start}–{end} of {total}
   * results"`. Each name in this list is checked against `text` using the
   * literal `{name}` convention — the same brace-delimited placeholder
   * syntax already familiar from ICU MessageFormat and most i18n
   * libraries — by `schema.ts`'s shape validation: a name declared here
   * but not found as `{name}` in `text` is treated as a real bug (the
   * copy was edited and the interpolation was dropped, or the
   * placeholder list drifted from the actual sentence), not decoration.
   * See `schema.ts` for exactly how this is checked, and this package's
   * README for why this is presence-detection over an already-authored
   * string, not a formatting engine: `Intl.PluralRules`,
   * `Intl.ListFormat`, `Intl.RelativeTimeFormat`, and
   * `Intl.NumberFormat.prototype.formatRange` already exist natively in
   * Node 20+ for the actual formatting work, and this package does not
   * re-wrap any of them.
   *
   * Optional — an entry with no interpolations at all (most copy) simply
   * omits this field; `parseCopyRecord` defaults it to `[]`.
   */
  placeholders?: string[];
  /**
   * A plain string into a consumer's own facts registry — never a typed
   * import, never a runtime dependency on `@example/strategy`.
   * This mirrors exactly how `@clossys/writer/voice`'s `Claim.factRef`
   * refers to a `strategy` package's facts without importing it: the
   * coupling is an opaque string convention, not a code import, so this
   * package works today, before `strategy` (or a consumer's own facts
   * registry) exists at all, and keeps working unchanged after it does.
   * Resolving a `factRef` against a real facts registry is a later gate's
   * job, one with visibility into both this package's entries and that
   * registry — deliberately not this package's, and not
   * `@clossys/writer/voice`'s either. See the README, "The `factRef`
   * seam", for the fuller argument (borrowed near-verbatim from that
   * package's own README section of the same name, because it is the
   * same seam, one layer over).
   */
  factRef?: string;
}

/**
 * Content-derived provenance for one target-locale translation. Present only
 * on a target-locale `CopyRegistryEntry` — a source-locale entry has nothing
 * to be "translated from" and never carries this field. See
 * `computeCopyFingerprint` below and `locale-coverage.ts`'s doc comment for
 * why this is a fingerprint of the source text, never a human-maintained
 * revision number: a hand-bumped counter requires someone to remember to
 * bump it every time source copy changes, and nothing enforces that
 * discipline, so it silently drifts out of sync. A content hash cannot drift
 * the same way — it changes if and only if the text it was computed from
 * changed.
 */
export interface CopyTranslationProvenance {
  /**
   * A fingerprint of the SOURCE entry's `text`, computed with
   * `fingerprintAlgorithm`, at the moment this translation was produced.
   * Compared against a fresh `computeCopyFingerprint(sourceEntry.text)` by
   * `checkLocaleCoverage` to detect staleness — see that file's doc
   * comment for the full comparison.
   */
  sourceFingerprint: string;
  /**
   * The algorithm `sourceFingerprint` was computed with, e.g. `"sha256"` —
   * matches `COPY_FINGERPRINT_ALGORITHM`, the constant `computeCopyFingerprint`
   * (`fingerprint.ts`) is documented to use. Declared explicitly, per entry,
   * so a future algorithm change is a detectable mismatch rather than a
   * silent comparison between two fingerprints computed two different ways.
   */
  fingerprintAlgorithm: string;
  /** ISO-8601 timestamp of when this translation was produced. */
  translatedAt: string;
  /**
   * Opaque translator/vendor-job identifier — never a personal name. This
   * package ships no real identity data, per its own "no real product
   * sentences" constraint (see this file's top-of-file doc comment).
   */
  translatedBy?: string;
  /** ISO-8601 timestamp of when this translation was last reviewed, if it has been. */
  reviewedAt?: string;
  /** Opaque reviewer identifier, mirroring `translatedBy` — never a personal name. */
  reviewedBy?: string;
}

/** A `CopyEntry` that is eligible to participate in a rendered registry. */
export interface CopyRegistryEntry extends CopyEntry {
  status: CopyEntryStatus;
  /**
   * Content-derived translation provenance, present only on a target-locale
   * entry that has recorded it. Optional: absent on every source-locale
   * entry, and absent on any target-locale entry authored before this field
   * existed or by a host that has not adopted it yet — an existing registry
   * does not become invalid overnight. See `locale-coverage.ts` for how
   * presence/absence of this field changes what `checkLocaleCoverage` can
   * report: an entry with `translation` gets a real stale/not-stale
   * verdict; an entry without it gets `"locale-coverage:provenance-missing"`
   * instead, which is a DIFFERENT outcome from "checked and not stale" —
   * never collapsed into one signal.
   */
  translation?: CopyTranslationProvenance;
}

// ---------------------------------------------------------------------------
// CopyRecord — one consumer's whole registered set of entries
// ---------------------------------------------------------------------------

/**
 * One consumer's complete, registered set of copy entries. This is the
 * "brand.css" of this package — foundry ships the schema this conforms
 * to and the machinery to check it, never a real instance of it. See the
 * README, "The single most important constraint".
 */
export interface CopyRecord {
  id: string;
  entries: CopyEntry[];
}

/**
 * A versioned, locale-specific `CopyRecord` that can safely resolve
 * `CopyRef`s for an audience-facing surface. The older `CopyRecord` remains
 * the deliberately minimal scanner/checker input; resolution requires this
 * stronger contract so a manifest never pretends unversioned text is traced.
 */
export interface CopyRegistry extends CopyRecord {
  locale: CopyLocale;
  revision: string;
  source: CopySource;
  entries: CopyRegistryEntry[];
}

/** A successful, fully traced resolution of one copy reference. */
export interface CopyResolution {
  ref: CopyRef;
  text: string;
  recordId: string;
  revision: string;
  locale: CopyLocale;
  source: CopySource;
  entryId: CopyEntryId;
}

/** Resolver shape for callers that need rendered audience text. */
export type CopyResolver = (ref: CopyRef) => CopyResolution | undefined;

// ---------------------------------------------------------------------------
// CopyFinding — shared shape, mirroring @clossys/writer/voice's own `VoiceFinding`
// ---------------------------------------------------------------------------

/**
 * One thing `schema.ts`'s shape validation found wrong with a candidate
 * `CopyRecord` or `CopyEntry`. Deliberately the same shape as
 * `@clossys/writer/voice`'s `VoiceFinding` (itself deliberately the same
 * shape as `@example/policy`'s `Finding`) — `rule` / `severity` /
 * `message` / optional `path` — so a caller already handling one kind of
 * finding in this repository's ecosystem does not need a second mental
 * model for this package's. Defined fresh here, not imported: this
 * file's own zero-runtime-dependency requirement applies to
 * `@clossys/writer/voice` too — `types.ts` and `schema.ts` do not import
 * from it. (`checker.ts` does depend on `@clossys/writer/voice`, for
 * `checkCopy` itself — see that file's own doc comment for why that
 * dependency is confined there.)
 */
export interface CopyFinding {
  /** Stable identifier for the rule that produced this finding, e.g. `"id-shape"`, `"placeholder-missing-from-text"`. */
  rule: string;
  /** Always `"error"` from `schema.ts` — a malformed `CopyRecord` is never merely a warning. */
  severity: "error" | "warning";
  /** Human-readable description of the problem. */
  message: string;
  /** The specific field, entry index, or placeholder name this finding is about, when there is a single clear one. */
  path?: string;
}
