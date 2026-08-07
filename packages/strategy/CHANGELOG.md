# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release. Zod entity schemas — `FactSchema`/`FactsFileSchema`,
  `MoneySchema`, `MissionSchema`/`OperatingValueSchema`,
  `PositioningSchema`, `MarketSchema`/`MarketsFileSchema`,
  `AudienceSchema`/`AudiencesFileSchema`, `RoadmapItemSchema`/
  `RoadmapFileSchema`/`RoadmapStatusSchema` — machinery only, no real
  strategy content ships in this package.
- `readStrategy(root)`: a typed reader that loads and validates a
  consumer's own `strategy/` directory. Never throws; records anything it
  could not turn into usable data into `StrategyBundle.issues`, the same
  gather-don't-judge discipline `@vespeneventures/catalog`'s `buildCatalog`
  uses for `Catalog.skipped`.
- `buildFactIndex`/`isTracedSurfaceForm`: a pure lookup structure over a
  `Fact[]`, matching prose against each fact's own stringified value plus
  its declared `aliases` — never a guessed/derived formatting.
- `checkFactsTraceability`: the facts-traceability gate. Scans prose and
  copy for currency amounts, percentages, multipliers, large/labelled
  counts, and a closed set of absolute/superlative phrases, and fails when
  one cannot be traced to a `facts.json` entry — directly, or via a
  `fact:<key>` citation. Ships an explicit, auditable escape hatch
  (`facts-gate:ignore`, recorded into `result.ignored`, never silent) and a
  structural check against the escape hatch's own failure mode (a citation
  to a fact key that doesn't exist is itself a finding). Pure — no I/O,
  never throws.
- `scanStrategyDirectory`: the I/O half of the gate. Walks a real directory
  for `.md`/`.mdx`/`.ts`/`.tsx`/`.js`/`.jsx` files. **Fails closed**: throws
  rather than silently treating an unreadable directory as empty, matching
  this repository's `scripts/check-contamination-classes.mjs` walker.
- `strategy-facts-check` CLI (`bin`), wired to the same three-state exit
  code contract `@vespeneventures/gates`' `foundry-check` uses: `0` clean,
  `1` findings, `2` could not run — explicitly covering "facts.json is
  missing or invalid" and "the scan matched zero files" as `2`, never a
  silent `0`. This is the explicit third state a pass/fail-only gate is
  missing, and the specific failure mode this package's gate is built
  against.
