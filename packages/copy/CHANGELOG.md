# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release: the vocabulary layer over `@vespeneventures/voice`'s
  verbal contract, the same split `@vespeneventures/ui` draws over
  `@vespeneventures/tokens`.
- **Schema** (`src/types.ts`): plain TypeScript types (no schema library —
  see "Requirements" in the README) for `CopyEntry` (`id`, `text`,
  `context`, optional `placeholders`, optional `factRef`) and
  `CopyRecord` (`id`, `entries`).
- **Shape validation** (`src/schema.ts`): `validateCopyRecordShape` —
  hand-rolled type-guard validation, in the style of
  `@vespeneventures/strategy`'s `validation.ts` and
  `@vespeneventures/voice`'s own `schema.ts` — checking id uniqueness and
  well-formedness (dot-separated, lowercase), non-empty `text`/`context`,
  and that every declared `placeholders` entry actually appears as
  `{name}` in its entry's `text`, plus `parseCopyRecord` (fail-fast,
  throws with every issue listed).
- **The reader** (`src/registry.ts`): `readCopyRecord(path)`, in the shape
  of `@vespeneventures/strategy`'s `readStrategy` — reads a `CopyRecord`
  from a JSON file on disk, never throwing; records an unreadable file, an
  unparseable file, or a schema violation as an explicit issue instead.
- **The checker** (`src/checker.ts`): `checkCopyRecord(record,
  voiceRecord, options?)` — runs every entry's `text` through
  `@vespeneventures/voice`'s own `checkCopy`, aggregates the findings
  (each tagged with the entry id it came from), and fails closed on an
  invalid `CopyRecord`, an invalid `VoiceRecord`, or a record with zero
  entries, rather than reporting any of those as a clean pass. Reports an
  explicit `checkedCount`/`skippedCount` alongside the `checked`/`skipped`
  arrays themselves, and a `complete` flag that means "did this run check
  everything it could have" — independent of whether what it checked was
  clean, mirroring `voice`'s own `VoiceCheckReport.complete`.
- No runtime dependency beyond `@vespeneventures/voice` itself (an exact
  `~0.1.0` range, not a caret range — see the README, "Requirements", for
  why). Otherwise zero runtime dependencies, matching
  `@vespeneventures/catalog`, `@vespeneventures/policy`,
  `@vespeneventures/tokens`, and `@vespeneventures/voice`'s own precedent.
- Full test coverage in `src/*.test.ts`, entirely hermetic: `types.ts`,
  `schema.ts`, and `checker.ts` are tested against inline literal
  fixtures only; `registry.ts` is tested against its own `mkdtemp`
  directory, never a real path in this repository, with no network access
  anywhere in the suite.
