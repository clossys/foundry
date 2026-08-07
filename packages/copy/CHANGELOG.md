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
- `scanCopySourceTree`/`extractCopyCandidates` (`src/scan.ts`): a
  hand-rolled, no-parser-library character scanner that walks a real
  source tree and extracts every string/template literal that looks like
  user-facing copy, excluding import specifiers, object/destructuring
  keys, `type`/`interface` context, `aria-*`/`data-*` and other
  denylisted attribute values, class-name-builder and developer-diagnostic
  call arguments, decorative glyphs, and bare lowercase enum/variant
  tokens — every exclusion counted and reported by reason, never silent.
  **Fails closed**: an unreadable directory or file throws; a file that
  cannot be reliably tokenized is reported as a parse failure and
  contributes zero candidates rather than being silently under-scanned.
- `checkCopyTraceability` (`src/copy-gate.ts`): the pure traceability gate.
  Matches each extracted candidate against a `CopyRecord` entry's `text`
  by static shape — every `{name}`/`${...}` interpolation on both sides
  collapsed to the same sentinel, so a source expression's actual content
  and a registered entry's placeholder names never need to agree — or a
  `copy:<id>` citation on the same line. Ships the same escape hatch and
  citation-integrity discipline as `@vespeneventures/strategy`'s facts
  gate: `copy-gate:ignore` is recorded into `result.ignored`, never
  silent, and citing an id that does not exist in the record is itself a
  finding (`unknown-copy-citation`).
- `copy-check` CLI (`bin`, `src/cli.ts`), wired to the same three-state
  exit-code contract `strategy-facts-check` and `@vespeneventures/gates`'
  `foundry-check` use: `0` clean, `1` findings, `2` could not run —
  explicitly covering "the copy record is missing or invalid" and "the
  scan matched zero files" as `2`, never a silent `0`.
