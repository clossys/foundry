# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release: the visual-registry layer over
  `@vespeneventures/compose`'s `SlotBinding.assetId` seam, the same split
  `@vespeneventures/copy` draws over `@vespeneventures/voice`'s verbal
  contract, one layer over.
- **Schema** (`src/types.ts`): plain TypeScript types (no schema library —
  see "Requirements" in the README) for `AssetEntry` (`id`, `src`,
  `width`, `height`, `alt`, optional `mimeType`/`licence`/`credit`) and
  `AssetRecord` (`id`, `entries`). `alt` is required — see the README's
  frozen-contract section for why.
- **Shape validation** (`src/schema.ts`): `validateAssetRecordShape` —
  hand-rolled type-guard validation, in the style of
  `@vespeneventures/copy`'s own `schema.ts` — checking id uniqueness and
  well-formedness (dot-separated, lowercase), non-empty `src`, positive
  `width`/`height`, and `alt` non-empty AND not whitespace-only (holding
  the same stricter line `@vespeneventures/compose`'s `validate.ts` had to
  add for `SlotBinding.value` after a whitespace-only value slipped past a
  first, looser check), plus `parseAssetRecord` (fail-fast, throws with
  every issue listed).
- **The reader** (`src/registry.ts`): `readAssetRecord(path)`, in the
  shape of `@vespeneventures/copy`'s `readCopyRecord` — reads an
  `AssetRecord` from a JSON file on disk, never throwing; records an
  unreadable file, an unparseable file, or a schema violation as an
  explicit issue instead.
- **The coverage check** (`src/coverage.ts`): `checkAssetCoverage(referencedIds,
  record)` — compares a list of referenced asset ids against a real
  `AssetRecord`, reporting `"unregistered-asset"` (error, a referenced id
  with no matching entry) and `"unreferenced-asset"` (warning, a
  registered entry no id referenced). Fails closed on an invalid `record`,
  a non-array or malformed `referencedIds`, and — the specific regression
  this package is built to prevent — zero referenced ids actually checked:
  `report.ok` requires `checkedCount > 0`, so an empty input never reads
  as a clean pass.
- `assets-check` CLI (`bin`, `src/cli.ts`), wired to the same three-state
  exit-code contract `copy-check` and `tokens-brand-check` use: `0` clean,
  `1` findings, `2` could not run — explicitly covering "the asset record
  is missing or invalid", "the referenced-ids file is missing or
  malformed", and "zero referenced ids were actually checked" as `2`,
  never a silent `0`.
- No runtime dependencies at all — matching `@vespeneventures/catalog`,
  `@vespeneventures/policy`, `@vespeneventures/tokens`,
  `@vespeneventures/voice`, and `@vespeneventures/copy`'s own precedent.
  In particular, zero dependency on `@vespeneventures/compose` — this
  package works whether or not `compose`'s `SlotBinding.assetId` seam has
  even been installed.
- Full test coverage in `src/*.test.ts`, entirely hermetic: `types.ts`,
  `schema.ts`, and `coverage.ts` are tested against inline literal
  fixtures only; `registry.ts` and `cli.ts` are tested against their own
  `mkdtemp` directories, never a real path in this repository, with no
  network access anywhere in the suite.
- **Out of scope, on purpose: generation.** No Recraft, no image API, no
  model calls, no network request anywhere in this package. See the
  README's "The single most important constraint".
