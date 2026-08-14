# Changelog

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
