# Changelog

## [0.8.0] - 2026-08-19

### Added

- **`checkVoiceDerivationCoverage`** (new `src/voice/derivation-coverage.ts`, re-exported from `./voice`): the voice half of `@vespeneventures/strategy`'s `checkBrandCoverage`, which this mirrors closely. `strategy`'s `BrandDerivation.voiceRules` names voice rule ids by plain string but `strategy` — zero runtime dependencies, no import of this package — has no way to check that half of a `BrandDerivation` against real voice rule ids. This closes that gap from the `copy` side. **Signature: `checkVoiceDerivationCoverage(obligations: readonly string[], brandDerivedRuleIds: readonly string[])`** — mirroring `checkBrandCoverage(brandableSlots, derivations)`'s own two-plain-string-lists shape exactly, not a `VoiceRecord`. `brandDerivedRuleIds` is the caller-supplied set of voice rule ids a brand attribute actually derives (e.g. every `BrandDerivation.voiceRules` entry a consumer's own strategy declares) — this package has no `brandable`-equivalent flag on a glossary entry or claim, so it cannot tell a brand-derived rule id from any other consumer-authored one, the identical reason `checkBrandCoverage` cannot look up `tokens`' `brandable` flag itself and takes `brandableSlots` as an argument instead. It checks BOTH directions — every obligation names an id `brandDerivedRuleIds` declares, and every id in `brandDerivedRuleIds` is reached by at least one obligation. Fails closed, exactly like `checkBrandCoverage`: `ok: false` with `reason: "no-obligations-provided"` or `reason: "no-brand-derived-rules-provided"` on either degenerate empty input, never a vacuous pass; a real gap in either direction is `reason: "coverage-gap"`. Pure, no I/O, never throws. See `derivation-coverage.ts`'s top-of-file doc comment for the full account of why an earlier draft of this function took a `VoiceRecord` and auto-derived this list by scanning every glossary term, claim id, and pattern id in it — that conflated *consumer-authored* with *brand-derived* (every field in a `VoiceRecord` is authored by the consumer; not every field is determined by a brand attribute) and was corrected before this release ever shipped.
- **`copy-check voice-derivation-coverage <obligations-file> <brand-derived-rule-ids-file>`**: a second subcommand on the existing `copy-check` CLI, wiring `checkVoiceDerivationCoverage` in with the same 0/1/2 exit-code contract the original subcommand already uses (0 satisfied, 1 a real coverage gap, 2 could not run — bad input, an unreadable/unparseable file, zero obligations, or zero brand-derived rule ids). Both arguments are JSON files containing an array of non-empty strings — this subcommand no longer reads a `VoiceRecord` at all. Dispatched only when `argv[0]` is exactly `"voice-derivation-coverage"`; every existing caller's argv is unaffected.

## [0.7.1] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.7.0] - 2026-08-17

### Changed

- **`copy-check` now exits `2` when ANY matched file failed to parse
  (behavioural, affects any CI job reading its exit code).** The existing
  parse-failure guard keyed off `filesScanned === 0`, so it only ever fired
  when *every* matched file failed. One unparseable file alongside a
  hundred clean ones left `filesScanned > 0` and dropped out of the
  exit-code decision entirely: the run reported on the files it could read
  and returned `0`, as though the file it never opened had been examined
  and found clean. An unparseable file can contain any amount of
  unregistered copy — nobody knows, which is what "could not evaluate"
  means, and this gate's own documented rule is that such a state is never
  a pass.

  This is the same collapse a non-empty `unchecked` list already exits `2`
  for, only coarser — a whole file never examined rather than a construct
  within one — and it now gets the same answer, as this CLI's own header
  already argued it should. Parse failures are still printed in full, and
  every finding from the files that did parse is still reported; what
  changed is only what the run as a whole is allowed to claim. Nothing that
  failed before passes now.

## [0.6.0] - 2026-08-13

### Added

- **Per-entry translation provenance**: `CopyRegistryEntry.translation?:
  CopyTranslationProvenance` (`types.ts`) — `sourceFingerprint`,
  `fingerprintAlgorithm`, `translatedAt`, and optional `translatedBy` /
  `reviewedAt` / `reviewedBy`. `translation` is optional at the TYPE level
  and unenforced by `validateCopyRegistryShape`: an entry with no
  `translation` remains a fully valid `CopyRegistryEntry`, and no registry
  written before this release becomes invalid.
- **`computeCopyFingerprint`** (new `fingerprint.ts`, exported from the
  root), plus the `COPY_FINGERPRINT_ALGORITHM` constant it uses
  (`"sha256"`). A deterministic, content-derived digest of a copy entry's
  `text` and nothing else, computed with `node:crypto`'s `createHash` — no
  new runtime dependency, following the same built-in-module precedent
  `registry.ts` already set with `node:fs`.
- **Real stale-translation detection in `checkLocaleCoverage`**: for every
  target entry present in both a source and target locale, a target entry
  carrying `translation` gets its recorded `sourceFingerprint` compared
  against `computeCopyFingerprint(sourceEntry.text)` — a mismatch is
  `"locale-coverage:stale-entry"` (`"warning"`). A target entry with no
  `translation` at all gets `"locale-coverage:provenance-missing"`
  (`"warning"`) instead — a deliberately DIFFERENT outcome from "checked and
  not stale," never collapsed into either that or `stale-entry`, so a
  caller can always tell "current," "stale," and "cannot tell" apart.
  **`"locale-coverage:staleness-not-checked"` is removed entirely** — the
  rule name, its unconditional push, and its "not implemented" doc-comment
  section are all gone, because leaving a gate reporting a gap it no longer
  has would be actively misleading.
- **Interpolation-parity governance, both directions, in
  `checkLocaleCoverage`**: for every entry present in both locales, a
  `placeholders` name the source declares that the target's translation is
  missing is `"locale-coverage:interpolation-missing"` (`"error"` — a
  required value has nowhere to interpolate into); a name the target
  declares that the source does not is
  `"locale-coverage:interpolation-extra"` (`"error"` — an unfilled `{name}`
  token renders straight to a user). Matches `schema.ts`'s existing
  `placeholder-missing-from-text` severity precedent for the same class of
  bug within one locale.
- Content-derived fingerprinting was chosen over a human-maintained revision
  field specifically because a hand-bumped counter requires someone to
  remember to update it every time source copy changes, and nothing
  enforces that discipline — see `fingerprint.ts` and `locale-coverage.ts`'s
  doc comments for the full argument, and the README's rewritten "Where
  this package sits on i18n" section for the consumer-facing summary. The
  translation-*runtime* boundary (`Intl`, ICU, locale negotiation) this
  package already drew is unchanged — this release is governance only.

## [0.5.0] - 2026-08-13

### Added

- **Pattern rules** (`PatternRule`/`VoicePattern`) for `copy/voice` — a
  regex-based rule alongside `GlossaryEntry`'s literal term matching, for
  alternation, an optional apostrophe, and a hard punctuation ban (an em
  dash, say) that literal matching cannot express. Patterns are serialized
  as `{ source, flags }`, never a real `RegExp`, since a `VoiceRecord` is
  checked-in JSON data.
  - Regex safety is bounded at REGISTRATION TIME, never at run time: a
    disallowed flag (only `i`/`u`/`s`), an oversized source, a
    backreference, an oversized bounded quantifier, or a nested unbounded
    quantifier (the classic `(a+)+` catastrophic-backtracking shape) is
    rejected — see `src/voice/internal/pattern-safety.ts`'s top doc comment
    for the full, honest accounting of what is and is not caught.
    `checkPatternSafety` is exported so a consumer can validate a pattern
    independently.
  - An invalid pattern is always a real, unmissable, non-waivable
    `"pattern:invalid-rule"` **error** finding — both at registration
    (`validateVoiceRecordShape`) and, as defense-in-depth, inside
    `checkCopy` itself. A rule that cannot run must be reported as broken,
    never silently dropped.
- **A third severity tier**: `VoiceFinding.severity` widens from
  `"error" | "warning"` to `"error" | "warning" | "advisory"`
  (`VoiceSeverity`, `VOICE_SEVERITIES`). `"error"` fails CI (this package's
  documented `findings.some(f => f.severity === "error")` idiom); `"warning"`
  fails only a narrower, consumer-owned editorial gate this package does not
  implement; `"advisory"` is purely informational and never fails anything.
  `isCiBlockingSeverity` makes the mapping explicit and importable. Every
  existing finding this package produces is unchanged — only
  `PatternRule.severity` requires an author to pick a tier explicitly.
- **Channel scoping**: an optional `channel` (`VoiceChannel`, a plain
  string validated for shape only — this package does not define what a
  channel is, mirroring `CopyLocale`) on a `GlossaryEntry` or `PatternRule`,
  plus a new `VoiceCheckOptions.channel`. A channel-scoped rule applies only
  when it matches the requested channel exactly; an unscoped rule always
  applies, exactly as before.
- **Path exclusions for the scanning surface** (`ScanOptions.pathExclusions`,
  new `ScanResult.excludedFiles`/`pathExclusionFindings` fields): a
  consumer-configured list of files `scanCopySourceTree` skips entirely,
  fixing the mention-vs-use failure (a style guide documenting this voice's
  own banned terms trips its own traceability check). A deliberately small,
  hand-rolled pattern language (exact path / `dir/**` subtree / a single
  final-segment `*`) — no glob library. A DIFFERENT mechanism from the
  existing `ExclusionReason`/`ExcludedLiteral` (a per-literal classification
  inside a file that IS scanned) — see `src/path-exclusions.ts`'s top doc
  comment for why these are not the same feature. Fails closed: a malformed
  entry is never applied and is reported as an `"error"`; an entry matching
  zero files is reported as a `"warning"`, since a stale exclusion is
  otherwise indistinguishable from a working one.

### Scope

Everything above is additive and backward compatible. `patterns` is
optional at the `VoiceRecord` TYPE level (not merely defaulted at
validation time, the way `glossary`/`claims` are), specifically so a
`VoiceRecord` that never declares it produces byte-for-byte the same
`checkCopy` report shape (`ran`/`skipped`/`complete`) it always did — pinned
by an explicit test in `checker.test.ts`.

## [0.4.0] - 2026-08-13

### Added

- `checkLocaleCoverage`, a governance checker over a set of locale-keyed
  `CopyRegistry` objects and a declared source locale: reports entries
  missing from a target locale and entries orphaned in a target locale (no
  longer present in the source). Stale-translation detection was deliberately
  left unimplemented — `CopyRegistryEntry` has no per-entry revision to
  compare, and `CopyRegistry.revision` is a whole-registry, unordered
  provenance string that cannot safely stand in for one; every run reports
  this gap as its own finding rather than silently skipping it.
- Fails closed, distinctly, on an empty registry set, an empty declared-locale
  set, a source locale with zero entries, and a declared target locale that
  is entirely absent — none of these report a clean pass.
- Documented this package's position on i18n in the README: translation
  runtime (ICU, plural rules, locale negotiation, formatting) stays out of
  scope by design; translation governance (coverage, drift) is this
  package's job. Also documents the voice-glossary/i18n-glossary
  distinction, and why an i18n glossary is not added to `copy/voice` in this
  release — it would require a new locale-keyed term registry, not a small
  extension of `GlossaryEntry`.

## [0.3.1] - 2026-08-13

### Fixed

- Removed the stale "Release status" caveat claiming this package "has not
  completed a public registry release." This package is already marked
  published in this repository's own lifecycle catalog — the caveat, not
  the package, was outdated. Surfaced by a consumer integration (#147).

## [0.3.0] - 2026-08-12

- Added the strict, locale-aware `CopyRegistry` and `CopyRef` resolution API
  for audience-facing rendered surfaces, including entry lifecycle and source
  provenance.
- Added `createCopyResolver` and `resolveCopyRef`; required copy now fails
  closed for unknown IDs, locale mismatch, unapproved lifecycle state, and
  placeholder mismatches.

## [0.1.0] - 2026-08-07

- Consolidated the voice contract, template, validation, and checker into
  `@vespeneventures/copy`.
- Added `@vespeneventures/copy/voice` and
  `@vespeneventures/copy/voice-record.template.jsonc` entry points.
